# PostgreSQL gosu source and selected-notice retention

Status: IMPLEMENTATION_IN_PROGRESS, 2026-10-01. The four public inputs are prepared privately; no complete native source-retention collection or acceptance has occurred. TASK-0005A/0005 remain IN_PROGRESS and TASK-0006 remains blocked.

## Problem and implementation plan

The accepted declared inventory identifies fifty packages, but its five retained materials are not complete upstream sources. Retain exactly four complete source archives: gosu1.19, github.com/moby/sys/user v0.1.0, golang.org/x/sys v0.1.0 and Go1.26.8. Preserve selected original LICENSE/PATENTS/module/VERSION members inside those complete archives, with exact member byte references. Other APK origins, PostgreSQL and older-layer sources remain separate work.

The fixed policy independently authenticates complete compressed sizes/SHA256, the gosu source SHA512 from the retained APKBUILD, and both genuine module h1/go.mod hashes from the authenticated gosu go.sum. Hashing a ZIP file is distinct from computing a module h1 over all members. An archive name, PAX comment or source URL does not prove an independently authenticated Git object or source-to-binary reproducibility.

Use a new passive inspector with the existing regular `/usr/bin/python3.12`, version3.12.3, and `-I -S -B`. Hold independently authenticated readonly archive descriptors3–6 and the reviewed helper descriptor7. Fixed roots, paths, counts, expansion budgets, TAR completion, ZIP layout/CRC/EOF and genuine h1 checks precede a closed bounded result. Record gosu's fixed `.dockerignore` link as metadata without following it. Do not extract or execute archived source code. Existing GitHub/Docker archive profiles remain unchanged.

The binary, zipfile and tarfile byte pins and root-owned ancestors are checked before/after. Other transitive stdlib imports remain within the disclosed trusted operating-system/root boundary; three pinned files do not authenticate the entire Python installation. No package, interpreter, service, credential or storage provider is added.

The actual UID/GID1000 Node collector uses the established ext4/native9/private-parent/source-Git guards. Copy the four complete archives into one new0700 root with one0700 archives/ child. Exactly four0600 single-link archive files and receipt.json are allowed. Authenticate original and copy bytes, passively inspect held readonly copies, publish/reseal the receipt, and close all descriptors before its matching bounded ACK. A receipt alone is incomplete. Require supervisor exit0, stdout EOF and empty stderr. Late output failure retires only a receipt still proved to be the collector's owned inode under stable parents; foreign replacements remain untouched, uncertain cleanup stays UNVERIFIED, and all payloads/originals are preserved.

Tests cover closed schemas, genuine module/selected-text binding, hostile archives, readonly FD inheritance, native copy/path/identity guards and publication/output retirement. Harmless copy fixtures are partial evidence and cannot replace the actual fixed Python/corpus/default collection. Complete fresh lint/typecheck/tests/build/secrets/audit, independent implementation/trust review and exact implementation CI precede that sole collection. Distinct original/default/native and privacy/preservation reviews precede acceptance; exact final-head/main CI and matching reviewed merge tree precede delivery.

Observability contains only fixed phases/reasons, sizes, hashes and native metadata. Selected public text is private evidence, never raw diagnostic output. Rollback disables/reverts this additive collector and preserves archives and failed proofs. No migration or user-facing change is involved.

## Prepared inputs, not retention acceptance

The distinct reviewed preparation helper31145ba924a2a62da35f6a437e45cce7d9f59df187180dfc7ffa4e16e776f72d has one successful actual1000 invocation with empty kernel supplementary groups, zero effective/permitted/inheritable/ambient capabilities and NNP1. It authenticates and copies the four already reviewed public Windows preparations with full size/SHA256/EOF and unchanged source descriptor/path/ancestor seals. New files are exclusively created, fsynced, fully reread and resealed; all descriptors close. No archive parser or retained-source default collector ran during this preparation.

Directory `/home/autoworld/pg-public-source-inputs-0045bdab-20261001-a2d74eb60d0a9697f9e3b7cf` is1000:1000/0700/ext4,dev2096/ino112771. Four files total36,042,799 bytes, are1000:1000/0600/single-link, and have distinct inodes112772–112775. Their complete byte/member expectations reside in `scripts/postgres-image/gosu-source-policy.mjs`; no receipt chooses those expectations.

The root-private preparation journal `/home/autoworld/pr127-public-input-preparation-31145ba9.log` is1,617 bytes/SHA24c3131ad2c65bbf7c6c31e0dabc96538e7807a8248f38351debe95b4efb889e,0:0/0600/single-link,dev2096/ino110470; its paired stderr file is empty. The launcher returned exit0 with stdout EOF. The journal explicitly says PREPARATION_ONLY, retentionAccepted:false and sourceClosure:NOT_ESTABLISHED. This is a fixed-input prerequisite, not accepted corpus retention, native passive inspection, a second complete evidence copy or image admission.

## Previous delivery and remaining scope

PR126 merged4275c4f22fd95fc7390e6a3a130485c242d147e5 with unchanged reviewed tree5f77a8faa6b05f68aec0a1fd215305164f62dad2. Exact final-head CI36796381344 and merged-main CI36796608692 pass. Its accepted original inventory and ACK remain historical evidence and are not rerun here.

This leaf can establish retention of this four-archive corpus and selected original texts only. Complete APK and older-layer sources/notices, PostgreSQL sources, source-to-binary equivalence, legal compliance, official attestation and the complete second evidence copy remain open. Currentness is NOT_EVALUATED, runtime permission NOT_GRANTED and admission NOT_AUTHORIZED. Signing is NOT_ATTEMPTED; supportStartedAt/supportEndsAt/archiveUntil remain null. No network, Docker, SQL, candidate execution, registry write, signing or activation occurs in this collector.
