# TASK-0005A — SeaweedFS public image inventory

Status: public byte inventory verified on 2026-09-23; corrected image not built or admitted.
Scope: the existing Linux/amd64 SeaweedFS 4.47 diagnostic pin in `infra/scanner/scanner-lock.json`.

## Implementation plan

Record the exact public filesystem and the scanner's coverage boundary before selecting the corrected-image recipe. Preserve the distinction between a valid report for detected packages and complete image inventory. This increment introduces no image execution, registry write, source acceptance or admission. [ADR-0007](../decisions/ADR-0007-private-image-admission.md) and [TASK-0005A](../../roadmap/tasks/TASK-0005A-managed-image-tooling.md) retain their existing gates.

## Exact public subject

Repository: `chrislusf/seaweedfs`.

| Object | SHA-256 | Bytes |
| --- | --- | ---: |
| Multi-platform manifest | `ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882` | 1,212 |
| Linux/amd64 manifest | `f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362` | 2,193 |
| Image configuration | `31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927` | 13,676 |

The index contains four ordinary platform descriptors, with no attestation descriptor. This observation does not prove that no separate upstream provenance exists.

A bounded standard-library inspection fetched the ten public blobs using an anonymous pull token held only in memory. Authorization was removed on each cross-origin redirect. It verified every compressed descriptor size/SHA-256 and every complete decompressed stream against its configuration DiffID. It performed no filesystem extraction, executable launch, image build or registry write.

The ten blobs total 195,224,300 compressed bytes and 532,811,776 decompressed bytes. The inspection limits were 256 MiB compressed, 2 GiB decompressed and 100,000 tar entries. There are 609 layer entries; a conservative merge produced 561 visible entries without an ambiguous collision or link traversal. No whiteout, PAX xattr, capability or device entry was found. A separate verification recomputed all ten compressed hashes, all ten DiffIDs, totals and target identities successfully.

## Executables present in the exact bytes

All three paths are regular ELF64 little-endian x86-64 files, mode `0755`, UID/GID `0:0`. The layer index is zero-based.

| Path | Layer | ELF type | Bytes | SHA-256 |
| --- | ---: | --- | ---: | --- |
| `/usr/bin/weed` | 1 | EXEC | 220,182,163 | `dc7f0bd80235fa27dcaa19bfe13e37f4b7fc27c9f26e0153fc58f2bc7489f41d` |
| `/usr/bin/weed-volume` | 2 | DYN | 38,964,128 | `b2f00d79b4052e75c2b0dbe256283438c04a2fea6f3e12459b0d6d646bc90ad5` |
| `/usr/bin/weed-worker` | 3 | DYN | 252,634,984 | `163eef53fc85a2074e2cd5eb980b902b30a2e766b2f3c189ac60180cce46931e` |

Neither Rust helper is an empty placeholder in this image. File hashes and ELF headers establish byte identity, not compiler, dependency versions, build flags, licences or provenance.

The image config omits `User`; the local Compose `1000:1000` requirement is separate. Its entrypoint is `/entrypoint.sh`, command `mini -dir=/data`, working directory and declared volume `/data`, and environment contains PATH. A future replacement must explicitly assess filesystem and configuration changes; a layer placed over the old Go binary still retains the old bytes in a referenced lower layer.

## Rust coverage boundary

At pinned Trivy source `e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994`, [Rust binary coverage](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/docs/guide/coverage/language/rust.md) depends on embedded cargo-auditable metadata. The [analyzer](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/fanal/analyzer/language/rust/binary/binary.go) returns no result for an executable without recognized Rust audit information. An ordinary ELF header therefore does not establish Rust dependency coverage.

The [binary parser](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/dependency/parser/rust/binary/parse.go) obtains package versions from embedded metadata. A separate Cargo.lock analysis does not itself bind those versions to the executable shipped in an image. A separately supplied SBOM likewise needs an established relationship to those bytes.

A bounded read of the exact tar members verified each target's hash again and validated its complete ELF section table. `weed` has 26 sections; `weed-volume` and `weed-worker` each have 28. Neither `.dep-v0` nor the legacy `.rust-deps-v0` section is present in any of the three. Those are the sections consumed by the pinned [go-rustaudit reader](https://github.com/rust-secure-code/go-rustaudit/blob/e20ec32e963c/rustaudit.go). This extraction path cannot inventory the two helpers' Rust dependencies. That absence does not mean the binaries have no dependencies or vulnerabilities.

Trivy's [JSON result construction](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/scan/langpkg/scan.go#L52-L59) uses the file path as `Target`, `lang-pkgs` as `Class`, and the analyzer's language type as `Type`; a display suffix must not be appended to the JSON target expectation. The [exact type constant](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/fanal/types/const.go) is `rustbinary`, without a hyphen. A matching nonempty result would establish detected embedded dependency inventory, not independently prove compiler provenance or all statically linked native libraries.

The historical [main diagnostic34854648529](https://github.com/CleMeY15/auto-world/actions/runs/34854648529) contains Alpine packages and `usr/bin/weed`, but no Rust-helper target. Its structural report checks and recorded vulnerability counts remain historical facts. They must not be described as complete coverage of the two helpers.

## Exact-subject regression guard

[PR32](https://github.com/CleMeY15/auto-world/pull/32) requires a valid nonempty `lang-pkgs` result for each of the three executable paths, with `gobinary` for `weed` and `rustbinary` for both helpers. Expectations bind to the inventoried platform digest, independent of role or tag. A missing triplet adds `image_inventory_incomplete` while retaining existing vulnerability findings; the collector preserves the report identity, rejects that subject and continues other independent scans. A Cargo.lock, another executable or the wrong analyzer cannot satisfy a binary expectation. Other image digests retain their existing policy; this is a bounded known-gap correction, not a universal inventory-completeness proof.

The five new regressions all failed before the correction. The targeted coverage, policy and collector set then passed 38 tests. Their complete-inventory positive controls are explicitly synthetic report shapes, not a claim that these immutable uninstrumented Rust binaries can produce such a report.

The unmodified historical report is 214,304 bytes, SHA-256 `cc6da1d8e2a67b22d49ab18ff4b8d87d2c1b75456181d11c765dda3bd2744647`, created `2026-09-14T14:33:19.475181162Z`. Re-evaluation at its historical creation time retains the same one vulnerability and adds exactly two missing-inventory blockers. The input bytes and original finding are unchanged. This is a policy regression check, not a fresh scan, a changed database timestamp or permission to use historical evidence for admission.

## Preserved evidence and remaining boundary

Ignored local evidence retains exact manifests/configuration, all ten blobs, per-layer headers/content hashes, merged inventory, target identities and the inspection source. The evidence is public upstream software and technical diagnostics only. This local inspection is not a supported private archive, restoration proof or reproducible candidate build.

The [source diagnostic](TASK-0005A-SEAWEED-SOURCE.md) still requires its complete independent build/test/comparison result. The [scanner evidence](TASK-0005A-SCANNER.md) separately records rejection of the stale Java database on 23 September; no fresh candidate audit is available from those failed runs. Source success alone cannot resolve either Rust inventory or database freshness.

Any corrected-image recipe remains subject to explicit review, complete inventory and fresh exact-subject audit, runtime S3 checks, the four-service lifecycle, and ADR-0007's private publication, retention, restore and admission controls. Removing a helper would be an explicit recipe decision with runtime evidence, never an inferred consequence of its missing scanner result. TASK-0005A and TASK-0005 remain incomplete; TASK-0006 remains blocked.
