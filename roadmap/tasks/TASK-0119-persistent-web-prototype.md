# TASK-0119 — Interface du prototype persistant

Status: IN_PROGRESS, 2026-11-09. Priority P1. Owner: application lead; backend and web executors, independent architecture/critic/code/visual reviewers. PR228 merged; follow-up branch `codex/fix-comparison-open-budget`. DoR satisfied; sequential Architect then distinct Critic APPROVE/CLEAR before execution.

Merged-main checkpoint: five integration workflows PASS, including independently verified persistent-web9/9. Quality failed only comparison-open100ms (114.7ms, existing retry107.7ms). The bounded correction removes redundant empty UI state updates while retaining all cancellation, fragment-identity and functional controls. Exact PR/main acceptance remains required. [Current correction evidence](../../docs/validation/TASK-0119.md#merged-main-comparison-performance-correction). No next task started; TASK-0005 remains deferred.

Local checkpoint, 2026-11-08: LOCAL_VALIDATED / DELIVERY_PENDING. Root quality gates,36 focused contracts,518 browser passes (10 existing exclusions), actual V1 search15/15 and final persistent-web9/9 phases passed; independent architecture/code/visual decisions are clear. The initial PR build-recipe failure is corrected and independently verified in a cold checkout. [Exact receipts and limits](../../docs/validation/TASK-0119.md). PR-head Linux and protected-main acceptance remain required before DONE_FOR_V1_PROTOTYPE; no next task has started.

## Goal and dependencies

Connect the existing V2 web journey to actual local PostgreSQL/OpenSearch data without a second in-memory authority. TASK-0106 is DONE_FOR_V1_PROTOTYPE on main `6a37b3da`, [PR227 acceptance](https://github.com/CleMeY15/auto-world/pull/227#issuecomment-6669154748); existing UI includes TASK-0118 delivered by PR215. ADR-0028 permits only this isolated synthetic prototype; TASK-0005 qualification remains deferred, not passed. No production or real-source use.

Contracts: [ADR-0032](../../docs/decisions/ADR-0032-persistent-web-prototype.md), [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), architecture, data platform, Strategic Moats and Vehicle Intelligence; existing ADR-0013/0020/0028/0030/0031. No new dependency, accounts, server-side personal lists, real taxonomy claims or external ingestion.

## Scope, flow and acceptance

- Explicit local startup: API3211 and web3111, never replace3100/3210. Default demo unchanged. Same-origin proxy has a closed server mode, literal upstream, no arbitrary URL or failure fallback.
- Reuse search, filters (including make/model/year), all five sorts, pagination, detail/history/provenance, favorites, saved searches, comparison and rename. Concise French disclosure of persisted fictitious listings versus browser-local personal lists. Existing loading/empty/offline/stale/error/read-only/undo states retained.
- V2 descriptions derive from committed raw bytes with length/hash/run/version/latest associations and an exact synthetic taxonomy. A pure injected projector enriches the validated V1 snapshot; no canonical vehicle identity or invented facts. Explicit V2 mapping/profile, existing V1 payloads untouched.
- Additive checksum-tracked migration only; old SQL/checksums/history untouched. Worker alone gains bounded raw read, API remains publication-function-only. Profile mismatch fails before seed/listen; a dedicated empty project receives1000 deterministic SDK-ingested fictitious records. Restart/reseed must preserve committed facts and timestamps.
- Three fixed browser storage namespaces per mode; original data untouched, no cross-mode migration/events. Keep local operations available during API failure. No automatic detail/search replay when opening a saved item.

## Test strategy and acceptance gates

Targeted migration/projection/read-port/proxy/storage regressions, including bad bytes/associations, history/current omission, strict filters, cursor/revision/release mismatch, stale/partial/no false counts, mapping/replay/rollback refusal and old V1 behavior. Real disposable four-service SDK→raw→canonical→index→HTTP→Next browser journey, full restart with persistent volumes, idempotent seed, API/dependency outage and recovery, no fallback. Actual Chromium/WebKit UI interaction and pixels; existing320/390/768/1440/theme/200%-text/focus/axe/44px/performance checks remain. Search50 sequential queries p95<500ms, publication lag≤60s; no clock manipulation.

Root lint/typecheck/tests/build/browser/secrets/dependency audit with nonzero execution, independent code/data/visual decisions, exact-head Linux PR and protected-main acceptance before DONE_FOR_V1_PROTOTYPE. Existing exclusions/failures remain explicit. [Validation](../../docs/validation/TASK-0119.md) distinguishes local evidence from delivery. No scanner/image-admission campaign or unrelated audits.

## Operations and rollback

Sanitized fixed telemetry only. Preserve fencing, immutable history, quarantine/manual replay, SDK source scope and raw retention. Rollback by selecting original demo and stopping only the owned prototype; never delete canonical data or silently downgrade a V2 project. No release authorization or full-site V1 claim.
