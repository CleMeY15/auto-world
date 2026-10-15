# ADR-0020 — Authored synthetic listing description V2

Status: accepted for TASK-0107 implementation, 2026-10-14. Delivery acceptance remains separate.

## Context and decision

The user approved fictitious make/model/year descriptions and exact filters in the existing demo. TASK-0008 taxonomy and TASK-0103 web flow are accepted dependencies. This independent synthetic increment does not unblock TASK-0005 or supported integration.

Preserve the canonical Observation V1, unresolved Listing identity, connector SDK, every V1 fixture byte/digest, default harness and public V1 API. Add an explicitly opt-in V2 raw envelope and public demo API. Authored description is **not** a resolved VehicleEntity, verified automotive fact, model year, complete registration date or tax input.

## Closed contracts

- Raw V2 page: `{schemaVersion:2,taxonomyRelease,items}`. Release is the exact catalog/release/revision reference. Active V1 items may add one atomic `description:{makeId,modelId,firstRegistrationYear,attribution:{kind:"synthetic_fixture",fixtureRef}}`. Description is all-or-none; partial/null values fail. Ended items retain V1 shape.
- Year is an exact integer1886..9999: only a fictitious first-registration year asserted by the fixture. No value is inferred from names or timestamps.
- The configured synthetic release is parsed through the existing taxonomy package. Raw parser validates reference equality, model-parent membership, attribution membership and unique source listing associations. It returns a detached SDK V1 draft with description removed plus detached description records. Both ingestion and read projection reuse this parser.
- V2 query: `{schemaVersion:2,sort,priceMaxMinor?,mileageMaxKm?,makeId?,modelId?,firstRegistrationYear?,cursor?}`. Model requires make. Read port rejects unknown IDs/cross-parent pairs as `invalid_query`; filters use only current description, never historical evidence.
- V2 result retains all five V1 fields and adds `description` (`unavailable` or `authored_synthetic` with `value,evidenceId`) and `descriptionEvidence`. Value is `{release,makeId,modelId,firstRegistrationYear,attribution}`; evidence is `{evidenceId,capturedAt,value}`. IDs are `de_` plus64 lowercase hex, opaque hashes of listing/version/raw association. Captured time is exact UTC milliseconds. Evidence is unique across a page, bounded256 per result and page with no truncation, ordered by capture then internal ASCII version ID. Repeated declarations remain separate evidence.
- The latest committed listing version alone determines current description. A latest version without description is unavailable even when history exists. Public parsing validates structure, chronological order and exact selected-value membership; only the read port can prove hidden version ordering/current selection.
- V2 search/detail envelope preserves V1 state/count/freshness semantics, at schemaVersion2 with an added `taxonomyRelease` reference. V2 catalog is `{schemaVersion:2,dataMode:"synthetic",fixtureVersion,taxonomyRelease}` with the complete sanitized release, not a listing dataset.
- `DemoReadPortV2` exposes `catalog(context)`, `search(query,context)`, `getListing(id,context)`. Search/detail errors: `invalid_query|invalid_cursor|read_unavailable|cancelled`; catalog errors: `read_unavailable|cancelled`.
- HTTP transport/flag rejection remains distinct from read-port failure: catalog may also return the closed `invalid_request|not_found|method_not_allowed|request_too_large|unsupported_content_type` errors with their exact status codes. Catalog parsing rejects search-only `invalid_query|invalid_cursor`; the proxy converts such invalid upstream outcomes into `read_unavailable`.

## Boundaries and routes

Keep `createSyntheticDemoReadPort()` V1; add `createSyntheticDemoReadPortV2()` using narrow shared internals. V2 recalculates raw SHA/length and proves committed listing/version/raw/receipt association before publishing description. Its cursor fingerprint includes release, version, capture, raw digest, validated description/absence and all filters. V1 parsing/fingerprint stays unchanged.

Add literal loopback-only GET `/v2/demo/catalog`, POST `/v2/demo/search`, GET `/v2/demo/listings/:listingId` and same-origin `/api/demo/v2/...` proxies. Reuse deadlines, bounded JSON, host/origin checks and redacted telemetry. Existing V1 routes remain. No production source, network fetch, real label, fixture import in browser, storage subsystem or external dependency is introduced.

Catalog loads app-wide, including direct Detail/Saved. Search initially reads only catalog, with no implicit search or search analytics. Make/model selectors are dependent; year is independent numeric input. Labels require matching fixture/release; on failure numeric search remains usable while labels/selectors remain unavailable with retry. Tuple equality is local consistency, not cryptographic authentication of a real catalog.

## Alternatives and consequences

A sidecar/browser metadata table would ship faster but introduce a second authority disconnected from retained raw evidence. Canonical identity V2 would be reusable but require unsupported resolution semantics and disproportionate migration. Choose raw-backed V2 for honest provenance, at the cost of one bounded catalog request and additional parsers. Reuse existing design primitives and API internals; do not introduce a generic router/parser framework.

## Validation, rollout and rollback

TASK-0107 requires V1 regressions, hostile V2 inputs, raw mutation/association tests, exact filters/pagination, real sockets/browser flow, visual/accessibility/performance gates and independent reviews. `AUTO_WORLD_DEMO=1` remains the entrypoint flag; production exclusion remains enforced. Rollback disables the demo or reverts this increment; V1 routes and versioned local favorite IDs stay readable/clearable. No database migration or production rights activation occurs. Real identity/partial identity/taxonomy acquisition requires a separate DoR and ADR.
