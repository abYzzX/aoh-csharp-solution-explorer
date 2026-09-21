import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendObjectToJsoncArray } from '../vscodeConfigUtils';

test('appends to an existing JSONC array without removing comments', () => {
    const input = `{
  // keep this comment
  "tasks": [
    { "label": "existing" }
  ]
}`;
    const output = appendObjectToJsoncArray(input, 'tasks', '{\n  "label": "new"\n}');
    assert.ok(output);
    assert.match(output, /keep this comment/);
    assert.match(output, /"label": "existing"/);
    assert.match(output, /"label": "new"/);
});

test('appends to an empty array', () => {
    const output = appendObjectToJsoncArray('{\n  "configurations": []\n}', 'configurations', '{\n  "name": "App"\n}');
    assert.ok(output);
    assert.match(output, /"name": "App"/);
});

test('reuses a trailing comma, including before trailing comments', () => {
    for (const property of ['tasks', 'configurations']) {
        for (const comment of ['', '/* keep this , comment */', '// keep this , comment\n']) {
            const input = `{"${property}":[{"label":"old"}, ${comment}]}`;
            const output = appendObjectToJsoncArray(input, property, '{"label":"new"}');
            assert.ok(output);
            assert.ok(output.startsWith(input.slice(0, -2)));
            assert.deepEqual(JSON.parse(comment ? output.replace(comment, '') : output)[property], [
                { label: 'old' }, { label: 'new' }
            ]);
        }
    }
});

test('adds a separator when commas only occur inside strings or comments', () => {
    for (const value of ['/* comment-like string */,', '// comment-like string,', 'escaped " quote,']) {
        const input = `{"tasks":[${JSON.stringify(value)} /* trailing , */]}`;
        const output = appendObjectToJsoncArray(input, 'tasks', '{"label":"new"}');
        assert.ok(output);
        assert.deepEqual(JSON.parse(output.replace('/* trailing , */', '')).tasks, [value, { label: 'new' }]);
    }
});

test('does not add a separator to an array containing only comments', () => {
    const comment = '/* no values, */ // still empty,\n';
    const output = appendObjectToJsoncArray(`{"tasks":[${comment}]}`, 'tasks', '{"label":"new"}');
    assert.ok(output);
    assert.deepEqual(JSON.parse(output.replace(comment, '')).tasks, [{ label: 'new' }]);
});

test('ignores properties inside comments and preserves the comment text', () => {
    for (const comment of ['/* "tasks": [] */', '// "tasks": []\n']) {
        const input = `{${comment} "tasks": []}`;
        const output = appendObjectToJsoncArray(input, 'tasks', '{"label":"new"}');
        assert.ok(output);
        assert.ok(output.includes(comment));
        assert.deepEqual(JSON.parse(output.replace(comment, '')).tasks, [{ label: 'new' }]);
    }
});

test('ignores nested properties and structural characters inside strings', () => {
    const original = {
        nested: { tasks: [] },
        array: [{ tasks: [] }],
        text: 'escaped "tasks": [] and \\ // /* { }',
        tasks: []
    };
    const output = appendObjectToJsoncArray(JSON.stringify(original), 'tasks', '{"label":"new"}');
    assert.ok(output);
    assert.deepEqual(JSON.parse(output), { ...original, tasks: [{ label: 'new' }] });
});

test('recognizes escaped property names and comments between property tokens', () => {
    const input = '{"ta\\u0073ks" /* key */ : /* value */ []}';
    const output = appendObjectToJsoncArray(input, 'tasks', '{"label":"new"}');
    assert.ok(output);
    assert.ok(output.startsWith('{"ta\\u0073ks" /* key */ : /* value */ ['));
    assert.deepEqual(JSON.parse(output.replace('/* key */', '').replace('/* value */', '')).tasks, [{ label: 'new' }]);
});

test('returns undefined when the property only appears outside the root object', () => {
    for (const input of [
        '{/* "tasks": [] */}',
        '{"nested":{"tasks":[]}}',
        '[{"tasks":[]}]',
        '{} {"tasks":[]}',
        '{"tasks":{}}'
    ]) {
        assert.equal(appendObjectToJsoncArray(input, 'tasks', '{}'), undefined);
    }
});
