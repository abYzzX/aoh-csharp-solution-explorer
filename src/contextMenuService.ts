import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { CommandContribution, DynamicContextMenuItem, ExplorerMenuContribution, NodeKind } from './types';

export class ContextMenuService {
    constructor(private readonly refresh: () => Promise<void>) {}

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
                const addReference = this.findDevKitMenuItem(['add', 'project', 'reference']);
                if (addReference) {
                    addChildren.push(this.separator(), { ...addReference, label: 'Reference...' });
                }

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

        if (action.startsWith('command:')) {
            const command = action.slice('command:'.length);
            try { await vscode.commands.executeCommand(command, uri); }
            catch (error) { vscode.window.showErrorMessage(`Command '${command}' failed: ${String(error)}`); }
            return;
        }

        const containerUri = this.containerUri(uri, kind);
        switch (action) {
            case 'newDotNetFile': {
                const command = this.findDevKitCommand(['new', '.net', 'file']);
                if (!command) {
                    vscode.window.showErrorMessage('C# Dev Kit does not expose a New .NET File command.');
                    return;
                }
                await vscode.commands.executeCommand(command, uri);
                return;
            }
            case 'addProjectReference': {
                const command = this.findDevKitCommand(['add', 'project', 'reference']);
                if (!command) {
                    vscode.window.showErrorMessage('C# Dev Kit does not expose Add Project Reference.');
                    return;
                }
                await vscode.commands.executeCommand(command, uri);
                return;
            }
            case 'newProject': {
                const command = this.findDevKitCommand(['new', 'project']) ?? this.findDevKitCommand(['create', 'project']);
                if (!command) {
                    vscode.window.showErrorMessage('C# Dev Kit does not expose a New Project command.');
                    return;
                }
                await vscode.commands.executeCommand(command, uri); await this.refresh(); return;
            }
            case 'newSolutionFolder':
                return this.createSolutionFolder(uri, solutionFolderPath);
            case 'addExistingProject': {
                const pick = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { '.NET Projects': ['csproj','fsproj','vbproj'] } });
                if (!pick?.length) return;
                for (const project of pick) await this.runDotnet('Add project', uri, ['sln', uri.fsPath, 'add', project.fsPath], path.dirname(uri.fsPath));
                await this.refresh(); return;
            }
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
            case 'copyPath': await vscode.env.clipboard.writeText(uri.fsPath); return;
            case 'copyRelativePath': {
                const folder = vscode.workspace.getWorkspaceFolder(uri);
                await vscode.env.clipboard.writeText(folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath)); return;
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

                const choice = await vscode.window.showWarningMessage(
                    `Delete '${path.basename(uri.fsPath)}'?`,
                    { modal: true },
                    'Delete'
                );
                if (choice === 'Delete') {
                    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
                    await this.refresh();
                }
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

    private containerUri(uri: vscode.Uri, kind?: NodeKind): vscode.Uri {
        if (kind === 'folder') return uri;
        return vscode.Uri.file(path.dirname(uri.fsPath));
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
