export const TREE_MIME = 'application/vnd.code.tree.aoh.solutionexplorer.view';
export const LEGACY_TREE_MIME = 'application/vnd.aoh.solution-explorer.nodes';
export const URI_LIST_MIME = 'text/uri-list';

export interface DragPayload {
    uri: string;
    kind: 'file' | 'folder' | 'project' | 'solutionFolder';
    solutionUri?: string;
    solutionFolderPath?: string[];
}

/** Native tree metadata is not an extension payload; allow URI-list fallback. */
export function parseDragPayload(raw: string): DragPayload[] | undefined {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return undefined; }
    if (!Array.isArray(value)) return undefined;
    if (!value.every(entry => entry && typeof entry.uri === 'string' &&
        ['file', 'folder', 'project', 'solutionFolder'].includes(entry.kind) &&
        (entry.solutionUri === undefined || typeof entry.solutionUri === 'string') &&
        (entry.solutionFolderPath === undefined || (Array.isArray(entry.solutionFolderPath) && entry.solutionFolderPath.every((part: unknown) => typeof part === 'string'))))) {
        throw new Error('The dragged selection contains invalid items.');
    }
    return value;
}
