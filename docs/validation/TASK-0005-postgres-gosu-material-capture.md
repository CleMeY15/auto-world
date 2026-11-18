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
| Measurements | Recompose rows from original receipts and the PR250 source-length pin verified by the build and offline reconstruction. Compare TSV bytes | Seven data 1,902,664 bytes; image archives 4,130,505,728; DB 3,339,137,024 + 306 metadata; separate subtotals |
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

## Implementation brief — 18 November 2026

Owner: Codex implementation sub-agent, gpt-6.2-astra / ultra, sole writer on
`t3/postgres-gosu-capture`. The prepared 8255e56c checkout was clean and
fast-forwarded to PR252 accepted main 9bbf4d23ea4f62d66de3afeab4bdf87a1652a774
(tree c15f53d57bac40450d1a5985e33f6b1374acb7e0). Independent documentary
main report SHA256 44edb7376eca2544956bbf94b59b44480547b6a530a4b35a19a9f38963f180a0.
PR251 raw FAILED with 159 unwaived blockers. User selected the [bounded
implementation](../../roadmap/plans/TASK-0005-postgres-gosu-material-capture.md);
its membership, deadlines, refusal matrix and exclusions govern this checkout.
Implement the helper observation and scratch target, then bind both solves,
authenticate/copy/reseal their files, sanitize failures and clean owned staging.
Run focused positive/refusal and serialized repository checks. Native source/main
runs belong to the existing GitHub workflows. Parent owns independent source
review, original evidence review and protected delivery. Infrastructure only,
no UI surface, outside the product pilot. No tokens/cost or human effort measured.

## Implementation and local verification

Frozen executable revision `939852dc19e0c0e3af713fd374a8a267a0fa450f`,
tree `3cffd44310f22d828429282a765bf3c0a233d0d4`. The final handoff
adds documentation only. The helper emits the compact projection after its
fourth marker. The wrapper binds the exact bytes to the authenticated RUN
vertex, streams, checkout, attempt and command. The PostgreSQL local exporter
gets one of the two existing solves and the same 90-minute deadline.

The adapter compares 15 recipe files against blobs in the workflow commit.
It streams the 34 exported files into an owned private copy and rechecks the
export, consumed copy and recipes. It checks the local image/config ID and archive hash/length,
the source and binary pins, actual runtime inventory, duplicate references,
six proxy rows, canonical receipt and the independently observed projection.
Cached vertex counts describe the observed command streams. They do not assert
a second execution of the offline helper. The public observation records
measurement, manifest hash and cleanup. Binary bytes, full command lines and
private filesystem tuples stay in the disposable job. Staging reserves room
for two 64 MiB exports, up to 64 MiB of private text staging, the recipe and
descriptor allowances and 25% headroom. This is a preflight, not a Buildx quota.

Local Linux Node v22.23.2, pnpm 10.15.0, frozen install. Quality commands
were serialized with umask 0077 and a short owned ext4 TMPDIR. The local
fixtures exercise the real helper and host adapter with synthetic compiler
and export inputs. They establish refusal and comparison behavior. Native
material sizes and equality on source/main still require original Actions evidence.

Earlier iterations exposed the TSV COPY allowlist, a missing test import and
two lint errors from assigning to catch parameters. The final source fixes
each. Directory identity revalidation also covers exporter-destination
replacement. The first complete local executable verification uses the frozen
revision above; intermediate revisions and their runs do not stand in for it.

| Local gate | Frozen executable result |
| --- | --- |
| Managed workflow regression command (`node --test tests/scanner-official-*.test.mjs tests/managed-image-*.test.mjs`) | 799 passed, 0 failed, one existing non-Linux refusal test skipped on Linux. Log SHA256 `438c8db83c7de46fdb631525337e3750dd2e9ad9175b007fc77b8e197e47b27f`. |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | 14/14 lint and 23/23 typecheck uncached; 14/14 build with 8 cached. |
| `pnpm test` | Initial root 3,342 passed, 4 failed, 123 skipped. Existing signer fixtures rejected the group-writable prepared checkout. Removed group-write permission on the owned checkout root and six single-link attestation input files. The targeted six attestation tests then passed. Full retry: 3,346 root passed, 123 preexisting platform/environment skips, 0 failures; 776 numeric package passes, 28/28 Turbo tasks, 13 cached. No tracked bytes or assertions changed for this retry. |
| `pnpm secrets:check`, `pnpm run audit:dependencies` | Secretlint passed on 1,477 repository files; full low-severity audit reported no known vulnerabilities. |
| Browser / native | Browser server port 3210 already occupied by another session; local browser suite not run. Parent verifies hosted quality including browsers, tooling and original native managed/source/main artifacts. No local service operation or synthetic native result. |

First verified local handoff on 18 November at 11:00 UTC. Local logs in
`.local-data/gosu-material-validation-lowMI9/` include the original failed root
run, targeted environment retest and full retry. The native first projection,
real 34-file capture, measured binary size, public artifact membership, cleanup
and source/main gates still await independent original-evidence review.

AWS holds the merge window. [PR253](https://github.com/CleMeY15/auto-world/pull/253)
head `83997fcd9e5db707ab082c4b3bcca32dda4f87df` shares the audit adapter and
exact-source guard. This M3 source descends directly from the PR252 checkpoint.
After the AWS main is accepted, preserve both behaviors, recompute the guard
from the integrated adapter bytes and verify AWS/Gosu/OpenSearch and the
applicable final gates on that new revision. Parent owns the independent reviews
and protected delivery. TASK-0005/0005A remain IN_PROGRESS, including global
material closure, capacity, retention, admission/support and final gates.
Rollback reverts the M3 changes while preserving the AWS increment and evidence.

### First architecture review and corrections

The independent architecture review on PR254 source `6875c6a2` returned
BLOCK. A legal 64-line selection could exceed the original 8 KiB budget when
the input projection was embedded in the trace. Also, deleting private staging
could mask an unconfirmed container cleanup. The correction keeps the trace in
its original format and binds the separate projection to its SHA-256 in the
same command receipt. An unresolved container cleanup leaves overall cleanup
UNKNOWN even after the directory has been removed.

A failed capture writes its bounded failure observation before recursive
removal and replaces that observation after the cleanup check. PostgreSQL text
inventories are attached after their complete directories are promoted.
Regression cases include interrupted publication, failure before the final
metadata read, the longest supported line count and the container/directory
cleanup distinction. Local focused ESLint passed. The full managed regression
command passed 803 cases with one platform exclusion and zero failures. These
checks cover fixtures. Native outcomes and the independent verdict on the
revised source are recorded separately.

The architecture recheck on `60415d33` closed both blockers and confirmed
that public inventories match promoted directories. It retained two cleanup
findings. The follow-up keeps an owned directory when the provisional failure
observation cannot be written, and records UNKNOWN as soon as publication
staging is allocated. Three regression cases cover refused observation writes
on the capture and publication paths, plus a failed initial ownership check.
The managed regression suite passed 806 cases with one platform exclusion.

Architecture returned CLEAR on `c8ad1c44`. The separate code review of
`6875c6a2` requested four corrections. PostgreSQL inspection now stages
stdout privately, validates the config ID against Buildx metadata, and promotes
the checked inspection after a successful save by immutable image ID. Failed
inspect/save commands use the private diagnostic policy. Export metadata,
the runtime trace and the frozen identity documents are parsed from capped,
descriptor-checked bytes. The capture allocator registers the inventory
directory and rejects unexpected direct children during cleanup.

Regression cases exercise the actual inspection/save branch, command wrapper,
failure handler, receipt writer and workflow upload selection with synthetic
Docker responses. They cover command failure, malformed inspection, mismatched
config and a tag reassigned between inspection and save. Additional cases cover
oversized or incomplete export metadata, replacement of the inventory directory
and a foreign child. The local managed regression suite passed 816 cases with
one platform exclusion and zero failures. Native CI and independent review of
the revised source remain separate gates.

The architecture review of `2bf0144d` identified an overwrite on inspection
promotion. The PostgreSQL path now creates the public name with an exclusive
hard link to the checked inode and removes its private name before freezing
the identity files. A production-branch collision fixture verifies the build
fails and the pre-existing public bytes survive. The success fixture verifies
a single link remains. The managed suite passed 817 cases with one platform
exclusion and no failures.

Architecture cleared the destination collision fix on `1235962b`. The code
recheck on `2bf0144d` also required binding the publication source across a
staging-name replacement and bounding all reads of the frozen PostgreSQL image
identity documents. The new publication writes the validated inspection buffer
to an exclusive staging descriptor, passes that descriptor to GNU ln on Linux,
and creates the public name without replacement. The fixture replaces the
staging pathname while the descriptor is open. The build refuses the ownership
change and the public file contains only the validated inspection bytes.
PostgreSQL now uses the capped descriptor reader for the initial Buildx
metadata, identity freeze, capture and image audit rechecks. Tests grow an
identity file at both ends of the capture. The complete local managed suite
passed 821 cases with one platform exclusion and zero failures. Hosted
execution must verify the runner's actual filesystem and tool path.

The code review on `518ca3be` closed the bounded-read finding and identified
one remaining artifact-selection issue. The managed workflow now names the
other inspection files explicitly. It includes the PostgreSQL inspection only
when the audit step sets its publication flag after verification. The collision
fixture places private sentinel bytes at the occupied path and checks both
their local preservation and their absence from the resolved upload. The
successful path still selects the checked inspection. The local managed suite
passed 821 cases with one platform exclusion and zero failures.

The code review of `9a32aacd` confirmed collision exclusion and found that a
later replacement could leave the upload flag set. The producer now keeps the
frozen inspection identity until audit finalization. It verifies the file's
size and SHA-256 on a checked descriptor immediately before enabling upload.
A regression replaces a previously valid inspection with private sentinel bytes
after the build, checks that the final audit fails, and confirms that the flag
is absent and the resolved artifact excludes those bytes. The local managed
suite passed 822 cases with one platform exclusion and zero failures.

### Integrated AWS and Gosu evidence selection

Review of the integration with AWS main `5d0599cd` identified two failure
paths on `0d31bf1c`. At audit finalization the producer now verifies the size
and SHA-256 of each selected Gosu file. Each PostgreSQL evidence directory
must also contain exactly its registered names. The uploader receives literal
paths for verified members. Independently completed groups and verified failure
observations remain available when a later group fails. The runner owns the
output paths between final verification and collection.

Tests exercise a refused observation write, an occupied runtime directory, a
late replacement and an extra member. They check the files the workflow would
upload and the serialized receipt. A missing PostgreSQL identity file yields
the fixed `scanner_gosu_material_capture_invalid` rejection. Local managed
tests passed 853 cases with one platform exclusion. Hosted evidence and the
independent review attach to the resulting revision.
