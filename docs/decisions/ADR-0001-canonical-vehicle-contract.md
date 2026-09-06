# ADR-0001 — Canonical vehicle evidence contract V1

Status: Accepted for TASK-0002 implementation; release requires independent review and all task gates.

## Context and decision

Follow `docs/architecture/ARCHITECTURE.md`, `docs/VEHICLE_INTELLIGENCE.md`, `docs/STRATEGIC_MOATS.md`, `docs/data/DATA_PLATFORM.md` and `docs/security/SECURITY_LEGAL.md`.
An announcement is not a vehicle. V1 is an internal, dependency-free TypeScript contract for canonical candidates, publications and immutable evidence. It is not a database, resolver, public DTO, rights registry or VIN decoder.

Native validators suit this small closed contract and avoid a new dependency. A generic extensible schema framework was rejected: exhaustive field unions and narrow validators make semantic review easier. No client may infer production permission from successful parsing.

## Public shape

All fields are required unless explicitly optional. All exported domain properties and nested arrays are readonly.

- `VehicleEntity`: `{schemaVersion: 1, vehicleId: VehicleEntityId, identityStatus: "candidate", observationIds: readonly ObservationId[]}`. It never declares identity verified.
- `Listing`: `{schemaVersion: 1, listingId: ListingId, sourceId: SourceId, sourceListingId: string, identity, observationIds: readonly ObservationId[], url?: string}`.
- Listing `identity`: `{status: "unresolved"}` or `{status: "candidate", vehicleId: VehicleEntityId}`. These are association candidates, never automatic merges.
- Stable publication identity is the pair `sourceId + sourceListingId`, independent of URL changes. `sourceListingId` is a nonempty opaque string of at most 256 UTF-16 code units, with no control characters or leading/trailing whitespace. It is untrusted data, never interpreted as instructions. URL alone cannot satisfy identity.
- Optional `url` is HTTPS, has a hostname and no userinfo, is at most 2048 code units and contains no whitespace/control characters. Parsing performs no network request and is not an SSRF allowlist. Original URL spelling is retained, not canonical identity.
- `Observation`: `{schemaVersion: 1, observationId: ObservationId, subject, field, value, provenance}`. Subject is `{kind: "vehicle", vehicleId: VehicleEntityId}` or `{kind: "listing", listingId: ListingId}`. The discriminator determines the only valid ID property.
- `Provenance`: `{sourceId: SourceId, observedAt: string, acquisitionMethod, legalStatus, confidenceBps: number, raw}`.
- Raw reference: `{snapshotId: RawSnapshotId, connectorRunId: ConnectorRunId, sha256: string}`. SHA-256 is exactly 64 lowercase hexadecimal characters. Bytes are stored separately; only TASK-0004 may validate the digest against acquired bytes.
- Acquisition methods: `api`, `feed`, `crawl`, `manual`. Legal statuses: `official_api`, `licensed_partner`, `dealer_feed`, `permitted_crawl`, `restricted`, `blocked`, `unknown`. These describe evidence, not authorization. Source Registry owns activation and policy transitions in TASK-0003.
- `confidenceBps` is an integer in 0..10000; zero is valid and never omitted or treated as missing.
- `observedAt` exists only in provenance, in exact UTC form `YYYY-MM-DDTHH:mm:ss.sssZ`, year 0001..9999. Validate the calendar by exact round-trip, not permissive `Date.parse` alone. Offsets, missing precision, rollover dates and leap seconds are rejected in V1; future adapters explicitly normalize timestamps before this boundary.

## IDs and values

IDs are distinct nominal/branded string types. At runtime each has its own prefix and a 1..64 character ASCII suffix matching `[A-Za-z0-9][A-Za-z0-9_-]*`: `veh_`, `lst_`, `obs_`, `src_`, `run_`, `raw_`. No casts from another ID domain are performed at the boundary. IDs must remain stable across replay; ID generation is a consumer responsibility, not based solely on URLs.

`field` is an exhaustive discriminant; there is no arbitrary field/value catchall:

| Field | Value |
|---|---|
| `price` | `{amountMinor: number, currency: "EUR" \| "USD" \| "GBP" \| "CHF" \| "JPY" \| "KRW"}` |
| `mileage` | `{amount: number, unit: "km" \| "mi"}` |
| `power` | `{amount: number, unit: "kw" \| "metric_hp"}` |
| `co2` | `{amount: number, unit: "g_per_km", standard: "wltp" \| "nedc"}` |
| `vin` | `IdentityEvidence`, defined below |

Money uses nonnegative safe integers in minor units (EUR/USD/GBP/CHF: hundredths; JPY/KRW: whole units); no currency conversion occurs. Measurements are finite numbers in 0..Number.MAX_SAFE_INTEGER, with fractional values permitted and no silent rounding or unit conversion. Negative zero is rejected for all numeric domain values. This is structural representability validation, not a physical-plausibility score.

`IdentityEvidence` is `{status: "unavailable"}`, `{status: "withheld"}`, or `{status: "full", vin: string, accessPolicy: {visibility: "internal", policyRef: string}}`. A full VIN is exactly 17 uppercase ASCII characters from `[A-HJ-NPR-Z0-9]`; syntax does not certify authenticity, check digit, uniqueness or lawful access. `policyRef` uses 1..128 ASCII alphanumeric/underscore/hyphen characters and references an internal authorization record, not secret text. Full evidence is rejected unless provenance legalStatus is one of the four permitted categories. Policy existence, current rights, retention and consumer access controls are checked by later registry/storage/API boundaries. Unavailable/withheld evidence must carry neither VIN nor accessPolicy. Never infer or reconstruct missing characters. The package has no public projection; consumers must not expose this internal contract directly.

## Validation and ownership boundary

Exports: `parseVehicleEntity(input: unknown)`, `parseListing(input: unknown)`, `parseObservation(input: unknown)`, `parseObservationCollection(input: unknown)` and `appendObservations(existing: unknown, incoming: unknown)`.

Every function returns `ValidationResult<T>`: `{success: true, data: T}` or `{success: false, issues: readonly ValidationIssue[]}`. An issue contains only `{code, path}`. Codes are `invalid_type`, `unknown_key`, `missing_field`, `invalid_value`, `unsupported_version`, `duplicate_id`, `observation_conflict` and `invalid_object`. Paths use `$` plus schema-owned property names and numeric array indices. An unknown or sensitive input key is not echoed; its enclosing schema path is reported. Issue values never include raw data, VINs, source text, thrown exception messages or object stringification. Deterministic fail-fast validation is sufficient; no unbounded error accumulation.

Accept already-parsed plain objects (Object.prototype or null prototype) and dense ordinary arrays only. Reject unknown own keys (including symbols/non-enumerable properties), accessors without invoking getters, inherited/class prototypes, sparse arrays and array extra properties. Optional means absent, not present-with-undefined. Object reflection can encounter a hostile Proxy; catch failures and return sanitized `invalid_object`, but this package is not a sandbox for executing arbitrary in-process JavaScript. JSON decoder byte/depth/duplicate-member limits belong to TASK-0004.

Construct fresh plain objects and arrays from validated primitives only, retain no mutable input reference, and recursively freeze successful data (including replay/append results). No source object is frozen or mutated. Observation-reference arrays and collections contain at most 10000 entries. Reference arrays reject duplicate IDs. Other shapes have fixed shallow depth; no arbitrary recursive payload is retained.

## Replay and contradictions

Error conventions: wrong JavaScript primitive types produce `invalid_type`; type-correct but out-of-domain values produce `invalid_value`. Malformed array structure (holes, extra keys, symbols, descriptors or bounds) produces `invalid_object` at the array path. A full VIN with disallowed legal status produces `invalid_value` at the observation's `provenance.legalStatus`, never at a path derived from source text.

Collection parsing validates all observations, preserves first-seen order and collapses only exact replays: same observation ID plus identical validated content. Canonical construction order makes property ordering irrelevant. Reusing an ID for any changed subject, value, provenance or raw reference fails with `observation_conflict` at that array entry; it never replaces prior evidence. Different IDs with contradictory values remain distinct. `appendObservations` validates both collections and returns a fresh frozen combined collection with identical semantics; it never mutates prior history. Reference existence and cross-record relationships are the future persistence aggregate's responsibility, not silently resolved here.

## Compatibility, security, operations and rollback

Writers emit exactly schemaVersion 1; readers reject every other version. There is no prior production schema/data to migrate. Any incompatible shape or expanded value vocabulary requires an explicit compatibility decision and consumer tests; package versioning alone is not a data migration. Downstream packages import the public built export, not private validator internals.

No runtime service, telemetry exporter or database is added. Stable sanitized issue codes/paths provide the ingestion metrics/log boundary. V1 never fetches a URL, activates a source, verifies a licence, resolves a vehicle, calculates tax or logs input. There is no risky production rollout to flag. Roll back by reverting this task before consumers couple to V1; after consumers exist, coordinate versioned readers/writers and retained raw replay, never destructive history rewriting.

Fixtures are explicitly synthetic, contain no seller PII, real source payload or credential, and are not verified automotive golden data. The hypothetical fixture legal status does not authorize a real source. Tests cover discriminants, runtime/type ID mismatches, strict boundaries, calendar/number limits, provenance/VIN constraints, detached immutability, contradictory evidence, replay conflicts and built-export serialization round-trips. Root quality gates, fresh remote clone, CI and independent code/architecture review are mandatory.

Deferred owners: production authorization (TASK-0003); raw JSON decoding/digest verification and connector lifecycle (TASK-0004); public VIN projection (first exposing API); taxonomy, identity resolution, persistence, lifecycle/user corrections and the first real legacy migration (their own DoR-complete tasks). No UI is introduced by TASK-0002.
