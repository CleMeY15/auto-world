# AutoFindex owned HTTP acquisition

`@auto-world/http-acquisition` is the first reusable HTTP/HTML collector for our own acquisition engine. It uses owned code, the existing Connector SDK and the open-source MIT-licensed `parse5` parser. It does not call a commercial listing aggregator.

**Scope:** a caller supplies a reviewed manifest of 1–100 listing detail URLs from one HTTPS origin. The module captures each page, preserves its exact original body, extracts a strict automotive JSON-LD profile and commits observations through the SDK. Tests execute HTTP against an owned local server with fictitious content. No live marketplace is configured or access-approved by this package.

## Use with existing service ports

```ts
import { runSeededHttpConnector } from "@auto-world/http-acquisition";
import type { AcquisitionPorts, HttpSeedManifestV1 } from "@auto-world/http-acquisition";

// Supplied by the source-specific worker: an authenticated current registry,
// source-wide lease/quota store, raw/history persistence, clock and telemetry.
// A caller cannot replace these with an unverified configuration in production.
export async function collectManifest(manifest: HttpSeedManifestV1, ports: AcquisitionPorts,
  invocationKey: string, signal: AbortSignal) {
  return runSeededHttpConnector({
    schemaVersion: 1,
    audience: "internal",
    fields: ["source_listing_id", "url", "price", "mileage"],
    mode: "full",
    invocationKey,
    limits: {
      maxPages: 100, maxItems: 100,
      maxRunMs: 300_000, maxEffectMs: 10_000,
      maxPageBytes: 1_048_576, maxJsonDepth: 8, maxJsonMembers: 128,
    },
  }, manifest, ports, signal);
}
```

Manifest shape:

```ts
interface HttpSeedManifestV1 {
  schemaVersion: 1;
  sourceId: SourceId;
  territory: Territory;
  origin: string;       // Exact https://host origin; default port only.
  maxBodyBytes: number; // 1..524288, before base64 capture encoding.
  entries: readonly {
    sourceListingId: string; // Stable publisher ID supplied by the source adapter.
    url: string;             // Canonical absolute detail URL at this origin.
  }[];
}
```

The source adapter/operator is responsible for the reviewed mapping between a source ID, its origin and stable publisher IDs. A manifest is configuration, not proof of source permission. The current registry must independently permit the requested source, territory, fields and `crawl` operation. This first credential-free transport rejects other credential modes.

`full` means complete processing of **this manifest** in the SDK run. It does not mean complete coverage of a website. The wrapper always returns `coverage: "seed_manifest_only"`; `requestedPages` is the manifest size, and `result.pages/items` are the SDK's actual completed counts. Require `explicit_tombstone` at every authority read, including finalization. A smaller seed batch or a failed URL cannot infer that a different listing disappeared. This package does not emit withdrawal tombstones. The existing SDK can update `InventoryHead.lastCompletedFullAt` for this run; that timestamp is a batch completion, never proof of an exhaustive source inventory. A future shared discovery/scheduling contract must carry separate coverage evidence before mixing collectors in one source scope.

## Capture, precision and history

1. The SDK verifies current source authority, acquires its source lease and reserves each attempt against the shared quota/circuit state.
2. The private adapter makes one bounded HTTPS request per reservation. It creates a JSON capture envelope without parsing HTML.
3. The SDK stages that envelope as raw evidence. `bodyBase64` preserves the original HTML bytes. `bodySha256` identifies that body; the SDK raw hash identifies the whole envelope.
4. Mapping verifies the manifest binding, original byte count and hash, then parses the inert HTML and JSON-LD.
5. Existing SDK commits attach every normalized observation to its raw provenance. Existing checkpoint/replay/history behavior stays authoritative.

The ordered manifest hash is part of the adapter version. Reusing an invocation key with a changed URL, order, ID or capture budget conflicts instead of silently resuming a different job. A completed replay performs no new capture; a new invocation records a listing version and observations for the requested values that are present. A run interrupted after raw staging can resume the original bytes without fetching the page again.

The effective HTML limit is the smaller of the manifest's cap and the space remaining in the SDK page budget after metadata/base64 overhead. Error and telemetry values contain fixed codes/counts, not HTML, URLs or VINs. Raw storage itself contains source evidence and follows the registry's retention/access obligations; it must remain private.

## Supported extraction profile

| Input | Behavior |
| --- | --- |
| HTML | UTF-8, at most 512 KiB; inert parse5; no scripts, images or remote contexts executed/fetched |
| JSON-LD | At most 32 inline `application/ld+json` scripts; strict duplicate/member/depth checks; compact Schema.org context |
| Vehicle | Exactly one root/array/`@graph` Car or Vehicle; multiple candidates fail rather than selecting arbitrarily |
| Price | One inline Offer; exact nonnegative decimal to minor units; EUR/USD/GBP/CHF have two minor digits, JPY/KRW zero |
| Mileage | Explicit `KMT` or `SMI`, nonnegative safe integer; no silent mile/kilometre conversion |
| VIN | Only when requested and granted; 17-character syntax check; no authenticity, ownership or identity-resolution claim |
| Missing field | Omitted, never defaulted to a guessed value |
| Unsupported field | Runner rejects unsupported requested fields; currently only source ID, URL, price, mileage and VIN |
| Ambiguous vehicle or invalid/ambiguous requested value | Mapping fails and raw evidence remains available for diagnosis; unrequested values are not interpreted |

Currency conversions, formatted/localized prices, exponent-form numbers, aggregate offers, context aliases/remote expansion, seller data, photos, model normalization and first-registration dates are outside this profile. Numeric source lexemes are preserved before decimal conversion to avoid JavaScript floating-point rounding. `confidenceBps: 10000` describes deterministic extraction of a stated value, not independent verification that the seller's statement is true.

The request's `maxJsonDepth`/`maxJsonMembers` bound the SDK capture envelope. Embedded JSON-LD has separate fixed limits (depth 32, 20,000 members, 8,192 traversal nodes). HTML traversal is capped at 25,000 nodes and depth 128 **after** parse5 builds its tree. The byte cap is not a parser CPU-preemption guarantee: hostile-case performance and worker isolation require qualification before large-scale deployment. Manifests are trusted operator configuration; the record validator is not a sandbox for hostile JavaScript Proxy objects.

## Network boundary and operations

Only HTTPS and one exact origin per manifest are supported. URLs with credentials, fragments, literal IPs, local names or alternate ports are rejected. All DNS answers must pass a conservative public-address policy; the selected address is pinned in the connection lookup while SNI/certificate validation use the original hostname. Connections do not share an agent or credentials.

The transport identifies itself as `AutoFindexBot`, asks for uncompressed HTML, enforces a 16 KiB header limit, streams at most the permitted body size and has an 8-second ceiling further restricted by SDK operation/run budgets. Unsupported charset/compression, redirects and non-200 responses are not parsed. 429 and transient failures flow back to the SDK's shared retry/rate/circuit controls; there is no hidden transport retry. 403/404 do not prove a vehicle was sold or an ad permanently withdrawn.

No background scheduler, public arbitrary-URL endpoint, browser automation, authenticated sessions or source activation is added. `runWithTransport` is internal test composition and excluded from package exports. The package is private in the workspace. Source review must establish permitted acquisition and a representative parser corpus before a live source worker uses it.

## Validation and rollback

```sh
pnpm --filter @auto-world/http-acquisition test
pnpm --filter @auto-world/http-acquisition lint
pnpm --filter @auto-world/http-acquisition typecheck
```

Use the repository's pinned Node/pnpm versions and serialize quality commands in a checkout. Unit tests cover extraction, capture tampering, URL/DNS/HTTPS boundaries and cancellation. Integration tests serve fictitious pages over actual local HTTP and reuse the SDK's test store/leases to check history, replays, interrupted commits, authority changes and absence semantics. This is not a PostgreSQL production or live-leboncoin validation.

Rollback is to stop/remove the new worker caller and dependency. No existing catalogue schema, SDK behavior, source configuration, public API contract or website is changed. Existing captured evidence remains governed by its recorded retention policy.

## Next increments

Add source-specific URL discovery, authentic parser fixtures and measured coverage before calling any source complete. Then build the persistent partitioned frontier/scheduler, connect real-listing contracts to the existing PostgreSQL/OpenSearch/Fastify stack, and implement cross-listing vehicle identity and cross-country comparisons. A global index requires ongoing source maintenance and measured freshness; this bounded seed runner is its acquisition foundation.

Architecture: [ADR-0036](../../docs/decisions/ADR-0036-owned-acquisition.md). Task/evidence: [TASK-0135](../../roadmap/tasks/TASK-0135-owned-acquisition.md), [validation](../../docs/validation/TASK-0135.md).
