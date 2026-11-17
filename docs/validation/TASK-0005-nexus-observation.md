# TASK-0005 — actual NexusLite copy and restoration observations

17 November 2026. Actual operation: **APPROVE / LOCAL_BYTES_RESTORED_NOT_ADMITTED**.
Observation delivery: **IN_PROGRESS / DELIVERY_PENDING**. TASK-0005/0005A
remain IN_PROGRESS;243 upstream blockers remain unwaived.

## Scope, owner and delivery plan

Owner: TASK-0005 infrastructure coordinator. Branch:
`codex/task-0005-nexus-observation`, base main
`f630339b791731b6111bb8fd340fd6874c392826`, tree
`c4012982de59be1d6ecfa26d48ba7ff4b1c54898`.
Coordinator and independent reviewers use separate Codex contexts,
`gpt-6-astra` / `ultra`. The infrastructure checkout has one writer;
quality commands run serially. Cost is unknown. This continuation is outside
the product pilot cohort; no efficiency claim is made.

Criteria remain those of the [scanner-retention plan](../../roadmap/plans/TASK-0005-scanner-retention.md),
the [bounded Windows correction](../../roadmap/plans/TASK-0005-windows-tool-links.md)
and the [DoD](../DEFINITION_OF_DONE.md). Actual evidence and its independent
review now permit this separately reviewed delivery:

1. Record the actual sidecar and restoration-receipt identities in the existing
   `observations.localCopy` and `observations.localRestore` policy slots.
2. Update only the canonical policy binding and affected existing assertions.
   Preserve the publisher tuple, all execution rules, claims and support dates.
3. Validate original-byte correspondence, run applicable checks and independent
   source review, then normal PR/main gates before accepting this delivery.

Both observations identify the execution source and tree. `completedAt` is
the joint coordinator completion, not a separately measured copy-phase time.
The copy observation binds the1148-byte sidecar; the restore observation binds
the1145-byte original stdout receipt. These are historical identities, with
no new runtime consumer, CLI option or permission to rerun a restore.
The top-level policy and sidecar retain their existing non-admission claims;
the separate execution receipt establishes the actual local byte operation.

UI, API behavior, database migration and service observability are not
applicable. Operational observability consists of preserved intents, process
results, original byte streams, host checks and independent postconditions.
Rollback reverts this metadata increment only; it preserves all archives,
receipts, failures, source history and unrelated resources. No deletion,
publisher run, scanner execution or further copy/restoration is authorized.

## Accepted implementation and actual operation

[PR246](https://github.com/CleMeY15/auto-world/pull/246) delivered the correction
on exact mainf630339b. Actual push/main attempt1 evidence independently passes:

| Gate | Actual main run | Accepted scope |
| --- | --- | --- |
| Quality | [44112446169](https://github.com/CleMeY15/auto-world/actions/runs/44112446169) |3175 root passes/67 existing exclusions;776 package passes;668 browser passes/10 existing exclusions, zero retry/flaky |
| Managed | [44112445945](https://github.com/CleMeY15/auto-world/actions/runs/44112445945) |Ten phases, two builders, five audits, four runtime cases and cleanup |
| Windows | [44112446079](https://github.com/CleMeY15/auto-world/actions/runs/44112446079) |24 passes, zero exclusions, including native NTFS |
| Tools | [44112446164](https://github.com/CleMeY15/auto-world/actions/runs/44112446164) |42 passes, native copy and cleanup |
| Raw diagnostic | [44112446032](https://github.com/CleMeY15/auto-world/actions/runs/44112446032) |FAILED;243 unchanged blocker objects, no waiver |

Main review747016bytes/SHA256
`5d678d747583e49ff18999c99ee6bf52b8bb9baf1fa34414d9b9c8b1fc92f7c2`;
complete2684-file manifest SHA256
`9b7c6f794640072204df7f997717148703abc38ba5be9ea4ba0631b173ef98f9`.
This accepts f630 only, not the later observation-policy revision.

The real no-argument Windows coordinator ran once after that correction,
`2026-11-17T16:41:50.638Z`–`16:42:09.468Z`: exit0, null signal,
empty stderr. Fresh tool/capacity, private-package, authenticated publisher
and registry guards passed. Existing Windows interactive credentials stayed
in memory; no GitHub/GHCR token was printed, persisted or transferred to VPS.
Owned demand-only scheduled tasks were removed after confirmed completion.

| Actual retained identity | Bytes | SHA256 |
| --- | ---: | --- |
| C:/NTFS tar |234696704|`a35e46af174ef948f6c886fd78805d740065222e6502b188d5197912a250e13c`|
| C sidecar |1148|`8bf31e82ef189cb2c8d4738993f14819409f99f4cdd59cd15a3c72eee6d635b7`|
| Original restore receipt |1145|`22b9729a9b98c344ceb8a77a1470a677c823a832a5c02450d822857a776d239e`|
| Restore manifest bound by receipt |11459|`53909330b57429722f787ce3579713c47eb137a9dc93c12ad65e6ede3e7a01d3`|

The canonical receipt is `LOCAL_BYTES_RESTORED_NOT_ADMITTED / PASSED`.
All eight ordered phases pass: pair inspection, raw USTAR profile, exact
bsdtar list, empty destination, manifest-first extraction,49 bound members,
native sealing and owned extraction cleanup. It reports50 members,
processes CLOSED and extraction REMOVED. The sidecar validates against the
[accepted publisher receipt](TASK-0005-publisher-observation.md).
Its `copy.createdAt=2026-11-17T03:20:06.000Z` is the publisher artifact creation
time, not the physical copy time. `networkIo:false` describes the offline
restore portion; preceding intake uses authenticated GitHub/GHCR access.

Independent SSH inspection at16:53:47UTC confirms the same tar/sidecar
hashes and file IDs on physical C:, protected user/SYSTEM DACLs, single
links, no reparse points and exactly two files in the scanner directory.
No `.part` or extraction directory remains. The candidate image is absent
and no owned Linux staging-prefix path remains. No scanner was executed.

## Independent review, preservation and limits

Actual-operation review **APPROVE**,16807bytes, SHA256
`dabaa63f0867071226aefea7f8df603fda692961a80f7196c01abaec3b18de7f`.
Private review directory: `.local-data/task0005-nexus-actual-review-kcpgai7y/`.
Its manifest covers13 files/317641bytes, SHA256
`b6e9424d4f7e7187801969c202dbc4804f568fce1c92e8bddc2854fcfc2ba285`.
Parent independently rehashed that complete set without divergence.

Original operation evidence remains private in
`.local-data/task0005-nexus-f630-preparation-cte71255/` and the corresponding
NexusLite private archive. Complete487-file/5210000-byte parent manifest
SHA256 `73a74b8ce84b6e64283754f0c90b456b4569132889e9de3488493ebd6d6770c4`;
independent rehash and exact coverage pass. Manifest and verification envelope
exclude themselves explicitly. The remote115-member manifest is also checked
against downloaded bytes; the earlier113-file snapshot is unchanged.

- Original PR245 production failure remains FAILED, with all140 original
  files preserved and no additions, deletions or changes. A later16:38
  preparation task failed on an exclusive evidence-filename collision before
  coordinator intent/spawn; its records are preserved. The corrected capture
  produced the sole post-correction production invocation above.
- All1441 tracked Windows files remain byte-identical before/after, HEAD/tree
  and clean status match, and the original PR245 branch remains preserved.
  Of these,1361 equal raw Git bytes;80 pre-existing CRLF files reconstruct
  exactly from Git LF content. Retention runtime/policy bytes are raw-exact.
- Nine images and four existing container identities are preserved. Redis's
  temporary loopback port changed32768→32769 and OpenSearch's32769→32768.
  Other listed fields match after label/mount-order normalization. WSL restart
  is a possible explanation, not an established cause. Entire runtime-state
  equality is not claimed; unrelated services were not rebound to conceal it.
- Raw Docker command records include private data from an older synthetic
  environment. Originals remain restricted0700/0600 and are not published.
  This public record contains only reviewed metadata. Internal StageTar,
  CommitPair, InspectPair and Linux command results were consumed by the
  coordinator; no separately retained internal phase logs are invented.

## Observation revision verification and remaining gates

Proposed policy31770bytes, SHA256
`9c29ee55be99f8b40278c9bfb9d36923e2a5b95441bb782b0327c677689f997c`.
Only the two local observation values change semantically. Publisher,
plans, tools, qualification, caps, recovery and execution contracts remain
unchanged. Existing mutation/authority assertions also cover both observations.

Local checks ran serially on17 November16:59:38–17:04:18UTC, Node22.23.2,
pnpm10.15.0, umask0022. All ten changed-file byte identities remained fixed
throughout. Logs and source inventory remain private under
`.local-data/task0005-nexus-observation-7pfi9e50/`.

| Local gate | Result |
| --- | --- |
| `node --test tests/scanner-retention-*.test.mjs` |168 passes/7 existing Windows-only exclusions; zero failures/cancellations |
| `pnpm lint` |14 tasks PASS,0 cached |
| `pnpm typecheck` |23 tasks PASS,0 cached |
| `pnpm exec turbo run test --concurrency=1` |776 tests PASS,0 exclusions;28 tasks,8 cached |
| `pnpm build` |14 tasks PASS,13 cached |
| `pnpm secrets:check` |PASS |
| `pnpm run audit:dependencies` |PASS, no known vulnerabilities reported |

Independent source review began before local completion and remains a separate
delivery gate. Its final report and exact revision belong to the PR checkpoint.
The subsequent documentation-results update does not alter the tested policy,
module or test bytes. Complete hosted root/package/browser quality and applicable
managed/Windows/tools source/main gates remain required. The known VPS `/tmp`
tmpfs limitation is preserved; no unchanged full native root retry was made.

First complete local proposal:17 November2026 at17:04:18UTC; source/main gates
pending. Costs and active/CI/human time are unknown. This evidence does not
accept the new source revision or its main.
Protected-main observation delivery can close only the scanner material row.
Service-image closure, complete binary inventory/equivalence, signing,
current admission/support and final infrastructure gates remain open.
Rust498/590 remain source-package counts. TASK-0005/0005A remain IN_PROGRESS;
243 upstream blockers remain unwaived and no further publisher is authorized.
