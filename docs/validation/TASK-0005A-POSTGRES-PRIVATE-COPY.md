# TASK-0005A — PostgreSQL second private copy and reimport

Status: REAL_SECOND_PRIVATE_COPY_REIMPORTED, LOCAL_DIAGNOSTIC, NOT_ADMITTED. Integration gates are tracked in [PR120](https://github.com/CleMeY15/auto-world/pull/120).

## Purpose and dependencies

[PR119](https://github.com/CleMeY15/auto-world/pull/119) retained the exact private PostgreSQL Docker-save archive and passed independent review, final-head CI36700033637 and merged-main CI36700311664 on `28ace5762076cf0650e00e467490260ec35ce075`. This increment addresses the second verified private copy required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md), followed by a complete revalidation after reimport into fresh ext4 storage.

The fixed original directory is `/home/autoworld/pg-local-retention-ejN6ZU/retained`. It and both files remain unchanged, UID1000/GID989, directory0700/files0600, single links. Expected bytes come from the independently reviewed original proof, not from an untrusted receipt:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| candidate.tar | 305474048 | 2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05 |
| retention-receipt.json | 18352 | 9349397a47cf86cfe265cad313318f27eaa71dce2f43e57077225e426a7c0cd0 |

The original retention recipe is `2c6fa14e4fee676afd1942a8dea57e8ca3cbba4e`; a new copy execution records its own clean source separately. Policy bytes retain their reviewed SHA-256 `4dab1fdb15d6a522c8aa64ccd14c81a1c504e188609f395f62dc4a49ab56ce51`.

## Implementation plan

Use existing ignored Windows storage `C:\Users\Administrator\Documents\ChatGPT\Auto-world\.omx\private-archive`, without changing its ACL or creating an account/service. The existing NTFS parent's protected ACL permits only the workstation user's SID and SYSTEM; its Administrators owner is a documented existing property. New copy directories/files must have protected ACLs permitting only that exact user and SYSTEM, with the exact user as owner.

Implement three bounded components without dependencies: a Windows Node22 coordinator, a native PowerShell/.NET helper, and a non-root Linux export/import worker. No registry access, credential, Docker command or image execution is needed. The coordinator accepts no user CLI inputs; production file identities and roots are fixed. Test APIs may accept owned fixture paths without replacing actual platform/ownership/filesystem checks.

Linux export opens both originals with O_NOFOLLOW, verifies real UID/GID/mode/nlink and path/descriptor identities, authenticates policy and original receipt, and runs the complete twelve-layer production archive validator. Its stdout carries exactly the archive followed by the original receipt, with bounded binary streaming and backpressure; exit success requires exact size/hash and unchanged source descriptors. Errors are closed codes on a separate channel.

The Windows helper creates a new scoped child and two exclusive files. Use actual native directory/file handles, relative leaf creation under validated parent handles, no reparse traversal, single links, exact native identities, protected ACL/owner verification, flush and full hash reread. Do not mistake Unix permissions or a path-only ACL check for Windows privacy. No-overwrite and failure preservation apply to the complete operation. Closing an exclusive writer before reopening must preserve its file identity and complete byte proof.

Linux import receives the exact Windows bytes into a new `/home/autoworld/pg-private-reimport-` ext4 directory, real UID1000/GID1000, directory0700 and exclusive files0600. It rejects short or trailing input, fsyncs, reopens the files, rechecks exact identities/hashes, validates the original receipt and replays the full production archive validator. Original source identities and contents are rechecked after import. A separate read-only Linux seal, restricted to that owned import prefix, runs after the final Windows seal; both source and import identities/proof must equal their prior acknowledgements.

A closed copy receipt is written only after all source/Windows/import proofs agree. First prepare a new exclusive empty receipt file and acknowledge its native identity; then fill only that identified empty slot. If writing, process exit or acknowledgement validation fails, a bounded abort may remove only that exact file identity under the same directory identity. An unconfirmed preparation remains empty, never a successful receipt. If identity or cleanup cannot be proved, report uncertainty and preserve the files. Subprocess teardown is bounded; stopping a WSL client alone does not establish that its Linux worker stopped. The worker has its own operation deadline.

Share-mode exclusions alone cannot prove that a directory cannot become a reparse point. Relative handle operations and explicit native checks must be verified on this PC before actual private export. Use a nonsensitive binary fixture for the first native positive/adversarial tests. Retain all original/copy/failure files; never remove foreign archives or change the existing parent ACL.

## Verification and boundaries

Require actual Windows native tests for ACL/owner, reparse/hardlink/collision, identity replacement, binary transport and flush/reread, plus actual non-root Linux tests for ext4/FD identities, substitutions, complete/truncated/extra input and failed receipt publication. Run relevant targeted tests, repository checks, independent implementation review, then an actual fixed-source export/reimport and separate byte/privacy evidence reviews. Require exact final-head and merged-main CI before accepting integration.

The new receipt records LOCAL_DIAGNOSTIC origin, a local execution ID, null GitHub run ID, no registry read/write, image execution/restore, SQL restore, signing or admission, and null support/archive dates. It binds the original archive/receipt hashes, policy, candidate and original recipe separately from this copy execution. Preserve `NOT_ESTABLISHED_BY_DOCKER_SAVE` for independent compressed registry-layer verification.

This establishes availability of a second local copy and revalidation after retrieval. Both copies share this PC and remain vulnerable to workstation loss or administrator deletion. No immutability or complete image/evidence/source/notices/SBOM/bundle closure is established. Actual cold image loading/service restoration, SQL backup/restore, signing, admission and support activation remain separate gates. No audit refresh is required for copying inert bytes; existing currentness gates remain mandatory before later image execution.

Rollback prevents new copy attempts and preserves originals, private copies and failure evidence. TASK-0005A/TASK-0005 remain IN_PROGRESS and TASK-0006 remains blocked.

## Actual evidence

On 2026-09-30 the default input-free coordinator completed on clean source `2eda0dbf031d6eb3e1f1c486c68facf326a62e76`, with that same clean source in the prepared Linux checkout. Windows Node22.23.2, PowerShell7.6.5 and the actual non-root Linux UID1000/GID1000 were used; no platform/ownership/provider/transport/validator was simulated. The WSL calls explicitly select `/` as their working directory after earlier implicit-directory calls failed to respond; no reboot, service restart or distro termination was performed.

Execution `local-copy-bc66fe4853e3a67e0a3497cb` retained a new Windows directory:

`C:\Users\Administrator\Documents\ChatGPT\Auto-world\.omx\private-archive\postgres-0045bdab5483336d-copy-bc66fe4853e3a67e0a3497cb`

Its actual NTFS volume serial is `4a58df34`, directory FileID `00190000001d4e40`. Native handle checks established no reparse traversal, protected user/SYSTEM ACLs, user ownership and single links. Archive FileID `000e0000001d4ef6` and original-receipt FileID `00160000001d4f10` remained equal through the final Windows seal. Their sizes/hashes are the exact original expectations in the table above. The existing archive parent ACL was unchanged.

The exact Windows bytes were imported into a new `/home/autoworld/pg-private-reimport-BW3BmA` ext4 directory, UID1000/GID1000, mode0700. Both files are mode0600/nlink1, UID1000/GID1000. Archive and original-receipt inodes are `106219` and `106220` on device `2096`; original source inodes `106090` and `84064` remain separately bound, UID1000/GID989. The production validator replayed all 32 members, the 12,499-byte configuration, twelve raw layers and twelve compatibility records. Final Linux source/import byte identities and proofs exactly matched the prior acknowledgements; original source bytes were preserved.

All three phases passed: source export/Windows copy (2460ms), Windows export/Linux reimport (2943ms), and final seals (3199ms). After exclusive empty-slot preparation, identified publication, flush and full reread, `copy-receipt.json` (native FileID `00200000001d4f2e`, protected user/SYSTEM ACL, single link) is 26,562 bytes, SHA-256 `764c1c7d1b2f50b0c66fba894cb31e892134ab8327e2f3e56df921180989235d`. The original receipt was copied byte-for-byte, never rewritten. Its retention recipe `2c6fa14e4fee676afd1942a8dea57e8ca3cbba4e` and execution `local-30158484150150` remain distinct from the new copy recipe/execution.

The closed copy receipt is LOCAL_DIAGNOSTIC/COPIED_AND_REIMPORTED with a null GitHub run ID, no registry read/write, image execution/restore, SQL restore, signing or admission, and three null support/archive dates. This demonstrates a second local private copy and retrieval/revalidation of the inert Docker-save bytes. Compressed registry-layer verification remains `NOT_ESTABLISHED_BY_DOCKER_SAVE`; no cold image load/service restore or full archive closure is inferred.

Fresh actual Linux UID1000/GID1000 checks on this exact source passed 106 focused tests without skips, root/full-package lint, all eleven package typechecks, eighteen package test tasks and nine builds. The full root suite passed 1208 tests with zero failures and seven explicitly Windows-only native tests skipped on Linux; the separate actual Windows native suite passed all seven, zero skips. Secretlint passed for 532 tracked repository files and the dependency audit found no known vulnerabilities. Independent coordinator and Linux/native implementation reviews approved; the native Windows suite was independently replayed. Exact implementation CI [36705187665](https://github.com/CleMeY15/auto-world/actions/runs/36705187665) passed. Independent original-byte review approved full Windows validation and before/after native seals, plus a real default Linux final-seal replay of original/imported bytes and unchanged identities. A separate receipt/privacy/metadata/documentation review approved the original closed receipt and native metadata. Exact final-head/main CI remain required integration gates tracked in PR120.

## Native API references

The relative create/open contract uses Microsoft's [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) and [OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes). ACL/owner checks use [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo); [FileStream.Flush(true)](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.flush?view=net-10.0) requests durable file flushing. These native primitives still require the actual positive/adversarial tests above and do not establish immutability against an administrator.
