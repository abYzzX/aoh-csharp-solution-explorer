# Agent Instructions - AOH Solution Explorer

Read `AOH-RULES.md`, `EXTENSION-DESIGN.md`, and `CHANGELOG.md` before changing this repository.

## Scope

AOH Solution Explorer provides a project-centric .NET solution tree inside VS Code. Keep it focused on solution/project navigation and operations that naturally belong to that tree. Do not turn it into a replacement for VS Code itself.

## Implementation Rules

- Prefer the native VS Code TreeView/TreeDataProvider APIs. The Solution Explorer itself is not a WebView.
- Preserve `.sln` and `.slnx` behavior and project/solution-folder semantics.
- Treat C# Dev Kit as the source of solution/project information where the current implementation does so.
- Avoid full tree rebuilds for visual-only state changes. Git/diagnostic refreshes must preserve the anti-flicker behavior.
- Git Deleted state is intentionally ignored for coloring and parent propagation.
- Errors may color nodes; warnings are intentionally ignored by the current visible decoration behavior.
- Keep Git repository discovery based on actual solution/project probe paths, not workspace folders alone.
- Multi-selection operations must operate on the effective selection, not accidentally only on the context-clicked item.
- File moves/deletes/copy operations must not silently overwrite existing files. Paste/duplicate collisions require an explicit new name.
- Drag and drop must retain its safety checks and optional confirmation.

## Tests

Pure parsing, path, filtering, Git-state, and selection logic should be extracted and tested without booting VS Code where practical. Do not build a large fake VS Code runtime just to increase coverage.

Run:

```bash
npm test
```

before completing changes.

## Current Filesystem Behavior

Copy, cut, paste, and duplicate are implemented for physical files/folders with multi-selection where appropriate. Collision handling must keep prompting for an explicit new name rather than inventing `copy` suffixes. C# type renaming after a renamed copy must remain conservative: if the matching type cannot be identified safely, leave the copied source unchanged.
