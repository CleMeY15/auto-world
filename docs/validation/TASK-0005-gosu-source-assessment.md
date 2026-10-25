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
| A — prerequisites | Bounded source/advisory verdict plus complete retention inventory, measured capacity and selected private destination | source reviewer, retention reviewer, root; user supplies destination | Current material is sufficient or precisely refused; complete destination and capacity are concrete |
| B — final subjects | Approved least-privilege private package plan, exact subject retrieval, independent audit/runtime, complete private closure, then separate official signature and refusal controls | root, ordered reviewers, read-only verifier and separate signer | Exact subjects pass all pre-signing gates and their signature/private recovery evidence is accepted |
| C — acceptance | Current final-identity evidence, complete second-copy cold restore, reviewed admission/activation, applicable seventeen phases and protected delivery | root, ordered reviewers and independent result reviewer | All task acceptance criteria and DoD pass on admitted identities; support dates start only then |

### A — concrete prerequisites

The source-review criterion above is prepared. The private second-copy
destination remains pending user input. The dated measured raw-layout subset
from main run40221700632 is 6,729,966,067 bytes; with 25 percent working
headroom it is 8,412,457,584 bytes. These measured sizes do not prove current
availability, a private copy or restoration capability.
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
