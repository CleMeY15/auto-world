# ADR-0022 — Explicit local publication pointers

Status: accepted for TASK-0112 implementation after Architect CLEAR then Critic APPROVE, 2026-10-18. Delivery remains separately gated.

## Decision and alternatives
Expose explicit create/copy UI for the existing `#detail/<encodeURIComponent(validated ListingId)>` route. Reuse existing expected-ID detail validation and reviewed search-link clipboard interaction. A fixture-bound versioned route would add a decoder without freezing data; a hosted shortlink needs persistence/API/security policy outside this independently ready synthetic increment. Neither is justified here.

Generate a new fixed same-origin HTTP(S) `/demo` URL, reject userinfo/invalid origins and IDs, drop inherited path/query/hash. Payload contains only one public publication ID. No price, history, fixture, taxonomy, search criteria or source identifiers. Incoming route behavior is unchanged: GET detail/catalogue, strict V2 expected-ID match, no implicit search, clipboard or storage write.

## Meaning and interaction
The pointer addresses the current runtime's synthetic publication, not a frozen snapshot or verified vehicle. No cross-fixture persistence/identity guarantee. Current response can differ or be unavailable later; successful missing DTO remains distinct from HTTP404. Current deployment is local to its computer while the demo runs, not a hosted sharing service. Fragments are readable by holders/history/scripts/extensions, not secrets.

Require ready response ID equal to route ID before rendering the entire detail body and creator. Retain availability/partial/stale/offline qualifiers. Use an inline labelled selectable field after snapshot summary, before evidence, with explicit clipboard write and manual fallback. Promise resolution alone announces success. Close/unmount/target replacement invalidate old UI completion, not OS side effects already requested. No clipboard reading, permission preflight, execCommand or generic sharing framework.

Reuse a closed search/publication target and preserve existing search IDs/text/tests. Add only closed no-op listing_link_created/listing_link_copied analytics; never payload/URL/ID/raw errors. No new package/backend/storage/schema/source right. Existing [browser protocol rationale](ADR-0021-synthetic-search-links.md#official-browser-evidence) and Vehicle Intelligence provenance boundaries stay unchanged.

## Verification and rollback
Task0112 owns boundary/unit/route/race/clipboard/privacy/browser/accessibility/visual/performance tests, full Windows/Linux gates and independent reviews. Previous main quality14m38s supports increasing job wall-clock timeout15→20 minutes, not relaxing steps/retries/performance budgets. Disable demo or revert; no migration. Infrastructure admission and hosted/fixture-bound sharing remain separate tasks.
