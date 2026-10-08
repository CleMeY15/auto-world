# TASK-0102 — Deterministic synthetic search API

Status: BLOCKED until TASK-0101 is Done on `main`. Priority: P1. Owner: API/search executor; independent API/security and operations review.

## Goal and dependencies

Expose the reviewed demo read/query contract through a small typed API without adding an LLM, search engine, real source or data service. Depends on TASK-0101 accepted on `main` and its frozen `DemoSearchQueryV1`/`DemoResultV1`/`DemoSearchResponseV1` ADR. TASK-0005 is not used for this synthetic route.

## Relevant contracts and scope

[P1 plan](../plans/TASK-0006-synthetic-first-slice.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), `packages/demo-search-contract` public API. Implement in `services/api` using the roadmap reference Fastify/TypeScript stack with exact reviewed package/license/security evidence; do not write a general-purpose router. API core consumes only `DemoReadPort`, never fixture bytes or SDK private test modules. Its separate production-excluded `services/api/demo/createSyntheticDemoReadPort` factory composes the `connectors/synthetic` fixture adapter with the SDK test-support store; only the API demo entrypoint imports this factory. There is no `services/api` → `services/ingestion` source import or additional transport/process. Bind loopback only; allowlisted Host/Origin, default-deny CORS, methods/content types and stack-trace suppression are explicit negative tests. Version request/response, typed errors, request IDs, bounded input, deterministic sort and opaque cursor. No external URL/credential, Docker or real-service connection.

## Acceptance and test strategy

- Search returns only active synthetic listings, with fixture-scoped count, explicit `dataMode`, observed price/mileage or unavailable, and sanitized public evidence/history references. Detail can show withdrawn historical evidence honestly. Internal VIN, raw IDs/hash/payload, source rights and unsupported automotive fields never enter the public DTO.
- Implement the only `DemoReadPort` adapter/factory over committed SDK store projections and immutable observation history, and prove deterministic latest-value selection, contradictory history, withdrawal and no inferred vehicle identity in behavioral tests. TASK-0101's declaration/SDK snapshot tests do not substitute for these read-port tests.
- Filters, cursor stability, replay and stale/partial projection semantics are deterministic. Invalid/unsupported natural language gets a typed editable error, not an inferred query. Failures do not expose source text or internal exception messages.
- Return `dataAsOf` and explicit `complete|partial|stale` envelope state on every successful response; non-complete states use only frozen bounded reason codes and never claim a complete count. Validate/generate a request ID and propagate it through `DemoReadPort` and error responses.
- Contract, hostile-input, pagination, redaction, no-network and production-import tests pass; fixture-profile p95 search <500 ms is measured with environment/sample count and not presented as production-scale performance.
- Allowlisted telemetry uses event names/counts/field names only. Assert `api_requests_total{route,status}`, `api_errors_total{code}` and `api_request_duration_ms`, structured request-ID/route/status/duration/code logs, and `api.search`/`read_port.query` spans in a test sink. No raw query, VIN, source ID, raw hash/payload or persistent user ID may appear in logs, metrics or traces. Bounded errors and a test-only failure alert are asserted. Root quality/security gates, independent review and `docs/validation/TASK-0102.md` evidence pass. Rollback disables the demo entrypoint without touching canonical evidence.
