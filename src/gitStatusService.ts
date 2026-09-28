import { AsyncReadCache } from './asyncReadCache';
import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitFileState } from './types';
import { indexGitStates, mapGitStatus, normalizeGitPath } from './gitStatusUtils';

const execFileAsync = promisify(execFile);

export class GitStatusService {
    readonly status = new Map<string, GitFileState>();

    private aggregated = new Map<string, GitFileState>();
    private readonly repositoryByPath = new Map<string, string>();
    private loading: Promise<void> = Promise.resolve();

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
    load(probePaths: string[] = [], rediscover = false): Promise<void> {
        const next = this.loading.then(() => this.loadCore(probePaths, rediscover));
        this.loading = next.catch(() => {});
        return next;
    }

    private async loadCore(probePaths: string[], rediscover: boolean): Promise<void> {
        if (rediscover) this.repositoryByPath.clear();
        const status = new Map<string, GitFileState>();

        const candidates = new Set<string>();
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            candidates.add(folder.uri.fsPath);
        }
        for (const probePath of probePaths) {
            if (probePath) candidates.add(probePath);
        }

        const repositoryRoots = new Set<string>();

        // Bound process creation while avoiding one serial round-trip per project.
        const discovery = new AsyncReadCache<string | undefined>(async candidate => {
            const cached = this.repositoryByPath.get(candidate);
            if (cached) return cached;
            try {
                const { stdout } = await execFileAsync(
                    'git',
                    ['rev-parse', '--show-toplevel'],
                    { cwd: candidate, maxBuffer: 1024 * 1024 }
                );
                const root = String(stdout).trim();
                if (root) {
                    const normalized = normalizeGitPath(root);
                    this.repositoryByPath.set(candidate, normalized);
                    return normalized;
                }
            } catch {
                // Candidate is not inside a Git repository. That is fine.
            }
            return undefined;
        }, 4);
        for (const root of await Promise.all([...candidates].map(candidate => discovery.get(candidate)))) {
            if (root) repositoryRoots.add(root);
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

                    status.set(
                        normalizeGitPath(path.resolve(repositoryRoot, relativePath)),
                        mapGitStatus(xy)
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

        this.status.clear();
        for (const [file, state] of status) this.status.set(file, state);
        this.aggregated = indexGitStates(status);

        this.log(`Git state: ${repositoryRoots.size} repositor${repositoryRoots.size === 1 ? 'y' : 'ies'}, ${this.status.size} changed path${this.status.size === 1 ? '' : 's'}.`);
    }


    getState(filePath: string): GitFileState | undefined {
        return this.status.get(normalizeGitPath(filePath));
    }

    getStrongestUnder(rootPath: string): GitFileState | undefined {
        return this.aggregated.get(normalizeGitPath(rootPath));
    }


}
