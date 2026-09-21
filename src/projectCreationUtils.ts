import * as path from 'path';

export interface ProjectTemplate {
    label: string;
    template: string;
    description?: string;
}

// The CLI filters by project type and language before producing this table.
export function parseDotnetProjectTemplates(output: string): ProjectTemplate[] {
    const lines = output.split(/\r?\n/);
    const separatorIndex = lines.findIndex(line => /^\s*-{2,}(?:\s+-{2,})+\s*$/.test(line));
    if (separatorIndex < 0) return [];

    const templates: ProjectTemplate[] = [];
    for (const line of lines.slice(separatorIndex + 1)) {
        if (!line.trim()) break;
        const [label, shortNames] = line.trim().split(/\s{2,}/);
        const template = shortNames?.split(',')[0].trim();
        if (!label || !template) continue;
        templates.push({ label, template, description: shortNames });
    }
    return templates.sort((left, right) => left.label.localeCompare(right.label));
}

export function resolveProjectRoot(solutionPath: string, solutionFolderPath: string[], physicalFolderExists: boolean): string {
    const solutionRoot = path.dirname(solutionPath);
    if (!solutionFolderPath.length || !physicalFolderExists) return solutionRoot;
    return path.join(solutionRoot, ...solutionFolderPath);
}

export function isExecutableProject(projectXml: string): boolean {
    if (/<OutputType>\s*(Exe|WinExe)\s*<\/OutputType>/i.test(projectXml)) return true;
    return /<Project\s+Sdk=["']Microsoft\.NET\.Sdk\.(Web|Worker)["']/i.test(projectXml);
}

export function getTargetFramework(projectXml: string): string | undefined {
    return /<TargetFramework>\s*([^<;\s]+)\s*<\/TargetFramework>/i.exec(projectXml)?.[1];
}

export function getAssemblyName(projectXml: string, projectFile: string): string {
    return /<AssemblyName>\s*([^<]+?)\s*<\/AssemblyName>/i.exec(projectXml)?.[1].trim()
        ?? path.basename(projectFile, path.extname(projectFile));
}
