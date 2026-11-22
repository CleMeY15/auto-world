# TASK-0135 — Première brique de collecte propre à AutoFindex

## Brief / Definition of Ready

- Status: IN_PROGRESS; priority P0 for the new owned-acquisition lane requested by the user on 22 November 2026.
- Owner: root; branch `product/0135-owned-acquisition`; base `44c59c8be1bc65456595a6e081a8c7996d1a508f`.
- Request: build our own powerful acquisition system and API, using owned/open-source code, with leboncoin as the first target and worldwide expansion as the product goal. The request authorizes implementation, not a fabricated third-party access grant or a claim of full coverage.
- First deliverable: an executable, bounded HTTP/HTML acquisition module integrated with the existing Connector SDK. Preserve original HTTP bodies, extract a documented Schema.org vehicle profile, and demonstrate ingestion/history/recovery against an owned local HTTP fixture.
- Dependencies: the existing SDK/source registry/vehicle contracts on the base above; their original contracts remain unchanged. PostgreSQL/OpenSearch/API remain the downstream architecture; no second catalogue database is introduced.
- Contract: [ADR-0036](../../docs/decisions/ADR-0036-owned-acquisition.md). The existing synthetic product, deployment and TASK-0005 qualification retain their separate owners and state.
- Roles: root implementation/integration; independent architecture reviewer; independent extraction implementer; final distinct code/security reviewer. All contexts use the session's inherited model; exact runtime model/effort is not exposed, recorded as unknown rather than inferred.
- Resources: isolated worktree `auto-world-acquisition`; no mutation of the audit checkout, existing site, VPS or production data. Quality commands serialized in this checkout.
- Budget: unknown. Reassess after two failures without new evidence; no production target or throughput number claimed before measurement.

## Acceptance

| Outcome | Evidence |
| --- | --- |
| Exact HTML body survives ingestion | Byte/hash comparison of capture envelope and SDK raw store, before mapping |
| Seed URLs are source scoped | Configuration, origin, credentials, redirect and public-network validation tests |
| Collection does not pretend to enumerate an entire site | `explicit_tombstone` policy required on every authority read; bounded seed coverage is explicit |
| HTTP failure cannot become an empty successful catalogue | Status, timeout, byte cap, cancellation and malformed/ambiguous extraction cases |
| Replays do not lose source identity | Manifest-bound adapter version, changed-config conflict and same-run resume tests |
| Automotive values are sourced precisely | JSON-LD profile tests for exact price, currency, distance units, optional VIN and absent/ambiguous fields |
| Existing SDK history is reused | First acquisition, price update, replay and interrupted-run integration cases |
| No accidental live source activation | No production source credentials, automatic scheduler, public crawl endpoint or enabled leboncoin config |

UI is not modified; visual/browser changes are not applicable to this module. Existing general CI retains its browser gates.

## Plan

1. Freeze acquisition/capture/identity/coverage decisions and obtain independent architecture review.
2. Add a private workspace package, bounded transport, capture codec, deterministic HTML extractor and guarded SDK composition.
3. Prove behavior on fabricated pages served by an owned local HTTP origin and existing SDK test storage. This is real HTTP execution over fictitious content, not evidence of leboncoin access or production storage qualification.
4. Run relevant tests, lint, typecheck, build, tracked-secret and dependency checks; obtain independent code/security review; retain general CI results separately.
5. Deliver a reviewable PR. Subsequent tasks own source discovery, source-specific authentic fixtures, the real-listing API contract, persistent production composition and catalogue scale.

## Delivery

Validation: [TASK-0135](../../docs/validation/TASK-0135.md). No DONE or live collection is claimed by this brief. Rollback removes the new caller/package; existing SDK, source histories and the current site remain untouched.
