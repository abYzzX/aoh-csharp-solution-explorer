import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidSinglePathName, renameMatchingCSharpType } from '../fileOperationUtils';

test('validates a single file or directory name', () => {
    assert.equal(isValidSinglePathName('Copy.cs'), true);
    assert.equal(isValidSinglePathName('My Folder'), true);
    assert.equal(isValidSinglePathName('../Copy.cs'), false);
    assert.equal(isValidSinglePathName('Folder/Copy.cs'), false);
    assert.equal(isValidSinglePathName(''), false);
});

test('renames an unambiguous matching C# type and constructors', () => {
    const source = `namespace Demo;\n\npublic class Customer\n{\n    public Customer() { }\n}\n`;
    const result = renameMatchingCSharpType(source, 'Customer', 'CustomerCopy');
    assert.equal(result.renamed, true);
    assert.match(result.text, /class CustomerCopy/);
    assert.match(result.text, /public CustomerCopy\(\)/);
});

test('does not rename when the old type name is used elsewhere', () => {
    const source = `public class Customer\n{\n    public Customer() { }\n    public Customer Clone() => new Customer();\n}\n`;
    const result = renameMatchingCSharpType(source, 'Customer', 'CustomerCopy');
    assert.equal(result.renamed, false);
    assert.equal(result.text, source);
});

test('does not guess when multiple matching declarations exist', () => {
    const source = `public class Customer { }\ninternal class Customer { }\n`;
    const result = renameMatchingCSharpType(source, 'Customer', 'CustomerCopy');
    assert.equal(result.renamed, false);
});
