# AOH - Solution Explorer

A project-centric Solution Explorer for Visual Studio Code.

AOH - Solution Explorer provides a familiar solution and project view for .NET development without trying to replace VS Code's built-in File Explorer.

It focuses on the structure of your solution: projects, dependencies, folders, files, and the relationship between them.

## Features

### Solution and Project View

Displays your .NET solution as a structured tree instead of a plain filesystem hierarchy.

Supports:

- `.sln` solutions
- `.slnx` solutions
- Multiple projects per solution
- Solution folders
- Project folders and files
- Solution items
- Project dependencies
- Project properties

### Project-Centric Navigation

The Solution Explorer represents the logical structure of your .NET solution rather than simply mirroring the filesystem.

This makes it easier to navigate larger solutions where the project structure matters more than the directory structure on disk.

### File Nesting

Related files can be displayed below their parent file.

Typical examples include:

```text
MainWindow.xaml
└── MainWindow.xaml.cs

Example.cs
├── Example.Designer.cs
└── Example.resx
```

AOH - Solution Explorer respects VS Code's file nesting configuration.

For example:

```json
{
    "explorer.fileNesting.enabled": true,
    "explorer.fileNesting.expand": true,
    "explorer.fileNesting.patterns": {
        "*.xaml": "${capture}.xaml.cs",
        "*.cs": "${capture}.Designer.cs, ${capture}.resx"
    }
}
```

### Select Current File

Use **Select Current File** to locate the file currently open in the editor.

The Solution Explorer automatically expands the required project and folders and selects the corresponding file.

### Follow Editor File

Enable **Follow Editor File** to keep the Solution Explorer synchronized with the active editor.

Whenever you switch to another file, the corresponding item is automatically revealed and selected in the Solution Explorer without moving keyboard focus away from the editor.

The setting is remembered per workspace.

### Native VS Code Integration

AOH - Solution Explorer uses VS Code's native Tree View API.

This means it integrates naturally with:

- VS Code themes
- Product icon themes
- Keyboard navigation
- Context menus
- Workspace state
- Editor navigation

No custom WebView is used for the Solution Explorer.

## Requirements

AOH - Solution Explorer requires the **C# Dev Kit** extension.

The C# Dev Kit provides the underlying .NET solution and project information used by the extension.

## Why AOH - Solution Explorer?

VS Code already has an excellent File Explorer, but filesystem navigation and solution navigation solve different problems.

For larger .NET solutions, developers often want to think in terms of:

```text
Solution
├── Application
├── Domain
├── Infrastructure
├── Tests
└── Tools
```

rather than:

```text
src/
tests/
tools/
Directory.Build.props
global.json
...
```

AOH - Solution Explorer adds that project-centric view while leaving the normal VS Code File Explorer untouched.

Use whichever view makes sense for the task at hand.

## Philosophy

AOH - Solution Explorer follows a few simple principles:

- Integrate with VS Code instead of fighting it.
- Prefer native VS Code APIs over custom UI.
- Add missing IDE functionality without replacing functionality that already works well.
- Keep the extension focused on solution and project navigation.
- Avoid unnecessary configuration and complexity.

## Part of AOH

AOH - Solution Explorer is part of **AOH - Abyzz's Overhaul**, a collection of extensions aimed at turning VS Code into a more complete and coherent development environment.

The goal is not to imitate another IDE.

The goal is to build on what VS Code already does well and fill the gaps that become apparent in larger, professional development workflows.

**Making VS Code grow up.**

## License

MIT

## Extension API

AOH Solution Explorer 1.9.0 exposes a small optional API for other AOH extensions.
Consumers should activate `Abyzz.aoh-solution-explorer` and use the returned API object.

API v1 provides:

- `getState()` - current solution and active project.
- `onDidChangeState(listener)` - solution/project context changes.
- `getActiveProject()` - project containing the active editor file.
- `getProjectForFile(uri)` - project containing a file.

The API is intentionally independent of the TreeView UI.

