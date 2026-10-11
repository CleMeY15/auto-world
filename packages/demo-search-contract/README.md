# Demo search contract

Public, dependency-light V1 DTOs and strict parsers for Auto World's offline synthetic search slice. The package declares query, result, response and read-port shapes; it does not implement search, cursor storage, ingestion or HTTP behavior.

## Boundary

- `dataMode` is always `synthetic`; parsed data is fixture evidence, not verified automotive truth or source authorization.
- Only sanitized listing-scoped price and mileage evidence is public. Raw/source/run/snapshot identifiers, hashes, VIN, seller data, URLs and inferred vehicle fields are rejected as unknown keys.
- Parsers accept only exact V1 objects and dense ordinary arrays, return the shared `ValidationResult`, detach all input references and recursively freeze successful data.
- Freshness is evaluated against the explicit `asOf` argument. The package never reads the clock, network, SDK store or fixture files.
- `DemoReadPort` is a declaration for TASK-0102. This package performs no read-port behavior or query execution.

Breaking shape, vocabulary, limit or semantic changes require a V2 contract and an explicit consumer migration under ADR-0013.
