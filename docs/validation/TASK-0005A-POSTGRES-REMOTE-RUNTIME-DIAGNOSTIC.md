# TASK-0005A — Exact remote PostgreSQL runtime diagnostic

Status: LOCAL_RUNTIME_VERIFIED, NATIVE_RUNTIME_V1_FAILED, V2_IN_PREPARATION, DIAGNOSTIC_ONLY, NOT_ADMITTED.

## Subject and prerequisites

This increment follows the [verified native vulnerability audit](TASK-0005A-POSTGRES-REMOTE-AUDIT.md) of `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`. It exercises only the reviewed private image, with its exact configuration ID and twelve ordered DiffIDs. It cannot publish, sign, admit or activate an image.

The committed `infra/postgres-image/candidate-runtime.json` pins successful audit run `36673766454`, protected-main recipe `5186a241f9ab28add4098648aa4bc56d36b5e6dc`, artifact `11079393568`, the archive digest and all sixteen individual public report identities. The downloader rejects a digest mismatch. The entrypoint independently authenticates the successful first-run/first-attempt audit and its artifact through GitHub, then replays the production audit validator against owned copies of those exact files. A stale vulnerability database (older than 48 hours), an incomplete audit, any blocker, changed bytes or invalid metadata prevents execution. The Java database retains the user's age policy: valid timestamps are required, without a maximum-age rejection.

## Runtime contract

The manual input-free workflow permits only its first run and first attempt on protected `main`, on a non-root GitHub-hosted Ubuntu 24.04 runner. It checks a clean exact checkout, Docker client/server 28.0.4, Node 22.23.2 and at least 6 GiB temporary capacity. Permissions are limited to contents, actions and packages read. Source lock and publication identities are authenticated before private package access. Anonymous access must remain denied.

The provider independently pulls, inspects and saves the exact digest, validates the archive, and supplies a frozen runtime snapshot. Its earlier read/scanner lane remains `REMOTE_READ_ONLY` with image execution `NOT_ATTEMPTED`; the new runtime material receipt explicitly records diagnostic execution. Before every container creation and start, the runtime revalidates the authenticated audit bytes and current database freshness.

The bounded runtime checks the corrected gosu binary/version, absence of the old executable, UID/GID 70 transition and `no-new-privileges`. It initializes PostgreSQL through the authenticated normal image entrypoint on a newly owned volume, verifies that PostgreSQL PID 1 runs as UID/GID 70, writes and reads a fixed synthetic payload, stops and removes that first container, and starts a distinct second container on the same volume. Exact readback proves persistence across container replacement on one runner.

Containers use the exact inspected image ID with `--pull=never`, no network, no host ports, no host/socket binds, a read-only root filesystem, bounded memory/CPU/PIDs/shared memory, and only the reviewed capabilities needed for initialization. Docker inspection must confirm the full expected profile before each start. Names, labels and fresh-volume checks establish ownership before removal. Existing foreign resources are neither reused nor removed.

## Evidence, cleanup and limits

The only public output is a closed bounded technical `receipt.json`. It records the exact audit and image identities, diagnostic phases, two distinct container IDs, synthetic payload identity and owned resource cleanup. It contains no credentials, container environment, raw private archive, listing data or unrestricted subprocess output. Support start, support end and archive dates remain null; admission remains `NOT_AUTHORIZED`.

Runtime container/volume cleanup, image cleanup and temporary file cleanup are separate obligations. An uncertain runtime cleanup remains uncertain even when image removal succeeds; the provider preserves the private runtime directory and its residues in that case. Such an error prevents public upload. The final workflow gate fails if either runtime or cleanup fails; cleanup and public artifact validation must succeed before upload.

This diagnostic proves neither backup/restore nor host restart, production readiness, image admission, a security monitoring service or a support activation date. The remaining private retention/restore, official signature/verification and reviewed admission gates stay open. TASK-0005A and TASK-0005 remain IN_PROGRESS; TASK-0006 stays blocked. The authenticated fork-access test remains `SKIPPED_BY_USER` with isolation `NOT_VERIFIED`.

## Validation and rollback

Provider, runtime, entrypoint and workflow tests cover identity mismatches, changed/stale audit evidence, dangerous Docker profiles, foreign-resource collisions, persistence mismatch and uncertain cleanup. Fresh non-root Linux checks on `abce8a607c05d094947477e354aa3dd9f8a9b6bc` passed 954 root tests with zero failures/skips, all package lint/typechecks/tests/builds, Secretlint for 511 files and dependency audit with no known vulnerabilities. Separate implementation reviews approved the provider, runtime and entrypoint/workflow/policy. Exact final-head/main CI and independent evidence review remain required before the native dispatch.

## Local production-route result

The non-root Docker 28.0.4 simulation on `abce8a607c05d094947477e354aa3dd9f8a9b6bc` passed the default entrypoint, provider, engine and standalone cleanup. Only the protected-main API response was injected for this explicitly local context (`36699999901`); the original audit API authentication, sixteen retained report bytes, production artifact replay, private package retrieval and Docker operations were real. It is not a native GitHub runtime proof.

All fourteen material phases and six runtime phases passed. The corrected gosu `1.19-r5` executable reported Go 1.26.8, switched to UID/GID 70 and retained `no-new-privileges`. PostgreSQL PID 1 had all four UID/GID fields equal to 70 and ran `/usr/local/bin/postgres`. The fixed payload was written/read in container `f8942462f85088e97f6b630f623a16027267ec6b2e2583d66d90170005464507`, then read unchanged in distinct container `e539c3b3d5895fb060d35cbeb95a3b2c6b441df90b0ab74ceaf11b3d1f68d3cb` on the same fresh owned volume. Both services stopped gracefully. The three containers, volume, image, archive and authentication directory were removed; standalone cleanup returned `CLEANED` and the private root was absent.

The closed local receipt is 13,873 bytes, SHA-256 `a0f3bc7e213facdb828ad95cdab47693f9f7c9f6a5612ad61fd057ff1f75ecb9`, retained with its original driver and logs under the ignored local cache `pg-remote-runtime-local-ojRo0tKo`. Earlier local failures remain failed and retained. A harness-only ownership failure occurred before candidate access; subsequent materialized attempts stopped before container creation because the engine expected an empty working directory while the authenticated image configuration uses `/`. The correction requires exactly `/`, rejects empty/foreign paths and preserves the full profile checks. No failed result is reclassified as a successful runtime.

At this local checkpoint the first bounded native run was still pending. The local receipt retains `DIAGNOSTIC_ONLY`, `NOT_AUTHORIZED` and null support/archive dates.

## Native V1 failure and bounded V2 correction

[PR115](https://github.com/CleMeY15/auto-world/pull/115) merged the reviewed implementation at protected main `f96dc95e08127d8a3c259f66d87cce282556370b`. Exact final-head CI `36680771797` and main CI `36681219446` passed after the fresh Linux and real local checks above. The first and only [native runtime V1 run `36681413783`](https://github.com/CleMeY15/auto-world/actions/runs/36681413783), number 1/attempt 1, **FAILED** on that exact main. Its managed-runner/source and original-audit download gates passed. The execute step returned `INCOMPLETE/postgres_remote_runtime_material_failed`; standalone cleanup returned `CLEANED`, and only the approved bounded failure receipt was uploaded. The final outcome gate correctly failed the workflow.

Artifact `11081434905` contains only `receipt.json`. Its independently downloaded 1,204-byte ZIP has SHA-256 `61730b337226d8a5b1915fbe62be31cd9d237111b6bf3ba10d87160953b366e7`, matching the API digest. The original 1,066-byte receipt has SHA-256 `26ed7babe7ce028539ab06463c0f1f0cf82316a4b310c5a04d8b07742fb3d307`. It retains the authenticated audit identity, null material/runtime results, `NOT_AUTHORIZED` and null support dates. The originals remain in the ignored `postgres-candidate-remote-runtime-36681413783` cache. This failure establishes no runtime/persistence proof. The generic error envelope does not establish its exact runtime phase or cause.

V1 is disabled and its exhausted definition is retired. The new input-free `postgres-candidate-remote-runtime-diagnostic-v2.yml` permits only its own first main run/first attempt. It preserves the same audit, subject, permissions, freshness, profile and cleanup gates. Bounded failure telemetry adds only an optional closed runtime code/phase; older code-only failure receipts remain valid historical evidence. Unknown or prefix-spoofed messages cannot enter this diagnostic, and nested cleanup uncertainty cannot be masked by a safe outer code.

The readiness correction covers the normal-entrypoint transition where gosu has already switched PID 1 to UID/GID 70 but the entrypoint is still bash while a temporary database server accepts readiness probes. Such an initialization state is awaited within the existing deadline; SQL starts only after PID 1 is the final PostgreSQL executable with the required identity and privileges. This covered case is not asserted to be the unobserved exact cause of V1. New real local checks, independent review, exact-head/main CI and V2 dispatch are pending.

Disable the exhausted diagnostic workflow after its single dispatch. Preserve failed receipts and original accepted evidence. Reverting this focused implementation removes the diagnostic lane without changing source admission, production configuration or existing read-only receipts. No deployed service or database migration is introduced.
