import { FileNestingCandidates } from './fileNestingCandidates';
import { createExcludeMatcher } from './excludeMatcher';
import { AsyncReadCache } from './asyncReadCache';
import { allowsNodeAction, allowsNodeSelection } from './nodeActionPolicy';
import * as vscode from 'vscode';
import * as path from 'path';
import { ContextMenuService } from './contextMenuService';
import { GitStatusService } from './gitStatusService';
import { DiagnosticService } from './diagnosticService';
import { ExplorerColorMode, ExplorerDecorationService } from './decorationService';
import { NodeKind, ParsedProject, ParsedSolutionFolder, ParsedSolution, WebNode, DependencyRef, GitFileState } from './types';
import { AohProjectInfo, AohSolutionExplorerApi, AohSolutionInfo, AohSolutionState } from './api';
import { SolutionExplorerDragAndDropController } from './dragAndDropController';

// Bootstrap diagnostics are created at module load so an absent channel means
// VS Code never loaded this runtime file.
const bootstrapOutput = vscode.window.createOutputChannel('AOH Solution Explorer');
bootstrapOutput.appendLine(`[bootstrap] Runtime module loaded; VS Code ${vscode.version}`);

export class SolutionExplorerTreeDataProvider implements vscode.TreeDataProvider<WebNode> {
    private readonly changed = new vscode.EventEmitter<WebNode | undefined | null | void>();
    readonly onDidChangeTreeData = this.changed.event;

    private readonly gitStatusService: GitStatusService;
    private readonly contextMenuService: ContextMenuService;
    private readonly diagnosticService = new DiagnosticService();
    private roots: WebNode[] | undefined;
    private parsedSolutions: ParsedSolution[] = [];
    private readonly solutionStateChanged = new vscode.EventEmitter<void>();
    readonly onDidChangeSolutionState = this.solutionStateChanged.event;
    private readonly parentById = new Map<string, WebNode>();
    private readonly fileByPath = new Map<string, WebNode>();
    private showExcludedFiles = false;
    private refreshRunning: Promise<void> | undefined;
    private refreshPending = false;
    private directoryReads = this.createDirectoryCache();
    private fileReads = this.createFileCache();
    private isExcluded = createExcludeMatcher([]);

    private createDirectoryCache(): AsyncReadCache<[string, vscode.FileType][]> {
        return new AsyncReadCache(key => vscode.workspace.fs.readDirectory(vscode.Uri.parse(key)));
    }

    private createFileCache(): AsyncReadCache<Uint8Array> {
        return new AsyncReadCache(key => vscode.workspace.fs.readFile(vscode.Uri.parse(key)));
    }

    constructor(private readonly log: (message: string) => void = () => {}) {
        this.gitStatusService = new GitStatusService(log);
        this.contextMenuService = new ContextMenuService(async () => this.refresh(), log);
    }

    refresh(): Promise<void> {
        this.refreshPending = true;
        if (!this.refreshRunning) {
            this.refreshRunning = this.runRefresh().finally(() => { this.refreshRunning = undefined; });
        }
        return this.refreshRunning;
    }

    private async runRefresh(): Promise<void> {
        do {
            this.refreshPending = false;
            const started = Date.now();
            this.directoryReads = this.createDirectoryCache();
            this.fileReads = this.createFileCache();
            this.isExcluded = createExcludeMatcher(vscode.workspace.getConfiguration('aoh.solutionExplorer')
                .get<string[]>('exclude', ['bin', 'obj']));
            this.roots = await this.buildRoots();
            await this.gitStatusService.load(this.getGitProbePaths(), true);
            this.diagnosticService.load();
            this.resetNodeState(this.roots);
            this.applyAggregatedState(this.roots);
            this.rebuildIndexes();
            this.log(`Tree refresh: ${this.parsedSolutions.length} solutions, ${this.fileByPath.size} unique files, ${Date.now() - started} ms.`);
        } while (this.refreshPending);
        this.changed.fire();
        this.solutionStateChanged.fire();
    }

    /**
     * Refresh only Git/diagnostic state without rebuilding the tree.
     *
     * Diagnostics can change on every keystroke. Rebuilding the complete tree for
     * those events makes VS Code discard/recreate TreeItems and causes very visible
     * flicker. Structural refreshes are still used for create/delete/rename/config
     * changes; ordinary editor activity only updates decorations in-place.
     */
    async refreshVisualState(refreshGit = true): Promise<void> {
        const roots = await this.ensureRoots();

        if (refreshGit) await this.gitStatusService.load(this.getGitProbePaths());
        this.diagnosticService.load();

        this.resetNodeState(roots);
        this.applyAggregatedState(roots);
    }

    async setShowExcludedFiles(show: boolean): Promise<void> {
        if (this.showExcludedFiles === show) return;
        this.showExcludedFiles = show;
        await this.refresh();
    }

    async findFile(uri: vscode.Uri): Promise<WebNode | undefined> {
        await this.ensureRoots();
        return this.fileByPath.get(this.normalizeFsPath(uri.fsPath));
    }

    getParent(element: WebNode): vscode.ProviderResult<WebNode> {
        return this.parentById.get(element.id);
    }

    private async ensureRoots(): Promise<WebNode[]> {
        if (this.refreshRunning) await this.refreshRunning;
        else if (!this.roots) await this.refresh();
        return this.roots!;
    }

    private getGitProbePaths(): string[] {
        const probes = new Set<string>();

        for (const solution of this.parsedSolutions) {
            probes.add(path.dirname(solution.uri.fsPath));
            for (const project of solution.projects) {
                probes.add(project.projectRoot.fsPath);
            }
        }

        return [...probes];
    }

    private rebuildIndexes(): void {
        this.parentById.clear();
        this.fileByPath.clear();

        const visit = (node: WebNode, parent?: WebNode): void => {
            if (parent) {
                this.parentById.set(node.id, parent);
            }

            if (node.kind === 'file' && node.uri) {
                const uri = vscode.Uri.parse(node.uri);
                this.fileByPath.set(this.normalizeFsPath(uri.fsPath), node);
            }

            for (const child of node.children ?? []) {
                visit(child, node);
            }
        };

        for (const root of this.roots ?? []) {
            visit(root);
        }
    }

    private normalizeFsPath(value: string): string {
        const normalized = path.normalize(value);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    getTreeItem(element: WebNode): vscode.TreeItem {
        const hasChildren = Array.isArray(element.children) && element.children.length > 0;

        const item = new vscode.TreeItem(
            element.label,
            hasChildren
                ? (element.expanded
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed)
                : vscode.TreeItemCollapsibleState.None
        );

        item.id = element.id;
        item.contextValue = `aoh.${element.kind}`;

        // Decorations only color the node. Errors have priority over Git state;
        // warnings are intentionally ignored in the Solution Explorer.
        item.description = element.description;

        const diagnosticTooltip = element.errorCount
            ? `${element.errorCount} error${element.errorCount === 1 ? '' : 's'}`
            : undefined;

        item.tooltip = [element.label, element.description, diagnosticTooltip]
            .filter((value): value is string => Boolean(value))
            .join(' · ');

        if (element.uri) {
            const uri = vscode.Uri.parse(element.uri);

            // resourceUri lets VS Code apply the active file icon theme and
            // resource decorations registered by AOH.
            item.resourceUri = element.decorationUri
                ? vscode.Uri.parse(element.decorationUri)
                : uri;

            if (element.kind === 'file') {
                item.command = {
                    command: 'vscode.open',
                    title: 'Open',
                    arguments: [uri]
                };
            }
        }

        // A nested file is collapsible. VS Code otherwise renders a collapsible
        // resourceUri like a folder, so force a file icon for nested file parents.
        if (element.kind === 'file' && hasChildren) {
            item.iconPath = vscode.ThemeIcon.File;
        }

        // Empty folders have no children and therefore a non-collapsible TreeItem.
        // With only resourceUri VS Code then treats them like files for icon-theme
        // resolution. ThemeIcon.Folder keeps the active file-icon-theme folder icon
        // without adding a fake expand arrow to an actually empty directory.
        if (element.kind === 'folder' && !hasChildren) {
            item.iconPath = vscode.ThemeIcon.Folder;
        }

        // AOH-specific structural nodes use the extension's own icons.
        // Regular files and folders continue to use the active VS Code file icon theme.
        switch (element.kind) {
            case 'solution':
                item.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', 'solution.svg'));
                break;
            case 'project': {
                const projectExtension = element.uri
                    ? path.extname(vscode.Uri.parse(element.uri).fsPath).toLowerCase()
                    : '';

                const projectIcon = projectExtension === '.vbproj'
                    ? 'vbnet-project.svg'
                    : 'csharp-project.svg';

                item.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', projectIcon));
                break;
            }
            case 'solutionFolder':
                item.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', 'solution-folder.svg'));
                break;
            case 'dependencies':
                item.iconPath = vscode.Uri.file(path.join(__dirname, '..', 'media', 'dependencies.svg'));
                break;
            case 'dependencyGroup':
                item.iconPath = element.label === 'Packages'
                    ? new vscode.ThemeIcon('package')
                    : new vscode.ThemeIcon('references');
                break;
            case 'properties':
                item.iconPath = new vscode.ThemeIcon('symbol-property');
                break;
            case 'dependency':
                item.iconPath = element.description === 'project'
                    ? new vscode.ThemeIcon('references')
                    : new vscode.ThemeIcon('package');
                break;
        }

        return item;
    }

    async getChildren(element?: WebNode): Promise<WebNode[]> {
        if (element) {
            return element.children ?? [];
        }

        return this.ensureRoots();
    }

    async createSolution(): Promise<void> {
        await this.contextMenuService.createSolution();
    }

    async runAction(action: string, element?: WebNode, selectedElements: WebNode[] = []): Promise<void> {
        if (!element?.uri || !allowsNodeAction(action, element.kind)) return;

        const collectUris = (node: WebNode): string[] => {
            const result: string[] = [];
            if (node.uri && node.kind !== 'solutionFolder' && node.kind !== 'solution') result.push(node.uri);
            for (const child of node.children ?? []) result.push(...collectUris(child));
            return [...new Set(result)];
        };

        const multiTargetActions = new Set([
            'copy', 'cut', 'duplicate',
            'copyPath', 'copyRelativePath', 'copyPathSolution', 'copyPathWorkspace', 'copyPathFull',
            'gitTrack', 'gitUntrack', 'gitStage', 'gitUnstage', 'gitRollback',
            'delete'
        ]);

        if (multiTargetActions.has(action) &&
            !allowsNodeSelection(action, selectedElements.map(node => node.kind))) return;

        const canUseMultiSelection = multiTargetActions.has(action) && selectedElements.length > 1 &&
            (action !== 'delete' || selectedElements.every(node => node.kind === 'file' || node.kind === 'folder'));
        const selected = canUseMultiSelection ? selectedElements : [element];

        const targetUris = [...new Set(selected.flatMap(node =>
            node.kind === 'solutionFolder' ? collectUris(node) : (node.uri ? [node.uri] : [])
        ))];

        await this.contextMenuService.handleAction({
            action,
            uri: element.uri,
            kind: element.kind,
            solutionFolderPath: element.solutionFolderPath,
            solutionUri: element.solutionUri,
            targetUris
        });
    }


    getViewTitle(): string {
        if (this.parsedSolutions.length === 1) return this.parsedSolutions[0].name;
        if (this.parsedSolutions.length > 1) return 'Solutions';
        return 'Solution';
    }

    getState(): AohSolutionState {
        const activeProject = this.getActiveProject();
        const solution = this.getCurrentSolution(activeProject);

        return {
            solution: solution ? this.toApiSolution(solution) : undefined,
            activeProject
        };
    }

    getActiveProject(): AohProjectInfo | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') return undefined;
        return this.getProjectForFile(editor.document.uri);
    }

    getProjectForFile(file: vscode.Uri): AohProjectInfo | undefined {
        if (file.scheme !== 'file') return undefined;

        const filePath = this.normalizeFsPath(file.fsPath);
        let bestMatch: { project: ParsedProject; rootLength: number } | undefined;

        for (const solution of this.parsedSolutions) {
            for (const project of solution.projects) {
                const root = this.normalizeFsPath(project.projectRoot.fsPath);
                const relative = path.relative(root, filePath);
                const inside = relative === '' || (
                    relative !== '..' &&
                    !relative.startsWith(`..${path.sep}`) &&
                    !path.isAbsolute(relative)
                );

                if (!inside) continue;

                if (!bestMatch || root.length > bestMatch.rootLength) {
                    bestMatch = { project, rootLength: root.length };
                }
            }
        }

        return bestMatch ? this.toApiProject(bestMatch.project) : undefined;
    }

    private getCurrentSolution(activeProject?: AohProjectInfo): ParsedSolution | undefined {
        if (!this.parsedSolutions.length) return undefined;

        if (activeProject) {
            const projectPath = this.normalizeFsPath(activeProject.uri.fsPath);
            const matching = this.parsedSolutions.find(solution =>
                solution.projects.some(project =>
                    this.normalizeFsPath(project.projectUri.fsPath) === projectPath
                )
            );
            if (matching) return matching;
        }

        return this.parsedSolutions[0];
    }

    private toApiSolution(solution: ParsedSolution): AohSolutionInfo {
        return {
            name: solution.name,
            uri: solution.uri,
            directory: vscode.Uri.file(path.dirname(solution.uri.fsPath)),
            format: solution.uri.fsPath.toLowerCase().endsWith('.slnx') ? 'slnx' : 'sln',
            projects: solution.projects.map(project => this.toApiProject(project)),
            solutionFolders: solution.folders.map(folder => ({ path: [...folder.path] }))
        };
    }

    private toApiProject(project: ParsedProject): AohProjectInfo {
        const extension = path.extname(project.projectUri.fsPath).toLowerCase();
        const language = extension === '.csproj'
            ? 'csharp'
            : extension === '.fsproj'
                ? 'fsharp'
                : extension === '.vbproj'
                    ? 'vb'
                    : 'unknown';

        return {
            name: project.name,
            uri: project.projectUri,
            directory: project.projectRoot,
            language,
            solutionFolder: project.solutionFolderPath?.join('/') || undefined
        };
    }

    private async buildRoots(): Promise<WebNode[]> {
        const solutions = await this.findSolutions();
        this.parsedSolutions = solutions;

        if (!solutions.length) {
            return [{
                id: 'no-solution',
                kind: 'solution',
                label: 'Create New Solution...'
            }];
        }

        return Promise.all(solutions.map(async solution => ({
            id: `solution:${solution.uri.toString()}`,
            kind: 'solution' as NodeKind,
            label: `${solution.name} · ${solution.projects.length} project${solution.projects.length === 1 ? '' : 's'}`,
            uri: solution.uri.toString(),
            expanded: true,
            children: await this.getSolutionChildren(solution),
            gitState: this.gitStatusService.getState(solution.uri.fsPath)
        })));
    }

    private async getSolutionChildren(solution: ParsedSolution): Promise<WebNode[]> {
        const topFolders = new Set<string>();
        const directProjects: ParsedProject[] = [];

        for (const folder of solution.folders) {
            if (folder.path.length) topFolders.add(folder.path[0]);
        }

        for (const project of solution.projects) {
            if (project.solutionFolderPath?.length) {
                topFolders.add(project.solutionFolderPath[0]);
            } else {
                directProjects.push(project);
            }
        }

        const folderNodes = await Promise.all(
            [...topFolders]
                .sort((a, b) => a.localeCompare(b))
                .map(name => this.makeSolutionFolderNode(solution, [name]))
        );

        const projectNodes = await Promise.all(
            directProjects
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(project => this.makeProjectNode(project, solution.uri))
        );

        return [...folderNodes, ...projectNodes];
    }

    private async makeSolutionFolderNode(solution: ParsedSolution, folderPath: string[]): Promise<WebNode> {
        const childFolderNames = new Set<string>();
        const projects: ParsedProject[] = [];
        const solutionItems: vscode.Uri[] = [];

        for (const folder of solution.folders) {
            const matchesPrefix = folderPath.every((part, i) => folder.path[i] === part);
            if (!matchesPrefix) continue;

            if (folder.path.length === folderPath.length) {
                solutionItems.push(...folder.items);
            } else if (folder.path.length > folderPath.length) {
                childFolderNames.add(folder.path[folderPath.length]);
            }
        }

        for (const project of solution.projects) {
            const projectPath = project.solutionFolderPath ?? [];
            const matchesPrefix = folderPath.every((part, i) => projectPath[i] === part);
            if (!matchesPrefix) continue;

            if (projectPath.length === folderPath.length) {
                projects.push(project);
            } else if (projectPath.length > folderPath.length) {
                childFolderNames.add(projectPath[folderPath.length]);
            }
        }

        const folderNodes = await Promise.all(
            [...childFolderNames]
                .sort((a, b) => a.localeCompare(b))
                .map(name => this.makeSolutionFolderNode(solution, [...folderPath, name]))
        );

        const projectNodes = await Promise.all(
            projects
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(project => this.makeProjectNode(project, solution.uri))
        );

        const itemNodes = solutionItems
            .sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)))
            .map(uri => this.makeFileNode(uri));

        return {
            id: `solution-folder:${solution.uri.toString()}:${folderPath.join('/')}`,
            kind: 'solutionFolder',
            label: folderPath[folderPath.length - 1],
            uri: solution.uri.toString(),
            solutionFolderPath: [...folderPath],
            children: [...folderNodes, ...projectNodes, ...itemNodes]
        };
    }

    private async makeProjectNode(project: ParsedProject, solutionUri: vscode.Uri): Promise<WebNode> {
        const children: WebNode[] = [];

        const dependencies = await this.getDependencies(project.projectRoot);
        const projectDependencies = dependencies.filter(item => item.description === 'project');
        const packageDependencies = dependencies.filter(item => item.description !== 'project');

        const dependencyGroups: WebNode[] = [];

        if (projectDependencies.length) {
            dependencyGroups.push({
                id: `dependency-group:projects:${project.projectUri.toString()}`,
                kind: 'dependencyGroup',
                label: 'Projects',
                children: projectDependencies
            });
        }

        if (packageDependencies.length) {
            dependencyGroups.push({
                id: `dependency-group:packages:${project.projectUri.toString()}`,
                kind: 'dependencyGroup',
                label: 'Packages',
                children: packageDependencies
            });
        }

        children.push({
            id: `dependencies:${project.projectUri.toString()}`,
            kind: 'dependencies',
            label: 'Dependencies',
            uri: project.projectUri.toString(),
            solutionUri: solutionUri.toString(),
            children: dependencyGroups
        });

        const properties = await this.getProperties(project.projectRoot);
        if (properties.length) {
            children.push({
                id: `properties:${project.projectUri.toString()}`,
                kind: 'properties',
                label: 'Properties',
                children: properties
            });
        }

        const fsItems = await this.readDirectory(project.projectRoot, name => {
            const lower = name.toLowerCase();
            return lower !== 'properties' && !this.isHiddenInfrastructure(lower);
        }, project.projectRoot);

        // Intentionally keep the .csproj/.fsproj/.vbproj file visible.
        children.push(...fsItems);

        return {
            id: `project:${project.projectUri.toString()}`,
            kind: 'project',
            label: project.name,
            uri: project.projectUri.toString(),
            solutionUri: solutionUri.toString(),
            children,
            gitState: this.gitStatusService.getStrongestUnder(project.projectRoot.fsPath)
        };
    }

    private async getProperties(projectRoot: vscode.Uri): Promise<WebNode[]> {
        const properties = vscode.Uri.joinPath(projectRoot, 'Properties');

        try {
            const stat = await vscode.workspace.fs.stat(properties);
            if ((stat.type & vscode.FileType.Directory) === 0) return [];
            return this.readDirectory(properties, undefined, projectRoot);
        } catch {
            return [];
        }
    }

    private async getDependencies(projectRoot: vscode.Uri): Promise<WebNode[]> {
        const projectFile = await this.findProjectFile(projectRoot);
        if (!projectFile) return [];

        try {
            const text = Buffer.from(await this.fileReads.get(projectFile.toString())).toString('utf8');
            const refs: DependencyRef[] = [];

            for (const match of text.matchAll(/<PackageReference\b([^>]*)>/g)) {
                const attrs = match[1];
                const name = /\bInclude="([^"]+)"/i.exec(attrs)?.[1];
                if (!name) continue;

                let version = /\bVersion="([^"]+)"/i.exec(attrs)?.[1];

                if (!version) {
                    const remainder = text.slice(match.index ?? 0);
                    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const closing = remainder.match(new RegExp(
                        '^<PackageReference\\b[^>]*\\bInclude="' +
                        escapedName +
                        '"[^>]*>([\\s\\S]*?)<\\/PackageReference>',
                        'i'
                    ));
                    version = closing?.[1].match(/<Version>([^<]+)<\/Version>/i)?.[1]?.trim();
                }

                refs.push({ name, kind: 'package', version });
            }

            for (const match of text.matchAll(/<ProjectReference\b[^>]*\bInclude="([^"]+)"/g)) {
                const normalized = match[1].replace(/\\/g, '/');
                const fileName = normalized.split('/').filter(Boolean).pop() ?? normalized;
                refs.push({
                    name: fileName.replace(/\.(csproj|fsproj|vbproj)$/i, ''),
                    kind: 'project'
                });
            }

            const sortProjectsBeforePackages = vscode.workspace
                .getConfiguration('aoh.solutionExplorer.dependencies')
                .get<boolean>('sortProjectsBeforePackages', true);

            refs.sort((a, b) => {
                if (sortProjectsBeforePackages && a.kind !== b.kind) {
                    return a.kind === 'project' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            return refs.map((ref, index) => ({
                id: `dependency:${projectFile.toString()}:${ref.kind}:${index}:${ref.name}`,
                kind: 'dependency',
                label: ref.name,
                description: ref.kind === 'project' ? 'project' : (ref.version ?? '')
            }));
        } catch {
            return [];
        }
    }

    private async readDirectory(
        uri: vscode.Uri,
        include: ((name: string) => boolean) | undefined = name => !this.isHiddenInfrastructure(name),
        rootUri: vscode.Uri = uri
    ): Promise<WebNode[]> {
        try {
            const entries = await this.directoryReads.get(uri.toString());
            const folders: WebNode[] = [];
            const files: WebNode[] = [];

            await Promise.all(entries.map(async ([name, type]) => {
                if (include && !include(name)) return;
                if (this.isHiddenInfrastructure(name)) return;

                const childUri = vscode.Uri.joinPath(uri, name);
                const relativePath = path.relative(rootUri.fsPath, childUri.fsPath).replace(/\\/g, '/');
                if (!this.showExcludedFiles && this.isExcluded(relativePath, name)) return;

                if (type === vscode.FileType.Directory) {
                    folders.push({
                        id: `folder:${childUri.toString()}`,
                        kind: 'folder',
                        label: name,
                        uri: childUri.toString(),
                        gitState: this.gitStatusService.getStrongestUnder(childUri.fsPath),
                        children: await this.readDirectory(childUri, undefined, rootUri)
                    });
                } else if (type === vscode.FileType.File) {
                    files.push(this.makeFileNode(childUri));
                }
            }));

            folders.sort((a, b) => a.label.localeCompare(b.label));
            files.sort((a, b) => a.label.localeCompare(b.label));

            const nestedFiles = this.applyFileNesting(uri, files);
            return [...folders, ...nestedFiles];
        } catch {
            return [];
        }
    }

    private applyFileNesting(directoryUri: vscode.Uri, files: WebNode[]): WebNode[] {
        const configuration = vscode.workspace.getConfiguration('explorer.fileNesting', directoryUri);
        const enabled = configuration.get<boolean>('enabled', false);

        if (!enabled || files.length < 2) {
            return files;
        }

        const patterns = configuration.get<Record<string, string>>('patterns', {});
        const expand = configuration.get<boolean>('expand', true);
        const entries = Object.entries(patterns).map(([pattern, children]) =>
            [pattern, children.split(',').map(child => child.trim()).filter(Boolean)] as const);

        if (!entries.length) {
            return files;
        }

        const candidates = new FileNestingCandidates(files);
        const byName = new Map(files.map(file => [file.label, file]));
        const parentFor = new Map<string, string>();

        for (const parent of files) {
            for (const [parentPattern, childPatterns] of entries) {
                const capture = this.matchFileNestingParent(parent.label, parentPattern);
                if (capture === undefined) continue;

                for (const childPattern of childPatterns) {
                    const resolvedPattern = this.resolveFileNestingChildPattern(
                        childPattern,
                        parent.label,
                        directoryUri,
                        capture
                    );

                    for (const child of candidates.get(resolvedPattern)) {
                        if (child.id === parent.id || parentFor.has(child.label)) continue;
                        if (!this.matchesFileNestingPattern(child.label, resolvedPattern)) continue;
                        if (this.wouldCreateFileNestingCycle(parent.label, child.label, parentFor)) continue;

                        parentFor.set(child.label, parent.label);
                    }
                }
            }
        }

        for (const [childName, parentName] of parentFor) {
            const child = byName.get(childName);
            const parent = byName.get(parentName);
            if (!child || !parent) continue;

            parent.children ??= [];
            parent.children.push(child);
            parent.expanded = expand;
        }

        for (const file of files) {
            file.children?.sort((a, b) => a.label.localeCompare(b.label));
        }

        return files.filter(file => !parentFor.has(file.label));
    }

    private matchFileNestingParent(fileName: string, pattern: string): string | undefined {
        const starIndex = pattern.indexOf('*');

        if (starIndex < 0) {
            return this.fileNestingEquals(fileName, pattern) ? '' : undefined;
        }

        const prefix = pattern.slice(0, starIndex);
        const suffix = pattern.slice(starIndex + 1);

        if (!this.fileNestingStartsWith(fileName, prefix) ||
            !this.fileNestingEndsWith(fileName, suffix) ||
            fileName.length < prefix.length + suffix.length) {
            return undefined;
        }

        return fileName.slice(prefix.length, fileName.length - suffix.length);
    }

    private resolveFileNestingChildPattern(
        pattern: string,
        parentFileName: string,
        directoryUri: vscode.Uri,
        capture: string
    ): string {
        const extensionWithDot = path.extname(parentFileName);
        const extname = extensionWithDot.startsWith('.') ? extensionWithDot.slice(1) : extensionWithDot;
        const basename = extensionWithDot
            ? parentFileName.slice(0, -extensionWithDot.length)
            : parentFileName;
        const dirname = path.basename(directoryUri.fsPath);

        return pattern
            .replaceAll('${capture}', capture)
            .replaceAll('${basename}', basename)
            .replaceAll('${extname}', extname)
            .replaceAll('${dirname}', dirname);
    }

    private matchesFileNestingPattern(fileName: string, pattern: string): boolean {
        const starIndex = pattern.indexOf('*');

        if (starIndex < 0) {
            return this.fileNestingEquals(fileName, pattern);
        }

        const prefix = pattern.slice(0, starIndex);
        const suffix = pattern.slice(starIndex + 1);

        return this.fileNestingStartsWith(fileName, prefix) &&
            this.fileNestingEndsWith(fileName, suffix) &&
            fileName.length >= prefix.length + suffix.length;
    }

    private wouldCreateFileNestingCycle(
        parentName: string,
        childName: string,
        parentFor: Map<string, string>
    ): boolean {
        let current: string | undefined = parentName;
        const visited = new Set<string>();

        while (current && !visited.has(current)) {
            if (current === childName) return true;
            visited.add(current);
            current = parentFor.get(current);
        }

        return false;
    }

    private fileNestingEquals(left: string, right: string): boolean {
        return process.platform === 'linux'
            ? left === right
            : left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
    }

    private fileNestingStartsWith(value: string, prefix: string): boolean {
        if (process.platform === 'linux') return value.startsWith(prefix);
        return value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());
    }

    private fileNestingEndsWith(value: string, suffix: string): boolean {
        if (process.platform === 'linux') return value.endsWith(suffix);
        return value.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase());
    }

    private makeFileNode(uri: vscode.Uri): WebNode {
        return {
            id: `file:${uri.toString()}`,
            kind: 'file',
            label: path.basename(uri.fsPath),
            uri: uri.toString(),
            gitState: this.gitStatusService.getState(uri.fsPath),
            ...this.toDiagnosticFields(this.diagnosticService.get(uri))
        };
    }


    private resetNodeState(roots: WebNode[]): void {
        const visit = (node: WebNode): void => {
            node.gitState = undefined;
            node.errorCount = 0;
            node.warningCount = 0;
            node.diagnosticState = undefined;

            if (node.uri) {
                const uri = vscode.Uri.parse(node.uri);

                switch (node.kind) {
                    case 'file':
                        node.gitState = this.gitStatusService.getState(uri.fsPath);
                        Object.assign(node, this.toDiagnosticFields(this.diagnosticService.get(uri)));
                        break;
                    case 'folder':
                        node.gitState = this.gitStatusService.getStrongestUnder(uri.fsPath);
                        break;
                    case 'project':
                        node.gitState = this.gitStatusService.getStrongestUnder(path.dirname(uri.fsPath));
                        break;
                    case 'solution':
                        node.gitState = this.gitStatusService.getState(uri.fsPath);
                        break;
                }
            }

            for (const child of node.children ?? []) visit(child);
        };

        for (const root of roots) visit(root);
    }

    private applyAggregatedState(roots: WebNode[]): void {
        const visit = (node: WebNode): { gitState?: GitFileState; errors: number } => {
            let gitState = node.gitState;
            let errors = node.errorCount ?? 0;

            for (const child of node.children ?? []) {
                const childState = visit(child);
                gitState = this.strongerGitState(gitState, childState.gitState);
                errors += childState.errors;
            }

            node.gitState = gitState;
            node.errorCount = errors;
            node.warningCount = 0;
            node.diagnosticState = errors > 0 ? 'error' : undefined;
            node.decorationUri ??= this.createDecorationUri(node);

            return { gitState, errors };
        };

        for (const root of roots) visit(root);
    }

    private strongerGitState(left?: GitFileState, right?: GitFileState): GitFileState | undefined {
        if (left === 'deleted') left = undefined;
        if (right === 'deleted') right = undefined;
        if (!left) return right;
        if (!right) return left;
        return this.gitPriority(right) > this.gitPriority(left) ? right : left;
    }

    private gitPriority(state: GitFileState): number {
        switch (state) {
            case 'conflict': return 5;
            case 'deleted': return 0;
            case 'modified': return 3;
            case 'renamed': return 2;
            case 'added': return 1;
        }
    }

    private toDiagnosticFields(summary?: { errors: number; warnings: number }): Partial<WebNode> {
        if (!summary) return {};
        return {
            errorCount: summary.errors,
            warningCount: 0,
            diagnosticState: summary.errors > 0 ? 'error' : undefined
        };
    }

    private createDecorationUri(node: WebNode): string {
        // Every tree node needs its own decoration resource. Multiple structural
        // nodes can legitimately point at the same backing file (for example a
        // project and its Dependencies node both use the .csproj URI). If they
        // share the same decoration URI, the later node overwrites the former in
        // ExplorerDecorationService and parent diagnostics appear to vanish.
        //
        // Keep the original path where possible so file icon themes can still
        // infer the extension, but add the node id as a unique query component.
        if (node.uri) {
            const uri = vscode.Uri.parse(node.uri);
            return uri.with({
                scheme: 'aoh-solution-explorer',
                query: `node=${encodeURIComponent(node.id)}`
            }).toString();
        }

        return vscode.Uri.from({
            scheme: 'aoh-solution-explorer',
            path: '/' + encodeURIComponent(node.id),
            query: `node=${encodeURIComponent(node.id)}`
        }).toString();
    }

    private async findProjectFile(root: vscode.Uri): Promise<vscode.Uri | undefined> {
        try {
            const entries = await this.directoryReads.get(root.toString());
            const project = entries.find(([name, type]: [string, vscode.FileType]) =>
                type === vscode.FileType.File &&
                /\.(csproj|fsproj|vbproj)$/i.test(name)
            );
            return project ? vscode.Uri.joinPath(root, project[0]) : undefined;
        } catch {
            return undefined;
        }
    }

    private async findSolutions(): Promise<ParsedSolution[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const solutionUris: vscode.Uri[] = [];

        for (const folder of workspaceFolders) {
            const matches = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.{sln,slnx}'),
                '**/{bin,obj,.git,.vs,.idea,node_modules}/**',
                50
            );
            solutionUris.push(...matches);
        }

        const unique = [...new Map(solutionUris.map(uri => [uri.fsPath, uri])).values()]
            .sort((a, b) => a.fsPath.localeCompare(b.fsPath));

        const parsed: ParsedSolution[] = [];
        for (const uri of unique) {
            const solution = uri.fsPath.toLowerCase().endsWith('.slnx')
                ? await this.parseSlnx(uri)
                : await this.parseSln(uri);

            if (solution) parsed.push(solution);
        }

        return parsed;
    }

    private async parseSln(uri: vscode.Uri): Promise<ParsedSolution | undefined> {
        try {
            const text = Buffer.from(await this.fileReads.get(uri.toString())).toString('utf8');
            const solutionDir = path.dirname(uri.fsPath);
            const solutionName = path.basename(uri.fsPath, '.sln');

            const projectsByGuid = new Map<string, ParsedProject>();
            const folderNamesByGuid = new Map<string, string>();
            const folderItemsByGuid = new Map<string, vscode.Uri[]>();
            const nested = new Map<string, string>();

            const projectRegex = /^Project\("\{[^}]+\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([^}]+)\}"/gm;
            for (const match of text.matchAll(projectRegex)) {
                const name = match[1];
                const relPath = match[2].replace(/\\/g, path.sep);
                const guid = match[3].toUpperCase();

                if (/\.(csproj|fsproj|vbproj)$/i.test(relPath)) {
                    const projectPath = path.resolve(solutionDir, relPath);
                    projectsByGuid.set(guid, {
                        name,
                        projectUri: vscode.Uri.file(projectPath),
                        projectRoot: vscode.Uri.file(path.dirname(projectPath))
                    });
                } else {
                    folderNamesByGuid.set(guid, name);
                }
            }

            const projectBlockRegex = /Project\("\{[^}]+\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([^}]+)\}"([\s\S]*?)EndProject/g;
            for (const match of text.matchAll(projectBlockRegex)) {
                const guid = match[3].toUpperCase();
                if (!folderNamesByGuid.has(guid)) continue;

                const section = match[4].match(
                    /ProjectSection\(SolutionItems\)\s*=\s*preProject([\s\S]*?)EndProjectSection/
                );
                if (!section) continue;

                const items: vscode.Uri[] = [];
                for (const line of section[1].split(/\r?\n/)) {
                    const eq = line.indexOf('=');
                    if (eq < 0) continue;

                    const raw = line.slice(0, eq).trim();
                    if (!raw) continue;

                    items.push(vscode.Uri.file(path.resolve(
                        solutionDir,
                        raw.replace(/\\/g, path.sep)
                    )));
                }
                folderItemsByGuid.set(guid, items);
            }

            const nestedSection = text.match(
                /GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/
            );
            if (nestedSection) {
                for (const match of nestedSection[1].matchAll(/\{([^}]+)\}\s*=\s*\{([^}]+)\}/g)) {
                    nested.set(match[1].toUpperCase(), match[2].toUpperCase());
                }
            }

            const buildParentFolderPath = (guid: string): string[] => {
                const result: string[] = [];
                let parent = nested.get(guid);
                const guard = new Set<string>();

                while (parent && !guard.has(parent)) {
                    guard.add(parent);
                    const rawName = folderNamesByGuid.get(parent);
                    if (rawName) {
                        const segments = this.normalizeSolutionFolderName(rawName);
                        result.unshift(...segments);
                    }
                    parent = nested.get(parent);
                }

                return result;
            };

            const projects = [...projectsByGuid.entries()].map(([guid, project]) => ({
                ...project,
                solutionFolderPath: buildParentFolderPath(guid)
            }));

            const folders: ParsedSolutionFolder[] = [...folderNamesByGuid.entries()].map(([guid, rawName]) => ({
                path: [...buildParentFolderPath(guid), ...this.normalizeSolutionFolderName(rawName)],
                items: folderItemsByGuid.get(guid) ?? []
            }));

            return { name: solutionName, uri, projects, folders };
        } catch {
            return undefined;
        }
    }

    private async parseSlnx(uri: vscode.Uri): Promise<ParsedSolution | undefined> {
        try {
            const text = Buffer.from(await this.fileReads.get(uri.toString())).toString('utf8');
            const solutionDir = path.dirname(uri.fsPath);
            const solutionName = path.basename(uri.fsPath, '.slnx');
            const projects: ParsedProject[] = [];
            const folders: ParsedSolutionFolder[] = [];

            const tokenRegex = /<\/?Folder\b[^>]*>|<Project\b[^>]*\/?>|<File\b[^>]*\/?>/gi;
            const folderStack: string[] = [];
            const folderDepths: number[] = [];

            const currentFolder = (): ParsedSolutionFolder | undefined =>
                folders.find(folder =>
                    folder.path.length === folderStack.length &&
                    folder.path.every((part, index) => part === folderStack[index])
                );

            for (const tokenMatch of text.matchAll(tokenRegex)) {
                const token = tokenMatch[0];

                if (/^<\/Folder/i.test(token)) {
                    const count = folderDepths.pop() ?? 1;
                    folderStack.splice(Math.max(0, folderStack.length - count), count);
                    continue;
                }

                if (/^<Folder\b/i.test(token)) {
                    const name = /\bName="([^"]+)"/i.exec(token)?.[1];
                    const selfClosing = /\/\s*>$/.test(token);

                    if (!name) {
                        if (!selfClosing) folderDepths.push(0);
                        continue;
                    }

                    const segments = this.normalizeSolutionFolderName(name);
                    const absolute = /^[\\/]/.test(name);
                    const nextPath = absolute ? [...segments] : [...folderStack, ...segments];

                    if (segments.length) {
                        // Keep every declared folder, even when it has no children/items.
                        if (!folders.some(folder =>
                            folder.path.length === nextPath.length &&
                            folder.path.every((part, index) => part === nextPath[index])
                        )) {
                            folders.push({ path: nextPath, items: [] });
                        }
                    }

                    if (!selfClosing) {
                        const previousLength = folderStack.length;
                        folderStack.splice(0, folderStack.length, ...nextPath);
                        folderDepths.push(folderStack.length - previousLength);
                    }

                    continue;
                }

                if (/^<File\b/i.test(token)) {
                    const relPath = /\bPath="([^"]+)"/i.exec(token)?.[1];
                    if (!relPath || !folderStack.length) continue;

                    currentFolder()?.items.push(vscode.Uri.file(path.resolve(
                        solutionDir,
                        relPath.replace(/\\/g, path.sep)
                    )));
                    continue;
                }

                if (/^<Project\b/i.test(token)) {
                    const relPath = /\bPath="([^"]+)"/i.exec(token)?.[1];
                    if (!relPath) continue;

                    const normalized = relPath.replace(/\\/g, path.sep);
                    if (!/\.(csproj|fsproj|vbproj)$/i.test(normalized)) continue;

                    const projectPath = path.resolve(solutionDir, normalized);
                    const explicitName = /\bName="([^"]+)"/i.exec(token)?.[1];

                    projects.push({
                        name: explicitName ?? path.basename(projectPath, path.extname(projectPath)),
                        projectUri: vscode.Uri.file(projectPath),
                        projectRoot: vscode.Uri.file(path.dirname(projectPath)),
                        solutionFolderPath: [...folderStack]
                    });
                }
            }

            return { name: solutionName, uri, projects, folders };
        } catch {
            return undefined;
        }
    }

    private normalizeSolutionFolderName(name: string): string[] {
        return name
            .replace(/\\/g, '/')
            .split('/')
            .map(part => part.trim())
            .filter(Boolean);
    }



















    private isHiddenInfrastructure(name: string): boolean {
        return ['.git', '.vs', '.idea', 'node_modules']
            .includes(name.toLowerCase());
    }

}

export async function activate(context: vscode.ExtensionContext): Promise<AohSolutionExplorerApi> {
    const output = bootstrapOutput;
    context.subscriptions.push(output);

    const log = (message: string, error?: unknown): void => {
        const stamp = new Date().toISOString();
        output.appendLine(`[${stamp}] ${message}`);
        if (error !== undefined) {
            output.appendLine(error instanceof Error ? (error.stack ?? error.message) : String(error));
        }
    };

    log(`activate() started. Extension version: ${context.extension.packageJSON.version}`);
    log(`VS Code: ${vscode.version}; extensionPath: ${context.extensionPath}`);

    let provider: SolutionExplorerTreeDataProvider | undefined;
    let tree: vscode.TreeView<WebNode> | undefined;
    const getColorMode = (): ExplorerColorMode =>
        vscode.workspace.getConfiguration('aoh.solutionExplorer').get<ExplorerColorMode>('colorMode', 'both');
    const getGitAutoRefresh = (): boolean =>
        vscode.workspace.getConfiguration('aoh.solutionExplorer').get<boolean>('git.autoRefresh', true);
    const getGitRefreshDelay = (): number =>
        vscode.workspace.getConfiguration('aoh.solutionExplorer').get<number>('git.refreshDelay', 150);

    const decorationService = new ExplorerDecorationService(getColorMode());
    const followEditorStateKey = 'aoh.solutionExplorer.followEditor';
    let followEditor = context.workspaceState.get<boolean>(followEditorStateKey, false);
    let showExcludedFiles = false;
    const apiStateChanged = new vscode.EventEmitter<AohSolutionState>();
    context.subscriptions.push(apiStateChanged);

    const getProvider = (): SolutionExplorerTreeDataProvider => {
        if (!provider) throw new Error('AOH Solution Explorer is not initialized.');
        return provider;
    };

    const updateFollowContext = async (): Promise<void> => {
        await vscode.commands.executeCommand('setContext', 'aoh.solutionExplorer.followEditor', followEditor);
    };

    const updateExcludedFilesContext = async (): Promise<void> => {
        await vscode.commands.executeCommand('setContext', 'aoh.solutionExplorer.showExcludedFiles', showExcludedFiles);
    };

    const selectCurrentFile = async (): Promise<void> => {
        if (!provider || !tree) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') return;
        const node = await provider.findFile(editor.document.uri);
        if (!node) return;
        await tree.reveal(node, { select: true, focus: false, expand: true });
    };

    const setFollowEditor = async (enabled: boolean): Promise<void> => {
        followEditor = enabled;
        await context.workspaceState.update(followEditorStateKey, enabled);
        await updateFollowContext();
        if (enabled) await selectCurrentFile();
    };

    const register = (command: string, handler: (...args: any[]) => any): void => {
        try {
            context.subscriptions.push(vscode.commands.registerCommand(command, handler));
            log(`Registered command: ${command}`);
        } catch (error) {
            log(`FAILED to register command: ${command}`, error);
        }
    };

    const registerAction = (command: string, actionName: string): void => {
        register(command, async (node?: WebNode) => {
            log(`Command invoked: ${command} -> ${actionName}`);
            try {
                const activeProvider = getProvider();
                const selected = node ?? tree?.selection?.[0];
                if (!selected) return;

                const currentSelection = tree?.selection ?? [];
                const selectedNodes = currentSelection.length > 1 && currentSelection.some((item: WebNode) => item.id === selected.id)
                    ? [...currentSelection]
                    : [selected];

                return await activeProvider.runAction(actionName, selected, selectedNodes);
            } catch (error) {
                log(`Command failed: ${command}`, error);
                output.show(true);
                vscode.window.showErrorMessage(`AOH command '${command}' failed. See Output > AOH Solution Explorer.`);
                throw error;
            }
        });
    };

    register('aoh.solutionExplorer.showOutput', () => output.show(true));
    register('aoh.solutionExplorer.refresh', async () => {
        if (!provider) return;
        await provider.refresh();
        if (followEditor) await selectCurrentFile();
    });
    register('aoh.solutionExplorer.createSolution', () => getProvider().createSolution());
    register('aoh.solutionExplorer.selectCurrentFile', selectCurrentFile);
    register('aoh.solutionExplorer.enableFollowEditor', () => setFollowEditor(true));
    register('aoh.solutionExplorer.disableFollowEditor', () => setFollowEditor(false));
    register('aoh.solutionExplorer.showExcludedFiles', async () => {
        showExcludedFiles = true;
        await updateExcludedFilesContext();
        await getProvider().setShowExcludedFiles(true);
    });
    register('aoh.solutionExplorer.hideExcludedFiles', async () => {
        showExcludedFiles = false;
        await updateExcludedFilesContext();
        await getProvider().setShowExcludedFiles(false);
    });

    for (const [command, actionName] of [
        ['aoh.solutionExplorer.newProject', 'newProject'],
        ['aoh.solutionExplorer.newSolutionFolder', 'newSolutionFolder'],
        ['aoh.solutionExplorer.addExistingProject', 'addExistingProject'],
        ['aoh.solutionExplorer.addExistingItem', 'addExistingItem'],
        ['aoh.solutionExplorer.newFile', 'newFile'],
        ['aoh.solutionExplorer.newFolder', 'newFolder'],
        ['aoh.solutionExplorer.newDotNetFile', 'newDotNetFile'],
        ['aoh.solutionExplorer.addProjectReference', 'addProjectReference'],
        ['aoh.solutionExplorer.installNugetPackage', 'installNugetPackage'],
        ['aoh.solutionExplorer.manageProjectReferences', 'manageProjectReferences'],
        ['aoh.solutionExplorer.newClass', 'newClass'],
        ['aoh.solutionExplorer.newInterface', 'newInterface'],
        ['aoh.solutionExplorer.newEnum', 'newEnum'],
        ['aoh.solutionExplorer.newStruct', 'newStruct'],
        ['aoh.solutionExplorer.newRecord', 'newRecord'],
        ['aoh.solutionExplorer.copy', 'copy'],
        ['aoh.solutionExplorer.cut', 'cut'],
        ['aoh.solutionExplorer.paste', 'paste'],
        ['aoh.solutionExplorer.duplicate', 'duplicate'],
        ['aoh.solutionExplorer.copyPathSolution', 'copyPathSolution'],
        ['aoh.solutionExplorer.copyPathWorkspace', 'copyPathWorkspace'],
        ['aoh.solutionExplorer.copyPathFull', 'copyPathFull'],
        ['aoh.solutionExplorer.gitTrack', 'gitTrack'],
        ['aoh.solutionExplorer.gitUntrack', 'gitUntrack'],
        ['aoh.solutionExplorer.gitStage', 'gitStage'],
        ['aoh.solutionExplorer.gitUnstage', 'gitUnstage'],
        ['aoh.solutionExplorer.gitRollback', 'gitRollback'],
        ['aoh.solutionExplorer.buildSolution', 'buildSolution'],
        ['aoh.solutionExplorer.rebuildSolution', 'rebuildSolution'],
        ['aoh.solutionExplorer.cleanSolution', 'cleanSolution'],
        ['aoh.solutionExplorer.buildProject', 'buildProject'],
        ['aoh.solutionExplorer.rebuildProject', 'rebuildProject'],
        ['aoh.solutionExplorer.cleanProject', 'cleanProject'],
        ['aoh.solutionExplorer.packProject', 'packProject'],
        ['aoh.solutionExplorer.publishProject', 'publishProject'],
        ['aoh.solutionExplorer.open', 'open'],
        ['aoh.solutionExplorer.openToSide', 'openToSide'],
        ['aoh.solutionExplorer.rename', 'rename'],
        ['aoh.solutionExplorer.delete', 'delete'],
        ['aoh.solutionExplorer.removeProject', 'delete'],
        ['aoh.solutionExplorer.copyPath', 'copyPath'],
        ['aoh.solutionExplorer.copyRelativePath', 'copyRelativePath'],
        ['aoh.solutionExplorer.openTerminal', 'openTerminal'],
        ['aoh.solutionExplorer.reveal', 'reveal'],
        ['aoh.solutionExplorer.findInFiles', 'findInFiles'],
        ['aoh.solutionExplorer.replaceInFiles', 'replaceInFiles']
    ] as const) registerAction(command, actionName);

    void updateFollowContext();
    void updateExcludedFilesContext();

    try {
        provider = new SolutionExplorerTreeDataProvider(log);
        await provider.refresh();
        const initialRoots = await provider.getChildren();
        decorationService.update(initialRoots);

        const dragAndDropController = new SolutionExplorerDragAndDropController(log);

        tree = vscode.window.createTreeView('aoh.solutionExplorer.view', {
            treeDataProvider: provider,
            showCollapseAll: true,
            canSelectMany: true,
            dragAndDropController
        });

        const updateTreeTitle = (): void => {
            if (tree && provider) tree.title = provider.getViewTitle();
        };
        updateTreeTitle();
        context.subscriptions.push(provider.onDidChangeSolutionState(updateTreeTitle));

        let visualRefreshTimer: ReturnType<typeof setTimeout> | undefined;
        let visualRefreshRunning = false;
        let visualRefreshPending = false;
        let gitRefreshPending = false;

        const runVisualRefresh = async (): Promise<void> => {
            if (!provider) return;

            if (visualRefreshRunning) {
                visualRefreshPending = true;
                return;
            }

            visualRefreshRunning = true;
            try {
                do {
                    visualRefreshPending = false;
                    const refreshGit = gitRefreshPending;
                    gitRefreshPending = false;
                    await provider.refreshVisualState(refreshGit);
                    const roots = await provider.getChildren();
                    decorationService.update(roots);
                } while (visualRefreshPending);
            } finally {
                visualRefreshRunning = false;
            }
        };

        const scheduleVisualRefresh = (delay: number, refreshGit = true): void => {
            gitRefreshPending ||= refreshGit;
            if (visualRefreshTimer) clearTimeout(visualRefreshTimer);
            visualRefreshTimer = setTimeout(() => {
                visualRefreshTimer = undefined;
                void runVisualRefresh();
            }, delay);
        };

        // Git operations do not necessarily touch an open document, so save/diagnostic
        // events alone are insufficient. Integrate with VS Code's built-in Git extension
        // when available and refresh only visual state after repository-state changes.
        // AOH's Git status calculation remains independent; this is only an event source.
        const gitEventSubscriptions: vscode.Disposable[] = [];
        const subscribeToGitRepository = (repository: any): void => {
            const state = repository?.state;
            if (!state?.onDidChange) return;
            gitEventSubscriptions.push(state.onDidChange(() => {
                if (getGitAutoRefresh()) scheduleVisualRefresh(getGitRefreshDelay());
            }));
        };

        const initializeGitAutoRefresh = async (): Promise<void> => {
            try {
                const gitExtension = vscode.extensions.getExtension('vscode.git');
                if (!gitExtension) {
                    log('Git auto-refresh: built-in vscode.git extension not available.');
                    return;
                }

                const gitExports: any = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
                const gitApi = gitExports?.getAPI?.(1);
                if (!gitApi) {
                    log('Git auto-refresh: vscode.git API v1 not available.');
                    return;
                }

                for (const repository of gitApi.repositories ?? []) subscribeToGitRepository(repository);
                if (gitApi.onDidOpenRepository) {
                    gitEventSubscriptions.push(gitApi.onDidOpenRepository((repository: any) => subscribeToGitRepository(repository)));
                }

                log(`Git auto-refresh: subscribed to ${(gitApi.repositories ?? []).length} repository/repositories.`);
            } catch (error) {
                log('Git auto-refresh initialization failed.', error);
            }
        };

        void initializeGitAutoRefresh();

        context.subscriptions.push({
            dispose: () => {
                if (visualRefreshTimer) clearTimeout(visualRefreshTimer);
                for (const subscription of gitEventSubscriptions.splice(0)) subscription.dispose();
            }
        });

        context.subscriptions.push(
            vscode.window.registerFileDecorationProvider(decorationService),
            provider.onDidChangeTreeData(async () => {
                const roots = await provider!.getChildren();
                decorationService.update(roots);
            }),
            provider.onDidChangeSolutionState(() => apiStateChanged.fire(provider!.getState()))
        );

        context.subscriptions.push(
            tree,
            vscode.window.onDidChangeActiveTextEditor(() => {
                if (followEditor) void selectCurrentFile();
                if (provider) apiStateChanged.fire(provider.getState());
            }),
            vscode.workspace.onDidCreateFiles(async () => { await provider!.refresh(); if (followEditor) await selectCurrentFile(); }),
            vscode.workspace.onDidDeleteFiles(() => provider!.refresh()),
            vscode.workspace.onDidRenameFiles(async () => { await provider!.refresh(); if (followEditor) await selectCurrentFile(); }),
            vscode.workspace.onDidSaveTextDocument(() => scheduleVisualRefresh(75)),
            vscode.languages.onDidChangeDiagnostics(() => scheduleVisualRefresh(125, false)),
            vscode.workspace.onDidChangeWorkspaceFolders(async () => { await provider!.refresh(); if (followEditor) await selectCurrentFile(); }),
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration('aoh.solutionExplorer.colorMode')) {
                    decorationService.setColorMode(getColorMode());
                }

                if (event.affectsConfiguration('explorer.fileNesting') ||
                    event.affectsConfiguration('aoh.solutionExplorer.exclude')) {
                    void provider!.refresh().then(() => { if (followEditor) return selectCurrentFile(); });
                }
            })
        );
        log('TreeView created successfully.');
    } catch (error) {
        log('Activation failed after command registration.', error);
        output.show(true);
        vscode.window.showErrorMessage('AOH Solution Explorer initialization failed. See Output > AOH Solution Explorer.');
    }

    const api: AohSolutionExplorerApi = {
        version: 1,
        getState: () => provider?.getState() ?? {},
        onDidChangeState: listener => apiStateChanged.event(listener),
        getActiveProject: () => provider?.getActiveProject(),
        getProjectForFile: file => provider?.getProjectForFile(file)
    };

    log('Public API v1 ready.');
    return api;
}

export function deactivate(): void {}
