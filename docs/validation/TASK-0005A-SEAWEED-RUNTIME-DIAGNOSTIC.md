# TASK-0005A — Isolated SeaweedFS runtime diagnostic

Status: implementation under review; no native runtime receipt has been accepted. TASK-0005A and TASK-0005 remain IN_PROGRESS, and TASK-0006 remains blocked.

## Boundary

The existing [local candidate proof](TASK-0005A-SEAWEED-LOCAL-CANDIDATE.md) authenticates construction and export, then disposes the image. This separate, one-time diagnostic reconstructs the candidate from the same reviewed source and base inputs, verifies its saved archive, and starts **that run's newly owned image ID** before disposal. The historical construction diagnostic retains `imageExecution: NOT_ATTEMPTED`; neither its run-3 image ID nor its archive is reused.

The runtime starts only on a fresh GitHub-hosted Ubuntu runner under Docker 28.0.4, on protected main, first workflow run and first attempt. Repository and Actions permissions are read-only. No port is published, no image or evidence archive is uploaded, and no registry write occurs. The container has no network except loopback, a read-only root filesystem, UID/GID `1000:1000`, no Linux capabilities, `no-new-privileges`, a private writable `/data` tmpfs, and the existing 768 MiB, 0.75 CPU, 512 PID and 30-second stop limits. The synthetic S3 configuration is restricted to this disposable diagnostic and must be mode `0600`.

The fixed command is ADR-0008's Go server/S3 profile. The diagnostic checks the derivative version, PID-1 identity, internal master readiness on 9333, S3's anonymous rejection on 8333, absence of Iceberg/Lance listeners on 8181/9101, absence and failed direct invocation of both unsupported Rust helpers, and bounded shutdown. The container, runtime configuration, image, saved archive, rootfs and temporary directories must be cleaned before a success receipt. A random per-run label and image-ID inspection recover ownership even if Docker creates a container but loses its command response; a foreign or uncertain container is preserved and blocks success. Public diagnostic output contains only fixed phase/result/reason, bounded duration, run/revision identifiers and an image hash when known; it never includes raw Docker output or the synthetic credential. A failure or uncertain cleanup does not authorize a retry that bypasses a control.

Any successful receipt is `SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V1/VERIFIED/DIAGNOSTIC_ONLY/NOT_AUTHORIZED`, with `imageExecution: VERIFIED_DIAGNOSTIC` and publication, vulnerability audit and admission each `NOT_ATTEMPTED`. It is evidence only for the image ID reconstructed during that run. The exact candidate digest must be retested before supported use.

## Remaining acceptance

This diagnostic cannot prove host-loopback publication while Docker networking is disabled. It does not prove valid signed S3 operations, forbidden scope, conditional or concurrent writes, persistence, restart, backup or restore. Those ADR-0008 controls and fresh complete SBOM/vulnerability audits remain prerequisites for private admission. The scanner's Java database freshness gate is unresolved. The external fork access test is `SKIPPED_BY_USER` and its boundary remains `NOT_VERIFIED`.

Record the implementation PR, exact-head and protected-main CI, independent reviews, native run result and cleanup evidence here after they occur. A green ordinary quality workflow alone is not a native runtime proof.

Rollback reverts the diagnostic code and one-time workflow. It changes no retained image, registry object, persistent volume or production service.
