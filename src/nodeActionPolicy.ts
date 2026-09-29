import type { NodeKind } from './types';

/** Validate node identity before turning tree selections into filesystem targets. */
export function allowsNodeAction(action: string, kind: NodeKind | undefined): boolean {
    const physical = kind === 'file' || kind === 'folder';
    switch (action) {
        case 'adjustNamespaces':
            return physical || kind === 'project' || kind === 'solution' || kind === 'solutionFolder';
        case 'rename':
        case 'cut':
        case 'copy':
        case 'duplicate':
            return physical;
        case 'delete':
            return physical || kind === 'project' || kind === 'solutionFolder';
        case 'newFile':
        case 'newFolder':
            return physical || kind === 'project';
        case 'paste':
            return physical || kind === 'project' || kind === 'solutionFolder';
        default:
            return true;
    }
}

export function allowsNodeSelection(action: string, kinds: NodeKind[]): boolean {
    if (!kinds.every(kind => allowsNodeAction(action, kind))) return false;
    // Logical removals have individual handlers; never fall back to deleting their URIs.
    return action !== 'delete' || kinds.length <= 1 ||
        kinds.every(kind => kind === 'file' || kind === 'folder');
}
