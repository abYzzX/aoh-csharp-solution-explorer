import * as path from 'path';
import { GitFileState } from './types';

export function mapGitStatus(xy: string): GitFileState {
    if (xy === '??' || xy.includes('A')) return 'added';
    if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflict';
    if (xy.includes('D')) return 'deleted';
    if (xy.includes('R') || xy.includes('C')) return 'renamed';
    return 'modified';
}

export function gitStatePriority(state: GitFileState): number {
    switch (state) {
        case 'conflict': return 5;
        case 'deleted': return 0;
        case 'modified': return 3;
        case 'renamed': return 2;
        case 'added': return 1;
    }
}

export function normalizeGitPath(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isPathUnder(rootPath: string, filePath: string): boolean {
    const root = normalizeGitPath(rootPath);
    const file = normalizeGitPath(filePath);
    return file === root || file.startsWith(root + path.sep);
}
