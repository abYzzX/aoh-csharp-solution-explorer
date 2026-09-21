import { allowsNodeAction } from './nodeActionPolicy';
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CommandContribution, DynamicContextMenuItem, ExplorerMenuContribution, NodeKind } from './types';
import { isValidSinglePathName, renameMatchingCSharpType } from './fileOperationUtils';
import { getAssemblyName, getTargetFramework, isExecutableProject, parseDotnetProjectTemplates, resolveProjectRoot } from './projectCreationUtils';
import { appendObjectToJsoncArray } from './vscodeConfigUtils';

const execFileAsync = promisify(execFile);

export class ContextMenuService {
    private clipboard?: { uris: vscode.Uri[]; cut: boolean };

    constructor(
        private readonly refresh: () => Promise<void>,
        private readonly log: (message: string) => void = () => {}
    ) {}

    buildMenu(uri: vscode.Uri, kind: NodeKind): DynamicContextMenuItem[] {
        const items: DynamicContextMenuItem[] = [];

        switch (kind) {
            case 'solution':
                items.push(
                    this.submenu('Add', [
                        this.internal('New Project...', 'newProject'),
                        this.internal('New Solution Folder...', 'newSolutionFolder'),
                        this.separator(),
                        this.internal('Existing Project...', 'addExistingProject')
                    ]),
                    this.separator(),
                    this.internal('Build Solution', 'buildSolution'),
                    this.submenu('Advanced Build Actions', [
                        this.internal('Rebuild Solution', 'rebuildSolution'),
                        this.internal('Clean Solution', 'cleanSolution')
                    ]),
                    this.separator(),
                    this.editMenu(uri, kind),
                    this.copyMenu(),
                    this.openInMenu(),
                    this.extensionsMenu(uri, kind)
                );
                break;

            case 'solutionFolder':
                items.push(
                    this.submenu('Add', [
                        this.internal('New Project...', 'newProject'),
                        this.internal('New Solution Folder...', 'newSolutionFolder'),
                        this.separator(),
                        this.internal('Existing Project...', 'addExistingProject')
                    ]),
                    this.separator(),
                    this.editMenu(uri, kind),
                    this.copyMenu(),
                    this.extensionsMenu(uri, kind)
                );
                break;

            case 'project': {
                const addChildren: DynamicContextMenuItem[] = [];
                const newDotnetFile = this.findDevKitMenuItem(['new', '.net', 'file']);
                if (newDotnetFile) addChildren.push(newDotnetFile);
                addChildren.push(
                    this.internal('New Directory...', 'newFolder'),
                    this.internal('New File...', 'newFile')
                );
                addChildren.push(
                    this.separator(),
                    this.internal('Project Reference...', 'addProjectReference')
                );

                items.push(
                    this.submenu('Add', addChildren),
                    this.separator(),
                    this.internal('Build Project', 'buildProject'),
                    this.internal('Publish...', 'publishProject'),
                    this.submenu('Advanced Build Actions', [
                        this.internal('Rebuild Project', 'rebuildProject'),
                        this.internal('Clean Project', 'cleanProject'),
                        this.internal('Pack Project', 'packProject')
                    ]),
                    this.separator(),
                    this.editMenu(uri, kind),
                    this.copyMenu(),
                    this.openInMenu(),
                    this.extensionsMenu(uri, kind)
                );
                break;
            }

            case 'dependencies':
                items.push(this.internal('Add Project Reference...', 'addProjectReference'));
                break;

            case 'folder':
            case 'file': {
                const addChildren: DynamicContextMenuItem[] = [];
                const newDotnetFile = this.findDevKitMenuItem(['new', '.net', 'file']);
                if (newDotnetFile) addChildren.push(newDotnetFile);
                addChildren.push(
                    this.internal('New Directory...', 'newFolder'),
                    this.internal('New File...', 'newFile')
                );

                items.push(
                    this.submenu('Add', addChildren),
                    this.separator(),
                    this.editMenu(uri, kind),
                    this.copyMenu(),
                    this.openInMenu(),
                    this.extensionsMenu(uri, kind)
                );
                break;
            }
        }

        return this.clean(items);
    }

    private editMenu(uri: vscode.Uri, kind: NodeKind): DynamicContextMenuItem {
        const children: DynamicContextMenuItem[] = [];

        if (kind === 'file' || kind === 'folder') {
            children.push(this.internal('Rename...', 'rename'));
        }

        if (kind === 'solution' || kind === 'project' || kind === 'file') {
            children.push(
                this.internal(`Edit '${path.basename(uri.fsPath)}'`, 'open'),
                this.internal(`Edit '${path.basename(uri.fsPath)}' to the Side`, 'openToSide')
            );
        }

        children.push(
            this.separator(),
            this.internal('Find in Files...', 'findInFiles'),
            this.internal('Replace in Files...', 'replaceInFiles')
        );

        if (kind === 'file' || kind === 'folder') {
            children.push(this.separator(), this.internal('Delete', 'delete'));
        }

        return this.submenu('Edit', children);
    }

    private copyMenu(): DynamicContextMenuItem {
        return this.submenu('Copy Path/Reference...', [
            this.internal('Copy Path', 'copyPath'),
            this.internal('Copy Relative Path', 'copyRelativePath')
        ]);
    }

    private openInMenu(): DynamicContextMenuItem {
        return this.submenu('Open In', [
            this.internal('File Manager', 'reveal'),
            this.internal('Terminal', 'openTerminal')
        ]);
    }

    private extensionsMenu(uri: vscode.Uri, kind: NodeKind): DynamicContextMenuItem {
        const isFolder = kind === 'folder' || kind === 'solutionFolder';
        const commandMap = new Map<string, CommandContribution>();
        for (const extension of vscode.extensions.all) {
            const commands = extension.packageJSON?.contributes?.commands as CommandContribution[] | undefined;
            if (!Array.isArray(commands)) continue;
            for (const command of commands) {
                if (command?.command && command?.title) commandMap.set(command.command, command);
            }
        }

        const byExtension = new Map<string, DynamicContextMenuItem[]>();
        for (const extension of vscode.extensions.all) {
            if (extension.id === 'ms-dotnettools.csdevkit') continue;
            if (extension.id.startsWith('vscode.')) continue;

            const menus = extension.packageJSON?.contributes?.menus?.['explorer/context'] as ExplorerMenuContribution[] | undefined;
            if (!Array.isArray(menus)) continue;

            const entries: DynamicContextMenuItem[] = [];
            for (const menu of menus) {
                if (!menu.command || !this.whenClauseCouldMatch(menu.when, uri, isFolder)) continue;
                const command = commandMap.get(menu.command);
                if (!command) continue;
                const label = command.category ? `${command.category}: ${command.title}` : command.title;
                entries.push({
                    label,
                    command: menu.command,
                    enabled: this.whenClauseCouldMatch(command.enablement, uri, isFolder)
                });
            }

            const unique = this.clean(entries);
            if (unique.length) {
                byExtension.set(extension.packageJSON?.displayName ?? extension.packageJSON?.name ?? extension.id, unique);
            }
        }

        const children = [...byExtension.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, entries]) => this.submenu(name, entries));

        return {
            label: 'Extensions',
            children: children.length ? children : [{ label: 'No extension actions', enabled: false }]
        };
    }

    private findDevKitMenuItem(searchTerms: string[]): DynamicContextMenuItem | undefined {
        const extension = vscode.extensions.getExtension('ms-dotnettools.csdevkit');
        const commands = extension?.packageJSON?.contributes?.commands as CommandContribution[] | undefined;
        if (!Array.isArray(commands)) return undefined;
        const normalizedTerms = searchTerms.map(term => term.toLowerCase());
        const command = commands.find(c => {
            const title = `${c.category ?? ''} ${c.title ?? ''}`.toLowerCase();
            return normalizedTerms.every(term => title.includes(term));
        });
        return command ? { label: command.title, command: command.command } : undefined;
    }

    private internal(label: string, action: string): DynamicContextMenuItem {
        return { label, command: `aoh.internal.${action}` };
    }

    private submenu(label: string, children: DynamicContextMenuItem[]): DynamicContextMenuItem {
        return { label, children: this.clean(children) };
    }

    private separator(): DynamicContextMenuItem { return { separator: true }; }

    private clean(items: DynamicContextMenuItem[]): DynamicContextMenuItem[] {
        const result: DynamicContextMenuItem[] = [];
        const seen = new Set<string>();
        for (const item of items) {
            if (item.separator) {
                if (result.length && !result[result.length - 1].separator) result.push(item);
                continue;
            }
            if (item.children) item.children = this.clean(item.children);
            const key = `${item.label ?? ''}|${item.command ?? ''}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(item);
        }
        while (result.length && result[result.length - 1].separator) result.pop();
        return result;
    }

    private whenClauseCouldMatch(clause: string | undefined, uri: vscode.Uri, isFolder: boolean): boolean {
        if (!clause?.trim()) return true;
        const context: Record<string, string | boolean> = {
            resourceFilename: path.basename(uri.fsPath),
            resourceExtname: path.extname(uri.fsPath),
            resourceScheme: uri.scheme,
            resourceLangId: this.languageIdForUri(uri),
            explorerResourceIsFolder: isFolder,
            explorerResourceIsFile: !isFolder
        };
        const orBranches = clause.replace(/[()]/g, ' ').split('||').map(x => x.trim()).filter(Boolean);
        return orBranches.some(branch => branch.split('&&').map(x => x.trim()).filter(Boolean)
            .every(term => this.evaluateWhenAtom(term, context)));
    }

    private evaluateWhenAtom(atom: string, context: Record<string, string | boolean>): boolean {
        let text = atom.trim();
        let negated = false;
        while (text.startsWith('!')) { negated = !negated; text = text.slice(1).trim(); }
        let result: boolean | undefined;
        if (text in context && typeof context[text] === 'boolean') result = context[text] as boolean;
        if (result === undefined) {
            const equality = text.match(/^(resourceFilename|resourceExtname|resourceScheme|resourceLangId)\s*(==|!=)\s*(.+)$/);
            if (equality) {
                const [, key, op, rawValue] = equality;
                const expected = rawValue.trim().replace(/^['"]|['"]$/g, '');
                const actual = String(context[key] ?? '');
                result = op === '==' ? actual === expected : actual !== expected;
            }
        }
        if (result === undefined) {
            const regex = text.match(/^(resourceFilename|resourceExtname|resourceLangId)\s*=~\s*\/(.+)\/([imsu]*)$/);
            if (regex) {
                try { result = new RegExp(regex[2], regex[3]).test(String(context[regex[1]] ?? '')); }
                catch { result = false; }
            }
        }
        if (result === undefined) result = false;
        return negated ? !result : result;
    }

    private languageIdForUri(uri: vscode.Uri): string {
        const ext = path.extname(uri.fsPath).toLowerCase();
        const map: Record<string, string> = {
            '.cs': 'csharp', '.fs': 'fsharp', '.vb': 'vb', '.ts': 'typescript', '.tsx': 'typescriptreact',
            '.js': 'javascript', '.jsx': 'javascriptreact', '.json': 'json', '.jsonc': 'jsonc', '.md': 'markdown',
            '.xaml': 'xml', '.xml': 'xml', '.props': 'xml', '.targets': 'xml', '.config': 'xml', '.resx': 'xml',
            '.yml': 'yaml', '.yaml': 'yaml', '.sql': 'sql', '.html': 'html', '.htm': 'html', '.css': 'css',
            '.scss': 'scss', '.sh': 'shellscript', '.ps1': 'powershell', '.csproj': 'xml', '.fsproj': 'xml', '.vbproj': 'xml'
        };
        return map[ext] ?? '';
    }

    async createSolution(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const target = await vscode.window.showOpenDialog({
            title: 'Create New Solution',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: workspaceFolder?.uri,
            openLabel: 'Select Folder'
        });
        if (!target?.[0]) return;

        const defaultName = path.basename(target[0].fsPath);
        const name = await vscode.window.showInputBox({
            title: 'Create New Solution',
            prompt: 'Solution name',
            value: defaultName,
            validateInput: (value: string) => value.trim() ? undefined : 'Solution name is required.'
        });
        if (!name?.trim()) return;

        try {
            await execFileAsync('dotnet', ['new', 'sln', '-n', name.trim()], { cwd: target[0].fsPath });
            await this.refresh();
        } catch (error: any) {
            const detail = error?.stderr?.toString().trim() || error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to create solution: ${detail}`);
        }
    }

    async handleAction(message: any): Promise<void> {
        if (typeof message?.action !== 'string' || typeof message?.uri !== 'string') return;
        const uri = vscode.Uri.parse(message.uri);
        const kind = message.kind as NodeKind | undefined;
        const solutionFolderPath = Array.isArray(message.solutionFolderPath)
            ? message.solutionFolderPath.filter((part: unknown): part is string => typeof part === 'string')
            : [];
        const solutionUri = typeof message.solutionUri === 'string'
            ? vscode.Uri.parse(message.solutionUri)
            : undefined;
        const action = message.action as string;
        if (!allowsNodeAction(action, kind)) return;
        const targetUris = Array.isArray(message.targetUris)
            ? message.targetUris
                .filter((value: unknown): value is string => typeof value === 'string')
                .map((value: string) => vscode.Uri.parse(value))
            : [uri];

        if (action.startsWith('command:')) {
            const command = action.slice('command:'.length);
            try { await vscode.commands.executeCommand(command, uri); }
            catch (error) { vscode.window.showErrorMessage(`Command '${command}' failed: ${String(error)}`); }
            return;
        }

        const containerUri = this.containerUri(uri, kind);
        switch (action) {
            case 'newDotNetFile': {
                const target = this.containerUri(uri, kind);
                this.log(`New .NET File requested for kind=${kind ?? 'unknown'}, target=${target.toString()}`);
                try {
                    const devKit = vscode.extensions.getExtension('ms-dotnettools.csdevkit');
                    this.log(`C# Dev Kit extension found: ${devKit ? 'YES' : 'NO'}${devKit ? `; active=${devKit.isActive}` : ''}`);
                    if (devKit && !devKit.isActive) {
                        this.log('Activating C# Dev Kit explicitly...');
                        await devKit.activate();
                        this.log('C# Dev Kit activation completed.');
                    }
                    const commands = await vscode.commands.getCommands(true);
                    const candidates = commands.filter((command: string) => {
                        const value = command.toLowerCase();
                        return (value.includes('csdevkit') || value.includes('dotnet')) &&
                            (value.includes('new') || value.includes('file') || value.includes('template'));
                    });
                    this.log(`Candidate Dev Kit/.NET commands: ${candidates.length ? candidates.join(', ') : '(none)'}`);
                    const command = 'csdevkit.addNewFileToFolder';
                    if (!commands.includes(command)) {
                        this.log('ERROR: csdevkit.addNewFileToFolder is not registered.');
                        await vscode.commands.executeCommand('aoh.solutionExplorer.showOutput');
                        vscode.window.showErrorMessage('C# Dev Kit does not expose csdevkit.addNewFileToFolder. See Output > AOH Solution Explorer.');
                        return;
                    }
                    this.log(`Executing ${command} with target ${target.toString()}`);
                    await vscode.commands.executeCommand(command, target);
                    this.log(`${command} completed.`);
                    await this.refresh();
                } catch (error) {
                    this.log(`ERROR while invoking C# Dev Kit: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
                    await vscode.commands.executeCommand('aoh.solutionExplorer.showOutput');
                    vscode.window.showErrorMessage('C# Dev Kit New .NET File failed. See Output > AOH Solution Explorer.');
                }
                return;
            }
            case 'newClass': return this.createCSharpType(containerUri, 'class');
            case 'newInterface': return this.createCSharpType(containerUri, 'interface');
            case 'newEnum': return this.createCSharpType(containerUri, 'enum');
            case 'newStruct': return this.createCSharpType(containerUri, 'struct');
            case 'newRecord': return this.createCSharpType(containerUri, 'record');
            case 'copy': this.clipboard = { uris: targetUris, cut: false }; return;
            case 'cut': this.clipboard = { uris: targetUris, cut: true }; return;
            case 'paste': return this.pasteItems(containerUri, kind, solutionFolderPath, uri);
            case 'duplicate': return this.duplicateItems(targetUris);
            case 'copyPathSolution': {
                if (targetUris.length > 1) {
                    const values = targetUris.map((target: vscode.Uri) => this.relativePathToSolution(target, solutionUri));
                    await vscode.env.clipboard.writeText(values.join('\n'));
                    return;
                }
                return this.copyPathRelativeToSolution(uri, solutionUri);
            }
            case 'copyPathWorkspace': {
                if (targetUris.length > 1) {
                    const values = targetUris.map((target: vscode.Uri) => this.relativePathToWorkspace(target));
                    await vscode.env.clipboard.writeText(values.join('\n'));
                    return;
                }
                return this.copyPathRelativeToWorkspace(uri);
            }
            case 'copyPathFull': await vscode.env.clipboard.writeText(targetUris.map((target: vscode.Uri) => target.fsPath).join('\n')); return;
            case 'gitTrack': return this.gitTrack(targetUris, uri, kind);
            case 'gitUntrack': return this.gitUntrack(targetUris, uri, kind);
            case 'addExistingItem': await this.addExistingItem(uri, kind, solutionFolderPath); return;
            case 'addProjectReference': {
                await this.addProjectReference(uri, solutionUri);
                return;
            }
            case 'newProject':
                return this.createProject(uri, kind, solutionFolderPath, solutionUri);
            case 'newSolutionFolder':
                return this.createSolutionFolder(uri, solutionFolderPath);
            case 'addExistingProject': {
                const pick = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { '.NET Projects': ['csproj', 'fsproj', 'vbproj'] } });
                if (!pick?.length) return;
                for (const project of pick) {
                    const args = ['sln', uri.fsPath, 'add', project.fsPath];
                    if (kind === 'solutionFolder' && solutionFolderPath.length) args.push('--solution-folder', solutionFolderPath.join('/'));
                    await this.runDotnet('Add project', uri, args, path.dirname(uri.fsPath));
                }
                await this.refresh(); return;
            }
            case 'gitStage': return this.gitStage(targetUris, uri, kind);
            case 'gitUnstage': return this.gitUnstage(targetUris, uri, kind);
            case 'gitRollback': return this.gitRollback(targetUris, uri, kind);
            case 'buildSolution': return this.runDotnet('Build Solution', uri, ['build', uri.fsPath], path.dirname(uri.fsPath));
            case 'rebuildSolution': return this.runDotnet('Rebuild Solution', uri, ['build', uri.fsPath, '--no-incremental'], path.dirname(uri.fsPath));
            case 'cleanSolution': return this.runDotnet('Clean Solution', uri, ['clean', uri.fsPath], path.dirname(uri.fsPath));
            case 'buildProject': return this.runDotnet('Build Project', uri, ['build', uri.fsPath], path.dirname(uri.fsPath));
            case 'rebuildProject': return this.runDotnet('Rebuild Project', uri, ['build', uri.fsPath, '--no-incremental'], path.dirname(uri.fsPath));
            case 'cleanProject': return this.runDotnet('Clean Project', uri, ['clean', uri.fsPath], path.dirname(uri.fsPath));
            case 'packProject': return this.runDotnet('Pack Project', uri, ['pack', uri.fsPath], path.dirname(uri.fsPath));
            case 'publishProject': return this.runDotnet('Publish Project', uri, ['publish', uri.fsPath], path.dirname(uri.fsPath));
            case 'open': await vscode.commands.executeCommand('vscode.open', uri); return;
            case 'openToSide': await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside }); return;
            case 'newFile': {
                const name = await vscode.window.showInputBox({
                    title: 'New File',
                    prompt: 'File name',
                    placeHolder: 'MyFile.cs'
                });
                if (!name?.trim()) return;

                const target = vscode.Uri.joinPath(containerUri, name.trim());
                try {
                    await vscode.workspace.fs.writeFile(target, new Uint8Array());
                    await this.refresh();
                    await vscode.window.showTextDocument(target, { preview: false });
                } catch (error) {
                    vscode.window.showErrorMessage(`Could not create '${target.fsPath}': ${String(error)}`);
                }
                return;
            }
            case 'newFolder': {
                const name = await vscode.window.showInputBox({
                    title: 'New Directory',
                    prompt: 'Directory name'
                });
                if (!name?.trim()) return;

                const target = vscode.Uri.joinPath(containerUri, name.trim());
                try {
                    await vscode.workspace.fs.createDirectory(target);
                    await this.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Could not create '${target.fsPath}': ${String(error)}`);
                }
                return;
            }
            case 'copyPath': await vscode.env.clipboard.writeText(targetUris.map((target: vscode.Uri) => target.fsPath).join('\n')); return;
            case 'copyRelativePath': {
                const values = targetUris.map((target: vscode.Uri) => this.relativePathToWorkspace(target));
                await vscode.env.clipboard.writeText(values.join('\n')); return;
            }
            case 'rename': {
                const oldName = path.basename(uri.fsPath);
                const nextName = await vscode.window.showInputBox({ title: 'Rename', value: oldName });
                if (!nextName || nextName === oldName) return;
                await vscode.workspace.fs.rename(uri, vscode.Uri.joinPath(vscode.Uri.file(path.dirname(uri.fsPath)), nextName), { overwrite: false }); await this.refresh(); return;
            }
            case 'delete': {
                if (kind === 'project') {
                    if (!solutionUri) {
                        vscode.window.showErrorMessage('Could not resolve the owning solution.');
                        return;
                    }

                    const choice = await vscode.window.showWarningMessage(
                        `Remove project '${path.basename(uri.fsPath)}' from the solution? The project files will stay on disk.`,
                        { modal: true },
                        'Remove'
                    );
                    if (choice !== 'Remove') return;

                    await this.runDotnet(
                        'Remove Project',
                        solutionUri,
                        ['sln', solutionUri.fsPath, 'remove', uri.fsPath],
                        path.dirname(solutionUri.fsPath)
                    );
                    await this.refresh();
                    return;
                }

                if (kind === 'solutionFolder') {
                    const choice = await vscode.window.showWarningMessage(
                        `Delete Solution Folder '${solutionFolderPath.join(' / ')}'? Files on disk will not be deleted.`,
                        { modal: true },
                        'Delete'
                    );
                    if (choice !== 'Delete') return;

                    await this.deleteSolutionFolder(uri, solutionFolderPath);
                    return;
                }

                const effectiveTargets = targetUris.length ? targetUris : [uri];
                const confirmDelete = vscode.workspace
                    .getConfiguration('aoh.solutionExplorer')
                    .get<boolean>('delete.confirm', true);
                const useTrash = vscode.workspace
                    .getConfiguration('aoh.solutionExplorer')
                    .get<boolean>('delete.useTrash', true);

                if (confirmDelete) {
                    const label = effectiveTargets.length === 1
                        ? `'${path.basename(effectiveTargets[0].fsPath)}'`
                        : `${effectiveTargets.length} selected items`;
                    const choice = await vscode.window.showWarningMessage(
                        `Delete ${label}?`,
                        { modal: true },
                        'Delete'
                    );
                    if (choice !== 'Delete') return;
                }

                for (const target of effectiveTargets) {
                    await vscode.workspace.fs.delete(target, { recursive: true, useTrash });
                }
                await this.refresh();
                return;
            }
            case 'openTerminal': {
                const cwd = this.containerUri(uri, kind);
                vscode.window.createTerminal({ name: `AOH: ${path.basename(cwd.fsPath)}`, cwd }).show(); return;
            }
            case 'reveal': await vscode.commands.executeCommand('revealFileInOS', uri); return;
            case 'findInFiles': await vscode.commands.executeCommand('workbench.action.findInFiles'); return;
            case 'replaceInFiles': await vscode.commands.executeCommand('workbench.action.replaceInFiles'); return;
        }
    }


    private async createCSharpType(
        directory: vscode.Uri,
        type: 'class' | 'interface' | 'enum' | 'struct' | 'record'
    ): Promise<void> {
        const displayType = type[0].toUpperCase() + type.slice(1);
        const name = await vscode.window.showInputBox({
            title: `New ${displayType}`,
            prompt: `${displayType} name`,
            placeHolder: type === 'interface' ? 'IMyInterface' : `My${displayType}`,
            validateInput: value => {
                const clean = value.trim().replace(/\.cs$/i, '');
                if (!clean) return 'Enter a name.';
                if (!/^[@A-Za-z_][A-Za-z0-9_]*$/.test(clean)) return 'Enter a valid C# type name.';
                return undefined;
            }
        });
        if (!name?.trim()) return;

        const cleanName = name.trim().replace(/\.cs$/i, '');
        const target = vscode.Uri.joinPath(directory, `${cleanName}.cs`);

        try {
            try {
                await vscode.workspace.fs.stat(target);
                vscode.window.showErrorMessage(`'${cleanName}.cs' already exists.`);
                return;
            } catch {
                // Expected for a new file.
            }

            const namespaceName = await this.resolveNamespace(directory);
            const declaration = type === 'record'
                ? `public record ${cleanName}\n{\n}\n`
                : `public ${type} ${cleanName}\n{\n}\n`;
            const content = namespaceName
                ? `namespace ${namespaceName};\n\n${declaration}`
                : declaration;

            await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
            await this.refresh();
            await vscode.window.showTextDocument(target, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`Could not create '${target.fsPath}': ${String(error)}`);
        }
    }

    private async resolveNamespace(directory: vscode.Uri): Promise<string | undefined> {
        const projectFile = await this.findContainingCSharpProject(directory);
        if (!projectFile) {
            this.log(`Namespace resolution: no .csproj found for ${directory.fsPath}`);
            return undefined;
        }

        const projectDirectory = path.dirname(projectFile.fsPath);
        let rootNamespace = path.basename(projectFile.fsPath, path.extname(projectFile.fsPath));

        try {
            const projectXml = Buffer.from(await vscode.workspace.fs.readFile(projectFile)).toString('utf8');
            const match = projectXml.match(/<RootNamespace>([^<]+)<\/RootNamespace>/i);
            if (match?.[1]?.trim()) rootNamespace = match[1].trim();
        } catch (error) {
            this.log(`Namespace resolution: could not read ${projectFile.fsPath}: ${String(error)}`);
        }

        const relativeDirectory = path.relative(projectDirectory, directory.fsPath);
        const folderNamespace = relativeDirectory && relativeDirectory !== '.'
            ? relativeDirectory
                .split(path.sep)
                .filter(Boolean)
                .map(part => this.toNamespaceSegment(part))
                .filter(Boolean)
                .join('.')
            : '';

        const namespaceName = folderNamespace ? `${rootNamespace}.${folderNamespace}` : rootNamespace;
        this.log(`Namespace resolution: ${directory.fsPath} -> ${namespaceName}`);
        return namespaceName;
    }

    private async findContainingCSharpProject(directory: vscode.Uri): Promise<vscode.Uri | undefined> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(directory);
        const workspaceRoot = workspaceFolder?.uri.fsPath;
        let current = directory.fsPath;

        while (true) {
            try {
                const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(current));
                const project = entries.find(([name, fileType]) =>
                    fileType === vscode.FileType.File && name.toLowerCase().endsWith('.csproj')
                );
                if (project) return vscode.Uri.file(path.join(current, project[0]));
            } catch {
                // Keep walking up until the workspace root.
            }

            if (workspaceRoot && this.normalizePath(current) === this.normalizePath(workspaceRoot)) break;
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }

        return undefined;
    }

    private toNamespaceSegment(value: string): string {
        let segment = value.replace(/[^A-Za-z0-9_]/g, '_');
        if (!segment) return '';
        if (/^[0-9]/.test(segment)) segment = `_${segment}`;
        return segment;
    }

    private async pasteItems(
        targetDirectory: vscode.Uri,
        kind: NodeKind | undefined,
        solutionFolderPath: string[],
        solutionFolderUri: vscode.Uri
    ): Promise<void> {
        if (!this.clipboard?.uris.length) return;

        if (kind === 'solutionFolder') {
            await this.addSolutionItems(solutionFolderUri, solutionFolderPath, this.clipboard.uris);
            if (this.clipboard.cut) this.clipboard = undefined;
            await this.refresh();
            return;
        }

        for (const source of this.clipboard.uris) {
            let target = vscode.Uri.joinPath(targetDirectory, path.basename(source.fsPath));

            // Cutting into the same directory is already the requested final state.
            if (this.clipboard.cut && this.normalizePath(source.fsPath) === this.normalizePath(target.fsPath)) continue;

            if (await this.exists(target)) {
                const resolved = await this.promptForCollisionName(source, targetDirectory, 'Paste');
                if (!resolved) return;
                target = resolved;
            }

            try {
                if (this.clipboard.cut) {
                    await vscode.workspace.fs.rename(source, target, { overwrite: false });
                } else {
                    await vscode.workspace.fs.copy(source, target, { overwrite: false });
                    await this.renameCopiedCSharpTypeIfSafe(source, target);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Could not paste '${path.basename(source.fsPath)}': ${String(error)}`);
                return;
            }
        }

        if (this.clipboard.cut) this.clipboard = undefined;
        await this.refresh();
    }

    private async duplicateItems(sources: vscode.Uri[]): Promise<void> {
        for (const source of sources) {
            const directory = vscode.Uri.file(path.dirname(source.fsPath));
            const target = await this.promptForCollisionName(source, directory, 'Duplicate');
            if (!target) return;

            try {
                await vscode.workspace.fs.copy(source, target, { overwrite: false });
                await this.renameCopiedCSharpTypeIfSafe(source, target);
            } catch (error) {
                vscode.window.showErrorMessage(`Could not duplicate '${path.basename(source.fsPath)}': ${String(error)}`);
                return;
            }
        }

        await this.refresh();
    }

    private async promptForCollisionName(
        source: vscode.Uri,
        targetDirectory: vscode.Uri,
        operation: 'Paste' | 'Duplicate'
    ): Promise<vscode.Uri | undefined> {
        const originalName = path.basename(source.fsPath);

        while (true) {
            const name = await vscode.window.showInputBox({
                title: `${operation}: Name already exists`,
                prompt: `Choose a new name for '${originalName}'`,
                value: originalName,
                valueSelection: this.fileNameSelection(originalName),
                validateInput: value => isValidSinglePathName(value)
                    ? undefined
                    : 'Enter a single file or directory name.'
            });
            if (name === undefined) return undefined;

            const target = vscode.Uri.joinPath(targetDirectory, name.trim());
            if (!(await this.exists(target))) return target;

            vscode.window.showWarningMessage(`'${name.trim()}' already exists. Choose another name.`);
        }
    }

    private fileNameSelection(name: string): [number, number] {
        const extension = path.extname(name);
        return extension ? [0, name.length - extension.length] : [0, name.length];
    }

    private async exists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    private async renameCopiedCSharpTypeIfSafe(source: vscode.Uri, target: vscode.Uri): Promise<void> {
        if (path.extname(source.fsPath).toLowerCase() !== '.cs' || path.extname(target.fsPath).toLowerCase() !== '.cs') return;

        const oldTypeName = path.basename(source.fsPath, path.extname(source.fsPath));
        const newTypeName = path.basename(target.fsPath, path.extname(target.fsPath));
        if (oldTypeName === newTypeName) return;

        try {
            const bytes = await vscode.workspace.fs.readFile(target);
            const text = Buffer.from(bytes).toString('utf8');
            const result = renameMatchingCSharpType(text, oldTypeName, newTypeName);
            if (!result.renamed) {
                this.log(`Skipped C# type rename for '${path.basename(target.fsPath)}': not unambiguous.`);
                return;
            }

            await vscode.workspace.fs.writeFile(target, Buffer.from(result.text, 'utf8'));
        } catch (error) {
            this.log(`Could not adjust copied C# type in '${target.fsPath}': ${String(error)}`);
        }
    }

    private relativePathToSolution(uri: vscode.Uri, solutionUri?: vscode.Uri): string {
        if (!solutionUri) return path.basename(uri.fsPath);
        return path.relative(path.dirname(solutionUri.fsPath), uri.fsPath);
    }

    private relativePathToWorkspace(uri: vscode.Uri): string {
        const folder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
        return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath);
    }

    private async copyPathRelativeToSolution(uri: vscode.Uri, solutionUri?: vscode.Uri): Promise<void> {
        if (!solutionUri) {
            await vscode.env.clipboard.writeText(path.basename(uri.fsPath));
            return;
        }
        await vscode.env.clipboard.writeText(path.relative(path.dirname(solutionUri.fsPath), uri.fsPath));
    }

    private async copyPathRelativeToWorkspace(uri: vscode.Uri): Promise<void> {
        const folder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
        await vscode.env.clipboard.writeText(
            folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath)
        );
    }

    private gitTargetUri(uri: vscode.Uri, kind?: NodeKind): vscode.Uri {
        if (kind === 'project') return vscode.Uri.file(path.dirname(uri.fsPath));
        return uri;
    }

    private async getGitContext(
        uri: vscode.Uri,
        kind?: NodeKind
    ): Promise<{ root: string; relativePath: string } | undefined> {
        const target = this.gitTargetUri(uri, kind);
        const cwd = kind === 'file' ? path.dirname(target.fsPath) : target.fsPath;

        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
            const root = stdout.trim();
            if (!root) return undefined;
            return { root, relativePath: path.relative(root, target.fsPath) || '.' };
        } catch {
            vscode.window.showErrorMessage('The selected item is not inside a Git repository.');
            return undefined;
        }
    }

    private async runGitForTargets(
        operation: string,
        targets: vscode.Uri[],
        fallbackUri: vscode.Uri,
        fallbackKind: NodeKind | undefined,
        argsFactory: (relativePath: string) => string[]
    ): Promise<void> {
        const effectiveTargets = targets.length ? targets : [this.gitTargetUri(fallbackUri, fallbackKind)];
        const seen = new Set<string>();

        for (const target of effectiveTargets) {
            const targetKind = target.toString() === fallbackUri.toString() ? fallbackKind : undefined;
            const context = await this.getGitContext(target, targetKind);
            if (!context) continue;

            const key = `${context.root}\0${context.relativePath}`;
            if (seen.has(key)) continue;
            seen.add(key);

            try {
                await execFileAsync('git', argsFactory(context.relativePath), { cwd: context.root });
            } catch (error: any) {
                const detail = error?.stderr?.toString().trim() || error?.message || String(error);
                vscode.window.showErrorMessage(`Git ${operation} failed: ${detail}`);
                return;
            }
        }

        await this.refresh();
    }

    private gitTrack(targets: vscode.Uri[], uri: vscode.Uri, kind?: NodeKind): Promise<void> {
        return this.runGitForTargets('track', targets, uri, kind, relative => ['add', '--', relative]);
    }

    private gitUntrack(targets: vscode.Uri[], uri: vscode.Uri, kind?: NodeKind): Promise<void> {
        return this.runGitForTargets(
            'untrack',
            targets,
            uri,
            kind,
            relative => ['rm', '--cached', '-r', '--ignore-unmatch', '--', relative]
        );
    }

    private gitStage(targets: vscode.Uri[], uri: vscode.Uri, kind?: NodeKind): Promise<void> {
        return this.runGitForTargets('stage', targets, uri, kind, relative => ['add', '--', relative]);
    }

    private gitUnstage(targets: vscode.Uri[], uri: vscode.Uri, kind?: NodeKind): Promise<void> {
        return this.runGitForTargets('unstage', targets, uri, kind, relative => ['restore', '--staged', '--', relative]);
    }

    private async gitRollback(targets: vscode.Uri[], uri: vscode.Uri, kind?: NodeKind): Promise<void> {
        const label = kind === 'solutionFolder'
            ? 'the selected Solution Folder'
            : `'${path.basename(uri.fsPath)}'`;

        const choice = await vscode.window.showWarningMessage(
            `Rollback all Git changes for ${label}? This also removes untracked files below the selected item.`,
            { modal: true },
            'Rollback'
        );
        if (choice !== 'Rollback') return;

        const effectiveTargets = targets.length ? targets : [uri];
        for (const target of effectiveTargets) {
            const targetKind = target.toString() === uri.toString() ? kind : undefined;
            const context = await this.getGitContext(target, targetKind);
            if (!context) continue;

            try {
                await execFileAsync(
                    'git',
                    ['restore', '--source=HEAD', '--staged', '--worktree', '--', context.relativePath],
                    { cwd: context.root }
                );
                await execFileAsync('git', ['clean', '-fd', '--', context.relativePath], { cwd: context.root });
            } catch (error: any) {
                const detail = error?.stderr?.toString().trim() || error?.message || String(error);
                vscode.window.showErrorMessage(`Git rollback failed: ${detail}`);
                return;
            }
        }

        await this.refresh();
    }

    private async addExistingItem(
        uri: vscode.Uri,
        kind: NodeKind | undefined,
        solutionFolderPath: string[]
    ): Promise<void> {
        const selected = await vscode.window.showOpenDialog({
            title: 'Add Existing Item',
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'Add'
        });
        if (!selected?.length) return;

        if (kind === 'solutionFolder') {
            if (!solutionFolderPath.length) {
                vscode.window.showErrorMessage('Could not resolve the selected Solution Folder.');
                return;
            }
            await this.addSolutionItems(uri, solutionFolderPath, selected);
            await this.refresh();
            return;
        }

        if (kind !== 'project' && kind !== 'folder') return;
        const targetDirectory = this.containerUri(uri, kind);
        let copied = 0;

        for (const source of selected) {
            const target = vscode.Uri.joinPath(targetDirectory, path.basename(source.fsPath));
            if (this.normalizePath(source.fsPath) === this.normalizePath(target.fsPath)) continue;

            let overwrite = false;
            try {
                await vscode.workspace.fs.stat(target);
                const choice = await vscode.window.showWarningMessage(
                    `'${path.basename(target.fsPath)}' already exists in '${targetDirectory.fsPath}'.`,
                    { modal: true },
                    'Replace',
                    'Skip'
                );
                if (choice !== 'Replace') continue;
                overwrite = true;
            } catch {
                // Target does not exist yet.
            }

            try {
                await vscode.workspace.fs.copy(source, target, { overwrite });
                copied++;
            } catch (error) {
                vscode.window.showErrorMessage(`Could not add '${path.basename(source.fsPath)}': ${String(error)}`);
            }
        }

        if (copied > 0) await this.refresh();
    }

    private async addSolutionItems(
        solutionUri: vscode.Uri,
        folderPath: string[],
        items: vscode.Uri[]
    ): Promise<void> {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(solutionUri)).toString('utf8');
        const solutionDir = path.dirname(solutionUri.fsPath);
        const relativeItems = items.map(item => {
            const relative = path.relative(solutionDir, item.fsPath) || path.basename(item.fsPath);
            return relative.replace(/\\/g, '/');
        });

        if (solutionUri.fsPath.toLowerCase().endsWith('.slnx')) {
            const next = this.addSolutionItemsToSlnx(raw, folderPath, relativeItems);
            if (next === raw) {
                vscode.window.showErrorMessage(
                    `Could not find Solution Folder '${folderPath.join(' / ')}' in the .slnx file.`
                );
                return;
            }
            await vscode.workspace.fs.writeFile(solutionUri, Buffer.from(next, 'utf8'));
            return;
        }

        const guid = this.findSolutionFolderGuid(raw, folderPath);
        if (!guid) {
            vscode.window.showErrorMessage(`Could not resolve Solution Folder '${folderPath.join(' / ')}'.`);
            return;
        }

        const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n';
        const escapedGuid = guid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const projectRegex = new RegExp(
            `(Project\\("\\{[^}]+\\}"\\)\\s*=\\s*"[^"]+",\\s*"[^"]+",\\s*"\\{${escapedGuid}\\}"[\\s\\S]*?)(^EndProject\\s*$)`,
            'gmi'
        );

        let changed = false;
        const next = raw.replace(projectRegex, (_match: string, body: string, endProject: string) => {
            const existingSection = /ProjectSection\(SolutionItems\)\s*=\s*preProject([\s\S]*?)EndProjectSection/i.exec(body);
            const existing = new Set<string>();

            if (existingSection) {
                for (const line of existingSection[1].split(/\r?\n/)) {
                    const eq = line.indexOf('=');
                    if (eq >= 0) existing.add(line.slice(0, eq).trim().replace(/\\/g, '/'));
                }
            }

            const additions = relativeItems.filter(item => !existing.has(item));
            if (!additions.length) return `${body}${endProject}`;

            changed = true;
            const lines = additions
                .map(item => {
                    const slnPath = item.replace(/\//g, '\\');
                    return `\t\t${slnPath} = ${slnPath}${lineEnding}`;
                })
                .join('');

            if (existingSection) {
                const updatedBody = body.replace(
                    /ProjectSection\(SolutionItems\)\s*=\s*preProject([\s\S]*?)EndProjectSection/i,
                    section => section.replace(/EndProjectSection/i, `${lines}\tEndProjectSection`)
                );
                return `${updatedBody}${endProject}`;
            }

            return `${body}\tProjectSection(SolutionItems) = preProject${lineEnding}${lines}\tEndProjectSection${lineEnding}${endProject}`;
        });

        if (!changed) {
            vscode.window.showInformationMessage('The selected item(s) are already part of the Solution Folder.');
            return;
        }

        await vscode.workspace.fs.writeFile(solutionUri, Buffer.from(next, 'utf8'));
    }

    private addSolutionItemsToSlnx(text: string, folderPath: string[], items: string[]): string {
        const escapeXml = (value: string): string => value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const samePath = (left: string[], right: string[]): boolean =>
            left.length === right.length && left.every((part, index) => part === right[index]);

        const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
        const tokenRegex = /<\/?Folder\b[^>]*>|<File\b[^>]*\/?>/gi;
        const stack: Array<{ path: string[]; contentStart: number; indent: string }> = [];

        for (const tokenMatch of text.matchAll(tokenRegex)) {
            const token = tokenMatch[0];
            const tokenStart = tokenMatch.index ?? 0;

            if (/^<\/Folder/i.test(token)) {
                const frame = stack.pop();
                if (!frame || !samePath(frame.path, folderPath)) continue;

                const body = text.slice(frame.contentStart, tokenStart);
                const existing = new Set<string>();
                for (const match of body.matchAll(/<File\b[^>]*\bPath="([^"]+)"[^>]*\/?\s*>/gi)) {
                    existing.add(match[1].replace(/\\/g, '/'));
                }

                const additions = items.filter(item => !existing.has(item));
                if (!additions.length) return text;

                const closingLineStart = text.lastIndexOf('\n', tokenStart - 1) + 1;
                const childIndent = `${frame.indent}  `;
                const lines = additions
                    .map(item => `${childIndent}<File Path="${escapeXml(item)}" />`)
                    .join(lineEnding);

                return `${text.slice(0, closingLineStart)}${lines}${lineEnding}${text.slice(closingLineStart)}`;
            }

            if (!/^<Folder\b/i.test(token)) continue;

            const name = /\bName="([^"]+)"/i.exec(token)?.[1];
            const selfClosing = /\/\s*>$/.test(token);
            if (!name) continue;

            const parentPath = stack.length ? stack[stack.length - 1].path : [];
            const segments = this.normalizeSolutionFolderName(name);
            const absolute = /^[\\/]/.test(name);
            const nextPath = absolute ? segments : [...parentPath, ...segments];
            const lineStart = text.lastIndexOf('\n', tokenStart - 1) + 1;
            const indent = text.slice(lineStart, tokenStart);

            if (samePath(nextPath, folderPath) && selfClosing) {
                const childIndent = `${indent}  `;
                const lines = items
                    .map(item => `${childIndent}<File Path="${escapeXml(item)}" />`)
                    .join(lineEnding);
                const opening = token.replace(/\/\s*>$/, '>');
                const replacement = `${opening}${lineEnding}${lines}${lineEnding}${indent}</Folder>`;
                return `${text.slice(0, tokenStart)}${replacement}${text.slice(tokenStart + token.length)}`;
            }

            if (!selfClosing) {
                stack.push({
                    path: nextPath,
                    contentStart: tokenStart + token.length,
                    indent
                });
            }
        }

        return text;
    }

    private containerUri(uri: vscode.Uri, kind?: NodeKind): vscode.Uri {
        if (kind === 'folder') return uri;
        return vscode.Uri.file(path.dirname(uri.fsPath));
    }

    private async createProject(
        uri: vscode.Uri,
        kind: NodeKind | undefined,
        solutionFolderPath: string[],
        explicitSolutionUri?: vscode.Uri
    ): Promise<void> {
        if (kind !== 'solution' && kind !== 'solutionFolder') return;

        const solutionUri = explicitSolutionUri ?? uri;
        let templates: ReturnType<typeof parseDotnetProjectTemplates>;
        try {
            const { stdout } = await execFileAsync('dotnet', ['new', 'list', '--type', 'project', '--language', 'C#'], { cwd: path.dirname(solutionUri.fsPath) });
            templates = parseDotnetProjectTemplates(stdout.toString());
        } catch (error: any) {
            const detail = error?.stderr?.toString().trim() || error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to load installed .NET project templates: ${detail}`);
            return;
        }
        if (!templates.length) {
            vscode.window.showInformationMessage('dotnet new did not report any installed C# project templates.');
            return;
        }

        const template = await vscode.window.showQuickPick(templates, {
            title: 'New .NET Project',
            placeHolder: 'Select an installed dotnet new project template'
        });
        if (!template) return;

        const name = await vscode.window.showInputBox({
            title: `New ${template.label}`,
            prompt: 'Project name',
            validateInput: value => isValidSinglePathName(value.trim()) ? undefined : 'Enter a valid project name.'
        });
        if (!name?.trim()) return;

        const solutionRoot = path.dirname(solutionUri.fsPath);
        const physicalSolutionFolder = solutionFolderPath.length
            ? path.join(solutionRoot, ...solutionFolderPath)
            : solutionRoot;
        let physicalFolderExists = false;
        if (solutionFolderPath.length) {
            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(physicalSolutionFolder));
                physicalFolderExists = (stat.type & vscode.FileType.Directory) !== 0;
            } catch {
                physicalFolderExists = false;
            }
        }

        const projectRoot = resolveProjectRoot(solutionUri.fsPath, solutionFolderPath, physicalFolderExists);
        const projectDirectory = path.join(projectRoot, name.trim());
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(projectDirectory));
            vscode.window.showErrorMessage(`'${projectDirectory}' already exists.`);
            return;
        } catch {
            // Expected: target does not exist yet.
        }

        try {
            await execFileAsync('dotnet', ['new', template.template, '-n', name.trim(), '-o', projectDirectory], { cwd: projectRoot });
            const projectFile = await this.findCreatedProjectFile(projectDirectory);
            if (!projectFile) throw new Error('The template did not create a supported project file.');

            const addArgs = ['sln', solutionUri.fsPath, 'add', projectFile];
            if (kind === 'solutionFolder' && solutionFolderPath.length) {
                addArgs.push('--solution-folder', solutionFolderPath.join('/'));
            }
            await execFileAsync('dotnet', addArgs, { cwd: solutionRoot });

            const projectXml = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(projectFile))).toString('utf8');
            if (isExecutableProject(projectXml)) {
                await this.addExecutableProjectConfiguration(solutionUri, projectFile, projectXml, name.trim());
            }

            await this.refresh();
            vscode.window.showInformationMessage(`Created project '${name.trim()}'.`);
        } catch (error: any) {
            const detail = error?.stderr?.toString().trim() || error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to create project: ${detail}`);
        }
    }

    private async findCreatedProjectFile(projectDirectory: string): Promise<string | undefined> {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectDirectory));
        const project = entries.find(([name, type]) =>
            type === vscode.FileType.File && /\.(csproj|fsproj|vbproj)$/i.test(name)
        );
        return project ? path.join(projectDirectory, project[0]) : undefined;
    }

    private async addExecutableProjectConfiguration(
        solutionUri: vscode.Uri,
        projectFile: string,
        projectXml: string,
        projectName: string
    ): Promise<void> {
        const solutionRoot = path.dirname(solutionUri.fsPath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(solutionUri)
            ?? vscode.workspace.workspaceFolders?.[0];
        const configRoot = workspaceFolder?.uri.fsPath ?? solutionRoot;
        const relativeProject = path.relative(configRoot, projectFile).replace(/\\/g, '/');
        const projectDirectory = path.dirname(relativeProject).replace(/\\/g, '/');
        const targetFramework = getTargetFramework(projectXml);
        const assemblyName = getAssemblyName(projectXml, projectFile);
        const taskLabel = `build ${projectName}`;

        const task = {
            label: taskLabel,
            type: 'process',
            command: 'dotnet',
            args: ['build', `\${workspaceFolder}/${relativeProject}`],
            problemMatcher: '$msCompile',
            group: 'build'
        };

        let launch: Record<string, unknown>;
        if (targetFramework) {
            const output = projectDirectory === '.' ? '' : `${projectDirectory}/`;
            launch = {
                name: projectName,
                type: 'coreclr',
                request: 'launch',
                preLaunchTask: taskLabel,
                program: `\${workspaceFolder}/${output}bin/Debug/${targetFramework}/${assemblyName}.dll`,
                cwd: `\${workspaceFolder}/${projectDirectory === '.' ? '' : projectDirectory}`,
                console: 'integratedTerminal'
            };
        } else {
            launch = {
                name: projectName,
                type: 'coreclr',
                request: 'launch',
                preLaunchTask: taskLabel,
                program: 'dotnet',
                args: ['run', '--project', `\${workspaceFolder}/${relativeProject}`],
                cwd: `\${workspaceFolder}/${projectDirectory === '.' ? '' : projectDirectory}`,
                console: 'integratedTerminal'
            };
        }

        const vscodeDirectory = vscode.Uri.file(path.join(configRoot, '.vscode'));
        await vscode.workspace.fs.createDirectory(vscodeDirectory);
        await this.appendVsCodeConfiguration(
            vscode.Uri.joinPath(vscodeDirectory, 'tasks.json'),
            'tasks',
            task,
            { version: '2.0.0', tasks: [] },
            value => value?.label === taskLabel
        );
        await this.appendVsCodeConfiguration(
            vscode.Uri.joinPath(vscodeDirectory, 'launch.json'),
            'configurations',
            launch,
            { version: '0.2.0', configurations: [] },
            value => value?.name === projectName
        );
    }

    private async appendVsCodeConfiguration(
        uri: vscode.Uri,
        property: string,
        value: Record<string, unknown>,
        emptyDocument: Record<string, unknown>,
        isDuplicate: (value: any) => boolean
    ): Promise<void> {
        let text: string | undefined;
        try {
            text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        } catch {
            // File does not exist yet.
        }

        if (!text) {
            const document = { ...emptyDocument, [property]: [value] };
            await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8'));
            return;
        }

        // Duplicate detection deliberately tolerates JSONC comments/trailing commas.
        const comparable = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1');
        try {
            const parsed = JSON.parse(comparable);
            if (Array.isArray(parsed?.[property]) && parsed[property].some(isDuplicate)) return;
        } catch {
            // Keep the user's file intact; the structural insertion below can still work with JSONC.
        }

        const objectText = JSON.stringify(value, null, 2);
        const updated = appendObjectToJsoncArray(text, property, objectText);
        if (!updated) {
            vscode.window.showWarningMessage(`Could not update ${path.basename(uri.fsPath)} automatically. The project was created successfully.`);
            return;
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
    }

    private findDevKitCommand(searchTerms: string[]): string | undefined {
        const extension = vscode.extensions.getExtension('ms-dotnettools.csdevkit');
        const commands = extension?.packageJSON?.contributes?.commands as CommandContribution[] | undefined;
        if (!Array.isArray(commands)) return undefined;
        const terms = searchTerms.map(x => x.toLowerCase());
        return commands.find(c => terms.every(t => `${c.category ?? ''} ${c.title ?? ''}`.toLowerCase().includes(t)))?.command;
    }

    private async createSolutionFolder(
        uri: vscode.Uri,
        parentPath: string[] = []
    ): Promise<void> {
        const name = await vscode.window.showInputBox({
            title: 'New Solution Folder',
            prompt: parentPath.length
                ? `Folder name below ${parentPath.join(' / ')}`
                : 'Folder name'
        });
        if (!name?.trim()) return;

        const folderName = name.trim();
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

        if (uri.fsPath.toLowerCase().endsWith('.slnx')) {
            const fullPath = [...parentPath, folderName];
            const escapedPath = fullPath
                .map(part => part
                    .replace(/&/g, '&amp;')
                    .replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;'))
                .join('/');
            const insert = `  <Folder Name="/${escapedPath}/" />\n`;
            const next = text.replace(/<\/Solution>\s*$/i, `${insert}</Solution>\n`);
            await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
            await this.refresh();
            return;
        }

        const folderTypeGuid = '66A26720-8FB5-11D2-AA7E-00C04F688DDE';
        const guid = crypto.randomUUID().toUpperCase();
        const block =
            `Project("{${folderTypeGuid}}") = "${folderName}", "${folderName}", "{${guid}}"\r\n` +
            `EndProject\r\n`;

        let next = text.replace(/^Global\r?$/m, `${block}Global`);

        if (parentPath.length) {
            const parentGuid = this.findSolutionFolderGuid(next, parentPath);
            if (!parentGuid) {
                vscode.window.showErrorMessage(
                    `Could not resolve parent Solution Folder '${parentPath.join(' / ')}'.`
                );
                return;
            }

            const nestedLine = `\t\t{${guid}} = {${parentGuid}}\r\n`;
            const nestedSection = /GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/;

            if (nestedSection.test(next)) {
                next = next.replace(
                    nestedSection,
                    (_match: string, body: string) =>
                        `GlobalSection(NestedProjects) = preSolution${body}${nestedLine}\tEndGlobalSection`
                );
            } else {
                next = next.replace(
                    /\tEndGlobal\r?$/m,
                    `\tGlobalSection(NestedProjects) = preSolution\r\n${nestedLine}\tEndGlobalSection\r\n\tEndGlobal`
                );
            }
        }

        await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
        await this.refresh();
    }

    private findSolutionFolderGuid(text: string, targetPath: string[]): string | undefined {
        const folderNames = new Map<string, string>();
        const nested = new Map<string, string>();

        const projectRegex = /^Project\("\{[^}]+\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([^}]+)\}"/gm;
        for (const match of text.matchAll(projectRegex)) {
            const name = match[1];
            const projectPath = match[2];
            const guid = match[3].toUpperCase();

            if (!/\.(csproj|fsproj|vbproj)$/i.test(projectPath)) {
                folderNames.set(guid, name);
            }
        }

        const nestedSection = text.match(
            /GlobalSection\(NestedProjects\)\s*=\s*preSolution([\s\S]*?)EndGlobalSection/
        );
        if (nestedSection) {
            for (const match of nestedSection[1].matchAll(/\{([^}]+)\}\s*=\s*\{([^}]+)\}/g)) {
                nested.set(match[1].toUpperCase(), match[2].toUpperCase());
            }
        }

        const buildPath = (guid: string): string[] => {
            const result: string[] = [];
            let current: string | undefined = guid;
            const guard = new Set<string>();

            while (current && !guard.has(current)) {
                guard.add(current);
                const name = folderNames.get(current);
                if (name) result.unshift(...this.normalizeSolutionFolderName(name));
                current = nested.get(current);
            }

            return result;
        };

        for (const guid of folderNames.keys()) {
            const folderPath = buildPath(guid);
            if (
                folderPath.length === targetPath.length &&
                folderPath.every((part, index) => part === targetPath[index])
            ) {
                return guid;
            }
        }

        return undefined;
    }

    private normalizeSolutionFolderName(name: string): string[] {
        return name
            .replace(/\\/g, '/')
            .split('/')
            .map(part => part.trim())
            .filter(Boolean);
    }

    private async deleteSolutionFolder(
        solutionUri: vscode.Uri,
        folderPath: string[]
    ): Promise<void> {
        if (!folderPath.length) return;

        const raw = Buffer.from(await vscode.workspace.fs.readFile(solutionUri)).toString('utf8');

        if (solutionUri.fsPath.toLowerCase().endsWith('.slnx')) {
            const normalizedPath = `/${folderPath.join('/')}/`;
            const escaped = normalizedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // AOH-created and many modern .slnx Solution Folders are self-closing.
            let next = raw.replace(
                new RegExp(`^[ \\t]*<Folder\\b[^>]*\\bName="${escaped}"[^>]*/>[ \\t]*\\r?\\n?`, 'gmi'),
                ''
            );

            // Also support a normal folder block. Removing it removes only solution
            // membership/organisation; physical files are untouched.
            next = next.replace(
                new RegExp(
                    `<Folder\\b[^>]*\\bName="${escaped}"[^>]*>[\\s\\S]*?<\\/Folder>`,
                    'gi'
                ),
                ''
            );

            if (next === raw) {
                vscode.window.showErrorMessage(
                    `Could not find Solution Folder '${folderPath.join(' / ')}' in the .slnx file.`
                );
                return;
            }

            await vscode.workspace.fs.writeFile(solutionUri, Buffer.from(next, 'utf8'));
            await this.refresh();
            return;
        }

        const guid = this.findSolutionFolderGuid(raw, folderPath);
        if (!guid) {
            vscode.window.showErrorMessage(
                `Could not resolve Solution Folder '${folderPath.join(' / ')}'.`
            );
            return;
        }

        const guidEscaped = guid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Remove the Solution Folder project block itself.
        let next = raw.replace(
            new RegExp(
                `^Project\\("\\{[^}]+\\}"\\)\\s*=\\s*"[^"]+",\\s*"[^"]+",\\s*"\\{${guidEscaped}\\}"[\\s\\S]*?^EndProject\\r?\\n?`,
                'gmi'
            ),
            ''
        );

        // Remove nesting relations that point to or originate from the deleted folder.
        next = next.replace(
            new RegExp(
                `^[ \\t]*\\{${guidEscaped}\\}\\s*=\\s*\\{[^}]+\\}[ \\t]*\\r?\\n?`,
                'gmi'
            ),
            ''
        );
        next = next.replace(
            new RegExp(
                `^[ \\t]*\\{[^}]+\\}\\s*=\\s*\\{${guidEscaped}\\}[ \\t]*\\r?\\n?`,
                'gmi'
            ),
            ''
        );

        await vscode.workspace.fs.writeFile(solutionUri, Buffer.from(next, 'utf8'));
        await this.refresh();
    }

    private async addProjectReference(projectUri: vscode.Uri, solutionUri?: vscode.Uri): Promise<void> {
        if (!solutionUri) {
            vscode.window.showErrorMessage('Could not determine the solution for this project.');
            return;
        }

        const candidates = await this.getSolutionProjects(solutionUri);
        const current = path.resolve(projectUri.fsPath);
        const existing = await this.getExistingProjectReferences(projectUri);

        const available = candidates.filter(candidate => {
            const resolved = path.resolve(candidate.fsPath);
            return resolved !== current && !existing.has(this.normalizePath(resolved));
        });

        if (!available.length) {
            vscode.window.showInformationMessage('There are no projects available to add as a reference.');
            return;
        }

        const picked = await vscode.window.showQuickPick(
            available.map(candidate => ({
                label: path.basename(candidate.fsPath, path.extname(candidate.fsPath)),
                description: path.relative(path.dirname(solutionUri.fsPath), candidate.fsPath),
                uri: candidate
            })),
            {
                title: `Add Project Reference to ${path.basename(projectUri.fsPath, path.extname(projectUri.fsPath))}`,
                placeHolder: 'Select a project from the current solution'
            }
        );
        if (!picked) return;

        try {
            await execFileAsync(
                'dotnet',
                ['add', projectUri.fsPath, 'reference', picked.uri.fsPath],
                { cwd: path.dirname(projectUri.fsPath) }
            );
            await this.refresh();
        } catch (error: any) {
            const detail = error?.stderr?.toString().trim() || error?.message || String(error);
            vscode.window.showErrorMessage(`Failed to add project reference: ${detail}`);
        }
    }

    private async getSolutionProjects(solutionUri: vscode.Uri): Promise<vscode.Uri[]> {
        const text = Buffer.from(await vscode.workspace.fs.readFile(solutionUri)).toString('utf8');
        const solutionDir = path.dirname(solutionUri.fsPath);
        const projectPaths = new Set<string>();

        if (solutionUri.fsPath.toLowerCase().endsWith('.slnx')) {
            for (const match of text.matchAll(/<Project\b[^>]*\bPath="([^"]+\.(?:csproj|fsproj|vbproj))"/gi)) {
                projectPaths.add(match[1]);
            }
        } else {
            for (const match of text.matchAll(/^Project\([^\r\n]*?\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.(?:csproj|fsproj|vbproj))"/gmi)) {
                projectPaths.add(match[1]);
            }
        }

        return [...projectPaths].map(projectPath =>
            vscode.Uri.file(path.resolve(solutionDir, projectPath.replace(/[\\/]/g, path.sep)))
        );
    }

    private async getExistingProjectReferences(projectUri: vscode.Uri): Promise<Set<string>> {
        const text = Buffer.from(await vscode.workspace.fs.readFile(projectUri)).toString('utf8');
        const projectDir = path.dirname(projectUri.fsPath);
        const result = new Set<string>();

        for (const match of text.matchAll(/<ProjectReference\b[^>]*\bInclude="([^"]+)"/gi)) {
            result.add(this.normalizePath(path.resolve(projectDir, match[1].replace(/[\\/]/g, path.sep))));
        }

        return result;
    }

    private normalizePath(value: string): string {
        const normalized = path.normalize(value);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    private async runDotnet(title: string, contextUri: vscode.Uri, args: string[], cwd: string): Promise<void> {
        const terminal = vscode.window.createTerminal({ name: title, cwd });
        terminal.show();
        terminal.sendText(['dotnet', ...args.map(x => this.shellQuote(x))].join(' '), true);
    }

    private shellQuote(value: string): string {
        if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
        return process.platform === 'win32' ? `\"${value.replace(/\"/g, '\"\"')}\"` : `'${value.replace(/'/g, `'\\''`)}'`;
    }
}
