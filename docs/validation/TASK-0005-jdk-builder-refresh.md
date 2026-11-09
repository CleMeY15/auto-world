# TASK-0005 — Refresh the rejected OpenSearch build environment

Date: 2026-11-09. Status: BUILDER_DIAGNOSTIC_VALIDATED_SERVICES_STILL_BLOCKED; no image admission claimed.

The dependency specialist recommended this official candidate, followed by actual independent Architecture APPROVE and distinct Critic APPROVE on the decision candidate SHA-256 `3a29be08f31c78a409b37bce269105f1159919932310f3049cd339a841c86b3e`. The acceptance covers the bounded diagnostic implementation, not its results. The adapter diff changes only the exact builder version/index/platform constants; its preserved whole-file hash assertion now expects `57a401578c8cf505ab0bba52bf3332a41dd6723c7be7d384b2a6c5f190a57715`.

The user requests continuation of the remaining blockers after the official Trivy refresh. This resumes the bounded image-remediation lane alongside the isolated V1 prototype. It does not make image qualification a prototype prerequisite or authorize publication, supported activation, production or real data.

## Observed blocker

[Managed diagnostic 42580066368](https://github.com/CleMeY15/auto-world/actions/runs/42580066368) on source `38f898291ce55841e00666594adb2e9049e29477` passes scanner provenance, refusal controls, self-audit, same-database fixtures and the Go builder. The existing Noble JDK builder fails on three fixable HIGH occurrences: `apt` and `libapt-pkg6.0t64` CVE-2026-109518 (2.8.3, fixed in 2.8.4ubuntu0.1), and `libbrotli1` CVE-2026-111497 (1.1.0-2build2, fixed in 1.1.0-2ubuntu0.1). No managed service is built or audited after this gate. Those original failures remain retained.

## Bounded selected candidate

Prefer the maintained official Temurin distribution over adding a separately maintained builder. Select only `library/eclipse-temurin:25.0.5_8-jdk-ubi10-minimal`, index `sha256:6d870f0c9a54ea090e1ed8396a4926f183b1d379934248b0d335567282417517`, Linux/amd64 `sha256:39f1dc7747322dce71fe783d43904bac3f84d0b65a3f47b78ecefac6d8b992d3`, config `sha256:669facfc8cc8d6dcd578cca58343096b6f147e21080b378d065e886581bd70b5`.

The received original index and platform-manifest bytes hash to those exact digests. The index declares [Adoptium Dockerfile commit86e89ce](https://github.com/adoptium/containers/blob/86e89ce20ba391b588e243844d0c0d996071b3ed/25/jdk/ubi/ubi10-minimal/Dockerfile). [Official tag metadata](https://hub.docker.com/v2/namespaces/library/repositories/eclipse-temurin/tags/25.0.5_8-jdk-ubi10-minimal) is an observation of availability; neither a label nor a tag establishes signer trust or final admission provenance.

This changes the compiler's distribution from Ubuntu Noble to Red Hat UBI10 and its JDK from25.0.4.1 to25.0.5. The OpenSearch runtime JDK remains the exact preserved base directory. This is an alternate official candidate, not a claim that the rejected Ubuntu image was patched. The candidate's own OS, complete inventory/SBOM and vulnerabilities must pass the unchanged policy before executing it to build OpenSearch.

Actual local receipt of the immutable platform image matches the config above. A stopped container, never started, supplied inert copies of `/etc/os-release`, the JDK `release` file and bash, sha256sum, stat, find, xargs, sed and grep through standard `docker cp`. They establish RHEL10.2, Temurin25.0.5+8 with GNU libc and presence of those utilities. The owned stopped container was removed and absence observed. This is compatibility preflight evidence only; no copied executable was run, no scanner result or GNU-option compatibility is inferred from mere presence. Originals are retained under the local `task-0005-jdk-builder-20261109` evidence directory.

## Implementation and validation

1. After ordered independent dependency, architecture and distinct critic review, update only the JDK tuple in the current managed lock, its exact validator and the OpenSearch Dockerfile. Retain the old tuple in historical documents/reports. No additional package installation, custom builder, new dependency or workflow mechanism is needed.
2. Keep substitution refusals and pin the new exact tuple in regression tests. Add explicit rejection of the old tuple. Refresh the existing whole-adapter hash assertion only after review of this bounded constant-only diff; retain the assertion and all other capture/policy tests.
3. Run all affected native scanner/managed regressions and ordinary lint, typecheck, tests, build, secrets/dependency checks. Obtain a distinct implementation review before pushing execution changes.
4. Use the existing diagnostic workflow without changes: scanner controls, both full builder JSON/SBOM audits, then and only then the three existing managed builds, the five image reports, Rust coverage and conditional runtime cases. A rejected new builder stays rejected; do not weaken thresholds or silently try alternatives. Full unchanged OpenSearch wrapper/source/capture/refusal/seeded/native test gates establish compiler compatibility; no test count, skip or timeout changes.
5. Preserve original reports/artifacts and explicitly separate scanner fitness, builder qualification, service findings and runtime acceptance. No image admission, support date or TASK-0005 Done follows. Final17 phases, source/provenance, retention and supported-consumer acceptance remain separate obligations.

The change is reversible by reverting the candidate tuple; doing so does not qualify the vulnerable older builder. No volumes, backups, previews or product files are modified.

## Local validation

Distinct implementation/security review APPROVE: the exact pins, original registry metadata, constant-only adapter change, former-tuple refusals and unchanged execution gates were checked. Native Linux tests with Node22.23.2 pass517 total/516 passed/one existing non-Linux probe excluded/zero failures. The full local Windows root suite passes2,655 total/2,170 passed/485 existing platform exclusions/zero failures. Lint14/14 and typecheck23/23 pass with no cached tasks; workspace tests28/28 pass with8 cached prerequisite tasks; build14/14 passes with13 prerequisite outputs reused. Secrets pass for1,294 repository files and the ordinary dependency audit reports no known vulnerabilities. Node22.23.2 and pnpm10.15.0 were used for these complete local checks. Full general Linux/browser checks and actual candidate auditing remain GitHub gates.

The initial general-check launcher failed before lint because the host's global pnpm shim referenced a disappeared temporary Corepack path and Node24. The failure log remains preserved. The checks above used the already-present exact project toolchain directly; no host installation, global setting or source workaround was introduced. An earlier small Windows test invocation was not used as pinned-toolchain acceptance evidence.

## Exact-source GitHub validation

Source `e2ab8c33ddb7f60044ffea1cbe23b1b27366d223`, tree `90b66bd9b5a2e20ed70eff5a891f1b2c7907193a`, was tested through merge `3f26f21fb92858173a5b72c30656dcedec566bae` with the same tree. [General CI42585332213](https://github.com/CleMeY15/auto-world/actions/runs/42585332213) passes lint, types, tests, build, browser validation, secrets and dependency audit. Browser results are520 passed/10 existing exclusions. The original job log has SHA-256 `b3de0d6af9166c8fcda4e01a9eed23ba98cdec01be93cc4abce0f6b4bc14034e`. No source or exclusion changes were needed for this pass.

[Upstream diagnostic42585332191](https://github.com/CleMeY15/auto-world/actions/runs/42585332191) retains the unchanged175 blocking occurrences: PostgreSQL26, OpenSearch132, Redis0, SeaweedFS2 and AWS CLI15. Original artifact13658887500 matches the advertised archive SHA-256 `14238ead5162a2e810fb5d0e7d22e9700cb136188f8980a9c8051137c38e442b`; independent replay reproduces all five complete original JSON/SBOM evaluations. These are upstream findings, not results for rebuilt managed services.

[Managed diagnostic42585332269](https://github.com/CleMeY15/auto-world/actions/runs/42585332269), attempt1 on the same tree, qualifies both builders with zero findings/blockers and constructs/exports all three existing candidates. Artifact13660301515 matches GitHub's advertised SHA-256 `93196e89e1bb38845cc164e5906a6fe92d7d36ae35bfeae31a4696fe771b4963`,342 files/20,858,961 bytes. Independent verification replayed the exact-source evaluator, all14 original JSON/SBOM identities and inventories, and289 public evidence file identities. PostgreSQL, Redis and AWS CLI have zero blockers; OpenSearch retains one HIGH (Guava33.2.1-jre/CVE-2026-102554), SeaweedFS retains its two HIGH findings. The overall diagnostic correctly fails; functional runtime was not attempted.

Native OpenSearch results are16 XML reports/1,736 tests/1,689 passes/47 existing skips/zero failures or errors. Full output manifests and the expected-failing unfixed control, seeded-fixed control and final suite validate. The exact original runtime JDK directory remains identical before preservation and after restoration; the builder is25.0.5 and runtime25.0.4.1. Both Rust controls, the498/590 complete source-lock inventories and stopped-container helper measurements pass, with all34 owned-container cleanup records confirming absence. Uploaded text proves receipt consistency; disposable Docker archives and Rust helper bytes are not uploaded and cannot be independently rehashed from this public artifact. Independent replay JSON SHA-256 is `ccceab17162d9b6bbf641f0686524d6e889c19fdf676d1dc1ec6100824990177` under the local managed/review evidence directory. Admission, supported retention and TASK-0005 completion remain unestablished.

## Other current blocker

SeaweedFS4.51's observed go-jose/v4 and x/net findings remain open. Official4.53 source declares go-jose/v4 4.1.6 but still x/net0.61.0; its newer source and Rust components are not a drop-in clean image. Address this as a separately bounded remediation after the builder evidence, with fresh actual audits. No SeaweedFS pin or source-lock coverage changes in this increment.
