# TASK-0004 — Connector SDK contract

Status: DONE — implementation validated at `2e83e79`; final PR HEAD CI and integration gate apply
Priority: P0
Owner role: Connector-platform executor, with data/security reviewer

## Goal
Create the source-agnostic connector boundary that safely converts authorized source input into replayable raw snapshots and canonical mapping candidates.

## Dependencies
- TASK-0002 and TASK-0003 merged on `main`.

## Relevant contracts
- `connectors/_sdk`
- `docs/architecture/ARCHITECTURE.md`
- `docs/data/DATA_PLATFORM.md`
- `docs/security/SECURITY_LEGAL.md`
- `docs/DEFINITION_OF_DONE.md`

## Scope
- Write an ADR for connector lifecycle, checkpoint ownership, error taxonomy and delivery semantics before implementation.
- Activate `connectors/_sdk` with versioned input/output, run, checkpoint, raw-snapshot and normalized-candidate contracts.
- Gate every run through an enabled Source Registry record; unknown or disallowed rights stop before acquisition.
- Decode raw JSON safely with byte/depth limits and duplicate-member rejection before ordinary object parsing.
- Store immutable raw bytes/metadata first and reference them by snapshot ID plus SHA-256 from every emitted observation.
- Require stable source publication identity; URL remains optional metadata and never the sole identity.
- Define idempotency keys for run/page/item/snapshot and identical replay behavior.
- Define bounded retries with jitter, rate-limit handling, timeouts, circuit breaker and typed terminal/retryable errors.
- Support incremental checkpoints plus periodic full reconciliation, explicit missing/withdrawn/deleted outcomes and tombstones.
- Treat all external text as opaque untrusted data and exclude it from control, prompts, logs and error issue values.

## Out of scope
- A real source adapter, bypassing access controls, canonical identity resolution, persistence vendor choice, UI and production credentials.

## Acceptance criteria
- A connector cannot start without a complete production-enabled registry record.
- Replaying identical input is idempotent; conflicting reuse of an idempotency key fails and preserves prior evidence.
- Malformed, oversized, over-deep or duplicate-member JSON fails before canonical parsing without leaking content.
- Rate-limit/retry/circuit behavior is deterministic under a fake clock and bounded attempts.
- Incremental and full runs detect removals and emit stable deletion/tombstone semantics without deleting historical observations.
- Raw-to-observation provenance remains complete through the public SDK contract.

## Test strategy
- Use synthetic adapters and fixtures for happy path, malformed input, retry exhaustion, timeouts, partial pages and cancellation.
- Contract-test idempotency, checkpoint resume, full reconciliation, deletions and registry revocation mid-run.
- Mutation/fault tests prove raw preservation and typed error sanitization.

## DoD gates
- Targeted and root lint/typecheck/tests/build, secrets scan, dependency audit and clean-checkout verification pass.
- Connector DoD covers fixtures, parser contracts, incremental/deletion behavior, retry/circuit configuration, health signals and provenance.
- Record threat/operational impact, telemetry contract, compatibility/rollback, CI and independent review in `docs/validation/TASK-0004.md`.
- Set `DONE` on the same branch after green implementation review/CI, rerun CI, then merge.

## Validation evidence
- [Validation report](../../docs/validation/TASK-0004.md): 157 SDK tests, type fixtures, forced root gates, fresh remote clone, independent code/spec/security APPROVE and architecture CLEAR on the same implementation SHA.
- [PR #6](https://github.com/CleMeY15/auto-world/pull/6) carries final-head CI and integration evidence. No next task starts before merge and main verification.
- The generic SDK does not activate a real source or provide authenticated production ports, durable storage, retention workers, a source-health dashboard or deployed alerts; these remain mandatory real-source activation gates.
