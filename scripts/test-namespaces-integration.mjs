// Run against an installed VS Code + C# Dev Kit in an isolated temporary workspace/profile.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
const root = mkdtempSync(join(tmpdir(), 'aoh-namespaces-integration-'));
const workspace = join(root, 'workspace');
const write = (file, text) => {
    const target = join(workspace, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
};
const sdkMajor = Number(execFileSync('dotnet', ['--version'], { encoding: 'utf8' }).trim().split('.')[0]);
write('Test.slnx', '<Solution><Project Path="Domain/Domain.csproj" /><Project Path="App/App.csproj" /></Solution>');
write('NuGet.Config', '<configuration><packageSources><clear /></packageSources></configuration>');
write('Directory.Build.props', `<Project><PropertyGroup><TargetFramework>net${sdkMajor}.0</TargetFramework><RootNamespace>Company.$(MSBuildProjectName)</RootNamespace></PropertyGroup></Project>`);
write('Domain/Domain.csproj', '<Project Sdk="Microsoft.NET.Sdk" />');
write('App/App.csproj', '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><ProjectReference Include="../Domain/Domain.csproj" /></ItemGroup></Project>');
write('Domain/Models/Order.cs', `namespace Old.Shared;
public class Order {
    public Stay MakeStay() => new();
    public string Literal => $"""namespace Old.Shared {1}""";
}
`);
write('Domain/Stay.cs', 'namespace Old.Shared; public class Stay {}\n');
write('Domain/Utilities/GlobalHelper.cs', 'public class GlobalHelper {}\n');
write('App/Consumer.cs', `using Old.Shared;
using Alias = Old.Shared.Order;
namespace Company.App;
public class Consumer {
    public Order Simple = new();
    public Alias Aliased = new();
    public global::Old.Shared.Order Qualified = new();
    public System.Collections.Generic.List<Order> Generic = new();
    public Stay Unmoved = new();
    public global::GlobalHelper Helper = new();
    public const string Text = "Old.Shared.Order";
}
`);
write('App/GlobalUsings.cs', 'global using GlobalOrder = Old.Shared.Order;\n');
write('App/Other.cs', 'namespace Company.App; public class Other { public GlobalOrder Value = new(); }\n');
write('.editorconfig', 'root = true\n[*.cs]\ndotnet_diagnostic.IDE0130.severity = none\n');
write('.vscode/settings.json', JSON.stringify({ 'dotnet.defaultSolution': 'Test.slnx', 'dotnet.preferCSharpExtension': false }));
mkdirSync(join(root, 'profile', 'User'), { recursive: true });
writeFileSync(join(root, 'profile', 'User', 'settings.json'), JSON.stringify({
    'security.workspace.trust.enabled': false, 'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false, 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    'workbench.startupEditor': 'none', 'window.restoreWindows': 'none'
}));
execFileSync('dotnet', ['build', join(workspace, 'Test.slnx'), '--nologo', '--verbosity', 'quiet'], { stdio: 'inherit' });
console.log(`Integration workspace: ${workspace}`);
const extensions = join(root, 'extensions');
mkdirSync(extensions);

const executable = process.env.VSCODE_EXECUTABLE ?? ['code', 'code-insiders'].find(candidate =>
    spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0);
if (!executable) throw new Error('VS Code was not found. Set VSCODE_EXECUTABLE to the code/code-insiders executable.');

const extensionCandidates = process.env.VSCODE_EXTENSIONS_DIR
    ? [process.env.VSCODE_EXTENSIONS_DIR]
    : [join(homedir(), '.vscode', 'extensions'), join(homedir(), '.vscode-insiders', 'extensions')];
const installed = extensionCandidates.find(directory => {
    try { return readdirSync(directory).some(name => name.startsWith('ms-dotnettools.csdevkit-')); }
    catch { return false; }
});
if (!installed) throw new Error(`C# Dev Kit extensions were not found. Checked: ${extensionCandidates.join(', ')}. Set VSCODE_EXTENSIONS_DIR to override.`);

for (const id of ['ms-dotnettools.csdevkit', 'ms-dotnettools.csharp', 'ms-dotnettools.vscode-dotnet-runtime']) {
    const directory = readdirSync(installed).filter(name => name.startsWith(id + '-')).sort().at(-1);
    if (!directory) throw new Error(`Install ${id} before running integration tests (${installed}).`);
    symlinkSync(join(installed, directory), join(extensions, directory), 'dir');
}
const args = [workspace, '--wait', '--new-window', '--skip-welcome', '--skip-release-notes',
    `--user-data-dir=${join(root, 'profile')}`, `--extensionDevelopmentPath=${resolve('.')}`,
    `--extensionTestsPath=${resolve('out/test/namespaceIntegration.js')}`];
args.push(`--extensions-dir=${extensions}`);
const child = spawn(executable, args, { stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => {
    try {
        const result = JSON.parse(readFileSync(join(workspace, 'integration-result.json'), 'utf8'));
        console.log(result);
        process.exitCode = result.passed && code === 0 ? 0 : 1;
    } catch { console.error('The extension-host test did not finish. Inspect the temporary profile logs.'); process.exitCode = 1; }
});
