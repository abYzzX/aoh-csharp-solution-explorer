import * as vscode from 'vscode';
import { GitFileState, WebNode } from './types';

interface DecorationState {
    gitState?: GitFileState;
    errors: number;
}

/**
 * Tree coloring priority:
 *   1. Diagnostics errors
 *   2. Git status
 *   3. Default theme color
 *
 * Warnings are intentionally ignored in the Solution Explorer.
 * No badges are rendered.
 */
export class ExplorerDecorationService implements vscode.FileDecorationProvider {
    private readonly changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this.changed.event;

    private readonly states = new Map<string, DecorationState>();

    update(roots: WebNode[]): void {
        this.states.clear();

        const visit = (node: WebNode): void => {
            if (node.decorationUri) {
                this.states.set(node.decorationUri, {
                    gitState: node.gitState,
                    errors: node.errorCount ?? 0
                });
            }

            for (const child of node.children ?? []) visit(child);
        };

        for (const root of roots) visit(root);
        this.changed.fire(undefined);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        const state = this.states.get(uri.toString());
        if (!state) return undefined;

        if (state.errors > 0) {
            return new vscode.FileDecoration(
                undefined,
                `${state.errors} error${state.errors === 1 ? '' : 's'}`,
                new vscode.ThemeColor('problemsErrorIcon.foreground')
            );
        }

        const color = this.gitColor(state.gitState);
        if (!color) return undefined;

        return new vscode.FileDecoration(undefined, this.gitTooltip(state.gitState), color);
    }

    private gitColor(state?: GitFileState): vscode.ThemeColor | undefined {
        switch (state) {
            case 'modified': return new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
            case 'added': return new vscode.ThemeColor('gitDecoration.addedResourceForeground');
            case 'deleted': return new vscode.ThemeColor('gitDecoration.deletedResourceForeground');
            case 'renamed': return new vscode.ThemeColor('gitDecoration.renamedResourceForeground');
            case 'conflict': return new vscode.ThemeColor('gitDecoration.conflictingResourceForeground');
            default: return undefined;
        }
    }

    private gitTooltip(state?: GitFileState): string | undefined {
        switch (state) {
            case 'modified': return 'Git: Modified';
            case 'added': return 'Git: Added';
            case 'deleted': return 'Git: Deleted';
            case 'renamed': return 'Git: Renamed';
            case 'conflict': return 'Git: Conflict';
            default: return undefined;
        }
    }
}
