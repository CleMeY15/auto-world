# TASK-0005 — Review the Seaweed normal-profile exclusions

Date: 2026-11-09. Status: ACCEPTED_FOR_BOUNDED_DIAGNOSTIC_AND_IMPLEMENTATION. Architecture APPROVE followed by distinct Critic APPROVE on candidate SHA-256 `ef048e5345bd2e90757ccec7b95c6cbf1f3a94b40d6c9cc9c198b9e2411d6808`. This status note adds no capability. This amends the [maintained derivative plan](TASK-0005-seaweed-managed-go-refresh.md) and [normal-profile repair](TASK-0005-seaweed-normal-profile-unblock.md). No image publication, admission or support activation is authorized.

## Measured boundary

The final reviewed producer passes all six statuses locally: 234 packages (158 pass, 76 skip) and 14,290 tests (14,218 pass, 72 skip), zero failures. Original stream: 97,136 events, 24,401,540 bytes, SHA-256 `42c8a978f701a675ba38a8b610e2c409c798208d3b82357a231cb65e031c4ba1`. Replay SHA-256 `c0572c73eb5bf97a00a10deed1b9b72cf6eafb20d03c12d120dcb0d98f0b1a21`. This is local diagnostic evidence; fresh managed CI remains required.

The independently verified inventory at `C:/Users/Administrator/.codex/evidence/task-0005-seaweed-repaired-20261109/skip-inventory.json` has SHA-256 `cdcc317b71cc9baadae2d8552b74376a17a105b108242e63f5a9a77388f9dfc8`. It records 148 baseline/repaired identities and 26 source proofs checked against the pinned archive. Require the final run's normalized identity set to match before using this inventory. Retain each run's original event hashes separately; timestamps, elapsed times and temporary paths mean raw event hashes are not cross-run identities.

The existing product scope is Linux/amd64, empty build tags, Seaweed as raw S3-compatible object storage. It does not claim MQ/Kafka, the query engine, Azure, Arango/Redis filer backends or SQLite/Tarantool/YDB/Rclone backends. Those support claims require a separate project decision and executed coverage. Every source, archive, original/corrected module and compiler identity remains exactly pinned by the existing derivative plan.

## Closed review, never synthetic success

After ordered Architecture and distinct Critic review, a fixed internal `NORMAL_LINUX_AMD64_SKIP_REVIEW_V1` may consume the existing immutable full evidence capture and exact source proof. It is not caller-configurable and does not alter the original command, events, counts or tests.

| Category | Exact count | Required reporting |
| --- | ---: | --- |
| Packages with no direct test source | 72 | No direct coverage, never a passing test |
| Packages requiring sqlite/tarantool/ydb/rclone tags | 4 | OPTIONAL_PROFILE_NOT_RUN |
| Missing timezone data / root-sensitive permission tests | 1 + 2 | Three supplemental PASS proofs required below |
| Arango/Redis opt-in integration tests | 29 | EXTERNAL_PROFILE_NOT_RUN |
| Azure credentials absent / expected invalid-credential rejection reported as skip | 6 + 1 | EXTERNAL_PROFILE_NOT_RUN |
| Known query parsing defect / Kafka compression not implemented | 2 | KNOWN_UNSUPPORTED_FEATURE; no claim to support these features |
| Obsolete upstream tests | 6 | UPSTREAM_OBSOLETE_TEST_NOT_RUN |
| Upstream demonstrations, scaffolds and manual integration placeholders | 25 | UPSTREAM_NO_EXECUTABLE_COVERAGE |

Bind exactly the package/test/skip action identities, category mapping, fixed source skip sites and conditions, build tags, source byte counts and hashes. Recompute all counts and require all 26 source proofs. Any new, missing, duplicated, renamed or reclassified identity, source/material/condition drift or incomplete evidence refuses review. Verify each original skip event belongs to its source-bound site. For every one of the 72 test skips, require its exact recorded `reasonEvent.text` in a Go `Output` of four spaces, that text and LF, once for the same package/test between its run and skip terminal. No dynamic reason variation is authorized. Do not compare raw event hashes across runs or invent broad text substitutions.

Report normal-profile execution, reviewed exclusions and optional/external coverage separately. Required distinctions include `normalProfileTests: PASS`, `skipReview: REVIEWED_WITH_LIMITATIONS`, optional/external coverage NOT_RUN, two known unsupported features and the three supplemental test results. No skip becomes PASS. Existing vulnerabilities, generic main-module coverage, helper/runtime and downstream admission gates remain independent and mandatory.

## Three supplemental proofs

Execute unchanged tests from the same authenticated source/modules and exact qualified Go builder. Preserve complete Go JSON, stderr and statuses; require exactly the selected tests and their package PASS terminals, zero fail/skip terminals, and complete well-ordered capture. Supplemental results close these three coverage gaps only; the full normal stream and its 148 exclusions stay intact.

| Package and test | Source SHA-256 |
| --- | --- |
| `weed/command.TestParseScanTimeHonoursTimezone` | `filer_meta_scan_test.go`: `70e2295442082ec7f878f9adca5628744dc1e58a5bc89ae21e9c7b86dea31f4b` |
| `weed/storage.TestValidateEcVolume_TransientStatErrorKeeps` | `ec_startup_shard_safety_test.go`: `13caed6445c306a90b9b130a98475e2f47998518cc16cac369ef88a3c96016c6` |
| `weed/storage.TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume` | `volume_idx_rebuild_test.go`: `19c16d92bd96459fcaab2c8ef7c7f6a27a338cf0e2767825c17c7b2d71d57790` |

First inspect the exact local Go builder, without pulling, to verify `/usr/local/go/lib/time/zoneinfo.zip` is a regular nonlinked file, record its size/hash, and verify that this compiler's time package reads `ZONEINFO` as a ZIP archive. This is a prerequisite, not an assertion that the inspection already passed. If absent/inconsistent, stop this branch for a new reviewed design; install or download nothing. If confirmed, set only `ZONEINFO=/usr/local/go/lib/time/zoneinfo.zip` for the timezone proof.

Use standard Docker with the existing pinned builder `golang@sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747`, fresh qualification, `--pull=never`, network none, read-only root filesystem, dropped capabilities and no-new-privileges. Assert two CPUs, 8 GiB memory, zero swap and 2,048 PIDs inside before commands run. Use fixed non-root UID/GID 10001:10001 and assert those identities for both commands. No host credentials, Docker socket, repository/home mount, service or inherited host environment.

Create new owned scratch under a private parent. Source/module copies must be ordinary independent files, byte-identical to the authenticated inputs, mounted read-only. Do not alter permissions/ownership of the original diagnostic sources, caches or evidence. Only new owned copies and new writable GOCACHE/GOTMPDIR/TMPDIR/HOME/output directories receive the UID access they need. Check available space before copying. Keep all writes under the owned scratch and use the existing fixed Go environment with readonly module mode. Record source/module identities before/after and retain the same candidate identity if WEED_BINARY is supplied; these tests must not trigger an untracked rebuild of Seaweed.

From `/src/seaweedfs/weed`, run these exact commands separately:

```sh
go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./command -run '^TestParseScanTimeHonoursTimezone$'
go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./storage -run '^(TestValidateEcVolume_TransientStatErrorKeeps|TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume)$'
```

Retain compiler, source/module, zoneinfo, command, UID/resource, event and output identities. A zero-selection run, unexpected test, skip/failure, malformed/truncated stream, source mutation, cleanup uncertainty or changed flag cannot close a gap. No source/test/assertion patch, package installation, external service or secret is authorized by this plan.

Use an unpredictable owner token and recorded container names/labels. Snapshot the preexisting container set. Remove only identity- and owner-matched temporary containers on success, failure, cancellation or timeout; verify absence and unchanged preexisting set. Retain bounded evidence privately before any scratch cleanup, and preserve original failed diagnostics. Any later cleanup targets only resolved owned paths. Do not prune or alter existing containers, services, volumes, networks or previews.

## Integration and acceptance

### Managed Buildx realization amendment

Status: ACCEPTED_FOR_DIAGNOSTIC_IMPLEMENTATION. Architecture APPROVE followed by distinct Critic APPROVE on candidate SHA-256 `6aebde0613ab641986b5815d8a2da84e59d958ea0fab3d0e93a6b5e23ab59071`; this status note adds no capability. The bounded local diagnostic now passes all three unchanged tests: command 8 events / 1,388 bytes / SHA-256 `522d33f31404134c5128bdcbd87de004d38ae1de86d4eb7ac6b5c7a767e28644`; storage 16 events / 4,146 bytes / SHA-256 `5a6f642a958d1e9c9124357cb3ce08f0ab60c1c049e42655d227ef2af748abe1`. Both package terminals pass, with zero failures, skips or stderr bytes. The private report is `C:/Users/Administrator/.codex/evidence/task-0005-seaweed-platform-20261109/actual/verification-summary.json`, SHA-256 `c88ff1ca6ebbf2943a5a1cb49a3b57c790bf727c3cf4bb567eac91ffc6596fbe`. Copies and original source/modules/candidate remain identical; owned containers were removed and the preexisting set is unchanged. These local results do not replace fresh CI execution.

The exact pinned Go image contains these regular, nonlinked files, inspected under the bounded diagnostic controls:

| Builder material | Bytes | SHA-256 |
| --- | ---: | --- |
| `/usr/local/go/lib/time/zoneinfo.zip` | 408,467 | `b2d18a7c8fa8142097a48c99609fb3c92db5ee98bc740294e57eab8ae9f94779` |
| `/usr/local/go/src/time/zoneinfo.go` | 18,613 | `198928e8d2573d88d8743db57b86777a26506f17ef2b0283882a9f5c884979b7` |
| `/usr/local/go/src/time/zoneinfo_read.go` | 14,741 | `812b0025c6e4face22e709053183d59e03e71e3c1459187350f4088587f4a134` |

The retained compiler sources establish `ZONEINFO` handling and ZIP loading. Pin these identities in the supplemental producer/reader. Only the timezone command receives `ZONEINFO`; the storage command must not inherit it.

Use the existing two managed Buildx calls and Dockerfile. Add a `weed-supplemental` stage from the same pinned Go builder, depending on `weed-build`. Mount source, modules, the existing candidate and normal evidence read-only from `weed-build`; do not export or copy the module cache into an artifact. Create only stage-owned `/work` cache/temp/home directories and `/out/supplemental`, owned by UID/GID 10001:10001. Run the two exact commands above in one `RUN --network=none` under `USER 10001:10001`, with the same fixed Go environment, explicit writable cache paths and readonly module mode. Check UID/GID, source/module non-writability and material/candidate identities before and after. Keep `WEED_BINARY` bound to the existing readonly candidate; never compile another candidate. Remove only `/work`'s stage-owned caches in the same RUN after capturing results.

Buildx proves the pinned builder, non-root identity, network-none instruction, readonly mounts, commands and material/capture identities. It does **not** attest the local diagnostic's 2 CPU / 8 GiB / zero swap / 2,048 PIDs, readonly root filesystem, dropped capabilities or no-new-privileges controls. Those remain separate local diagnostic evidence. No local unbounded Buildx execution is introduced.

The evidence target copies only normal evidence plus `/out/supplemental/` under `supplemental/`. Preserve failed/skipped executions as original diagnostics with nonzero statuses: a successful evidence export never implies test success. Runtime construction requires normal and supplemental statuses/capture validation to be zero; the Node reader independently requires the exact three selected tests, complete ordered events, package PASS, no failure/skip, exact commands/environment/UID/materials and unchanged candidate. Keep existing 4 MiB/file, 64 MiB/total and 4,096-file capture limits. Supplemental output is tiny; any cap violation refuses instead of raising limits.

For the source-bound exclusion review, derive fixed internal review data from the measured inventory and all 26 source proofs. A fixed TSV manifest in the existing material directory lets standard shell preparation verify and export those exact source identities; the Node reader compares them to its independently fixed review data. Bind archive, corrected modules, compiler, Linux/amd64 and empty tags. Compare all 148 identities and categories exactly. Every one of the 72 test reasons was verified byte-identical across both complete repaired runs as four spaces, the recorded static reason, and LF; require that exact Output once between its test run and skip terminal. Package no-test-file reasons are bound separately to their exact Output and package lifecycle. No permissive reason normalization or caller-provided allowlist is added.

Extend the existing immutable captured view and its test inspection, keeping credential classification and export atomic. A separate fixed review function may enrich the normal summary only when full normal execution passes, source/exclusion review passes and all three fresh supplemental tests pass. Missing or invalid new evidence cannot yield runtime eligibility. Keep the original counts/skips and explicitly report `REVIEWED_WITH_LIMITATIONS`, coverage NOT_RUN and the two unsupported features. Generic image/main-module policy, helper proof and every later runtime/admission gate remain unchanged. Add adversarial tests for these predicates and the failed-export path; obtain independent implementation review before push.

The diagnostic proofs and this proposal require ordered independent reviews before execution/implementation. A later implementation must bind its fixed review data and supplemental proof reader to the actual fresh CI evidence, include adversarial mutations for each identity/category/source/command/status/capture predicate, and keep generic refusals intact. Review implementation distinctly before push.

Run affected tests, lint, types, build and secret/dependency checks, then fresh same-job scanner/builder qualification, the full normal profile, the three supplemental proofs, complete managed image JSON/SBOM and actual main-module inventory, helper binding and the existing four runtime cases. Local or historic results cannot substitute for CI. `runtimeEligible` remains false until every required test/review and existing audit predicate passes. Provenance, private retention and second-copy restoration, one-year support activation, seventeen-phase acceptance and protected-main delivery remain separate obligations.
