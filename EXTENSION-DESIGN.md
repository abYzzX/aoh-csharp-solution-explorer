# AOH Solution Explorer - Extension Design

## Goal

Provide a solution-oriented .NET explorer for VS Code that complements the built-in filesystem explorer. The tree should feel like an IDE solution view while remaining a native VS Code component.

## Non-Goals

- Replacing VS Code's File Explorer.
- Reimplementing source control.
- Building a custom WebView-based tree.
- Hiding filesystem behavior behind surprising or destructive automation.

## Architecture

`src/extension.ts` owns activation, the TreeDataProvider, commands, solution/project loading, and orchestration. Supporting services isolate focused concerns:

- `gitStatusService.ts` - repository discovery and Git working-tree state.
- `diagnosticService.ts` - diagnostic aggregation.
- `decorationService.ts` - native file decorations and colors.
- `dragAndDropController.ts` - native tree drag/drop moves and safety checks.
- `iconThemeService.ts` - active VS Code file icon theme integration.
- `contextMenuService.ts` / `webviewHtml.ts` - supporting UI/context-menu infrastructure where used outside the native tree.
- `api.ts` - small API exposed to other AOH extensions.

Pure logic that does not require VS Code belongs in small modules and should be unit tested.

## Solution Model

The extension supports `.sln` and `.slnx`, projects, solution folders, dependencies, project folders/files, solution items, and file nesting. Logical solution structure takes precedence over simply mirroring the filesystem.

## Visual State

Git and diagnostics are visual state layered onto the existing tree. Visual refreshes should update decorations in place rather than rebuild the complete tree. This preserves selection and avoids flicker.

Git priority for parent propagation is conflict, modified, renamed, added. Deleted files are deliberately ignored for visible coloring and propagation. In combined color mode, errors override Git colors. Warnings are not part of current visible coloring.

## Git Discovery

A workspace folder is not necessarily a repository root. Repository discovery therefore probes workspace, solution, and project paths and resolves actual roots with `git rev-parse --show-toplevel`. Status is loaded from each deduplicated root using porcelain output.

## Filesystem Operations

Native VS Code workspace edits/APIs should be preferred so file operations integrate with editors and filesystem providers. Operations must guard against overwrites, invalid self-moves, and unsafe project/solution moves. Multi-select should be supported where the operation is naturally multi-target.

## Planned Work

### Copy, Cut, Paste, and Duplicate

Existing command IDs do not mean the feature is complete. Copy/Cut/Paste must work reliably for files and folders and support multi-select where sensible. Add Duplicate. On a destination collision, prompt for a new name rather than inventing `copy` filenames. For C# files, a safe and unambiguous filename rename may also rename the matching contained type; never use blind text replacement.

### Keyboard Commands

Expose useful operations as VS Code commands. Conventional filesystem shortcuts such as Copy/Cut/Paste may have scoped defaults only when they apply strictly to the focused AOH Solution Explorer. AOH-specific actions should remain bindable commands without imposing personal keybindings.

### Type-to-Search

When the Solution Explorer has focus, typing should support integrated matching against the full filename, not only prefix matching and not a detached Quick Pick workflow.

## Extension API

The optional API is independent from TreeView rendering. Preserve compatibility deliberately when changing `api.ts`; consumers may be other AOH extensions.

## Testing Strategy

Test pure behavior without a VS Code host wherever possible: Git porcelain status mapping, state priority/aggregation, path/filter logic, parsers, and other deterministic helpers. Integration-heavy TreeView behavior is validated through focused manual testing rather than a sprawling mocked VS Code environment.
