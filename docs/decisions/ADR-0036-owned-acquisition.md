# ADR-0036 — Owned acquisition foundation

Status: accepted for the bounded TASK-0135 implementation after independent architecture and code review on 22 November 2026. Delivery, live-source access and production qualification remain separate; see the validation record.

## Product direction

AutoFindex owns acquisition, normalized observations, its vehicle/archive index and its API. Third-party aggregator SaaS APIs are not the acquisition strategy. Open-source implementation dependencies can run under our control. The desired long-term coverage is worldwide; measured source coverage and freshness must remain explicit.

Reuse `connectors/_sdk`, PostgreSQL, OpenSearch and the existing Fastify API. A source collector, discovery frontier, identity resolver and market comparison have different responsibilities. Do not turn the browser-facing API into an arbitrary-URL fetch service.

## First complete increment

Add `@auto-world/http-acquisition` under `connectors/http-acquisition`. It receives a bounded, ordered manifest of stable source listing IDs and source URLs. It executes through the existing SDK with caller-supplied authenticated registry, lease and store ports. No second persistence implementation, production deployment or source credential is introduced.

The public run wrapper owns the adapter and authority guard together. The wrapper requires `crawl`, a matching source, credential-free configuration, and `explicit_tombstone` deletion mode on every current-authority read. It rejects a policy change; it never rewrites or approves the registry. A seed list is not a full site inventory. Missing seeds, a 404, unsupported markup or a failed HTTP request cannot mark other listings withdrawn. A later discovery/reconciliation contract must prove complete source scope before absence inference.

The SDK's existing `InventoryHead.lastCompletedFullAt` can advance when this bounded `full` batch completes. Consumers must not interpret it as exhaustive source coverage. The future discovery contract must carry explicit coverage evidence and settle coexistence with other collectors in the same source scope before production composition. This package's return value always identifies seed-only coverage.

## Capture and resume

The SDK V1 decoder stays JSON-only. Each acquired page is a versioned JSON capture envelope containing the exact original HTTP body in base64, its separate SHA-256, content type/status, seed ordinal and manifest identity. The SDK's raw SHA identifies the envelope; the body SHA identifies the original body. These identities are never conflated.

Original body limit: at most 512 KiB, further bounded by the SDK raw-page budget. HTML is not parsed in `fetchPage`; mapping occurs only after raw staging. A canonical manifest hash is part of `adapterVersion`, so URL/order/budget/transport changes conflict with a reused invocation key. Map validates the envelope against the frozen manifest and exact body hash before parsing. Cursors contain only a bounded ordinal, not a serialized growing URL frontier.

## Transport

Production-capable transport uses HTTPS, one exact configured origin, an identifying AutoFindex user agent, ordinary certificate validation and pinned public DNS resolution. Credentials, fragments, IP-literal destinations, nonstandard ports, private/special-use addresses and automatic redirects are rejected. Response bytes, headers, time and cancellation are bounded. No cookies, authenticated session, CAPTCHA handling, proxy rotation, browser stealth or remote context fetching is supplied.

Tests may inject a transport restricted to a single owned loopback HTTP fixture. That test composition is outside ordinary exports and is not a production network exception. Source authorization and source-specific crawl/robots/access review remain prerequisites for live configuration. A configuration object or robots Allow line is not proof of usage rights.

## Extraction

Use pinned MIT-licensed `parse5` for inert HTML parsing. Inspect bounded `application/ld+json` scripts using the existing strict JSON decoder. Support a documented compact Schema.org profile with Car/Vehicle, arrays and `@graph`; never fetch or expand remote contexts. Require exactly one unambiguous vehicle candidate for a seed detail page. Source listing identity comes from the verified source manifest, not a guessed VIN, model SKU or whole URL.

Map only explicitly requested/granted SDK fields. Prices use exact decimal conversion with currency units; kilometre/mile units stay explicit. Missing and ambiguous fields are not invented. A VIN observation does not resolve a vehicle identity. Model date is not first-registration date. Richer descriptive fields remain in raw evidence until the future real-listing contract is implemented.

The 512 KiB input bound applies before parsing; HTML node/depth bounds apply during traversal after parse5 constructs the tree. They do not preempt parser CPU. Hostile-case performance and worker isolation are separate pre-scale qualification work. The manifest is trusted operator configuration, not an arbitrary public object/API input.

## Expansion sequence

1. This bounded capture/extraction/SDK integration.
2. First source-specific discovery and authentic parser fixtures; leboncoin is the requested target, currently not access-approved or parser-validated.
3. Durable partitioned discovery queue and scheduled incremental collection, using source-wide quotas and measured completeness.
4. Real-listing contracts, generalized PostgreSQL/OpenSearch composition and our API/search/history endpoints.
5. Cross-listing vehicle identity with confidence and VIN when available, cross-country comparable pricing, archives and measured global rollout.

Each source gets its own adapter/version, acquisition status, parser health, freshness, coverage and withdrawal semantics. Unavailable sources remain visible as unavailable; global completeness is never inferred from a successful worker run.

## Boundaries and validation

This work changes no synthetic product path, registry permission, prototype production guard, service image or TASK-0005 result. Test on an owned origin, using fabricated vehicles. Review SSRF, cancellation, response caps, raw-before-map, seed completeness, recovery identity, untrusted HTML/JSON and telemetry redaction. Existing source activation requirements remain distinct from code readiness.

References checked 22 November 2026: [parse5](https://github.com/inikulin/parse5), [JSON-LD HTML embedding](https://www.w3.org/TR/json-ld11/#embedding-json-ld-in-html-documents), [Schema.org Car](https://schema.org/Car), [leboncoin robots](https://www.leboncoin.fr/robots.txt). The latter currently states automated access needs special permission; no permission or source-specific markup was established in this task.
