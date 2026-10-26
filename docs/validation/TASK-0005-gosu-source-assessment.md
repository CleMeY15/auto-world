# TASK-0005 gosu 1.20 source assessment

Status on 2026-10-25: `SOURCE_PREPARED / VALIDATION_AND_DELIVERY_PENDING`.
This record concerns the bounded source-review and operational-scope prerequisite
only. It does not admit an image, activate support or authorize production use.

## Exact material reviewed

- Upstream repository: `https://github.com/tianon/gosu`.
- Release/tag: [`1.20`](https://github.com/tianon/gosu/releases/tag/1.20),
  published on 2026-10-25; the captured
  [tag API record](https://api.github.com/repos/tianon/gosu/git/ref/tags/1.20)
  resolves it to the commit below.
- Exact commit: `29b939aa5bd4dc588af765b8248f6e39150d2565`.
- Source archive identity measured in M2: 18,160 bytes, SHA-256
  `2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51`.
- Reviewed primary material: exact immutable
  [README](https://github.com/tianon/gosu/blob/29b939aa5bd4dc588af765b8248f6e39150d2565/README.md#L21-L23),
  [main.go](https://github.com/tianon/gosu/blob/29b939aa5bd4dc588af765b8248f6e39150d2565/main.go),
  [setup-user.go](https://github.com/tianon/gosu/blob/29b939aa5bd4dc588af765b8248f6e39150d2565/setup-user.go),
  `SECURITY.md`, `go.mod`, `go.sum`, source index and licences under the private
  working evidence set `.omx/evidence/gosu-1.20-materials-v1/`.
- The lightweight tag and release resolve to the exact commit above. The
  commit API reports it unsigned; no source signature is claimed.

The Auto World derivative targets `linux/amd64`, `CGO_ENABLED=0`, and compiles
with Go 1.27.3. Its exact binary SHA-256 is
`8c12961ed59dc9c662d5b5150a8f8e7ab66ef59d5796a0abdb8778b885247b8e`.
That binary differs from the upstream release build, which uses Go 1.24.6; it
is not an upstream signed binary and no reproducible-build equivalence is
claimed. The source module and dependencies remain:

- `github.com/tianon/gosu` at the exact commit, with the main version lookup
  explicitly `UNAVAILABLE`;
- `github.com/moby/sys/user v0.4.1`;
- `golang.org/x/sys v0.1.0`;
- Go standard library `v1.27.3`.

The current recipe checks the installed runtime binary as `root:root` mode
`0755` and rejects the insecure override. The accepted diagnostic runtime
generation and inspection set `Tty=false`, `OpenStdin=false` and
`Privileged=false`. The deliberately insecure disposable fixture used for
negative diagnostics is separate and is not an admitted runtime.

## Bounded advisory assessment

Upstream's exact README limits gosu to changing from root to a non-privileged
user during container startup and warns against generic use because a shared
TTY can expose TIOCSTI injection (CVE-2016-2779). The shipped derivative notice
therefore restricts gosu to that ENTRYPOINT/startup role and forbids host,
setuid/setgid, general sudo-replacement and shared-parent-TTY use. This is an
operational restriction, not a claim that the host kernel disables TIOCSTI.

The independent review also checked these current advisory facts:

- [GO-2026-6686](https://vuln.go.dev/ID/GO-2026-6686.json) affects user parsing
  and is fixed by `github.com/moby/sys/user v0.4.1`; the matching upstream
  advisory is [GHSA-mjcv-p78q-w5fw](https://github.com/moby/sys/security/advisories/GHSA-mjcv-p78q-w5fw).
- [GO-2026-5024](https://vuln.go.dev/ID/GO-2026-5024.json) concerns
  `golang.org/x/sys/windows.NewNTUnicodeString`; the exact `linux/amd64` target
  imports the Unix implementation, so that symbol is outside this target.
- [GO-2026-6809](https://vuln.go.dev/ID/GO-2026-6809.json) concerns
  `crypto/x509` and is fixed in Go 1.27.3, as recorded by the official
  [Go release history](https://go.dev/doc/devel/release).

These observations are a bounded source and target assessment. An empty result
from GitHub's advisory API is not exhaustive absence evidence. Any finding
emitted by the qualified scanner still follows the unchanged admission policy;
none is filtered, ignored or waived by this document. Exact versioned
dependencies remain in the original reports and
`mainVersionLookup=UNAVAILABLE` remains an explicit coverage limit.

Licences checked by the current recipe are Apache-2.0 for gosu and
`moby/sys/user`, and BSD plus PATENTS for Go and `x/sys`. No NOTICE file exists
in the pinned gosu or `moby/sys/user` source tree. Complete corresponding source
retention for the private final closure remains open.

## Verdict and repeat conditions

After the operational-scope correction, the evidence is sufficient for the
bounded gosu source-review prerequisite. It is not sufficient for final image
security, provenance, reproducibility, retention, admission or support claims.
Repeat this review before admission, whenever the source, compiler, dependency,
recipe or relevant advisory material changes, and continuously during the
one-year support period. If current required evidence becomes unavailable,
adoption is denied rather than covered by an exception.

The notice bytes change the PostgreSQL image subject. PR77's accepted M2
diagnostic identities and runtime results therefore do not transfer. The new
subject needs the existing managed Linux build, five-role audit, four runtime
cases, full quality gates, independent actual-result review, protected merge
and corresponding main evidence before this increment can be delivered.

## Finite remaining criteria

| Stage | Expected proof | Owner | End condition |
| --- | --- | --- | --- |
| A — prerequisites | Bounded source/advisory verdict plus complete retention inventory and measured capacity at the user-selected private destination | source reviewer, retention reviewer and root | Current material is sufficient or precisely refused; complete inventory fits the restricted destination with required working capacity |
| B — final subjects | Approved least-privilege private package plan, exact subject retrieval, independent audit/runtime, complete private closure, then separate official signature and refusal controls | root, ordered reviewers, read-only verifier and separate signer | Exact subjects pass all pre-signing gates and their signature/private recovery evidence is accepted |
| C — acceptance | Current final-identity evidence, complete second-copy cold restore, reviewed admission/activation, applicable seventeen phases and protected delivery | root, ordered reviewers and independent result reviewer | All task acceptance criteria and DoD pass on admitted identities; support dates start only then |

### A — concrete prerequisites

The source-review criterion above is prepared. The user selected `C:` for the
private second copy. A fresh restricted empty folder outside the checkout was
prepared with Full Control granted only to the current owner, `SYSTEM` and local
`Administrators`; 14,038,360,064 free bytes were observed at that dated check.
The complete
inventory, capacity decision, copy, retrieval and restoration are still
pending. The dated measured raw-layout subset from main run40221700632 is
6,729,966,067 bytes; with 25 percent working headroom it is 8,412,457,584 bytes.
These measured sizes do not prove current availability, a private copy or
restoration capability.
That subtotal includes three image TARs, two uncompressed databases, one
scanner binary and selected locked inputs/public evidence. It excludes measured
sizes for Redis and SeaweedFS objects, builders and carrier/base blob closure,
complete source/compiler/dependency/notices closure, future attestations and the
changed PostgreSQL archive. It is not a complete capacity requirement. No local
path is selected by this assessment.

### B — final subjects

Before any registry write, approve the exact package/privacy/permission and
retention plan. Then prove private access, publish exact final subjects with
maintained tools, retain their complete private closure, and independently
retrieve the exact registry subjects for the required read-only audit and
runtime gates. Those gates must pass before a separate signer creates and a
verifier checks the official signing evidence. No new service, rights expansion,
public candidate, purchase or deletion is inferred.

### C — closure

On the already qualified final identities, confirm that the accepted evidence
is still current and bound to the exact registry subjects; rerun qualification
only when material changed or a currentness gate expired. Retrieve and
cold-restore the complete second copy, complete reviewed admission and
activation, and pass the applicable seventeen lifecycle phases. Full
lint/typecheck/tests/build/security, independent review, exact-source CI,
protected merge and merged-main evidence remain required. Support starts only
at reviewed activation, lasts one year with continuous security checks, and its
archives remain retained for at least 365 further days; all dates remain null.

PR77's delivered M2 checkpoint remains the diagnostic starting point:
https://github.com/CleMeY15/auto-world/pull/77#issuecomment-6401763287 .
TASK-0005 and TASK-0005A remain `IN_PROGRESS`.

## 2026-10-25 — failed changed-subject managed observation

The A1 source was published for validation as `fbe5bba15210cd9ca859795f83568dc7d1ac7ffe`
(tree `afedc20dca90c55b5ac0e909d4e88fc217e0e7de`, tested merge `7761a8ec`). Quality run
[40235438949](https://github.com/CleMeY15/auto-world/actions/runs/40235438949)
passed: 2,605 of 2,665 root tests with 60 explicit skips, 624 workspace tests,
and 393 browser tests with seven existing exclusions; it had no failure, flaky
annotation or retry.

Managed run
[40235439116](https://github.com/CleMeY15/auto-world/actions/runs/40235439116)
remains failed. All three builds and all seven builder/role audits passed with
zero blockers, and the PostgreSQL notice/export matched the changed source.
OpenSearch public evidence export was refused with the existing generic
`scanner_managed_evidence_invalid` reason. Runtime never started, so no current
four-case result, complete 16-JUnit/1,734-case acceptance or JDK-preservation
result exists for this run.

Independent review verified 14 JSON/SBOM files, 39 text files and 26 source
references. Public artifact `12615400842` is 1,669,225 bytes with SHA-256
`debf1ea09872c658ef8bb1a4352403005e7b735487507ff2c210011eb4ca1726`;
the 107,829-byte receipt SHA-256 is
`9f4684b8de9c1532208b66ed80c8d097027fd973104b4671ef8d56e0acee1033`.
The public artifact has no OpenSearch evidence tree, and the original generic
reason does not recover the exact rejected guard or file. An earlier accepted
XML measured 4,167,803 bytes, below the 4 MiB limit; size is therefore only a
suspect and is not established as this failure's cause.

The follow-up adds only a privately branded, fixed-category diagnostic to a
failed build record. It preserves the generic refusal, every existing limit,
validation order and the no-partial-copy rule; it publishes no raw path,
content, token or native exception. A single managed run on independently
reviewed final source is still required. If that run fails, its safe diagnostic
can support a separately reviewed producer correction; no retry, raised limit
or skipped evidence is pre-authorized. TASK-0005/0005A remain `IN_PROGRESS`.
The user-selected restricted empty destination on `C:` still needs the complete
inventory/capacity decision, actual copy, retrieval and restoration proof.

## 2026-10-26 — actual merged-main OpenSearch test failure

PR198's source `8b8febc0c3f4879e9a5491906bec3e0d056841d4` passed independently
reviewed quality 40238739731 and managed 40238739604. Its normal protected merge
`a52884b2daa44ffd40dc3292a4677a61b6494b1b` has the same tree
`87326c1e6a445d8553b0e4ecf5721e0cf881444f`. Main quality 40240788142 passes,
but [main managed40240788182](https://github.com/CleMeY15/auto-world/actions/runs/40240788182)
fails and independent actual review is REQUEST_CHANGES/HIGH. Delivery remains
unaccepted; no subsequent private-package action is enabled.

This run successfully exports all original OpenSearch text evidence. Its 16 JUnit
files contain 1,734 cases, one failure, zero errors and 48 declared exclusions.
`SharedClusterSnapshotRestoreIT.testSnapshotFileFailureDuringSnapshot` fails
native line 409, expected `0L`/actual `1L`, seed
`[730D258067002B91:4C7F89EA9E3D4D8C]:0`. The runtime Dockerfile correctly refuses
`build.exit-code=1`; OpenSearch is not built/audited and runtime is never reached.
No evidenceDiagnostic exists for a successful export. Public ZIP 12616318808 is
1,985,393 bytes/SHA256
`d92175d56275a019a5c6c476831f82e6209467eb8e8fc156f99ef4dbd921472c`;
receipt 127,129 bytes/SHA256
`84027a97df213469727ae1bd2c64a55450d674dde6fe9e44d1283d1f8beeacb0`.

The original XML shows a mock IOException on the optional
snapshot_shard_paths/dummy-name-list-blobs cleanup listing, followed by snapshot
SUCCESS. The pinned product source catches that optional error; the mock's
global counter still increments. [Upstream issue15845](https://github.com/opensearch-project/OpenSearch/issues/15845)
tracks this test as flaky; no applicable fixed upstream commit was found.
The reviewed correction is limited to test fault scope, with a default-false
exact-path/operation opt-out and deterministic coverage controls. Existing
assertions, product behavior and fresh protected source/main acceptance remain
mandatory. This diagnosis does not establish the cause of the different failed
export 40235439116; its cause remains unknown and its failure is preserved.

## 2026-10-26 — prepared snapshot fault-scope correction

[PR199](https://github.com/CleMeY15/auto-world/pull/199) prepares authenticated
patches to the pinned upstream test class and mock repository only. The new
default-false setting is omitted in the default-behavior control and enabled
only by the original failing test and its explicit positive scope control.
Only the exact auxiliary container's unprefixed listing bypasses synthetic
injection; the delegate still runs. Original assertions, the 0.2 injection
rate, product sources and all other mock paths/operations remain unchanged.

The builder first requires the new scope control to fail specifically with
`Random IOException` and a failure-counter delta of one while the mock source
is pristine. It then patches the mock and requires the same control and the
original failing method to pass at seed `730D258067002B91`. Their original XML,
logs and statuses stay outside the final `junit/` tree. Task-local `--rerun`
prevents an up-to-date test task from qualifying either control or the final
selected internal-cluster suite. The final suite retains all 1,734 original
cases and adds the scope control; no passing-seed substitution is used.

The earlier source and failed-main XML sets have 47 and 48 skips respectively.
The sole additional skip is `XContentParserTests.testWriteDepthOffLimit`, with
`AssumptionViolatedException: got: <YAML>, expected: not <YAML>`. An exact skip
count is therefore inappropriate for ordinary randomized tests. The builder
records actual counts, identities and reasons; the conservative ceiling of
48 skips and floor of 1,687 passes prevent loss of suite coverage. They do not
approve new skip identities or reasons: independent review of the original
XML remains required. The new scope test must execute and pass.

Status remains `SOURCE_FIX_PREPARED / LINUX_VALIDATION_AND_DELIVERY_PENDING`.
Prepared controls are not executed Java evidence. Fresh Linux source/main
quality, causal controls, full suites, image audits, four runtime cases and
cleanup require actual independent acceptance before the next registry step.

## 2026-10-26 — first scope-control configuration failure

[Managed run 40245949857](https://github.com/CleMeY15/auto-world/actions/runs/40245949857),
attempt1, uses PR199 source `fd996f60a87cbf668da1036fe75da88c8d1b6d2f`.
Its original public evidence exports successfully, but the pristine-mock
control stops during Gradle configuration, before compiling or executing the
test: `build.gradle:58` reports that `$JAVA25_HOME must be set`. The explicit
historical reproduction property `-Druntime.java=25` exposes this requirement.
The builder's original version output confirms Temurin25.0.4.1 at the existing
`/opt/java/openjdk` home; Gradle preparation without that property succeeds.

`controls/unfixed/gradle.exit-code=1` is accompanied by
`expected-failure-verified.status=0` and no XML. The seeded control records
`NOT_RUN_UNFIXED_CONTROL_INVALID`; all five final JUnit groups have zero
reports, the suite has zero cases, and `build.exit-code=1` blocks runtime.
Both independent actual reviews return REQUEST_CHANGES/HIGH. This is not the
expected causal RED and provides no snapshot-test success or coverage proof.

Public artifact12618972443 is 1,621,258 bytes; the received original ZIP matches
the API SHA256
`93612b7a58ec3831d8f7a77b874763a2292c8d63be75899afe52f0100cdbdd91`.
The narrow correction defines builder-only `JAVA25_HOME=/opt/java/openjdk`,
pointing to the same pinned, observed JDK. It retains `-Druntime.java=25`,
the recorded seed, all causal controls, full suites and refusal gates. A fresh
source execution and independent review are required; this failure remains
preserved and no passing seed or retry substitutes for the missing proof.

## 2026-10-26 — executed control reveals teardown and RED-verifier defects

[Managed run 40246886682](https://github.com/CleMeY15/auto-world/actions/runs/40246886682),
attempt1, uses source `780fcf11aabde8bf4458d8ade55a01969c6c137f` and confirms
that the Java-home correction permits compilation and actual test execution.
The pristine mock triggers the intended `UNFIXED` assertion, nested exact
`Random IOException` and counter delta1. However, that same testcase has a
second failure from repository-consistency teardown: `Could not find
index.latest blob for repo [scope-control-false]`. The suite's `failures=1`
counts failed testcases, not failure elements, so the negative verifier
incorrectly records success for this impure RED.

After the mock patch, the historical snapshot method passes. The scope
control's body passes but its raw containers still fail that teardown.
The seeded positive phase exits1 and remains unverified. The full suite is
not run; its existing output collection contains only the leftover seeded
class, one report/two cases/one failure. Those are not full-suite results.
OpenSearch construction/audit and the four runtime cases remain unestablished.
Both actual independent reviews return REQUEST_CHANGES/HIGH.

The correction uses the existing upstream empty-repository consistency
exemption only inside the new raw-container control, with an explicit reason.
It preserves all existing methods/assertions and every fault-matrix check.
RED must have exactly one failure element with the exact expected assertion
header; a second or misleading failure is refused by a real Bash regression
fixture. Copied original control XML remains retained separately, and its
working output is removed before final JUnit collection even when the control
is invalid. No seed substitution, retry, policy or limit change follows.

The [pinned upstream helper](https://github.com/opensearch-project/OpenSearch/blob/4ee42a94e87f66fbf1e62a9871b1b87f91e02472/test/framework/src/main/java/org/opensearch/snapshots/AbstractSnapshotIntegTestCase.java#L175-L201)
sets an instance field, with no explicit reset. The pinned
[runner creates a fresh instance per test method](https://github.com/randomizedtesting/randomizedtesting/blob/4dce0536a65a7c837742607c0c1b32a967e46ced/randomized-runner/src/main/java/com/carrotsearch/randomizedtesting/RandomizedRunner.java#L1532-L1582);
this class hierarchy does not override that policy. For the new raw-container
control only, the exemption skips repository-specific snapshot deletion,
repository cleanup and metadata consistency verification, which require a
snapshot repository. The control creates no snapshot metadata. Other history
and listener after-hooks and the general cluster wipe/close still execute;
neighboring original methods keep their own fresh consistency-check state.

Public artifact12619730612 has 1,671,395 bytes and received ZIP/API SHA256
`1cb65c0c77cfab70c385ce561937b7be09284a67e9aafc78a2b1772a5a5dc97a`.
All 105 public evidence references and 32 Git-source identities match; all
six available report/SBOM pairs match. Pure Linux regression tests pass
391 cases with one existing non-Linux exclusion. These positive facts do
not qualify the failed controls, complete suite, runtime or later source.

## 2026-10-26 — complete image builds and audits, refused OpenSearch evidence

PR199 source `e27a693d93e73a059456854ded4fc0e437fb3ab6`, tree
`ab2d7cd737e7d46fae86c7fb6f6acaadb9324108`, passes independently reviewed
[quality40248715246](https://github.com/CleMeY15/auto-world/actions/runs/40248715246),
attempt 1. Root tests report 2,614 passes/60 existing skips, workspace tests 624
passes and browser tests 393 passes/7 existing exclusions, with no failure,
flaky test or retry. Lint, types, build, secrets and dependency audit pass.
These facts qualify this exact source only, not any later revision or main.

[Managed40248715269](https://github.com/CleMeY15/auto-world/actions/runs/40248715269),
attempt 1, passes all three image builds and all seven complete role/builder
audits. The unchanged exporter then refuses one original full snapshot-class
XML with `ENTRY_BYTES`: 4,504,501 bytes versus 4,194,304. Its portable path is
`opensearch/build/junit/server/build/test-results/internalClusterTest/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml`,
path SHA256 `8b3b5be37a7d8f5863a1ac31ce972d6e188c4564387b6b05d18991b73c8956dc`.
The exporter validates the whole source before copying, so no OpenSearch
originals are exported. Detailed RED/GREEN/full-suite acceptance is UNKNOWN;
an aggregate build exit0 is insufficient. The four produced-image runtime
cases never run. Both actual independent reviews require changes; there is
no accepted milestone2, admission or retained-copy proof.

The single received original public ZIP 12619214994 is 1,670,160 bytes and
matches API/local SHA256
`6ed2e0e8a61b7c6b11119f68358bd395e8177c233a56505ba03d6af29b93777b`.
Its receipt is 111,266 bytes/SHA256
`d99718b256a8c8244f0230ad0be3e38f9eff8e968d585fe9e259ec9146bf3332`.
All 32 managed-source Git identities, 43 repository-input identities, 39 available
public references and 14 JSON/SBOM originals match. Pure Linux regression tests
pass 391 cases with one existing non-Linux exclusion. All seven audits have
zero findings/blockers. The 25 owned-absence checks are not runtime-cleanup
proof. This run establishes the specific size refusal only; older export
failure40235439116 retains its unknown cause.

A native-output amendment is under actual ordered review before implementation:
generate compact JUnit through supported Gradle report properties and preserve
every captured stdout/stderr event separately by natural descriptor/destination.
No truncation, lowered logging, arbitrary chunking, raised limit, unchanged
retry or missing-output waiver follows. The exporter, policies, resource
limits and Java test patches remain unchanged. TASK-0005/0005A remain
IN_PROGRESS; B0 stays blocked until complete independently accepted protected
source/main delivery. C: remains the selected restricted empty destination;
complete inventory/capacity/copy/retrieval/restore remains unproved.

## 2026-10-26 — reviewed native-output amendment before implementation

V1 of the evidence amendment (13,129 bytes/SHA256
`ad67c147bb065047c6a89474fc095ac5d1b4b416bddb24de18761e7f8aae0024`)
received actual Architect CLEAR then distinct Critic REVISE. V2 repairs the
four identified ambiguities and receives a fresh actual Architect CLEAR then
distinct Critic APPROVE: 18,930 bytes/SHA256
`3dadb7bbe12b636cc7269efdcefe79e02985f39bcbce0a03db5b41abc3c45d64`.
Its implementation plan is recorded in PR199 before code changes.

The two control XML and three full internal-cluster class reports are generated
natively without embedded stdout/stderr; the other tasks retain their report
configuration. Every captured Gradle message remains in a natural descriptor/
destination stream with strict UTF-8, original newlines and hashes. The listener
uses phase-local object identities and immutable public descriptor fields,
preserving Gradle's actual parent/Unknown attribution without inventing origin.
No XML rewrite, arbitrary split, encoding, truncation or reduced logging occurs.

Only the exact task's end can finalize the capture, including expected RED.
The manifest precedes atomic completion; late output/errors poison capture,
and an independently rejected stderr sentinel prevents a marker-write failure
from hiding behind Gradle exit1. The public afterExecute listener is deprecated
and incompatible with configuration cache; this explicitly bounded diagnostic
uses pinned Gradle9.7.1 and disables that cache for its three test invocations
and inert fixture only. No compatibility with future versions is claimed.

Internal state is limited before growth to 4,094 descriptors, depth64, 16KiB
per string field, 1MiB metadata and one million events; the existing exporter
still enforces 4MiB/file, 64MiB total and 4,096 files. Two file slots are reserved
for the manifest and completion-or-poison marker. A natural output exceeding
the limits refuses rather than splitting or dropping evidence. A native inert
fixture must exercise the actual implementation and public successful/failed
Test task hooks, byte association, budgets and error/late-output controls.

Both Java patch outputs, original assertions, injection rates, seed, full-suite
selection/counts and skip review remain unchanged. The exporter, UTF-8/NUL/
secret checks, policies, pins, deadlines, permissions and admission contracts
remain unchanged. No new dependency or local Java/container execution follows.
Code review and fresh actual source/main quality, causal/full outputs, seven
audits, four runtime cases and cleanup remain required before corrective
delivery or B0. This review approves the plan, not any future result.

## 2026-10-26 — native-output source prepared and independently reviewed

The implementation receives actual independent final source APPROVE after
correcting JSON growth accounting, acquired-directory preservation, final file
identity/hash checks, atomic no-replace completion, channel closure and log
failure handling. A separate fixed-phase Gradle verifier uses the already
authenticated wrapper/Groovy runtime and JsonSlurper to validate the complete
bounded manifest and exact regular-file closure after the capture process.
It checks schema, phase/task, descriptors/lifecycles/parents, UTF-8, stream
bytes/hashes/events, totals, markers and absence of poisoned/temporary output.
Budgets are enforced before growth, reading or hashing. No parser dependency,
new execution pin, exporter change or relaxed limit is introduced.

The native fixture is prepared to exercise the actual capture and verifier implementations,
including successful/failed inert Test task hooks and malformed, missing,
replaced, aliased or oversized evidence. Its real compilation/execution has
not run locally and remains a required Linux CI result. The Bash regression
fixture uses the actual producer functions and an instrumented inert external
wrapper only to test orchestration/exit handling; it does not emulate the JSON
verifier or claim native execution. Initial WSL checks exposed missing helper
injection and an invalid wrapper-call expectation in excluded Linux cases;
those regressions are corrected before any new managed run.

Fresh local OpenSearch checks: 11 cases, 7 passes/4 explicit Linux exclusions,
zero failure. Inert WSL execution passes the real RED/capture/full-suite gate
fixtures and produces Java source hashes
`37515f8b9f7b550a1d0c232768d191cc297f35c24a67ed4a5709a4363071f53e` and
`99cf760087f5045aaec4996a2cacb1f845964217e6dfa67759c379dbe7c0c2bb`,
with reapplication refused without mutation. The existing evidence/archive/
workflow/runtime checks report 188 cases, 160 passes/28 platform exclusions,
zero failure. ESLint, Bash syntax, whitespace checks and Secretlint on 1,176 files
pass. Exporter/policy/workflow and Java patch inputs remain unchanged.

Status is SOURCE_PREPARED / LINUX_VALIDATION_AND_DELIVERY_PENDING. Fresh exact
source quality, actual native fixture, complete causal/full original outputs,
seven audits, four runtime cases and cleanup require independent acceptance,
then normal protected merge and matching main acceptance. Earlier managed
failures remain preserved. TASK-0005/0005A stay IN_PROGRESS; B0, complete private
retention, admission and activation/support remain blocked or unproved.

## 2026-10-26 — native integration fixture and new SeaweedFS audit blockers

[Managed40256368677](https://github.com/CleMeY15/auto-world/actions/runs/40256368677),
attempt 1, uses PR199 head `834adf65aa887571cf6cad7e27a6c82ebabe9681`, tree
`dae0912f5faa039df57e84d085303b8e7378bf30`; its executed PR merge has the same
tree. Original ZIP 1,635,904 bytes matches API/local SHA256
`b03dcf616e40c16220ae23cd3d7c2cad185313ced071240ee39fe45e3fe0b6ad`.
Receipt 134,729 bytes has SHA256
`9bdc42feee604b32169614f957e9dded1db75adb0fc640b6b70c5e0de071242c`.
All 149 public originals are preserved and the 39 managed-source identities
match the reviewed source. Both actual independent verdicts require changes.

Preparation succeeds. The exact fixture stdout sequence (source hash, direct
PASS, source hash) proves that direct-capture and manifest-verifier cases
completed and preparation reached the successful real Test-task fixture.
That integration phase fails within the command/status/capture checks; its
specific error is UNKNOWN because logs, exit status and partial capture are
copied only after every assertion. The failing-task fixture is not run.
The immediate correction preserves each fixed subcase's original diagnostics
before an early exit; this is a source change, not an unchanged retry.

Fixture exit 1 prevents RED, seeded GREEN and full suite execution. There are
zero JUnit reports/tests and no actual control/full manifests. Build exit 1
blocks the OpenSearch runtime image, audit and restored-JDK proof. The four
runtime cases never run; functionalRuntime remains PENDING_NOT_ACCEPTED and
milestone2 remains NOT_ESTABLISHED. The independent evidence helper correctly
refuses the missing unfixed manifest. No earlier positive result transfers.

Separately, the unchanged SeaweedFS 4.50 subject is rejected on two HIGH
occurrences of CVE-2026-92392: curl and libcurl 8.22.0-r0, fixed 8.23.0-r0.
PostgreSQL, Redis and AWS audits pass; scanner/builders are clean. This is a
new current security finding, not a reason to relax the policy. A fixed exact
subject still needs complete independent qualification and runtime acceptance.
Official provenance and four negative controls pass; the vulnerability DB is
2,062,684 ms old and Java DB maxAge remains null. Of 42 recorded commands, only
the OpenSearch construction is nonzero. All 23 owned-absence checks pass;
these are not proof of runtime cleanup. TASK-0005/0005A stay IN_PROGRESS and B0
remains blocked until complete accepted corrective source/main delivery.

Exact-source [quality40256368691](https://github.com/CleMeY15/auto-world/actions/runs/40256368691),
attempt 1, is independently accepted SUCCESS. The executed merge
`51405ca3f3927cc827c4ef936aeae0841b99548c` has parents protected main `a52884b`
and source `834adf6`, with identical source/merge tree `dae0912`. Root tests
report 2,615 passes/60 existing exclusions; workspace tests 624 passes and
browser tests 393 passes/7 existing WebKit exclusions, no failure/flaky/retry.
Lint, types, build, Secretlint on 1,176 files and dependency audit pass. This
qualifies only this source's quality; it neither accepts the failed managed
run nor any subsequent corrective source or matching main.

## 2026-10-26 — fail-safe native fixture diagnostics prepared

The narrow source correction receives actual independent APPROVE: each fixed
fixture subcase publishes its original log and exit status before acceptance
checks. A closed last-subcase status remains running through fallible work and
records failed on interruption, preserving the original exit code. Only fully
validated positive captures are copied; negative scratch is acquired before
copying and removed on exit, including a partial copy failure. No negative
payload tree or premature success marker is published.

Actual inert WSL tests force partial-copy exit 23 and summary-copy exit 37, verify
the exact failed subcase and original code, silent outer output, absent scratch
and no positive capture. The real Bash RED/capture/full-suite regression gates
and both authenticated Java patch outputs still pass. Node 11 reports 7 passes/
4 Linux exclusions; ESLint, Bash syntax, whitespace and Secretlint on 1,176 files
pass. Capture/manifest-validator implementation, Java, build logic, pins,
exporter, policy, permissions and limits remain unchanged. The integration
failure's exact cause remains UNKNOWN; one reviewed changed-source Linux
diagnostic is required before selecting its underlying correction. SeaweedFS
remains independently rejected, with its ownership decision separate and pending.

## 2026-10-26 — original diagnostics isolate missing fixture parent

[Managed40258870280](https://github.com/CleMeY15/auto-world/actions/runs/40258870280),
attempt 1, tests source `a8113803979d50eb015b32e12458e1b76757a5fd`, tree
`3af09a471963120f0e9e2428c3a388d589f66f4d`. Its synthetic merge has that same
tree. The unique original ZIP is 1,655,581 bytes and matches API/local SHA256
`4033df919dff6acc8e626dcef57e3a46be6058c1e8014ba56014b55730eb347e`.
Independent review checks all 130 public evidence files against receipt hashes.

Original diagnostics now record `success-exit/failed`, successful-Test Gradle
exit 1 and `AUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR`. Direct capture passes;
the valid manifest passes and all eleven invalid manifest controls refuse.
The expected-failure Test fixture explicitly remains NOT_RUN. No RED/GREEN,
full suite, OpenSearch image or runtime acceptance follows.

The generic sentinel does not expose the caught exception. Both actual reviews
nevertheless establish the preparation defect from the authenticated source:
`prepare_fixture` creates the project but not its `build` directory; Test actions
are explicitly cleared, and the first fixture action starts capture below
`build/integration-success`. Capture validates every pre-existing ancestor before
creating its destination, so the absent parent fails acquisition. Direct mode
separately creates its parent and is unaffected. This is a source-grounded
diagnosis, distinguished from the unavailable original exception text.

The bounded repair creates a fresh owned `build` parent in fixture setup before
any Gradle invocation. The inert wrapper must assert this precondition rather
than manufacture the directory, and a native negative capture case must prove
an absent parent is still rejected without creation. The capture/validator core,
Java patches, pins, limits and policies remain unchanged. Actual source review
now passes; one fresh changed-source Linux run remains required, with no
unchanged retry.

The separate SeaweedFS curl/libcurl findings remain blocking. Five other audit
lanes pass, vulnerability DB age is 3,891,715 ms within 48 hours, and Java DB has
no maximum-age policy. JDK before/after hashes agree. Of 42 recorded commands,
only OpenSearch construction is nonzero; all 23 owned-absence checks pass,
without establishing runtime cleanup. Provenance and its four refusal probes
pass. TASK-0005/0005A remain IN_PROGRESS; B0, protected source/main delivery,
retention, admission and support activation remain open or blocked.

The final caller-only repair receives actual independent source APPROVE on:

- verifier shell: 15,190 bytes/SHA256 `c38bf6562bfb49e1afa7b86afb3370160498d3e49b101b6773e871b59f32ae39`;
- native fixture tail: 20,918 bytes/SHA256 `fd8ce9a1ebf7351e712347055d2b576faf87201113dbf01c89ec9feb8df6224f`;
- Node regression: 45,314 bytes/SHA256 `ac2e9b0f1f52d252ecc18441add2c9c34a5aea3ddee4ca453e1f65a7a427c1bd`.

The root independently executes the actual regression helper under WSL using
fresh isolated temporary roots. Corrected setup traverses direct and twelve
manifest-orchestration cases and reaches the successful-Test wrapper, which
checks the owned non-symlink parent before emitting its marker and fixed exit42.
A generated old setup without the three parent-creation lines fails at the
first invocation and cannot emit that marker. Both publish the expected failed
step without a positive capture. This wrapper is an orchestration test double,
not native Gradle or JSON-verifier execution. The existing original-exit 23/37
fault tests, real Bash causal/full gates and authenticated Java patch outputs
also pass in that isolated harness. Local Node reports 11 cases: 7 passes and
4 explicit Linux exclusions, zero failure. Syntax, ESLint, whitespace and
Secretlint on 1,176 files pass. The added native missing-parent case and full
Linux acceptance remain pending; prior positive quality does not transfer.

## 2026-10-26 — native fixture passes; included-build registration fails

[Managed40260470337](https://github.com/CleMeY15/auto-world/actions/runs/40260470337),
attempt 1, tests `a5e21da461a50be946d3480e3cbd60babe28716d`, tree
`5c9936ff8db4dbce156cfdc41b124ac207c0777e`. Executed merge
`2f308ffe9427e527c187492e426a973284300a72` has parents protected main `a52884b`
and source `a5e21da`, with that exact tree. Unique original ZIP: 1,660,524 bytes,
API/local SHA256 `c197b22d9782ab3efe92e18a3b454fa59a142f11000d809f58129b9986b4a089`.
All 141 public files match receipt identities. Both actual reviews require changes.

The complete native fixture now passes: direct cases include the authenticated
missing-parent refusal; all twelve manifest controls behave as expected;
successful Test exits 0 and expected-failure Test exits 1, each with COMPLETE
capture and zero capture errors/open writers. The outer fixture exits 0 and
records `complete/passed`. This proves the previous caller-parent correction.

The real RED invocation then fails configuration at init line 949:
`Task with path ':server:internalClusterTest' not found in project ':missing-doclet'`.
No expected RED marker or unfixed manifest exists; its verification status is 0.
GREEN is NOT_RUN_UNFIXED_CONTROL_INVALID; full suite reports/cases are 0.
No OpenSearch runtime image, causal/full streams, JUnit/skip result or runtime
acceptance follows. SeaweedFS independently retains its two HIGH findings.
The other five builder/service audit lanes pass; DB vulnerability age is
5,079,917 ms within 48 hours, Java DB maxAge remains null, and JDK before/preserved
identities agree. Only OpenSearch construction fails among 42 commands;
23 owned-container absence checks do not establish unexecuted runtime cleanup.

The global init also runs in included builds. A narrowly scoped registration
guard must select the main Gradle build while retaining mandatory `getByPath`
and `Test` type checks there. Actual research of pinned Gradle9.7.1 establishes
the public `gradle.parent == null` selector: [public API](https://github.com/gradle/gradle/blob/92f0512e7f06d84621afba191f75e265363890cf/subprojects/core-api/src/main/java/org/gradle/api/invocation/Gradle.java#L93-L99),
[root/parent implementation](https://github.com/gradle/gradle/blob/92f0512e7f06d84621afba191f75e265363890cf/subprojects/core/src/main/java/org/gradle/invocation/DefaultGradle.java#L164-L185),
and [included/buildSrc ownership](https://github.com/gradle/gradle/blob/92f0512e7f06d84621afba191f75e265363890cf/subprojects/composite-builds/src/main/java/org/gradle/composite/internal/DefaultIncludedBuildRegistry.java#L181-L244).
The non-null parent guarantee for included builds is verified at this pin,
and requires revalidation on upgrade. No configurable production-root override,
task-existence fallback or swallowed lookup failure is introduced. A real native
composite configuration test must prove child exclusion and main registration;
the existing causal/full gates must subsequently prove actual main capture.

The independent ignored evidence helper is corrected to discover business
manifests only under the exact `build/test-output/{unfixed,seeded-fixed,full}`
root. Native fixture manifests are separate evidence and no longer falsely
collide with `full`. Isolated discovery regressions pass, while this same actual
artifact still correctly refuses `missing capture manifest for unfixed`.
No missing capture is waived. TASK-0005/0005A remain IN_PROGRESS; source/main
acceptance, B0, complete retention, admission and activation remain pending.

Exact-source [quality40260470341](https://github.com/CleMeY15/auto-world/actions/runs/40260470341),
attempt 1, is independently accepted SUCCESS for `a5e21da`/tree `5c9936ff` and
the same executed merge `2f308ffe`. Node22.23.2/pnpm10.15.0 gates pass: lint14,
types21, test28 and build14; root 2,615 passes/60 existing exclusions, workspace
624 passes, browser393 passes/7 existing WebKit exclusions, no failure/flaky/retry.
Secretlint passes 1,176 files and dependency audit finds no known vulnerability.
Original log: 1,943,001 bytes/SHA256 `ad136d3701ff1a86a6b0cce4e43a7538274d60295ddbd83c922ff23e44402b44`;
summary: 5,298 bytes/SHA256 `49cfb2fceb2751c3237a110cb063499e26cc12e2fb0e560e9eecf933c58f033a`.
This accepts only this exact source's quality, not its failed managed run,
the next correction or protected main. The preceding `a811380` quality40258870277
remains automatically CANCELLED during browser-dependency installation;
browser, Secretlint and dependency audit were not run there.

The final eight-file scope correction receives actual independent source
APPROVE. The init is 39,276 bytes/SHA256
`e99d00b81b0cf76beebcd76819d2d2d155a3b43edad2357d29045800d951c5a5`;
its capture classes above the installation block are byte-for-byte unchanged.
The fixture driver is 16,576 bytes/SHA256
`10236902385e300e1e3dcbbeb90521de873a316a5878f29ac659cd18e93949cd`.
The composite child has no server task and asserts its non-null parent and
the same valid phase. Its dependent root probe checks both native JUnit flags
were set to false and that the Test has not executed. Thus this lightweight
probe proves registration scope, not task completion; actual RED/GREEN/full
capture gates remain mandatory. Original scope log/status are retained before
checks, and an unexpected capture directory or sentinel refuses the fixture.
Recursive Docker/source/evidence collection includes both new child sources
without changing the exporter. The manifest verifier, Java, `build-core.sh`, pins,
policies and caps stay unchanged.

Fresh Node reports 11 cases: 7 passes/4 explicit Linux exclusions, zero failure.
Syntax, ESLint, whitespace and Secretlint on 1,178 files pass. The root's isolated
WSL harness executes actual driver orchestration through scope status/markers,
the existing fault/refusal gates and authenticated Java patch outputs, without
Java or container execution. Its wrapper is a test double, so no native Gradle
or JSON-verifier acceptance is claimed. The real native composite and complete
changed-source/main results still require fresh independent acceptance.
