# Vehicle schema

Dependency-free V1 internal contracts for vehicle candidates, source publications and immutable observations. The package deliberately keeps `VehicleEntity`, `Listing` and `Observation` separate and preserves provenance instead of resolving contradictory evidence.

## Public API

- `parseVehicleEntity`, `parseListing` and `parseObservation` validate one already-parsed value.
- `parseObservationCollection` collapses exact replays and rejects reuse of an observation ID with changed content.
- `appendObservations` returns a fresh collection with the same replay semantics and never mutates existing history.
- Branded ID, domain and validation-result types are exported from the package root.
- `parseSourceId` validates the canonical source namespace for other contracts without constructing a vehicle record; the returned ID is not proof of registration or permission.

Every parser returns a discriminated `ValidationResult`. Failures expose only stable issue codes and schema-owned paths; they never echo source text, VINs or hostile object details. Successful data is reconstructed without caller references and recursively frozen.

Run `pnpm --filter @auto-world/vehicle-schema test` from the repository root for targeted runtime verification. The package test command rebuilds the current sources before importing the public built export, so stale `dist` files cannot supply a false passing result. Root Turbo also retains its build-before-test dependency.

```ts
import { parseListing } from "@auto-world/vehicle-schema";

const result = parseListing(candidate);
if (!result.success) {
  // Record result.issues by code/path; do not log the untrusted candidate.
}
```

## Boundary guarantees

- Readers and writers support exactly `schemaVersion: 1`.
- Runtime IDs use distinct `veh_`, `lst_`, `obs_`, `src_`, `run_` and `raw_` namespaces.
- Publication identity is `sourceId + sourceListingId`; URL is optional metadata.
- Full VIN evidence is internal-only, carries an access-policy reference and requires permitted provenance.
- Parsing does not fetch URLs, activate sources, verify licences, resolve identities, convert units/currencies or validate raw snapshot bytes.

The authoritative compatibility, privacy and rollback decisions are in `docs/decisions/ADR-0001-canonical-vehicle-contract.md`. TASK-0003 models source-policy eligibility, not actual activation; authenticated current registry access and verified rights remain production prerequisites. Raw decoding and digest verification belong to TASK-0004; public VIN projection and identity resolution require later explicit contracts.
