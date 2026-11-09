# TASK-0005 — Official Trivy 0.76.2 refresh

Date: 2026-11-09. Status: LOCAL_VALIDATED_CI_PENDING; scanner fitness and current image results pending.

## Scope and implementation plan

The user explicitly requested this bounded official scanner update in parallel with prototype development. This resumes only the Trivy qualification lane deferred by ADR-0028. It does not make image qualification a prerequisite for the synthetic prototype, restart the custom scanner or Windows bootstrap, or authorize image publication, admission, production or real data. The dedicated branch starts from accepted main `293a218c0750ee693ad1c426e91629816cfa238d`.

1. Receive the official Linux64 archive and verify its exact bytes, GitHub SLSA provenance, source/tag/workflow and certificate identity with existing `gh`; retain four actual refusal controls and a final positive verification.
2. Measure the extracted binary and its complete standard Go inventory without executing Trivy. Update only the current official profile, its manifest and necessary tests. Keep historical manifests, fixtures, reports and failures unchanged.
3. Run affected native regressions and normal quality checks. Obtain independent implementation/security review before the existing Linux diagnostic workflows execute the changed scanner.
4. Reuse those workflows for current databases, scanner self-audit, known vulnerable/clean fixtures and baseline comparison, then the original five service/helper reports. Keep managed builder/image diagnostics conditional on their existing gates. Report exact remaining findings separately from scanner qualification.
5. Deliver a focused PR with source/main evidence when applicable gates pass. A failed security diagnostic stays failed; a version update alone never completes TASK-0005.

## Official release and received material

The [official v0.76.2 release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2) was published on 2026-11-05 at 12:50:25 UTC. Its source is `3f6334d223b52188324af3b9923b4249cd206652`. The release raises `golang.org/x/net` to `v0.62.0` and `github.com/go-jose/go-jose/v4` to `v4.1.6`. Its container Alpine update does not establish remediation of any separate service image.

| Received material | Bytes | SHA-256 |
| --- | ---: | --- |
| `trivy_0.76.2_Linux-64bit.tar.gz` | 52,714,130 | `bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf` |
| Extracted Linux64 `trivy` | 176,386,208 | `6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3` |
| Original `go version -m /input/trivy` output | 37,019 | `a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b` |

The downloaded checksum manifest has SHA-256 `802e4ac1418ed967cd3c4b901f4f71ca00b7363ede67778665a22d9f13f58c83`; its Linux64 entry matches the received archive. Existing `gh 2.98.0` verifies the release workflow, exact source/tag and certificate identity with self-hosted runners refused. The original GitHub attestations API response and verification outputs are retained locally. The JSONL bundle is a serialization of the API-returned bundles, then independently verified by `gh`, not a separately downloaded original byte stream.

All four actual negative controls refuse with exit 1 and their expected verification errors: changed archive bytes, wrong source revision, wrong workflow identity and wrong tag reference. The original archive verifies again afterward. These provenance checks establish no scanner fitness or image vulnerability result.

Standard inert inventory was obtained with the already-present Go image, platform digest `sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747`, matching the existing managed-image lock. The disposable container used no network, a read-only root and binary mount, UID/GID 1000, no capabilities, no-new-privileges and bounded resources. Its removal was observed. No Trivy execution or current security qualification of that historical Go image is inferred from this metadata observation; Linux CI independently repeats standard inventory capture.

The actual binary reports Go `1.27.3`, main module `v0.76.2`, source `3f6334d223b52188324af3b9923b4249cd206652`, `vcs.modified=false`, Linux/amd64 and CGO disabled. The complete inventory contains gRPC `v1.84.0`, x/net `v0.62.0` and go-jose/v4 `v4.1.6`. The old 0.76.1 `+dirty` exception is not transferred to this release. Provenance and embedded metadata do not establish reproducible builds or complete source-to-binary equivalence.

## Unchanged gates and rollback

Preserve all existing severity thresholds, complete inventories/SBOMs, current database and same-database comparison requirements, source-bound gosu treatment, Rust coverage, runtime controls and private-evidence restrictions. No ignore list, lowered threshold, fixture assertion removal or new exclusion is introduced. Neither support dates nor service image pins change. A rollback reverts this focused official-profile update; retained historical evidence remains available, but reverting does not make the older scanner eligible under current vulnerabilities.

## Local validation and review

The independent scope/contract review approves this bounded lane. A distinct implementation/security review approves the exact release adaptation, historical evidence preservation and unchanged controls, conditional on actual qualification and delivery evidence.

On pinned Node 22.23.2, the complete affected native Linux scanner/managed suite reports 517 tests: 516 passed, one existing non-Linux refusal probe inapplicable on Linux, zero failures. Windows scanner checks report 426 tests: 396 passed, 30 existing platform exclusions, zero failures. Full local lint14/14, typecheck23/23 and workspace test tasks28/28 pass without cached tasks. Root tests report2,655 total,2,170 passed,485 existing platform exclusions and zero failures. Build14/14 passes, with13 outputs reused from this same validation's prerequisite builds. Secrets pass for1,292 repository files; the normal dependency audit reports no known vulnerabilities. Browser checks and the complete native general-quality run remain CI gates; no UI code changed.

The first complete Windows test run and first combined Linux run both retained one expected integration failure: the OpenSearch regression freezes the entire official adapter's byte hash, which necessarily changed with its release constants. After review of the bounded adapter diff, that exact expected hash was refreshed to `947d4ccbcc29c91f727a8b9248474c72d263c1c33cb1c007606c8d99ad649353`. The hash assertion, capture-size assertions and native capture implementation remain present. The subsequent complete native suite passes; the failed logs remain retained.

Current scanner self-audit, service findings and source/main CI remain pending. No admission or TASK-0005 completion is claimed.
