# ADR-0019 — Consumer-led fiscal-rule versioning readiness

Status: Reviewed — TASK-0010 documentation-only delivery; exact final-head/main acceptance governed by its PR delivery comment.

## Context

The [roadmap](../../ROADMAP.md) requires sourced, dated, versioned rules for future French registration and import estimates. [Vehicle Intelligence](../VEHICLE_INTELLIGENCE.md) also requires declared rule versions, effective dates, explicit missing inputs and uncertainty. No current application consumer, official fiscal dataset or calculation contract exists in this repository.

An executable metadata library now would commit to rule identities and temporal semantics before a consumer can validate them. A parser can establish structural consistency, not official authority, correct interpretation or applicability to a vehicle or transaction.

## Decision

Deliver a readiness gate, not a fiscal engine or public contract. The first executable fiscal task must name its consumer, resolve the requirements below, define its own acceptance tests and obtain independent architecture and domain/provenance review before it becomes READY. Registration and import have distinct decision paths; one must not stand in for the other.

Do not create a package, identity scheme, rule payload, API signature, generic expression language or numerical example in TASK-0010. Possible future parsing/selection operations are design options only, not frozen interfaces. No current fiscal rate, exemption, threshold or legal interpretation is asserted here.

## Evidence required before executable work

| Requirement | Accountable role in the future task | Evidence required in its DoR/ADR |
| --- | --- | --- |
| Consumer and scope | Product/domain owner | Named registration or import consumer, precise decision, jurisdiction/territorial scope, vehicle/transaction categories and explicit exclusions. |
| Official sources and interpretation | Fiscal/domain owner with independent legal/provenance review | Exact official documents and relevant provisions, retrieval date, effective/publication dates where relevant, review responsibility, interpretation record and unresolved questions. A locator alone is insufficient. |
| Currency and corrections | Data/operations owner | Source-change monitoring/review policy, stale-evidence behavior, amendment/supersession/correction rules and preserved historical versions. |
| Applicability time | Fiscal/domain owner and architect | The legally relevant event/date, civil-date versus instant/time-zone needs, endpoint inclusivity and boundary examples derived from reviewed sources. No silent truncation or ambient-current-date fallback. |
| Rule identity and selection | Domain/architecture owner | Consumer-driven series/version/release identity, compatibility policy, deterministic selection and explicit outcomes for gaps, overlaps, no rule and unresolved scope. No arbitrary winner. |
| Inputs and provenance | Vehicle Intelligence/data owner | Required facts, origins, specs/emissions/localization and field-level evidence/confidence; treatment of missing or contradictory values. Seller location must not silently substitute for customs origin. |
| Audit and retention | Data/privacy owner | Reproducible source-to-version-to-result references, immutable evidence retention/correction plan, lawful retention/access obligations and no silent rewriting of prior results. |
| Explanation and uncertainty | Product/UX owner | Itemized outcome, assumptions, unresolved inputs and user-facing uncertainty; no false precise total. Required mobile/accessibility/error states when a UI is introduced. |
| Verification and operation | Test/domain/SRE owners | Source-backed boundary/golden cases, regression strategy, diagnostics without sensitive payloads, failure/stop behavior, migration compatibility and tested rollback appropriate to the actual consumer. |

The eventual task must assign these roles to its execution/review lanes and link the evidence, not merely repeat this checklist. Missing source, consumer, timing or applicability decisions keep that task NOT_READY. This ADR does not resolve those decisions by itself.

## Invariants and deferred choices

- Every actual rule and estimate must expose the version and relevant effective context; contradictory or corrected evidence is retained explicitly.
- Data, database/search authority and deterministic calculation remain distinct from LLM explanation. An LLM must not invent missing fiscal facts.
- Structural validation and caller-supplied dates cannot authenticate a source or establish legal applicability.
- Unknown inputs, unavailable/stale evidence, gaps and conflicting rules must not become a default rule or an apparently precise estimate.
- Date granularity, endpoint conventions, rule payloads, concrete APIs, persistence and rollout are deferred to the first consumer-driven task. They are not mandated by a synthetic example.

## Alternatives and tradeoff

An executable selector now would test date boundaries early, but would test a guessed model without source-backed consumer semantics. Waiting without recording prerequisites would leave the roadmap gap implicit. The bounded documentary gate is chosen because it defines what must become known before implementation, with no new runtime maintenance cost. It provides no user-visible capability and no executable proof of future fiscal behavior.

## Consequences, completion and rollback

TASK-0010 may complete as readiness documentation only. Executable fiscal versioning, registration/import engines, official datasets and the broader fiscal P0 remain open. Existing specs/emissions/origin and supported-infrastructure dependencies remain in force; TASK-0005 and TASK-0104 are not accepted or unblocked by this ADR.

Follow-up: create a separate DoR-complete executable task for the first named consumer, using reviewed sources and the smallest API/schema justified by that consumer. Its code, source-bound tests, UI/UX where applicable, observability and delivery gates must be independently validated. Rollback of this checkpoint is a documentation revert; any later persistence or deployed consumer requires its own migration and rollback plan.
