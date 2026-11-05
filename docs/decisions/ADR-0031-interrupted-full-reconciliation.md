# ADR-0031 — Reconcile interrupted full imports without losing evidence

Status: Accepted design; implementation and acceptance tracked by TASK-0106.

## Context

The composed prototype exposed a real inconsistency: a failed full import can
commit a page and its canonical projections without completing an inventory
generation. A subsequent successful full import previously pinned only the last
completed inventory. It could leave a publication from that failed import active
outside the completed inventory; search correctly refused this incoherent state.
Explicit withdrawals/deletions from a committed partial page can also make the
last completed inventory's membership stale in the opposite direction.

## Decision

This narrowly amends ADR-0003's `openRun` baseline semantics without changing its
DTOs, deterministic keys, transaction boundaries, source leases or schemas.

- Under the existing source transaction/lock, a **new full** invocation pins the
  exact current canonical projections whose state is `active` in its source and
  scope, bounded at 100,000 identities and sorted using the existing SDK's
  JavaScript UTF-16 code-unit ordering (including valid non-ASCII identities).
  PostgreSQL may bound its read with `COLLATE "C"`, but sorts the returned IDs
  with the same SDK ordering before persisting the checkpoint. It does not
  union the last completed inventory: that would resurrect explicitly ended
  publications. A completed-inventory member with an existing projection now in
  explicit `withdrawn`/`deleted` state is an allowed interrupted-full state:
  exclude it from the active baseline and preserve its explicit state. Inventory
  members without any corresponding canonical projection are corruption and fail
  closed, not silently discarded.
- `baselineGenerationId` and the expected inventory revision/generation continue
  to identify the last completed inventory lineage. They do not assert that its
  membership equals the new full run's pinned active membership. An empty lineage
  can therefore have active projections left by an interrupted first import.
- Full finalization alone infers missing, and only for the pinned active members.
  Explicit-only mode retains unseen pinned actives; both/full-reconciliation mode
  infers missing for their absences. Explicit withdrawn/deleted outcomes remain
  explicit. Historical raw bytes, versions, tombstones and failure receipts stay
  immutable. No partial import gains permission to infer absence.
- A running checkpoint resumes only if the expected inventory still matches AND
  no other recorded run in the same source/scope has a lease fence greater than
  the checkpoint's persisted fence. Otherwise return `checkpoint_conflict` for
  this later-run conflict. This applies even when the newer run committed no
  page: invocation order is conservative, and the caller must use a fresh
  invocation key/run ID; retrying the stale key still conflicts.
  Never silently rebase an existing checkpoint. Normal same-run resume and exact
  completed replay retain their existing behavior.
- New incremental invocations retain their existing baseline/cadence behavior.
  The in-memory reference store and PostgreSQL store must implement the same rule.

## Validation and operations

Required regressions cover partial-active then disjoint full convergence;
explicit-only and both-mode preservation of explicit ends; stale running resume
after a later partial; normal resume/completed replay; the baseline bound; and
inventory members with missing projections. The composed application must then
publish, restart, cold-restore and reconcile successfully with search's existing
inventory/projection consistency check intact.

No new dependency, migration or production connector activation is introduced.
Rollback restores the previous application version but reintroduces the known
recovery defect; do not use rollback as a data repair. Existing incoherent state
requires a permitted full with a fresh invocation key/run ID, not deletion of
evidence or bypass of the search quarantine. A repairing full does not clear an
already halted search consumer: the existing explicit `reviewReplay` procedure
is still required after reviewing and fixing the cause. Never auto-unhalt/replay.
