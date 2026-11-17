# Picomatch security tooling maintenance — 17 November 2026

Status: IMPLEMENTED / VALIDATION_AND_REVIEW_PENDING. Focused prerequisite for the
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
asking for explicit paths or brace alternatives. No new regexp engine attempts
unsafe equivalence. These are intentional fail-closed restrictions, **not universal
compatibility**, and need parent independent source/security review before
acceptance. Existing repository configurations do not use these optional forms.
Escaped literal parentheses remain available. No type-aware rule is disabled.

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
