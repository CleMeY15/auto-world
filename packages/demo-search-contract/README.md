# Demo search contract

Public, dependency-light V1 and additive V2 DTOs and strict parsers for Auto World's offline synthetic search slice. The package declares query, result, response, catalog and read-port shapes; it does not implement search, cursor storage, ingestion or HTTP behavior.

## Boundary

- `dataMode` is always `synthetic`; parsed data is fixture evidence, not verified automotive truth or source authorization.
- V1 exposes only sanitized listing-scoped price and mileage evidence. V2 adds authored synthetic make/model/first-registration-year declarations and their evidence history; these declarations are not canonical observations, resolved vehicle identities or verified automotive facts.
- V2 catalog labels come only from a separately validated synthetic taxonomy release. Search responses carry the exact release tuple, while the read-port remains responsible for catalog membership and model-parent checks.
- Raw/source/run/snapshot identifiers, hashes, VIN, seller data, URLs and inferred vehicle fields are rejected as unknown keys.
- Parsers accept only exact versioned objects and dense ordinary arrays, return the shared `ValidationResult`, detach all input references and recursively freeze successful data.
- Freshness is evaluated against the explicit `asOf` argument. The package never reads the clock, network, SDK store or fixture files.
- `DemoReadPort` remains the unchanged V1 declaration. `DemoReadPortV2` is additive and includes catalog, search and detail reads. This package performs no read-port behavior or query execution.

Breaking shape, vocabulary, limit or semantic changes require a V2 contract and an explicit consumer migration under ADR-0013.
