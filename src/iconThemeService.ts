import * as vscode from 'vscode';
import * as path from 'path';
import { FileIconTheme, IconThemeContribution, ResolvedIconTheme, WebNode } from './types';

export class IconThemeService {
    private resolvedIconTheme?: ResolvedIconTheme;
    iconFontCss = '';
    private webview?: vscode.Webview;

    setWebview(webview: vscode.Webview): void { this.webview = webview; }

    async load(): Promise<void> {
        this.resolvedIconTheme = undefined;
        this.iconFontCss = '';

        const themeId = vscode.workspace.getConfiguration('workbench').get<string>('iconTheme');
        if (!themeId || !this.webview) return;

        for (const extension of vscode.extensions.all) {
            const contributions = extension.packageJSON?.contributes?.iconThemes as IconThemeContribution[] | undefined;
            if (!Array.isArray(contributions)) continue;

            const contribution = contributions.find(item => item.id === themeId);
            if (!contribution) continue;

            try {
                const themeFileUri = vscode.Uri.joinPath(extension.extensionUri, contribution.path);
                const theme = JSON.parse(
                    Buffer.from(await vscode.workspace.fs.readFile(themeFileUri)).toString('utf8')
                ) as FileIconTheme;

                this.resolvedIconTheme = { themeFileUri, theme };
                this.iconFontCss = this.createIconFontCss(themeFileUri, theme);
                return;
            } catch {
                return;
            }
        }
    }

    private createIconFontCss(themeFileUri: vscode.Uri, theme: FileIconTheme): string {
        if (!this.webview || !theme.fonts?.length) return '';

        const base = vscode.Uri.joinPath(themeFileUri, '..');
        const rules: string[] = [];

        for (const font of theme.fonts) {
            const sources = font.src
                .map(src => {
                    const uri = this.webview!.asWebviewUri(vscode.Uri.joinPath(base, src.path));
                    const format = src.format ? ` format("${src.format}")` : '';
                    return `url("${uri}")${format}`;
                })
                .join(', ');

            rules.push(
                `@font-face{font-family:"aoh-icon-${this.cssEscape(font.id)}";src:${sources};` +
                `font-weight:${font.weight ?? 'normal'};font-style:${font.style ?? 'normal'};}`
            );
        }

        return rules.join('\n');
    }

    resolveFileIcon(uri: vscode.Uri): WebNode['icon'] {
        const resolved = this.resolvedIconTheme;
        if (!resolved || !this.webview) return undefined;

        const theme = this.mergeThemeVariant(resolved.theme);
        const fileName = path.basename(uri.fsPath);
        const lowerName = fileName.toLowerCase();

        let definitionId = theme.fileNames?.[lowerName] ?? theme.fileNames?.[fileName];

        if (!definitionId) {
            const parts = lowerName.split('.');
            for (let i = 1; i < parts.length; i++) {
                const ext = parts.slice(i).join('.');
                definitionId = theme.fileExtensions?.[ext];
                if (definitionId) break;
            }
        }

        definitionId ??= theme.file;
        return this.resolveIconDefinition(resolved.themeFileUri, theme, definitionId);
    }

    resolveFolderIcon(name: string, root: boolean, expanded: boolean): WebNode['icon'] {
        const resolved = this.resolvedIconTheme;
        if (!resolved || !this.webview) return undefined;

        const theme = this.mergeThemeVariant(resolved.theme);
        const lowerName = name.toLowerCase();

        const definitionId =
            (expanded
                ? theme.folderNamesExpanded?.[lowerName] ?? theme.folderNamesExpanded?.[name]
                : theme.folderNames?.[lowerName] ?? theme.folderNames?.[name]) ??
            (root
                ? (expanded ? theme.rootFolderExpanded : theme.rootFolder)
                : (expanded ? theme.folderExpanded : theme.folder));

        return this.resolveIconDefinition(resolved.themeFileUri, theme, definitionId);
    }

    private mergeThemeVariant(theme: FileIconTheme): FileIconTheme {
        // VS Code icon themes can override icon mappings for light/high-contrast themes.
        // High contrast is intentionally treated like the current color kind first.
        const variant =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light
                ? theme.light
                : (vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast ||
                   vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight)
                    ? theme.highContrast
                    : undefined;

        if (!variant) return theme;

        return {
            ...theme,
            ...variant,
            iconDefinitions: { ...theme.iconDefinitions, ...variant.iconDefinitions },
            fileExtensions: { ...theme.fileExtensions, ...variant.fileExtensions },
            fileNames: { ...theme.fileNames, ...variant.fileNames },
            folderNames: { ...theme.folderNames, ...variant.folderNames },
            folderNamesExpanded: { ...theme.folderNamesExpanded, ...variant.folderNamesExpanded }
        };
    }

    private resolveIconDefinition(
        themeFileUri: vscode.Uri,
        theme: FileIconTheme,
        definitionId?: string
    ): WebNode['icon'] {
        if (!definitionId || !this.webview) return undefined;

        const definition = theme.iconDefinitions?.[definitionId];
        if (!definition) return undefined;

        if (definition.iconPath) {
            const base = vscode.Uri.joinPath(themeFileUri, '..');
            const iconUri = vscode.Uri.joinPath(base, definition.iconPath);
            return {
                type: 'path',
                uri: this.webview.asWebviewUri(iconUri).toString()
            };
        }

        if (definition.fontCharacter) {
            const fontId = definition.fontId ?? theme.fonts?.[0]?.id;
            if (!fontId) return undefined;

            return {
                type: 'font',
                fontId,
                character: definition.fontCharacter,
                color: definition.fontColor,
                size: definition.fontSize
            };
        }

        return undefined;
    }

    private cssEscape(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
}
