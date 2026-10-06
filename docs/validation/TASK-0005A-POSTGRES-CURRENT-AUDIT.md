# TASK-0005A — PostgreSQL current admission audit

Status: IMPLEMENTATION_PLANNED, 2026-10-06. Owner: platform/security. Dependency: [P6 runtime delivery](TASK-0005A-POSTGRES-ADMISSION-RUNTIME.md), merged on independently reviewed main a4022c9e2b8f5892e9e90dabc251f4fff01badc6 with passing exact-head/main CI37527758408/37528187178. The initial inventory remains PENDING and support dates null. This diagnostic neither activates support nor authorizes a PostgreSQL process.

## Goal and scope

Produce a current, complete, zero-blocker audit for the already published immutable PostgreSQL candidate. The old one-shot producer and expired evidence remain retired and preserved. Reuse its accepted engine, remote materialization and production validators without editing any generation-1 execution pin. The runtime archive remains fixed independently of a new scanner TAR's run-specific alias/hash/size.

Add only `scripts/postgres-image/admission-current-audit.mjs` and the fixed manual `.github/workflows/postgres-admission-current-audit.yml` route, with applicable tests, classification and documentation. Preserve all historical artifacts, private copies and controls. No publication, package/identity grant, account, runtime service or scheduler is included.

## Implementation plan and acceptance

1. Require this repository, input-free workflow_dispatch, protected main, Linux GitHub-hosted audit job, positive run number/attempt1, exact clean checkout, Docker28.0.4 client/server and read-only contents/actions/packages. Build the pinned corrected scanner twice independently.
2. Capture exactly one GH_TOKEN or GITHUB_TOKEN, delete both ambient names even on rejection, and reject malformed/ambiguous credentials and routing overrides before child effects. Use a fixed bounded authenticated protected-main check before and after scanning. Pass credentials only privately to the existing materializer; child environments/argv/output remain credential-free.
3. Reuse complete production policy, publisher, materialization, scanner, report/SBOM and database validation. Keep the closed sixteen-file raw directory separate from the current projection. Publish the exact six-field canonical projection only after complete zero-blocker eligibility, owned cleanup and the final main check. Bind actual report time, effective database/report expiry, workflow/run/recipe/attempt and sorted sixteen role/size/SHA pins.
4. Preserve and upload validated bounded raw failures after cleanup. Upload the projection only when execute and cleanup both succeed. Missing expected artifacts fail the workflow. A main movement after a COMPLETE raw audit preserves that raw receipt, fails the wrapper and produces no projection; cleanup never reconstructs eligibility.
5. Extend exhaustive consumer and package-read inventories. Prove the frozen generation root and every71 execution pin are unchanged. Complete targeted/full quality gates, independent infrastructure/security/privacy review, exact-head CI, identical reviewed merge tree and protected-main CI before a new native dispatch.

The chosen plan received independent architecture CLEAR with the separate artifact conditions, final-main-before-projection ordering and exhaustive package-read inventory requirements above.

## Test and operational strategy

Cover the default wrapper/CLI route; closed arguments/context; non-first positive runs; attempts/forks/dirty or changed checkout; missing/dual/oversized/control-character tokens and ambient removal; child isolation; protected-main movement/unprotected/redirect/timeout/size errors; real validator and sixteen-file boundaries; projection sorting, hashing, time/expiry and substitution; failure preservation; owned cleanup; and exact workflow/action/permission/upload conditions. Reuse historical audit tests unchanged except the global exhaustive permission inventory's new reviewed entry.

Run lint/typecheck/root and affected workspace tests/build/secrets/dependency audit. Then invoke only the new reviewed manual producer and retain/independently inspect the actual result. Until this happens, no current audit is claimed. Package Settings/access, actual archive-retainer/scheduler activation, support dates, every other service/helper admission and integrated P7 remain required. TASK-0005A/0005 remain IN_PROGRESS; TASK-0006 stays blocked.

Rollback retires the new diagnostic route while preserving its successful or failed evidence. It cannot downgrade authority or alter the runtime generation.
