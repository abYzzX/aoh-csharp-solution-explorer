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

Diagnostic events only refresh the diagnostic snapshot and decorations, without launching Git commands. Save and repository events still refresh Git state. Folder Git colors use a precomputed ancestor index, and diagnostic lookups use the snapshot captured for each refresh.

Git priority for parent propagation is conflict, modified, renamed, added. Deleted files are deliberately ignored for visible coloring and propagation. In combined color mode, errors override Git colors. Warnings are not part of current visible coloring.

## Git Discovery

A workspace folder is not necessarily a repository root. Repository discovery therefore probes workspace, solution, and project paths and resolves actual roots with `git rev-parse --show-toplevel`. Status is loaded from each deduplicated root using porcelain output.

Successful discovery is cached by exact probe path for visual refreshes, preserving nested repository boundaries. Structural refreshes invalidate discovery. Git loads are serialized so an older request cannot overwrite newer state.

## Tree Loading

The tree is still fully materialized to preserve file reveal, logical solution-folder operations, file nesting, and diagnostic propagation. Independent directory reads run concurrently, limited to eight in-flight directory reads and eight file reads. A per-build cache shares raw reads across projects/solutions without sharing mutable tree nodes. Structural refreshes run serially and coalesce requests received during a build into a follow-up build.

Exclude patterns are compiled once per structural refresh. File nesting indexes exact child names per directory; wildcard rules retain the existing full candidate scan. Candidate order and accent-sensitive locale comparisons on non-Linux hosts are preserved so nesting precedence and cycle prevention remain unchanged.

## Filesystem Operations

Native VS Code workspace edits/APIs should be preferred so file operations integrate with editors and filesystem providers. Operations must guard against overwrites, invalid self-moves, and unsafe project/solution moves. Multi-select should be supported where the operation is naturally multi-target.

## Filesystem Copy Operations

Copy, cut, paste, and duplicate operate on physical files/folders and support multi-selection where appropriate. Existing targets are never silently overwritten: paste and duplicate prompt for a new name for each collision. Duplicate always prompts because the source directory already contains the original name.

When a copied `.cs` file is renamed, the extension may rename the matching contained C# type only when the transformation is conservative and unambiguous. Ambiguous files are copied unchanged; arbitrary string replacement is forbidden.

## View Title

For a single loaded solution, the Solution Explorer view header is the solution name itself. The AOH product name is already represented by the Activity Bar container and must not be repeated in the view header.

## Extension API

The optional API is independent from TreeView rendering. Preserve compatibility deliberately when changing `api.ts`; consumers may be other AOH extensions.

## Testing Strategy

Test pure behavior without a VS Code host wherever possible: Git porcelain status mapping, state priority/aggregation, path/filter logic, parsers, and other deterministic helpers. Integration-heavy TreeView behavior is validated through focused manual testing rather than a sprawling mocked VS Code environment.

## Project creation

`New Project...` is owned by AOH Solution Explorer instead of delegating placement to C# Dev Kit. The selected Solution is always the logical owner. A project created below a Solution Folder is added to that Solution Folder. Its physical root is the Solution directory unless a directory matching the complete Solution Folder path already exists; in that case the project is created below that physical directory.

After `dotnet new`, the generated project is added with `dotnet sln ... add`. Executable projects also receive idempotent entries in workspace `.vscode/tasks.json` and `.vscode/launch.json`. Existing JSONC files are amended structurally; comments and unrelated entries must not be replaced or reformatted.


## Native tree and menu baseline

The explorer uses VS Code's native `TreeView`; it is not a WebView. The ReSharper Solution Explorer is the visual and interaction baseline for tree structure and context-menu grouping. AOH may deliberately diverge as features are refined. Keep ordinary VS Code tree behavior (selection, keyboard navigation, focus, multi-select and accessibility) native instead of reimplementing it in HTML.

## Namespace adjustment

`namespaceService.ts` evaluates selected C# projects through MSBuild's property/item query (no build target). Evaluated `RootNamespace` and `Compile` items, including separate target-framework evaluations, determine candidate files. Logical tree ancestry resolves file ownership and Solution Folder scope; physical project-relative paths determine namespaces. Explorer visibility filters do not restrict project-wide operations.

`roslynNamespaceClient.ts` activates C# Dev Kit and its C# Roslyn server. It uses the C# extension's experimental `sendServerRequest` export for document symbols, namespace code actions and action resolution. The adapter is isolated and checked at runtime. `namespaceCodeActions.ts` identifies the namespace provider via Roslyn's language-independent CustomTags metadata, never translated titles. Resolved resource operations (the sibling Move File action) and command-based actions are rejected.

Each complete semantic WorkspaceEdit includes caller/using changes throughout the loaded solution, even outside the selected scope. Refactorings run sequentially against the updated solution to avoid stale overlapping edits. Version checks and document-change detection protect unsaved buffers. Unsupported cases are reported; there is no textual fallback. Cancellation or errors retain completed refactorings and report partial progress.

The real VS Code integration test (`npm run test:integration:namespaces`) creates a temporary solution and isolated profile using installed C# Dev Kit/C# extensions. The runner auto-detects stable VS Code first and then Insiders, and searches both standard extension directories. Set `VSCODE_EXECUTABLE` and `VSCODE_EXTENSIONS_DIR` to override detection. It verifies cross-project usings, aliases, global usings, qualified/generic references, unsaved edits, file/folder scope and successful compilation after refactoring.
