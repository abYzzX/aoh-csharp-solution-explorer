import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'path';
import { gitStatePriority, isPathUnder, mapGitStatus } from '../gitStatusUtils';

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
