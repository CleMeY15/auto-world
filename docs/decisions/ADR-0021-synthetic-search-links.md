# ADR-0021 — Explicit synthetic search links

Status: accepted for TASK-0111 implementation after Architect CLEAR and Critic APPROVE, 2026-10-18. Delivery acceptance remains separate.

## Decision and alternatives
Use a closed, versioned browser fragment to share existing accepted cursorless V2 criteria. Query parameters are conventional but put criteria into HTTP/log handling; opaque server shortlinks need persistence/API outside this independent synthetic lane. The fragment is bounded, reuses current validation and requires no backend.

This narrowly supersedes ADR-0016's original no-query-in-URL rule only for explicit creation of synthetic search links. Ordinary search still keeps filters in memory. TASK-0108 storage, V2 DTOs, API/proxy, canonical provenance, sources and infrastructure remain unchanged. A link is user preference data, never automotive evidence, vehicle identity or a fixed result snapshot.

## Closed browser contract
`#search-link/v1/<encodeURIComponent(JSON.stringify(criteria))>`, maximum4096 raw fragment characters INCLUDING prefix, checked before decoding. Decode exactly once, then existing duplicate/prototype-key rejecting strict JSON and closed saved-search criteria validator. Criteria contain only cursorless V2 query plus required fixture/taxonomy-release binding for make/model. No names, free text, publication IDs, results, evidence or extra fields. Preserve exact numeric representation using existing canonicalization/restoration; negative zero follows the existing zero normalization. Unknown route version is unsupported; malformed/oversize input is invalid. Never render rejected input.

Generate only a fresh fixed `/demo` URL from the current HTTP(S) origin, dropping existing path/query/hash and rejecting credentials, missing/invalid host or unsupported schemes. Payload never controls origin/path. Current loopback deployment is local to its computer; no hosted sharing is delivered.

## Interaction and trust boundaries
Creation uses accepted first-page criteria, not edited draft or pagination cursor; empty/partial/stale results remain qualified. Inline readonly selectable field, explicit clipboard write and manual fallback. Success only after writeText resolves; unavailable/rejected clipboard never claims success. No clipboard read, permission preflight, deprecated execCommand, automatic copying or external request. Replacement/unmount invalidates UI completion, not the operating system's already-requested write.

Incoming route reviews readable criteria, never automatically applies/searches/saves. Exact catalogue fixture/release/parent matching precedes identity restoration; otherwise explicit omission only. Applying reuses the existing saved-search full reset and focuses editable Search. Shared-hash arrival cancels pending search/epoch and clears request feedback without erasing draft/results/pagination; completion also checks current raw hash before publishing. Back/Forward/reload cannot implicitly apply a link. Disabled demo retains Saved-only recovery with no API requests.

Analytics remain closed and no-op: search_link_created, search_link_copied(success/error), search_link_loaded, shared screen; no URL/criteria/origin/names/IDs/free-form errors. Fragments remain visible to link holders, browser history and page scripts/extensions: not secrecy or authentication.

## Official browser evidence
- [WHATWG URL fragment](https://url.spec.whatwg.org/#concept-url-fragment): fragment is a separate URL component; generate a new fixed-path URL rather than inherit location.href.
- [W3C Referrer Policy stripping](https://www.w3.org/TR/referrer-policy/#strip-url): fragments are stripped from Referer; this is transport minimization, not confidentiality.
- [W3C Clipboard writeText](https://w3c.github.io/clipboard-apis/#dom-clipboard-writetext): permission/user activation can reject the promise. Feature-detect and catch inside the explicit copy action.

## Verification and rollback
TASK-0111 owns strict hostile codec tests, real API browser roundtrip, pending catalogue/copy/search races, zero implicit POST/storage/network effects, disabled boundary, exact values, visual/accessibility/performance gates and independent reviews. Disable the existing demo or revert increment; no data migration. Hosted shortlinks, persistent comparison, cross-device sync and real data remain separately gated follow-ups.
