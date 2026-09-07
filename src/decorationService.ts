import * as vscode from 'vscode';
import { GitFileState, WebNode } from './types';

export type ExplorerColorMode = 'git' | 'errors' | 'both' | 'none';

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
    private colorMode: ExplorerColorMode;

    constructor(colorMode: ExplorerColorMode = 'both') {
        this.colorMode = colorMode;
    }

    setColorMode(colorMode: ExplorerColorMode): void {
        if (this.colorMode === colorMode) return;
        this.colorMode = colorMode;

        // Repaint registered decorations only. This does NOT rebuild the TreeDataProvider.
        // Using a global decoration invalidation is more reliable for our synthetic
        // resource URIs than targeted URI invalidation (which caused Git colors to
        // stop updating in VS Code).
        this.changed.fire(undefined);
    }

    update(roots: WebNode[]): void {
        const next = new Map<string, DecorationState>();

        const visit = (node: WebNode): void => {
            if (node.decorationUri) {
                next.set(node.decorationUri, {
                    gitState: node.gitState,
                    errors: node.errorCount ?? 0
                });
            }

            for (const child of node.children ?? []) visit(child);
        };

        for (const root of roots) visit(root);

        let hasChanges = this.states.size !== next.size;
        if (!hasChanges) {
            for (const [key, current] of next) {
                const previous = this.states.get(key);
                if (previous?.gitState !== current.gitState || previous?.errors !== current.errors) {
                    hasChanges = true;
                    break;
                }
            }
        }

        this.states.clear();
        for (const [key, state] of next) this.states.set(key, state);

        // Important: invalidate decorations globally, but do NOT fire tree-data
        // changes. This restores the reliable behavior from 1.11.7 without bringing
        // back the tree rebuild/flicker that 1.11.8 removed.
        if (hasChanges) this.changed.fire(undefined);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        const state = this.states.get(uri.toString());
        if (!state || this.colorMode === 'none') return undefined;

        const showErrors = this.colorMode === 'errors' || this.colorMode === 'both';
        const showGit = this.colorMode === 'git' || this.colorMode === 'both';

        // In Both mode errors intentionally win over Git. A node can only have one
        // foreground color in the VS Code decoration API.
        if (showErrors && state.errors > 0) {
            return new vscode.FileDecoration(
                undefined,
                `${state.errors} error${state.errors === 1 ? '' : 's'}`,
                new vscode.ThemeColor('problemsErrorIcon.foreground')
            );
        }

        if (!showGit) return undefined;

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
