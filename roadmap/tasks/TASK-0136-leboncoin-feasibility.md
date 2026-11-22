# TASK-0136 — Essai réel borné du connecteur leboncoin

## Brief / Definition of Ready

- Status: IN_PROGRESS; priority P0. User explicitly prioritizes testing source acquisition before further product development.
- Owner: root; branch `spike/0136-leboncoin-feasibility`; parent `f0fb73d910582a847743531ee59980f418add7f4` (draft PR268).
- Scope: up to three observed vehicle detail URLs, one ordinary HTTP request per seed, plus a separately labelled ordinary browser comparison. Stop HTTP batch on challenge/403/429. No repeated retries, challenge solving, credentials, stealth, alternative private endpoints or production source-registry activation.
- Outcome: a reproducible diagnostic and small source-specific rendered-DOM extractor with offline replay. Evidence must distinguish autonomous HTTP, ChatGPT cloud browser and any independently executed worker.
- Current preflight: first ordinary HTTP GET returned 403 and a JavaScript verification page; the same detail URL rendered in the cloud browser. This is a preliminary observation, not qualification of a production connector.
- Resources: isolated existing checkout; source data private; only sanitized observations committed. No site/VPS/database writes. Exact runtime model/effort unknown.
- Roles: root pilot/integration; acquisition_extractor implementation; acquisition_design_review independent review. No parallel network runs. Serialize quality commands.
- Dependencies: TASK-0135 foundation, without changing its SDK permission or production composition contracts.

## Acceptance

| Criterion | Required evidence |
| --- | --- |
| Actual source access classified honestly | HTTP status, captured byte count/hash, transport, observed time, no search snippet presented as a direct fetch |
| Source detail extraction | Title, detail price in EUR cents, mileage in km, exact visible criterion labels, original URL and observed photo references |
| No false listing on blocked or irrelevant markup | Negative cases and missing/ambiguous values remain explicit |
| Replay reproducible | Offline normalized JSON and source observation hash |
| Feasibility not overstated | Browser observation separate from autonomous collector, discovery, completeness, repeated updates, image copying and scale |
| Reviewable delivery | Focused code/tests/report, independent read-only review and draft PR; no merge/deployment |

## Plan

1. Record bounded experiment and independent design review.
2. Preserve sanitized evidence from the actual HTTP response and rendered DOM of at most three detail pages.
3. Implement a minimal replayable source-specific DOM extractor and ordinary HTTP diagnostic; no invented source markup.
4. Run focused offline tests, review output against actual observations, document limitations.
5. Deliver draft PR and concrete go/no-go for the next experiment, with no production enablement.

## Delivery

Validation will be recorded in `docs/validation/TASK-0136.md`. The user authorizes the isolated diagnostic, not a fabricated production source grant. Main/V1 and PR268 remain unchanged. Acceptance remains pending until evidence and review.
