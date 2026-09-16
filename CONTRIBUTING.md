# Contributing to AOH Solution Explorer

Read `AOH-RULES.md`, `AGENT.md`, `EXTENSION-DESIGN.md`, and the current `CHANGELOG.md` before making changes.

Keep changes focused and preserve the extension's native VS Code integration. For user-visible behavior, update the `Unreleased` section of the changelog. Add regression tests for suitable pure logic and run:

```bash
npm test
```

For development, install dependencies with `npm install`, compile with `npm run compile`, and use the VS Code Extension Development Host for integration testing.

Do not add repository-local release pipelines or GitVersion configuration. Packaging and publishing are handled outside this extension repository.

Contributions are provided under the MIT license.
