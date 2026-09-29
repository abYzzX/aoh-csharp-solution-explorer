/** Roslyn protocol data used to identify the refactoring independently of UI language. */
export const syncNamespaceProvider = 'Sync Namespace and Folder Name Code Action Provider';

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspTextEdit { range: LspRange; newText: string }
export interface LspTextDocumentEdit {
    textDocument: { uri: string; version?: number | null };
    edits: LspTextEdit[];
}
export interface LspWorkspaceEdit {
    changes?: Record<string, LspTextEdit[]>;
    documentChanges?: Array<LspTextDocumentEdit | { kind: string }>;
}
export interface RoslynCodeAction {
    title: string;
    kind?: string;
    disabled?: { reason: string };
    command?: unknown;
    edit?: LspWorkspaceEdit;
    data?: {
        CustomTags?: string[];
        FixAllFlavors?: string[];
        NestedCodeActions?: RoslynCodeAction[];
    };
}

export function isNamespaceAction(action: RoslynCodeAction): boolean {
    return !action.disabled && !action.command && !action.data?.FixAllFlavors &&
        !action.data?.NestedCodeActions?.length &&
        !!action.data?.CustomTags?.includes(syncNamespaceProvider);
}

function comparableUri(uri: string): string {
    // Roslyn and VS Code differ in percent-encoding and Windows drive-letter casing.
    return decodeURIComponent(uri).replace(/^file:\/\/\/([A-Z]):/, (_, drive: string) => `file:///${drive.toLowerCase()}:`);
}

/** Never execute the sibling "Move file" action, or an unrelated server command. */
export function namespaceTextChanges(action: RoslynCodeAction, documentUri: string): LspTextDocumentEdit[] | undefined {
    if (action.command || !action.edit) return undefined;
    const result: LspTextDocumentEdit[] = [];
    for (const change of action.edit.documentChanges ?? []) {
        if ('kind' in change) return undefined;
        result.push(change);
    }
    for (const [uri, edits] of Object.entries(action.edit.changes ?? {})) {
        result.push({ textDocument: { uri }, edits });
    }
    // Changing a namespace must edit the selected document, not just other files.
    return result.some(change => comparableUri(change.textDocument.uri) === comparableUri(documentUri) && change.edits.length) ? result : undefined;
}
