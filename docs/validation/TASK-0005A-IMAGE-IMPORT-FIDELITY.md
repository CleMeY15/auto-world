# TASK-0005A — Synthetic Docker import/save fidelity

Status: synthetic native import/save fidelity PASSED after the focused format correction. This diagnostic does not construct or admit a SeaweedFS image.

## Native checkpoint

[PR36](https://github.com/CleMeY15/auto-world/pull/36) corrected the exact native metadata schema and merged as `0d691f9549803c6477746d29435f5cfc5399a76a`, preserving independently approved tree `1e6ac29a1f12708985ad878dfa6c3750e5145f84`. Architect and distinct Critic approved head `d8dc7929510734666fd6ff57457364cac99bfcc6` with no findings. Forced pinned local/fresh checks pass180 root tests plus2 Windows-only skips and all package gates; [final-head CI35870395721](https://github.com/CleMeY15/auto-world/actions/runs/35870395721) and [main CI35871640366](https://github.com/CleMeY15/auto-world/actions/runs/35871640366) pass182 root tests without skips. The23 focused tests include regressions that failed before correction.

The new [native run35871640369](https://github.com/CleMeY15/auto-world/actions/runs/35871640369), attempt1 on that exact main, **PASSES all8 phases** on Docker client/server28.0.4. The exported archive is18,944 bytes, SHA-256 `299f93790bc0a9d39226ba13ef86b728426e409128132c4631a10d0257b87567`; its10 members contain the exact9-member authored filesystem. The7,168-byte layer retains DiffID `sha256:e654a92a8431f1bc550bbbbed3d7e6a96e7f862a07b27d2ab5fdad950b74687b`. The1,187-byte configuration and local image ID agree at `sha256:a1f5732aa84932b9a1c226fc7a63b64cdcf2d328fcdaa75f154d48f58f5e0952`, classified `CLASSIC_CONFIG_ID`. All content, mode, UID/GID, symlink, timestamp and closed config/history checks pass. `User` is observed as `PRESENT_EMPTY`; this observation does not authorize a future deviation from ADR-0008's concrete config contract. Exact image removal, tag/ID absence and temporary cleanup pass. No image was executed or published, and no Seaweed acceptance is established.

### Preserved first failure

[PR35](https://github.com/CleMeY15/auto-world/pull/35) merged as `5fd4927ca1e3c9fb474e2b7c1ec62d5353da1ca9`, preserving the independently approved tree `19a3d4ab3386540547f6352422f064f22adb64f0`. Final-head [CI35867603813](https://github.com/CleMeY15/auto-world/actions/runs/35867603813) and merged-main [CI35868154166](https://github.com/CleMeY15/auto-world/actions/runs/35868154166) passed179 root tests without skips and all package gates. Pinned forced local and fresh HTTPS-clone checks at `ee4d476042f1450bb6f2c29f6fee18e349147e39` passed177 root tests plus2 Windows-only skips, Secretlint240 and dependency audit.

The actual [native run35868154228](https://github.com/CleMeY15/auto-world/actions/runs/35868154228), attempt1 on that reviewed main, is **FAILED**. Docker client/server28.0.4 successfully imported and inspected the7,168-byte synthetic fixture, SHA-256 `e654a92a8431f1bc550bbbbed3d7e6a96e7f862a07b27d2ab5fdad950b74687b`; its observed DiffID is the same hash. Export verification returned `image_import_save_config_invalid`. Exact owned-image removal, absence checks and temporary cleanup all passed. The image was never executed or published. Raw archives were intentionally removed; only the sanitized receipt was retained, so the specific exported field cannot be recovered from this run.

The official Moby28 classic import source serializes `docker_version` and a neutral `container_config`, fields omitted from the initial closed validator. Source analysis identifies a deterministic incompatibility with that shape; the native failure code alone does not establish which field triggered first. The correction must admit only that specific source-established shape, retain unknown-field rejection and pass a new native diagnostic before method fidelity can be claimed.

## Purpose and scope

[ADR-0008](../decisions/ADR-0008-seaweed-s3-derivative-profile.md) requires actual filesystem and image-configuration fidelity from the selected construction method. This small diagnostic evaluates one managed Docker Engine `image import`/`image save` path using an authored public fixture. It does not consume Seaweed source, binaries, base layers or private materials. Source diagnostic35860660822 passed both complete suites but failed vet in both jobs; full source acceptance remains a separate prerequisite before actual derivative construction.

The fixture contains only short public text, directories and a symlink, with deliberately distinct modes, owners and integer mtimes. Its configured entrypoint is never executed. The diagnostic creates no container, starts no service and invokes no build, registry, package, signing or attestation operation. Buildx/BuildKit do not participate and are not prerequisites for this check.

The workflow is input-free and restricted to the exact repository's `main`, attempt1, for targeted pushes or manual dispatch. It has only `contents: read`, uses the existing pinned checkout/setup-node/artifact actions and Node22.23.2, and records observed Docker client/server versions. The daemon is the managed runner's local Unix socket; an empty owned Docker configuration directory and a small explicit environment prevent use of inherited registry credentials or remote Docker contexts.

## Evidence contract

- Before import, prove the unique run-ID tag is absent; any ambiguous Docker error fails.
- Import only the absolute path of the authored USTAR. Set explicit entrypoint, command, environment, working directory, volume, ports and ownership label, plus the fixed public import message `auto-world synthetic import fixture v1`. Do not set `USER`; record whether the exported config omits it or has an empty value, and reject a configured non-empty user.
- Establish cleanup ownership only after returned image ID, inspected ID/tag, platform, size, expected config and single-layer identity agree.
- Save locally and fully parse the archive without extracting files. Validate checksums, lengths, known header semantics, safe unique paths, allowed member types, padding, two zero end blocks and all trailing bytes.
- Accept only the reviewed OCI-layout/Docker-compatible hybrid archive family. Bind OCI index, manifest, Docker manifest, config and layer references to actual blob paths, sizes and hashes. Accept bounded raw or gzip layer bytes, verify the uncompressed DiffID and exact fixture inventory/content/metadata. Unknown representations fail instead of being ignored.
- Select the closed classic or containerd configuration schema from the archive structure. Classic requires its exact neutral `container_config`, `docker_version` equal to the observed server version, and the fixed import comment; containerd forbids those classic fields. Both require one history entry with exactly the same creation timestamp and fixed comment. The classic compatibility blob has its own exact key set, matching configuration, neutral container fields, version, timestamp and comment; parent/extra fields fail. Client version cannot substitute for server identity.
- Bind the imported/inspected local image ID to the exported config digest (classic store) or OCI manifest digest (containerd store), and record which relation actually holds. Reinspect the owned image before non-force removal, then prove both its tag and image ID absent. Failures after ownership still reach cleanup. An identity mismatch before ownership does not authorize deletion of the ambiguous object.
- Remove only the owned, unchanged temporary directory. Retain only the bounded sanitized JSON receipt; raw archives and Docker output are never public artifacts.

Budgets: fixture64KiB, saved archive4MiB, JSON config256KiB,128 archive members, combined command output1MiB,120seconds per command, seven-minute operation deadline, separate cleanup reserve ending at8.5minutes,64KiB receipt and ten-minute job. Workflow artifacts retain the receipt for14days; they are not the supported-runtime reconstruction archive.

## Verification and limits

Sequential plan review: Architect APPROVE/CLEAR, then distinct Critic APPROVE/CLEAR. Targeted adversarial tests cover malformed archives and metadata substitutions, context/permission boundaries, foreign-object preservation, sanitized command failures and cleanup after verification failure.

Implementation `79f2961cc45f771b75c368aeda67622cf26c2e24` passed forced pinned local and separate HTTPS-clone root checks:176 root passes plus2 expected Windows-only skips, all package gates, Secretlint240 and dependency audit. [Linux CI35867051389](https://github.com/CleMeY15/auto-world/actions/runs/35867051389) passed178 root tests without skips. Independent whole-change Architect review then required closing the `rootfs` object's keys; the new regression failed before the guard and passed afterward. [PR35](https://github.com/CleMeY15/auto-world/pull/35) records final distinct implementation approvals and the final-head/main quality results above. The first actual diagnostic failed as recorded; the format correction requires fresh validation, reviews and a new native run. Mocked command tests cannot establish Docker fidelity.

A native PASS proves only the observed synthetic filesystem/config behavior of the recorded Docker versions. It does not prove reproducible image timestamps/digests, BuildKit `ADD`, full Seaweed notices/base-layer transformation, actual service behavior, scanner freshness, private storage, signing or admission. The fixture's absent-versus-empty user observation does not broaden ADR-0008's future concrete recipe policy.

No source/vulnerability threshold, external fork waiver, publication control or task dependency changes. TASK-0005A/0005 remain incomplete and TASK-0006 remains blocked. Rollback disables or reverts this diagnostic; it does not touch data, existing images, retired publishers or the current source diagnostic.

## Primary references

- [Docker image import](https://docs.docker.com/reference/cli/docker/image/import/): local archive input, supported configuration changes and platform selection.
- [Docker image save](https://docs.docker.com/reference/cli/docker/image/save/): image/config/layer export.
- [Moby28.0.4 classic exporter](https://github.com/moby/moby/blob/v28.0.4/image/tarexport/save.go) and [containerd exporter adapter](https://github.com/moby/moby/blob/v28.0.4/daemon/containerd/image_exporter.go): the reviewed hybrid archive representations.
- [Moby28.0.4 containerd import](https://github.com/moby/moby/blob/v28.0.4/daemon/containerd/image_import.go): compressed stored layer versus uncompressed DiffID.
- [Moby28.0.4 classic import](https://github.com/moby/moby/blob/v28.0.4/daemon/images/image_import.go), [image structs](https://github.com/moby/moby/blob/v28.0.4/image/image.go) and [container configuration](https://github.com/moby/moby/blob/v28.0.4/api/types/container/config.go): exact imported metadata, history and zero-valued container configuration.
