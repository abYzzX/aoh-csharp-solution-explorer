import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExcludeMatcher } from '../excludeMatcher';

test('defaults match names at any depth without hiding similar names', () => {
    const excluded = createExcludeMatcher(['bin', 'obj']);
    assert.equal(excluded('src/bin', 'bin'), true);
    assert.equal(excluded('src/OBJ', 'OBJ'), true);
    assert.equal(excluded('src/binary', 'binary'), false);
    assert.equal(excluded('object.cs', 'object.cs'), false);
});

test('globs preserve recursive prefixes, separators, case and single-character matching', () => {
    const excluded = createExcludeMatcher([' **\\*.generated.cs ', 'src/?.txt', 'build/*']);
    for (const [relative, name, expected] of [
        ['Root.generated.cs', 'Root.generated.cs', true],
        ['src/deep/ROOT.GENERATED.CS', 'ROOT.GENERATED.CS', true],
        ['src/a.txt', 'a.txt', true],
        ['src/ab.txt', 'ab.txt', false],
        ['build/output', 'output', true],
        ['build/deep/output', 'output', false],
        ['src/root.cs', 'root.cs', false]
    ] as const) assert.equal(excluded(relative, name), expected);
});

test('regex metacharacters stay literal and empty patterns exclude nothing', () => {
    for (const name of ['a+b.cs', '[test].cs', '(test).cs', 'a^b$.cs', 'a{b}.cs', 'a|b.cs']) {
        const excluded = createExcludeMatcher([name]);
        assert.equal(excluded(`src/${name}`, name), true);
        assert.equal(excluded('unrelated.cs', 'unrelated.cs'), false);
    }
    assert.equal(createExcludeMatcher(['', '   '])('', ''), false);
    assert.equal(createExcludeMatcher([])('bin', 'bin'), false);
});

test('filters can be reused and replaced without retaining old configuration', () => {
    const before = createExcludeMatcher(['bin']);
    const after = createExcludeMatcher(['obj']);
    for (let i = 0; i < 100; i++) {
        assert.equal(before('bin', 'bin'), true);
        assert.equal(after('bin', 'bin'), false);
        assert.equal(after('obj', 'obj'), true);
    }
});
