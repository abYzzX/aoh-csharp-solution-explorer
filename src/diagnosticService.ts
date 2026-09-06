import * as vscode from 'vscode';
import * as path from 'path';

export interface DiagnosticSummary {
    errors: number;
    warnings: number;
}

export class DiagnosticService {
    private readonly byUri = new Map<string, DiagnosticSummary>();
    private readonly byPath = new Map<string, DiagnosticSummary>();

    load(): void {
        this.byUri.clear();
        this.byPath.clear();

        // Do not restrict diagnostics to the file: scheme. Remote/workspace language
        // servers may publish diagnostics using another URI scheme even though the
        // explorer node resolves to the same physical path.
        for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
            const summary = this.summarize(diagnostics);
            if (!summary.errors && !summary.warnings) continue;

            this.merge(this.byUri, this.normalizeUri(uri), summary);

            if (uri.fsPath) {
                this.merge(this.byPath, this.normalizePath(uri.fsPath), summary);
            }
        }
    }

    get(file: string | vscode.Uri): DiagnosticSummary | undefined {
        if (file instanceof vscode.Uri) {
            // First ask VS Code directly for this exact document URI. This catches
            // diagnostics that arrived after the last full cache rebuild.
            const direct = this.summarize(vscode.languages.getDiagnostics(file));
            if (direct.errors || direct.warnings) return direct;

            const byUri = this.byUri.get(this.normalizeUri(file));
            if (byUri) return byUri;

            if (file.fsPath) {
                const byPath = this.byPath.get(this.normalizePath(file.fsPath));
                if (byPath) return byPath;
            }

            return undefined;
        }

        return this.byPath.get(this.normalizePath(file));
    }

    private merge(target: Map<string, DiagnosticSummary>, key: string, value: DiagnosticSummary): void {
        const current = target.get(key);
        if (!current) {
            target.set(key, { ...value });
            return;
        }

        current.errors += value.errors;
        current.warnings += value.warnings;
    }

    private summarize(diagnostics: readonly vscode.Diagnostic[]): DiagnosticSummary {
        let errors = 0;
        let warnings = 0;

        for (const diagnostic of diagnostics) {
            if (diagnostic.severity === vscode.DiagnosticSeverity.Error) errors++;
            if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) warnings++;
        }

        return { errors, warnings };
    }

    private normalizeUri(uri: vscode.Uri): string {
        // URI path casing follows the host file-system semantics for file resources.
        // For non-file schemes preserve the scheme/authority but normalize path case
        // on Windows as well so C# language-server URIs still match explorer nodes.
        const value = uri.toString(true);
        return process.platform === 'win32' ? value.toLowerCase() : value;
    }

    private normalizePath(value: string): string {
        const normalized = path.resolve(path.normalize(value));
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
}
