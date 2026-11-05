# ADR-0030 — Disposable OpenSearch generations for the V1 prototype

Status: Implemented decision, 2026-11-05; independent code review APPROVE and architecture review CLEAR after incorporated boundary repairs. Local real-service validation passes; exact-source CI and delivery acceptance remain required. No production approval is implied.
Task: [TASK-0105](../../roadmap/tasks/TASK-0105-supported-search-projection.md), after TASK-0104's accepted [PR224 checkpoint](https://github.com/CleMeY15/auto-world/pull/224#issuecomment-6662552697).

## Scope and reuse

Keep PostgreSQL authoritative. Reuse its accepted store, the pinned PostgreSQL/OpenSearch images, existing isolated Compose lifecycle, `pg`, Node's HTTP client, public SDK/DTO parsers and `createDemoApi`. Add no ORM, message broker, Redis dependency, search client package, UI or V2 description support. Leave the offline V1/V2 demo unchanged. This is an explicit `auto-world-prototype` composition, forbidden in production, for the pinned fabricated V1 source/scope only.

## Bounded generation publication

For this fixture profile, rebuild a complete, immutable concrete index instead of implementing mutable per-document ordering/version machinery. Bound the profile to 10,000 listings and 256 public observations per listing, with a separate total snapshot byte bound. An incremental update engine is not required to establish the V1 prototype.

Capture a consistent PostgreSQL snapshot and its exact visible relevant outbox keys. Only `page.committed` and `full.finalized` affect this projection; raw staging, attempt/runtime bookkeeping and run opening are not indexing events. Identify delivery by the full source/run/operation key, not a timestamp high-water mark: an earlier timestamp is not proof that a transaction already committed. Order same-source committed receipts by their immutable lease fence and checkpoint revision, verifying timestamps and ownership. Never use operation-key lexical order as commit order.

Persist a bounded sanitized batch before network work. Retries use the same captured payload and event keys, never accidentally acknowledge newer commits. The consumer's versioned checkpoint, delivered keys, pending batch and append-only quarantine live in a separate `aw_search` schema. No canonical history or ingestion migration is rewritten. Keep transactions short; do not hold a database transaction across an OpenSearch request.

Create a unique concrete index with a versioned strict mapping, bulk only allowlisted public results, inspect every bulk item, refresh, seal with `index.blocks.write`, and verify the complete generation including derived filter/sort fields before publication. Publish its concrete name and metadata together with delivered keys in one PostgreSQL transaction. A reader uses that concrete index, never an independently switched alias. An abandoned index is disposable, not a published checkpoint. A session advisory lock and durable fencing/CAS prevent overlapping consumers or a disconnected predecessor from publishing over a newer worker.

Persist each attempt before network work. Retry transient generation failures with bounded backoff, at most five attempts for the batch's events, including across process restarts. Poison validation or exhaustion appends a fixed-code diagnostic, halts without advancing the published checkpoint, and emits a critical alert. A separate explicit operator-reviewed replay records its review and preserves the original quarantine evidence. Rebuild/reconciliation follows the same publication path; no bypass of a halted batch.

## Read contract and privacy

Preserve the V1 query/response contract, EUR/km filtering, missing-last numeric sorts, ListingId tie-break, 20-result pages, replayable opaque cursors and the 1,024-cursor bound. Bind cursors to the published generation and normalized query. A changed generation invalidates old cursors. No TTL or eviction of an otherwise valid cursor is introduced.

Increment a private durable publication revision in the pointer/delivery transaction. Each API process retains a revision high-water mark: reject a delayed lower-revision PostgreSQL response, or an equal-revision response with a different generation, before synchronizing cursor state. This prevents concurrent pooled reads from invalidating a newer cursor by reinstalling an older generation. Cursor tokens remain process-local, as in the existing demo; restarting the API invalidates them without changing the durable publication.

Derive `dataAsOf` from the included committed receipt, never the refresh/response clock. A successful full baseline and matching canonical membership are required for `complete`; an incomplete projection is `partial`, and age over 60 seconds takes precedence as `stale`. Partial/stale responses omit `totalCount`. Missing indices, timeout, failed shards or inexact totals cannot masquerade as a complete empty result. Search requests use exact hit counts and reject partial shard results.

The publication read also returns `pendingRelevant`, computed in the same SQL statement from the relevant outbox/delivery anti-join. Even a fresh previously complete generation is `partial` while a newer canonical commit awaits publication; stale still takes precedence. An absent detail under partial/stale is unavailable, never a false 404. Non-indexing outbox kinds receive an explicit durable `noop` disposition without changing the publication or invalidating cursors.

The index contains only parsed public V1 fields plus derived numeric sort/filter fields. Raw bytes, internal VIN, policy references, source listing identifiers and seller PII are omitted, not merely hidden from indexing. PostgreSQL provenance metadata may be checked in-process but never copied into the index or logs. Diagnostics and telemetry use fixed codes and bounded counts/durations.

Use dedicated `aw_search_worker` and `aw_search_api` login roles, not the existing broadly privileged writer/reader. Worker grants name the required canonical columns and exclude raw bytes, semantic commands and writes to ingestion. The API can only execute a fixed-search-path, owner-defined publication function; it has no canonical table privileges. A task-local bootstrap uses the existing owned-project bootstrap capability to provision the roles, then the ordinary migrator applies the checksum-verified schema. Distinct credentials are derived with domain-separated HMAC from the project's random bootstrap secret; they are neither logged nor supplied to the browser. No existing infrastructure credential format or bootstrap script changes.

Separate immutable batch manifests/event membership, attempt records, quarantine and replay-review records from the disposable payload and mutable consumer state. Keep the current published payload and the pending/quarantined payload for exact reconciliation. Delete only obsolete derived payloads, never canonical records or diagnostic history. An explicit reviewed replay starts a new bounded attempt cycle and keeps the previous cycle's evidence.

Retire obsolete concrete indices during consumption, including idle polls. Each name must be durably allocated by an attempt and match exact OpenSearch ownership metadata. Never delete the current publication. For a formerly published generation, the 120-second grace starts at its atomic replacement, not its creation; an abandoned unpublished attempt uses its attempt time. This exceeds the API's five-second request deadline and the consumer's 55-second deadline. Record replacement and completed retirement immutably. Sweep at most 100 candidates per call; a failed deletion emits `cleanup_deferred` and retains the candidate. A verified missing/corrupt generation can be rebuilt; a timeout, malformed response or partial shard result is an outage, not evidence justifying replacement.

## Validation and operations

Test parity with the existing offline V1 oracle, all five sorts, filters, paging/replay/invalidation, contradictory observations, partial/stale states and tombstones. Real pinned PostgreSQL/OpenSearch tests must cover duplicate/reordered delivery, crash recovery, quarantine/reviewed replay, failed publication, missing/stale/withdrawn reconciliation and unchanged canonical history.

Measure API p95 (<500 ms) and commit-to-queryable lag (<=60 seconds healthy) separately with stated fixture size/sample count. Test continuous lag >60 seconds for five minutes (warning) and immediate quarantine/halt (critical). Ordinary root quality/secrets/dependency checks, exact-source CI, protected-main CI and focused independent reviews remain required. TASK-0005 image/scanner qualification remains deferred under ADR-0028; TASK-0106's combined operational gate is not claimed here.

Rollback stops the prototype process and restores the prior application version without deleting PostgreSQL history or quarantine evidence. Unpublished derivative indices can be cleaned only within this task's owned prefix/project; active and potentially in-flight reader generations must be retained. An empty-only schema rollback must refuse occupied consumer state. Document exact commands and evidence in `docs/validation/TASK-0105.md` before acceptance.

## Upstream references

- [OpenSearch bulk item outcomes](https://docs.opensearch.org/latest/api-reference/document-apis/bulk/)
- [Synchronous refresh](https://docs.opensearch.org/latest/api-reference/index-apis/refresh/)
- [Search failure/partial-result controls](https://docs.opensearch.org/latest/api-reference/search-apis/search/)
- [Numeric sorting and missing values](https://docs.opensearch.org/latest/search-plugins/searching-data/sort/)
- [Strict mapping](https://docs.opensearch.org/latest/mappings/mapping-parameters/dynamic/)

These APIs are verified against the repository's pinned OpenSearch 3.8.0 in integration tests, not inferred from newer `latest` documentation alone.
