# VPS development migration — 2026-11-16

Status: **DEVELOPMENT_HOST_OPERATIONAL / DOCUMENTATION_DELIVERY_PENDING**, not production acceptance. Dedicated branch `codex/vps-hostinger-migration` starts from accepted remote main `cc8ea880ef49f87cc5cf63fe211e072e845493a0`. This change documents a private development environment; no application code, lockfile, source rights, scanner qualification or roadmap task completion is changed. The historical preparation evidence below is retained; the final activation checkpoint supersedes only its explicitly pending host-access/database items.

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

## Preparation-stage acceptance boundaries (historical)

1. Complete and verify the human T3 Desktop SSH / ChatGPT provider connection. No credentials or Codex authentication files are copied.
2. Independent migration review found no material preservation/handoff defect. It confirmed the backups, isolation and local gate evidence, while leaving human authentication and persistent database activation open; this is not production approval.
3. Restore and verify the persistent prototype separately before claiming its data is active on the VPS. The offline preview does not stand in for PostgreSQL persistence.
4. Keep GitHub PR/CI acceptance separate from local migration checks. No production or next-roadmap-task completion follows from this document.

Rollback keeps the original Windows environment and all recovery archives. Stop only identified VPS processes; do not reset worktrees, prune Docker or remove volumes. Browser-local saved state is not server data and is not migrated automatically.

## Final development-host activation — 2026-11-16

- T3 SSH and managed T3 Connect are configured; the user confirmed the iPhone connection. The final host diagnostic is reachable with four QUIC connections. The initial negative DNS cache expired without global DNS/firewall/hosts changes. T3 remains loopback-bound and its managed relay is authenticated.
- GitHub CLI was authorized personally on the VPS; Git remote access succeeds. No Windows authentication file was transferred. Private credential file permissions are restricted to the development user.
- A one-off private restore script reuses the existing manifest/TAR validators, Compose/runtime ownership and helper cleanup. Sequential Architect and distinct Critic plan reviews approved the scope. Final script review identified a cleanup issue in the reconciliation verifier; its error path was corrected to attempt application close, pool close, owned-service stop and failure evidence independently. No versioned infrastructure engine or CLI was modified. Five restore-boundary tests pass on the VPS; syntax checks pass.
- Original manifest/PostgreSQL/object-store archives match their previously recorded SHA256 values. A new owned project uses freshly generated VPS ownership and the source database credentials privately; no source state/path is forged or overwritten. Four stopped, empty owned volumes and exclusive writers were checked before extraction, with exact pinned images and compatible Linux/amd64 platform.
- The restored database has 1,000 active synthetic projections, one V2 run and 20 raw pages. Existing snapshot capture verifies raw lengths/hashes before writers. The foundation S3-reference relation is absent in this prototype: zero referenced S3 objects were claimed or invented. The backed-up object-store volume and usable signed bucket access were verified; canonical raw bytes remain in PostgreSQL.
- Explicit OpenSearch reconciliation succeeds without seed; canonical snapshot comparison passes before and after reconciliation. V2 catalog and all 1,000 distinct public results match. No original pre-backup logical snapshot was captured, so this migration does **not** claim source-to-target logical RPO 0; physical archive hashes, restored integrity and post-restore preservation are the evidence.
- The official web controller runs as a persistent user service. Initial launch and a cooperative service restart both pass authenticated four-service health, HTTP web/API, full pagination and identical public-result SHA256. Fifty measured queries per run give p95 21.23 ms initially and 24.30 ms after restart, below the existing 500 ms budget.
- Chromium desktop (1440×900) and WebKit mobile (390×844) search/detail journeys pass before and after restart. Each result-page accessibility audit reports zero violations for the selected WCAG tags; no horizontal overflow or external requests is observed. Private screenshots and JSON receipts are retained. These are targeted migration journeys, not a claim that the entire site was newly audited.
- Service autostart and user lingering are enabled. The full VPS was not rebooted. All five T3/web/API listeners remain on 127.0.0.1; the original preview remains usable on 3100/3210. Restored prototype web/API use 3111/3211. Original Windows state and all recovery inputs are preserved.

## Complete local user-chat archive and plugin assessment

The local Codex inventory contains 40 root user conversations, including three archived chats. All 40 were exported as private readable archives: 10,813 visible user/assistant messages at the snapshot, with 42 manifest entries verified after transfer. The export excludes 1,793 subagents/guardians, tool traces, reasoning and 160 attachments. Twelve malformed source lines in five historical rollouts are reported, not silently repaired. Four exporter tests pass, including preservation of roadmap task identifiers and removal of mirrored records. Known-format credential filtering has explicit limits; no general guarantee about arbitrary secrets pasted by humans is claimed.

This is **not native T3 chat import**. T3 0.1.9's supported importer truncates compatible local recent sessions and cannot faithfully reattach all Windows histories to Linux project paths. No raw Codex database, authentication cache or forged T3 database was transplanted. The private handoff and archive index are accessible from the active project; original conversations remain in Codex.

Twelve development skills are installed in the shared VPS home; the managed provider's skills/plugins symlinks resolve to that home. This proves discovery paths, not operation of every skill/tool. Eighteen Windows-configured plugin entries and account-provided integrations were assessed separately. No blanket plugin activation occurred: Linux tools/dependencies, MCP authorization and app-specific or Windows-only capabilities remain distinct. Full OMX/tmux orchestration and native Codex App features are not claimed to be migrated.
