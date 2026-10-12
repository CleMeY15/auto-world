# ADR-0017 — Synthetic vehicle taxonomy V1

Status: Accepted and implemented; TASK-0008 implementation validated, final-head/main delivery pending in PR161
Date: 2026-10-12

## Context and decision

P0 names a versioned taxonomy; ADR-0001 deliberately deferred it outside canonical vehicle observations. Add one private ESM package, `@auto-world/vehicle-taxonomy`, for synthetic make/model releases. It depends only on public vehicle-schema validation types. No external dependency, network, service, database, image or canonical-schema modification.

Drivers: stable typed filter identities, per-label attribution and strict bounded validation with isolated evolution. Coupling taxonomy into vehicle-schema would conflate reference data with observations; a generic graph/store/query platform adds unnecessary scope. The standalone closed contract is the smallest useful foundation for later filters.

## Closed V1 contract

All properties and arrays are readonly. Five nominally distinct string IDs use prefixes `taxcat_`, `taxrel_`, `taxattr_`, `make_`, `model_`; the suffix is 1..64 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9_-]*`.

- `TaxonomyReleaseV1`: exactly `{schemaVersion:1,catalogId,releaseId,revision,releasedAt,dataMode:"synthetic",attributions,makes,models}`.
- `revision`: positive safe integer. `releasedAt`: exact UTC milliseconds, years 0001..9999, valid calendar date, no ambient clock.
- `TaxonomyReleaseReferenceV1`: exactly `{catalogId,releaseId,revision}`.
- `TaxonomyEntryReferenceV1`: `{kind:"make",release,makeId}` or `{kind:"model",release,modelId}`.
- `TaxonomyAttributionV1`: `{attributionId,kind:"synthetic_fixture",fixtureRef}`. Fixture reference: trimmed ASCII token of 1..128 characters in alphanumeric/dot/underscore/slash/hyphen. It is neither a URL to follow nor a licence or credential.
- `TaxonomyNameV1`: `{value,attributionId}`. Value: trimmed NFC text, 1..80 UTF-16 code units, no controls, line separators or bidi controls.
- `TaxonomyMakeV1`: `{makeId,primaryName,aliases}`.
- `TaxonomyModelV1`: `{modelId,makeId,primaryName,aliases}`.

Primary names are release-local display labels, not globally canonical automotive facts. Aliases have no locale/territory/synonym ranking semantics. Every name attribution must exist in the release. Aliases: dense ordinary arrays, maximum 32, strictly ordinal ascending by value; values unique even across different attributions and cannot equal the primary value. Names may repeat across entities; no ambiguity is silently resolved.

Attributions/makes/models are dense ordinary arrays, maximum 2048/1024/16384 respectively, unique by domain ID and strictly ordinal ascending. Empty collections are valid. Every model parent must exist.

## Runtime boundary and outcomes

Public parsers: `parseTaxonomyCatalogId`, `parseTaxonomyReleaseId`, `parseTaxonomyAttributionId`, `parseMakeId`, `parseModelId`, `parseTaxonomyReleaseReference`, `parseTaxonomyEntryReference`, `parseTaxonomyRelease`.

They accept unknown already-decoded data and return public vehicle-schema `ValidationResult<T>`. Reject unknown/missing fields, accessors without invoking them, custom prototypes, hidden/symbol keys, sparse/augmented arrays and reflection errors. Plain and null-prototype records are allowed. Output is rebuilt from validated primitives, detached and deeply frozen. Errors contain only fixed codes and schema-owned paths, never input values/keys or exception text. Use `duplicate_id` for duplicate domain IDs and `invalid_value` for ordering/dangling-reference/domain failures.

Typed utilities `findTaxonomyMake`, `findTaxonomyModel`, `resolveTaxonomyEntryReference` assume successful parser outputs; they do not authenticate arbitrary JavaScript values, brands, object provenance or frozen state. No token, WeakSet or freeze check implies trust.

- `TaxonomyMakeLookupResult`: `{status:"found",data:TaxonomyMakeV1}` or `{status:"not_found"}`.
- `TaxonomyModelLookupResult`: corresponding model result.
- `TaxonomyEntryResolutionResult`: `{status:"found",kind:"make",data:TaxonomyMakeV1}`, corresponding model outcome, `{status:"not_found"}` or `{status:"release_mismatch"}`.
- All wrappers are newly frozen; found records reuse the parsed release's frozen record.
- Lookup uses exact ID equality. Reference resolution first compares the declared catalog/release/revision tuple. A mismatch never resolves; matching tuples resolve the supplied snapshot.

A matching tuple does NOT authenticate content, prove historical uniqueness, monotonic revisions or cross-call immutability. Independently valid altered content with the same tuple can parse and resolve. This limitation is explicitly tested.

## Consequences, provenance and exclusions

The test-only golden corpus contains four fictitious makes, eight fictitious models, four synthetic attributions, aliases and a repeated model label across makes. No fixture runtime export, real dataset, production rights or vehicle match is implied. Listing and vehicle observations remain unchanged.

No generation, variant, engine, options, manufacturer codes, VIN/specification inference, free-text/locale/fuzzy matching, persistence, authenticated lineage, API, UI or LLM behavior is added. Future real datasets require separately reviewed acquisition rights and provenance; future resolution/persistence/richer taxonomy each requires its own DoR and compatibility decision.

## Validation and rollback

Runtime/compile-time/hostile-input tests, real Turbo gates, root checks and independent code/security/provenance plus architecture review are required. See [task](../../roadmap/tasks/TASK-0008-vehicle-taxonomy-v1.md) and [evidence](../validation/TASK-0008.md).

Before consumers exist, a reviewed revert removes the package/workspace/lockfile changes; there is no data migration or external state. After consumers couple, use a versioned migration rather than reinterpreting an existing contract.
