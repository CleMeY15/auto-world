# TASK-0005 — M3 material measurements and gaps, 17 November 2026

Status: **MEASUREMENT_INDEX_ONLY / RETENTION_INCOMPLETE**. This annex records
known measurements and explicit gaps; it is not a complete retained inventory,
a capacity decision, a capture plan or operational authority. TASK-0005/0005A
remain IN_PROGRESS; 243 raw upstream blockers remain FAILED/unwaived.

## Producer and evidence

Accepted main `73ad4eddec190f3d6928f41f86c3e33858598683`, managed
[run 44191509701](https://github.com/CleMeY15/auto-world/actions/runs/44191509701),
attempt 1, artifact `14379057813`, SHA256
`d20bb1709d7c104cac13f238d3c9d1590188eafbe28a6784e4a9b6e6755d0e76`.
[PR247's final checkpoint](https://github.com/CleMeY15/auto-world/pull/247#issuecomment-6964012598)
accepts this diagnostic evidence, not service-material retention.

The original 321,625-byte `official-audit-receipt.json` has SHA256
`988d68d865ac8a21f2923aad116a485638cf0ef3911dfe0a68d5654894b549a4`.
Its measured image/source/helper records, `database-evidence.json` and
`managed-public-evidence/postgres/module-proxy-payloads.tsv` supply the rows.
The 2,164-byte database evidence SHA256 is
`76404c3a907f2c1c12b98ea01f1ad423985726a1eadae6b9e1ed72552d9adec4`;
the 613-byte module TSV SHA256 is
`03ad0bc0bd0d67837806430547ac06f0fe8034a3d31983ed6e0171f06358d9f0`.
These metadata bytes survive in the authenticated private review bundle. They
are not their described payloads. The hosted artifact expires on 1 December
2026; neither its availability nor a local metadata copy proves approved
private retention of the complete materials.

## Measured payloads

For **every row below**, supported primary-copy location, second-copy location,
post-job payload survival and retained cold restoration are **NOT_ESTABLISHED**.
Unknown does not assert absence on every uninspected filesystem. The producer
records `DISPOSABLE_RUNNER_JOB_ONLY_NOT_SUPPORTED_ARCHIVE`; module payloads are
measured in the build cache, not exported. The four diagnostic runtime cases
are a narrower same-job result, not a retained restoration. No payload was
retrieved or independently rehashed for this annex.

| Material | Representation | Bytes | SHA256 |
| --- | --- | ---: | --- |
| `postgres` | Docker-save archive | 302,396,928 | `75ddae2ca4cfc7e5a730032cc680bcf59d4649bae7d4177a640ca323310e32d6` |
| `opensearch` | Docker-save archive | 2,525,214,208 | `8e675921b8d90de61060475b32fd1da76428bba34a7907242cde8b4f8abdf470` |
| `seaweedfs` | Docker-save archive | 755,004,928 | `1732dfb443bf10196a98205f0c847c8803c079b2ba3dea84ee8d02c1a195ef4f` |
| `aws-cli` | Docker-save archive | 570,262,016 | `acb6e05eec53c6e9ec91766c9dfa0c8f5e03ef004e94019a0350ffba58be8ce1` |
| `db/trivy.db` | Extracted database | 1,756,655,616 | `2a16239b389bf61a1f7404eb61968d25e5aacfce3791196bdb22aea025259c3d` |
| `db/metadata.json` | Metadata JSON | 152 | `a079a9409ecd2ef7a7ab264054f3dddab3736ccada836d32fceb648c314ea89c` |
| `java-db/trivy-java.db` | Extracted database | 1,582,051,328 | `3f6b27d70e958150eabd8f15be93dd88d3abb3c8f4ca0efb36d410940f7876f1` |
| `java-db/metadata.json` | Metadata JSON | 153 | `de455783c08335a1122f3d767e83e9aacd1ee90f5425fb838c03f6a0475b9c0a` |
| `github.com/moby/sys/user@v0.4.1.info` | Go proxy payload | 205 | `fba02d3057df0ed2f80e3133e50e957c17465e287653245af3deb523ca1046dd` |
| `github.com/moby/sys/user@v0.4.1.mod` | Go proxy payload | 266 | `b32137c4588ee86da690b1cbdd5d6d086fb2254625893b6cb590fb2c02672cb6` |
| `github.com/moby/sys/user@v0.4.1.zip` | Go proxy payload | 22,548 | `acfdb68bda18ee112adacf55e0b20752a1f5633c55fb020f2a10a9b2eeaec46a` |
| `golang.org/x/sys@v0.1.0.info` | Go proxy payload | 188 | `9e1b3869f6fd67d974f364d46713ecc2fd8ced9fbf260ed745a83b0f21b28e8d` |
| `golang.org/x/sys@v0.1.0.mod` | Go proxy payload | 33 | `f033333096fe198f3151deed93f2deba74e50bbfe7739134045bc3b7ce4a5024` |
| `golang.org/x/sys@v0.1.0.zip` | Go proxy payload | 1,861,264 | `e7cbe58ed3745ba63d482fe82603119bd635f9a5dd914ed95a4c1826fdcf54a7` |
| `gosu-source` | Pinned source tar.gz | 18,160 | `2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51` |
| `seaweedfs-source` | Pinned source tar.gz | 81,881,370 | `d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9` |
| `seaweed-rust-volume` | Image helper binary | 40,128,576 | `48c7397e7d1802d9728ac7bdfcf30454cb6fb50bb0098b79e88f9b3eaeddc3e4` |
| `seaweed-rust-worker` | Image helper binary | 252,992,824 | `2f7bd0db4811d463f4fc7278d2a6a336e1adfcb54124ecc79b67dbcab0ba149b` |

## Origins and representation limits

The four image archives were produced by `managed_image_builds` in that run,
from the corresponding [managed Dockerfiles and immutable lock](../../infra/managed-images/lock.json).
Their archive hashes are not registry manifest digests or image config IDs.
The receipt binds complete image identities; retained subject-to-archive binding
and offline cold load remain required under the [M3 preparation contract](TASK-0005-managed-m3-preparation.md).

Database origin subjects are `ghcr.io/aquasecurity/trivy-db:2` at
`sha256:9cc5007f5c93d20dd49dd425e96a271e0048569e28f91b85e4bf18c0d556d9c9`
and `ghcr.io/aquasecurity/trivy-java-db:1` at
`sha256:80e70dba04f4e959120cb2be8deea58fe7eee2c927c33b31885a9d21ac9d1211`.
The rows are extracted payload/metadata bytes measured after `database_download`,
not compressed registry blobs.

The six Gosu module files come from the canonical `https://proxy.golang.org/`
module `/@v/` paths, measured after download/verification in
[Dockerfile.postgres](../../infra/managed-images/Dockerfile.postgres), before
its offline test/build. The [six-file plan](../../roadmap/plans/TASK-0005-managed-retention-measurement.md)
defines precisely this limited representation; it excludes extracted module
trees, `.ziphash` files and checksum-database material.

Gosu source commit `29b939aa5bd4dc588af765b8248f6e39150d2565` and Seaweed source
commit `ffa87c25fdf587178b1521ad87f2a4a72a02e584` have the pinned archive
length/checksum validated by the successful recipes. This source-bound result
is not a fresh read of surviving tarballs. Rust helper bytes were measured in
same-job stopped-container extraction from the audited Seaweed image; their
upstream origin is `chrislusf/seaweedfs`, Linux/amd64 platform digest
`sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707`.
They overlap image contents. Rust 498/590 source-package counts establish
neither complete intrinsic binary inventory nor source-to-binary equivalence.

The four image archives total **4,152,878,080 bytes**; database payloads total
**3,338,706,944 bytes**, plus **305 bytes** of metadata (152 + 153); the six module
payloads total **1,884,504 bytes**. These are separate observed subtotals, not a
combined retention budget. Overlaps, unknown closure, temporary space and at
least 25% working headroom prevent a capacity acceptance. Earlier dated values
remain historical; no live disk capacity was inspected here.

## Explicit missing closure

| Material group | Known boundary | Still required |
| --- | --- | --- |
| Redis | Pinned upstream runtime subject | Selected retained representation, size/hash, config and ordered DiffID binding |
| Bases, builders and controls | Four base identities, two builders, scanner carrier and baseline/control identities | Complete selected archives/blobs and measured retention sizes |
| OpenSearch source | Git commit `4ee42a94e87f66fbf1e62a9871b1b87f91e02472` | Complete retained Git bundle/tree representation, size and digest; no tarball inferred from Git ADD |
| Build dependency closure | Recipes/locks and selected Gosu proxy observations | Go compiler/source and remaining module closure; JDK/Gradle/plugins/resolved dependencies; OS packages and repository metadata |
| Inherited source and notices | Selected source evidence and Rust helper measurements | Complete corresponding sources/notices, intrinsic binary inventory and equivalence |
| Final evidence and provenance | Diagnostic public reports, SBOMs, native results and runtime receipts | Final registry-subject binding, retained reports and future image attestations/bundles; unknown lengths are not zero |

The exact scanner archive row is separately closed by PR247; it does not fill
these gaps or prove offline operation of the scanner with its databases.
Historic PostgreSQL archives identify different subjects and cannot fill the
current rows. Support dates stay null; no admission follows.

## Next design step

Prepare a bounded PostgreSQL/Gosu capture proposal as a candidate, not a selected
execution: define all required source/module/compiler/base representations,
producer capture before disposable teardown, binding manifests, two-copy
survival and local restoration, then missing measurements and fresh capacity.
The concrete package/workflow/permission plan requires the existing ordered
Architect/Critic review before writes. Do not revive the rejected proposal to
export Buildx cache without rebuilding. No publisher, scanner, SSH, Docker,
copy/restoration or registry operation is authorized by this index.

[Documentation validation and rollback](TASK-0005-retention-checkpoint.md).
