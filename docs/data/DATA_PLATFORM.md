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
