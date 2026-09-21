import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { getAssemblyName, getTargetFramework, isExecutableProject, parseDotnetProjectTemplates, resolveProjectRoot } from '../projectCreationUtils';

test('project root is the solution root without a physical Solution Folder', () => {
    assert.equal(resolveProjectRoot(path.join('/repo', 'App.slnx'), ['src', 'Services'], false), '/repo');
});

test('project root follows an existing physical Solution Folder', () => {
    assert.equal(resolveProjectRoot(path.join('/repo', 'App.slnx'), ['src', 'Services'], true), path.join('/repo', 'src', 'Services'));
});

test('executable project detection handles OutputType and web SDKs', () => {
    assert.equal(isExecutableProject('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>'), true);
    assert.equal(isExecutableProject('<Project Sdk="Microsoft.NET.Sdk.Web"></Project>'), true);
    assert.equal(isExecutableProject('<Project Sdk="Microsoft.NET.Sdk"></Project>'), false);
});

test('project metadata is extracted for launch configuration', () => {
    const xml = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><AssemblyName>Foo.Host</AssemblyName></PropertyGroup></Project>';
    assert.equal(getTargetFramework(xml), 'net10.0');
    assert.equal(getAssemblyName(xml, '/repo/Foo/Foo.csproj'), 'Foo.Host');
});


test('project templates come from the CLI table, preserving aliases and sorting names', () => {
    const templates = parseDotnetProjectTemplates([
        "These templates matched your input: --language='C#', --type='project'",
        '',
        'Template Name     Short Name    Language  Tags',
        '----------------  ------------  --------  --------',
        'Worker Service    worker        C#        Worker',
        'Razor Pages       webapp,razor  C#        Web',
        'Class Library     classlib      C#,F#,VB  Common',
        '',
    ].join('\n'));

    assert.deepEqual(templates, [
        { label: 'Class Library', template: 'classlib', description: 'classlib' },
        { label: 'Razor Pages', template: 'webapp', description: 'webapp,razor' },
        { label: 'Worker Service', template: 'worker', description: 'worker' }
    ]);
});

test('template parsing supports localized headers and Windows line endings', () => {
    assert.deepEqual(parseDotnetProjectTemplates([
        'Vorlagenname      Kurzname      Sprache   Tags',
        '----------------  ------------  --------  --------',
        'Klassenbibliothek  classlib      C#        Common',
        'Incomplete row',
        '',
        'Trailing message'
    ].join('\r\n')), [
        { label: 'Klassenbibliothek', template: 'classlib', description: 'classlib' }
    ]);
});

test('template parsing returns an empty list when no table is present', () => {
    assert.deepEqual(parseDotnetProjectTemplates('No templates found.'), []);
    assert.deepEqual(parseDotnetProjectTemplates(''), []);
});
