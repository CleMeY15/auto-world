# TASK-0005 — scanner checkpoint reconciliation and M3 measurement index

## Identity and scope

Owner: TASK-0005 coordinator, Codex gpt-6-astra / ultra. Branch
`codex/task-0005-retention-checkpoint`; base accepted main
`73ad4eddec190f3d6928f41f86c3e33858598683`, tree
`ca33e4e955878037ad20ff1ee344b44f076a67b1`. Work started 17 November 2026
after the PR247 main review. One writer; independent Codex research and separate
read-only source review contexts. Cost/tokens/human time unknown; outside the
six-task product pilot. No efficiency or seven-day defect claim.

This documentation increment records [PR247's accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/247#issuecomment-6964012598),
reconciles the scanner row and handoff, and adds a
[dated index of measured service materials and explicit gaps](TASK-0005-m3-material-measurements-20261117.md).
It follows the task/validation templates and existing
[M3 preparation contract](TASK-0005-managed-m3-preparation.md),
[scanner plan](../../roadmap/plans/TASK-0005-scanner-retention.md) and
[development workflow](../DEVELOPMENT_WORKFLOW.md). No acceptance criterion,
policy, executable, dependency, workflow, runtime or product surface changes.

## Plan and acceptance criteria

1. Authenticate the completed original main review and its complete manifest;
   record the coordinator checkpoint closing only scanner material retention.
2. Reconcile ROADMAP, CURRENT, delivery ledger, task pointers and M3 scanner row;
   preserve dated failures, physical execution identity and all remaining gates.
3. Index only measured service payload metadata with origins/representations;
   explicitly distinguish retained metadata, unestablished payload survival,
   unknown copies/restoration and incomplete dependency closure.
4. Check links, diff, secrets and original-byte correspondence. Freeze the
   documentation revision for independent review and required source/main CI.

No live operation or new grant of operational authority is part of this scope.
The smallest next design candidate is PostgreSQL/Gosu capture, subject to its
concrete plan review; no capture representation or execution is approved here.

## Evidence and validation

PR247 main acceptance report SHA256
`dde4649f72264c0b67da1a427058bc876e7343ce23e4c2b208db328577b478db`;
manifest SHA256
`38e7a7246ae8ed4d757e6f6b101aabc226e0db504ad895dd6082a677ccb2ea3e`.
Coordinator rehash on 17 November at 23:25 UTC: all 2,715 files /
507,158,974 bytes, exact recursive coverage, private modes and all 1,450 source
files unchanged. Fresh main identity matched 73ad4edd before the checkpoint.
This accepts the prior implementation, not the current documentary revision.

The measurement researcher independently authenticated selected original
receipt/database/TSV metadata against that manifest. Eighteen rows retain the
actual same-job observations; no payload availability is inferred. Original
run artifacts and evidence stay private. No raw credential traces are copied.

Documentation-only local gates: relative links/anchors, source-to-measurement
correspondence, arithmetic, `git diff --check` and `pnpm secrets:check`.
Results, frozen source/tree, independent code/architecture verdicts and exact
source/main CI identities belong to this increment's PR checkpoint. Until then,
this increment is **DELIVERY_PENDING**, not MAIN_ACCEPTED. Required quality CI
still executes; unchanged path filters make infrastructure/prototype workflows
inapplicable to this Markdown-only change. No manual dispatch or test waiver.
Local full tests/build/browser are not repeated for prose-only changes under
the development workflow; no new tests mirror the documentation.

First complete presentation and any review corrections are recorded in the PR
checkpoint, without anticipating approval. No defect count or elapsed-time
saving is inferred from prior accepted reviews.

## Limits and rollback

TASK-0005/0005A stay IN_PROGRESS; 243 raw upstream blockers remain unwaived.
Complete service/source/database retention, intrinsic binary equivalence,
admission/support and final 17-phase gates remain open. The scanner archive
does not prove offline scanner/database operation. Support dates and policy
bytes remain unchanged. Prior failure/UNKNOWN cleanup and old checkpoints
remain historical evidence. The user's eventual VPS migration preference does
not replace the current C:/NTFS retention contract.

Rollback reverts this documentation increment only. It preserves PR247's
accepted checkpoint, policy, archives, receipts, services and other worktrees.
No deletion, republishing, copy or restoration follows from rollback.
