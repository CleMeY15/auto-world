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
