# Vehicle schema

Dependency-free V1 internal contracts for vehicle candidates, source publications and immutable observations. The package deliberately keeps `VehicleEntity`, `Listing` and `Observation` separate and preserves provenance instead of resolving contradictory evidence.

## Public API

- `parseVehicleEntity`, `parseListing` and `parseObservation` validate one already-parsed value.
- `parseObservationCollection` collapses exact replays and rejects reuse of an observation ID with changed content.
- `appendObservations` returns a fresh collection with the same replay semantics and never mutates existing history.
- Branded ID, domain and validation-result types are exported from the package root.

Every parser returns a discriminated `ValidationResult`. Failures expose only stable issue codes and schema-owned paths; they never echo source text, VINs or hostile object details. Successful data is reconstructed without caller references and recursively frozen.

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

The authoritative compatibility, privacy and rollback decisions are in `docs/decisions/ADR-0001-canonical-vehicle-contract.md`. Source activation belongs to TASK-0003; raw decoding and digest verification belong to TASK-0004; public VIN projection and identity resolution require later explicit contracts.
