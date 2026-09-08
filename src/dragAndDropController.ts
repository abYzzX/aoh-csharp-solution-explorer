import * as path from 'path';
import * as vscode from 'vscode';
import { WebNode } from './types';

const AOH_TREE_MIME = 'application/vnd.aoh.solution-explorer.nodes';

interface DragPayload {
    uri: string;
    kind: 'file' | 'folder';
}

export class SolutionExplorerDragAndDropController implements vscode.TreeDragAndDropController<WebNode> {
    readonly dragMimeTypes = [AOH_TREE_MIME];
    readonly dropMimeTypes = [AOH_TREE_MIME];

    constructor(private readonly log: (message: string) => void = () => {}) {}

    handleDrag(source: readonly WebNode[], dataTransfer: vscode.DataTransfer): void {
        const payload = source
            .filter((node): node is WebNode & { kind: 'file' | 'folder'; uri: string } =>
                (node.kind === 'file' || node.kind === 'folder') && Boolean(node.uri)
            )
            .filter(node => !this.isProjectOrSolutionFile(vscode.Uri.parse(node.uri)))
            .map(node => ({ uri: node.uri, kind: node.kind } satisfies DragPayload));

        if (!payload.length) return;
        dataTransfer.set(AOH_TREE_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
    }

    async handleDrop(target: WebNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        if (!target || (target.kind !== 'folder' && target.kind !== 'project')) return;

        const item = dataTransfer.get(AOH_TREE_MIME);
        if (!item) return;

        let payload: DragPayload[];
        try {
            const raw = await item.asString();
            payload = JSON.parse(raw) as DragPayload[];
        } catch {
            return;
        }

        if (!Array.isArray(payload) || !payload.length) return;

        const targetDirectory = this.getTargetDirectory(target);
        if (!targetDirectory) return;

        const sources = this.removeNestedSelections(
            payload
                .filter(entry => entry && (entry.kind === 'file' || entry.kind === 'folder') && typeof entry.uri === 'string')
                .map(entry => ({ ...entry, uriObject: vscode.Uri.parse(entry.uri) }))
                .filter(entry => entry.uriObject.scheme === 'file')
                .filter(entry => !this.isProjectOrSolutionFile(entry.uriObject))
        );

        if (!sources.length) return;

        const edit = new vscode.WorkspaceEdit();
        const destinationKeys = new Set<string>();
        let moveCount = 0;

        for (const source of sources) {
            const sourceUri = source.uriObject;
            const destinationUri = vscode.Uri.joinPath(targetDirectory, path.basename(sourceUri.fsPath));

            if (this.samePath(sourceUri.fsPath, destinationUri.fsPath)) continue;

            if (source.kind === 'folder' && this.isInside(destinationUri.fsPath, sourceUri.fsPath)) {
                void vscode.window.showWarningMessage(`Cannot move '${path.basename(sourceUri.fsPath)}' into itself.`);
                return;
            }

            const destinationKey = this.normalizePath(destinationUri.fsPath);
            if (destinationKeys.has(destinationKey) || await this.exists(destinationUri)) {
                void vscode.window.showWarningMessage(`Cannot move '${path.basename(sourceUri.fsPath)}': '${destinationUri.fsPath}' already exists.`);
                return;
            }

            destinationKeys.add(destinationKey);
            edit.renameFile(sourceUri, destinationUri, { overwrite: false, ignoreIfExists: false });
            moveCount++;
        }

        if (!moveCount) return;

        const confirmMove = vscode.workspace
            .getConfiguration('aoh.solutionExplorer')
            .get<boolean>('dragAndDrop.confirm', true);

        if (confirmMove) {
            const targetName = path.basename(targetDirectory.fsPath) || targetDirectory.fsPath;
            const itemLabel = moveCount === 1 ? 'item' : 'items';
            const choice = await vscode.window.showWarningMessage(
                `Move ${moveCount} ${itemLabel} to '${targetName}'?`,
                { modal: true },
                'Move'
            );

            if (choice !== 'Move') return;
        }

        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            void vscode.window.showErrorMessage('AOH Solution Explorer could not move the selected item(s).');
            return;
        }

        this.log(`Drag & drop: moved ${moveCount} item${moveCount === 1 ? '' : 's'} to ${targetDirectory.fsPath}`);
    }

    private getTargetDirectory(target: WebNode): vscode.Uri | undefined {
        if (!target.uri) return undefined;

        const uri = vscode.Uri.parse(target.uri);
        if (uri.scheme !== 'file') return undefined;

        if (target.kind === 'folder') return uri;
        if (target.kind === 'project') return vscode.Uri.file(path.dirname(uri.fsPath));
        return undefined;
    }

    private removeNestedSelections<T extends DragPayload & { uriObject: vscode.Uri }>(entries: T[]): T[] {
        const ordered = [...entries].sort((a, b) => a.uriObject.fsPath.length - b.uriObject.fsPath.length);
        const kept: T[] = [];

        for (const entry of ordered) {
            const nestedUnderSelectedFolder = kept.some(parent =>
                parent.kind === 'folder' && this.isInside(entry.uriObject.fsPath, parent.uriObject.fsPath)
            );
            if (!nestedUnderSelectedFolder) kept.push(entry);
        }

        return kept;
    }

    private isProjectOrSolutionFile(uri: vscode.Uri): boolean {
        return /\.(?:csproj|fsproj|vbproj|sln|slnx)$/i.test(uri.fsPath);
    }

    private async exists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    private samePath(left: string, right: string): boolean {
        return this.normalizePath(left) === this.normalizePath(right);
    }

    private isInside(candidate: string, parent: string): boolean {
        const relative = path.relative(parent, candidate);
        return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }

    private normalizePath(value: string): string {
        const normalized = path.normalize(value);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
}
