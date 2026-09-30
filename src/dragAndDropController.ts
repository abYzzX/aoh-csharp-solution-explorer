import * as path from 'path';
import * as vscode from 'vscode';
import { WebNode } from './types';
import { moveSolutionEntries, SolutionMove } from './solutionMoveUtils';
import { parseDragPayload, DragPayload, TREE_MIME, URI_LIST_MIME, LEGACY_TREE_MIME } from './dragAndDropUtils';

export class SolutionExplorerDragAndDropController implements vscode.TreeDragAndDropController<WebNode> {
    readonly dragMimeTypes = [TREE_MIME, URI_LIST_MIME];
    readonly dropMimeTypes = [TREE_MIME, LEGACY_TREE_MIME, URI_LIST_MIME];

    constructor(
        private readonly log: (message: string) => void = () => {},
        private readonly refresh: () => Promise<void> = async () => {}
    ) {}

    handleDrag(source: readonly WebNode[], dataTransfer: vscode.DataTransfer): void {
        const payload = source.filter(node => node.uri && ['file', 'folder', 'project', 'solutionFolder'].includes(node.kind))
            .map(node => ({ uri: node.uri!, kind: node.kind, solutionUri: node.solutionUri, solutionFolderPath: node.solutionFolderPath }));
        // Use the native tree MIME so VS Code preserves our data for same-tree drops.
        dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
        const files = payload.filter(node => node.kind === 'file' || node.kind === 'folder');
        if (files.length) dataTransfer.set(URI_LIST_MIME, new vscode.DataTransferItem(files.map(node => node.uri).join('\r\n')));
        this.log(`Drag & drop: dragging ${payload.length} item(s).`);
    }

    async handleDrop(target: WebNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        try {
            if (!target?.uri) throw new Error('Drop onto a project, folder or solution.');
            this.log(`Drag & drop: target ${target.kind} '${target.label}', types: ${[...dataTransfer].map(([type]) => type).join(', ')}.`);
            let payload: DragPayload[] | undefined;
            for (const type of [TREE_MIME, LEGACY_TREE_MIME]) {
                const item = dataTransfer.get(type);
                if (!item) continue;
                const raw = await item.asString();
                if (raw) payload = parseDragPayload(raw);
                if (payload) break;
            }
            if (!payload) {
                const item = dataTransfer.get(URI_LIST_MIME);
                if (!item) throw new Error('The drag did not contain supported files or solution items.');
                payload = [];
                for (const line of (await item.asString()).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))) {
                    const uri = vscode.Uri.parse(line).with({ fragment: '' });
                    if (uri.scheme !== 'file') throw new Error('Only local filesystem items can be moved.');
                    const stat = await vscode.workspace.fs.stat(uri);
                    payload.push({ uri: uri.toString(), kind: stat.type & vscode.FileType.Directory ? 'folder' : 'file' });
                }
            }
            if (!payload.length) return;
            if (target.kind === 'solution' || target.kind === 'solutionFolder' ||
                payload.some(entry => entry.kind === 'project' || entry.kind === 'solutionFolder' || entry.solutionFolderPath?.length)) {
                await this.moveLogicalItems(target, payload);
            } else {
                await this.moveFiles(target, payload);
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.log(`Drag & drop failed: ${detail}`);
            void vscode.window.showErrorMessage(`AOH Solution Explorer: ${detail}`);
        }
    }

    private async moveLogicalItems(target: WebNode, payload: DragPayload[]): Promise<void> {
        if (target.kind !== 'solution' && target.kind !== 'solutionFolder') throw new Error('Drop projects and Solution Folders onto a Solution or Solution Folder.');
        const solutionUri = vscode.Uri.parse(target.uri!);
        if (target.kind === 'solutionFolder' && !target.solutionFolderPath?.length) throw new Error('Could not resolve the target Solution Folder.');
        const sources: SolutionMove[] = payload.map(entry => {
            if (entry.kind === 'file' && (!entry.solutionFolderPath?.length || target.kind !== 'solutionFolder')) {
                throw new Error('Files can only be reorganized from one Solution Folder to another.');
            }
            if (entry.kind !== 'project' && entry.kind !== 'solutionFolder' && entry.kind !== 'file') throw new Error('Physical folders cannot be moved into Solution Folders.');
            const owner = entry.kind === 'solutionFolder' ? entry.uri : entry.solutionUri;
            if (!owner || !this.samePath(vscode.Uri.parse(owner).fsPath, solutionUri.fsPath)) throw new Error('Solution items can only be reorganized within their own solution.');
            if (entry.kind === 'project') return { kind: 'project', projectPath: vscode.Uri.parse(entry.uri).fsPath };
            if (entry.kind === 'file') return { kind: 'solutionItem', filePath: vscode.Uri.parse(entry.uri).fsPath, folderPath: entry.solutionFolderPath! };
            if (!entry.solutionFolderPath?.length) throw new Error('Could not resolve the dragged Solution Folder.');
            return { kind: 'solutionFolder', folderPath: entry.solutionFolderPath };
        });
        const document = await vscode.workspace.openTextDocument(solutionUri);
        const before = document.getText();
        const version = document.version;
        const after = moveSolutionEntries(before, solutionUri.fsPath, sources, target.kind === 'solutionFolder' ? target.solutionFolderPath ?? [] : []);
        if (before === after || !await this.confirm(payload.length, target.label, true)) return;
        if (document.version !== version) throw new Error('The solution changed during the move. Please try again.');
        const edit = new vscode.WorkspaceEdit();
        edit.replace(solutionUri, new vscode.Range(document.positionAt(0), document.positionAt(before.length)), after);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not update the solution.');
        if (!await document.save()) throw new Error('Could not save the solution. The change remains in the editor.');
        await this.refresh();
        this.log(`Drag & drop: reorganized ${payload.length} solution item(s) under '${target.label}'.`);
    }

    private async moveFiles(target: WebNode, payload: DragPayload[]): Promise<void> {
        if (!['folder', 'project', 'file'].includes(target.kind)) throw new Error('Drop files onto a physical folder or project.');
        if (target.kind === 'file' && target.solutionFolderPath?.length) throw new Error('Drop solution items onto their target Solution Folder.');
        const targetUri = vscode.Uri.parse(target.uri!);
        if (targetUri.scheme !== 'file') throw new Error('Only local filesystem items can be moved.');
        const targetDirectory = target.kind === 'folder' ? targetUri : vscode.Uri.file(path.dirname(targetUri.fsPath));
        const sources: Array<DragPayload & { uriObject: vscode.Uri }> = [];
        for (const entry of payload) {
            const uriObject = vscode.Uri.parse(entry.uri);
            if (uriObject.scheme !== 'file') throw new Error('Only local filesystem items can be moved.');
            if (/\.(?:csproj|fsproj|vbproj|sln|slnx)$/i.test(uriObject.fsPath)) throw new Error('Project and solution files cannot be moved as physical files.');
            // Validate the actual filesystem kind rather than trusting transfer data.
            const stat = await vscode.workspace.fs.stat(uriObject);
            sources.push({ ...entry, kind: stat.type & vscode.FileType.Directory ? 'folder' : 'file', uriObject });
        }
        const kept: typeof sources = [];
        for (const source of sources.sort((a, b) => a.uriObject.fsPath.length - b.uriObject.fsPath.length)) {
            if (!kept.some(parent => this.samePath(source.uriObject.fsPath, parent.uriObject.fsPath) ||
                (parent.kind === 'folder' && this.isInside(source.uriObject.fsPath, parent.uriObject.fsPath)))) kept.push(source);
        }
        const edit = new vscode.WorkspaceEdit();
        const destinations = new Set<string>();
        for (const source of kept) {
            const destination = vscode.Uri.joinPath(targetDirectory, path.basename(source.uriObject.fsPath));
            if (this.samePath(source.uriObject.fsPath, destination.fsPath)) continue;
            if (source.kind === 'folder' && this.isInside(destination.fsPath, source.uriObject.fsPath)) throw new Error(`Cannot move '${path.basename(source.uriObject.fsPath)}' into itself.`);
            const key = this.normalizePath(destination.fsPath);
            if (destinations.has(key) || await this.exists(destination)) throw new Error(`Cannot move '${path.basename(source.uriObject.fsPath)}': '${destination.fsPath}' already exists.`);
            destinations.add(key);
            edit.renameFile(source.uriObject, destination, { overwrite: false, ignoreIfExists: false });
        }
        if (!destinations.size || !await this.confirm(destinations.size, path.basename(targetDirectory.fsPath))) return;
        if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not move the selected item(s).');
        await this.refresh();
        this.log(`Drag & drop: moved ${destinations.size} item(s) to ${targetDirectory.fsPath}`);
    }

    private async confirm(count: number, target: string, logical = false): Promise<boolean> {
        if (!vscode.workspace.getConfiguration('aoh.solutionExplorer').get<boolean>('dragAndDrop.confirm', true)) return true;
        return await vscode.window.showWarningMessage(
            `Move ${count} item${count === 1 ? '' : 's'} to '${target}'?`,
            { modal: true, detail: logical ? 'Only solution organization changes. Project files and directories stay in place.' : undefined }, 'Move'
        ) === 'Move';
    }

    private async exists(uri: vscode.Uri): Promise<boolean> {
        try { await vscode.workspace.fs.stat(uri); return true; }
        catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return false;
            throw error;
        }
    }
    private samePath(left: string, right: string): boolean { return this.normalizePath(left) === this.normalizePath(right); }
    private isInside(candidate: string, parent: string): boolean {
        const relative = path.relative(this.normalizePath(parent), this.normalizePath(candidate));
        return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }
    private normalizePath(value: string): string {
        const normalized = path.normalize(value);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
}
