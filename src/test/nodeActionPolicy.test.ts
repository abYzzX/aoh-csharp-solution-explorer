import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowsNodeAction, allowsNodeSelection } from '../nodeActionPolicy';
import type { NodeKind } from '../types';

test('virtual nodes cannot mutate their backing project through keyboard actions', () => {
    const virtual: NodeKind[] = ['dependencies', 'dependencyGroup', 'dependency', 'properties'];
    for (const kind of virtual) {
        for (const action of ['delete', 'rename', 'cut', 'copy', 'duplicate', 'paste', 'newFile', 'newFolder']) {
            assert.equal(allowsNodeAction(action, kind), false, `${action}: ${kind}`);
            assert.equal(allowsNodeSelection(action, ['file', kind]), false);
        }
    }
});

test('physical selections retain edit operations', () => {
    for (const action of ['delete', 'rename', 'cut', 'copy', 'duplicate', 'paste', 'newFile', 'newFolder']) {
        assert.equal(allowsNodeSelection(action, ['file', 'folder']), true);
        assert.equal(allowsNodeAction(action, undefined), false);
    }
});

test('logical removals stay separate from filesystem edits', () => {
    for (const kind of ['project', 'solutionFolder'] as const) {
        assert.equal(allowsNodeSelection('delete', [kind]), true);
        assert.equal(allowsNodeSelection('delete', ['file', kind]), false);
        assert.equal(allowsNodeSelection('delete', [kind, kind]), false);
        assert.equal(allowsNodeAction('rename', kind), false);
        assert.equal(allowsNodeAction('cut', kind), false);
        assert.equal(allowsNodeAction('paste', kind), true);
    }
    assert.equal(allowsNodeAction('delete', 'solution'), false);
});
