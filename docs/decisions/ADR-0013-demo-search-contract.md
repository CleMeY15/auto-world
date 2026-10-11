# ADR-0013 — Synthetic search contract V1

Status: Accepted for TASK-0101 after independent architecture/code/security/data-rights review and implementation CI `38179111623` on `90dd8d52`; final-head/main delivery record is [PR #148](https://github.com/CleMeY15/auto-world/pull/148). No API/read-port behavior is delivered by this task.

## Context, decision and alternatives

Follow [the accepted P1 plan](../../roadmap/plans/TASK-0006-synthetic-first-slice.md), [ADR-0012](ADR-0012-synthetic-development-lane.md) and unchanged [SDK V1](ADR-0003-connector-sdk-api.md). TASK-0006 and TASK-0007 are accepted on main through PRs #146/#147; TASK-0005 remains incomplete. Reuse the existing SDK lifecycle and its single in-memory test store. Create only a demo fixture adapter/harness and a small dependency-free public DTO/validator package, `@auto-world/demo-search-contract`, depending solely on the public vehicle-schema package.

The contract is synthetic and publication-scoped: it neither resolves vehicles nor authenticates a source right. V1 reads exactly the single SDK ConnectorScopeId pinned by the corpus manifest for `src_sdk_synthetic / FR / feed`; it must not union different scope heads for the same ListingId. Source/scope identities stay internal. API and UI consumers must not expose the internal vehicle schema. Reusing that internal DTO would leak raw/source/VIN/policy details; a new ingestion/store engine would duplicate accepted lifecycle rules. Neither alternative is selected. A generic schema/transport framework is unnecessary for this closed contract. No new external dependency, database, network transport, container, deployment or production registry is introduced.

TASK-0101 declares/validates the read contract and proves SDK committed evidence. TASK-0102 alone implements and behaviorally tests `DemoReadPort`; TASK-0103 implements the user flow. No read-port factory/query execution belongs to this task.

## Query and ordering

`DemoSearchQueryV1` has required `schemaVersion:1`, `sort`, and optional `priceMaxMinor`, `mileageMaxKm`, `cursor`. Unknown keys, natural-language text and unsupported filters fail validation. There is no default/coercion/implicit LLM parsing. Sort is one of `listing_asc`, `price_asc`, `price_desc`, `mileage_asc`, `mileage_desc`. Maximum price is a nonnegative safe integer of **EUR cents**; maximum mileage is a finite nonnegative kilometre value, bounded by Number.MAX_SAFE_INTEGER. Negative zero is rejected; zero is a valid filter. Page size is fixed at 20, not an additional user filter.

TASK-0102 selects the latest observation per field by observed UTC timestamp, then ordinal ASCII internal observation ID ascending (not locale-sensitive ordering); the last wins. All contradictory evidence remains. Filters compare the selected EUR/km observation only; absent or differently denominated values fail that filter. Price/mileage sorting compares only EUR/km respectively, puts absent/other-unit values last in either direction, then breaks ties by ordinal ASCII ListingId ascending. No conversion or inferred specification occurs.

Public cursors match `cur_` plus 64 lowercase hex digits; syntax does not authorize continuation. TASK-0102 binds an opaque cursor to fixture version, committed projection watermark, exact normalized filters/sort and pagination position. Unknown, changed-query or superseded-projection cursors yield a bounded `invalid_cursor` failure, never an implicit restart or mixed snapshot. Cursor internals must not encode/expose source/run/snapshot/raw IDs. Cursor generation/storage is deliberately not implemented here.

## Result and sanitized evidence

`DemoResultV1` has exactly `listingId`, `availability`, `price`, `mileage`, `evidence`:

- `listingId` is the accepted branded ListingId, stable for source + source listing ID, never derived from URL alone.
- `availability` is `active|withdrawn|deleted|missing`. Search returns active only; detail may return historical ended evidence. Neither is a VehicleEntity or a sale offer.
- `price` / `mileage` is `{status:"unavailable"}` or `{status:"observed", value, evidenceId}`. Price values preserve the six V1 currency codes and minor-unit convention; mileage preserves `km|mi` and the V1 finite measurement convention. No unit conversion, rounding or plausible-value score is invented.
- `evidence` is a dense readonly array, at most 256 entries, of `{evidenceId, field:"price"|"mileage", observedAt, confidenceBps, value}`. Evidence ID is `ev_` plus 64 lowercase hex digits, domain-separated from internal observation/raw identities. TASK-0102 generates it from the listing/observation association using a dedicated public-evidence framing; no raw hash is returned. IDs are unique across a response. Timestamp is exact UTC with milliseconds (calendar years 0001..9999); confidence is an integer 0..10000, including zero.
- Evidence is chronological, preserving the internal observation-ID tie order. Public validators can verify nondecreasing timestamps, unique IDs, field/value consistency and that the selected value/reference equals the last evidence entry for that field; only TASK-0102 can verify the internal tie association. A field is unavailable exactly when it has no public evidence. Historical ended results may still have observed values, always labeled unavailable as a publication by their `availability`.

No source ID, source listing ID, run ID, snapshot ID, raw SHA-256/bytes, URL, VIN, policy reference, seller PII, make/model/year/location/photo, valuation, trust/deal score or VehicleEntity is permitted anywhere in the DTO. Unknown keys are rejected, not silently stripped or echoed. Sanitized evidence is fixture provenance, never verified automotive truth or legal authorization.

## Response envelope and freshness

`DemoSearchResponseV1` has required `schemaVersion:1`, `dataMode:"synthetic"`, `fixtureVersion`, `dataAsOf`, `state`, `results`; optional `nextCursor`; and state-specific keys below. Fixture version is a trimmed ASCII token `[A-Za-z0-9][A-Za-z0-9._-]*`, length 1..64. Results are dense, unique by ListingId, at most 20. All evidence times are at or before `dataAsOf`.

`dataAsOf` is the latest `recordedAt` of an acknowledged committed `page.committed` or `full.finalized` SDK ledger receipt for the pinned scope that is included in the read snapshot. Exclude acquisition/staged raw, run-open/attempt/terminal telemetry and response wall time. Complete snapshots require a successfully finalized full baseline and all requested fixture steps completed; partial snapshots keep the same applied-commit watermark while known required work is incomplete. A truly empty completed full run still has its `full.finalized` watermark. Without any applied projection/finalization receipt, return `read_unavailable`, never fabricate an empty snapshot/time. TASK-0102 verifies receipt/scope and snapshot membership; this parser cannot authenticate storage receipts. A response validator takes an explicit exact-UTC `asOf` argument; no ambient clock. Future projection watermarks are invalid. The freshness bound is **60,000ms**: age <=60,000 is fresh; strictly greater is stale.

| State | Required meaning and extra keys | UI-visible meaning |
| --- | --- | --- |
| `complete` | Fresh, known complete fixture-scoped matching set; required safe-integer `totalCount` 0..10000, >= page length. No `reason`. | A count is allowed, explicitly demo-scoped; zero is an honest empty state. |
| `partial` | Fresh but known incomplete projection; required `reason:"projection_incomplete"`; `totalCount` forbidden. | Some results may be missing; retain filters and offer retry; never claim a complete count. |
| `stale` | Age >60,000ms, even if underlying projection is also partial; required `reason:"projection_stale"`; `totalCount` forbidden. | Data may be outdated; retain context and offer refresh; never imply a current complete inventory. |

The producer MUST emit `nextCursor` if and only if at least one matching result remains after this page in the bound snapshot/query. `totalCount` is the global fixture-scoped match count, not page length; last-page absence cannot be inferred merely from `totalCount > results.length`. A cursor is valid only on a nonempty page and, in complete state, requires `totalCount > results.length`. The parser checks that necessary shape/state condition only: it cannot inspect an opaque offset or prove the producer's iff rule. TASK-0102 tests exact first/middle/last-page and binding semantics. Cursor existence is not a completeness claim in partial/stale state. The validator rejects fresh `stale`, expired `complete|partial`, missing dataMode/watermark/reason and forbidden counts; there is no silent fallback to `complete`. An unavailable read is a typed failure, not a fabricated empty complete response. Detail reuses the envelope with at most one matching result and no cursor; TASK-0102 tests those route-specific constraints. Exceeding 256 evidence entries per result or 10000 total matches returns `read_unavailable`; no silent truncation, clamp or artificial partial state is permitted.

## Read port declaration and failures

`DemoReadPort` declares `search(query:DemoSearchQueryV1, context:DemoReadContext)` and `getListing(listingId:ListingId, context:DemoReadContext)`, both returning `Promise<DemoReadOutcome>`. Context contains readonly `requestId:string` and `signal:AbortSignal`; TASK-0102 generates/validates and propagates request IDs without accepting raw query/identity text. It owns HTTP error mapping, request-ID wrapper, bounded input, host/origin/CORS and telemetry.

`DemoReadOutcome` is `{success:true,data:DemoSearchResponseV1}` or `{success:false,error:{code:"invalid_cursor"|"read_unavailable"|"cancelled"}}`. A known absent detail is a successful empty complete envelope, mapped to a typed not-found HTTP response by TASK-0102. An unavailable store never becomes that absence. No arbitrary error text or internal exception enters a public failure. This interface is a declaration, not a test of store behavior.

## Validator and build boundary

Exports: the named types, `parseDemoSearchQuery`, `parseDemoResult`, `parseDemoSearchResponse(input, asOf)`, `DEMO_PAGE_SIZE=20`, `DEMO_FRESHNESS_MS=60000`. Parsers return the existing `ValidationResult<T>` vocabulary; errors contain schema-owned paths/codes only, never unknown keys, input values or thrown messages. Inputs are plain/null-prototype objects and dense ordinary arrays with enumerable own data descriptors only; accessors are not invoked, symbols/non-enumerables/augmented/sparse arrays/custom prototypes fail closed. Reflection failures are sanitized. Successful graphs are fresh, recursively frozen and readonly; no source object is mutated or retained.

Tiny local native guards follow the accepted validation boundary without importing private vehicle-schema helpers or extracting a generic framework. Public ListingId parsing is reused. Byte/JSON ingress limits belong to the SDK or future API; validators do not fetch, persist, log, normalize arbitrary text or authenticate JavaScript proxies.

The SDK store/fixtures move without behavioral rewrite to `connectors/_sdk/test-support`, omitted from SDK production exports/build/package files; SDK tests and the demo harness use that same implementation. Test-support and each demo module reject `NODE_ENV=production`. `connectors/synthetic` has only an explicit demo-condition entrypoint, no ordinary/root production export, no runtime build output or deploy entrypoint. Negative child-process imports (including forcing the demo condition in production), package/build/import-graph checks and blocked network-primitive tests prove these bounded composition claims; they are not an OS sandbox or authentic authorization proof. The public contract build contains no fixture/SDK/test-support imports.

## Corpus, SDK proof and observability

The versioned `synthetic-search-v1` manifest pins exact UTF-8 file bytes/SHA-256; tests detect changed bytes without version/pin updates. Cases: valid, malformed (raw staged, nothing published), contradictory (both observations retained), withdrawn (historical evidence kept, active projection ended), plus empty and partial/full variants. Only synthetic price/mileage values and neutral publication tokens are present. Adapter reads those files only, honors bounded bytes/abort, strictly maps SDK-decoded JSON to drafts, and never supplies provenance/identity itself.

Authenticated-current test authority is still invoked at SDK acquisition/publication boundaries; its enabled `dealer_feed` registry fixture is not evidence of a real agreement. Tests cover exact replay, partial/full reconciliation, revoked/expired authority, raw expiry, cancellation and faults, with unchanged SDK regression tests. SDK ledger/outbox/allowlisted telemetry and bounded parse/withdrawal/circuit signals provide the test observability; repeated typed failures must prove the existing circuit plus a demo-only bounded alert. No deployed dashboard, pager, durable transaction or backup is claimed.

## Compatibility, verification and rollback

V1 parsers reject other versions/unknown fields and unsupported vocabularies. Breaking field/query/state/semantics/limits changes require a V2 ADR and explicit consumer migration; changing npm package version alone is not compatibility. A new fixture version with unchanged semantics may reuse V1, but invalidates old cursor bindings. Do not alter accepted vehicle/registry/SDK V1 shapes.

Verify targeted contract and corpus tests; all existing SDK regressions on the shared store; root lint/typecheck/tests/build, UI regression, secrets/dependency audit, real nonzero Turbo tasks and independent architecture/data-rights/security/code reviews. Retain production-exclusion/no-egress failures and complete/partial/stale boundary vectors in [TASK-0101 evidence](../validation/TASK-0101.md). Commit Done only after implementation acceptance and initial CI; final-head CI, reviewed-tree merge and main CI govern dependency acceptance. TASK-0102 remains blocked until then.

Rollback removes the isolated demo composition/public contract before consumers couple to it, reverting the store move without rewriting its behavior. No server data, image, credential, migration or production activation changes. After API/UI coupling, coordinate a versioned reader/writer revert; never delete or rewrite historical evidence as a shortcut.
