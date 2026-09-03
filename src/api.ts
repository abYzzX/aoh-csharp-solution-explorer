import * as vscode from 'vscode';

export type AohProjectLanguage = 'csharp' | 'fsharp' | 'vb' | 'unknown';

export interface AohProjectInfo {
    name: string;
    uri: vscode.Uri;
    directory: vscode.Uri;
    language: AohProjectLanguage;
    solutionFolder?: string;
}

export interface AohSolutionFolderInfo {
    path: string[];
}

export interface AohSolutionInfo {
    name: string;
    uri: vscode.Uri;
    directory: vscode.Uri;
    format: 'sln' | 'slnx';
    projects: AohProjectInfo[];
    solutionFolders: AohSolutionFolderInfo[];
}

export interface AohSolutionState {
    solution?: AohSolutionInfo;
    activeProject?: AohProjectInfo;
}

export interface AohSolutionExplorerApi {
    readonly version: 1;

    getState(): AohSolutionState;

    onDidChangeState(
        listener: (state: AohSolutionState) => void
    ): vscode.Disposable;

    getActiveProject(): AohProjectInfo | undefined;

    getProjectForFile(file: vscode.Uri): AohProjectInfo | undefined;
}
