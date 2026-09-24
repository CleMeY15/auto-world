# TASK-0005A — disposable host-loopback S3 diagnostic

State: PLANNED; no V6 native receipt has been accepted. TASK-0005A and TASK-0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Boundary

The next guarded `workflow_dispatch` runs once on reviewed protected `main`, on a GitHub-hosted Linux runner with pinned Docker and Node versions. It constructs a fresh local SeaweedFS derivative candidate, opens only container S3 port 8333 on an ephemeral host port bound to IPv4 `127.0.0.1`, probes that route from the host, then removes the owned container, candidate image and temporary material. It writes no package, Actions artifact or production state. Its `publication: NOT_ATTEMPTED` field refers to registry publication; this diagnostic does temporarily publish the S3 socket to the runner's loopback interface.

The [ADR-0008 profile](../decisions/ADR-0008-seaweed-s3-derivative-profile.md) requires localhost-only S3 exposure. The earlier [V5 diagnostic](TASK-0005A-SEAWEED-BACKUP-RESTORE-DIAGNOSTIC.md) verified backup and isolated restore for another disposed candidate image. That historical success cannot be inherited as a V6 check. The user-skipped external authenticated fork access test remains `SKIPPED_BY_USER` and is outside this run.

## Run-12 acceptance contract

1. Require the exact protected repository, workflow, `main` ref, GitHub-hosted runner, run number 12, attempt 1, code revision and pinned Docker server before candidate materialization. Run with read-only GitHub permissions and no new secret or token scope.
2. Start one candidate container with the fixed UID/GID `1000:1000`, resource and filesystem restrictions, bridge networking, and Docker's ephemeral `127.0.0.1::8333/tcp` binding. Inspect the actual container and Docker port mapping. Reject a wildcard/IPv6 bind, fixed host port, extra published port, changed bridge attachment, unexpected privilege or unproven image/container identity.
3. Send requests from host Node to `127.0.0.1` and the inspected ephemeral port, not from `docker exec`. Require readiness HTTP 200, anonymous object access HTTP 403, a valid signed bucket/object create and conditional PUT/GET with matching SHA-256, a wrong-secret HTTP 403, and a repeated conditional write HTTP 412.
4. Stop within the fixed grace period, require zero exit status, prove the host port no longer accepts requests, and remove only the exactly owned container. Reject a success proof on identity drift or uncertain cleanup. Remove the candidate image and temporary files under the existing outer ownership checks.
5. Emit one bounded `SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V6/VERIFIED/DIAGNOSTIC_ONLY/NOT_AUTHORIZED` only after the nested host-loopback proof and all cleanup pass. Keep `vulnerabilityAudit` and `admission` at `NOT_ATTEMPTED`; retain fixed public failure phase/reason without credentials, raw paths or the chosen port.

This is one host-to-container path on one ephemeral runner. Docker bridge networking is necessary for the port mapping; it does not prove that the container lacked other egress routes or that no other local container could address it directly. The test does not prove the fixed production host port 9000, remote network policy, every S3 operation, cross-host recovery, a fresh image vulnerability/SBOM audit, package privacy or four-service lifecycle acceptance.

Rollback removes the guarded run-12 diagnostic code and restores the last reviewed workflow definition; it does not alter the immutable earlier run results. Never force removal of a Docker resource whose identity is uncertain.
