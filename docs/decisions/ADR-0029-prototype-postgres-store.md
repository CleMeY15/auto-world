# ADR-0029 — PostgreSQL transactional store for the isolated V1 prototype

Status: Architecture and independent code/data review approved, 2026-11-05. Local real-PostgreSQL validation passes all 34 phases; final quality and delivery evidence is tracked in [TASK-0104 validation](../validation/TASK-0104.md). Exact-source CI, protected merge and merged-main acceptance remain separate gates.
Scope: Fabricated fixtures only, under [ADR-0028](ADR-0028-v1-prototype-functional-gate.md). Neither image admission nor production activation.

## Decision and reuse

Implement the existing nine-method `ConnectorStorePort` and three-method `ConnectorLeasePort` from [ADR-0003](ADR-0003-connector-sdk-api.md), without changing their public contracts. PostgreSQL owns the transactional truth; do not add an ORM, Redis lock, S3 staging operation, search index, API read adapter or new infrastructure manager.

Use the accepted PostgreSQL 17.11 image in `infra/images.json` and the existing project initialization, generated credentials, Compose isolation and ownership-checked cleanup. Select only the PostgreSQL service. Keep historical foundation migration 0001 unchanged. A separate, checksum-verified migration creates `aw_connector`; it does not reinterpret `aw_foundation` or its object-store references.

The connection library is the maintained `pg` driver, with matching TypeScript types; the user explicitly approved both on 2026-11-05. Use its parameterized queries and bounded pool, not a custom wire client or a subprocess per database statement. [Upstream transactions](https://node-postgres.com/features/transactions) require one checked-out client for the entire transaction.

## Prototype boundary

Place the implementation under `services/ingestion/prototype`, with its own TypeScript output and explicit `auto-world-prototype` conditional entrypoint. Ordinary production imports/build output cannot load it, and `NODE_ENV=production` fails closed even with the condition. The existing offline synthetic demo remains unchanged. Only the dev/test composition imports the existing synthetic corpus; the store itself depends on public SDK/contracts, never SDK private modules or the in-memory test store.

No browser/API selector, environment-driven production activation, source onboarding or real payload migration is added. TASK-0105 and TASK-0106 remain dependent on actual acceptance of this task on main.

## Transaction and lease boundary

One `sources` row per source is the serialization point. Acquisition creates the row if absent, then locks it with `SELECT ... FOR UPDATE`. Every lease/store operation takes the same row lock before reading or mutating source state. Different sources do not share an application-wide lock.

Lease acquisition allocates a random lease ID and strictly increasing safe-integer fence, using database time for expiry. Refuse acquisition at `Number.MAX_SAFE_INTEGER`, never overflow or recycle the counter. Renewal/release require the exact live lease ID/fence; renewal also requires the persisted TTL and does not revive an expired lease. A durable lease-ID index resolves renewal/release to the source because those port requests do not carry source ID. Release expires the lease but retains the fence counter. No mutation accepts an expired lease or another run's ownership.

`openRun` verifies the acquired lease and installs its fence under that lock. When it returns `oldFencesQuiesced: true`, all preceding same-source transactions have settled, and subsequent old-fence mutations reject. A delayed old transaction cannot pass takeover and commit afterward. All operations use a single database transaction/client; no adapter/network acquisition occurs while a transaction is open. Lock/statement/connection/idle-transaction deadlines are bounded.

On abort, transport failure or unknown COMMIT acknowledgement, discard the connection and reject with a fixed sanitized error. The SDK already classifies rejected writes as `mutation_indeterminate`; never invent an acknowledged rollback or retry a transaction body automatically. Recovery acquires a new fence, opens the run and checks the durable operation receipt. Distinguish acknowledged domain conflicts from infrastructure failures.

## Schema and atomicity

Use ordinary indexed PostgreSQL tables, `bytea` for raw bytes, `timestamptz` for deadlines and JSONB for the frozen versioned DTOs. Identity/source/run/scope columns and foreign keys provide relational ownership; JSONB avoids inventing a second canonical vehicle schema. No unbounded historical collection is loaded to execute a page.

| Table | Responsibility |
| --- | --- |
| `sources` | Source-wide lease/fence, installed fence, durable rate/circuit state |
| `runs` | Source/run identity and mutable versioned checkpoint; exact request/policy binding |
| `inventories` | Source/scope identity and mutable scoped inventory generation/revision |
| `raw_pages` | Immutable source/run/snapshot, copied bytes, server-checked SHA-256/length, pending metadata and obligations |
| `listing_versions` | Immutable version evidence and its canonical Listing snapshot, linked to raw provenance |
| `observations` | Immutable observations linked to matching source/run/raw and listing version |
| `tombstones` | Immutable explicit or inferred evidence; inferred absence has no invented raw reference |
| `projections` | Mutable source/scope/listing head; no mutation of historical evidence |
| `attempts` | Reservation receipt/fence and one-time completion ownership |
| `mutations` | Immutable operation identity, semantic command, result and sanitized public receipt |
| `outbox` | One immutable operation reference per mutation; event content is read from the immutable receipt |

Raw stage commits bytes, pending checkpoint, ledger and outbox together before decoding. Page commit atomically appends observations/version/tombstone evidence, updates scoped projections/incremental inventory and checkpoint, and appends ledger/outbox. Full finalization alone swaps full membership and emits permitted scoped missing tombstones. Failed/partial runs never infer absence. Terminal records do not erase a resumable checkpoint.

The database checks raw SHA-256 using PostgreSQL 17's built-in `sha256(bytea)` (no extension). The adapter validates complete command/provenance associations, scoped inventory/checkpoint compare-and-swap, contiguous page sequence, bounds, retention, exact mode-specific membership and SDK key formulas. Reuse public SDK runtime reducers for rate/circuit transitions. Do not import its private effect/key helpers or the test store.

An operation replay compares its complete canonical semantic command (excluding only transport signal and the top-level fence), never a caller-supplied digest alone. For raw staging, omit the duplicated bytes from the stored command, but compare the stored immutable bytes, metadata, computed digest and length as well. This avoids a second hidden raw-byte copy in the ledger. Other nested semantic fields, including nested fences, remain in the comparison. Return the original detached receipt, without advancing counters or adding an outbox entry. Conflicting reuse fails.

Semantic encoding version 1 sorts object keys recursively, preserves array order and distinguishes absent properties from explicit null. Accept only finite JSON values with ordinary data properties; reject unsupported values. The ledger stores the complete canonical text as well as SHA-256 over the version prefix and text. Raw stage additionally hashes the exact bytes with framed length for its audit digest and compares those bytes on replay; no caller digest substitutes for that comparison.

Raw reads bind source, run and snapshot. Both caller `asOf` and current database time must precede the retained deadline; equality is expired. Expiry also blocks a new stage/page commit or an exact stage replay from supplying expired bytes. Expiry refusal is not a claim that a production retention/takedown worker exists: no real data is permitted by this task.

## Migration, privileges and rollback

Run schema migration as the existing `aw_migrator`, never as the application writer. An advisory transaction lock serializes migrations; a version/checksum record makes identical reapply a no-op and rejects changed reuse. `aw_writer` receives only required SELECT/INSERT and mutable-state UPDATE privileges; reader access and immutable-evidence triggers follow the existing foundation pattern. No application TRUNCATE, schema ownership, superuser or DELETE capability.

The initial down migration locks the exhaustive eleven `aw_connector` tables listed above in `ACCESS EXCLUSIVE` mode and refuses any nonempty one. The separate `aw_connector_migration` version/event history is explicitly excluded from that empty-state test and preserved after rollback. Normal rollback stops the prototype and rolls back application code while preserving the schema, volumes and immutable evidence. Destructive restore into an occupied/unowned project is refused. Schema removal is allowed only for an owned empty test database through the explicit migration command.

## Acceptance evidence

Reuse the synthetic SDK scenarios against the real PostgreSQL adapter: full/incremental runs; exact/conflicting replay; raw-before-decode; immutable history; all deletion modes and scope isolation; durable rate/circuit state; raw expiry; failure before commit; lost stage/page/finalize acknowledgement; concurrent stale fence/takeover; maximum-fence refusal; restart and independent-pool recovery. Assert raw bytes/SHA, checkpoint, ledger and outbox directly, not only the happy-path result. Boundary tests must prove that only the conditional prototype subpath is exported, default imports cannot load it, production mode refuses it and the ordinary `dist` output contains no prototype or fixtures.

Run migration apply/reapply/empty rollback/refusal on nonempty data. Use official `pg_dump`/`pg_restore` for a PostgreSQL-only backup restored into a distinct owned empty project; compare immutable evidence/raw hashes/receipts, preserve a sentinel project and clean up only resources created by the test. Reuse existing runtime guards, not the four-service backup helper which requires S3.

Windows has no Docker executable, but the existing Ubuntu WSL Docker daemon is reachable by its root operator without changing host permissions. Use an isolated owned project there for local real-database checks; the PostgreSQL container still uses the existing non-root identity. Local unit/contract/type/lint/build checks cannot substitute for the real Linux PostgreSQL job. Require exact-source and accepted-main CI evidence, independent application-boundary/data/migration review and the task validation record before `DONE_FOR_V1_PROTOTYPE`. Do not dispatch TASK-0005 scanners or claim image security qualification.
