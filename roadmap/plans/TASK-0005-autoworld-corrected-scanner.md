# TASK-0005 — Auto World corrected Trivy scanner plan

Status: REVISED FOR ACTUAL ARCHITECT RE-REVIEW, then distinct Critic review. Architect round 1 blocked the prior freeze and its three corrections are incorporated here. No implementation is authorised before both approvals and complete PR publication/readback. The user has explicitly selected construction and maintenance of an Auto World scanner derivative.

Planning source: PR 202 branch `codex/task-0005-seaweed-go-s3-profile`, source `c80ec3a7fe24ff476874edc864ee0ffa396bd9e8`. The checkout was clean when inspected. This plan stays inside TASK-0005/TASK-0005A and the existing PR/branch.

## Outcome and stop condition

Construct a job-local, separately identified Auto World scanner from exact Trivy `v0.76.1` source commit `e713f67f7d54decdcd9b3132c9751833dcced698`, changing only `go.mod` and `go.sum` to resolve `github.com/go-jose/go-jose/v4` at `v4.1.6`. Prove the source delta, complete module closure, compiler identity, two isolated offline builds, binary reproducibility, raw build identity, self-audit, current builder audit, security regression, known-vulnerable and clean controls, and same-database detection/inventory conservation before the binary may scan any TASK-0005 subject.

The implementation branch stops successfully only when fresh Linux CI reaches all existing five-subject, managed-image, SeaweedFS source/inert/candidate, Rust-source, Native OpenSearch, runtime and quality gates with the corrected scanner, or stops honestly at the first finite unsupported or security condition with bounded evidence and verified cleanup. It does not publish, sign, admit, activate or claim M2/TASK completion. Support dates remain `null`; the accepted one-year support window starts only at a later reviewed activation, with archives retained for at least 365 additional days and security checks required on every use throughout support.

## Current evidence and immutable history

- Fresh upstream run `40652466470/1` on source `c80ec3a...` proved official Trivy `0.76.1` provenance and four negative provenance controls, then correctly refused at `scanner_self_audit_blocked`: one fixable HIGH, `CVE-2026-116587`, `go-jose/v4 v4.1.5`, fixed in `4.1.6`. No five-subject reports exist for that run.
- The official binary, `infra/scanner/official-release.json`, historical `infra/scanner/scanner-lock.json`, historical patches/build generations, failed run and retained artifacts remain unchanged. They are reference and negative evidence, never derivative identity or acceptance authority.
- The exact Trivy tree is `2b2e1ef32745d09fbd85b9d040da722333dd4258`. The fixed library is go-jose `v4.1.6`, commit `a0111f82742fa92bceec9ede40845e73319e6230`, module checksum `h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=` and go.mod checksum `h1:x4oUasVrzR7071A4TnHLGSPpNOm2a21K9Kf04k1rs08=`. The patch contains exactly three substitutions: one version substitution in `go.mod`, plus the module-version/package-checksum line and the module-version/go.mod-checksum line in `go.sum`. The latter checksum bytes remain unchanged while its version prefix changes; no other module or source file changes.
- Construction A uses the already selected Go builder `library/golang:1.27.3-alpine3.24`, index `sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c`, Linux/amd64 subject `sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747`. Construction B uses the official `go1.27.3.linux-amd64.tar.gz`, 70,588,678 bytes, SHA-256 `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`. They run in two distinct containers inside the same clean job, with disjoint source/module/build/cache roots and the same internal output path. Both remain diagnostic until their private co-present binaries and receipts establish byte identity and the selected candidate passes every gate below.

## Scope

In scope:

1. A new exact owned-scanner lock and one reviewable two-file module patch.
2. A new owned build/receipt module using existing Linux, Docker, Git, Go and Node facilities; no historical build actor is replayed.
3. A fixed owned scanner profile and validator, separate from the official Aqua profile.
4. Two disjoint fresh, network-disabled builds through different Go 1.27.3 delivery paths in distinct containers in each consuming job; their private co-present binary bytes, hashes, raw build info, closure and receipt must agree. These are reproducibility evidence, not proof that either compiler delivery or runner is non-malicious.
5. Official-vulnerable negative evidence, owned self-audit, exact security regression, same-database controls, current builder audit and downstream audit reuse.
6. Minimal explicit integration in the existing upstream and managed workflows, current scanner consumers, tests, ADR/task/validation records and PR body.

Out of scope: registry publication, package publication, signatures, attestations presented as Aqua's, admission generations, activation, support-date assignment, a Windows build, another compiler/provider/account/token/grant, a scanner switch, custom cryptography/archive parsing, vulnerability waiver, relaxed severity/currentness policy, automatic Codex goal/thread/monitor creation, or product-roadmap work.

## RALPLAN-DR

### Principles

1. The scanner must satisfy the policy it enforces; a fixable HIGH in the scanner remains a hard stop.
2. Producer identity is explicit and truthful: Auto World owns the derivative; Aqua's release identity and attestation are never transferred.
3. Bootstrap trust is ordered. Exact source/compiler/reproducibility permit diagnostic execution only; downstream authority begins only after self-audit, builder audit and controls pass.
4. Existing official, image, Native and SeaweedFS controls remain at least as strict and all historical evidence remains immutable.
5. Every binary is ephemeral and reconstructible. Public CI evidence is bounded text; binary, source checkout, module cache, databases and private child logs are not uploaded.

### Top drivers

1. TASK-0005 is currently blocked before all subject scans by the official scanner's fixable HIGH vulnerability.
2. The user explicitly chose the maintenance burden of an Auto World corrected scanner rather than waiting for an upstream release.
3. The repository already has exact-source, module-closure, reproducible-build, same-database and fail-closed patterns that can be reused without weakening the official profile.

### Options considered

#### Option A — Wait for the first fixed official Trivy release

Lowest producer and provenance burden. It preserves Aqua's release asset and attestation and needs only a tuple refresh plus complete requalification. It leaves TASK-0005 blocked for an unknown period and does not satisfy the selected direction.

#### Option B — Build the bounded Auto World derivative (selected)

Patch only go-jose to `v4.1.6`, build reproducibly through the exact existing Go builder and the exact official Go archive in two distinct containers in the same clean consuming job, retain a separate receipt identity, and replay every qualification gate. It restores progress now while preserving policy. Consequences are ongoing rebuild/security-review duties, explicit source/notices retention, more CI time and a migration obligation when an official fixed release is available.

Switching scanners, using mutable Trivy `main`/`canary`, reviving Auto World's historical `0.74` scanner, or waiving the finding are invalid because they expand the migration surface or weaken accepted controls without solving this bounded incident.

## ADR amendment

### Decision

Amend ADR-0026 narrowly to allow a diagnostic-only Auto World scanner profile based on exact Trivy `e713f67...` / tree `2b2e1ef...` plus exact go-jose `v4.1.6`. Keep Trivy's application/CLI version exactly `0.76.1`, because that value also enters Trivy's policy engine. Distinguish the producer in the artifact and receipt kind `auto-world-trivy-0.76.1-jose4.1.6-r1`, exact source/patch/compiler/module identities and measured binary hash. Its raw `go version -m` main module must be `github.com/aquasecurity/trivy (devel)` with no main checksum and no VCS fields under `-buildvcs=false`. Do not invent an application semver, coerce `(devel)` to `v0.76.1`, manufacture Aqua build metadata, or grant a generic dirty/devel allowance.

The fixed profile may scan TASK-0005 subjects only after both private job-local binaries match byte-for-byte and pass raw identity comparison, self/cross-self audit, controls and current builder audit. It remains diagnostic, job-local and unadmitted.

### Consequences and trade-offs

- Auto World becomes the producer and maintainer of this binary for up to one year after eventual activation.
- Every consuming workflow reconstructs both private binaries in one clean job and requalifies the selected byte-identical candidate locally. No binary crosses a job or artifact boundary.
- Both consuming jobs receive an explicit reviewed ceiling increase to 360 minutes and one monotonic 320-minute execution deadline: upstream changes from 75-minute job / 60-minute audit, and managed changes from 240-minute job / 225-minute audit. The remaining 40 minutes are bounded workflow overhead: checkout/setup 10, repository pure tests 5, provenance preparation 10, evidence upload 10 and final bookkeeping 5. The execution deadline always reserves its last 10 minutes for cleanup. These are upper bounds, not promised runtimes or permission to omit tests.
- The first immutable official Trivy release containing go-jose `>=4.1.6` triggers a reviewed migration assessment. The derivative is not silently replaced, and historical evidence remains retained.

### Follow-ups

- Retain exact source manifest, patch, module closure, Trivy `LICENSE`/`NOTICE`, go-jose `LICENSE`, derivative change notice, receipts and review records under existing privacy/retention contracts. No Aqua sponsorship or attestation is implied. Durable private source-archive retention remains a separate pre-admission obligation; public CI artifacts stay text-only.
- On every use, capture fresh vulnerability/Java databases, enforce the 48-hour vulnerability DB maximum and re-run self/builder/fixture controls before subjects.
- During support, a new scanner/compiler/module finding, unreproducible build, upstream security fix or material report-schema change blocks use and opens a focused reviewed maintenance increment.

## Execution plan

### 1. Freeze the exact producer contract before code

Dependency Expert has frozen the exact minimal `go.mod`/`go.sum` delta, Trivy tree, Go `1.27.3` compatibility, two compiler delivery identities, upstream test boundaries and license/notices implications in `.omx/reviews/task005-owned-scanner-dependency.md` (22,549 bytes, SHA-256 `2df566c45e202217a2dfd005b4e512ebd83dd99c2e30dde1768ede9ad5aa7b41`). The exact writable-test behavior, fixture closure, three generated WASM paths and separate go-jose source/test closure are frozen in `.omx/reviews/task005-owned-scanner-test-source-facts.md` (12,157 bytes, 137 lines, SHA-256 `667035b96b49482738702dd6541dc267abc692be0f45fed24aee16120a4e5934`). Explore mapped the affected repository surfaces. Unmeasured source-archive, module-cache, generated WASM and binary identities remain runtime measurements rather than guessed pins.

Architect round 1 is retained at `.omx/reviews/task005-owned-scanner-architect-r1.md` (2,388 bytes, SHA-256 `09f3bd714fd2cb4752b451de4c6580e1d8f32ccc42bff7dc7941623f4144694b`) with verdict `BLOCK`; this revision resolves its time, resource and writable-test-copy findings. Actual Architect re-reviews the complete frozen revision. A distinct Critic then reviews only the Architect-approved version. Both must approve. Root publishes the complete plan, reviews, file ownership, acceptance predicates and failure behavior in PR 202 and reads it back before any implementation dispatch.

### 2. Add a new lock without touching historical locks

Add a separately named lock under `infra/scanner/` containing exact Trivy source repository/commit/tree, receipt kind `auto-world-trivy-0.76.1-jose4.1.6-r1`, CLI version `0.76.1`, exact builder index/platform digests, exact official Go archive bytes/hash, exact patch path/hash/bytes, expected changed paths (`go.mod`, `go.sum` only), complete module-closure schema, build flags, platform and resource limits. Add one patch file under a new owned-scanner patch path.

At build time verify checkout `HEAD`, tree, clean state and original module identities: `go.mod` 25,287 bytes / `3b80afcc13ad1abbafa5a3054198622ea51444295967069899f907be1acaba71`; `go.sum` 123,446 bytes / `24155b9b13b24ad37ca2938d53304974a18bc84e9db00dd77b0e707c838b1cd6`. Apply exactly three substitutions: `go.mod` changes go-jose `v4.1.5` to `v4.1.6`; `go.sum` changes the package line from `v4.1.5 h1:RjgjO2LOtWOJKUC5wpwY9LR3B3vwVAz6JS2YHfYU6eA=` to `v4.1.6 h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=`, then changes `v4.1.5/go.mod` to `v4.1.6/go.mod` while retaining checksum `h1:x4oUasVrzR7071A4TnHLGSPpNOm2a21K9Kf04k1rs08=`. Require `git diff --name-only` to equal exactly `go.mod` and `go.sum`, then require patched identities `go.mod` 25,287 / `cb75cc749fd36f4ec0a6a152aa40598653e0b5a8f58b9cf9702a29f62f5bcc81` and `go.sum` 123,446 / `a934abfc262a21a885c2c9b755f43397460996d67a07d1ab3fa52e8e66d94e84`.

Run Go `1.27.3` with `GOTOOLCHAIN=local`, `GOPROXY=https://proxy.golang.org`, `GOSUMDB=sum.golang.org`, empty private/no-sum exclusions and `-mod=readonly` during the bounded preparation phase. Require `go mod tidy -diff` to emit no change, record `go mod download -json all`, `go list -m -json all`, module-cache zip/mod/info identities and checksum-database evidence, then `go mod verify`. Create a private bounded source archive and canonical per-file manifest from the exact checkout, patch and notices; measure their identities but upload only the bounded text manifest. Fail on replacements, local modules, missing sums, duplicates, unexpected module movement, go-jose other than exactly `v4.1.6`, any retained `v4.1.5`, or a closure copied from historical Trivy `0.74`/gosu evidence.

### 3. Build through two independent compiler delivery paths

Create a new build module rather than changing `scripts/scanner/build.mjs`. Reuse only qualified utility patterns. Each existing consuming job runs both constructions on one clean Ubuntu runner in two distinct network-disabled containers. Construction A uses the exact pinned Go builder image. Construction B reuses that same exact carrier image, masks its bundled Go tree and mounts a separately extracted, verified official Go archive read-only at `/usr/local/go`; it proves the mounted root and exact `go version`/`go env` contract before building and fails on any interpreter or shared-library error without adding compatibility packages. The Docker Official Image recipe at commit `41d9b4da70324ae7b6461ac2cc401b06719ff57d` directly confirms this exact archive is the Go tree used on Alpine 3.24; no broader static-toolchain claim is made. This supplies two compiler delivery paths without another provider or host execution. Give each construction disjoint source, module-cache, build-cache and work roots. Mount its output at the same internal path, `/out/trivy`, so raw `go version -m` includes the same path without normalization. Keep both resulting binaries private and co-present in the job-owned host workspace until byte comparison, raw identity validation and self/cross-self controls finish. No binary, source archive, module/build cache, compiler filesystem or database crosses a job or artifact boundary.

Before the offline boundary, independently materialize and verify the exact same source and complete module closure into the two disjoint build roots. Keep those A/B roots read-only and never run tests or generators in them. Test go-jose in a separate read-only source tree fixed to commit `a0111f82742fa92bceec9ede40845e73319e6230` / tree `69bfc467e2ee98423d83dbe4a367ef7b4fd663b8`: `go.mod` is 48 bytes / `e069e6002d29495b8c2dc6cf0d3b56a075ec5be7abb6c2eb1a1c0845cb66b8b3`, `go.sum` is empty / `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, and its 35 test files add only standard-library or module-internal imports. Run `CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off GOENV=off go test -mod=readonly -count=1 ./...` with only external ephemeral cache/temp/home writes, require both module files unchanged, then discard the test roots.

Trivy's exact `Test.Unit` target first runs `GenerateModules`, RPM fixtures and Git fixtures concurrently, then `go test -v -short -coverprofile=coverage.txt -covermode=atomic ./...`; it therefore cannot run against a supposedly immutable build tree. Create a separate sealed-then-writable patched Trivy test copy. Build Mage `v1.17.2` offline from the frozen Trivy module closure into external ephemeral `GOBIN`, with external `MAGEFILE_CACHE`, `GOCACHE`, `GOTMPDIR`, `GOPATH` and `HOME`; resolve no other executable beyond the pinned Go toolchain and that Mage binary.

Preseed the exact upstream fixture destinations without changing historical locks/materials or applying the historical source patch. The RPM predicate is one regular non-link file at `pkg/fanal/analyzer/pkg/rpm/testdata/socat-1.7.3.2-2.el7.x86_64.rpm`, copied from retained 296,692-byte SHA-256 `629571bd05c7ae50170a7a94d2b987489e7f50de7d733955f70fb8e396831ba9`, with source/destination identity checked before and after. The Git predicate starts from retained 34,282-byte archive SHA-256 `6da90be2808700df2ebcc188202d89d5e30e966cac5b2d12e0571ccf7cbe9393`, uses the existing bounded archive reader into only `internal/gittest/testdata/test-repo/`, rejects absolute/traversal/escaping-link/unexpected members, records a canonical archive-member and extracted per-file manifest, and requires `main`, `valid-branch` and tag `v0.0.1` to resolve to commit `8a19b492a589955c3e70c6ad8efd1e4ec6ae0d35` / tree `028f8b12792c2084211d02d883e3368ca87cc92f`. Set destination mtimes newer than their exact fixture sources so Mage deterministically skips both mutable fetchers, then disable networking.

The only permitted writes inside the Trivy test copy are exactly `pkg/module/testdata/analyzer/analyzer.wasm`, `pkg/module/testdata/happy/happy.wasm`, `pkg/module/testdata/scanner/scanner.wasm`, the exact RPM path, `internal/gittest/testdata/test-repo/**` under its sealed manifest, and root `coverage.txt`. Invoke the ephemeral Mage binary as `test:unit` under network isolation, require the exact short `go test` command to pass, compare the final tree to the pre-run seal and allowlist, and retain bounded text/test/coverage/generated-file identities. Any other write, network attempt, toolchain/module change, incomplete package result or missing generated file blocks. Destroy the test copy; no generated test byte enters A or B. Any additional Trivy integration cases are the existing bounded Auto World controls; do not claim the complete upstream integration suite. Never raise `MaxRSAModulusBits` above go-jose's fixed 4096-bit default.

Both constructions build from read-only verified inputs with outbound network disabled, `GOPROXY=off`, `GOSUMDB=off`, `GOTOOLCHAIN=local`, `GOFLAGS=-mod=readonly`, empty private proxy variables, fixed locale/timezone, `CGO_ENABLED=0`, Linux/amd64 and no inherited Go flags. The common command is equivalent to `go build -mod=readonly -trimpath -buildvcs=false -ldflags="-s -w -buildid= -extldflags=-static -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.76.1" -o <owned-output> ./cmd/trivy`.

The job validates both private binaries and receipts and requires equal complete binary SHA/size, source/patch/module identities, compiler version, build flags, CLI version and raw `go version -m`. The raw structural contract is Go `1.27.3`, command path `github.com/aquasecurity/trivy/cmd/trivy`, main `github.com/aquasecurity/trivy (devel)` without sum, no VCS settings, Linux/amd64, CGO disabled and exact go-jose `v4.1.6`. Every compiled dependency reported by `go version -m` must map exactly to the frozen complete `go list -m all` closure, with no outsider; compiled dependencies are a linked subset of that closure rather than blindly equal to every downloaded module. Any difference is `scanner_owned_reproducibility_mismatch` and blocks scanner execution.

Do not put a predicted binary SHA, patched tree SHA, module-cache size/count or raw build-info byte count in source. The two constructions establish the measured exact binary identity. Neither binary may proceed to controls before equality is established. Reproducibility does not prove either compiler delivery or container non-malicious; bootstrap trust comes from the exact reviewed source, patch, compiler identities, standard Go parser, negative official witness, upstream tests and control sequence.

### 4. Establish authority in ordered gates

Use a dedicated fixed owned-profile validator. Do not parameterize or relax the official Aqua validator.

1. Preserve the official 0.76.1 self-audit as a negative control and require the named go-jose `v4.1.5` fixable HIGH with no transfer of authority.
2. Parse both private receipts and both binaries with the standard Go tool and bounded parser. Require exact measured compiler/platform/CGO/build flags/main/VCS state, every compiled dependency to map exactly into the frozen complete closure with no outsider, exactly one go-jose `v4.1.6`, and no `v4.1.5`. Keep Trivy's application/version-probe value `0.76.1` distinct from the owned receipt identity and honest `(devel)` main module.
3. Using one captured database set, run self and cross-self controls: A scans A and B, and B scans A and B. Require JSON/CycloneDX package/PURL conservation against each target's build inventory and zero findings in every report filtered to `HIGH,CRITICAL`; LOW/MEDIUM findings remain recorded and do not broaden the current rejection level. These four controls are necessary but are not described as independent trust implementations.
4. Run the existing known-vulnerable, clean, version-probe, Go, Java, Rust and format controls with exact CLI version `0.76.1` plus the closed owned receipt/binary join. Compare candidate and official-reference detections on identical captured databases; the candidate must preserve the full package/PURL/finding sets and expected controls. The rejected official binary is reference evidence only.
5. Audit the exact Go builder index/platform subject with the owned scanner and same databases. Require complete inventory and existing policy success. Only after this point set the local receipt state to `QUALIFIED_FOR_THIS_JOB`.

Any failure before step 5 keeps the binary `DIAGNOSTIC_ONLY`, skips downstream subjects and retains the first exact failure plus cleanup proof.

### 5. Integrate the fixed identity into current consumers

Add a bounded owned-scanner adapter to `scripts/scanner/official-audit.mjs` or a dedicated adjacent module, selected internally by one fixed receipt/profile rather than caller-supplied arbitrary version/build metadata. Keep pure report schema expectations narrow: reports still say `0.76.1`; actual producer/provenance authority is enforced at the audited entrypoint by the exact receipt/binary/source/database join. Preserve official release/provenance validators untouched.

Inspect the exact fixed version coupling in `scripts/scanner/seaweed-rust-source.mjs` and other consumers. The report/CLI version remains `0.76.1`, so its report validators remain unchanged. Change only the audited entrypoint boundary needed to require the owned qualification receipt joined to the same run/source/database/binary. Preserve existing image-role, JSON/CDX, Rust-source, managed archive and SeaweedFS validators. Update the OpenSearch official-audit SHA anchor after final source freeze.

Both `.github/workflows/data-foundation-audit.yml` and `.github/workflows/data-foundation-managed.yml` reconstruct A and B in two distinct containers inside their existing clean consuming job, compare the co-present private binaries and run qualification. After cross-controls, they delete the duplicate construction and unneeded build material, retain the selected candidate for downstream scans, and delete it during final verified cleanup. No scanner binary crosses jobs or workflows. Existing provenance acquisition of the official binary remains solely for the negative/reference control. Workflow path filters include all new lock/patch/build/control/test files.

### 6. Replay all downstream evidence on fresh Linux CI

After qualification, run the unchanged five upstream roles and collect every report even when an image fails policy. Then run all three managed builds, seven builder/image audits, SeaweedFS Rust source/helper gates, source preflight/inert qualification/real candidate stages as reached, Native OpenSearch suites, four runtime cases and cleanup. Fresh quality CI must pass lint, typecheck, root/workspace tests, build, Secretlint, dependency audit and browser tests with only explicit reviewed platform skips.

Do not transfer prior finding counts or accepted source identities. Bind every result to exact PR head, merge checkout, workflow/run/attempt, scanner run identity, database identities and exact subject.

### 7. Independent review, records and maintenance handoff

After implementation and tests freeze, a code reviewer checks security boundaries, fixed-profile isolation, failure preservation, caps and cleanup. A separate verifier checks exact source/tree, test evidence, CI originals and joins. Update ADR-0026, TASK-0005A, TASK-0005, validation records and PR body while keeping status `IN_PROGRESS`, M2 `NOT_ESTABLISHED`, admission `NOT_AUTHORIZED`, and activation/support/archive dates `null`.

Root alone owns Git, PR mutation, CI launch and original artifact acquisition. Implementation agents do not commit, push, launch CI or touch retained originals.

## Expected file/resource mapping

Proposed exact new files, subject to Architect/Critic naming correction without semantic scope change:

- `infra/scanner/owned-scanner-lock.json`: closed source/patch/compiler/build/cap contract.
- `infra/scanner/patches/trivy-go-jose-4.1.6.patch`: the exact three substitutions across two module files plus Auto World change notice.
- `scripts/scanner/owned-build.mjs`: source/closure/test/build/receipt lifecycle for Construction A and B.
- `scripts/scanner/owned-controls.mjs`: fixed receipt/build-info/reproducibility/qualification validators.
- `tests/scanner-official-owned-build.test.mjs` and `tests/scanner-official-owned-controls.test.mjs`: pure, adversarial and ordering coverage included by the current scanner test glob.

Minimal changes: `.github/workflows/data-foundation-audit.yml`, `.github/workflows/data-foundation-managed.yml`, `scripts/scanner/official-audit.mjs`, `scripts/scanner/seaweed-rust-source.mjs`, `tests/scanner-official-audit.test.mjs`, `tests/scanner-official-controls.test.mjs`, `tests/scanner-official-workflow.test.mjs`, the managed-workflow contract tests and the OpenSearch adapter-hash anchor.
- Documentation: ADR-0026, TASK-0005/TASK-0005A, relevant validation record and PR 202 body.
- Untouched: `infra/scanner/official-release.json`, historical `infra/scanner/scanner-lock.json`, old patches/generations, retained reports/artifacts and official Aqua tuple validators.

## Test strategy and acceptance criteria

### Pure and contract tests

- Lock rejects unknown keys, wrong source/tree/builder/platform, unsafe paths, duplicate or reordered material, wrong patch/hash/bytes and non-finite caps.
- Patch gate rejects any changed path beyond `go.mod`/`go.sum`, patch no-op, missing go-jose, `v4.1.5`, version above/below exact `v4.1.6`, replace/local module and closure drift.
- Receipt parser rejects unknown fields, missing attempted-stage journal entries, wrong Construction A/B kind, work-directory collision, raw build-info alteration, binary mismatch, module mismatch and non-monotonic clocks.
- Owned evidence tests reject wrong run/source/attempt, unsafe or duplicate/case-fold-colliding paths, links, non-UTF-8, noncanonical JSON, cap overflow, declared identity mismatch and input mutation during capture.
- Reproducibility tests inject different binary bytes, build flags, compiler, closure, module files, version output and build info.
- Owned-profile tests reject official/owned profile swaps, an application version other than exact `0.76.1`, a receipt kind other than exact `auto-world-trivy-0.76.1-jose4.1.6-r1`, normalized `(devel)`/fabricated dirty/VCS state, absent binary join, wrong database join, a receipt from another source/workflow/run and any attempt to transfer Aqua's asset attestation to the Auto World binary.
- Bootstrap ordering tests prove downstream commands cannot start before two-build equality, self-audit, controls and builder audit.
- Negative-control tests prove official 0.76.1 remains rejected, known-vulnerable detects, clean stays clean, candidate preserves the full package/PURL/finding sets, all unchanged Go/Java/Rust controls remain effective, and go-jose `v4.1.6` source tests pass without raising the 4096-bit RSA bound.
- Writable-test-copy tests require the exact three WASM paths, exact RPM identity, exact Git archive/member/ref/tree closure and `coverage.txt`; reject a fourth generated path, mutable fixture fetch, external executable, module/toolchain write, build from the test copy or any flow of generated bytes into A/B. The separate go-jose test contract rejects source output, module-file drift, an external test dependency and a nonlocal toolchain.
- Deadline tests use a fake monotonic clock inside the single execution process to prove the 320-minute shared deadline, 145/225-minute internal stage caps, 10-minute final-cleanup reservation, unused-owned-budget handoff, current 90-minute child cap and deterministic `TIME_BUDGET_REFUSED` without selective test removal. Resource tests prove exact `projectAuditBudget`, scanner 4 GiB memory/2 GiB tmpfs, artifact 6 GiB, upstream `ceil(peak*1.25)` and managed `max(20 GiB, ceil(peak*1.25))`, including refusal until removed paths are proven absent.
- Failure tests cover source/module/network attempt after offline boundary, timeout, output cap, disk/resource exhaustion, cleanup ambiguity, foreign object collision, input mutation and post-cleanup tampering.

### Linux integration criteria

- Construction A and Construction B in two distinct containers in the same clean job, using disjoint roots and compiler delivery paths but the same internal output path, produce identical complete binary hashes/sizes and raw identities from exact locked inputs; the receipt does not misstate them as independent trust implementations.
- A-on-A, A-on-B, B-on-A and B-on-B scans use the same captured databases, include exact go-jose `v4.1.6`, exclude `v4.1.5`, conserve each complete compiled inventory in JSON/CDX and contain zero `HIGH,CRITICAL` findings.
- The exact Go builder passes current same-database policy before any subject scan.
- Existing fixture, version, database freshness, conservation and negative controls all pass without reduced assertions.
- All current upstream/managed/SeaweedFS/Native/runtime gates either pass or stop at a new concrete finite blocker; cleanup is proven in both cases.
- Full quality checks pass on the exact source. Independent code review and evidence verification have no unresolved material finding.

## Resource, timeout, evidence and cleanup contract

- Work only on disposable Ubuntu 24.04 GitHub-hosted runners. No local Windows Docker/Go/scanner execution or installation.
- Both workflows set job `timeout-minutes: 360`, the documented GitHub-hosted maximum. Separate workflow steps have explicit caps only for checkout/setup 10, repository pure tests 5, provenance preparation 10, evidence upload 10 and final bookkeeping 5. Build A/B, qualification, same-database controls, downstream audits and final cleanup all run inside one workflow execution step capped at 320 minutes and one process-owned monotonic deadline; databases, private binaries and opaque receipt context never cross a step or process boundary. Inside that process, owned producer/control has a 145-minute internal cap and downstream audit retains its current 225-minute internal cap. These caps overlap the same deadline rather than adding to it. Final cleanup runs in that process's `finally` path and the deadline always reserves its last 10 minutes for it. Every child receives `min(existing command cap, monotonic deadline minus now minus cleanup reserve)`. Owned subcaps remain source/patch/closure preparation 25; go-jose plus Trivy tests 55; both builds and equality comparison 40; self/cross-self, fixtures and builder audit 25. Downstream keeps its existing child caps, including 90-minute managed builds. Unused owned allowance remains available to downstream. Before each downstream dispatch require positive remaining time after cleanup reserve; otherwise record finite `TIME_BUDGET_REFUSED`, skip no test selectively, preserve the first failure and enter final cleanup. Caps are upper bounds, no sum of all child maxima is claimed, and an unchanged failure is never retried.
- Preserve the existing `projectAuditBudget` exactly as a sequential audit working-set guard: validated `buildInputBytes + materialBytes + databaseBytes + baselineImageBytes + versionProbeBytes + 4 GiB transient`, capped at 8 GiB. It is not a RAM ceiling and must not absorb the owned source/test/build workspace. Preserve the actual scanner container limits of 4 GiB memory/memory-swap and 2 GiB tmpfs, the 6 GiB public-artifact cap and the managed 20 GiB runner preflight.
- Account source/test/build workspace separately. For every stage, enumerate the objects that coexist and compute `stagedIncrementalPeak`. Upstream requires free bytes on the actual filesystem of at least `ceil(stagedIncrementalPeak * 1.25)`. Managed requires at least `max(20 GiB, ceil(stagedIncrementalPeak * 1.25))`; the existing 20 GiB preflight is a floor, not an added second reservation. The preparation/test stage includes the exact source archive, one writable Trivy test copy, one read-only go-jose test tree, complete external module/test caches, pinned RPM/Git fixtures, generated allowlisted WASM and coverage output. Each build stage includes one read-only source, its compiler tree, module cache, build cache and output; construction caches are removed and absence verified before their bytes may be deducted. The comparison/control stage retains both binaries, bounded receipts and captured databases. The downstream stage retains only the selected owned candidate, official reference, captured databases and the current subject inputs/reports/archives. Never subtract a path from the projection until owned-path cleanup and absence checks succeed.
- Before deleting the Trivy test copy, copy and seal only the two downstream Rust control inputs already pinned by current project metadata: `integration/testdata/fixtures/repo/trivy-ci-test/Cargo.lock` (30,526 bytes / `bdd6b5e1d9700326d43bf3ad586c130ac1f883d634d127f841bf7707e2350117`) and `integration/testdata/fixtures/repo/cargo/Cargo.lock` (2,186 bytes / `f8e887c771fb2cfdd969dd97469e11bca8c7cbb9d65ebcd9faaa20d96b9988a6`). Revalidate them before each later Rust control. No other Trivy source fixture survives test-copy cleanup.
- A private source archive/manifest is capped at 512 MiB, each extracted source at 1 GiB, each module cache at 4 GiB, each build cache at 2 GiB and each binary at 256 MiB. After cross-controls, remove and positively verify the duplicate binary plus unneeded sources, caches, compiler mount/container and work roots; retain the selected owned candidate and official reference only as long as downstream and negative controls require them, then remove both in final `always()` cleanup. Child stdout/stderr capture is at most 8 MiB each; whole owned build/control public text is at most 64 MiB, 4 MiB per file, 4,096 entries. Existing subject-specific archive and free-space caps remain unchanged.
- Public artifacts contain canonical UTF-8 text/JSON only. Never upload the scanner binary, source checkout, compiler/builder filesystem, module/build cache, captured databases, Docker archives, private child logs, credentials or raw secrets.
- The public owned-evidence directory is capped at 128 regular single-link entries, 4 MiB per entry and 64 MiB total. Before upload, validate workflow/run/source/attempt joins, safe relative unique paths including case-fold uniqueness, no link/reparse entry, strict UTF-8, canonical JSON, declared bytes/SHA and unchanged file identity. It contains no binary or other private construction material and is not a cross-job input.
- Journal each destructive/cleanup attempt before execution. Use unique run-owned names/labels. In `always()` cleanup remove only positively owned containers, volumes, images, tags and work directories; inspect by both name and ID, require absence, preserve foreign objects and preserve the primary failure if cleanup also fails.

## Pre-mortem

1. **Circular bootstrap falsely authorises the scanner.** Early sign: a receipt says qualified immediately after compilation, treats matching twin builds as independent trust implementations, or relies on the rejected official scanner for acceptance. Mitigation: fixed state machine `DIAGNOSTIC_ONLY -> SELF_AUDITED -> CONTROLS_PASSED -> BUILDER_AUDITED -> QUALIFIED_FOR_THIS_JOB`; bootstrap trust stays rooted in exact reviewed source/patch/compiler plus the negative witness and controls; downstream dispatch tests cover every boundary.
2. **The two builds agree while hidden inputs drift.** Early sign: module downloads occur during build, module files change after tests, Construction A and B use the same compiler delivery/cache, or closures differ without failing. Mitigation: exact patch paths/hashes, pre/post module-file seals, complete zip/mod/info/sumdb closure, distinct builder-image and official-archive containers with disjoint roots, network-disabled build environments and equality of receipts plus binary hash/size/raw build info.
3. **Owned support weakens the official profile or other consumers.** Early sign: generic `expectedVersion` reaches callers, official dirty/devel assertions disappear, or Seaweed/OpenSearch anchors are loosened. Mitigation: separate fixed owned validator, unchanged official tests, explicit cross-profile rejection and independent code review.
4. **The security fix changes detection/report behavior.** Early sign: missing PURLs/packages, schema differences or fewer fixture findings on the same DB. Mitigation: exact same-database candidate/reference comparison, conservation checks and fail-closed no-loss policy before subject scans.

## Available agent roster and handoff

- Root leader: integration, evidence joins, Git/PR/CI and final verification ownership.
- Explore (complete): repository surface and fixed-version coupling map.
- Dependency Expert (complete): exact upstream source/module/compiler/security-test facts and reviewed build metadata contract.
- Planner: this plan and readiness freeze.
- Architect, xhigh: actual design/security ordering review after fact freeze.
- Distinct Critic, high: adversarial review after Architect approval.
- Executor 1, medium, owns only the new build/lock/patch files; preserve concurrent work and historical files.
- Executor 2, medium, owns only owned controls and focused `scanner-official-owned-*` tests; preserve concurrent work and official validators.
- Executor 3 or root integration lane, medium, owns only root adapter/workflows/docs; preserve concurrent work, Seaweed/Rust report validators and historical evidence.
- Test Engineer, medium: independent failure, ordering and regression review across all three ownership lanes.
- Code Reviewer and Verifier, high: frozen-source review and completion evidence.

After Architect then Critic approval and full PR publication, root may dispatch native executor and test-engineer agents with disjoint file ownership. `$team` is useful only if an attached OMX tmux runtime is deliberately started; otherwise native agents are the App-safe path. For durable follow-up, `$ultragoal` is the preferred goal-mode handoff when explicitly requested; `$ralph` is the single-owner fallback if native parallelism is not useful. No goal or runtime mode is created by this plan.

## Readiness freeze

The Dependency Expert's exact minimal module delta, source tree, compiler compatibility, two delivery identities, source-test boundary and notice/licensing findings are incorporated. Final binary/hash/build-ID/raw-build-info bytes, patched tree identity, source archive identity, module-cache counts/bytes, actual test counts and audit results remain intentionally unmeasured until Linux execution.

If implementation requires any source change beyond `go.mod`/`go.sum`, raises go-jose's RSA modulus limit, changes Trivy's application version from `0.76.1`, introduces another compiler/dependency/tool, transfers a binary through artifacts, or cannot preserve the fixed official validators, stop and return to Architect then Critic rather than expanding scope.
