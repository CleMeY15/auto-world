# ADR-0032 — One persistent projection for the local V2 web prototype

Status: Accepted design, sequential Architect and Critic approval2026-11-08; implementation/validation TASK-0119. Prototype-only under ADR-0028.

## Decision and drivers

Retain the existing V2 UI and its exact synthetic taxonomy, but derive its documents from the same PostgreSQL raw/canonical history and immutable OpenSearch generation as the prototype. Inject a synchronous pure description projector at composition; do not import the offline in-memory engine into search. The current UI's make/model/year filters and provenance are preserved rather than silently removed. No external data or new dependency.

V1 snapshot and persisted payload interpretation remain unchanged. Explicit V2 snapshots carry taxonomy reference, profile fingerprint and V2 documents; mapping2 uses separate index names/metadata. Historical batches always use their recorded mapping. V1 public reads can strip only the V2 additions; V2 reads require an exact V2 publication/catalog identity.

Validate the complete canonical V1 snapshot first, then raw association metadata and aggregate/per-page budgets, then load referenced raw bytes, recheck length/hash and invoke the bounded projector. It may only add description/evidence fields. Search reparses every V2 result and checks the unchanged V1 fields/order/count. Preserve historical statements; latest omission means unavailable, not carried-forward information. Raw bytes and internal identifiers never enter public DTOs/logs.

Migration0002 is additive: preserve0001 SQL/checksum and append-only history; process ordered checksum/action entries as a stack. Broaden only mapping/index constraints, publication metadata and worker `SELECT(raw_bytes)`. API gains no raw/canonical access. Down refuses existing V2 history/indexes. No registry table or generalized migration framework.

The profile fingerprint covers fixtureVersion, taxonomy reference, mapperVersion and ordered raw descriptors. It persists in V2 snapshot/batch/index metadata. A dedicated web project refuses existing V1 history or another V2 identity before seed/listen. Seed is opt-in, stable, SDK-ingested and uses distinct source listing IDs. No in-place conversion or fake freshness at restart.

## UI and alternatives

Server-only closed mode selects fixed3210 (original) or3211 (prototype); unknown/disabled fails closed. Web3111 leaves preview3100 intact. No API-outage fallback. Reuse existing components/tokens and all states. Three fixed per-mode browser keys isolate favorites/searches/comparisons; no copying or deleting original bytes. Personal lists remain local, not synchronized accounts.

Rejected thin V1 adapter: cheaper, but removes existing descriptions/filters. Rejected memory V2 behind3211: apparent parity without durable authority or recovery proof. Selected tradeoff: one bounded worker raw-read capability and additive format/migration, in exchange for a real persistent end-to-end journey. API remains raw-blind.

## Consequences and validation

TASK-0119 requires byte/provenance/compatibility tests, real database/index/Next and browser journeys, restart/idempotence/failure checks, visual/accessibility/performance review and exact-source delivery. Preserve consumer fencing/quarantine/manual replay and ADR-0031 recovery. Rollback uses original demo and owned process stop; never evidence deletion. Usable V1 demonstration precedes any separately authorized real-source/public release/security qualification; those are not implicitly started by this task.
