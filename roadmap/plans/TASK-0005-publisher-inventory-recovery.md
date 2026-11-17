# TASK-0005 — exact inventory correction and bounded publisher recovery

Status: REVIEW_PENDING. Actual Architecture approval, then distinct Critic
approval of these identical bytes, are required before implementation. The
user's existing instruction to finish TASK-0005 authorizes this continuation;
no pending evidence is thereby accepted. This amendment replaces only the
specific inventory, transport and consumed-run rules below. The original plan
and runner-profile amendment remain immutable historical contracts.

## Evidence and problem

The accepted implementation main is
`5ecdee7b32bac22429f6a3fb8ce86b13accaa1da`, tree
`aa443b71420d2d05a5877bea9d20a8abbc78ffe9`. Nine main workflows passed and were
independently reviewed. Actual publisher workflow420550475,
`.github/workflows/scanner-retention-publish.yml`, run43988267108,
run_number1/attempt1, job133721943829 then FAILED in `official_provenance`.
The five preceding phases passed; push/readback were not reached. The receipt
has no tag, manifest digest, inner tar, restore manifest or OCI descriptors.
Its default `PUBLISHED_UNADMITTED` label is not proof of publication.
Cleanup remains UNKNOWN; ownedPathRemoved=true is only that specific result.

The authentic public artifact14286078082 is named
`scanner-retention-publisher-43988267108-1`: ZIP923bytes, SHA256
`bad3839ebf36ebac5d1a085bcfa241cf966c83d8c51b6ebb9821d5f36592c1b9`,
expires2026-12-01T00:31:48Z. Its sole regular0644 member
`publisher-receipt.json` is1433bytes, SHA256
`47caab8dad1160a43dd27b6cb32c111133c651bd6ed29ed25fbc1c7d6da980b2`.
Independent review is REQUEST_CHANGES, SHA256
`c180d73eb210743e5ca670de318842b7999733af96b4b1ac3163a1eaa61d26e6`;
98 retained files verify without divergence. The success-receipt and copy
intake validators correctly refused this outcome. Preserve the run, attempt,
logs, ZIP, receipt and review; never rerun attempt2 or overwrite their result.

The publisher pins37019bytes/SHA256
`a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b`.
That is the original `go version -m /input/trivy` measurement documented in
`docs/validation/TASK-0005-trivy-0762.md`. The required publisher command
instead uses `/home/runner/work/_temp/trivy-provenance/bin/trivy`.
Both authentic PR237 inventory members are37057bytes/SHA256
`d11460976d702309229ce77f78631eff0ad7a20d52ac4ae0d046ab738ad8d2c9`.
Their36996-byte suffix is identical to the original measurement. Replacing
only the first-line path reproduces both complete byte identities in both
directions: the exact difference is38bytes. The private diagnosis SHA256 is
`e77af4a2d8d08669a54cd21c771ada207362f6f8669c6542f825ee5dba6793e6`.
The other17 members staged in this phase have no demonstrated mismatch.
The failed fresh member was not retained and the error does not identify a
member: attributing that actual failure to the inventory remains a strong
inference, distinct from the proven contradictory pin.

An independent source inspection also found that `qualified_source_blobs`
cannot ingest the2525883-byte qualified `test.war`: its current Contents API
reader requires base64 JSON under the bootstrap's1048576-byte response cap.
Base64 alone would require3367844bytes. [GitHub's Contents API contract](https://docs.github.com/en/rest/repos/contents#Get-repository-content)
requires raw/object media for1–100MB files; object content is empty with
encoding=none. Actual bounded GET observations confirm type=file, the exact
qualified path/size and this encoding. Direct raw GET at the same immutable
qualification SHA returns2525883bytes with its unchanged SHA256
`b852f605a56a1e109bdd17aaa8d85007c4327708bf6e3b4b56a9876b4a1077ba`.
The other17 raw bodies also match their existing pins. Two initial gh CLI
binary-output failures remain preserved; direct HTTP byte reads establish
the JAR/WAR identities without executing them.

## Decision and alternatives

Principles: retain original failures; preserve exact-byte authority; bound
one new action; validate downstream paths before consuming it; never equate
archive delivery with image admission. Drivers are reproducibility, keeping
the original qualification and avoiding another predictable failed attempt.

Correct the inventory pin to the existing required runner path, replace only
the qualified-blob body transport, and allow exactly run_number2/attempt1 on
the existing workflow after delivery and fresh preflight. Do not create a
replacement workflow or reset history. This adds an explicit recovery rule,
not a general retry option.

Changing the command to `/input/trivy` would preserve the wrong plan's count
but require a different staging path and depart from authenticated PR237
observations. Normalizing the first line would no longer retain the raw
measurement. Neither is selected. A new workflow with a new run_number1
would obscure continuity and duplicate controls. Allowing >=2 or rerunning
the failed attempt would remove the consumed-attempt bound. Neither is
selected. Raising the global JSON cap would not repair GitHub's encoding
behavior and would enlarge unrelated bootstrap/read API limits.

## Exact inventory and capacity amendment

Preserve original plan55554bytes/SHA256
`1cac817bd6ac4ab1bbb7b257e81e9be500bf6344a703149cdf4ce163c80d721e`
and runner amendment9373bytes/SHA256
`5055b2b8ffcfec4495d947977e8a1b12435172f1bf40a04b690c2e2617cc91d5`.
Bind this new amendment by exact bytes/hash in the authenticated policy after
ordered approvals; record actual review identities separately without
rewriting the reviewed plan. Update the policy's own byte/hash identity.

Override row11 only: `scanner-closure/inventory/go-build-info.txt`, same
PUBLISHER_FRESH origin, producer, path and0444 archive mode; bytes and capBytes
both37057; SHA256d11460976d702309229ce77f78631eff0ad7a20d52ac4ae0d046ab738ad8d2c9.
The fixed Go1.24.13 reader and required RUNNER_TEMP/path do not change. Read
raw output unchanged, including first line and LF; any other byte fails.
Preserve the other49 members, their origins, paths, caps and known hashes.
Original qualification ZIP/profile,689 entries,11 source mappings and all
generation6 execution pins remain unchanged. Do not revise historical
inventories or claim the textual replay is a fresh publisher observation.

Keep the existing conservative formula: expanded=sum(member caps),
tar=expanded+50*1024+1024. USTAR padding for this one member happens to stay
37376bytes; do not conflate an exact archive size with the conservative cap.
The exact revised values are:

| Bound | Bytes |
| --- | ---: |
| expandedCapBytes | 468322443 |
| tarCapBytes | 468374667 |
| compressed layer cap (tar+1048576) | 469423243 |
| publisherPeakBytes | 4016376920 |
| publisherRequiredFreeBytes | 5020471150 |
| localPeakBytes | 2476432055 |
| localRequiredFreeBytes | 3095540069 |

Publisher peak=2*expanded+6*tar+134217728+2*67108864+1048576.
Local peak=expanded+4*tar+134217728+2*65536+262144. Required free is
ceil(peak*1.25). Update every coupled literal, including C#/PowerShell tar
and expanded bounds; refresh only those source-helper byte/hash pins after
the edits. Tool executable identities, NTFS/ACL checks, deadlines, sidecar
caps, no-replace operations and cleanup semantics remain unchanged.

## Qualified repository transport

Keep metadata verification at the fixed Contents API endpoint, repository,
qualification SHA and each of the18 literal source paths. Use object media
and a bounded metadata response; require type=file, exact path/size and
well-formed blob SHA. Read the body from that same endpoint/SHA using
`application/vnd.github.raw+json`. Never follow `download_url`, redirect,
branch/tag, alternate host or caller-provided path. No general-purpose URL
or arbitrary cap option is added to a public CLI.

Use a dedicated bounded raw request or a private scoped extension of the
existing request helper. Accept200 only, redirect:error, bounded timeout
under the remaining operation deadline, closed authenticated headers, and
stream at most the known member byte count. Require clean EOF, exact length
and existing SHA256 before exclusive staging. Abort/cancel on overrun or
timeout. Reject missing bodies, truncation, JSON/error bodies, mismatch and
ambiguous transport. A metadata or raw failure cannot fall back to local
checkout/current main. Preserve the global bootstrap/read JSON cap. The
largest approved raw response is2525883bytes; no archive caps increase for
this transport repair. No JAR/WAR/Trivy execution is introduced.

## One consumed-run recovery

Add a closed recovery record to the authenticated retention policy binding
workflow ID420550475, exact path, permitted runNumber2/attempt1 and the
complete failed predecessor tuple above. Do not treat it as an accepted
publisher observation. `observations.publisher/localCopy/localRestore`
stay null until their own real outcomes are independently accepted.

Require2/1 in the workflow job condition, publisher context, copy observation
validator and authenticated copy API intake. Keep no-input workflow_dispatch,
protected-main ref/SHA/tree, GitHub-hosted Linux, current tool profiles,
existing token permissions and the same non-cancelling concurrency group.
Refuse run1, run3+, attempt2+, a recreated workflow ID or a branch dispatch.
The failed predecessor run ID is also explicitly refused by success receipt
and publication identity validators. Preserve receipt/publication/sidecar
schemaVersion1 and their closed key orders; runNumber is authenticated by
the external run/observation context, not invented in a receipt.

Within the existing protected_main phase, before qualification or registry
login, authenticate workflow ID/path and the bounded unfiltered workflow
run history: exactly total_count2 and two entries, the fixed predecessor and
the current GITHUB_RUN_ID. Current must be2/1, in progress, workflow_dispatch,
main and the protected implementation SHA; predecessor remains1/1, completed
failure at its fixed SHA. Authenticate its tree, sole original job and sole
artifact using fixed GitHub API endpoints; require the original artifact
digest/size/name/expiry and original job identity/failure. Download only that
923-byte ZIP with the existing bounded artifact reader, validate its closed
single regular0644 receipt layout, and require the exact1433-byte receipt
hash. Its preserved FAILED outcome/phase prefix/null publication descriptors
and UNKNOWN cleanup are historical prerequisites, never success evidence.
Use bounded API bodies, timestamps, timeouts and the existing authenticated
artifact-download route; no arbitrary URL or redirect extension.

Keep all14 publisher phases. Log only a bounded technical event with fixed
predecessor IDs/digests and successful recovery-history validation; never
raw private outputs or credentials. Failure stops before login/push and
keeps a failed receipt. Keep the original failed receipt untouched.

The existing package_controls must still prove the exact private package,
repository and sole bootstrap version/tag. Repeat that check immediately
before login and before push. A new version, changed visibility, ambiguous
response or foreign object refuses; never delete or overwrite registry
objects to fit the expected state. A new isolated runner and unchanged
registry do not upgrade the original UNKNOWN cleanup result.

## Implementation and verification

Scope: retention.json/policy, publish module/workflow, copy observation/API
guards, the two capacity literals in Windows helper/wrapper and their pins,
direct regression tests and evidence/task notes. A small private helper is
allowed where it keeps recovery/API validation testable. Do not change the
Buildx installer, OCI payload/recipe, builder selection, provenance controls,
scanner release, qualification source, database, service image policy or UI.

1. Obtain actual Architecture then distinct Critic approval of these bytes.
   Record the plan/digest and review identities; only then implement. State
   the final implementation plan and validation in a focused PR body.
2. Test the complete raw inventory identity at its required path using the
   retained authentic sample; wrong first line, old pin, changed suffix,
   truncation and extra LF must fail. Compare original plan+this one explicit
   override to all50 policy records; prove all budget formulas and native
   helper pins agree. No broad exclusions or weakened assertions.
3. Exercise production qualified-blob reads with metadata and actual-size
   >1MiB body; test wrong path/size/hash/status/media response, redirect,
   truncation/overrun, timeout and body-close failure. Cover all18 immutable
   mappings. Do not expose private original reports in public test artifacts.
4. Test authentic consumed-history fixture and each run/workflow/job/artifact
   substitution, extra/missing run, counter/attempt mutation, expired artifact,
   altered ZIP/receipt and old failed-run admission. Prove refusal before
   registry writes, correct14-phase receipt sequencing, copy consistency and
   package rechecks before login/push. Keep failed-outcome tests meaningful.
5. Rehearse the production staging chain official_provenance through
   qualified_source_blobs, canonical_manifests and deterministic_ustar with
   authenticated retained inputs in an isolated owned local directory and
   injected read-only transport/context. No network scanner execution,
   Docker build/login/push or real publisher dispatch is part of rehearsal.
   Validate all50 entries, modes/order/count/hash, manifest-first restore
   input and cap arithmetic. Historical inputs are not fresh provenance or
   an accepted publication. If retained binary/archive inputs are unavailable,
   record that gap and obtain review before consuming the recovery; never
   report a synthetic mock as the real-byte rehearsal.
6. Run affected retention/bootstrap/copy/restore regressions, lint, typecheck,
   tests, build, secrets and dependency audit as applicable. Native Windows
   CI must verify amended helper caps/pins; Linux exclusions cannot replace
   it. Independent implementation/security review precedes normal protected
   main delivery. Require fresh final-source and exact-main quality, managed,
   Windows and tools evidence; preserve failures and zero-flaky acceptance.
   Independent original-evidence review must accept that exact delivery.

Before the one recovery dispatch, read-only preflight must see exactly the
one original consumed run, unchanged attempt1 and failed receipt; protected
main must be the accepted corrected source/tree. Verify current workflow
and implementation blob identities, original qualification availability and
expiry, exact hosted tool observations, package controls and capacity. The
private package gate runs afresh inside the action before login/push; VPS
token scope limitations do not waive it or request a new credential scope.
Record dispatch intent exclusively before one POST; after response ambiguity
reconcile history, never submit another POST automatically. After dispatch
require exactly the original and new run2/1, bind the actual new ID, and
independently review original APIs/logs/receipt/readback and cleanup. No
retry, third run or new workflow is authorized by a failure of this recovery.

## Risks, rollback and acceptance

Pre-mortem: (a) repairing the pin hides another stage failure — exercise the
real staging/transport chain before dispatch; (b) reused or additional runs
misrepresent provenance — exact ID/counter/history/receipt checks before
write and copy; (c) a write succeeds but proof/cleanup fails — retain actual
registry evidence and consumed run, do not retry/delete/claim success.
Existing docker-container OCI/readback behavior remains a real postcondition;
the accepted Docker-driver tool probe does not prove that backend path.

Rollback before dispatch leaves publication disabled by the consumed run1
guard or reverts the amendment; it does not make the incorrect pin usable.
After dispatch retain evidence and stop on uncertain outcome, with no
destructive rollback. No service data or another worktree may be changed.

Acceptance of this increment requires the reviewed correction, exact-source
and main delivery evidence, then the one actual successful publisher/readback
and independent review before recording a publisher tuple. PR237 artifact
13706967607 remains fixed, digest
`sha256:063bcda8a6e60bbe9f419663d5c4a634f342506df66d325fe57582f4e5dc7551`,
5119275bytes, expires2026-11-23T20:18:16Z. Expiry or loss stops this recovery;
new diagnostics cannot replace it silently.

TASK-0005/0005A remain IN_PROGRESS. Actual NexusLite C:/NTFS second copy and
restore, complete service-image closure/admission and final infrastructure
criteria remain separate required work. The user confirmed no VPS-to-NexusLite
SSH exists; Linux or hosted Windows CI is not that machine's copy proof.
The243 raw upstream blockers remain unwaived. Support dates stay null;
production, real data and image admission remain unauthorized.
