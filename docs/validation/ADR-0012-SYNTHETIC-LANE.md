# ADR-0012 — synthetic-lane sequencing validation

Scope: documentation and task-dependency change only, from protected `main` `9aa82327c54ed4cb14887b0254445f27c96f9f4e`. No executable code, image, credential, data, Source Registry policy or service configuration changes in this increment. This record validates the lane split, not TASK-0006 completion or a working P1 feature.

## Dependency and authority checks

| Claim | Boundary checked |
| --- | --- |
| TASK-0006 may plan a synthetic slice after TASK-0004 | TASK-0001 through TASK-0004 are accepted on `main`; TASK-0006 remains plan-only. |
| A future synthetic connector may execute offline | It must use the unchanged SDK authority port and an authenticated, enabled test-only Source Registry fixture in an isolated dev/test composition. Its plan must require a negative production-composition/external-source test. |
| Supported data infrastructure remains blocked | TASK-0005A, TASK-0005 and ADR-0007 retain image admission, real four-service, migration, restart, restore and operational gates. TASK-0005/0005A executable contracts are unchanged. |
| Production source activation remains blocked | A synthetic fixture cannot establish rights, credentials, retention/takedown or real-source authorization. No external access, Docker/Compose image or production secret is permitted in the synthetic lane. |
| EPIC-000 is not closed by a plan | Its original first-connector readiness exit condition is retained alongside the applicable task gates. |

## Local validation on 2026-10-08

Pinned Node `22.23.2` and pnpm `10.15.0` were used for repository gates. The Node executable was checked against the official SHA-256 list before use; the system-default Node `24.18.0` is not the supported toolchain.

- `pnpm run lint`: PASS, 9/9 workspace tasks.
- `pnpm run typecheck`: PASS, 11/11 workspace tasks.
- `pnpm run build`: PASS, 9/9 workspace tasks.
- `pnpm run secrets:check`: PASS, 712 repository files.
- `pnpm run audit:dependencies`: PASS, no known vulnerabilities reported.
- `pnpm run test`: FAIL locally on Windows, 3 failures among 1,747 tests (1,308 pass, 436 skipped). All three are in `tests/postgres-image-candidate-remote-read.test.mjs`, failing the Linux-only remote-read context check `postgres_remote_read_context_invalid`; that test and its implementation are unchanged by this documentation-only diff. This is **not** a passing local full gate. The pinned Linux PR CI must pass before merge.
- `git diff --check`: PASS. All 88 relative Markdown links in the changed documents resolve.

Independent architecture and code review found and then resolved an EPIC-000 exit-gate regression and a missing test-only Source Registry authority boundary. The final code review reports zero open findings and APPROVE. A separate security/data-rights review also APPROVES the fail-closed boundary; its non-blocking recommendation to specify production import/build exclusion and no-network-egress checks was added to TASK-0006's plan criteria. Exact final-head and merged-main CI remain delivery gates; their status is recorded in the PR checks, not inferred from this local result.

Rollback is a reviewed revert of the sequencing ADR and its task/roadmap references before downstream synthetic tasks merge. No image, runtime, credential or persistent data is changed by this increment.
