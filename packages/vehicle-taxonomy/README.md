# Vehicle taxonomy

Private, synthetic-only V1 contract for immutable make/model releases and exact ID lookup.

The package validates closed, bounded, version-scoped data with attribution for every display name. It does not contain real automotive facts, authorize a source, resolve free text, authenticate release content, persist history, or modify canonical vehicle observations.

Consumers import only `@auto-world/vehicle-taxonomy`. The fixture under `test/` is deliberately fictitious and is not a runtime export.

Golden-corpus labels use the explicit `AW Fixture ` prefix, enforced by a regression test; they are not names to match against real listings. Parse unknown inputs first. The typed lookup helpers assume successful parser outputs and do not authenticate arbitrary JavaScript values or release content.
