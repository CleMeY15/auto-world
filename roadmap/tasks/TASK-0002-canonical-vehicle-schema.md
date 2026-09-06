# TASK-0002 — Canonical vehicle schema

Status: IN_PROGRESS
Priority: P0
Owner role: Domain/schema executor, with independent contract and security review

## Goal
Create the versioned internal V1 contract that keeps `VehicleEntity`, `Listing`, `Observation`, provenance and identity evidence distinct and safe for later services.

## Dependencies
- TASK-0001 merged on `main`.

## Relevant contracts
- `docs/architecture/ARCHITECTURE.md`
- `docs/VEHICLE_INTELLIGENCE.md`
- `docs/STRATEGIC_MOATS.md`
- `docs/DEFINITION_OF_DONE.md`

## Scope
- Write `ADR-0001-canonical-vehicle-contract.md` before code; record all V1 lexical, value, compatibility and rollback choices.
- Replace only `packages/vehicle-schema` placeholder behavior; add no dependency.
- Export readonly TypeScript contracts plus strict parsers from already-parsed `unknown` objects.
- Give each Listing a stable `sourceId` plus `sourceListingId`; a URL is optional metadata, never publication identity.
- Give every Observation an explicit subject discriminator (`vehicle` or `listing`) and the corresponding namespaced ID.
- Fix runtime ID namespaces as `veh_`, `lst_`, `obs_`, `src_`, `run_` and `raw_` for vehicle, listing, observation, source, connector-run and raw-snapshot IDs.
- Make observation `field` a closed discriminant: mileage uses `km|mi`, power uses `kw|metric_hp`, and CO2 uses `g_per_km` plus `wltp|nedc`.
- Permit money only as safe integer minor units with currency in `EUR|USD|GBP|CHF|JPY|KRW`; there is no unknown currency value.
- Use confidence basis points as integers from 0 through 10000.
- Put `observedAt` once, in provenance; require acquisition method, legal status and source ID there.
- Require every observation to reference immutable `snapshotId`, `connectorRunId` and lowercase SHA-256 digest evidence.
- Accept listing identity as `unresolved` or `candidate`; V1 never claims automatic resolution or merge.
- Keep full structurally valid VIN evidence internal and require explicit access-policy provenance; withheld/unavailable states contain no VIN value.
- Clone only validated plain data into fresh objects/arrays, retain no caller references or accessors, expose deep-readonly types and deep-freeze parser output.
- Treat identical observation ID plus identical content as an idempotent replay; reject ID reuse with changed content and retain contradictions.

## Out of scope
- Taxonomy, persistence, automatic identity resolution/dedup, source activation, public VIN projection, raw JSON decoding, lifecycle/user corrections, prior-version migration and downstream services.

## Acceptance criteria
- `schemaVersion` is exactly `1`; all other versions, unknown keys, dangerous prototypes/accessors, coercion, invalid IDs/times/VINs/digests/units/currencies and unsafe numbers fail with stable code/path issues that contain no input values.
- Valid synthetic records round-trip and preserve distinct entity/listing identity, each observation, provenance and raw reference.
- Missing source publication identity, URL-only identity and subject discriminator/ID mismatches are rejected by runtime and compile-time tests.
- Mutating caller input after parsing cannot affect output; nested output mutation fails.
- Conflicting observations remain addressable without a resolution claim.
- Workspace contract marks only `@auto-world/vehicle-schema` active; seven untouched boundaries remain placeholders.

## Test strategy and DoD gates
- Implement compile-time ID/domain checks, table-driven parser tests, synthetic golden/adversarial fixtures, append/replay conflicts and public-build round-trip tests.
- Record explicit deferrals for production-enable transitions (TASK-0003), raw JSON safety (TASK-0004), public VIN projection (first exposing API), lifecycle corrections and the first real legacy migration.
- Run targeted lint/typecheck/test/build, then root `pnpm check`, secrets scan, dependency audit and a clean-checkout run.
- Record security/privacy, compatibility/rollback, CI URL and independent review in `docs/validation/TASK-0002.md`.
- After implementation CI and review are green, set `DONE` on the same branch, rerun CI, then merge.
