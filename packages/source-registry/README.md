# Source Registry

Dependency-free V1 declared-policy contract for source governance. It records immutable configuration and audit revisions, evaluates a specific request against the current contextual grant, and derives operational health separately from legal eligibility.

## Public API

- `parseSourceRegistry` validates and reconstructs a complete registry history.
- `appendSourceRevision` accepts only the next valid transition or an identical replay of the latest complete revision.
- `evaluatePolicyEligibility` evaluates one territory, acquisition method, audience and complete field set at an explicit time.
- `deriveSourceHealth` produces deterministic health status and ordered reasons from an explicit sample and time.

All functions return the shared `ValidationResult`. Failures contain only stable issue codes and schema-owned paths. Successful objects are detached from caller inputs and deeply frozen.

## Safety boundary

A structurally eligible result is not proof of a licence and is not permanent permission to acquire or redistribute data. Production callers must reload the authoritative current registry, authenticate and audit changes, verify referenced authorization evidence, enforce all returned policy obligations, and evaluate every acquisition or publication action again.

The package never:

- registers or enables a real source;
- retrieves credentials or accepts credential values;
- performs network acquisition, deletion or takedown work;
- changes eligibility from health measurements;
- exposes VIN or seller PII outside explicitly internal clauses;
- verifies that an authorization, actor or policy reference exists.

Only `schemaVersion: 1` is supported. The authoritative state machine, policy vocabulary, compatibility rules and rollback boundary are documented in `docs/decisions/ADR-0002-source-registry-contract.md`. Durable authenticated storage, compare-and-swap, runtime observability and obligation enforcement belong to later connector infrastructure.
