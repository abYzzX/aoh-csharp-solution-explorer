import * as vscode from 'vscode';
import * as path from 'path';
import { ContextMenuService } from './contextMenuService';
import { GitStatusService } from './gitStatusService';
import { NodeKind, ParsedProject, ParsedSolutionFolder, ParsedSolution, WebNode, DependencyRef } from './types';

export class SolutionExplorerTreeDataProvider implements vscode.TreeDataProvider<WebNode> {
    private readonly changed = new vscode.EventEmitter<WebNode | undefined | null | void>();
    readonly onDidChangeTreeData = this.changed.event;

    private readonly gitStatusService = new GitStatusService();
    private readonly contextMenuService = new ContextMenuService(async () => this.refresh());

    async refresh(): Promise<void> {
        await this.gitStatusService.load();
        this.changed.fire();
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

        // Virtual nodes need an explicit icon; physical resources deliberately do not.
        switch (element.kind) {
            case 'solutionFolder':
                item.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'dependencies':
                item.iconPath = new vscode.ThemeIcon('references');
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

        await this.gitStatusService.load();
        return this.buildRoots();
    }

    async runAction(action: string, element?: WebNode): Promise<void> {
        if (!element?.uri) return;

        await this.contextMenuService.handleAction({
            action,
            uri: element.uri,
            kind: element.kind,
            solutionFolderPath: element.solutionFolderPath,
            solutionUri: element.solutionUri
        });
    }

    private async buildRoots(): Promise<WebNode[]> {
        const solutions = await this.findSolutions();

        if (!solutions.length) {
            return [{
                id: 'no-solution',
                kind: 'solution',
                label: 'No .sln or .slnx found'
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
            return [...folders, ...files];
        } catch {
            return [];
        }
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
    const provider = new SolutionExplorerTreeDataProvider();

    const tree = vscode.window.createTreeView('aoh.solutionExplorer.view', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    const action = (command: string, actionName: string) =>
        vscode.commands.registerCommand(command, (node?: WebNode) => provider.runAction(actionName, node));

    context.subscriptions.push(
        tree,

        vscode.commands.registerCommand('aoh.solutionExplorer.refresh', () => provider.refresh()),

        action('aoh.solutionExplorer.newProject', 'newProject'),
        action('aoh.solutionExplorer.newSolutionFolder', 'newSolutionFolder'),
        action('aoh.solutionExplorer.addExistingProject', 'addExistingProject'),
        action('aoh.solutionExplorer.newFile', 'newFile'),
        action('aoh.solutionExplorer.newFolder', 'newFolder'),
        action('aoh.solutionExplorer.newDotNetFile', 'newDotNetFile'),
        action('aoh.solutionExplorer.addProjectReference', 'addProjectReference'),

        action('aoh.solutionExplorer.buildSolution', 'buildSolution'),
        action('aoh.solutionExplorer.rebuildSolution', 'rebuildSolution'),
        action('aoh.solutionExplorer.cleanSolution', 'cleanSolution'),
        action('aoh.solutionExplorer.buildProject', 'buildProject'),
        action('aoh.solutionExplorer.rebuildProject', 'rebuildProject'),
        action('aoh.solutionExplorer.cleanProject', 'cleanProject'),
        action('aoh.solutionExplorer.packProject', 'packProject'),
        action('aoh.solutionExplorer.publishProject', 'publishProject'),

        action('aoh.solutionExplorer.open', 'open'),
        action('aoh.solutionExplorer.openToSide', 'openToSide'),
        action('aoh.solutionExplorer.rename', 'rename'),
        action('aoh.solutionExplorer.delete', 'delete'),
        action('aoh.solutionExplorer.copyPath', 'copyPath'),
        action('aoh.solutionExplorer.copyRelativePath', 'copyRelativePath'),
        action('aoh.solutionExplorer.openTerminal', 'openTerminal'),
        action('aoh.solutionExplorer.reveal', 'reveal'),
        action('aoh.solutionExplorer.findInFiles', 'findInFiles'),
        action('aoh.solutionExplorer.replaceInFiles', 'replaceInFiles'),

        vscode.workspace.onDidCreateFiles(() => provider.refresh()),
        vscode.workspace.onDidDeleteFiles(() => provider.refresh()),
        vscode.workspace.onDidRenameFiles(() => provider.refresh()),
        vscode.workspace.onDidSaveTextDocument(() => provider.refresh()),
        vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh())
    );
}

export function deactivate(): void {}
