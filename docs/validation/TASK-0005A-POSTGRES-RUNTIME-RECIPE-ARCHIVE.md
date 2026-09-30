# PostgreSQL accepted runtime recipe retention

Status: ACCEPTED_LOCAL_RECIPE_RETENTION, 2026-10-01. One reviewed fixed collection returned exit0 with zero stderr. Distinct original-byte/native/default offline and separate privacy/preservation reviews APPROVE. PR125 merged at8aa0b60aed653dc8e5f3b45407923f7d226f40ee with reviewed tree7b1179805c16c5222cb095356895dc8b90790031; exact final-head CI36788341339 and merged-main CI36788693215 pass. TASK-0005A/0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Actual single collection

The sole reviewed collector37f6bf3ec97b509acaf3b059b8c63314efbdb7acfd1b2c660ccd9785bb67ac4e and launcher e935b4e346d0487e88c5b64154b07e36cb748c9e1240234075ba53b16b6c9c7e succeed under the fixed native actor/source profile. The plan's final independently reviewed SHA is75717001f0e69ecc66efbab4be75420c9435ca82ed94d016da6f787b371fdcba. Root and distinct reviewer both verified all33 raw Git blob pins before invocation. PR125 records the plan before this collection; plan-head CI36786759659 passes. No production code is changed.

ExecutionId is local-runtime-recipe-bundle-e8c0cf9a29896a561fde95a0. The private directory is `/home/autoworld/pg-private-runtime-recipes-0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93-e8c0cf9a29896a561fde95a0`.

| Original retained proof | Exact bytes and identity |
| --- | --- |
| Root ACK `/home/autoworld/pr125-real-runtime-recipe-archive-6f672b9.log` | 1,268 bytes/SHA05e96b883c6b81e93dea83217fd98174b37dfab356fa2bc6a13729b88e68cf4c;0:0/0600/single-link,dev2096/ino110418 |
| receipt.json | 29,990 bytes/SHA6c8caa69515bc33a91bf9e83008f13ffcd754e2a08ddd0bf3e8b26df8530d576;1000:1000/0600/single-link,dev2096/ino112649 |
| source/recipes.bundle | 9,608,971 bytes/SHA32d9efadaed930fb772e88dee2656dee42a92dd76fcaefc4565652f6a3183dee |

The receipt says RECIPE_BUNDLE_VERIFIED with MATCHING_COLLECTOR_ACK_REQUIRED. The original root-private stderr capture is empty; accepted execution requires exit0 and complete matching ACK. Separate privacy/preservation APPROVE authenticates full original ACK/receipt bytes/native identity before parsing, closed top-level schemas, metadata-only fields, no secret signatures, exact two-directory/two-file EXT4 inventory and all limited claims. The prior PR123 receipt/bundle and accepted V3 receipt/root ACK have complete unchanged original hashes; the old async bundle is not replayed against a new HEAD. This scoped preservation check does not claim another full image-archive or Windows/Docker replay.

Distinct original review APPROVE authenticates original ACK/receipt/bundle full bytes and closed schemas, native seals and exact private inventory, then replays the unchanged default validator on a separately created byte-identical UID1000/0700 scratch copy. Only that replay proof's file identity describes the scratch copy; the original retained native proof remains independently authenticated. Real UID/GID1000, empty kernel Groups, capabilities0, NNP and closed environment are checked. Default replay verifies eight refs,33 blobs, full strict fsck, zero prerequisites, removed owned auxiliary repositories and clean6f before/after. Original descriptors are held and complete native/path/hash/EOF seals checked again after the child; every descriptor closes. Original bundle inode112672 is distinct from receipt112649 and the scratch copy. The independent root-private journal `/home/autoworld/pr125-independent-original-review-98lijM/result.log` is1,759 bytes, SHAd2d006a58a11097892e473efd58347cc5949d0183d5694d8924927656bd06dc1, with empty error.log. The earlier reviewer transport failure occurred before Node; it remains failed and is not a collector/default replay failure. No original archive, V3 ACK, Docker or registry operation is needed for this review.

## Problem and prerequisite

The accepted PR124 runtime addendum preserves three payloads and a paired root supervisor ACK, but its implementation recipe6f672b96747c857d5704ca32550ac0418fa014f2 postdates the prior PR123 bundle. That older bundle cannot be relabelled as retaining this implementation.

PR124 merged at6649766410a86a019fa18b711c78d5af21c40a17, preserving final reviewed tree7bc2d8c84c591728c3a2c2ccacc15c4c59433f89 from6a4b4cee5190be0ab059bd99adf2d405309ebf98. Exact final-head CI36786276233 and merged-main CI36786525955 pass. Original V3 byte/native and separate privacy/preservation reviews APPROVE. The native source checkout stays clean at exact6f672b9 through capture and independent offline replay; only the separate Windows documentation branch advances.

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
