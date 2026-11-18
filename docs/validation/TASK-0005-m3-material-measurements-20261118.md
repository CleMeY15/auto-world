# TASK-0005 — M3 observations, 18 November 2026

Status: **MEASUREMENT_INDEX_ONLY / RETENTION_INCOMPLETE**; part of a PLAN_REVIEWED / DOCUMENTATION_DELIVERY_PENDING proposal. TASK-0005/0005A stay IN_PROGRESS. Preserve the [17 November annex](TASK-0005-m3-material-measurements-20261117.md) separately; these values do not update its subjects in place.

## Producer and surviving evidence

[PR250's body checkpoint](https://github.com/CleMeY15/auto-world/pull/250) accepts diagnostic implementation on main `0c2b3d6c1e67c665f7cd1718f18703baf673409e`, same tree `5315861787a641cc8f7d2d15edf7d6005a943478` as source `2d204d5222a1a3832697752a49bbd05bc9394120`. Original managed [run44249041549](https://github.com/CleMeY15/auto-world/actions/runs/44249041549), attempt1, artifact14405841699, SHA256 `4d5b90d3659593e8cbadd92adda1c74a2f5026b8d33c2b5e8c65b52fc1933fd2`. Artifact expiry2026-12-02 is not a retention commitment.

The managed run’s original `official-audit-receipt.json` (323,937 bytes, SHA256 `d72858dc0455c196f4bf89a4da29f9b196969eeb938a61fdaf66f49968e18c40`) records the Docker-save archive sizes and hashes under `/builds/*/subject` and the six proxy file measurements under `/builds/0/gosuModulePayloads/files`. Database file sizes and hashes come from `/files` in the original `database-evidence.json`.

For the `gosu-source` row, the PR250 lockfile pins the archive length at **18,160 bytes** under `/gosu/archiveBytes`. The build checks that length on the downloaded tarball and the offline reconstruction checks it again on its input. The managed receipt records the source SHA256 under `/builds/0/gosuSourceEvidence/sourceArchiveSha256`. The adjacent `archiveBytes` value of **302,396,416** belongs to the PostgreSQL Docker-save archive. [PR250 lockfile](https://github.com/CleMeY15/auto-world/blob/2d204d5222a1a3832697752a49bbd05bc9394120/infra/managed-images/lock.json#L44) · [Download length check](https://github.com/CleMeY15/auto-world/blob/2d204d5222a1a3832697752a49bbd05bc9394120/infra/managed-images/Dockerfile.postgres#L12) · [Offline reconstruction length check](https://github.com/CleMeY15/auto-world/blob/2d204d5222a1a3832697752a49bbd05bc9394120/infra/managed-images/postgres/gosu-offline-reconstruction.sh#L92)

Runtime trace1201 bytes SHA256 `d4a9c96ee0160992ff85c5832d9b174e704831a4e0acdb987814645f33ef6053` binds command25, first runtime, four ordered markers/DONE without CACHED. Offline receipt751 bytes SHA256 `7d7584cbca9f3ffec9bb93707c85660592f5e3650e2603e85f6dfff7f731adf6`; six-row TSV613 bytes SHA256 `03ad0bc0bd0d67837806430547ac06f0fe8034a3d31983ed6e0171f06358d9f0`. These metadata bytes survive and were rehashed, not the described binaries. First runtime trace and later evidence solve are distinct.

## Original job measurements

Every payload below has post-job survival, primary-copy/second-copy location and retained restoration **NOT_ESTABLISHED** in inspected evidence. Unknown never means zero or absence everywhere. Producer retention is `DISPOSABLE_RUNNER_JOB_ONLY_NOT_SUPPORTED_ARCHIVE`.

| Role | Bytes observed | SHA256 observed |
| --- | ---: | --- |
| `gosu-source` | 18160 | `2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51` |
| `gosu-proxy/github.com/moby/sys/user/@v/v0.4.1.info` | 205 | `fba02d3057df0ed2f80e3133e50e957c17465e287653245af3deb523ca1046dd` |
| `gosu-proxy/github.com/moby/sys/user/@v/v0.4.1.mod` | 266 | `b32137c4588ee86da690b1cbdd5d6d086fb2254625893b6cb590fb2c02672cb6` |
| `gosu-proxy/github.com/moby/sys/user/@v/v0.4.1.zip` | 22548 | `acfdb68bda18ee112adacf55e0b20752a1f5633c55fb020f2a10a9b2eeaec46a` |
| `gosu-proxy/golang.org/x/sys/@v/v0.1.0.info` | 188 | `9e1b3869f6fd67d974f364d46713ecc2fd8ced9fbf260ed745a83b0f21b28e8d` |
| `gosu-proxy/golang.org/x/sys/@v/v0.1.0.mod` | 33 | `f033333096fe198f3151deed93f2deba74e50bbfe7739134045bc3b7ce4a5024` |
| `gosu-proxy/golang.org/x/sys/@v/v0.1.0.zip` | 1861264 | `e7cbe58ed3745ba63d482fe82603119bd635f9a5dd914ed95a4c1826fdcf54a7` |
| `runtime-archive/postgres` | 302396416 | `e9b6b6ed79188545c71eaadaadafeba99aa0a444d787b4ff58723f7ec8ab8af7` |
| `runtime-archive/opensearch` | 2513819136 | `a579e4e8c31daa422cb2d720f23f67e19b6aba21abeeccd1bd7eef0bb06911b4` |
| `runtime-archive/aws-cli` | 559287808 | `d7e5dab02d2808c48b1c6447c38446dbce78f124f180e72f50d01dc42e4f1ab0` |
| `runtime-archive/seaweedfs` | 755002368 | `78db14eaf63ba45de6c5e9a1a5507004ebf6cf92e21bd9edf2970b9c2b83f02b` |
| `db/trivy.db` | 1756655616 | `2a16239b389bf61a1f7404eb61968d25e5aacfce3791196bdb22aea025259c3d` |
| `db/metadata.json` | 153 | `e70352f4a75df2f2be4b396d25b40f89db0c2b10502fe82a2c39b061eee629a7` |
| `java-db/trivy-java.db` | 1582481408 | `a41f53b9b2b3d57ef45aeda3abd8f03dc17dfcacc5aaec277600218919de5e15` |
| `java-db/metadata.json` | 153 | `b2994c22596e6072278cbfaca877c421db9d7f11f538fe55c547e1c88348b517` |

Separate observed subtotals: seven Gosu data files **1902664 bytes** =18160+1884504; four Docker-save archives **4130505728 bytes**; two extracted DBs **3339137024 bytes**, plus **306 bytes** metadata. No combined retention budget is calculated.

Gosu origin: pinned codeload archive at commit29b939aa5bd4dc588af765b8248f6e39150d2565 and canonical proxy.golang.org paths for moby/sys/user@v0.4.1 and x/sys@v0.1.0. Runtime archives: managed recipes/lock, local image IDs, not authenticated final registry subjects. PostgreSQL image ID `sha256:eb23cee4cc604fc983780cab296ea50cbf976bc52d9bd2a4f9a72ce9cf3042ca`; its inspection retains14 ordered DiffIDs, not a complete raw registry config blob.

DB origins: `ghcr.io/aquasecurity/trivy-db:2` manifest `sha256:9cc5007f5c93d20dd49dd425e96a271e0048569e28f91b85e4bf18c0d556d9c9`; `ghcr.io/aquasecurity/trivy-java-db:1` manifest `sha256:fbc1d1ae10f04f777a4228bc595485853e4d2add4a018002466cb82da32ac808`. Original before/after subjects match. Their manifests respectively describe compressed blobs140470960 bytes/SHA256 `e187b4e7f415f504641878bab2f807fb7ef337cafdd6eb6b76784c8e5862b412` and1001477787 bytes/SHA256 `5f7b28736260b7d97f7972c7a498c628ac9a3b4ae5320bf391de19ba79efab28`. Descriptor sizes/hashes are statically available; blob bytes were not retrieved/rehashed. They are distinct from extracted DBs and not added to a capacity total.

## Missing closure and next gate

The seven data files are sufficient only with supplied compiler, recipes, references and binary. Go builder `library/golang@sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747`, PostgreSQL base `postgres@sha256:005c5c37db96c1e6652a79ea31f9886402fba81ac95dc2db897739121dd7f8f2` and reference binary SHA256 `8c12961ed59dc9c662d5b5150a8f8e7ab66ef59d5796a0abdb8778b885247b8e` are known identities. Their retained sizes/material closure are not established. Recipe bytes/mod/sum/helper and selected notices can be rehashed at the PR250 preparation commit `2d204d52`; complete compiler/OS/inherited sources, Redis/other services/dependencies/Rust remain open.

The [candidate capture plan](../../roadmap/plans/TASK-0005-postgres-gosu-material-capture.md) separates initial in-job measurement, complete inventory, reviewed package/permissions, two copies and second-copy-only offline restore. Scanner retention remains accepted only in its PR247 scope. C:/NTFS capacity requires all retained members, demonstrated overlaps, concurrent staging/download/extraction/verifier/cold-load peaks and at least25% margin, then fresh free space before copy. The old25400635392-byte observation is not current capacity. Raw243 stays FAILED on0c2b; upstream remediation observations require separate subject/date binding. No operation authorized by this annex.
