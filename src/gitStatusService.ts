import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitFileState } from './types';

const execFileAsync = promisify(execFile);

export class GitStatusService {
    readonly status = new Map<string, GitFileState>();

    async load(): Promise<void> {
        this.status.clear();

        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            try {
                const { stdout } = await execFileAsync(
                    'git',
                    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
                    {
                        cwd: folder.uri.fsPath,
                        maxBuffer: 10 * 1024 * 1024
                    }
                );

                const entries = stdout.split('\0');
                for (let i = 0; i < entries.length; i++) {
                    const entry = entries[i];
                    if (!entry || entry.length < 4) continue;

                    const xy = entry.slice(0, 2);
                    const relativePath = entry.slice(3);

                    if ((xy.includes('R') || xy.includes('C')) && entries[i + 1]) {
                        i++;
                    }

                    this.status.set(
                        this.normalize(path.resolve(folder.uri.fsPath, relativePath)),
                        this.mapGitStatus(xy)
                    );
                }
            } catch {
                // Git is optional.
            }
        }
    }

    getStrongestUnder(rootPath: string): GitFileState | undefined {
        const normalizedRoot = this.normalize(rootPath);
        let strongest: GitFileState | undefined;

        for (const [filePath, state] of this.status) {
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
            case 'deleted': return 4;
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
