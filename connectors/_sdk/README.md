# Connector SDK

`@auto-world/connector-sdk` is an internal, source-agnostic V1 ingestion engine. It depends only on the public Vehicle Schema and Source Registry workspace packages. No real network adapter, source permission, storage vendor or production deployment is supplied.

Read [ADR-0003](../../docs/decisions/ADR-0003-connector-sdk-contract.md) and its [exact API appendix](../../docs/decisions/ADR-0003-connector-sdk-api.md) before implementing a port. Public exports are in `src/index.ts`; all V1 port/receipt types are in `src/types.ts`.

## Running and testing

Use the repository-pinned Node 22.23.2 and pnpm 10.15.0 toolchain:

```sh
pnpm install --frozen-lockfile
pnpm --filter @auto-world/connector-sdk lint
pnpm --filter @auto-world/connector-sdk typecheck
pnpm --filter @auto-world/connector-sdk test
pnpm --filter @auto-world/connector-sdk build
pnpm check
```

The direct commands rebuild both public dependencies; no pre-existing `dist` is required. `test/lifecycle.test.mjs` is a runnable synthetic integration example. `test/store.mjs` models atomic transactions, fencing, idempotent receipts and injected crashes. It is a contract-test fixture, not a production store or a durable database.

## Public integration surface

Call `runConnector(request, ports, signal?)`. Parse untyped requests with `parseConnectorRunRequest`; the engine validates again and returns a detached, typed completed/failed/cancelled result with no raw source values. `invocationKey` identifies a scheduled run: reuse it for exact recovery, never for changed inputs. Use a new key for a new acquisition run. Full runs start at a null cursor; incremental runs require a committed full baseline and inherit its scoped watermark. A completed replay returns the recorded result, including after later inventory evolution.

Required ports:

| Port | Responsibility and trust boundary |
| --- | --- |
| `authority` | Authenticate the current registry and verify its evidence; a TypeScript marker does not establish trust. |
| `lease` | Exclusive source-wide lease with monotone fencing tokens, renewal and release. |
| `store` | Durable atomic raw/checkpoint/evidence/inventory/runtime/ledger transactions and outbox; reject stale fences and conflicting key reuse. |
| `adapter` | Stream-cap acquisition and map decoded JSON into bounded drafts, respecting cancellation. Never forge provenance, canonical identity or access policies. |
| `clock`, `scheduler`, `random` | Valid time, cancellable timers and bounded jitter; injectable for deterministic tests. |
| `telemetry` | Best-effort allowlisted mutation mirrors, never the authoritative audit trail. |

`systemScheduler` supplies native cancellable timers. Native Web Crypto SHA-256 and fatal UTF-8 decoding are required. Every awaited port effect has a deadline. An unacknowledged mutation is indeterminate, not proof that no write occurred. On recovery, a newer source fence must invalidate or quiesce old in-flight writes before receipt absence permits another acquisition/write.

The store must call `reduceAttemptReservation` and `reduceAttemptCompletion` within durable compare-and-swap transactions, with its own authority/fence validation and exactly-once reservation completion. Merely invoking these pure functions does not provide distributed locking or durability.

## Safety and data semantics

The engine checks enabled current policy and pins its revision, configuration digest, exact field/territory/method/internal-audience scope and evidence reference. It rechecks rights around acquisition, mapping and publication. Revoked, expired, unknown or disallowed rights stop processing; no consumer redistribution is implied.

Raw bytes are staged immutably with SHA-256, capture time, retention deadlines and a pending checkpoint before JSON decoding or mapping. Resume loads the staged bytes and rehashes them; it does not refetch a pending page. The bounded JSON profile rejects malformed UTF-8, BOMs, duplicate decoded member names, prototype-related keys, lone surrogates and excessive depth/members/bytes. Source text is opaque data, never instructions or diagnostic content.

Stable publication IDs determine listing identity; URLs are optional metadata. Every run appends snapshot-bound listing-version and observation evidence. Exact duplicate observation drafts collapse; conflicting values retain distinct provenance. VIN remains internal under the pinned policy reference, and vehicle identity stays unresolved. Mapper output cannot widen the requested field scope.

Page commits atomically persist evidence, scoped projections, explicit tombstones, full-run membership, checkpoint and ledger/outbox. Full finalization infers missing publications only when the configured deletion mode allows it. Explicit-only reconciliation retains unseen prior active publications. Incremental updates preserve the next full baseline. Tombstones never physically delete historical observations or globally declare a vehicle absent.

Rate reservations are source-wide and survive new runs. Only typed transient/rate-limit failures are retried, within configured attempts and jitter bounds. Five transient failures open the circuit for 60 seconds; a fenced half-open probe owns recovery. Timeouts are not automatically retried because the abandoned effect may still be executing. Terminal returned errors have `retryable: false`.

## Operations and production activation gate

Durable mutation records/outbox contain fixed event kinds, opaque IDs, counts, timing, revisions and typed outcomes. Mirrors can fail without losing authoritative audit evidence. Neither channel should contain source text, publication IDs, URLs/cursors, credentials, VIN/PII or raw exception messages. Consumers can derive success/parse-error/latency/freshness signals from persisted records and the registry health contract.

Before any real source activation, independently prove authenticated current rights/evidence, source-specific representative fixtures, streaming byte caps, fenced durable store transactions under crash/partition tests, retention/cache/PII/media enforcement, takedown handling, credentials/access isolation, a source-health dashboard and tested alerts. These are **not** proven by synthetic SDK tests. No real source dashboard, retention worker or alert deployment exists in this package.

Retention deadlines cap raw storage by authorization expiry and any requested PII/licensed-media requirements; cache lifetime is separate. Reference-only media does not imply permission to store media assets. A stored raw page expired at the exact deadline cannot be loaded, mapped or silently reacquired under the same pending checkpoint.

## Compatibility and rollback

V1 is additive and internal. No database migration is performed. Future stores must persist the versioned contracts exactly and migrate explicitly; never reinterpret an old idempotency key or checkpoint using a different adapter, mapper or configuration. Stop SDK callers and disable the source before rolling back code. Preserve raw evidence, mutation receipts, checkpoints and tombstones subject to lawful retention; do not erase history to retry a failure. Before re-enabling callers, establish compatible state and rerun store-specific contract tests.
