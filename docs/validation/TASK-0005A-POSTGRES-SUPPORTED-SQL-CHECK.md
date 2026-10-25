# TASK-0005A — PostgreSQL supported SQL_CHECK result

Status: **ACTUAL SQL_CHECK NOT ACCEPTED — NO RETRY**. The sole Root-operated attempt reached the supported runtime boundary and returned a closed, typed refusal during container creation. It does not establish SQL success, cleanup, an application SQL caller, migration, data fidelity, backup, restore, service runtime or four-service acceptance. PostgreSQL generation 3 remains delivered and `ACTIVE`; TASK-0005A/0005 remain `IN_PROGRESS`, and TASK-0006 remains blocked.

## Delivered prerequisite

[PR141 generation 3 activation](TASK-0005A-POSTGRES-GENERATION3-ACTIVATION.md) is delivered on protected main `a4fbd14900c8eba4d7287610e4ca66d7aeeeab1a` with the identical reviewed tree `fbfd9f305ac7025abe0f1050b9f81763d79afd2a`. Exact-head CI `37604663035` and main CI `37614473270` passed. The final path-free read-only proof is 1,280 bytes with SHA-256 `2d0862367cb4819df8f2f4b895933a93e0879f0918aeb55c77f43c6a62ebe7e5`. Authority revision 2 is `ACTIVE` from 2026-10-07, with support through 2027-10-07 and archive retention through 2028-10-06.

Those facts establish the delivered immutable recipe, offline archive health and activation history. They do not establish a successful supported runtime session or SQL result. The failed P7 attempt below does not change generation 3 activation or its support and retention dates.

## Bounded P7 increment

The bounded operation was exactly one foreground invocation of the existing supported CLI with the closed `SQL_CHECK` intent. The caller supplied no SQL, authority object, dependency, URL, repository, ref, image, path, Docker argument, environment override, skip or callback. The broker retained the authority and capability boundary defined by [ADR-0011](../decisions/ADR-0011-postgres-admission-runtime.md).

The production SQL remains the fixed broker-owned check: begin a transaction, create one temporary table, insert the fixed `auto-world-admission-v1` marker, read that marker only when the database and user are both `awapp`, then roll back. No caller-controlled statement or durable application row is accepted. The check must use the exact admitted image and broker-owned isolated lifecycle.

The live attempt still had to freshly prove the genuine reviewed-main authority, bounded GitHub and registry network access, current P2/P3/archive evidence, high-water behavior, isolated daemon/image/container lifecycle, PostgreSQL readiness, exact SQL result, rollback, stop and cleanup. It retained canonical bounded failure evidence with closed stdin, stdout and stderr and an unambiguous nonzero process exit; it did not reach an accepted SQL result.

## Actual result — 2026-10-07

The single reviewed Root invocation ran from approximately 12:05:13 through 12:05:25 UTC and returned a closed native exit 1 after 11.513 seconds. The controller transferred and closed all 40,749 expected stdin bytes, observed both output EOFs, captured zero stderr bytes and reported no timeout, forced kill or overflow. Its terminal state is `CLOSED_UNCERTAIN_NO_RETRY`; the typed production failure is `CONTAINER_CREATE / postgres_admission_container_invalid`. SQL_CHECK is therefore `NOT_ACCEPTED_NO_RETRY`.

The canonical private terminal evidence is 1,076 bytes with SHA-256 `b9f2ab63befbd5226f6933b1a608164fe6daf651afa594ce5baaca08226aed8a`. The corresponding 2,156-byte Root observation has SHA-256 `66fb49672595b94ddeaa457fa86971a8eb7133e7798f25f0244efa3fec3bb8ec`. Root, architecture and security/privacy reviews accept those bytes as truthful failure evidence only. They do not accept SQL success or authorize a retry.

A preliminary read-only tool inspection at approximately 12:08:59 UTC found one retained owned candidate directory from the attempt. The retained 2,052-byte native footprint observation at 12:13:05.827 UTC, SHA-256 `773e6719db2aa97416b2da61a35f7d30076b219b4a4f0c71d3b5c150442f8994`, records the same bounded state: bound configuration, no live owned routing process, no PID or socket marker, no bootstrap secret, no temporary image archive and no remaining container metadata within that candidate daemon directory. The generation-3 PostgreSQL data directory remains empty with UID/GID 70/70 and mode `0700`; its Root-owned binding remains mode `0400`. Authority high-water state exists and no temporary intent marker remains. The observation transferred and closed its single input byte, reached both EOFs and exited 0 after 2.803 seconds without timeout, forced kill or overflow. All three bounded daemon-log indicators are false, so the observation provides no causal branch. The residual owned forensic directory is deliberately preserved. These facts do not prove that all global native state is unchanged or that physical cleanup completed.

The post-failure reseal revalidated the 74 recipe files, 16 installed directories, installation receipt, Node runtime and retained health with all descriptors closed and no SQL retry. That private observation is 783 bytes with SHA-256 `d953384c9294b05f7c0baf8da26052d6d9884b6b9c383a23578ca31e73faf698`.

Source inspection confirms that the current container validator reads top-level `inspected.Labels`, while actual Docker supplies `inspected.Config.Labels`, and requires a stricter minimal mount set than the actual Docker 28 inspection semantics verified against the primary Moby contract. Existing tests fabricate the incorrect top-level-label shape expected by that validator. This is a focused source defect to repair; the retained native evidence does not prove that this exact branch caused the actual refusal.

## Acceptance criteria applied to the actual run

1. Authenticate the reviewed operator and controller bytes and bind protected main, identical tree and successful main CI before credential handling or child spawn.
2. Pass one framed credential in memory to the authority environment only; never place it in argv, files, logs, receipts or arbitrary errors.
3. Revalidate all 74 recipe files, the complete installed directory closure, installation receipt, Node binary and current health before spawning the supported Node child and after every outcome.
4. Execute only `POSTGRES_SUPPORTED_SESSION_V1/SQL_CHECK` through the admitted CLI. Require the complete fixed phase sequence from authority through cleanup and the exact resolved main SHA.
5. Accept success only when the fixed temporary-table marker is returned, the transaction is rolled back, the process is fully closed, bounded observability is canonical and all owned runtime resources are removed or preserved according to their contract.
6. Treat nonzero exit, timeout, malformed output, lost EOF, authority change, stale evidence or cleanup uncertainty as failure or `UNCERTAIN`; never convert it to success or silently retry.
7. Obtain independent source and actual security/privacy review before recording any P7 evidence.

## Verification and remaining gates

The finalized private SQL operator retains 23 pure regressions covering framing, credential isolation, fixed child environment, canonical results, process uncertainty, bounded production failures, all 74 recipe files, all 16 directories, native identities, receipt mutation, symlink/extra-entry denial and close failure. Those source-only tests used mocked transport; the actual invocation separately exercised the genuine authority path and produced the refused result above.

The next focused increment must build a new generation 4 `PENDING` candidate from the frozen generation 3 inputs, repair the validator and add real-shape regression coverage. It must not patch the installed generation 3 recipe, reuse the empty failed data directory, mutate the scheduled task or retry this failed session. A later successful `SQL_CHECK` would prove only one bounded supported PostgreSQL session and its cleanup. Application migrations still require a reviewed fixed apply/idempotence/rollback/reapply foundation. Canonical/raw-reference/outbox integrity, durable application data fidelity, backup, isolated restore, long-running service behavior, restart persistence and all-four-service acceptance remain separate work.

## Failure and rollback

Before spawn, deny without runtime effects. After spawn, preserve bounded failure evidence and classify any unresolved process-group or cleanup state as `UNCERTAIN`. Stop or remove only proven-owned temporary runtime resources; preserve data volumes, backups, archives, source history, activation history and failed proofs. Do not retry a cancelled or uncertain SQL session without a new reviewed decision.
