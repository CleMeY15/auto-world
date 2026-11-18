# TASK-0005 — Gosu offline input reconstruction

## Accepted diagnostic delivery — 18 November 2026

The final checkpoint in the [PR250 body](https://github.com/CleMeY15/auto-world/pull/250)
records MAIN_ACCEPTED for source `2d204d5222a1a3832697752a49bbd05bc9394120`,
main `0c2b3d6c1e67c665f7cd1718f18703baf673409e`, identical tree
`5315861787a641cc8f7d2d15edf7d6005a943478`. Six main workflows ran on attempt 1. Five succeeded.
The raw upstream audit failed with 243 unwaived blockers. The independent
review verified all six results. Managed run 44249041549
retains the first-runtime command25 trace:1201 bytes, SHA256
`d4a9c96ee0160992ff85c5832d9b174e704831a4e0acdb987814645f33ef6053`,
four ordered markers/DONE, uncached.
Earlier pending source/main statements below are historical for this increment;
the rejected source run lacking this trace remains rejected. The immutable plan
is unchanged. Seven-data sufficiency under the supplied compiler is accepted,
not complete material retention. Next: the [preparatory capture proposal](TASK-0005-postgres-gosu-material-capture.md),
PLAN_REVIEWED / DOCUMENTATION_DELIVERY_PENDING, no operational authority.

Status: `SOURCE_IMPLEMENTED / HOSTED_VALIDATION_PENDING`, 18 November 2026.
TASK-0005/0005A remain IN_PROGRESS. No representation, retention or admission
success is asserted until the applicable actual source/main evidence passes.

## Identity, scope and ordered design review

Owner: TASK-0005 coordinator, branch `codex/task-0005-gosu-offline-inputs`,
base `7c49d34db9191db5459b0640c24b53fd24cbaf5b`. The base documentation delivery
is accepted by [PR249's checkpoint](https://github.com/CleMeY15/auto-world/pull/249#issuecomment-6966235450),
using quality attempt 2 and original tooling attempt 1. Quality attempt 1 stays
CANCELLED / REQUEST_CHANGES; recovery did not alter code or gates.

The [plan](../../roadmap/plans/TASK-0005-gosu-offline-inputs.md) is preserved as
the exact reviewed candidate: 14,061 bytes, SHA256
`e28c77cda512e15fcfb41f1cea317ac0259736027639fcfe5e015de3cf649fe4`.
Its initial pending status is historical. Actual Architect approval preceded
distinct Critic approval on identical bytes, before implementation. Private
reports: `.local-data/gosu-offline-architect-nsb0nhar/REPORT.md` (SHA256
`c7f85bf609c11d5e982cdad159273d5c1b638d872951ae2fd9cd92bb3e24c557`) and
`.local-data/gosu-offline-critic-cl5v96v9/REPORT.md` (SHA256
`6a83763493b4a214b0d6fe491ff8dfa090b898e7268bc95bdfe061dc01721ec1`).
Their manifests and unchanged plan/1,452 tracked files were independently
rehashed by the parent. This approves the narrow implementation design only.

All roles: Codex gpt-6-astra / ultra. Parent owns Dockerfile/helper/tests and
integration; one native implementation child owns audit/parser tests. Reviews
use distinct contexts. One quality command at a time in this checkout; no
other worktree, port or running service is owned by this increment. Infrastructure
maintenance is outside the product pilot cohort; costs remain unknown.

## Implementation and verification

The sibling stage copies the pinned source archive and six named proxy files,
authenticates them against the producer's TSV, and uses fresh source/cache roots
with a local-only proxy and Docker network denial. Two native acquisitions each
omit a different ZIP. The complete-input build must match the original binary
and pin. Only the checked filename line of new build-info text is normalized;
the historical binder and its 900-byte proof stay unchanged.

Runtime consumes the new stage's success receipt but keeps its binary from the
existing functional-test stage. Only the PostgreSQL runtime solve forces fresh
execution of the new stage. Its actual logs must establish this execution;
the evidence solve may reuse or repeat it. No third solve or cache exporter.
The bounded JSON is exported as text, bound to captured bytes, the same TSV and
image/archive, and validated before the mandatory Gosu source evidence is enabled.

| Gate | Current result / limit |
| --- | --- |
| Ordered plan review | Architect APPROVE, then distinct Critic APPROVE; identical candidate |
| Targeted boundary/integration tests | Initial 66 passes; final managed scope 749 passes / one existing skip. Helper uses explicitly labeled compiler fixtures, not native compilation |
| Lint / types / build | PASS: lint 14 uncached tasks; types 23 uncached; build 14 successful / 13 cached |
| Root / package tests | PASS after documented environment correction: root 3,296 / 123 local exclusions; packages 776 numeric passes plus two smoke suites; 28 tasks / eight cached prerequisite builds |
| Secrets / dependency audit | PASS on 1,457 tracked files; unchanged full low audit reports no known vulnerabilities |
| Independent implementation review | Early frozen code APPROVE_SOURCE_CODE_SCOPE; architecture CLEAR_IMPLEMENTATION_ARCHITECTURE. Final guard/doc delta reconciled by parent; hosted source-readiness review pending |
| Local browser | Not run: port 3210 belongs to another active session. Hosted full coverage remains required |
| Actual source/main managed proof | NOT_ESTABLISHED; actual uncached stage, both native refusals, equal binary and captured receipt required |
| Source/main quality and other applicable workflows | Pending; old successful runs cannot substitute |

Local tools: Node v22.23.2, pnpm 10.15.0. First complete implementation presentation:
18 November 2026 at 02:10:31 UTC, with the browser/native limits above;
implementation is not delivery acceptance. Hosted managed
uses its existing pinned runtime; no runtime pin or workflow permission changed.

Private local records are in `.local-data/gosu-offline-validation-04277u5_`.
The initial managed run failed only the old whole-file audit SHA guard; its
exact update preserves the adjacent native-output caps. The first root run had
162 failures: the session's umask 0002 and tmpfs `/tmp` violate existing private
fixture contracts, and the enlarged audit source correctly reaches its historical
intake cap before identity comparison. That test now requires the exact earlier
refusal, preserving the immutable qualified size and all production code.
A diagnostic using an overly long private TMPDIR was stopped after its Unix
socket path exceeded the platform bound; its one identified mock socket was
removed after the owned process exited and no listener remained. A short owned
ext4 TMPDIR with umask 0077 passed all 119 targeted diagnostic cases, then the
complete root/package command. Original failures and diagnostics are retained.
The 123 local exclusions do not establish hosted exclusion parity.

Independent static reports: `.local-data/gosu-offline-code-review-4b9hwypq/REPORT.md`
(SHA256 `7d3c62eba63072e6a5a681bdc0b499e3efaf83217a17f4ed731a15de5ed4d288`)
and `.local-data/gosu-offline-implementation-architecture-vo0146gp/REPORT.md`
(SHA256 `10d048f3cda2ee426a72bde03568053a2765aa6b291dedc3fcd886b02a6f4610`).
Both verified 1,457 candidate files unchanged; parent rehashed their complete
manifests. Subsequent executable implementation bytes are identical; only the
two precise test guards and validation facts changed. Actual source/main gates
and independent original-result reviews remain required before acceptance.

## Remaining gates and rollback

### PR250 trace-retention correction, 18 November

The first source managed run `44221570880`, attempt 1, succeeds operationally,
but its independent final review is **REQUEST_CHANGES**: the original artifact
does not retain the first runtime solve's BuildKit trace. This run cannot prove
the explicit uncached-RUN criterion, and its later exported JSON cannot replace
that observation. The failure is preserved; no historical transcript is invented.

The correction selects only the existing helper's native RUN header, four fixed
markers and DONE from that first PostgreSQL/runtime command. Plain-printer
interleaving may repeat the identical header and `...` separator for the same
vertex; a different vertex/header, CACHED/error/cancellation, missing/repeated or
reordered markers, incomplete output or oversize evidence refuses acceptance.
The helper, compiler, seven data inputs and functional runtime binary are unchanged.

`managed-gosu-runtime-trace.json` is a separate, explicit upload entry, maximum
8 KiB/64 selected lines from at most 8 MiB of command output. It preserves the
selected lines exactly, the run/checkout/command ordinal, runtime target and
hashes of the arguments and complete private streams. It does not export other
command output, arbitrary diagnostics, host paths or environment. The command
record and PostgreSQL build bind its size/hash. Capture is required before the
runtime build can be marked passed; the evidence solve cannot supply it.
No broader wildcard, permission, deadline, builder or third solve is introduced.

Focused tests cover the parser, actual command wrapper, upload boundary and
existing runtime/evidence calls. They are synthetic syntax/boundary fixtures,
not native execution. New source and main runs must still furnish the actual
trace and all previous gates before acceptance. The immutable original plan
remains unchanged; this fixes its missing observation channel. Rollback removes
the selector and explicit upload entry together, preserving the rejected run.

Final local correction checks pass: 107 focused tests; 3,318 root passes with
123 local exclusions; 776 package passes plus the two smoke suites; lint,
typecheck, build, secrets and the unchanged full low audit. The first root run's
one structural-guard failure is retained: it counted the expected-arguments
constant as a third Buildx invocation. The corrected guard counts the two actual
calls and retains the Seaweed mapping assertions. Architecture review is CLEAR;
the code review's LOW BOM-fidelity finding is corrected, with BOM and incomplete
final-line refusals covered. These are local source results; browser execution
was unavailable on the occupied port 3210, and hosted/native acceptance is pending.

Format references: BuildKit's [plain printer](https://github.com/moby/buildkit/blob/master/util/progress/progressui/printer.go)
and [RUN display name](https://github.com/moby/buildkit/blob/master/frontend/dockerfile/dockerfile2llb/convert.go).
These explain syntax only, not the installed backend version or a native run.

This can establish sufficiency of seven selected data payloads under the same
supplied compiler, not a complete PostgreSQL material closure. Historical proxy
hashes are observations, not new future pins. Compiler/OS/base source closure,
durable payload capture, complete inventory/capacity, two copies and cold retained
restoration remain open. Scanner's accepted C:/NTFS row is unchanged; no new
publisher or copy/restoration is run. Rust binary equivalence, image admission,
support dates and final lifecycle remain open; 243 raw blockers remain unwaived.

Rollback removes this diagnostic stage, separate observation and its tests while
preserving original source binding, archives, failure history and other worktrees.
