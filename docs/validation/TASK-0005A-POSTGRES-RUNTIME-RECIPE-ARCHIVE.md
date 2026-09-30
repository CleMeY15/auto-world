# PostgreSQL accepted runtime recipe retention

Status: PREPARED_REVIEW_PENDING, 2026-10-01. No collector invocation or destination exists at this checkpoint. TASK-0005A/0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Problem and prerequisite

The accepted PR124 runtime addendum preserves three payloads and a paired root supervisor ACK, but its implementation recipe6f672b96747c857d5704ca32550ac0418fa014f2 postdates the prior PR123 bundle. That older bundle cannot be relabelled as retaining this implementation.

PR124 merged at6649766410a86a019fa18b711c78d5af21c40a17, preserving final reviewed tree7bc2d8c84c591728c3a2c2ccacc15c4c59433f89 from6a4b4cee5190be0ab059bd99adf2d405309ebf98. Exact final-head CI36786276233 passes; merged-main CI36786525955 is pending at preparation. Original V3 byte/native and separate privacy/preservation reviews APPROVE. The native source checkout stays clean at exact6f672b9 through capture and independent offline replay; only the separate Windows documentation branch advances.

Related V3 evidence is fixed by its externally reviewed byte pins: receipt9,215 bytes/SHA6880ffcc84fb0cc835d7f2735c0c327649ffcf87b28d735468a56aa9d9aee7d1 and original root ACK3,985 bytes/SHAdcb8306366d56ca2953e0fca91358ba55779cf07b43050336c3fcb68930aaa72, execution local-runtime-evidence-541cf52c979013121d988c03. Collection records REFERENCE_AUTHENTICATED_BY_DISTINCT_REVIEW/readDuringCollection false. It does not reread or copy that root log, the prior receipt, runtime payloads or image archives.

## Implementation plan

Use unchanged existing source-bundle APIs at the reviewed native checkout: create, closed pure proof validation, default async offline validation and default clean source inspection. There is no new production API or profile. The bundle contains exactly eight fixed refs: HEAD=6f672b9 and the original publication/audit/runtime/retention/copy/cold/sql recipes. It contains33 explicit raw-byte blob pins: seven historical Dockerfiles, eleven public HEAD materials and fifteen additional implementation/test/ADR/task/source-helper pins. Root and the independent reviewer authenticate those sizes/SHA256 directly from Git blobs; the collector itself is never imported for those checks.

Run one fixed ignored collector with no arguments under actual native Node22.23.2, UID/GID1000, all four kernel identity fields1000, empty supplementary groups, zero capabilities, NNP and closed five-field environment. It requires clean exact6f before creating anything. The reviewed launcher authenticates collector SHA, checks the source under actual setpriv, exclusively captures root-private stdout/stderr, and requires exit0/complete stdout EOF/zero stderr before accepting its matching ACK.

Exclusively create a new digest/nonce-addressed ext4/0700 directory and its0700 source subdirectory. Retain only source/recipes.bundle and receipt.json as UID/GID1000/0600/single-link files. The existing helper creates version2/full/no-prerequisite bundle through local file-only Git, checks eight heads, imports into fresh owned bare repositories, runs full strict fsck and authenticates every pinned blob. Its owned temporary repositories must be removed. No source refs or configuration are written.

Hold original public files, ancestor directories, bundle and publication descriptors through complete positioned size/hash/EOF and native/path reseals. Repeat default bundle validation and source inspection after publication; verify exact two-directory/two-file inventory; close all descriptors before writing the matching collector ACK. Receipt publication alone does not establish acceptance. On failure, only a proven owned receipt may be retired by stable dev/ino/uid/gid/mode/nlink; foreign replacements, unstable parents and all retained payloads/originals are preserved. Uncertain closure prevents acceptance even when that owned receipt is safely retired.

Bounds: fifteen minutes operation plus existing helper cleanup grace,90seconds per Git command/remaining,512MiB bundle,16MiB static blobs,128KiB receipt, two temporary bare repositories each512MiB,2GiB reserve,16KiB stdout and ten-second output finish. Snapshot guards do not provide hostile-same-UID/root/administrator isolation or immutable/off-host storage.

## Verification and limited claim

Before invocation require distinct collector/launcher/schema/privacy review, independent33-pin check, fresh syntax/scoped lint and actual clean-source prerequisite. Reuse the accepted existing helper native tests and default Git2.43.0 contract; unsupported Git remains a refusal. After capture require independent original ACK/receipt bytes, private native identity/inventory, default offline full bundle replay and clean Git before/after, plus separate privacy/preservation review. Fixtures or metadata-only review are not actual collection evidence.

Success claims only SOURCE_RECIPE_BUNDLE_ONLY/sourceRecipeRetained true, LOCAL_DIAGNOSTIC, historicalIntegrity VERIFIED, currentness NOT_EVALUATED, runtimePermission NOT_GRANTED, closure INCOMPLETE, admission NOT_AUTHORIZED and three null support/retention dates. It does not retain external software sources/notices, official attestation or a complete second Windows evidence copy. No Docker, SQL, registry, network, signing, support activation or four-service acceptance occurs. The ignored collector's own full source is not claimed as a new bundled production capability.

Rollback preserves retained successful/failed evidence and disables/reverts only this additive documentation; no archive is deleted. Closed receipt/ACK/failure phase, hashes and native metadata provide observability without raw SQL, receipt bodies, environment, credentials or subprocess output. Delivery still requires independent documentation review and exact final-head/main CI with unchanged reviewed tree.
