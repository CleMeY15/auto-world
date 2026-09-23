# ADR-0008 — Bounded SeaweedFS S3 derivative profile

Status: Accepted profile contract after sequential independent Architect and distinct Critic approval. No image construction, publication or admission is authorized by this documentation increment alone.
Date: 2026-09-23
Scope: Linux/amd64 storage image for TASK-0005's existing local/CI S3 service.

## Context

The [verified public image inventory](../validation/TASK-0005A-SEAWEED-IMAGE-INVENTORY.md) establishes three real executables in the pinned SeaweedFS 4.47 image. The Go binary has a source correction under validation. The two Rust helpers have neither of the embedded dependency sections consumed by the pinned scanner; the historical report does not establish their coverage. The exact-public-subject guard introduced by PR32 must remain in place.

TASK-0005 invokes the Go `server` command. In [the exact source entrypoint](https://github.com/seaweedfs/seaweedfs/blob/c5073360007d28385a33426a42ac3e4ec504c5a3/docker/entrypoint.sh), the `volume-rust` and `worker-rust` branches invoke the separate helpers; the `server` branch invokes `weed`. The Go server starts the master, Go volume server, filer and S3 components in-process. This source analysis supports a restricted profile; it does not replace runtime proof of the resulting image.

Source diagnostic [35860660822](https://github.com/CleMeY15/auto-world/actions/runs/35860660822), attempt 1 at reviewed main `184f25ffbe4235c9c7df5301a5358919d9e752cf`, failed after both complete normal/full-tag suites and required project gRPC tests passed: both jobs report18 identical `go vet` copy-lock findings. See the [source evidence](../validation/TASK-0005A-SEAWEED-SOURCE.md). PR33's ordinary quality checks and these passed suites do not establish source acceptance. No candidate has been built or published.

## Decision

Define a distinct derivative intended only for the existing Go server/S3 runtime. Its source, build and image lineage must be explicit. Do not present it as a complete replacement for every upstream SeaweedFS distribution or command.

Use these immutable inputs, with actual byte verification:

- Public repository `chrislusf/seaweedfs`, Linux/amd64 platform manifest `sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362`, configuration `sha256:31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927`. The manifest's ten compressed layer descriptors and configuration DiffIDs remain part of the retained input closure.
- Seaweed source `c5073360007d28385a33426a42ac3e4ec504c5a3`, the compiler/patch/module identities in the reviewed `infra/seaweed/seaweed-lock.json`, and derivative marker `c507336+aw.3930d2fef5a7`. The current observed binary hash is historical until the complete native diagnostic passes.
- One complete retained artifact from a successful reviewed source run, its independent comparison and both successful build receipts. Bind expected repository, workflow, code SHA, run ID, attempt and material identities through trusted reviewed policy; artifact names or self-reported JSON alone are insufficient.

Construct a flattened root filesystem from the exact base. Apply only this reviewed change set:

1. Replace `/usr/bin/weed` with the accepted corrected executable. Keep its path, regular-file type, mode `0755` and UID/GID `0:0`; set its packaging mtime to the locked source commit time and record that intentional metadata change separately from the actual build time.
2. Omit `/usr/bin/weed-volume` and `/usr/bin/weed-worker`. These are explicit unsupported components of this derivative. Do not merely whiteout them above still-referenced layers.
3. Add `/usr/share/auto-world/seaweedfs/` for exact accepted source-artifact bytes: `materials/DERIVATIVE-NOTICE.txt`, upstream Seaweed `LICENSE` and `weed/glog/LICENSE`, and every notice listed in `module-closure.json[*].notices`, including the required gRPC LICENSE/NOTICE. Add a deterministic attribution index recording module path/version/sum/goModSum, original `archiveEntry`, destination, SHA-256 and byte count; upstream/project notices carry their material path and byte identity. Permit only the necessary new parent-directory entries, mode `0755`, UID/GID `0:0`; notice/index files are regular `0644` files. Use the locked source commit time for their packaging mtimes. Any pre-existing collision fails; it does not authorize overwriting an upstream path. Full compiler/source/module archives stay in the separately retained reconstruction closure. This preserves the source collector's actual notice set; its basename-based discovery does not establish legal completeness or licence compliance.

Preserve every other visible upstream path, content, type, mode, UID/GID, symlink target and mtime. Reject unknown or ambiguous archive semantics instead of guessing. The current inspected base has no whiteouts, hardlinks, devices, capabilities or xattrs; that observation is not permission to ignore such entries in different bytes. Reject an unexpected input inventory or metadata feature before materialization.

The final inventory therefore contains `561 - 2 + N` entries, where `N` is the exact approved set of new notice/index files and directory entries; 558 original entries remain unchanged, and `weed` is the one replacement. Do not keep a fixed pre-notice output count or omit parent directories from the comparison.

The final image must reference only newly constructed layers. It must not reference any original base layer or retain the original `weed`, `weed-volume` or `weed-worker` file payloads in a lower layer, renamed member or appended archive data. Verify complete layer streams and their merged inventory, including trailing content and duplicate members; inspecting only the visible final paths is insufficient. Do not claim absence of coincidentally shared instruction/string sequences: the requirement concerns retained old executable payloads and filesystem members.

Keep the reviewed upstream runtime configuration: `/entrypoint.sh`, default command `mini -dir=/data`, PATH environment, working directory and declared volume `/data`, and the exact exposed-port set. The base omits `User`; do not silently convert the image to a different default user. Preserve runtime-relevant config fields, rejecting unreviewed differences. New creation/history/provenance metadata must identify the derivative and actual recipe/build; it must not falsely attribute the new image to the upstream publisher. Record the complete expected config and allowed metadata changes in the concrete implementation review.

No build mechanism is declared proven by this ADR. The implementation must select and review the exact managed Docker/BuildKit/import path, show that it satisfies the filesystem/config contract, and test the actual exported image. A successful import or `COPY` command alone does not prove metadata fidelity or removal of historical layer content.

## Supported runtime and acceptance

The admitted TASK-0005 entrypoint remains the fixed server profile:

```text
server -dir=/data -master.telemetry=false -s3 -s3.port=8333 -s3.port.iceberg=0 -s3.port.lance=0 -s3.config=/run/aw-private/s3.json
```

Run as UID/GID `1000:1000`, with the existing `0600` private configuration and internal health service on 9333. Publish S3 only on host `127.0.0.1`, targeting container port 8333; the existing local host default is 9000, while CI selects an ephemeral host port. Preserve the limits of 768 MiB, 0.75 CPU, 512 PIDs and 30-second stop grace. These values come from the unmerged PR7 reference at `31a4a2434d28d2bcb5f1ad2dba3904728e706a1b`, not a newly accepted runtime. Retain its owned-volume/reset/restore safeguards. No topology, production source, public exposure or credential design changes are introduced.

Require actual evidence on the exact candidate digest for:

- Cold start, readiness, the expected derivative version, disabled Iceberg/Lance listeners and bounded shutdown.
- Missing/wrong credentials rejected, allowed `aw-raw` operations, forbidden scope rejected, conditional writes/conflicts and concurrent-write behavior.
- Restart persistence, backup and isolated restore, with no access to foreign volumes or data.
- Both Rust executable paths absent and direct `volume-rust`/`worker-rust` invocations failing without a download/fallback. Supported startup always selects the fixed server profile, not the preserved upstream default command.
- Full filesystem/config comparison against the explicit change set, exact binary identity, notices/index integrity, and complete scanner/SBOM inventory of the resulting image.

Existing PR7 evidence does not yet prove every derivative requirement above. Its implementation has the private-file mode and disabled-listener flags, but lacks exact runtime mode and listener-absence probes, a real forbidden-bucket/operation control, and static assertions locking the complete command/healthcheck/resource values. Add these controls in the concrete runtime implementation; do not relabel existing partial evidence as their success.

The known inventory guard for the old public digest stays unchanged. Define the new profile's exact-subject coverage requirements explicitly from its actual filesystem; deleting old expectations or renaming a role must not hide an executable still present. Fresh complete scans and all existing vulnerability thresholds apply to every actual service/helper image. An absent Rust helper is not a passed Rust vulnerability scan.

## Sequence, authority and retention

This contract can be reviewed while source testing is in progress. Image construction waits for both complete source builds, required suites/materials and independent comparison to pass. A failed source diagnostic remains a failure and cannot be replaced by quality CI, partial suites or matching binaries alone.

After source acceptance, a concrete recipe/workflow implementation needs its own tests and independent implementation review. Any registry write additionally requires [ADR-0007](ADR-0007-private-image-admission.md)'s sequential Architect then distinct Critic approval of the exact package/workflow/credential/retention plan. Use only already-public software and non-sensitive technical material. No new service/account, token expansion, OIDC/signing capability or package write is added here.

Harmless bootstrap, actual private Settings, anonymous denial and authorized remote retrieval remain prerequisites before candidate layers reach a package. The external fork probe remains `SKIPPED_BY_USER`; its boundary is `NOT_VERIFIED`, and no second account is required. A prior proof for another package is not evidence for a newly created package.

Private unadmitted staging may precede final image audits under the separately approved ADR7 plan. Database freshness is required at actual scans, signing/admission and supported use; it does not prohibit ordinary recipe design or separately authorized unadmitted staging. The current stale Java database still blocks fresh audit/admission. Nothing here relaxes that gate or changes database timestamps.

Keep the full private image/source/compiler/module/notices/recipe/SBOM/report/attestation closure for supported life plus 365 days, establish the second private local copy and demonstrate restoration before activation. Private layers and archives never become public Actions artifacts. This ADR records a preparation direction, not an admitted image, an immutable archive guarantee, or completion of TASK-0005A/0005. TASK-0006 remains blocked until the four-service acceptance succeeds on admitted images.

## Alternatives and consequences

Waiting for a clean, fully inventoried upstream image remains an option if fresh exact-subject audits pass. Keeping both current Rust helpers would require establishing their actual dependency/compiler/licence provenance and usable inventory; source analysis or a separate Cargo.lock cannot bind that evidence to their current executable bytes. Rebuilding a Rust toolchain/helper stack would broaden the current scope without serving TASK-0005's selected runtime.

An overlay that replaces only the visible `weed` path retains old executable bytes in referenced layers. Generic extraction/import without inventory verification can change ownership, links, timestamps or configuration. Neither satisfies this contract.

The derivative gives up the two Rust command paths and establishes an ongoing recipe/source/notice maintenance obligation. It does not claim that every upstream Go command or optional backend is tested. Runtime support remains the fixed S3 profile and the evidence actually collected.

## Rollback

Before admission, revert or disable the preparation implementation while preserving candidate objects and historical evidence. After admission, revert only to another fully valid supported digest or stop the affected service. Never fall back to the vulnerable original pin, delete service data, remove backups or erase a failed diagnostic to undo this decision.
