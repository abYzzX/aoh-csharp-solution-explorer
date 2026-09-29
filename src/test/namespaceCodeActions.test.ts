import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNamespaceAction, namespaceTextChanges, RoslynCodeAction, syncNamespaceProvider } from '../namespaceCodeActions';

const source = 'file:///workspace/Models/Order.cs';
const caller = 'file:///workspace/Consumer.cs';
const edit = (newText: string) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, newText });
const action = (title = 'Namespacename ändern'): RoslynCodeAction => ({ title, kind: 'refactor', data: { CustomTags: [syncNamespaceProvider] } });

test('identifies Roslyn namespace refactorings by provider tag, independent of localization', () => {
    assert.ok(isNamespaceAction(action()));
    assert.ok(isNamespaceAction(action('Change namespace to Company.Models')));
    assert.equal(isNamespaceAction({ title: 'Change namespace to Company.Models' }), false);
    assert.equal(isNamespaceAction({ ...action(), data: { CustomTags: ['Different provider'] } }), false);
});

test('does not run disabled actions, nested menus, commands or fix-all flavors', () => {
    for (const candidate of [
        { ...action(), disabled: { reason: 'Not available' } },
        { ...action(), command: { command: 'some.command' } },
        { ...action(), data: { ...action().data, FixAllFlavors: ['Solution'] } },
        { ...action(), data: { ...action().data, NestedCodeActions: [action()] } }
    ]) assert.equal(isNamespaceAction(candidate), false);
});

test('preserves the complete semantic edit, including references outside the selected document', () => {
    const documentChanges = [
        { textDocument: { uri: source, version: 4 }, edits: [edit('namespace Company.Models;')] },
        { textDocument: { uri: caller, version: 9 }, edits: [edit('using Company.Models;'), edit('Company.Models.Order')] }
    ];
    assert.deepEqual(namespaceTextChanges({ ...action(), edit: { documentChanges } }, source), documentChanges);
});

test('also handles unversioned workspace changes without dropping reference edits', () => {
    const changes = { [source]: [edit('namespace Company.Models;')], [caller]: [edit('using Company.Models;')] };
    const result = namespaceTextChanges({ ...action(), edit: { changes } }, source)!;
    assert.equal(result.length, 2);
    assert.deepEqual(result[1], { textDocument: { uri: caller }, edits: changes[caller] });
});

test('rejects Move File resource operations even if they accompany text changes', () => {
    for (const kind of ['rename', 'create', 'delete']) {
        assert.equal(namespaceTextChanges({ ...action(), edit: { documentChanges: [
            { textDocument: { uri: source }, edits: [edit('namespace Company.Models;')] }, { kind }
        ] } }, source), undefined);
    }
});

test('rejects unresolved actions, command-based actions and edits unrelated to the selected file', () => {
    assert.equal(namespaceTextChanges(action(), source), undefined);
    assert.equal(namespaceTextChanges({ ...action(), edit: { changes: { [caller]: [edit('anything')] } } }, source), undefined);
    assert.equal(namespaceTextChanges({ ...action(), command: 'move', edit: { changes: { [source]: [edit('anything')] } } }, source), undefined);
});

test('recognizes the selected document across Roslyn/VS Code URI serialization differences', () => {
    assert.ok(namespaceTextChanges({ ...action(), edit: { changes: {
        'file:///C:/My Project/Order.cs': [edit('namespace Company.Models;')]
    } } }, 'file:///c%3A/My%20Project/Order.cs'));
});
