# VPS development migration — 2026-11-16

Status: **PREPARED / HANDOFF_PENDING**, not production acceptance. Dedicated branch `codex/vps-hostinger-migration` starts from accepted remote main `cc8ea880ef49f87cc5cf63fe211e072e845493a0`. This change documents a private development environment; no application code, lockfile, source rights, scanner qualification or roadmap task completion is changed.

## Preservation and environment

- Original Windows checkouts remain available. A Git bundle preserves all 95 inventoried worktree HEADs and references; five dirty worktrees have separate binary patches and untracked-file copies restored into independent recovery checkouts. The 22 source snapshot files pass SHA256 verification on both hosts.
- A private, filtered export preserves 2,309 visible user/assistant messages. It excludes reasoning, tool traces, attachments and authentication. This is an archive plus portable handoff, not a native full-history import into T3.
- Private Windows evidence: 52,309 regular files / 11,023,388,321 bytes; project-local data from ten worktrees: 1,342 regular files / 531,986,140 bytes. All copied files pass source-to-target SHA256 comparison; no symlinks are included. WSL state is retained as a validated passive tar archive, not activated.
- The existing cold-backup tool produced a PostgreSQL/object-store recovery capsule and matching project state. The three backup files match their Windows hashes. A durable cross-host database restore has **not** been performed; existing `restore-check` is ephemeral and is not evidence of activation.
- Ubuntu 26.04.1 x86_64, Node 22.23.2, pnpm 10.15.0, frozen-lockfile installation. T3 Code 0.1.9 service and development processes run under the dedicated ordinary user and bind loopback only. No root password change, public development port, firewall change, global system upgrade or reboot is part of this migration.

## Local validation on the VPS

Baseline application/test bytes are the exact main revision above. Private logs are retained under the migration validation directory on the VPS.

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS: root 3,142 total / 3,026 pass / 116 conditional skips / 0 fail; Turbo 28/28, 13 cached |
| `pnpm build` | PASS: 14/14 tasks, 8 cached |
| `pnpm secrets:check` | PASS |
| `pnpm audit:dependencies` | PASS, no known vulnerabilities reported at execution time |
| `pnpm test:ui` | PASS: 668 passed / 10 existing source-selected skips / 0 failures; Chromium and WebKit, 14.6 minutes |

Initial root-test failures were environment failures, not accepted exceptions: group-writable clone permissions, host `/tmp` on tmpfs, then a temporary-directory owner incompatible with existing parent-ownership guards. The dedicated clone now has no group/world write. An administrator-owned helper provides ext4 `/tmp` in a private mount namespace and drops privileges before executing project commands. The global host `/tmp` remains tmpfs. See the [runbook](../operations/VPS_DEVELOPMENT.md). No test, assertion, timeout, dependency or production script was weakened to obtain the passing result.

The 116 root skips are disclosed conditional exclusions in the unmodified source, not proof that those security/platform paths passed. This host check does not reopen or complete deferred TASK-0005 qualification. No new UI is introduced; browser checks exercise existing journeys on the new host.

After the browser harness released its ports, the offline preview was started explicitly under the ordinary user in transient `auto-world-preview-api.service` and `auto-world-preview-web.service` units. The web `/demo` and API V1 search smoke requests succeed; listeners are only `127.0.0.1:3100` and `127.0.0.1:3210`. This is the existing synthetic fixture, not a restored PostgreSQL prototype. The transient preview is not enabled for reboot; stop only these identified units when no longer needed.

## Remaining acceptance boundaries

1. Complete and verify the human T3 Desktop SSH / ChatGPT provider connection. No credentials or Codex authentication files are copied.
2. Independent migration review found no material preservation/handoff defect. It confirmed the backups, isolation and local gate evidence, while leaving human authentication and persistent database activation open; this is not production approval.
3. Restore and verify the persistent prototype separately before claiming its data is active on the VPS. The offline preview does not stand in for PostgreSQL persistence.
4. Keep GitHub PR/CI acceptance separate from local migration checks. No production or next-roadmap-task completion follows from this document.

Rollback keeps the original Windows environment and all recovery archives. Stop only identified VPS processes; do not reset worktrees, prune Docker or remove volumes. Browser-local saved state is not server data and is not migrated automatically.
