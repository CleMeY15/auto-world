# ADR-0012 — Separate synthetic development from supported data infrastructure

Status: Accepted on reviewed merge to `main`, 2026-10-08.

## Context

TASK-0006 produces an implementation-ready vertical-slice plan; it does not run a connector, an image or a data service. Its previous dependency on completing the four-service TASK-0005 blocked even a plan using only synthetic fixtures and the already accepted TASK-0004 connector contracts. On 2026-10-08 the user directed that the synthetic development/CI path advance independently while the supported image-admission path continues.

## Decision

There are two explicitly separate execution lanes:

1. **Synthetic product planning and development.** TASK-0006 depends on accepted TASK-0004, not on TASK-0005. It selects a labeled, deterministic, network-free synthetic adapter and plans the raw-to-UI flow using injected in-memory store/search ports. TASK-0006 may become Done only as a reviewed plan; its completion does not claim a working four-service stack or a delivered P1 feature. Later synthetic-only implementation tasks need their own Definition of Ready, tests and Definition of Done before execution.
2. **Supported data infrastructure and real integration.** TASK-0005A, TASK-0005 and ADR-0007 remain unchanged prerequisites for running the supported PostgreSQL/OpenSearch/Redis/S3-compatible stack, migrations, durable ingestion, restart/restore, and any claim that those services work together. Real-source activation additionally requires complete Source Registry rights, credentials, retention/takedown and operational proof. Neither lane can satisfy the other's acceptance criteria by inference.

The synthetic lane does not execute Docker/Compose images, use private image packages or archives, access an external listing source, or use production credentials. Any future container-backed development lane must be separately specified, reviewed and gated before an image runs; this ADR does not authorize it. Diagnostic image execution remains only within the existing isolated TASK-0005A/TASK-0005 contracts.

Synthetic raw payloads have stable bytes and SHA-256 references; critical canonical fields retain observation-level provenance and contradictory or withdrawn observations remain distinguishable. A later synthetic implementation must invoke the accepted Connector SDK's unchanged authority port with an authenticated, enabled, test-only Source Registry fixture, not bypass that gate. The production Source Registry must never interpret the fixture's `legal_status` or test grant as real authorization; a negative composition test must show that the fixture cannot load in production or authorize an external source. Synthetic mode is selected only in an isolated dev/test composition, not by an end-user request or a production feature flag. UI built against fixtures must visibly identify demonstration data and must not present an unverified VIN, history, market price, Trust/Deal Score or source right as fact.

TASK-0006 must produce separate implementation task groups: (a) synthetic contract/API/UI work that needs no service image, and (b) durable four-service integration that remains blocked by TASK-0005. Both groups use the same public canonical/port contracts and contract-test corpus to limit drift; synthetic success never substitutes for real persistence, indexing, performance or recovery evidence.

## Sequencing and historical evidence

One READY task may advance in each independent lane, with focused branches and disjoint file ownership. Within a lane, dependencies remain sequential. A shared contract change requires coordination and an ADR before either lane couples to it. TASK-0005 keeps P0 priority in the infrastructure lane while TASK-0006 is the first READY synthetic-planning task; P1 implementation is not READY merely because this ADR merges.

Historical notes in ADR-0007, ADR-0008, ADR-0011 and validation records stating that TASK-0006 was blocked remain accurate for their original checkpoints. This ADR supersedes only that sequencing statement for the synthetic-only TASK-0006 plan. It does not waive an image finding, admit a candidate, change support/retention dates, complete TASK-0005, authorize a source or relax any Definition of Done gate.

## Verification and rollback

Review the dependency graph and synthetic/real boundary against TASK-0004, TASK-0005, TASK-0006, ADR-0007, the Source Registry, product UX and the delivery ledger. Require independent architecture and security/data-rights review, repository quality CI and a matching merged-main check for this contract change. Rollback is a reviewed revert of this ADR and task sequencing before downstream synthetic tasks are merged; it does not alter images, credentials, archives or persisted data.

Validation record: [ADR-0012 synthetic-lane sequencing](../validation/ADR-0012-SYNTHETIC-LANE.md).
