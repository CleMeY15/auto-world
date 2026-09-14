# TASK-0005A — Corrected scanner evidence

Status: IN_PROGRESS; no scanner or image admitted. Date: 2026-09-14.

The [ADR7 contract](../decisions/ADR-0007-private-image-admission.md) is accepted through PR12, merge `3d4d251a9c19a5f03fae923dc3419b8a6bc1061d`, main CI [34830801370](https://github.com/CleMeY15/auto-world/actions/runs/34830801370) PASS. This supporting increment implements only the unprivileged corrected-scanner lane.

## Implemented local report policy

`scripts/scanner/audit-policy.mjs` preserves PR10's exact repository plus manifest/platform digest binding and vulnerability thresholds, and expects the corrected scanner version `0.74.0-autoworld.2`. It rejects missing inventories, unexpected severities, future/stale reports, wrong database schemas and expired or mismatched dispositions. OS package matching includes epoch/release, matching [the pinned upstream formatter](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/scan/utils/utils.go).

Twelve targeted Node22.23.2 tests pass. A regression based on real historical Debian/RPM report shapes failed before and passed after adding epoch/release handling. Independent policy review then found that JavaScript normalizes impossible calendar dates; report, database and disposition regressions failed before and passed after strict calendar/hour/offset validation. Valid leap days and fractional timezone timestamps still pass. The historical files were inspected as data and remain unchanged; this does not turn them into new audits. Synthetic dispositions in tests authorize no real vulnerability exception. Policy lint passed; final combined lint and other root gates remain required.

Report policy validates semantics only. Authenticating the scanner, binding actual subject/database bytes and establishing reviewer authority are separate required controls. A JSON report cannot prove its own authenticity or completeness.

## Build implementation and observed validation

The scanner-only workflow now runs two isolated Linux builds with pinned source, Go compiler, patch and fixture bytes. Managed action release commits were checked against their official repositories. Git preserves the locked material bytes across Windows and Linux; fourteen staged materials matched their declared SHA-256 and length.

The selected [upstream `test:unit` target](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/magefiles/magefile.go) generates WASM modules, prepares the Git/RPM fixtures and runs `go test -v -short -coverprofile=coverage.txt -covermode=atomic ./...`. This is the upstream short unit suite, not its separate container/Kubernetes integration targets. The scanner-specific real fixtures and image audits provide additional integration checks in this increment.

Observed runs, kept as diagnostic failures rather than success evidence:

- [34833355808](https://github.com/CleMeY15/auto-world/actions/runs/34833355808), commit `088ff6c348849bf7110d48ee0327da86ffc2c3ee`: both builds passed source/compiler checks and stopped at the final patch's go.sum context. The same dependency delta was rebased to the selected source; actual patch application then passed.
- [34833582867](https://github.com/CleMeY15/auto-world/actions/runs/34833582867), commit `4982f0811e599399436994985bf0cc4bec753eef`: both builds applied all patches, then tidy detected stale sums and sums added by downloading the broader module graph. The recipe now checks tidy first and downloads the main module dependencies; only eight obsolete sums for the four already replaced module versions were removed. This run also exposed cleanup failure on Go's readonly cache directories.

Commit `2035eaf030991121c5f773383b0451e74d48c1d5` handles owned readonly directories without following links, preserves the original build failure and records cleanup separately. Module evidence binds archive bytes while excluding machine-specific cache paths. Four targeted build tests and lint pass; [root CI34834124303](https://github.com/CleMeY15/auto-world/actions/runs/34834124303) and both [Linux builds34834124307](https://github.com/CleMeY15/auto-world/actions/runs/34834124307) pass. The independent build reviewer approved this delta after observing the actual runs.

Both downloaded executables were independently hashed and matched: SHA-256 `1255e0feaf879d9b34fa7b8842e4b3dca53429171b03b2576fafdee218a59e3d`, 168288382 bytes. Both module closures contain 473 modules and have SHA-256 `f9419872bb2f97a3ddbf84c011df54e0b090d94f76581f62a941d3382480a240`. go.mod/go.sum hashes remain unchanged through preparation; upstream unit and cleanup phases pass in both receipts. Each upstream log reports 362 passing packages and 83 packages without tests, with no package failure. This proves repeatability of this build, not the scanner's detection quality or admission.

A fresh HTTPS clone at `4982f0811e599399436994985bf0cc4bec753eef` passed the complete pinned-toolchain `pnpm check` without Turbo cache: 32 root tests, package lint/typecheck/tests/build, secrets183 and dependency audit. Its initial Windows workflow-test failure was fixed by normalizing line endings before semantic assertions. Later combined changes still require fresh complete gates. None of these root checks proves a native build or a clean service image.

## Audit implementation awaiting Linux validation

The separate audit job checks both actual build binaries, module closures and compiler-produced build inventories. It freezes the fresh vulnerability and Java databases, then runs the corrected scanner with readonly mounts, no Docker socket and no network for self/fixture scans. The self-report and CycloneDX inventory must include every compiled Go dependency and the standard library; missing or substituted modules fail. Same-database controls must preserve the old scanner's package and vulnerability detections. Full reports are retained for the six required roles and the pinned PostgreSQL/Redis Alpine alternatives.

Twenty-seven targeted scanner tests and lint pass locally, including negative tests for truncated inventories, changed build information, mutated frozen inputs, lost detections and job-level permission escalation. The combined pinned-toolchain `pnpm check` also passes without Turbo cache: 44 root tests, all package lint/typecheck/tests/build tasks, secrets check across 186 files and dependency audit. The real compiler inventories from both earlier Linux builds normalize to the same 375 dependencies plus the standard library and main module. These checks do not replace actual Linux self-audit and fixture results.

At `705ef9ac00b68f9536ef775960b7aed12ebe6efd`, both independent architecture and code/security reviewers approved the implementation. A fresh HTTPS checkout passed the full uncached checks, and [root CI34837012179](https://github.com/CleMeY15/auto-world/actions/runs/34837012179) passed. Both [Linux builds34837012169](https://github.com/CleMeY15/auto-world/actions/runs/34837012169) passed and their downloaded binaries, closures and compiler inventory files were checked against the receipts. Binary and closure hashes remain the values recorded above.

That run's audit stopped at `database_download`, before self/fixture/image scans: the vulnerability archive is 118626177 bytes and exceeded the downloader's 64 MiB tmpfs. The retained Java manifest describes a 966074582-byte archive, so 512 MiB would also be insufficient. Bounded streaming inspection of the exact public blob tar headers established database file sizes of 1379663872 and 1525985280 bytes; both fit the existing per-database 2 GiB cap. This is an observed download resource failure, not a clean audit or a vulnerability result. The following fix must revalidate actual downloads and all remaining gates.

The first download fix used a 1536 MiB tmpfs and 2 GiB memory limit. Raw OCI manifests were checked before downloads, with total layer size below 1 GiB and at least 512 MiB temporary headroom. Twenty-nine targeted tests and lint passed, but actual Linux execution exposed the additional copy described below.

At `884e691b51a3c1efc8babb0d6d54ba6f0a306556`, the targeted independent reviewer approved the fix, the fresh HTTPS checkout passed all uncached checks (46 root tests), and [root CI34838884706](https://github.com/CleMeY15/auto-world/actions/runs/34838884706) passed. Both builds in [34838884699](https://github.com/CleMeY15/auto-world/actions/runs/34838884699) passed. The vulnerability DB downloaded, but Java download failed after reaching 100%: go-getter attempted an additional temporary archive copy and exhausted 1536 MiB. No self/fixture/image audit ran. The download footprint needs to include simultaneous temporary copies, not only the OCI layer plus fixed headroom.

The final resource correction follows the pinned source path: [Trivy's OCI downloader](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/oci/artifact.go) writes the compressed layer before [go-getter v1.8.6](https://github.com/hashicorp/go-getter/blob/v1.8.6/client.go) copies it to its own temporary archive and streams decompression into the cache. Two compressed copies coexist. The downloader alone now has a 3 GiB tmpfs and 4 GiB memory limit; preflight requires total layers below 1 GiB and at least 1 GiB headroom after both copies. With the observed databases, build inputs and carrier, projected consumption is 7733866007 bytes, below the unchanged 8589934592-byte job cap. Evidence artifacts remain capped at 6 GiB. The 29 targeted tests and lint pass; actual Linux download and audit gates remain required.

## Selected dependency correction

Trivy source: `e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994` (v0.74.0). The candidate carries the previously prepared dependency update to gRPC1.83.1 plus the minimal [upstream update to1.83.2](https://github.com/aquasecurity/trivy/commit/8c905373332df11a268a0cebc07627cc08485fee). The upstream delta changes only go.mod/go.sum. Static module comparison found its minimum Go/x/net/x/sync/x/sys/x/text/x/crypto requirements already satisfied by the selected source plus first patch; only actual readonly module checks and tests can establish build compatibility.

The historical Trivy image report identified blocking gRPC findings and a fixed version1.83.2. The current MITRE lookup did not establish a record for CVE-2026-84445; do not claim a proved CVE-to-commit mapping. Fresh full scans must establish the candidate's result.

## Gates not yet satisfied

- Revalidation of the final combined workflow after later audit/evidence changes; the diagnostic build slice above has passed.
- Built-binary identity, self inventory/SBOM and full audit; exact fresh vulnerability and Java database bytes before/after execution.
- Known-vulnerable controls and same-database diagnostic comparison with the old, non-admitted scanner.
- Fresh exact-subject service/helper image audits, with every blocking finding retained.
- Full combined repository gates, fresh remote checkout and independent implementation review, then final-head/merged-main CI.

No package write, OIDC, signing, private input, image admission, source activation, new publisher/token or resumed canary is part of this increment. Private storage/admission remains separately blocked by ADR7's concrete workflow and privacy/retention gates. TASK-0005 and TASK-0006 are not completed by local policy tests.
