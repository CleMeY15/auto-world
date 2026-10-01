# TASK-0005A — consolidated PostgreSQL source and evidence closure

Status: IMPLEMENTATION_AND_NATIVE_PROOF_PENDING. This is P1 of the [closed admission exit plan](TASK-0005A-ADMISSION-EXIT-PLAN.md), in the existing draft PR129. It does not admit an image, begin support, or complete TASK-0005A/0005.

## Complete material batch

The fixed manifest binds PostgreSQL candidate `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93` to323 remaining declared materials:

| Role | Materials | Expected identity |
| --- | ---: | --- |
| Aports recipes | 34 | Original recipe SHA256, size and exact declared commit/path |
| Source archives | 35 | Complete APKBUILD SHA512 |
| Functional patches | 147 | Complete APKBUILD SHA512 |
| Auxiliary sources | 84 | Complete APKBUILD SHA512 |
| Install hooks and triggers | 22 | Exact Git commit/path, blob OID, size, mode and type |
| Older Go standard-library source | 1 | Go1.24.6 complete archive SHA256 and size |

The public Git metadata identifies19 regular hooks and3 symlink blobs. The latter are retained as pointer bytes in regular private files; the collector does not resolve their targets. Every provenance edge remains in the manifest. Complete archives and receipts already accepted in PR127/128 remain references, without replaying their collectors or recopying them.

Root's independent static comparison authenticated171827 bytes of34 prepared recipe texts against the captured collection, matched all266 checksum declarations and compiled material URLs/roles, and compared all22 hook pins to the captured eight exact-commit Git-tree records. This establishes the compiled expectations, not remote availability, physical retention, notices, source-to-binary reproduction or admission.

The deterministic manifest's canonical SHA256 is `3ce9a629c3f9aa037a8ffa4d3ff60c7fe42272937b72cc82e59e04f7ba2358f3`. Caller-supplied coherent replacements of URL/hash/commit/role are rejected. No APKBUILD expression is executed.

## Opaque acquisition and recovery

The single collector streams exact HTTPS inputs into exclusive private files, checks full expected digest and EOF, fsyncs, publishes without replacing an existing object, and reads retained bytes back. Objects are named by expected digest. An existing object is reused only after complete byte verification; a failed attempt is preserved and cannot count toward a completed batch.

Limits are specific to opaque collection:1GiB per object,4GiB total retained and failed bytes,1GiB disk reserve,10minutes per object,60minutes per batch, sequential requests and four redirects within the reviewed exact host policy. They do not alter the old archive-reader bounds. No HTTP credentials, proxy inheritance or TLS verification bypass is permitted. A concurrent writer or an unreviewed stale lock blocks; normal cleanup removes only the held owned lock identity. Checkpoint and receipt publication is atomic, with full readback and held descriptor seals before ACK.

The production batch loads only the compiled323-material manifest. Its context records the collector, manifest module, raw JSON and runtime identities. Self-observed source files are explicitly not authentication of executed code. The actual native launcher must establish the code boundary separately: authenticated complete code bytes copied into a new root-owned directory, imports protected from the1000 actor, then before/after code and directory seals. Trusted administrator/root, kernel and managed Node/TLS boundaries remain; there is no hostile same-UID or off-host immutability claim.

The native actor is Linux1000:1000 with empty kernel supplementary groups, zero inheritable/permitted/effective/ambient capability sets, no-new-privileges and the five fixed environment entries, using Node22.23.2 on private ext4. The default CLI emits one ACK, with exit0, both physical pipe EOFs and empty stderr required for successful acceptance. Root independently authenticates that ACK/receipt and every expected retained object against the reviewed manifest. An incomplete byte collection remains incomplete, without runtime authority.

## Layer and notice coverage

The additive retained-layer inspector obtains authenticated ranges from the unchanged outer candidate proof. It passively inventories twelve uncompressed TAR changesets, historical APK records, final surviving entries and notice candidates. Whiteouts/opaque operations apply to lower layers before same-layer additions. Parents must be directories or explicitly replaced by directories in that layer. Links are metadata only. Notice-name links remain visible as unresolved candidates.

The original candidate proof results and limits remain unchanged. The layer inspector has separate bounded headers, paths, APK databases, notices, overlay work and output. Unsupported TAR formats, ambiguous topology and exceeded bounds reject the new proof. `.postgresql-rundeps` remains a synthetic dependency record, not an invented upstream package. Final-file and final-package inventories do not by themselves cover source obligations for materials retained in older layers.

The generic source-archive notice reader is additive; the byte-pinned core used by PR127/128 stays unchanged. Archive traversal is passive, bounded and never extracts files, follows links or executes source/archive code. Notice filename observations require an explicit package/source/subpackage/layer coverage table. Any incomplete enumeration, unsupported format or unresolved applicable notice remains a P1 gap; a filename or selected root license does not establish complete notice coverage or legal compliance.

## Validation and remaining acceptance

The manifest has14 passing tests on Windows and Linux, zero skips. The layer inspector and eleven old candidate-proof tests have26 passing tests on both platforms, zero skips, with independent approval after the two demonstrated topology/link repairs. The collector has21 passing Linux root tests, including a real restricted1000 actor and complete323-material no-network orchestration; its genuine1000 test run has20 passes and one root-only skip. The additive notice reader has21 passing native Linux fixtures, zero skips; Windows has18 passes and three native skips. Its old byte-pinned core remains unchanged. Scoped existing Linux ESLint, Python syntax and secret checks pass. These are implementation fixtures; independent final reader/collector review and full frozen affected quality gates remain pending.

No actual323-material collector, source-notice corpus scan or retained-layer native inspection has run for this implementation. Their originals and final receipts must be recorded here once accepted. P1 stays open until the complete source/notice/lower-layer/evidence map passes. Current eligibility/access, official signing, the second COMPLETE private copy, reviewed main admission and integrated four-service acceptance remain the subsequent gates. No registry write, support activation, public sensitive artifact or default-image execution follows from these implementation tests.

Rollback disables the new diagnostic collectors/inspectors and preserves their source objects, receipts, failures and historical PR127/128 proofs. There is no automatic deletion or image fallback.
