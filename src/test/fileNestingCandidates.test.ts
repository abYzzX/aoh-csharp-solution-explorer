import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileNestingCandidates } from '../fileNestingCandidates';

test('exact candidates preserve platform comparison, Unicode equivalence and input order', () => {
    const files = ['z.cs', 'Foo.cs', 'foo.cs', 'é.cs', 'e\u0301.cs', 'E.cs', 'É.cs', 'I.cs', 'ı.cs', 'İ.cs', 'i.cs', 'a?.cs', 'foo.cs']
        .map((label, id) => ({ label, id }));
    for (const sensitive of [true, false]) {
        const index = new FileNestingCandidates(files, sensitive);
        for (const name of [...files.map(file => file.label), 'missing.cs', 'FOO.CS']) {
            const expected = files.filter(file => sensitive ? file.label === name
                : file.label.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
            assert.deepEqual(index.get(name), expected, `${sensitive}: ${name}`);
        }
    }
});

test('wildcards keep every candidate in original order for matching and cycle checks', () => {
    const files = [{ label: 'x.cs' }, { label: 'y.cs' }, { label: 'x.cs.map' }];
    for (const mode of [true, false]) {
        const index = new FileNestingCandidates(files, mode);
        for (const pattern of ['*', '*.cs', 'x.*', '*.*']) assert.equal(index.get(pattern), files);
        assert.deepEqual(index.get('x.cs.map'), [files[2]]);
    }
});

test('large folders resolve exact child names to only matching candidates', () => {
    const files = Array.from({ length: 10000 }, (_, id) => ({ label: `Class${id}.Designer.cs` }));
    for (const mode of [true, false]) {
        const index = new FileNestingCandidates(files, mode);
        for (let i = 0; i < files.length; i += 97) assert.deepEqual(index.get(files[i].label), [files[i]]);
        assert.deepEqual(index.get('missing'), []);
    }
});
