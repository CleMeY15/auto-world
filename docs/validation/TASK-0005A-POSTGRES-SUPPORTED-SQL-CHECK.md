# TASK-0005A — PostgreSQL supported SQL_CHECK preparation

Status: **PREPARED — ACTUAL SQL_CHECK NOT RUN**. This increment prepares the smallest PostgreSQL P7 runtime proof after generation 3 activation. It adds no application SQL caller, migration, data-fidelity claim, backup, restore, service session or four-service acceptance. TASK-0005A/0005 remain `IN_PROGRESS`; TASK-0006 remains blocked.

## Delivered prerequisite

[PR141 generation 3 activation](TASK-0005A-POSTGRES-GENERATION3-ACTIVATION.md) is delivered on protected main `a4fbd14900c8eba4d7287610e4ca66d7aeeeab1a` with the identical reviewed tree `fbfd9f305ac7025abe0f1050b9f81763d79afd2a`. Exact-head CI `37604663035` and main CI `37614473270` passed. The final path-free read-only proof is 1,280 bytes with SHA-256 `2d0862367cb4819df8f2f4b895933a93e0879f0918aeb55c77f43c6a62ebe7e5`. Authority revision 2 is `ACTIVE` from 2026-10-07, with support through 2027-10-07 and archive retention through 2028-10-06.

Those facts establish the delivered immutable recipe, offline archive health and activation history. They do not establish a supported runtime session, live authority access, registry access, Docker execution or SQL success.

## Bounded P7 increment

The prepared operation is exactly one foreground invocation of the existing supported CLI with the closed `SQL_CHECK` intent. The caller supplies no SQL, authority object, dependency, URL, repository, ref, image, path, Docker argument, environment override, skip or callback. The broker retains the authority and capability boundary defined by [ADR-0011](../decisions/ADR-0011-postgres-admission-runtime.md).

The production SQL remains the fixed broker-owned check: begin a transaction, create one temporary table, insert the fixed `auto-world-admission-v1` marker, read that marker only when the database and user are both `awapp`, then roll back. No caller-controlled statement or durable application row is accepted. The check must use the exact admitted image and broker-owned isolated lifecycle.

Preparation alone proves none of the live boundaries. A later Root-operated result must freshly prove the genuine reviewed-main authority, bounded GitHub and registry network access, current P2/P3/archive evidence, high-water behavior, isolated daemon/image/container lifecycle, PostgreSQL readiness, exact SQL result, rollback, stop and cleanup. It must retain the canonical session result and bounded production observability with closed stdin, stdout and stderr and an unambiguous process exit.

## Acceptance criteria for the actual run

1. Authenticate the reviewed operator and controller bytes and bind protected main, identical tree and successful main CI before credential handling or child spawn.
2. Pass one framed credential in memory to the authority environment only; never place it in argv, files, logs, receipts or arbitrary errors.
3. Revalidate all 74 recipe files, the complete installed directory closure, installation receipt, Node binary and current health before spawning the supported Node child and after every outcome.
4. Execute only `POSTGRES_SUPPORTED_SESSION_V1/SQL_CHECK` through the admitted CLI. Require the complete fixed phase sequence from authority through cleanup and the exact resolved main SHA.
5. Accept success only when the fixed temporary-table marker is returned, the transaction is rolled back, the process is fully closed, bounded observability is canonical and all owned runtime resources are removed or preserved according to their contract.
6. Treat nonzero exit, timeout, malformed output, lost EOF, authority change, stale evidence or cleanup uncertainty as failure or `UNCERTAIN`; never convert it to success or silently retry.
7. Obtain independent source and actual security/privacy review before recording any P7 evidence.

## Prepared verification and remaining gates

The finalized private SQL operator retains 23 pure regressions covering framing, credential isolation, fixed child environment, canonical results, process uncertainty, bounded production failures, all 74 recipe files, all 16 directories, native identities, receipt mutation, symlink/extra-entry denial and close failure. These are source-only tests with mocked transport. They do not exercise a credential, network, WSL, Docker, PostgreSQL or the genuine authority.

A successful `SQL_CHECK` would prove only one bounded supported PostgreSQL session and its cleanup. Application migrations still require a reviewed fixed apply/idempotence/rollback/reapply foundation. Canonical/raw-reference/outbox integrity, durable application data fidelity, backup, isolated restore, long-running service behavior, restart persistence and all-four-service acceptance remain separate work.

## Failure and rollback

Before spawn, deny without runtime effects. After spawn, preserve bounded failure evidence and classify any unresolved process-group or cleanup state as `UNCERTAIN`. Stop or remove only proven-owned temporary runtime resources; preserve data volumes, backups, archives, source history, activation history and failed proofs. Do not retry a cancelled or uncertain SQL session without a new reviewed decision.
