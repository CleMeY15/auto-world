# TASK-0005A — Executable Seaweed image transformation plan

Status: preparation under validation. No image built, executed, published or admitted.

## Scope

This increment turns [ADR-0008](../decisions/ADR-0008-seaweed-s3-derivative-profile.md)'s filesystem/configuration requirements into a bounded, executable planning contract. It uses the [exact public base metadata](../../infra/seaweed-image/README.md), a structurally validated source-material description and actual notice bytes. The source fixture used by tests is explicitly synthetic; its run and binary descriptors do not prove a real build.

The planner authenticates the manifest, config and normalized 561-entry base inventory by their fixed byte hashes and sizes. It preserves 558 original entries, replaces `usr/bin/weed`, omits `usr/bin/weed-volume` and `usr/bin/weed-worker`, and adds all enumerated notices, their index and necessary directories. It derives the expected inventory; candidate-inventory checking recomputes this expectation instead of accepting an editable plan as authority. Every path, content hash, size, type, mode, owner, symlink target and mtime must match.

The replacement executable is structurally bound by size/SHA and may not reuse any of the three old executable identities. This does not authenticate or inspect its actual bytes. A future source adapter must bind the reviewed repository/workflow/main commit/run/attempt through GitHub metadata, verify downloaded artifact identities, run `validateArtifactDirectory()` on both complete builds and independently rerun `compareBuilds()` before providing inputs to a builder. Self-reported JSON, names and structural planner validation cannot establish source acceptance.

No new workflow, permission, dependency, network client, archive parser/writer, Docker invocation or image is introduced. The small synthetic Docker diagnostic and its limits are unchanged. Results use named plan/match kinds with `authority: PREPARATION_ONLY`; they never represent source success or image admission.

## Notices

All source-collected module notices and the three fixed project/upstream notices retain their exact bytes and receive deterministic destinations below `usr/share/auto-world/seaweedfs`. The attribution index records module path/version/checksums, original archive entry, source material, destination and byte identity. It also retains the module's exact archive, module-file and metadata-file descriptors so the original archive entry remains linked to its source container. Modules without collected notices remain represented; collection is not a claim of legal completeness.

Directories are 0755 and files 0644, UID/GID 0, with source epoch `1789349515`. Existing parent directories remain unchanged. Missing bytes, changed identities, unknown material paths, duplicates, path traversal, conflicting base paths or parents, and index collisions reject. Every collected notice is retained, including the required gRPC LICENSE and NOTICE.txt. Inputs and output buffers are detached so later edits cannot silently mutate the plan.

Preparation bounds are explicit: 2,048 modules (the current source has1,159),64 notices per module,16,384 notices in total,1MiB per notice as in the source collector,512MiB total notice bytes,64MiB closure JSON and32MiB generated index. These limits do not alter the source workflow's existing resource caps. A real source set outside these preparation bounds fails; it is not silently truncated.

## Concrete configuration policy

This preparation selects only `MOBY_IMAGE_IMPORT`, Linux/amd64, classic image store, observed server version 28.0.4. Other methods, platforms, stores or server versions require a reviewed contract change. A caller-provided backend description is structural input here; the future runner must derive it from actual engine/export evidence.

Preserve `Entrypoint`, `Cmd`, the ordered `Env`, `WorkingDir`, `Volumes` and `ExposedPorts` exactly. Two independent JSON changes are explicit:

- Base `User` is absent; imported output must contain exactly `User: ""`. Missing or nonempty output fails. The image still selects no named user; the supported runtime separately imposes UID/GID 1000:1000.
- Base `ArgsEscaped` is true; output must omit it. Even explicit false fails the concrete representation contract. Moby marks this field Windows-specific and propagates it only for Windows images.

The exact neutral fields serialized by Moby's `container.Config` are also required: empty Hostname, Domainname and Image; false AttachStdin/AttachStdout/AttachStderr/Tty/OpenStdin/StdinOnce; and null OnBuild. Unknown, omitted or non-neutral fields fail. These are documented serialization additions, not values inherited from the base.

The closed new labels identify the Auto World S3 profile, recipe repository/revision/time, exact Seaweed source and patch, source run/attempt/code revision, and exact public base. There is no derivative author/vendor/aggregate-license claim. Original upstream labels remain separately in the plan's provenance, linked to the original config digest. Recipe label time is distinct from the future Docker-generated image creation/history time; no reproducible image timestamp/digest is claimed.

The top-level image contract preserves OS/architecture, removes upstream BuildKit cache metadata and replaces creation/history/rootfs. Actual exported archive linkage, closed Docker metadata/history, a single new layer, complete-stream checks and absence of old payloads remain future native validation requirements. Matching an inventory alone cannot prove these properties.

## Validation and boundaries

Tests exercise exact source metadata, public-byte mutation, filesystem omission/addition/duplicate and metadata drift, old executable retention, complete notice/index identity, configuration changes, backend substitution and input/output isolation. Root quality gates, fresh checkout and independent implementation review are required before integration; their actual results are recorded in the PR.

The separately reviewed PR37 source-copylock correction merged at `af7a6a3dcc2b7df6aa4c75946cd05007dc65f2da`. Both reviews cleared head `dd60332be15d2ace54c034054354c67b9d72235a`, preserving tree `3c4920029cc294e5ea04808c7a943d27075a9e4b`. Pinned forced local/fresh checks passed 189 root tests plus two Windows-only skips and all package gates. [Final-head CI35873544855](https://github.com/CleMeY15/auto-world/actions/runs/35873544855) and [main CI35874783081](https://github.com/CleMeY15/auto-world/actions/runs/35874783081) passed 191 root tests with no skips and all package/security gates. New attempt-1 [source run35875100636](https://github.com/CleMeY15/auto-world/actions/runs/35875100636) on that exact main is pending; these ordinary checks do not establish full source acceptance.

Construction waits for complete source acceptance and a separately reviewed concrete reader/writer/runner. Private publication retains ADR7's sequential Architect then distinct Critic review and actual package privacy/read proofs. Fresh scanner/admission gates, runtime S3 tests and complete private retention/restoration remain mandatory. The upstream Java database publisher was still `disabled_inactivity` when checked on 23 September; no stale audit was retried. TASK-0005A/0005 stay incomplete and TASK-0006 blocked.

Rollback reverts this preparation contract while preserving source/image history. It touches no service, stored object or data volume.

## Primary evidence for the explicit serialization changes

- [Moby 28.0.4 import](https://github.com/moby/moby/blob/v28.0.4/daemon/images/image_import.go): starts with an empty configuration, applies specified changes and creates new image metadata.
- [Moby 28.0.4 configuration](https://github.com/moby/moby/blob/v28.0.4/api/types/container/config.go): exact JSON fields, omission rules and Windows-specific ArgsEscaped.
- [Moby 28.0.4 container creation](https://github.com/moby/moby/blob/v28.0.4/daemon/create.go): ArgsEscaped propagation restricted to Windows.
- [Docker import reference](https://docs.docker.com/reference/cli/docker/image/import/): supported change instructions exclude ArgsEscaped.
- [Actual synthetic native proof](TASK-0005A-IMAGE-IMPORT-FIDELITY.md): Docker 28.0.4 classic import/save and the observed present-empty User; this remains synthetic method evidence.
