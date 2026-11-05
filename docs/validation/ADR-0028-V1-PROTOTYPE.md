# ADR-0028 — V1 prototype dependency amendment

Date: 2026-11-05 (Europe/Paris).
Status: Documentation implemented; independent contract review APPROVE and local checks passed. Exact-source/merged-main CI and protected delivery remain pending. Not a claim of delivered application code or image qualification.
Branch: `codex/prototype-v1-functional-gate`.
Base: accepted main `39521a7f630ef4cbc4896f39129859a201ef5203`.

## User direction and ownership

The user explicitly requested postponing TASK-0005 security work until a good functional V1 site prototype exists and removing those tests as a prerequisite for current development. [ADR-0028](../decisions/ADR-0028-v1-prototype-functional-gate.md) records the bounded application of that direction: fabricated data, isolated local/CI composition, essential controls retained and no production or real-data authorization.

The TASK-0005 owner confirmed PR222 delivery, no remaining demonstrated functional defect, a clean worktree and no concurrent changes or merge. This branch owns only the sequencing/contract documentation; it does not touch that worktree or resume scanner qualification.

## Accepted prerequisite, not new validation

[PR222's accepted original evidence](https://github.com/CleMeY15/auto-world/pull/222#issuecomment-6656692551) is the functional baseline: main39521a7f, integration42015103402 SUCCESS with17 named phases, quality42015103516 SUCCESS with518 browser passes/10 documented exclusions, both attempt1. That evidence remains source-bound; it does not validate the changed documentation or imply security admission.

## Amendment checks

- Current instructions, roadmap, epic, task contracts, plan, DoD and ADR precedence all distinguish prototype readiness from security/admission.
- TASK-0104 becomes the next prototype task after amendment acceptance; TASK-0105 and TASK-0106 retain sequential dependencies and their real-service functional tests.
- Deferred image/scanner qualification is retained as release debt until the usable V1 milestone. No security result is rewritten, no test removed, and no workflow or runtime changed.
- No change to Compose, images, migrations, scanner/admission code, package manifests, lockfile or UI. Existing offline entrypoint restrictions remain intact; future adapters need their own implementation and negative production-composition tests.
- Local Markdown targets, diff whitespace, ordinary repository lint/typecheck/tests/build and independent review must pass. CI retains its existing browser/secrets/dependency checks. No image/scanner workflow is manually launched.

## Results

Local Windows checks used the existing Node22.23.2/pnpm10.15.0 toolchain, without changing global installations. `pnpm install --frozen-lockfile` passed with no lockfile modification.

- `git diff --check`: passed. All17 changed/new files are documentation; no runtime/workflow/test/package changes.
- Relative Markdown targets:372 checked across those17 files, zero missing targets.
- `pnpm lint`: passed; root ESLint executed, Turbo14/14 tasks reused valid cache entries for unchanged code.
- `pnpm typecheck`: passed;21/21 tasks,20 cached.
- `pnpm test`: passed, exit0; root Node tests executed, Turbo28/28 tasks with27 cached. Existing platform-specific exclusions remain; no assertion or skip list was modified. This is not a fresh Linux container run.
- `pnpm build`: passed;14/14 tasks with13 cached. Cached build outputs are reported as reused, not rebuilt.
- `pnpm secrets:check`: passed for1,209 tracked files. Ordinary JavaScript dependency audit: no known vulnerabilities. These do not establish container-image qualification.
- Independent architecture/contract review: APPROVE after restoring explicit security/privacy review of new application boundaries in TASK-0104/0105/0106, while excluding deferred TASK-0005 image/scanner/admission qualification.

No UI source changed; no new local visual review is claimed. Exact-source CI retains browser/secrets/dependency checks. Its results, protected merge and merged-main verification must be recorded in the PR checkpoint before repository delivery is claimed. No deferred image/scanner workflow was manually dispatched.

## Rollback and limits

Use a reviewed documentation revert; do not delete volumes, archives, backups or evidence. Once downstream prototype code is delivered, freeze progression and review its disposition separately. Full TASK-0005/0005A security/admission, public deployment, supported runtime and real-source operation remain unaccepted.
