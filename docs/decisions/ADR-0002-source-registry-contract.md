# ADR-0002 — Declared Source Registry V1

Status: Accepted for TASK-0003 implementation after independent Architect and Critic plan approval.

## Context and decision

Source rights are an acquisition-governance boundary, not a vehicle fact. Add `@auto-world/source-registry` as a separate internal package with the single workspace dependency `@auto-world/vehicle-schema`. Reuse its public `SourceId`, `LegalStatus`, `AcquisitionMethod`, `ValidationResult` and an additive public `parseSourceId`. No private imports, inverse dependency, new external package, network, service, UI or real source registration.

This is a **declared-policy contract**, not proof of a licence, authenticated operator, complete/current history or operational authorization. A synthetic document can be structurally eligible. Recorded `enabled` state is administrative history, not permission to fetch. Before any production acquisition, a future caller must obtain the current head from an explicit authoritative-registry port, authenticate/audit changes, verify the referenced authorization, re-evaluate time/scope and enforce the returned obligations. TASK-0004 consumes this boundary; production storage/authentication/CAS/retention enforcement must be implemented and independently proven before real activation. No contract fixture fulfils these prerequisites.

Alternatives: adding registry to vehicle-schema would mix catalog and acquisition governance. Extracting a validation-core now would rehome the accepted vehicle contract prematurely. Keep small guards local with adversarial parity tests; reconsider extraction when a third real consumer justifies it.

## Public API and ownership

- `parseSourceRegistry(input: unknown): ValidationResult<SourceRegistry>`
- `appendSourceRevision(registry: unknown, nextRevision: unknown): ValidationResult<SourceRegistry>`
- `evaluatePolicyEligibility(registry: unknown, request: unknown, now: unknown): ValidationResult<PolicyEligibility>`
- `deriveSourceHealth(registry: unknown, sample: unknown, now: unknown): ValidationResult<SourceHealth>`

All inputs are already-parsed unknown values. All successful graphs are detached, deeply frozen and readonly; failures contain only existing vehicle-schema validation codes and schema paths, never unknown property names/values or exceptions. No coercion, accessor invocation, arbitrary prototypes, symbol/non-enumerable/unknown properties, sparse/augmented arrays or unsupported schema versions. Reflective failures are contained. Transparent Proxies cannot be authenticated by structural parsing. JSON/text byte limits and authenticated storage remain ingress responsibilities.

Timestamps are exact UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, valid calendar years 0001–9999, no normalization/leap seconds. No implicit clock. Numbers are safe integers, exclude negative zero. Seconds are bounded at 315360000 (representation limit, **not** legal guidance); positive durations start at 1. BPS values/thresholds are 0–10000. Latency is milliseconds, sample 0–300000 and threshold 1–300000. Counts are 0–1000000000.

Opaque audit/reference suffixes use 1–64 ASCII letters/digits/underscore/hyphen with alphanumeric first character. Source ID follows TASK-0002's `src_` format. V1 territories `FR|DE|KR|GB|US|CH|JP` are the supported product vocabulary, not an ISO database. Arrays are unique/nonempty and bounded by their vocabulary unless otherwise stated.

## Registry and immutable revision history

`SourceRegistry = {schemaVersion:1, sourceId, revisions}`; 1–1000 full snapshots, contiguous revision numbers 1..N. Each `SourceRevision = {revision, state, configuration, event}`. State is `disabled|enabled|takedown`. Event is `{eventId,kind,actorRef,at,reasonRef}`, with prefixes `aud_`, `actor_`, `reason_`. All event IDs are unique; timestamps never decrease.

| Event | Required transition |
|---|---|
| `create` | Only genesis revision 1, disabled |
| `replace_configuration` | Disabled/enabled → disabled; old full snapshot retained |
| `enable` | Disabled → enabled; unchanged configuration; every enable precondition valid at event time |
| `disable` | Enabled → disabled; unchanged configuration |
| `takedown` | Disabled/enabled → takedown; unchanged configuration; terminal V1 |

Historical parsing validates every transition. An expired policy can describe a historically valid enablement; current eligibility still fails. Only an identical **entire current last revision** replay is idempotent. Otherwise append requires N+1 with a new event ID; older replay, changed reuse, gaps or post-takedown transitions fail. Inputs and previous snapshots remain untouched. Key order is not content identity; array order is. Storage must implement current-head compare-and-swap and immutable durable audit: this package cannot detect a valid truncated historical prefix or authenticate its author.

## Source configuration and policy

`SourceConfiguration = {displayName,territories,acquisitionMethods,credentials,legalStatus,policy,operations,healthPolicy}`. Display name: trimmed, 1–120 code units, no C0/C1 controls. Seven legal statuses and four acquisition methods are exactly TASK-0002's unions.

Credentials are only `{kind:"none"}` or `{kind:"secret_ref",ref:"secret://auto-world/<alias>"}`. Alias has 1–128 ASCII alphanumeric/underscore/hyphen characters, alphanumeric first. No credential lookup and no value/token/password properties. `none` is never permission.

Policy is null for an unapproved/incomplete draft; otherwise `DeclaredSourcePolicy` requires every field below:

- `authorization`: `{basisRef,reviewerRef,reviewedAt,validFrom,validUntil}`. Prefixes `evidence_` and `actor_`. `validFrom < validUntil`, `reviewedAt <= validUntil`; enable/evaluation require `reviewedAt <= time` and `validFrom <= time < validUntil`. References are not independently verified by the parser.
- `grants`: 1–256 contextual clauses `{territory,acquisitionMethod,audience,fields}`. Audience `internal|consumer|b2b`; tuple `(territory,method,audience)` unique. Fields are a nonempty subset of `source_listing_id|url|price|mileage|power|co2|vin|description|media|seller_pii`; every clause includes `source_listing_id`. All clauses fit configuration territories/methods. Consumer/B2B fields must be a subset of an internal clause for that **same** territory/method, and exclude both `vin` and `seller_pii`. No cross-clause union or Cartesian grant. Absence of an audience clause denies redistribution; consumer never implies B2B.
- `caching`: `{allowed,maxAgeSeconds}`; false means exactly 0, true requires a positive age no longer than normalized retention.
- `retention`: `{rawSeconds,normalizedSeconds,mediaSeconds,piiSeconds}`; 0 prohibits that storage. Enablement requires raw and normalized retention positive.
- `media`: `{mode:"none"|"reference"|"licensed_copy",attributionRequired:boolean}`. Using the union of **internal** clause fields: none excludes media and requires media retention 0; reference includes media with retention 0; licensed_copy includes media with positive retention.
- `pii`: `{mode:"none"|"professional_only"|"private_seller",purposeRef:null|string}`. None excludes seller_pii, retention 0 and purpose null. Others require that internal field, positive PII retention and a `purpose_` reference. V1 does not expose public dealer PII or VIN projections.
- `takedown`: `{contactRef,procedureRef,maxResponseSeconds}`; prefixes `contact_` and `procedure_`, positive bounded duration. References avoid personal contact values; execution of deletion/takedown is not implemented here.

No separate global permittedFields, territory/method grant arrays or redistribution flag exists: contextual clauses are the rights source. Configuration sets describe supported capabilities, not every Cartesian combination. Enablement requires at least one internal clause for each configured territory and each configured method. Legal compatibility: official_api only api; dealer_feed only feed; permitted_crawl only crawl; licensed_partner any explicitly granted method. Unknown/restricted/blocked never enable, regardless of health/policy.

`operations = {incremental,fullReconcileIntervalSeconds,deletionMode,deletionPropagationSeconds,freshnessSeconds,requestsPerMinute,concurrency,timeoutMs,maxRetries}`. Incremental boolean; deletion mode `explicit_tombstone|full_reconciliation|both`; second durations positive bounded; requests/minute 1–1000000; concurrency 1–1000; timeout 1–300000 ms; retries 0–20. Full reconciliation remains explicit even with incremental support. This is metadata, not transport/scheduling.

## Policy eligibility

Request `{territory,acquisitionMethod,fields,audience}` must match one complete clause including **all** requested fields. Empty fields fail validation. Evaluate current last revision, last event not in the future, enabled state, legal eligibility, complete compatible policy, authorization dates, exact contextual scope and internal-only fields.

`PolicyEligibility` is `{eligible:true,sourceId,revision,asOf,policy}` or `{eligible:false,sourceId,revision,asOf,reason}`. Reason precedence: `future_revision`, `takedown`, `disabled`, `legal_status`, `missing_policy`, `policy_not_current`, `internal_only_field`, `scope_not_granted`. Some reasons are defensive because invalid historical enablement fails parsing first. There is **no** `allowed` capability. The returned policy carries caching/retention/media/PII/takedown obligations, not permission to ignore them. Malformed input yields validation failure, not eligibility. Future consumers must reload authoritative current state and evaluate each acquisition/publication boundary, not cache this as a permanent permit.

## Operational health, separate from rights

`healthPolicy = {maxSampleAgeSeconds,maxSuccessAgeSeconds,maxErrorBps,maxParseErrorBps,maxStaleBps,maxLatencyP95Ms}`; positive ages and bounds as above.

`SourceHealthSample = {sourceId,windowStartAt,windowEndAt,lastSuccessAt,requestCount,itemCount,errorBps,parseErrorBps,staleBps,latencyP95Ms,circuit}`. Last success nullable; ratios/latency nullable. Window start < end <= now; last success <= window end; registry source must match; latest configuration event cannot be after now. Circuit `closed|open|half_open`. Zero requests require null error/latency; zero items require null parse/stale. Null measurements with nonzero counts remain unknown, never invented zero.

Output `{sourceId,revision,asOf,status,reasons}`. Deterministic precedence: open circuit → unhealthy; absent/stale success → unhealthy; stale sample or any missing metric → unknown; half-open or threshold strictly exceeded → degraded; otherwise healthy. Age exactly at maximum is not stale. Reasons use this fixed order: `circuit_open`, `no_success`, `stale_success`, `stale_sample`, `missing_measurements`, `circuit_half_open`, `error_rate`, `parse_error_rate`, `stale_ratio`, `latency`. Include each applicable reason once; healthy has none. Health does not mutate registry, alter policy or grant acquisition; a healthy blocked source remains ineligible.

## Verification, observability and compatibility

Tests: all legal statuses/methods; every policy precondition; contextual cross-combination denial; VIN/PII internal; timestamps and numeric/null edges; hostile object/array/secret sanitization; immutable history/latest-only replay; deterministic health; public built-export/type and JSON round-trip consumer; whole synthetic create/enable/evaluate/replace/re-enable/expire/takedown trace. Retain all TASK-0002 regressions. Run targeted and root lint/typecheck/tests/build/secrets/audit; nine-member nonzero Turbo DAG; fresh HTTPS clone/frozen install/direct tests without prebuilt artifacts. Independent code/security and architecture reviews, implementation CI, evidence/DONE, final-head CI, merge and main verification are required in that order.

Validation and decision/health codes are future telemetry hooks. No backend exists to instrument, no source is approved, no deployment or UI/accessibility/performance claim is made. TASK-0004 must emit runtime observability and consume obligations; real monitoring/takedown/legal approval remain independently gated downstream.

Only schemaVersion 1 is supported. This additive package and public SourceId parser do not change existing vehicle data shapes. Before consumers ship, rollback is a code revert. After coupling, coordinate versioned readers/writers; never delete or rewrite historical policy/audit evidence as a rollback shortcut. New fields, territory expansion, external VIN projection or policy semantics require an explicit compatibility decision.
