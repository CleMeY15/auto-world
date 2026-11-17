# Picomatch security tooling maintenance — 17 November 2026

Status: BOUNDARY_CORRECTION_LOCALLY_VALIDATED / DELIVERY_AND_RECHECK_PENDING. Focused prerequisite for the
unchanged dependency gate, not product delivery or image admission. Parent owns
independent final review, PR247 reconciliation and delivery; this implementation
does not alter PR247 or its evidence. TASK-0005/0005A stay IN_PROGRESS and the243
historical upstream blockers remain unwaived.

## Brief, identity and execution contract

- Owner: implementation Codex in `t3/remove-picomatch-blocker`, isolated checkout
  `t3-8da1b84a-629d875efdb3e211`. Verified clean base:
  `f630339b791731b6111bb8fd340fd6874c392826`.
- Actual implementation and one disjoint secret-runner specialist settings:
  Codex `gpt-6-astra`, `ultra`. Specialist authored source, not independent review.
- User authorized the focused dependency correction, local checks and draft PR;
  no merge, publisher, scanner, image registry, Nexus, SSH or service operation.
- Criteria: [DoD](../DEFINITION_OF_DONE.md), [security contract](../security/SECURITY_LEGAL.md),
  [workflow](../DEVELOPMENT_WORKFLOW.md), and the parent private
  `.local-data/picomatch-remediation-20261117/TASK.md`. This record incorporates
  the [task brief](../../roadmap/templates/TASK.md) and [validation template](TEMPLATE.md).
- One owner and one quality/install process at a time in this checkout. Native
  fixtures use an owned ext4 temporary directory outside the Git ignore tree,
  recorded privately in `.local-data/picomatch/tmpdir`. Node22.23.2, pnpm10.15.0.
- No UI, production data, persistence migration or new runtime service; visual
  review is inapplicable, but the existing automated browser gate remains required.
- Outside the six-product-task pilot. Cost, tokens, human time and savings:
  unknown. Reassess after two identical failures without new evidence.

Plan: capture original inventories and diagnostics; replace both actual dependency
consumers; qualify differential selection, security and installed graph; serialize
all final gates; submit a draft for independent review and source/main delivery.

## Change and patch lifecycle

The original full low-threshold audit reproduces HIGH
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), with no
published fixed Picomatch version in that baseline. No advisory exemption,
severity reduction, rule removal, version disguise or vulnerable test dependency
is used.

1. Official `@secretlint/node13.0.5` and `ignore7.0.8` replace the CLI/walker.
   The recommended preset and configuration stay unchanged. The all-Git-file
   high-confidence pass still precedes ignore filtering; official engine batches
   remain100 files, in isolated subprocesses, with masking/stylish output and
   exit0 (clean),1 (findings),2 (fatal). The literal selector preserves the
   leaf-to-root ignore cascade, `.secretlintignore` then `.gitignore` precedence,
   default-rule overrides and all-ignored fallback. It does not offer a public
   general-purpose glob CLI.
2. Exact `@typescript-eslint/typescript-estree@8.69.0` runtime patch uses published
   `glob14.0.6` through `glob/raw`, avoiding the default bundled matcher. Exact
   packageExtensions adds glob; the exact-parent override removes tinyglobby from
   actual resolution. Editing package.json inside a patch is not relied upon.
   `allowUnusedPatches: false` and frozen lockfile bind patch identity; regression
   tests exercise the installed resolver and actual require identities.
3. Only `glob@14.0.6>minimatch` resolves11.0.9 (supported by its range). Existing
   unrelated minimatch11.0.4 consumers and their regression remain unchanged.
   The adapter preserves per-pattern Map priority, native depth-first directory
   order, case/dot-sensitive ignores, missing literals, lexical symlink paths and
   the former walker's related-symlink cycle boundary. Broken links are omitted.

Patch provenance: original installed estree8.69.0 `resolveProjectList.js`, published
package under its existing license; repository-owned `projectGlob.js` is added by
pnpm patch. [pnpm patch](https://pnpm.io/cli/patch),
[dependency overrides](https://pnpm.io/settings#overrides),
[glob public API](https://github.com/isaacs/node-glob).

On an estree, glob or matcher update, rerun the ordered corpus, type-program
priority, bounded adversarial child, full lint diagnostics/selection and all
quality gates on Linux and Windows. Do not carry this exact patch onto a different
estree version without inspecting its consumer. Remove the patch, extension and
removal override together when upstream drops the vulnerable route or a genuinely
fixed original dependency is available and qualified. Remove the scoped matcher
pin only after qualifying the replacement resolution. The unrelated override has
its [own lifecycle](minimatch-security-2026-11-04.md).

## Explicit compatibility limits requiring independent review

The golden original results are preserved, not rewritten to make replacement
output pass. Ordinary corpus cases compare exact ordered Map entries. Three
original cases instead assert an explicit configuration error (bare/unfinished
parentheses and negative extglobs). Broader discriminating probes found:

- Picomatch `a(b|c).json` matches both literal parentheses and `ab.json`/`ac.json`;
  glob matches the literal only.
- Picomatch `!(ab).json` also excludes `abc.json`; glob includes it.
- Padded/stepped `a{01..05..2}.json` yielded no old matches but glob expands it.

The adapter refuses those forms in projects AND active ignores, with an error
asking for explicit paths or brace alternatives. After independent review, the
range contract is narrowed to ascending, unsigned single ASCII digits (`{0..9}`
or a subrange, including equal endpoints). Multi-digit, signed, padded, stepped,
descending, alphabetic, unfinished and nested range constructs are refused.
All 55 admitted endpoint pairs are tested as projects and active ignores, and a
bounded original-consumer differential capture qualifies all 110 selections.
Within expanded glob patterns, unescaped parentheses must form balanced positive
extglobs (`?`, `*`, `+`, `@`);
a backslash-escaped operator cannot introduce a group. Bare, negative and
unfinished groups fail explicitly; escaped literal parentheses remain available.
Backslash-escaped braces are unqualified in expanded project patterns and active
ignores and fail explicitly. The original classifier can treat such an entire
expression as a missing literal even when the new matcher would expand it. Use
explicit unescaped literal project paths for filenames containing braces.
These syntax guards define deliberate restrictions around the qualified corpus;
they do not claim universal Picomatch grammar equivalence. No new regexp engine
attempts unsafe equivalence, and no type-aware rule is disabled. Existing repository
configurations do not use the refused optional forms. Independent recheck remains
required before acceptance.

Secret output order was observably asynchronous in three original captures;
replacement uses deterministic literal input order. All15 original batches retain
coverage. A POSIX filename containing backslash was silently omitted by the old
CLI; the new runner scans its actual bytes. Directory inputs (outside the internal
Git-file API) fail closed. Existing `..config` ancestor-seeding behavior is retained.

## Baselines and experiments

Private evidence root: `.local-data/picomatch/` in this checkout; manifest supplied
at handoff includes hashes of raw artifacts and failed experiments. Parent design
reports were read before implementation and hashes verified:

- Secret design: `5be6cc361e64be73b3b7178c34068e4e6be1d5aa2637faf75bf2f3714e35a12b`.
- Project design: `d89259b361b4bc52fe179498e843650d11dc9a04838e6ff0166101f16fc688c6`.

| Evidence | Result before final gates |
| --- | --- |
| `baseline-install.log`, `baseline-audit.log` | Frozen base installed; expected HIGH audit failure |
| `baseline-lint.json`, `candidate-lint.json` | All720 existing root/workspace selections and diagnostics unchanged; four added implementation/test files selected |
| `baseline-projects.json` | Original25 synthetic project cases plus repository Map, captured before removal |
| `candidate-projects-final.json` | Initial candidate exact ordered match; subsequent grammar probes led to explicit restrictions above |
| `classification.json`, `grammar.json` | Broader classification/grammar differences retained as discriminating evidence |
| `secret-baseline/repository.json` | 1,441 original Git candidates /15 batches; SHA256 `a3652c6b3a0923c1dd1794195642c08575a1cfed5d7ed2369eabe21b0dc1279c` |
| `secret-baseline/corpus.json` | Seven original selector cases; SHA256 `f8983b99323925644cedcdc9a75b86a8755c26b12eab62b0695fdb12f6ae2256` |
| `secret-baseline/candidate.json` | Zero coverage removed; one literal-backslash coverage addition; SHA256 `71c9adaa2b9040eb82a34c7ee45c0ff59e95a26f0eb5c5c041e3dfac769568eb` |
| `targeted-all-2.log` |21/21 passed before final Windows path-root correction; final gates retest source |

Failed experiments remain private: first unbounded symlink-follow candidate hit
its20-second child timeout; explicit old cycle boundary fixes termination. Broken
symlink selection was corrected. First portable project test used a hard-coded
fixture parent name; it was corrected without changing golden results. Secret
ignore parsing initially passed whole multiline files as array entries; fixed to
add each file's string in order. A second positive-token failure was caused by
placing TMPDIR beneath ignored `.local-data`; moved to owned ext4 storage outside
that ignore tree, without weakening assertions. No tmpfs native gate is waived.

## Final verification and delivery

Final source/tree and serialized gate results are recorded at handoff. Required:
fresh frozen install, targeted regressions, actual dependency closure, lint,
typecheck, root/package tests, build, browser suite, secrets and unchanged full
audit. `.github/workflows/tooling-compatibility.yml` adds a focused Linux/Windows
installed-patch and selector regression alongside all existing CI gates. Hosted
Windows results and independent final source/security review remain pending.

First complete presentation: not yet presented. Draft/source/main checks and
independent review are not inferred from local results. No Done or image-admission
claim. Parent owns any reconciliation of PR247 after this maintenance is accepted.

Rollback: revert this focused source/config/lockfile/test/workflow change together;
this restores the known audit blocker and does not authorize delivery. Preserve
private failed and baseline evidence. No production state or historical evidence
is migrated or rewritten.

### Native test environment correction

Initial frozen source `08d44ddcd36ad19abadb8a8b38c0d17a5f5bc4e8` passed lint,
typecheck, build, secrets and full audit. Root tests failed (3,301 total;
3,049pass/129fail/123preexisting skips), so package tests did not run. Evidence:
`final-test.log`. Inherited umask0002 and five ext4 fixture helpers hardcoding
`/tmp` bypassed the owned TMPDIR. Those five test helpers now use `os.tmpdir()`;
all production guards, expectations and platform skips remain. README documents
umask0022 plus an owned ext4 TMPDIR outside ignored repository paths.

The diagnostic targeted rerun passed those native suites and permission-sensitive
attestation fixtures. It also caught an unnecessary temporary change to the
unrelated Docker socket fixture: longer TMPDIR paths violate its bounded Unix
socket contract. That edit was reverted; its original `/tmp` fixture is preserved.
The failed experiment remains `native-targeted.log` (273pass/87fail/2skips); all87
failures belonged to that reverted fixture edit. No daemon/image operation was
performed; these were existing synthetic/mocked tests. A complete final-source
rerun is required below.


### Frozen-source final results

Validated code revision `709d0e682215a4adbf83df01337d30de7a81ead1`, tree
`2688069300b03686c2d2e1a84e8eea04232e0435`; tracked state clean after checks
(`validated-source.txt`, empty `validated-status.txt`). The following documentation
update does not change implementation, fixtures, patch, dependency lock or CI.

| Gate | Result / private artifact |
| --- | --- |
| Fresh frozen install | PASS, `fresh-frozen-install.log`; node_modules removed from this checkout first |
| Installed graph | PASS, all15 workspaces, zero forbidden package keys/store directories; `installed-graph.json`, `graph-check.json` |
| Targeted compatibility/security |21/21 PASS, no skips; `qualified-targeted.log` |
| Lint | PASS,14/14 workspace tasks cached; root ESLint ran; `qualified-lint.log` |
| Typecheck | PASS,23/23 tasks,22cached; `qualified-typecheck.log` |
| Root tests |3,178pass /0fail /123pre-existing exclusions,3,301total; `qualified-test-final.log` |
| Package test graph |28/28 tasks PASS,13cached; `qualified-test-final.log` |
| Build |14/14 tasks PASS,13cached; `qualified-build.log` |
| Secrets |1,449 files PASS; `qualified-secrets.log` |
| Full unchanged low-threshold audit | PASS, no known vulnerabilities; `qualified-audit.log` |
| Browser | BLOCKED before tests: fixed localhost3210 occupied; `final-browser.log` |
| Windows/Linux hosted patch gate | Added, pending source CI |
| Independent source/security review | Pending parent; grammar restrictions require explicit review |

After the native-path correction, root tests had four remaining attestation
context failures (`qualified-test.log`:3,174pass/4fail/123skips). Inspection found
this T3 checkout itself inherited mode775 and tracked files664. Removing only
group/other write permission from the owned checkout root and tracked regular
files restored the unchanged guard's required environment. No executable bit or
Git content changed. `checkout-permissions.json` records original/new modes;
`attestation-environment.log` then passes, and the complete root/package rerun
passes as above. This is new diagnostic evidence after the previous failures,
not an unchanged retry or a waiver.

The browser command returned exit1: `http://localhost:3210 is already used`.
No test ran, no foreign process was stopped/reused, and no configuration or retry
threshold was changed. A network-namespace probe also failed with
`unshare: write failed /proc/self/uid_map: Operation not permitted`; no namespace
fallback or infrastructure operation followed. Smallest remaining remedy is the
unchanged hosted browser CI (or an explicitly available local port3210).

Draft is reviewable with these limits, not a complete delivery. Source/main gates,
hosted Windows qualification and distinct independent review remain required.
Parent retains PR247 and its observation-policy/evidence ownership. First fully
complete local presentation remains not established because browser qualification
is blocked. All prior failed runs remain in the private manifest.

### Parent correction after the first Windows compatibility run

Source8543c637's tooling run44159780506 passed on Ubuntu but failed on
Windows (job134310161831). Its first reported `all` case contains exactly the
same30 paths as the original Linux golden capture, but NTFS orders the two
`[literal]` paths differently. The original fdir walker and the replacement both
intend native depth-first directory order, not one universal collation.

The original golden file remains unchanged. The test now traverses a trie of
the captured expected paths in native `readdir` order, independently of the
adapter's rank-sort and without using actual results to construct expectations.
Literal priority and successive glob groups stay explicit. Linux additionally
asserts exact agreement with the untouched original ordered capture. Each corpus
case is a subtest so one failure does not conceal later Windows cases. This is
not a sorted-set comparison and does not relax membership or project priority.

The first local correction exposed the escaped-star case's missing literal,
which correctly requires no filesystem enumeration. That test-oracle mistake
was corrected and its failed run retained. The final targeted command passes
46 tests, zero failures/skips (21 outer tests plus25 corpus subtests). Runtime
patch, selectors, dependency metadata and lockfile are unchanged. Hosted Windows
qualification, other source CI, and independent source/security review remain
pending; no Windows pass is inferred from Linux. Parent evidence is retained in
the original owner checkout's `.local-data/picomatch-pr248-integration-wnnrytri/`.


### Independent review corrections (parent, 17 November 2026)

The two independent Codex `gpt-6-astra / ultra` reviews of `cb689219` yielded
code **REQUEST_CHANGES** and architecture **WATCH**; synthesis is **REQUEST_CHANGES**.
Their original reports and all failed runs remain immutable private evidence.
Parent corrections are limited to:

- **R1:** explicitly reject unqualified ranges in both projects and active ignores.
  The original `x{10..12}.json` selects `x1.json`/`x2.json`, whereas the replacement
  previously selected `x10.json`/`x11.json`/`x12.json`; signed ranges also differed.
  The restriction above prevents silently changed typechecking coverage.
- **R2:** classify globs with `nocomment: true`, consistently with expansion and
  ignore matching. `#*.json` now expands, an unmatched hash glob remains empty,
  and a missing literal keeps its original explicit priority.
- Tighten balanced/escaped positive-extglob guards; preserve matching and
  nonmatching 200-character fixture filenames for all three repeated shapes
  `+(a)`, `+(*a)` and `+(*)`, independently through project and active-ignore
  paths in subprocesses with five-second deadlines. Never run these adversarial
  cases through the vulnerable baseline.
- Remove the unrelated upstream `CHANGELOG.md` deletion from the patch and
  refresh its lockfile identity. Fresh installation must retain that original file.

Validation evidence for this revision is in the parent's private
`.local-data/picomatch-review-fixes-877fmsx4/`. Initial regression execution on the
old installed patch failed as expected; it is retained. New exact-head Linux,
Windows, full quality/browser results and both independent rechecks remain
separate delivery requirements. Historical local 123 exclusions include 54 absent
Python prerequisites and two pinned-Git prerequisites beyond the supplied hosted
67; their local absence never establishes hosted coverage parity.


Parent validation on the corrected patch and frozen tracked contents:

| Gate | Corrected-source result |
| --- | --- |
| Fresh frozen install | PASS; upstream changelog retained, 186,586 bytes, identical SHA256 `013c2a4ae154a5b540449703fbfb0fc947e078684189429a22b7e14ded483aae` |
| Installed graph | All 15 workspaces; no Picomatch, tinyglobby or fdir package keys/store entries |
| Targeted tests | 86 passes, zero failures/skips (23 parent cases plus 63 subtests) |
| Original-consumer comparison | 114 exact ordered selections equal, including all 55 qualified ranges through project and ignore paths; SHA256 `7b540348ab301f9e39c4b0ad63f9c8a1a7fa0bbc4e5dd53a1bea9372d7aec034` |
| Lint / typecheck | 14/14 and 23/23 tasks pass, none cached |
| Root tests | 3,243 passes, zero failures, 123 local exclusions; complete excluded-case list identical to the prior local baseline |
| Package test graph | 28/28 tasks pass; detailed cache counts remain in the original log |
| Build / secrets / full low-threshold audit | PASS; no known vulnerabilities, audit threshold unchanged |
| Browser / hosted Windows | Pending for this corrected source; local browser not retried on the occupied port |

The patch hash is `75f5ae5683f3249fdad26196925390d096240a1f449789d23c0ba2fcf63458c6`.
Lock refresh changed only that identity and upstream deprecation metadata for the
unchanged Secretlint preset. All 1,449 tracked contents stayed fixed during the
serialized gates (`validation-source.json`, `gates.json`). This result-note update
changes documentation only; final published source is separately bound for both
independent rechecks. Local results are not hosted coverage or main acceptance.


### Nested and escaped brace boundary correction

Both independent source rechecks of `1451ebd9` resolved the original high/medium
findings and retained only a low nested-range contract mismatch (code COMMENT,
architecture WATCH). Their concrete forms `x{{a,b},{1..2}}.json` and
`{plain,{x,y},x{1..2}}.json` passed because the first closing brace ended a sibling
alternative. The guard now tracks unescaped brace depth and rejects a range at
nested depth, through both projects and active ignores. Four nested layouts have
two-route refusal regressions; sequential top-level ranges still retain membership.

A parent positive-control differential then found a separate escaped-brace
classification mismatch: `\{x{1..2}\}.json` was a missing literal in the original
resolver but expanded to two existing files in the candidate. That failed
comparison is retained, not rewritten. Escaped brace syntax now fails explicitly
when used in expansion or active ignores, consistent with the boundary above.
Regressions cover this example and an escaped comma-brace form; ordinary literal
brace filenames still retain explicit project priority. No replacement matching
engine, advisory waiver or silently reduced selection is introduced.

Evidence is retained in the parent's private `.local-data/picomatch-nested-fix-2yiowe5i/`.
The old-head CI-evidence delegate was stopped before source edits; partial originals
remain historical, without a completed approval. The new source requires independent
code/architecture rechecks and all exact-head hosted gates. Local validation focuses
on a fresh frozen install, actual graph/patch, affected compatibility tests, full
lint, secrets and audit. Full quality/browser and platform gates on GitHub remain
required; the preceding full local results belong to `1451ebd9` and are not relabeled
as tests of this correction. No service, scanner, Nexus or other operational command
is run by this maintenance.


Final local validation of this boundary correction: **99 targeted tests pass, zero
failures/skips**; full lint14/14 uncached, secrets and unchanged low-threshold audit
pass. Fresh frozen install and all15 workspace graphs contain no forbidden packages;
installed adapter bytes equal the patch, and the original changelog remains intact.
All1,449 tracked contents remained frozen during those gates. The lockfile delta
from1451 changes only the patch identity, now `35160f0aa02f03ad56f9318e1900baafb2bf1b6df7e8cbe65ca5a337531f0df6`.

The final benign differential uses an expanded fixture and117 exact old/new ordered
results (114 prior options plus sequential-range and explicit literal-brace priority
cases), SHA256 `c562387f097689e5bf50755b456a96d9b8bbeba38859c78f7ba3c9f67251bdb7`.
The earlier118-case comparison and its one escaped-brace disagreement remain
retained separately; that form now errors on both guarded routes. The unchanged
original golden corpus is never rewritten. These local scoped checks do not replace
new-head hosted quality, browser, integration and Windows acceptance or the two
independent source rechecks.
