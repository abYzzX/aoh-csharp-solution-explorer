import * as vscode from 'vscode';

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict';
export type DiagnosticState = 'error' | 'warning';
export type NodeKind =
    | 'solution'
    | 'solutionFolder'
    | 'project'
    | 'dependencies'
    | 'dependencyGroup'
    | 'properties'
    | 'folder'
    | 'file'
    | 'dependency';

export interface ParsedProject {
    name: string;
    projectUri: vscode.Uri;
    projectRoot: vscode.Uri;
    solutionFolderPath?: string[];
}

export interface ParsedSolutionFolder {
    path: string[];
    items: vscode.Uri[];
}

export interface ParsedSolution {
    name: string;
    uri: vscode.Uri;
    projects: ParsedProject[];
    folders: ParsedSolutionFolder[];
}

export interface WebNode {
    id: string;
    kind: NodeKind;
    label: string;
    description?: string;
    uri?: string;
    solutionFolderPath?: string[];
    solutionUri?: string;
    gitState?: GitFileState;
    diagnosticState?: DiagnosticState;
    errorCount?: number;
    warningCount?: number;
    decorationUri?: string;
    icon?: { type: 'path'; uri: string } | { type: 'font'; fontId: string; character: string; color?: string; size?: string };
    expanded?: boolean;
    children?: WebNode[];
}

export interface DependencyRef {
    name: string;
    kind: 'package' | 'project';
    version?: string;
}

export interface DynamicContextMenuItem {
    label?: string;
    command?: string;
    separator?: boolean;
    group?: string;
    enabled?: boolean;
    children?: DynamicContextMenuItem[];
}

export interface CommandContribution {
    command: string;
    title: string;
    category?: string;
    enablement?: string;
}

export interface ExplorerMenuContribution {
    command?: string;
    submenu?: string;
    alt?: string;
    when?: string;
    group?: string;
}

export interface IconThemeContribution {
    id: string;
    path: string;
}

export interface FileIconTheme {
    iconDefinitions?: Record<string, {
        iconPath?: string;
        fontCharacter?: string;
        fontId?: string;
        fontColor?: string;
        fontSize?: string;
    }>;
    fonts?: Array<{
        id: string;
        src: Array<{ path: string; format?: string }>;
        weight?: string;
        style?: string;
        size?: string;
    }>;
    file?: string;
    folder?: string;
    folderExpanded?: string;
    rootFolder?: string;
    rootFolderExpanded?: string;
    fileExtensions?: Record<string, string>;
    fileNames?: Record<string, string>;
    folderNames?: Record<string, string>;
    folderNamesExpanded?: Record<string, string>;
    languageIds?: Record<string, string>;
    light?: Partial<FileIconTheme>;
    highContrast?: Partial<FileIconTheme>;
}

export interface ResolvedIconTheme {
    themeFileUri: vscode.Uri;
    theme: FileIconTheme;
}
