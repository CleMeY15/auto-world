# TASK-0001 — Workspace bootstrap

Status: READY
Priority: P0
Owner role: ARCHITECT / PLATFORM
Dependencies: none

## Goal
Make the repository reproducibly installable and verifiable on developer machines and CI.

## Scope
- pnpm workspace and Turborepo baseline
- Node runtime declaration
- root lint/typecheck/test/build command contract
- environment example
- minimal CI workflow
- placeholder package boundaries without feature implementation

## Out of scope
- production cloud infrastructure
- real connectors
- user authentication
- product UI

## Acceptance criteria
- `pnpm install` succeeds on supported Node version.
- `pnpm check` has a defined execution path and succeeds for the scaffold.
- CI runs install + lint + typecheck + test + build.
- README contains deterministic bootstrap instructions.
- No secrets committed.

## Tests/evidence
Attach command output in the PR and update this task to DONE only after CI is green.

Validation record: `docs/validation/TASK-0001.md`. Status remains `READY` until the pull-request CI completion gate is satisfied.
