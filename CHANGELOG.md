# Changelog

All notable user-visible changes to AOH Solution Explorer are documented here.

### 0.1.6

- Rework all context menues

### 0.1.5

- Faster file nesting in folders with many files, preserving rule order, wildcard behavior and platform-specific filename matching.
- Reduced repeated work when filtering excluded files, draining large filesystem read queues and updating decorations.
- Reduced loading overhead for large solutions and workspaces with shared projects by reusing file reads and loading independent directories concurrently with bounded filesystem activity.
- Diagnostic updates while typing no longer launch Git commands; Git refreshes reuse repository discovery until the next structural refresh.
- Faster folder Git coloring in large repositories by indexing parent status once per Git refresh.
- Overlapping structural refreshes are now serialized and coalesced instead of rebuilding the tree concurrently.

## 0.1.4

- Creating a project from a Solution or Solution Folder now creates it at the matching physical root, adds it to the solution, and creates VS Code build/debug configuration for executable projects.
- Use installed .NET templates for project creation

## 0.1.3
- Added Duplicate for files and folders, including multi-selection.
- Copy/Paste and Duplicate now prompt for a new name on collisions instead of silently inventing names or overwriting files.
- Renamed C# copies conservatively update a matching contained type when the rename is unambiguous.
- The Solution Explorer view header now shows the loaded solution name instead of repeating the AOH Solution Explorer label.

## 0.1.2

- Added default keybindings to `package.json`
- Prevent keyboard file operations on virtual Dependencies nodes from modifying the underlying project file, including mixed selections.

## 0.1.0/0.1.1

- Standardized repository documentation and added unit-test infrastructure.

## 0.0.55

- Added a confirmation dialog before drag & drop moves in the Solution Explorer.
- Added `aoh.solutionExplorer.dragAndDrop.confirm` (default: `true`) to enable or disable that confirmation.

## 0.0.54

- Added native drag & drop for files and folders in the Solution Explorer. Drop onto a folder or project to move the selected item(s); multi-select drag is supported.
- Drag & drop uses VS Code workspace rename edits, refuses overwrites, prevents moving a folder into itself, and does not allow project/solution files to be moved this way.
- Fixed empty directories being rendered with a file/text icon. Empty folder nodes now explicitly use the active file icon theme's folder icon without a fake expand arrow.

## 0.0.53

- Added native multi-select support to the Solution Explorer tree. Multi-target actions now include Copy/Cut, path copying, Git Track/Untrack/Stage/Unstage/Rollback, and regular file/folder deletion.
- Git Deleted is no longer colored and is ignored when propagating Git colors to parent folders/projects.
- Added Git auto-refresh integration with VS Code's built-in Git repository events so colors are refreshed after Git state changes such as stage, commit, checkout and push without rebuilding the tree.
- Added Solution Explorer settings for Git auto-refresh, Git refresh debounce delay, delete confirmation, and trash/recycle-bin usage.
- Git and error colors still use VS Code theme color IDs, so theme and `workbench.colorCustomizations` values remain respected.

## 0.0.52

- Fixed Git repository discovery for Solution Explorer status colors. Git state is now loaded from repositories containing the actual loaded solution/project paths, not only from VS Code workspace-folder roots.
- Resolves each repository root with `git rev-parse --show-toplevel` and runs porcelain status from that root.
- Adds a concise Git-state diagnostic line to the AOH Solution Explorer output channel (repository count + changed-path count).
- Keeps the no-flicker visual refresh path and ColorMode setting.

## 0.0.51

- Fixed Git color refresh regression introduced by the targeted decoration invalidation in 0.0.48.
- Decoration state changes now invalidate the decoration provider globally again, matching the reliable 0.0.47 behavior.
- Tree data is still not rebuilt on save/diagnostic changes, so the 0.0.48 flicker fix remains intact.
- Keeps the `colorMode` setting from 0.0.49 and Windows Git path normalization from 0.0.50.

## 0.0.50

- Fixed Git coloring on Windows by normalizing lookup paths consistently before reading Git status.
- `Git Colors` and `Both` now use the same normalized Git-state lookup as aggregation.
- Keeps the 0.0.48 flicker reduction and 0.0.49 color mode setting unchanged.

## 0.0.49

- Added `aoh.solutionExplorer.colorMode` with `Both`, `Git Colors`, `Error Colors`, and `None`.
- `Both` keeps the current priority: errors override Git colors.
- Changing the color mode repaints decorations in-place without rebuilding the tree.
- Keeps the flicker reduction introduced in 0.0.48.

## 0.0.48

- Stop rebuilding the complete Solution Explorer tree for save and diagnostic events.
- Refresh Git/diagnostic visual state in-place instead, preserving the existing tree and selection.
- Debounce rapid diagnostic updates triggered while typing.
- File decorations now invalidate only nodes whose visible state actually changed instead of repainting the entire explorer.

## 0.0.47

- Removed diagnostic badges from the Solution Explorer.
- Restored Git status colors for files and propagated parent nodes.
- Error diagnostics now override Git coloring on the affected node and all propagated parents.
- Warning diagnostics are intentionally ignored by the Solution Explorer.

## 0.0.46

- Diagnostic symbols are now rendered only as native VS Code file-decoration badges.
- Removed the inline diagnostic fallback from `TreeItem.description`; badges therefore stay right-aligned at the edge of the tree.
- Git coloring remains disabled.

## 0.0.45

- Fix diagnostic propagation for tree nodes sharing the same backing URI by assigning every node a unique decoration URI.
- Keep diagnostics as the only AOH text coloring: errors red, warnings yellow.
- Add a compact description fallback when VS Code native explorer decoration badges are disabled.

## 0.0.44

- Removed AOH Git text coloring from the Solution Explorer.
- Diagnostics now use native right-aligned VS Code decoration badges.
- Error badges use `problemsErrorIcon.foreground`; warning badges use `problemsWarningIcon.foreground`.
- Removed the duplicate diagnostic symbol from the TreeItem description column.

## 0.0.43

- Diagnostics are now shown directly in the TreeItem description column (`✕` for errors, `⚠` for warnings).
- Diagnostic indicators no longer depend on VS Code's global `explorer.decorations.badges` setting.
- Git status remains represented exclusively by the node text color.

## 0.0.42

- Reworked diagnostics lookup to index diagnostics by both URI and normalized filesystem path.
- Accept diagnostics from non-`file` URI schemes as well, which is important for remote/workspace language servers.
- Query VS Code directly for the exact document URI before using cached diagnostic data.
- Use one Explorer decoration provider for both channels: Git remains the node text color, diagnostics remain the right-hand symbol.
- Diagnostics continue to propagate from files through folders/projects/solution folders up to the solution.

## 0.0.41

- Fixed diagnostics lookup by querying VS Code diagnostics with the exact file URI before falling back to normalized paths.
- Split Explorer decorations into independent Git and Diagnostics providers.
- Git decorations now control only the node text color.
- Diagnostics now use a symbol in the right-hand decoration column: `✕` for errors and `⚠` for warnings.
- Error/warning state continues to propagate from files through folders/projects/solution folders up to the solution.

## 0.0.40

- Propagate Git status from files up through folders, projects, solution folders, and solutions.
- Propagate VS Code diagnostics (errors/warnings) through the same hierarchy.
- Keep Git and diagnostics visually distinct: Git controls the node color; diagnostics use `E` / `W` badges.
- Refresh diagnostic decorations when VS Code diagnostics change.

## 0.0.39

- Added `aoh.solutionExplorer.exclude` for configurable file/folder exclusion patterns.
- Added a temporary Show/Hide Excluded Files toolbar toggle using the AOH show/hide file icons.
- `bin` and `obj` are excluded by default.
- Exclude configuration changes refresh the Solution Explorer automatically.

## 0.0.38

- Add public Solution Explorer API v1 for other AOH extensions.
- Expose current solution state, active project, project lookup by file, and state-change notifications.
- API reports solution format, project language, project directories, and solution-folder membership.

## 0.0.37

- Remove version number from the Solution Explorer tab title.
- Prompt for a type name when creating Class/Interface/Enum/Struct/Record files.
- Generate namespaces from RootNamespace/project name plus the target folder path.

## 0.0.36

- Rebased on the full TypeScript source tree.
- Source is now shipped with releases.
- Added AOH output diagnostics and current context-menu commands in TypeScript.

## 0.0.35

- Removed hardcoded keyboard shortcuts. AOH exposes commands and leaves key assignment to the user.
- Action commands fall back to the current TreeView selection when invoked without a context-menu node, so they can be bound to arbitrary keys.

## 0.0.34

- Added keyboard-friendly command invocation using the current TreeView selection.

## 0.0.33

- Added ****Add Project Reference...**** directly to the Dependencies context menu.
- Project references can now be selected from projects in the current solution.
- Already referenced projects and the current project are excluded from the picker.
- References are added through the .NET CLI and the Solution Explorer refreshes afterwards.

A Rider-inspired .NET Solution Explorer for VS Code.

## 0.0.32

- Added build pipeline

## 0.0.31

- Added ****Select Current File**** to reveal and select the file currently open in the editor.
- Added ****Follow Editor File**** to automatically keep the Solution Explorer synchronized with the active editor.
- Follow mode is stored per workspace and restored when the workspace is opened again.
- Revealing the current file expands the required tree nodes without moving keyboard focus away from the editor.

## 0.0.30


AOH Solution Explorer uses VS Code's existing file nesting settings instead of defining its own rules:

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

Changes to `explorer.fileNesting` refresh the AOH Solution Explorer automatically.

## 0.0.29 - Feature Freeze

- Added native `Delete` context-menu entries for Solution Folders and Projects.
- Deleting a Project removes it from the solution via `dotnet sln ... remove`; project files stay on disk.
- Deleting a Solution Folder removes the virtual folder from `.slnx` / `.sln`; physical files stay on disk.

## 0.0.28 — Native TreeView

- Replaced the custom Webview tree with VS Code's native `TreeDataProvider` / `TreeView`.
- The existing `.sln` / `.slnx` model, Solution Folders, Projects, Dependencies, Properties, Solution Items and filesystem tree remain.
- File/project resources now use `resourceUri`, allowing VS Code to apply the active file icon theme and resource decorations natively.
- Context menus are now real VS Code menus with native submenus.
- Removed Webview-only spacing/root-line/icon/context-menu rendering code.
- C# Dev Kit remains the backend for New Project, New .NET File and Add Project Reference.

## 0.0.27

- Removed tree/root guide lines from the Webview.
- Removed `aoh.solutionExplorer.showRootLines`.
- Removed `aoh.solutionExplorer.dependencies.sortProjectsBeforePackages`.

## 0.0.26

- Tree hierarchy depth is now rendered explicitly and no longer depends on the expand-arrow column.
- Leaf nodes can sit slightly left without visually jumping back to their parent's level.
- Empty/leaf nodes use an 8px placeholder instead of the full 16px twisty slot.
- Child rendering now passes an explicit depth value through the Webview tree.

## 0.0.25

- Fixed horizontal alignment of leaf nodes.
- Nodes without an expand arrow no longer reserve the 16px twisty column; their icon moves left into that space.

## 0.0.24

- Reverted the 0.0.23 behavior change: creating a Solution Folder from another Solution Folder nests it again.
- Fixed leaf/empty node alignment so elements without an expand arrow use the same horizontal layout as expandable siblings.

## 0.0.23

- `Add > New Solution Folder...` now creates a root-level Solution Folder even when invoked from another Solution Folder, matching Rider's behavior.
- Applies to both `.slnx` and classic `.sln`.

## 0.0.22

- Fixed AOH `New File...`; files are created through the workspace filesystem, opened with `showTextDocument`, and errors are surfaced.
- Renamed the basic filesystem actions to `New File...` and `New Directory...`.
- Empty `.slnx` Solution Folders are now preserved, including self-closing `\<Folder ... />` entries.
- Solution Folder nodes now carry their logical folder path through the Webview context-menu pipeline.
- `Add > New Solution Folder...` on a Solution Folder creates the new folder as a child of the selected folder.
- Nested Solution Folder creation is supported for both `.slnx` and classic `.sln`.

## 0.0.21

- Fixed context menu actions not firing.
- The selected context target is now captured before the menu is hidden; hiding the menu clears the active target.

## 0.0.20

- Removed duplicate submenu chevrons.
- The complete `< Submenu` header is now clickable to navigate one menu level back.
- Added hover feedback to the clickable back header.

## 0.0.19

- Replaced fly-out context submenus with in-place stack navigation.
- Clicking a submenu keeps the same popup and replaces its contents.
- Nested levels show a Back button and current submenu title.
- Context menus are re-positioned after level changes so they remain inside the Webview bounds.

## 0.0.18

- Submenus no longer flip to the left when space gets tight.
- Context submenus now always open to the right so they cannot disappear underneath VS Code's Activity Bar.

## 0.0.17

- Rebuilt context menus around Rider-inspired node-specific menus.
- Added real nested submenus in the webview (`Add`, `Edit`, `Open In`, `Advanced Build Actions`).
- Third-party Explorer contributions are isolated under `Extensions > \<Extension>` instead of polluting the main menu.
- C# Dev Kit remains a first-class dependency and is used selectively for .NET actions such as New .NET File and Project Reference.
- Added solution/project build actions (`build`, `rebuild`, `clean`, `pack`, `publish`) via the .NET CLI.
- Added New Solution Folder support for both `.slnx` and classic `.sln`.
- Added Existing Project to solution menus via `dotnet sln ... add`.

## 0.0.16 — Pause/refactor checkpoint


No intended feature changes. The prototype was split into focused components before putting the Solution Explorer on hold:
- `contextMenuService.ts` — menu composition, Dev Kit integration and context actions
- `iconThemeService.ts` — active VS Code file-icon-theme resolution
- `gitStatusService.ts` — Git porcelain/status mapping
- `webviewHtml.ts` — Webview markup, styles and client-side tree code
- `types.ts` — shared explorer/domain types
- `extension.ts` — provider orchestration, solution/project parsing and tree construction

The default item spacing is now 4, matching the accepted UI checkpoint.

## 0.0.15

- Fixed duplicate C# Dev Kit menu entries by de-duplicating visible menu labels.
- Solution context menu now has `Create New Project...` and `Build Solution`.
- Solution Folder context menu now has `Create New Project...`.
- New Project resolves and executes C# Dev Kit's contributed New Project command dynamically.
- Build Solution runs `dotnet build \<solution>` in an integrated terminal.
- Physical folders keep New File/New Folder/New .NET File; virtual Solution Folders no longer receive filesystem mutation actions.

## 0.0.14

- Added `ms-dotnettools.csdevkit` as an extension dependency.
- C# Dev Kit Explorer commands are now curated by AOH instead of blindly injected.
- `.csproj`/`.fsproj`/`.vbproj`: Build, Rebuild, Clean, Restore, Publish, project references, user secrets, New .NET File and C# Project Details.
- `.cs`: Select Project Context when contributed by Dev Kit.
- Folders: New File, New Folder and Dev Kit's New .NET File.
- Other extensions continue to inject their `explorer/context` contributions dynamically.

## 0.0.13

- Context menu filtering now respects file type much more closely.
- Added evaluation for `resourceLangId`, `resourceExtname`, `resourceFilename`, `resourceScheme` and file/folder context.
- Added language mapping for C#, F#, VB, TypeScript/JavaScript, Markdown, XML/XAML/MSBuild, YAML, SQL, HTML/CSS and shell files.
- Unknown private context keys are now treated as false instead of showing the command everywhere.

## 0.0.12

- Fixed TypeScript syntax in the dynamic `explorer/context` menu contribution cast.

## 0.0.11

- Context menu now scans installed VS Code extensions for their `explorer/context` contributions.
- Extension commands are rendered dynamically and invoked with the selected resource URI, just like Explorer commands.
- Known resource-specific `when` conditions (`resourceFilename`, `resourceExtname`, `resourceScheme`, folder/file checks) are filtered.
- Unknown extension-specific context keys are treated conservatively as potentially valid instead of hiding the command.
- Keeps a small built-in baseline for workbench-owned Explorer actions that are not exposed as extension menu contributions.
- Added Open in Integrated Terminal.

## 0.0.10

- Added a VS Code-styled right-click context menu to the web tree.
- Files/projects: Open, Open to the Side, Copy Path, Copy Relative Path, Reveal.
- Files/folders: Rename and Delete are included.
- Dependencies, Projects/Packages dependency groups and dependency entries intentionally have no context menu.

## 0.0.9

- Dependencies are now grouped into `Projects` and `Packages`.
- Empty dependency groups are hidden.
- Existing dependency sorting still applies inside each group.

## 0.0.8

- Fixed the Webview CSP so active file-icon-theme SVG/PNG assets can actually load.
- Added `font-src` support for font-based VS Code file icon themes.

## 0.0.7

- Reads the active VS Code file icon theme from `workbench.iconTheme`.
- Resolves the matching `contributes.iconThemes` entry from installed extensions.
- Uses the theme's own `fileNames`, `fileExtensions`, `folderNames`, `iconDefinitions` and font/SVG assets in the AOH web tree.
- Falls back to AOH's monochrome icons only if the current theme cannot be resolved.
- Moved expand/collapse arrows farther right of the tree guide.
- Refreshes automatically when `workbench.iconTheme` changes.

## 0.0.6

- Added VS Code/Codicon-style monochrome icons to the web tree.
- Project files get a dedicated document/project glyph.
- Moved expand/collapse arrows to the right of the tree guide instead of drawing them on top of the line.

## 0.0.5

- Switched AOH - Solution Explorer from VS Code's native TreeView to a custom Webview tree.
- `.csproj`, `.fsproj` and `.vbproj` files are now visible inside their projects.
- Added `aoh.solutionExplorer.itemSpacing`.
- Added `aoh.solutionExplorer.showRootLines`.
- Kept `aoh.solutionExplorer.dependencies.sortProjectsBeforePackages`.
- Solution folders and solution items continue to work for both `.sln` and `.slnx`.
- Empty `Properties` nodes remain hidden.
- Git status colors are rendered directly in the web tree using VS Code theme variables.

## 0.0.4

- Fixed `.slnx` solution items: `\<File Path="..." />` entries inside Solution Folders are now shown.
- Files inherit the same Git decoration logic as normal project files.

## 0.0.3

- Removed `attached` and `Scratches and Consoles`.
- Shows solution folders even when they contain only Solution Items and no projects.
- Parses classic `.sln` `SolutionItems` entries (for folders such as `_sln`, `_doc`, etc.).
- Empty `Properties` nodes are hidden.
- Added `aoh.solutionExplorer.dependencies.sortProjectsBeforePackages` (default: `true`).

### Native TreeView limitation


`itemSpacing` and per-view `showRootLines` are not exposed by VS Code's native `TreeView` API. Implementing those two settings without changing every VS Code tree globally requires moving AOH - Solution Explorer to a custom webview tree. They are intentionally not added as fake/no-op settings.

## 0.0.2

- Removed the dependency on VS Code's built-in `vscode.git` extension.
- Git status is now read directly with `git status --porcelain`, matching AOH Git's independent approach.
- Git decoration colors still use VS Code's configured `gitDecoration.*` theme colors.
- The explorer remains fully functional when VS Code's built-in Git extension is disabled.

## 0.0.1

This version changes the extension from a workspace/file-oriented explorer into a real solution-oriented view.

### Current behavior

- Finds `.sln` and `.slnx` files in the workspace.
- Shows each solution as the root node: `SolutionName · N projects`.
- Reads project membership from the solution instead of blindly scanning every project in the workspace.
- Supports `.csproj`, `.fsproj`, and `.vbproj`.
- Supports classic `.sln` solution folders via `NestedProjects`.
- Supports the common nested-folder layout in `.slnx`.
- Shows Rider-style virtual `Dependencies` and `Properties` nodes under projects.
- Parses `PackageReference` and `ProjectReference` entries for `Dependencies`.
- Shows project folders/files below the project.
- Hides `bin`, `obj`, `.git`, `.vs`, `.idea`, and `node_modules`.
- Keeps Rider-like `attached` and `Scratches and Consoles` roots as placeholders for now.

This is intentionally still a structural/UI prototype. The next passes can refine icons, project/file ordering, solution-folder behavior, context menus, add/new-item flows, Git colors, namespaces, generated files, and exact Rider semantics.
- Solution-folder labels are normalized: `/app/` is displayed as `app`.
- Path-like solution folders are split into nested nodes: `/src/grpc/` becomes `src` -> `grpc`.
- Project references in Dependencies now show only the project name; `project` remains as the secondary label.
- Package references show their version as the secondary label when the version is declared directly in the project file.
- Project files now use VS Code's configured Git decoration colors for modified, added, deleted, renamed, and conflicted states.
- Fixed activation when VS Code's built-in Git extension has not been activated yet; Git integration is now optional and activated safely.

### Changed

- Aligned the project context menu with the ReSharper baseline, including the AOH C# type shortcuts under `Add...`.
