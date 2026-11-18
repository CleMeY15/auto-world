# Validation TASK-0005 — PostgreSQL/Gosu preparation

## Identity and scope

**PLAN_REVIEWED / DOCUMENTATION_DELIVERY_PENDING**, revision 2, 18 November 2026.
Parent owns TASK-0005/M3. Initial preparatory author, parent, Architect and Critic
use Codex gpt-6-astra / ultra; their actual settings and scopes were recorded in
private briefs. Preparation source `2d204d5222a1a3832697752a49bbd05bc9394120`,
tree `5315861787a641cc8f7d2d15edf7d6005a943478`, 1,458 tracked files, matches
accepted main `0c2b3d6c1e67c665f7cd1718f18703baf673409e`. The documentary
branch is `codex/task-0005-m3-capture-plan`; its exact delivery head and required
source/main checks will be recorded in the PR checkpoint, without self-referential
commit hashes in these documents.

[Plan](../../roadmap/plans/TASK-0005-postgres-gosu-material-capture.md),
[18 November measurement annex](TASK-0005-m3-material-measurements-20261118.md),
[M3 contract](TASK-0005-managed-m3-preparation.md), [DoD](../DEFINITION_OF_DONE.md).
PR250's body checkpoint accepts the diagnostic prerequisite only. This increment
publishes twelve documents: the plan, observations, validation and existing
status/index pointers. No executable code, workflow, pin, payload or threshold
changes; no native capture, Docker, service, registry, publisher or Nexus operation.
UI gates and new executable tests are inapplicable to these documents; required
hosted CI remains applicable under [the development workflow](../DEVELOPMENT_WORKFLOW.md).

## Evidence matrix

| Criterion | Check | Result / limit |
| --- | --- | --- |
| Frozen preparation source | HEAD/tree/status and all 1,458 hashes before/after each review | Unchanged through Critic intake; later documentary edits are a separate revision |
| Source evidence | Exact original managed receipt, TSV, offline receipt, trace, DB manifests/metadata, parent acceptance/report and contracts | Rehashed external references; no binary payload survival inferred |
| Measurements | Recompose rows from originals and compare TSV bytes | Seven data 1,902,664 bytes; image archives 4,130,505,728; DB 3,339,137,024 + 306 metadata; separate subtotals |
| Documents | Relative links/anchors, exact patch reconstruction, changed-file scope and secret checks | Local delivery checks are recorded in the PR; preparation checks alone do not replace repository Secretlint |
| Frozen dossier integrity | Exact coverage, dirs 0700/files 0600, separate-process rehash | Critic verified 179 external references; parent intake rechecked four dossiers/86 members, 179 references and 1,458 sources without divergence |
| Independent plan review | Actual Architect, parent corrections, then distinct Critic | WATCH on revision 0; APPROVE on revision 1 only; details below |
| Documentary delivery | Applicable source/main CI and independent original-evidence acceptance | PENDING; no passing job or merge anticipated |
| Implementation/native capture | Future 34-file export, first/second-solve binding and scoped cleanup | NOT_ESTABLISHED; no inheritance from PR250 |

## Independent plan reviews

| Revision | Frozen identity | Verdict and scope |
| --- | --- | --- |
| 0 | Plan SHA256 `a9e39c6dd524e472c854c6d9fc0be754d6cd94021c6a2bf862b41a61770e5916` | Architect WATCH, no blocking architectural finding |
| 1 | Plan 27,833 bytes, SHA256 `7c6c170834493554e6fcf79faf2f6b1fa697e84afc6c86ceba9f08034b65ad4b` | Critic APPROVE for the bounded plan; N1–N3 confirmed, one LOW wording note C1 |
| 2 | Parent documentary delivery, exact diff retained against revision 1 | C1 and dated review/delivery state only; no new capture member, solve, bound or authority; earlier verdicts remain bound to their reviewed bytes |

Architect report SHA256
`2ebb53abefb366201a54de3ed670beb02713e6575b32230e85bd4db72602c0bd`.
Critic report: 21,036 bytes, SHA256
`8e15ae3b487319273ae5e1b4c5cf0f06fec5b5694c59bb81e01455c11403aa2b`;
manifest `fca0868c1df9ac2709e43a6dce40ab4db8fbc8b8c2d81254e972f03971a86df1`;
verification `1a61d9192f761e943ada703e1efc0096abf664185b0bcec78942e6e91aed011b`.
Parent intake result SHA256
`5a80dff6790ce95e228b81ead4f4b62847eca22fb161043195274463fabb0871`.
Private locations and complete reference indexes remain in the handoff, not in
public documents. Historical source/handoff references are frozen snapshots;
subsequent intentional edits do not rewrite those manifests or their verdicts.

N1 separates the executed first-RUN input projection from the later host manifest,
with a distinct prefix/closed grammar and no 35th export file. N2 requires failure
privacy across the global receipt and actual upload while preserving successful
runtime trace capture. N3 distinguishes acceptance limits, existing subprocess/text
budgets and the helper's stricter limits. The Critic found these sufficient at plan
level, without treating future tests as passed. C1 replaces the ambiguous
“six-line trace” wording with the existing bounded selector, including authenticated
repeated headers and interleavings within its 64-line limit. Parent implemented
these documentary corrections without an extra administrative review cycle.

## First presentation and diagnostics

Revision 0's first complete presentation and exact plan/patch digests remain in
its unchanged private envelope. Its Architect review completed before revision 1
and the Critic review. Each later freeze and correction remains separately recorded.
Initial truncated reads and a nonexistent helper filename probe were retained;
the relevant contracts and actual producer code were reread. The Critic's initial
missing `python` alias failed before writing files; `python3` verification succeeded.
No implementation test, native build or capture was executed by the plan reviewers.

## Pilot measures

Infrastructure maintenance, outside the six product entries. Start and first
presentation timestamps are in private briefs/envelopes. Active/wait/human time,
costs and tokens remain unknown; no savings or seven-day defect-free claim.
Preparation, orchestration, correction and verification belong in later accounting
if measurable. Documentary CI and acceptance remain separate from this plan review.

## Delivery, limits and rollback

PR252 initially targeted PR250 main `0c2b3d6c`. The draft branch now includes
PR251 main `f6fcd6efca4ad23f8a7fc79c9eaf7297511992a1`. Both pilot entries
are preserved. Of the 15 recipe files, only the OpenSearch pin in
`infra/managed-images/lock.json` changed. The file is 4,272 bytes on both commits.
Its SHA256 on the new base is
`736b87f5c5ad2252727d612ff900429525aef5eb608f23c2206d7801d48d1fda`.
The annex records the measurements from PR250. PR251's final source audit
reported 159 blockers on `d8e92987`. Documentary delivery waits for the upstream
owner's [PR251 main checkpoint](https://github.com/CleMeY15/auto-world/pull/251).
Recheck the live main and the recipe hashes before freezing the implementation.

TASK-0005/0005A remain IN_PROGRESS. Required future work: accepted documentary
delivery; bounded implementation/code review and actual source/main capture;
complete compiler/base/OS/source/notices/global M3 closure and capacity;
concrete package/privacy/permissions/retention plan; two private copies and isolated
second-copy-only restoration; admission/support and final 17 phases. The completed
plan reviews authorize none of those operational postconditions by themselves.

The previous Gosu plan remains 14,061 bytes, SHA256
`e28c77cda512e15fcfb41f1cea317ac0259736027639fcfe5e015de3cf649fe4`.
The 17 November measurements, scanner 50-member retained pair, historical failures
and other owners' files stay intact. Rollback reverts only this documentary increment;
no migration, service rollback, archive deletion or change to accepted evidence.
