# DATA PLATFORM & SOURCE EXPANSION

## Source onboarding checklist
- Strategic value: inventory, geography, uniqueness.
- Access path & rights.
- Field coverage.
- Freshness/deletion model.
- Seller/media rights.
- Rate limits/SLA.
- Incremental sync feasibility.
- Unit economics/maintenance score.
- Fixtures and contract tests.
- Monitoring dashboard.
- Takedown path.

## Source priority score
0.25 inventory + 0.20 uniqueness + 0.15 target-country demand + 0.15 data quality + 0.10 access stability + 0.10 freshness + 0.05 integration cost inverse. Legal status is a hard gate, not a score.

## Data quality metrics
completeness_by_field; parse_error_rate; stale_ratio; invalid_price_rate; taxonomy_unknown_rate; duplicate_rate; photo_failure_rate; seller_match_rate.

## Replayability
Raw payload/object snapshots must allow parser vN+1 to replay history without source access. Keep retention/source-specific legal constraints configurable.

## Reconciliation
Incremental sync continuously + periodic full reconciliation to detect missing/deleted listings.

## Source Registry V1 contract

[ADR-0002](../decisions/ADR-0002-source-registry-contract.md) defines the machine-readable source configuration, scoped rights, retention/media/PII/takedown obligations, full policy/audit revision history and explicit health windows. Rights clauses bind one territory, acquisition method and audience to fields; unrelated clauses must never be combined into a broader grant. Replacing configuration disables eligibility pending a new enable event. Expiry is checked at evaluation time without erasing valid historical approvals.

`evaluatePolicyEligibility` describes consistency with declared policy only. Operational callers must read authenticated current registry state, verify legal evidence, enforce all obligations and re-evaluate at acquisition/publication boundaries. Health cannot authorize a source. No source, licence, retention worker, dashboard or network connector is introduced by the contract package.

## Connector ingestion V1

[ADR-0003](../decisions/ADR-0003-connector-sdk-contract.md) and its [API appendix](../decisions/ADR-0003-connector-sdk-api.md) define raw-first acquisition, snapshot-bound observations, stable publication identity and append-only listing-version evidence. Mutable listing projections and active inventory are scoped by source, territory and acquisition method; historical evidence is separate. Full absence is inferred only after complete atomic finalization and only in allowed deletion modes. Incremental runs require a completed, non-stale full baseline; exact completed replay remains stable after subsequent inventory changes.

Raw, normalized, PII/media and cache lifetimes are distinct obligations, capped by authorization validity. The generic SDK computes deadlines and refuses expired raw replay; production storage must enforce deletion/expiry and downstream takedown. Synthetic test fixtures prove the SDK's contract interactions, not licensed access or production durability.

## TASK-0101 fixture evidence

The isolated `synthetic-search-v1` corpus pins exact bytes and one source/territory/method scope. SDK raw staging, immutable observations and mutable publication projections remain distinct; contradictory values and withdrawn history are retained without resolving a VehicleEntity. A structural enabled test registry is never a source-rights approval.

The public [demo V1 contract](../decisions/ADR-0013-demo-search-contract.md) excludes source/run/snapshot identities, raw hashes, VIN, seller/media and unsupported specifications. Complete/partial/stale envelopes explicitly distinguish completeness and committed-watermark freshness; an unavailable read cannot become an empty complete response. TASK-0101 validates those vectors only. TASK-0102 must prove actual watermark/scope, evidence association, active matching, deterministic ordering and opaque cursor binding against committed snapshots before exposing API reads.
