import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'path';
import { gitStatePriority, indexGitStates, isPathUnder, mapGitStatus, normalizeGitPath } from '../gitStatusUtils';
import { GitFileState } from '../types';

test('maps porcelain states used by the explorer', () => {
    assert.equal(mapGitStatus('??'), 'added');
    assert.equal(mapGitStatus('A '), 'added');
    assert.equal(mapGitStatus(' M'), 'modified');
    assert.equal(mapGitStatus('D '), 'deleted');
    assert.equal(mapGitStatus('R '), 'renamed');
    assert.equal(mapGitStatus('C '), 'renamed');
    assert.equal(mapGitStatus('UU'), 'conflict');
    assert.equal(mapGitStatus('AA'), 'added');
    assert.equal(mapGitStatus('DD'), 'conflict');
});

test('uses the intended parent color priority', () => {
    assert.ok(gitStatePriority('conflict') > gitStatePriority('modified'));
    assert.ok(gitStatePriority('modified') > gitStatePriority('renamed'));
    assert.ok(gitStatePriority('renamed') > gitStatePriority('added'));
    assert.equal(gitStatePriority('deleted'), 0);
});

test('detects descendants without matching sibling path prefixes', () => {
    const root = path.join('repo', 'src');
    assert.equal(isPathUnder(root, root), true);
    assert.equal(isPathUnder(root, path.join(root, 'Feature', 'File.cs')), true);
    assert.equal(isPathUnder(root, path.join('repo', 'src-other', 'File.cs')), false);
});

test('indexed parent colors match a full scan across large trees and ignore deleted files', () => {
    const root = path.resolve('repo');
    const states = new Map<string, GitFileState>();
    const kinds: GitFileState[] = ['added', 'renamed', 'modified', 'conflict', 'deleted'];
    for (let i = 0; i < 5000; i++) {
        states.set(path.join(root, `project-${i % 100}`, 'src', `${i}.cs`), kinds[i % kinds.length]);
    }
    const indexed = indexGitStates(states);
    const probes = [root, path.dirname(root), path.join(root, 'project-1-other')];
    for (let i = 0; i < 100; i++) probes.push(path.join(root, `project-${i}`));
    probes.push(...Array.from(states.keys()).slice(0, 20));
    for (const probe of probes) {
        let expected: GitFileState | undefined;
        for (const [file, state] of states) {
            if (state === 'deleted' || !isPathUnder(probe, file)) continue;
            if (!expected || gitStatePriority(state) > gitStatePriority(expected)) expected = state;
        }
        assert.equal(indexed.get(normalizeGitPath(probe)), expected, probe);
    }
    assert.equal(indexGitStates(new Map()).size, 0);
});
