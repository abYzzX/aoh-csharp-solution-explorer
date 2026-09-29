/** Real extension-host integration test. Launch with npm run test:integration:namespaces. */
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { adjustNamespaces } from '../namespaceService';

export async function run(): Promise<void> {
    const resultFile = path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'integration-result.json');
    try {
        let timeout: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                runTests(),
                new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Namespace integration timed out')), 150_000); })
            ]);
        } finally { clearTimeout(timeout); }
        writeFileSync(resultFile, JSON.stringify({ passed: true }));
    } catch (error) {
        writeFileSync(resultFile, JSON.stringify({ passed: false, error: String(error), stack: error instanceof Error ? error.stack : undefined }));
        throw error;
    }
}

async function runTests(): Promise<void> {
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const uri = (file: string): vscode.Uri => vscode.Uri.file(path.join(root, file));
    const text = async (file: string): Promise<string> => (await vscode.workspace.openTextDocument(uri(file))).getText();
    const build = async (): Promise<void> => {
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme === 'file' && document.uri.fsPath.startsWith(root) && document.isDirty) {
                assert.ok(await document.save(), `Could not save ${document.uri.fsPath}`);
                assert.equal(readFileSync(document.uri.fsPath, 'utf8'), document.getText(), `Saved document differs: ${document.uri.fsPath}`);
            }
        }
        try {
            await promisify(execFile)('dotnet', ['build', path.join(root, 'Test.slnx'), '--no-restore', '--nologo', '--verbosity', 'quiet']);
        } catch (error) {
            const failure = error as Error & { stdout?: string; stderr?: string };
            throw new Error(`${failure.message}\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`);
        }
    };
    const extension = vscode.extensions.getExtension('Abyzz.aoh-solution-explorer');
    assert.ok(extension);
    writeFileSync(path.join(root, 'integration-progress.json'), JSON.stringify({ step: 'activation' }));
    await extension.activate();
    const csharp = await vscode.extensions.getExtension('ms-dotnettools.csharp')!.activate();
    await csharp.initializationFinished();
    const order = await vscode.workspace.openTextDocument(uri('Domain/Models/Order.cs'));
    await vscode.window.showTextDocument(order);
    // Dev Kit project loading continues after LSP initialization. Wait for the actual refactoring.
    const deadline = Date.now() + 120_000;
    while (true) {
        const actions = await csharp.experimental.sendServerRequest({ method: 'textDocument/codeAction', parameterStructures: 'byName' }, {
            textDocument: { uri: order.uri.toString(true) },
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
            context: { diagnostics: [], only: ['refactor'], triggerKind: 1 }
        }, new vscode.CancellationTokenSource().token);
        writeFileSync(path.join(root, 'integration-progress.json'), JSON.stringify({ step: 'wait-for-refactoring', actions }));
        if (actions?.some((action: { data?: { CustomTags?: string[] } }) => action.data?.CustomTags?.includes('Sync Namespace and Folder Name Code Action Provider'))) break;
        if (Date.now() > deadline) throw new Error('C# Dev Kit did not load the test solution and namespace refactoring in time.');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // Keep an unsaved user edit in a referencing document; Roslyn must preserve it.
    const consumer = await vscode.workspace.openTextDocument(uri('App/Consumer.cs'));
    const userEdit = new vscode.WorkspaceEdit();
    userEdit.insert(consumer.uri, new vscode.Position(0, 0), '// unsaved user edit\n');
    assert.ok(await vscode.workspace.applyEdit(userEdit));
    writeFileSync(path.join(root, 'integration-progress.json'), JSON.stringify({ step: 'adjust-file' }));
    await adjustNamespaces([{ project: uri('Domain/Domain.csproj'), target: order.uri }], message => appendFileSync(path.join(root, 'integration-service.log'), message + '\n'));
    assert.match(await text('Domain/Models/Order.cs'), /namespace Company\.Domain\.Models;/);
    assert.match(await text('Domain/Stay.cs'), /namespace Old\.Shared;/);
    assert.match(await text('App/Consumer.cs'), /using Company\.Domain\.Models;/);
    assert.match(await text('App/Consumer.cs'), /using Alias = Company\.Domain\.Models\.Order;/);
    assert.match(await text('App/Consumer.cs'), /global::Company\.Domain\.Models\.Order/);
    assert.match(await text('App/GlobalUsings.cs'), /global using GlobalOrder = Company\.Domain\.Models\.Order;/);
    assert.match(await text('App/Consumer.cs'), /\/\/ unsaved user edit/);
    assert.match(await text('App/Consumer.cs'), /"Old\.Shared\.Order"/);
    assert.match(await text('Domain/Models/Order.cs'), /namespace Old\.Shared \{1\}/);
    await build();

    writeFileSync(path.join(root, 'integration-progress.json'), JSON.stringify({ step: 'adjust-folder' }));
    // Exercise the real context-menu command and recursive Solution Folder scope.
    await vscode.commands.executeCommand('aoh.solutionExplorer.adjustNamespaces', {
        id: 'integration-folder', kind: 'solutionFolder', uri: uri('Test.slnx').toString(),
        children: [{ id: 'integration-project', kind: 'project', uri: uri('Domain/Domain.csproj').toString() }]
    });
    assert.match(await text('Domain/Stay.cs'), /namespace Company\.Domain;/);
    assert.match(await text('Domain/Utilities/GlobalHelper.cs'), /namespace Company\.Domain\.Utilities/);
    assert.match(await text('App/Consumer.cs'), /Company\.Domain\.Utilities\.GlobalHelper/);
    await build();
    console.log('Namespace integration passed: references, aliases, global usings, qualified/generic types, unsaved edits, subset selection and recursive scope.');
}
