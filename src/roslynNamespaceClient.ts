import * as vscode from 'vscode';
import { isNamespaceAction, namespaceTextChanges, LspPosition, LspRange, RoslynCodeAction } from './namespaceCodeActions';

interface DocumentSymbol {
    name: string;
    kind: number;
    selectionRange: LspRange;
    children?: DocumentSymbol[];
}

interface CSharpExports {
    initializationFinished?: () => Promise<void>;
    experimental?: {
        // RoslynLanguageServerExport reconstructs RequestType from this descriptor.
        // Keep this experimental API isolated; do not fall back to textual namespace edits.
        sendServerRequest?: <T>(type: { method: string; parameterStructures: 'byName' }, params: unknown, token: vscode.CancellationToken) => Promise<T>;
    };
}

type Result = { kind: 'changed'; uris: string[] } | { kind: 'unchanged' } | { kind: 'unsupported'; reason: string };

export class RoslynNamespaceClient {
    private constructor(private readonly api: Required<NonNullable<CSharpExports['experimental']>>) {}

    static async create(): Promise<RoslynNamespaceClient> {
        const devKit = vscode.extensions.getExtension('ms-dotnettools.csdevkit');
        if (!devKit) throw new Error('C# Dev Kit is required. Install or enable ms-dotnettools.csdevkit.');
        await devKit.activate();
        const csharp = vscode.extensions.getExtension<CSharpExports>('ms-dotnettools.csharp');
        const api = await csharp?.activate();
        if (!api?.initializationFinished || !api.experimental?.sendServerRequest) {
            throw new Error('The C# Dev Kit Roslyn language server is unavailable. Update C# Dev Kit and disable OmniSharp mode.');
        }
        await api.initializationFinished();
        return new RoslynNamespaceClient({ sendServerRequest: api.experimental.sendServerRequest });
    }

    private request<T>(method: string, params: unknown, token: vscode.CancellationToken): Promise<T> {
        return this.api.sendServerRequest<T>({ method, parameterStructures: 'byName' }, params, token);
    }

    async adjust(document: vscode.TextDocument, expectedNamespace: string, token: vscode.CancellationToken): Promise<Result> {
        const uri = document.uri.toString(true);
        const symbols = await this.request<DocumentSymbol[] | null>(
            'textDocument/documentSymbol', { textDocument: { uri } }, token);
        if (!symbols?.length) return { kind: 'unsupported', reason: 'Roslyn found no declarations in this document (or the project is not loaded)' };
        const namespaces = symbols.filter(symbol => symbol.kind === 3); // LSP SymbolKind.Namespace
        if (namespaces.length === 1 && namespaces[0].name.replace(/@/g, '') === expectedNamespace.replace(/@/g, '') &&
            !namespaces[0].children?.some(symbol => symbol.kind === 3)) return { kind: 'unchanged' };
        const position: LspPosition | undefined = (namespaces[0] ?? symbols[0]).selectionRange?.start;
        if (!position) throw new Error('The C# language server returned an unsupported document-symbol response.');

        // Namespace refactoring requires a caret on the namespace (or first global type) name.
        const actions = await this.request<RoslynCodeAction[] | null>('textDocument/codeAction', {
            textDocument: { uri }, range: { start: position, end: position },
            context: { diagnostics: [], only: ['refactor'], triggerKind: 1 }
        }, token);
        for (const action of actions ?? []) {
            if (!isNamespaceAction(action)) continue;
            let changedDuringResolve = false;
            const subscription = vscode.workspace.onDidChangeTextDocument(() => { changedDuringResolve = true; });
            try {
                const resolved = await this.request<RoslynCodeAction>('codeAction/resolve', action, token);
                const changes = namespaceTextChanges(resolved, uri);
                if (!changes) continue;
                const edit = new vscode.WorkspaceEdit();
                for (const change of changes) {
                    const target = await vscode.workspace.openTextDocument(vscode.Uri.parse(change.textDocument.uri));
                    const version = change.textDocument.version;
                    if (version != null && target.version !== version) throw new Error('A document changed while Roslyn prepared the refactoring. Run Adjust Namespaces again.');
                    for (const textEdit of change.edits) {
                        const { start, end } = textEdit.range;
                        edit.replace(target.uri, new vscode.Range(start.line, start.character, end.line, end.character), textEdit.newText);
                    }
                }
                if (changedDuringResolve) throw new Error('A document changed while Roslyn prepared the refactoring. Run Adjust Namespaces again.');
                if (token.isCancellationRequested) return { kind: 'unchanged' };
                if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not apply the complete Roslyn namespace refactoring.');
                return { kind: 'changed', uris: changes.map(change => change.textDocument.uri) };
            } finally {
                subscription.dispose();
            }
        }
        return { kind: 'unsupported', reason: 'Roslyn offers no safe namespace refactoring here; check project loading, partial types, linked files or nested namespaces' };
    }
}
