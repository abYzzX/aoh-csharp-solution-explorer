import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitFileState } from './types';

const execFileAsync = promisify(execFile);

export class GitStatusService {
    readonly status = new Map<string, GitFileState>();

    constructor(private readonly log: (message: string) => void = () => {}) {}

    /**
     * Load Git state for all repositories that contain one of the supplied probe paths.
     *
     * Using workspaceFolders alone is not enough: a VS Code workspace can sit above
     * the actual repositories while the loaded .sln/.csproj files live in child repos.
     * We therefore probe workspace, solution and project directories, resolve each
     * actual repository root with `git rev-parse`, dedupe them, then run status at the
     * repository root so every porcelain path has an unambiguous base directory.
     */
    async load(probePaths: string[] = []): Promise<void> {
        this.status.clear();

        const candidates = new Set<string>();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            candidates.add(folder.uri.fsPath);
        }
        for (const probePath of probePaths) {
            if (probePath) candidates.add(probePath);
        }

        const repositoryRoots = new Set<string>();

        for (const candidate of candidates) {
            try {
                const { stdout } = await execFileAsync(
                    'git',
                    ['rev-parse', '--show-toplevel'],
                    { cwd: candidate, maxBuffer: 1024 * 1024 }
                );

                const root = String(stdout).trim();
                if (root) repositoryRoots.add(this.normalize(root));
            } catch {
                // Candidate is not inside a Git repository. That is fine.
            }
        }

        for (const normalizedRoot of repositoryRoots) {
            // On Windows normalize() lower-cases the path. Git/Node accept that path,
            // but keep the repository root as the single base for all status entries.
            const repositoryRoot = normalizedRoot;

            try {
                const { stdout } = await execFileAsync(
                    'git',
                    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
                    {
                        cwd: repositoryRoot,
                        maxBuffer: 10 * 1024 * 1024
                    }
                );

                const entries = String(stdout).split('\0');
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    if (!entry || entry.length < 4) continue;

                    const xy = entry.slice(0, 2);
                    const relativePath = entry.slice(3);

                    this.status.set(
                        this.normalize(path.resolve(repositoryRoot, relativePath)),
                        this.mapGitStatus(xy)
                    );

                    // In porcelain -z format a rename/copy has a second NUL-terminated
                    // path record. The first path is the destination and is what the
                    // current Solution Explorer node points at.
                    if ((xy.includes('R') || xy.includes('C')) && entries[i + 1]) {
                        i++;
                    }
                }
            } catch (error) {
                this.log(`Git status failed for repository '${repositoryRoot}': ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        this.log(`Git state: ${repositoryRoots.size} repositor${repositoryRoots.size === 1 ? 'y' : 'ies'}, ${this.status.size} changed path${this.status.size === 1 ? '' : 's'}.`);
    }


    getState(filePath: string): GitFileState | undefined {
        return this.status.get(this.normalize(filePath));
    }

    getStrongestUnder(rootPath: string): GitFileState | undefined {
        const normalizedRoot = this.normalize(rootPath);
        let strongest: GitFileState | undefined;

        for (const [filePath, state] of this.status) {
            // Deleted items are deliberately ignored for parent coloring. A deleted
            // descendant making an otherwise clean folder/project look 'deleted' is
            // visually confusing in a solution-oriented tree.
            if (state === 'deleted') continue;
            const normalizedFile = this.normalize(filePath);
            if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(normalizedRoot + path.sep)) continue;

            if (!strongest || this.priority(state) > this.priority(strongest)) {
                strongest = state;
            }
        }

        return strongest;
    }

    private priority(state: GitFileState): number {
        switch (state) {
            case 'conflict': return 5;
            case 'deleted': return 0;
            case 'modified': return 3;
            case 'renamed': return 2;
            case 'added': return 1;
        }
    }

    private normalize(value: string): string {
        const normalized = path.normalize(value);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    private mapGitStatus(xy: string): GitFileState {
        if (xy === '??' || xy.includes('A')) return 'added';
        if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflict';
        if (xy.includes('D')) return 'deleted';
        if (xy.includes('R') || xy.includes('C')) return 'renamed';
        return 'modified';
    }
}
