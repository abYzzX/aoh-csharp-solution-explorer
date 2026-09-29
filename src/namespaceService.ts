import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { expectedNamespace } from './namespaceUtils';
import { RoslynNamespaceClient } from './roslynNamespaceClient';

const execFileAsync = promisify(execFile);
let running = false;

export interface NamespaceScope {
    project: vscode.Uri;
    target?: vscode.Uri;
    folder?: boolean;
}

interface Evaluation {
    Properties: { RootNamespace: string; TargetFrameworks: string };
    Items: { Compile: Array<{ FullPath: string; AutoGen?: string; DesignTime?: string }> };
}

function fileKey(file: string): string {
    const normalized = path.resolve(file);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function inScope(file: string, scope: NamespaceScope): boolean {
    if (!scope.target) return true;
    if (!scope.folder) return fileKey(file) === fileKey(scope.target.fsPath);
    const relative = path.relative(fileKey(scope.target.fsPath), fileKey(file));
    return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function evaluate(project: vscode.Uri, framework?: string): Promise<Evaluation> {
    const { stdout } = await execFileAsync('dotnet', [
        'msbuild', project.fsPath, '-nologo',
        '-getProperty:RootNamespace,TargetFrameworks', '-getItem:Compile',
        ...(framework ? [`-property:TargetFramework=${framework}`] : [])
    ], { cwd: path.dirname(project.fsPath), timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout.trim()) as Evaluation;
}

/** Discover Compile items, then apply sequential, solution-wide Roslyn refactorings. */
export async function adjustNamespaces(scopes: NamespaceScope[], log: (message: string) => void): Promise<void> {
    if (running) return;
    if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('Adjust Namespaces requires a trusted workspace to evaluate projects.');
        return;
    }
    if (vscode.workspace.textDocuments.some(document => document.isDirty && /\.(csproj|props|targets)$/i.test(document.uri.fsPath))) {
        void vscode.window.showWarningMessage('Save changed project, .props and .targets files before adjusting namespaces.');
        return;
    }
    running = true;
    let adjusted = 0;
    const changedFiles = new Set<string>();
    try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Adjust Namespaces', cancellable: true }, async (progress, cancellation) => {
            const roslyn = await RoslynNamespaceClient.create();
            const projects = new Map<string, NamespaceScope[]>();
            for (const scope of scopes) {
                if (!scope.project.fsPath.toLowerCase().endsWith('.csproj')) continue;
                const key = fileKey(scope.project.fsPath);
                const group = projects.get(key) ?? [];
                group.push(scope);
                projects.set(key, group);
            }
            if (!projects.size) {
                void vscode.window.showInformationMessage('No C# project found for this selection. Select a C# project or files within one.');
                return;
            }
            const candidates = new Map<string, { file: string; namespace: string }>();
            const skipped = new Map<string, string>();
            for (const group of projects.values()) {
                if (cancellation.isCancellationRequested) return;
                const project = group[0].project;
                progress.report({ message: path.basename(project.fsPath) });
                const initial = await evaluate(project);
                const frameworks = initial.Properties.TargetFrameworks.split(';').filter(Boolean);
                const evaluations = frameworks.length ? [] : [initial];
                for (const framework of frameworks) {
                    if (cancellation.isCancellationRequested) return;
                    evaluations.push(await evaluate(project, framework));
                }
                for (const evaluation of evaluations) {
                    for (const item of evaluation.Items.Compile) {
                        const file = item.FullPath;
                        if (!file.toLowerCase().endsWith('.cs') || !group.some(scope => inScope(file, scope))) continue;
                        const key = fileKey(file);
                        if (item.AutoGen?.toLowerCase() === 'true' || item.DesignTime?.toLowerCase() === 'true' || /(?:^|[\\/])(?:obj|bin)(?:[\\/])/i.test(path.relative(path.dirname(project.fsPath), file))) {
                            skipped.set(key, 'Generated source');
                            continue;
                        }
                        const namespace = expectedNamespace(project.fsPath, file, evaluation.Properties.RootNamespace);
                        if (!namespace) { skipped.set(key, 'Outside project directory or invalid namespace path'); continue; }
                        const previous = candidates.get(key);
                        if (previous && previous.namespace !== namespace) {
                            skipped.set(key, 'Conflicting namespaces across projects or target frameworks');
                        } else candidates.set(key, { file, namespace });
                    }
                }
            }
            for (const [key, candidate] of candidates) {
                if (cancellation.isCancellationRequested) break;
                if (skipped.has(key)) continue;
                progress.report({ message: path.basename(candidate.file) });
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(candidate.file));
                // Resolve each action against the solution AFTER the previous action, so
                // references shared by several adjusted files cannot overwrite one another.
                const result = await roslyn.adjust(document, candidate.namespace, cancellation);
                if (result.kind === 'unsupported') skipped.set(key, result.reason);
                if (result.kind === 'changed') {
                    adjusted++;
                    result.uris.forEach(uri => changedFiles.add(uri));
                }
            }
            for (const [file, reason] of skipped) log(`Adjust Namespaces: skipped ${file}: ${reason}`);
            const message = `${cancellation.isCancellationRequested ? 'Cancelled. ' : ''}Adjusted ${adjusted} namespace(s); updated ${changedFiles.size} file(s), including affected references.${skipped.size ? ` Skipped ${skipped.size} file(s); see Output > AOH Solution Explorer for details.` : ''}`;
            if (skipped.size) void vscode.window.showWarningMessage(message);
            else void vscode.window.showInformationMessage(message);
        });
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            void vscode.window.showInformationMessage(`Cancelled after ${adjusted} namespace refactoring(s). Completed changes are retained.`);
            return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        log(`Adjust Namespaces stopped after ${adjusted} namespace refactoring(s): ${detail}`);
        void vscode.window.showErrorMessage(`Adjust Namespaces stopped after ${adjusted} namespace refactoring(s): ${detail}`);
    } finally {
        running = false;
    }
}
