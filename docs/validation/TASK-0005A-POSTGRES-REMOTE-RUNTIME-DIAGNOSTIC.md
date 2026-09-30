# TASK-0005A — Exact remote PostgreSQL runtime diagnostic

Status: IMPLEMENTATION_IN_PROGRESS, DIAGNOSTIC_ONLY, NOT_ADMITTED.

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

Runtime container/volume cleanup, image cleanup and temporary file cleanup are separate obligations. An uncertain runtime cleanup remains uncertain even when image and file removal succeed. Such an error prevents public upload. The final workflow gate fails if either runtime or cleanup fails; cleanup and public artifact validation must succeed before upload.

This diagnostic proves neither backup/restore nor host restart, production readiness, image admission, a security monitoring service or a support activation date. The remaining private retention/restore, official signature/verification and reviewed admission gates stay open. TASK-0005A and TASK-0005 remain IN_PROGRESS; TASK-0006 stays blocked. The authenticated fork-access test remains `SKIPPED_BY_USER` with isolation `NOT_VERIFIED`.

## Validation and rollback

Provider, runtime, entrypoint and workflow tests cover identity mismatches, changed/stale audit evidence, dangerous Docker profiles, foreign-resource collisions, persistence mismatch and uncertain cleanup. Fresh lint, typecheck, unit/integration checks, builds, secret scanning and independent review are required before merge. A real local production-route diagnostic and the first bounded native run are still pending; this document does not claim either result.

Disable the exhausted diagnostic workflow after its single dispatch. Preserve failed receipts and original accepted evidence. Reverting this focused implementation removes the diagnostic lane without changing source admission, production configuration or existing read-only receipts. No deployed service or database migration is introduced.
