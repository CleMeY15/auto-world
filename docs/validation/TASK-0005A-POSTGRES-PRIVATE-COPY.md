# TASK-0005A — PostgreSQL second private copy and reimport

Status: IMPLEMENTATION_PLAN, LOCAL_DIAGNOSTIC, NOT_ADMITTED.

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

## Native API references

The relative create/open contract uses Microsoft's [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) and [OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes). ACL/owner checks use [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo); [FileStream.Flush(true)](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.flush?view=net-10.0) requests durable file flushing. These native primitives still require the actual positive/adversarial tests above and do not establish immutability against an administrator.
