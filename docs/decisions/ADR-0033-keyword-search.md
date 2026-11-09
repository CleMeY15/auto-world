# ADR-0033 — Catalog keywords, not a second search engine

Status: Accepted design, 2026-11-09; sequential independent Architect and Critic approval. Implementation and validation TASK-0120, prototype-only under ADR-0028.

## Decision and alternatives

Resolve user words against current validated synthetic taxonomy PRIMARY make/model labels to a bounded set of globally unique model IDs. Reuse the existing OpenSearch keyword field through `terms` inside `bool.filter`; requested zero candidates means `match_none`, omitted restriction means no clause. The in-memory engine uses the same shared resolver before count/sort/page. At most16384 catalog models, deduplicated and ordinal-sorted, below OpenSearch's default65536 term limit. No new projection/mapping, source, dependency or database migration.

Drivers: useful visible search, existing authoritative data and backwards compatibility. A new analyzed text index is more general but unjustified without prose or real catalog scope, and adds migration/analyzer parity work. Browser-only filtering is rejected because counts and continuation would be incorrect. Exact catalog matching is not identity resolution, a verified specification, or AI interpretation.

## Query, wire and continuation

V1/V2 remain closed. New strict DemoSearchQueryV3 has existing V2 fields plus optional text and schemaVersion3. POST `/v3/demo/search` responds with outer schemaVersion3 and an explicitly unchanged DemoSearchResponseV2 data body; errors also use outer3. Dedicated HTTP parsers distinguish these versions. Catalog/detail remain V2. The web uses V2 for blank text, V3 for valid nonempty words.

Raw text: at most120 Unicode code points/480 UTF8 bytes, early code-unit bound; reject controls, format characters and lone surrogates. NFKD, strip combining marks, lowercase, replace non-letter/non-number runs by spaces, deduplicate and ordinal-sort tokens. Require1–8 tokens, each1–32 code points, and apply the same length/byte bounds to the final canonical text for idempotent reparse. Provided empty, punctuation-only or oversized text is invalid, never a broad search. The UI omits whitespace-only input. All whole words must occur across the primary make/model labels. No alias, stemming, fuzzy/operator syntax, wildcard or numeric inference. Current description absent means no keyword match even if history exists. Duplicate labels may resolve multiple models.

V3 factories own cursor maps/memo/epoch and separate `aw-search-cursor-v3\0` / `aw-demo-cursor-v3\0` domains. Bind canonical text/schema plus all existing query/generation/catalog/fingerprint fields. Different canonical text must invalidate a cursor even if it resolves identical IDs; equivalent normalized text may replay. Do not delegate continuation to V2. Preserve freshness, high-watermark, capacity and cancellation.

## Persistence, UI and privacy

Saved envelope2 can contain discriminated V2 and V3 criteria. Envelope1 accepts only V2; reading never writes. Successful mutation writes envelope2 retaining old entries asV2. V2 and V3-without-text are semantically identical for dedup; normalized text equivalents also dedup. Existing make/model IDs retain exact fixture/release binding. Text-only saves literal canonical words without resolved IDs, re-resolved against current catalog only after explicit submission. Explicit catalog-mismatch removal of identity filters retains text/numeric criteria.

Linkv1 contains only V2; linkv2 only V3. Keep received-link review and explicit load/submit. Disclose readable criteria, not frozen results. Retain storage keys/mode isolation,10-entry/16KiB bounds and future/corrupt/quota/undo behavior. No query text in logs/analytics. No component framework or restyle; existing premium UI and all state/accessibility/performance requirements remain.

## Consequences, rollback and evidence

The explicit V3 compatibility surface is a cost, contained by reusing V2 results and the existing index. Rollback removes new code, not user bytes: older code treats envelope2 as future/read-only. No SQL/index rollback. Full-text prose, aliases, advanced filters and AI require separately ready tasks.

Official references checked2026-11-09: [terms](https://docs.opensearch.org/latest/query-dsl/term/terms/), [boolean filter](https://docs.opensearch.org/latest/query-dsl/compound/bool/), [match_none](https://docs.opensearch.org/latest/query-dsl/match-all/). Maintained docs do not replace real pinned3.8.0 integration. TASK-0120 requires strict contracts, both engine parity, saved/link compatibility, real services/browser journeys, actual-pixel review and exact-source delivery before acceptance.
