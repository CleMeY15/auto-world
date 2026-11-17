# TASK-0005 — publisher inventory correction and bounded recovery

17 November 2026. Status: `LOCAL_VALIDATED / DELIVERY_PENDING`. The branch is `codex/task-0005-publisher-inventory-recovery`.
No PR or corrected-source/main CI acceptance is established at this checkpoint.
No second publisher dispatch has occurred. TASK-0005/0005A remain `IN_PROGRESS`.

## Preserved failed publication

PR242's main `5ecdee7b32bac22429f6a3fb8ce86b13accaa1da`, tree
`aa443b71420d2d05a5877bea9d20a8abbc78ffe9`, had nine successful workflows and
independent approval. That delivery did not establish archive publication.
The sole subsequent [publisher run43988267108](https://github.com/CleMeY15/auto-world/actions/runs/43988267108),
workflow420550475, run_number1/attempt1, failed in `official_provenance` after
five successful phases, before push or readback. Tag, manifest digest, inner
tar, restore manifest and OCI descriptors remain null. Its default
`PUBLISHED_UNADMITTED` receipt label does not prove publication: result is
`FAILED`. Cleanup remains `UNKNOWN`; `ownedPathRemoved=true` is only that
specific observation.

The original public artifact14286078082,
`scanner-retention-publisher-43988267108-1`, is a923-byte ZIP with SHA256
`bad3839ebf36ebac5d1a085bcfa241cf966c83d8c51b6ebb9821d5f36592c1b9`.
Its sole1433-byte receipt has SHA256
`47caab8dad1160a43dd27b6cb32c111133c651bd6ed29ed25fbc1c7d6da980b2`.
The independent REQUEST_CHANGES review, SHA256
`c180d73eb210743e5ca670de318842b7999733af96b4b1ac3163a1eaa61d26e6`,
verified98 retained files without divergence. Original APIs, logs, ZIP and
receipt remain under ignored private
`.local-data/task0005-publisher-independent-csmfk9s1/`. Success-receipt and
copy-intake validators refused the failed outcome. No publisher observation
was accepted, and the consumed attempt must not be rerun.

## Approved correction

The [recovery amendment](../../roadmap/plans/TASK-0005-publisher-inventory-recovery.md)
is17013bytes, SHA256
`eb7d3c7bc80a8c9fbab11e935426d790ebd9bf46311379497ca4eba111d18de4`.
Actual ordered reviews both returned APPROVE before implementation:

| Review | Bytes | SHA256 |
| --- | ---: | --- |
| Architecture | 9714 | `5b582b1d8f2dac024728e2b1013e00bbafcf32d66bd9120ed53c15e700614472` |
| Distinct Critic | 13028 | `942b70215eff73179b1f3cc19623044f0762ae1732f0ff08d49c29f69ace7ad0` |

Their private originals are in
`.local-data/task0005-publisher-recovery-architect-fbc4fqky/` and
`.local-data/task0005-publisher-recovery-critic-gm1zuicy/`.
The original retention plan and runner-profile amendment remain unchanged.
These are plan approvals; implementation, delivery and publication require
their own evidence.

The inventory defect is an exact path mismatch. The37019-byte pin
`a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b`
belongs to `go version -m /input/trivy`. The required runner path is
`/home/runner/work/_temp/trivy-provenance/bin/trivy`; both authentic PR237
inventories at that path are37057bytes, SHA256
`d11460976d702309229ce77f78631eff0ad7a20d52ac4ae0d046ab738ad8d2c9`.
The36996-byte suffix is identical; replacing only the first-line path
reproduces both complete identities. The raw output remains unchanged.
The failed run's fresh member was not retained, so attributing that actual
failure to this pin remains an inference. An isolated local rehearsal of
the original production staging code independently reproduced the same
staging refusal after archive and binary intake, before the inventory.

The second defect is the qualified2525883-byte WAR: the old reader required
base64 JSON under a1MiB cap, while the actual Contents API object response
has empty content and encoding=none. The corrected transport validates
metadata, then streams raw bytes at the same fixed endpoint and immutable
qualification SHA, checking exact length, EOF and hash. It rejects redirects,
alternate URLs, substitution, truncation and overrun, with bounded deadlines.
The bootstrap/read JSON cap is unchanged. Real read-only observations
confirmed all18 qualified blob identities; two initial gh CLI binary-output
failures remain retained alongside the subsequent successful direct HTTP
JAR/WAR observations.

Only row11's byte/hash/cap changes among the50 archive members. Derived
expanded/tar caps become468322443/468374667bytes; minimum publisher and
physical C: free space become5020471150/3095540069bytes. Coupled C#/PowerShell
constants and their source hashes agree. The remaining49 records, original
qualification689-entry ZIP profile,11 mappings and74 generation6 execution
pins remain unchanged.

Recovery uses the same workflow ID/path, with exactly run_number2/attempt1.
It authenticates the original failed run/job/artifact/receipt and an exact
two-run history containing that predecessor and the current run. Package
controls recheck the sole private bootstrap version before login and push.
Copy intake requires the same workflow ID, run2/attempt1 and matching job
run/head identities; the known failed run cannot become a publication or
successful receipt identity. All14 publisher phases and existing receipt,
publication and sidecar schemas remain. No general retry, third run or new
workflow is permitted.

## Local verification and its limits

The policy/copy/helper implementation snapshot passed77 targeted tests with
seven existing Windows-only exclusions and no failures; scoped ESLint passed.
An intermediate test found the wrapper's embedded C# hash still old after
the cap edit. That pin, the wrapper hash and policy hash were corrected before
the passing run. The snapshot report is
`.local-data/task0005-publisher-policy-implementation-hva6_3od/implementation.json`,
SHA256 `dc694b346c48355ca1d9920984c2cb0031a0a4b7bdf4f11bd2caad47424df081`.
A later aggregate regression run reported151 passes/seven existing exclusions
out of158 tests. Additional inventory and deadline regressions were added
afterward; neither earlier count qualifies the final source.

A first complete local staging rehearsal passed eight exercised phases:
context/capacity, protected-main checks, qualification API, qualification ZIP,
official provenance staging, qualified source blobs, canonical manifests
and deterministic USTAR. Its private original is
`.local-data/task0005-publisher-real-staging-wj2cn_57/rehearsal-result.json`,
18332bytes, SHA256
`64316bdf1c3a6f21ffa96cc03a24cc8dbb14009625962e941ba7a0596423aa3d`.
It produced a234696704-byte local tar with50 members and49 manifest file
records. The tar SHA256 is
`bace12aac5df8a0209c22a2d55c87ba6ae686b29feb2044a1b27640090c8d2b2`.

This rehearsal used authentic retained material bytes and historical reports,
with injected control-plane responses and synthetic publication source/run
identities. It made no external network calls, Docker commands or scanner
executions. Its generated tag is local data, not a published registry object.
It does not establish live main/package controls, fresh provenance, OCI push,
authenticated readback, actual publisher cleanup or NexusLite restoration.
Two harness errors, an import error and an optional-field assertion, remain
preserved as `initial-harness-import-failure.txt` and
`initial-harness-optional-member-failure.txt` in the same private directory.

The source review found that a package recheck could finish after the operation
deadline, while command options clamped the remaining timeout to1ms and could
still start a push. The corrected code refuses an expired deadline, bounds the
package GETs by the remaining budget, and checks again before login/push.
Both expiry positions have regression coverage. The review then returned
APPROVE with no open finding:10254bytes/SHA256
`f6a9fd599660479c6aad63779afa12e9d435021f167cf237d4ff90df36cd463c`,
private original `.local-data/task0005-recovery-source-review-5f1kf_34/independent-review.json`.
All21 reviewed file identities match the final source; the reviewer independently
ran66 tests without exclusion and verified the original rehearsal's50 members.

The final repetition after the code was frozen passed the same eight production
phases, with unchanged234696704-byte tar and the identical SHA256 above. Its
private result `.local-data/task0005-publisher-real-staging-final-8vexwzil/rehearsal-result.json`
is18350bytes/SHA256
`b162ce2a893624a4f2214e6adff62e73666341d08781e389649c57e2fdac68ec`.
The ten production source identities recorded before the run remained unchanged
afterward. This final proof retains the same historical-input/injected-control-plane
limitations; no registry operation was performed.

The new Node reader itself also performed real authenticated read-only metadata
and raw GETs for all18 fixed qualified paths. All18 bodies match their pins,
including the JAR and2525883-byte WAR. The result in
`.local-data/task0005-publisher-node-raw-api-JoaYlc/verification.json` binds the
exact reader source hash; credentials remained in memory and were not retained.

Final local checks:161 targeted retention tests,154 passed/seven existing
Windows-only exclusions/zero failures; ESLint and14 workspace lint tasks pass;
23 typecheck tasks pass;28 workspace test/build tasks pass without cache, covering
776 package tests; build14/14 passes (eight unchanged outputs reused). Secretlint
passes1429 repository files and dependency audit reports no known vulnerabilities.
The final regression tests and changed files passed ESLint again after the deadline
correction. Complete native Linux root/browser/managed and Windows runs remain
GitHub CI gates; these local results do not claim NexusLite or CI acceptance.

## Delivery, operation and remaining gates

Before dispatch: complete final local verification, normal protected-main
delivery, fresh final-source and main quality/managed/Windows/tools evidence,
and independent review of their original artifacts. Recheck the exact
original failed attempt, accepted corrected source/tree, current tools,
capacity and original qualification availability. PR237 artifact13706967607
still expires2026-11-23T20:18:16Z; later diagnostics cannot substitute for it.
Then record one dispatch intent and reconcile the actual run2/attempt1 outcome;
an ambiguous response or failed proof never authorizes another POST.

Before dispatch, rollback leaves the consumed-run guard closed or reverts
the amendment. After dispatch, retain actual outcome/evidence and stop on
uncertainty; do not delete registry objects or service data to recover.
The original UNKNOWN cleanup result is not upgraded by a fresh runner.

Publisher, local-copy and local-restore observations remain null. The real
NexusLite C:/NTFS copy and manifest-first restoration, service-image closure
and admission, and final TASK-0005 infrastructure acceptance remain open.
There is no configured VPS-to-NexusLite SSH; hosted Windows CI cannot replace
that machine's proof. The243 upstream blockers remain unwaived. Support dates
stay null; production, real data and image admission remain unauthorized.
