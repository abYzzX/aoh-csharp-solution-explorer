import * as vscode from 'vscode';
import * as path from 'path';
import { ContextMenuService } from './contextMenuService';
import { GitStatusService } from './gitStatusService';
import { NodeKind, ParsedProject, ParsedSolutionFolder, ParsedSolution, WebNode, DependencyRef } from './types';

// Bootstrap diagnostics are created at module load so an absent channel means
// VS Code never loaded this runtime file.
const bootstrapOutput = vscode.window.createOutputChannel('AOH Solution Explorer');
bootstrapOutput.appendLine(`[bootstrap] Runtime module loaded; VS Code ${vscode.version}`);

export class SolutionExplorerTreeDataProvider implements vscode.TreeDataProvider<WebNode> {
    private readonly changed = new vscode.EventEmitter<WebNode | undefined | null | void>();
    readonly onDidChangeTreeData = this.changed.event;

    private readonly gitStatusService: GitStatusService;
    private readonly contextMenuService: ContextMenuService;
    private roots: WebNode[] | undefined;
    private readonly parentById = new Map<string, WebNode>();
    private readonly fileByPath = new Map<string, WebNode>();

    constructor(log: (message: string) => void = () => {}) {
        this.gitStatusService = new GitStatusService();
        this.contextMenuService = new ContextMenuService(async () => this.refresh(), log);
    }

    async refresh(): Promise<void> {
        await this.gitStatusService.load();
        this.roots = await this.buildRoots();
        this.rebuildIndexes();
        this.changed.fire();
    }

    async findFile(uri: vscode.Uri): Promise<WebNode | undefined> {
        await this.ensureRoots();
        return this.fileByPath.get(this.normalizeFsPath(uri.fsPath));
    }

    getParent(element: WebNode): vscode.ProviderResult<WebNode> {
        return this.parentById.get(element.id);
    }

    private async ensureRoots(): Promise<WebNode[]> {
        if (!this.roots) {
            await this.gitStatusService.load();
            this.roots = await this.buildRoots();
            this.rebuildIndexes();
        }

        return this.roots;
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
        item.description = element.description;
        item.tooltip = element.description
            ? `${element.label} ${element.description}`
            : element.label;

        if (element.uri) {
            const uri = vscode.Uri.parse(element.uri);

            // resourceUri lets VS Code apply the active file icon theme and
            // resource decorations (including SCM/Git decorations) natively.
            if (element.kind !== 'solutionFolder') {
                item.resourceUri = uri;
            }

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

    async runAction(action: string, element?: WebNode): Promise<void> {
        if (!element?.uri) return;

        const collectUris = (node: WebNode): string[] => {
            const result: string[] = [];
            if (node.uri && node.kind !== 'solutionFolder' && node.kind !== 'solution') result.push(node.uri);
            for (const child of node.children ?? []) result.push(...collectUris(child));
            return [...new Set(result)];
        };

        await this.contextMenuService.handleAction({
            action,
            uri: element.uri,
            kind: element.kind,
            solutionFolderPath: element.solutionFolderPath,
            solutionUri: element.solutionUri,
            targetUris: element.kind === 'solutionFolder' ? collectUris(element) : [element.uri]
        });
    }

    private async buildRoots(): Promise<WebNode[]> {
        const solutions = await this.findSolutions();

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
            children: await this.getSolutionChildren(solution)
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
        });

        // Intentionally keep the .csproj/.fsproj/.vbproj file visible.
        children.push(...fsItems);

        return {
            id: `project:${project.projectUri.toString()}`,
            kind: 'project',
            label: project.name,
            uri: project.projectUri.toString(),
            solutionUri: solutionUri.toString(),
            children
        };
    }

    private async getProperties(projectRoot: vscode.Uri): Promise<WebNode[]> {
        const properties = vscode.Uri.joinPath(projectRoot, 'Properties');

        try {
            const stat = await vscode.workspace.fs.stat(properties);
            if ((stat.type & vscode.FileType.Directory) === 0) return [];
            return this.readDirectory(properties);
        } catch {
            return [];
        }
    }

    private async getDependencies(projectRoot: vscode.Uri): Promise<WebNode[]> {
        const projectFile = await this.findProjectFile(projectRoot);
        if (!projectFile) return [];

        try {
            const text = Buffer.from(await vscode.workspace.fs.readFile(projectFile)).toString('utf8');
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
        include: (name: string) => boolean = name => !this.isHiddenInfrastructure(name)
    ): Promise<WebNode[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            const folders: WebNode[] = [];
            const files: WebNode[] = [];

            for (const [name, type] of entries) {
                if (!include(name)) continue;

                const childUri = vscode.Uri.joinPath(uri, name);

                if (type === vscode.FileType.Directory) {
                    folders.push({
                        id: `folder:${childUri.toString()}`,
                        kind: 'folder',
                        label: name,
                        uri: childUri.toString(),
                        children: await this.readDirectory(childUri)
                    });
                } else if (type === vscode.FileType.File) {
                    files.push(this.makeFileNode(childUri));
                }
            }

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
        const entries = Object.entries(patterns) as Array<[string, string]>;

        if (!entries.length) {
            return files;
        }

        const byName = new Map(files.map(file => [file.label, file]));
        const parentFor = new Map<string, string>();

        for (const parent of files) {
            for (const [parentPattern, childPatternsValue] of entries) {
                const capture = this.matchFileNestingParent(parent.label, parentPattern);
                if (capture === undefined) continue;

                const childPatterns = childPatternsValue
                    .split(',')
                    .map(pattern => pattern.trim())
                    .filter(Boolean);

                for (const childPattern of childPatterns) {
                    const resolvedPattern = this.resolveFileNestingChildPattern(
                        childPattern,
                        parent.label,
                        directoryUri,
                        capture
                    );

                    for (const child of files) {
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
            gitState: this.gitStatusService.status.get(path.normalize(uri.fsPath))
        };
    }

    private async findProjectFile(root: vscode.Uri): Promise<vscode.Uri | undefined> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(root);
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
            const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
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
            const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
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
        return ['bin', 'obj', '.git', '.vs', '.idea', 'node_modules']
            .includes(name.toLowerCase());
    }

}

export function activate(context: vscode.ExtensionContext): void {
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
    const followEditorStateKey = 'aoh.solutionExplorer.followEditor';
    let followEditor = context.workspaceState.get<boolean>(followEditorStateKey, false);

    const getProvider = (): SolutionExplorerTreeDataProvider => {
        if (!provider) throw new Error('AOH Solution Explorer is not initialized.');
        return provider;
    };

    const updateFollowContext = async (): Promise<void> => {
        await vscode.commands.executeCommand('setContext', 'aoh.solutionExplorer.followEditor', followEditor);
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
                return await activeProvider.runAction(actionName, selected);
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

    for (const [command, actionName] of [
        ['aoh.solutionExplorer.newProject', 'newProject'],
        ['aoh.solutionExplorer.newSolutionFolder', 'newSolutionFolder'],
        ['aoh.solutionExplorer.addExistingProject', 'addExistingProject'],
        ['aoh.solutionExplorer.addExistingItem', 'addExistingItem'],
        ['aoh.solutionExplorer.newFile', 'newFile'],
        ['aoh.solutionExplorer.newFolder', 'newFolder'],
        ['aoh.solutionExplorer.newDotNetFile', 'newDotNetFile'],
        ['aoh.solutionExplorer.addProjectReference', 'addProjectReference'],
        ['aoh.solutionExplorer.newClass', 'newClass'],
        ['aoh.solutionExplorer.newInterface', 'newInterface'],
        ['aoh.solutionExplorer.newEnum', 'newEnum'],
        ['aoh.solutionExplorer.newStruct', 'newStruct'],
        ['aoh.solutionExplorer.newRecord', 'newRecord'],
        ['aoh.solutionExplorer.copy', 'copy'],
        ['aoh.solutionExplorer.cut', 'cut'],
        ['aoh.solutionExplorer.paste', 'paste'],
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
        ['aoh.solutionExplorer.copyPath', 'copyPath'],
        ['aoh.solutionExplorer.copyRelativePath', 'copyRelativePath'],
        ['aoh.solutionExplorer.openTerminal', 'openTerminal'],
        ['aoh.solutionExplorer.reveal', 'reveal'],
        ['aoh.solutionExplorer.findInFiles', 'findInFiles'],
        ['aoh.solutionExplorer.replaceInFiles', 'replaceInFiles']
    ] as const) registerAction(command, actionName);

    void updateFollowContext();

    try {
        provider = new SolutionExplorerTreeDataProvider(log);
        tree = vscode.window.createTreeView('aoh.solutionExplorer.view', {
            treeDataProvider: provider,
            showCollapseAll: true
        });

        context.subscriptions.push(
            tree,
            vscode.window.onDidChangeActiveTextEditor(() => { if (followEditor) void selectCurrentFile(); }),
            vscode.workspace.onDidCreateFiles(async () => { await provider!.refresh(); if (followEditor) await selectCurrentFile(); }),
            vscode.workspace.onDidDeleteFiles(() => provider!.refresh()),
            vscode.workspace.onDidRenameFiles(async () => { await provider!.refresh(); if (followEditor) await selectCurrentFile(); }),
            vscode.workspace.onDidSaveTextDocument(() => provider!.refresh()),
            vscode.workspace.onDidChangeWorkspaceFolders(async () => { await provider!.refresh(); if (followEditor) await selectCurrentFile(); }),
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
                if (event.affectsConfiguration('explorer.fileNesting')) {
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
}

export function deactivate(): void {}
