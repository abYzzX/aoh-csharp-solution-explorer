import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { expectedNamespace } from '../namespaceUtils';
import { allowsNodeSelection } from '../nodeActionPolicy';

const project = path.resolve('Example', 'App.csproj');
const file = (...parts: string[]): string => path.resolve('Example', ...parts);

test('uses RootNamespace plus physical folders relative to the project', () => {
    assert.equal(expectedNamespace(project, file('Models', 'Orders', 'Order.cs'), 'Company.Product'), 'Company.Product.Models.Orders');
    assert.equal(expectedNamespace(project, file('Order.cs'), 'Company.Product'), 'Company.Product');
    assert.equal(expectedNamespace(project, file('Models', 'Order.cs'), ''), 'Models');
});

test('escapes keywords and supports Unicode and dotted directory names', () => {
    assert.equal(expectedNamespace(project, file('class', 'Größe.Models', 'X.cs'), 'Root'), 'Root.@class.Größe.Models');
    assert.equal(expectedNamespace(project, file('X.cs'), '@namespace'), '@namespace');
});

test('refuses paths outside the project and invalid namespace segments', () => {
    assert.equal(expectedNamespace(project, path.resolve('Shared', 'X.cs'), 'Root'), undefined);
    assert.equal(expectedNamespace(project, file('bad-name', 'X.cs'), 'Root'), undefined);
    assert.equal(expectedNamespace(project, file('X.cs'), 'Root..Name'), undefined);
});

test('allows mixed namespace scopes and rejects virtual dependency nodes', () => {
    assert.equal(allowsNodeSelection('adjustNamespaces', ['solution', 'solutionFolder', 'project', 'file', 'folder']), true);
    assert.equal(allowsNodeSelection('adjustNamespaces', ['project', 'dependencies']), false);
    assert.equal(allowsNodeSelection('adjustNamespaces', ['dependency', 'properties']), false);
});
