# AOH Repository Rules

These rules apply to every AOH extension repository. Extension-specific architecture and constraints belong in `EXTENSION-DESIGN.md`; agent-specific guidance belongs in `AGENT.md`.

## Principles

- Keep solutions simple, explicit, and maintainable.
- Prefer native VS Code APIs and established platform behavior over custom replacements.
- Add functionality where it solves a concrete problem; avoid abstraction without a current need.
- Preserve existing behavior unless a change is intentional and documented.
- Do not introduce provider, framework, or extension dependencies unless they are actually required.

## Documentation

Before changing behavior, read `AGENT.md`, `EXTENSION-DESIGN.md`, and `CHANGELOG.md`.

User-visible changes must be recorded under `## [Unreleased]` in `CHANGELOG.md`, using the appropriate `Added`, `Changed`, `Fixed`, or `Removed` section. Changelog entries are user-facing release notes and must describe useful behavior rather than implementation trivia.

Keep responsibilities separate:

- `README.md`: user-facing features, setup, usage, settings, and commands.
- `AOH-RULES.md`: shared rules for all AOH repositories.
- `AGENT.md`: instructions for coding agents working in this repository.
- `EXTENSION-DESIGN.md`: extension-specific architecture, decisions, constraints, and planned work.
- `CONTRIBUTING.md`: human contribution workflow.
- `CHANGELOG.md`: user-visible changes and release history.

## Testing

- Add or update tests for logic that can be tested without a VS Code host.
- Prefer extracting small pure functions over mocking the entire VS Code API.
- Run the repository test command before considering a change complete.
- A bug fix should receive a regression test when practical.

## Packaging

- Tests, source files, repository metadata, and development-only documentation must not accidentally become runtime dependencies.
- Keep packaged extensions focused on files required by users.
- Packaging/release infrastructure is external to the extension unless the repository explicitly documents otherwise.

## Definition of Done

A change is complete when the implementation is focused, tests cover suitable logic, documentation matches behavior, the changelog is updated for user-visible changes, and the extension still compiles/packages cleanly.
