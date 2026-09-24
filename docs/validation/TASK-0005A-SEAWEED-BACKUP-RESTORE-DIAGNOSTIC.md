# TASK-0005A — isolated SeaweedFS backup/restore diagnostic

State: PLANNED, NOT_VERIFIED. This is an execution contract for one disposable local candidate, not evidence that run 9 succeeded or that any image is admitted.

## Boundary

The guarded ninth `workflow_dispatch` on reviewed protected `main` may rebuild the exact SeaweedFS derivative locally with read-only GitHub permissions. It must keep Docker traffic and S3 clients on the runner, publish no port or image, retain no archive or volume, and make no registry write. The user-skipped external authenticated fork access test is not part of this diagnostic.

The objective is the narrow backup and isolated restore requirement in [ADR-0008](../decisions/ADR-0008-seaweed-s3-derivative-profile.md). It does not satisfy the admitted-image audit or the four-service lifecycle in [TASK-0005](../../roadmap/tasks/TASK-0005-local-data-infra.md).

## Required run-9 evidence

1. Reuse the exact candidate-image, non-root runtime and signed S3 checks already validated by the [runtime diagnostic](TASK-0005A-SEAWEED-RUNTIME-DIAGNOSTIC.md). A fresh run-9 image identity must be bound to the workflow run and recipe revision.
2. Initialize a fresh owned source volume. A signed conditional PUT and GET must agree on the technical object's SHA-256 before backup.
3. Stop the source service within its bound. Copy the stopped `/data` state to an independently owned backup volume without network access or a foreign Docker mount. Check the copied content before allowing the source to be removed.
4. Remove the source container and volume after exact ownership checks. Create a distinct, empty restore volume, then restore only the owned backup content into it. The source must be absent before the restored service starts.
5. Start a distinct non-root service on the restored volume and require signed GET of the same object and SHA-256. Stop it within its bound.
6. Remove only proven-owned helpers, services, volumes, candidate image, local archive, rootfs and temporary directories. Every removal must be preceded by a fresh identity check and followed by absence verification; uncertain ownership blocks a success receipt and preserves the uncertain resource for investigation.

The public V5 receipt may report `VERIFIED/DIAGNOSTIC_ONLY/NOT_AUTHORIZED` only after all steps and owned cleanup pass. It must distinguish its backup/restore proof from earlier V2/V3/V4 proof kinds and retain bounded phase/reason on failure. `publication`, `vulnerabilityAudit` and `admission` remain `NOT_ATTEMPTED`.

## Verification and limits

Tests must reject occupied names, foreign or altered labels, image/volume/container identity drift, unexpected helper mounts or privileges, incomplete backup, missing or changed restored object, failed service shutdown, and uncertain cleanup. Exact-head Linux CI, an independent implementation/security review, protected-main CI, and one guarded native run are required before recording a successful V5 result. A failed run remains failed even if its cleanup succeeds.

A successful run would cover one small technical object, one stopped-volume copy and one restore on one runner and Docker daemon. It would not prove online or crash-consistent backup, cross-host recovery, retention, RPO/RTO, arbitrary data sets, the private image archive, fresh vulnerability audit, production admission or the final four-service restart/restore contract. Those gates remain open in TASK-0005A/TASK-0005; TASK-0006 remains blocked.

Rollback removes the run-9 profile and returns the guarded workflow to the reviewed run-8 definition. Preserve immutable run-8 and any run-9 logs; do not delete any resource whose ownership cannot be proven.
