# TASK-0005 M3B — scanner archive publication and local byte restoration

Status on 16 November 2026: `IMPLEMENTATION_AND_REVIEW_IN_PROGRESS`.
TASK-0005/0005A remain `IN_PROGRESS`. No actual scanner archive publication,
second copy or restoration is claimed by this implementation checkpoint.

## 16 November — resumed source validation on the VPS

The user explicitly resumed TASK-0005 after restoration and confirmed that
NexusLite remains available. The long-term destination is the VPS; the current
Windows/NTFS second-copy contract is not replaced by Linux tests.
No scanner, publisher, bootstrap or service lifecycle was executed in this resumption.

Source corrections after restoration:

- Qualification API intake rejects missing/invalid/changed expiry and creation
  metadata, ambiguous job inventories, wrong run identities, and missing, duplicated
  or unsuccessful material-producing steps. Copy intake rejects invalid or future
  creation dates, invalid clocks and expired artifacts; API requests have a15-second
  abort signal and reject redirects.
- Publication readback inspects the actual pulled image and created container
  before asserting `stoppedNeverStarted`. Configuration, digest, platform, container
  identity and both zero timestamps must agree; a historical start is rejected.
- Linux copying gives the commandless scratch image an explicit inert command for
  `docker create`, uses `--pull never` and checks its configuration digest against
  the authenticated receipt. No container is started.
- The workflow restricts the whole job to the first main dispatch before provenance
  work and checks the pinned Go reader before inventory creation. The existing
  native helper and wrapper have exact byte/hash pins in the local policy.
- The unused import blocking lint was removed. Wrapper/source binding tests now
  run on Linux too; the seven native NTFS cases still require Windows.

Actual read-only qualification API validation passed on16November using the new
validator, including the exact accepted job steps and artifact metadata:
artifact13706967607,5119275 bytes,
SHA-256`063bcda8a6e60bbe9f419663d5c4a634f342506df66d325fe57582f4e5dc7551`,
expiry23November2026 at20:18:16UTC. This is not a new scan or admission result.

The targeted suite passed124 tests, with seven explicit Windows exclusions and
zero failures. All28 workspace test/build tasks passed uncached. Lint, typecheck,
build, secret scanning and dependency audit passed
on the VPS; the dependency audit reported no known vulnerabilities. A native
full-root attempt recorded2903 passes,163 failures and124 skips. The VPS `/tmp`
is tmpfs: multiple existing native tests require ext4 and explicitly refuse this
storage. The full-root result remains **FAILED**, not waived or counted as an
accepted full quality run. The historical privileged wrapper targets a different
checkout and was not reused as evidence for this branch. Fresh branch CI is required.

Current closure dependencies:

1. Independent complete source/security review and exact-source CI, followed by
   protected-main delivery, before the one-shot publisher.
2. Actual private archive publication/readback and a separately recorded publisher
   tuple; `observations.publisher` remains null until authentic reviewed evidence.
3. An executable connection to NexusLite and Windows validation of the changed
   orchestration. This VPS session exposes neither the T3 environment link tools
   nor an SSH client configuration for NexusLite. Its available GitHub login has
   no `read:packages` scope; it is not the former Windows login.
4. Actual second-copy/offline-restore proof, then service-image closure, current
   vulnerability checks, signing/admission and final four-service acceptance.

No independent review was fabricated and no subagent was started, in accordance
with the user's standing preference. A future VPS archive migration must preserve
the Windows originals and prove private ownership, byte identity, complete local
restoration and retention before replacing that copy's role. Approved plan bytes
(including Markdown trailing spaces) remain intact; these source fixes do not
amend its acceptance thresholds or previously recorded approval identity.

## Authority and scope

The [private read prerequisite](TASK-0005-scanner-retention-read.md) is accepted
through PR239, protected main `cc8ea880ef49f87cc5cf63fe211e072e845493a0`.
The exact55554-byte [v10 revision2 plan](../../roadmap/plans/TASK-0005-scanner-retention.md),
SHA-256 `1cac817bd6ac4ab1bbb7b257e81e9be500bf6344a703149cdf4ce163c80d721e`,
received actual ordered Architect APPROVE and distinct Critic OKAY reviews.
The qualification authority remains PR237's fixed M3A run `42684309304`,
artifact `13706967607`, rather than a later diagnostic run. Its original ZIP
is5119275 bytes, SHA-256
`063bcda8a6e60bbe9f419663d5c4a634f342506df66d325fe57582f4e5dc7551`,
and expires on23 November 2026 at20:18:16UTC. Expiry refuses intake.

The archive contains exactly50 regular USTAR members: fresh official scanner
provenance, the upstream archive and binary, the qualified source/fixture blobs,
11 selected diagnostic reports and generated bindings. It excludes service
images, vulnerability/Java database payloads, application data and image
admission. Trivy is never executed by publication, copying or restoration.

## Implemented boundaries

- The publisher uses protected main, exact qualification API/ZIP identities,
  fresh official provenance, a deterministic GNU tar1.35 profile and a private
  scratch image with one payload. A fresh authenticated digest readback must
  recover identical inner archive bytes from a stopped, never-started container.
  Public artifacts contain only a bounded receipt.
- Copy preparation authenticates the successful publisher receipt and retains
  the expected sidecar bytes in the same Node process. A null publisher tuple
  refuses actual copy before effects. The post-publication tuple must be reviewed
  and delivered before this copy entrypoint can execute.
- Windows copies one bounded binary stream directly to the exclusive `.part`.
  It checks owner/ACL, NTFS identities, size and hash before two no-replace
  renames: archive first, sidecar last. These are not an atomic two-file transaction.
  Incomplete states are preserved and existing targets are never overwritten.
- Offline restoration uses only the fixed Windows Node/PowerShell/bsdtar
  tools and the committed local pair. It verifies USTAR before bsdtar, extracts
  and authenticates the manifest first, then the49 other files, and checks
  their native handles, ACLs, identities and hashes before exact owned cleanup.
  No network fallback or operating-system network-isolation claim is made.

The original Win32 relative rename probe failed with error123 on this host.
The native helper therefore uses documented user-mode `NtSetInformationFile`,
`FileRenameInformation=10`, retaining relative `RootDirectory` and replacement
disabled. See Microsoft's [API contract](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetinformationfile)
and [rename structure](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information).
Directory flush records actual support; it does not assert crash durability.

Every local child operation has a180-second limit,64KiB stderr/proof bounds
(raw exports use the authenticated archive bound), and at most5seconds to
observe exact-child closure after failure. Unknown closure refuses acceptance.
Restore cleanup is a separate native operation, restricted to the new owned
extraction tree after complete revalidation. A partial cleanup remains a failure.

## Verification checkpoint

The shared archive/ZIP/environment extensions and initial policy/manifests
received an independent APPROVE review with zero findings:56 tests passed,
3 Linux-only tests skipped on Windows, ESLint/static checks passed. The real
qualification ZIP was read completely:689 entries,49888165 expanded bytes,
11 selected sinks and the exact original digest.

The native Windows slice reported10 passing NTFS tests, including collisions,
interruption, links/reparse points, identity/ACL checks, exact inventory and
cleanup refusals. The Node restoration/sidecar slice passed19 targeted tests,
including startup/midstream/post-byte suspension, truncation, overrun, early
consumers, unknown child closure and manifest-first ordering.

These targeted results do not replace independent complete implementation
review, full Linux quality checks, exact-source/protected-main CI, actual private
publication, C copy/restoration or independent review of their original evidence.
Helper pins, integration and final acceptance remain subject to those checks.

## Recovery and remaining work

Keep failed attempts, original bootstrap/read receipts, package versions and
incomplete local pairs. No broad Docker pruning, local image build, service
restart, archive deletion or permission expansion is introduced. Rollback
disables the new writer and revokes unadmitted inventory while preserving bytes
and history. The bootstrap workflow remains consumed and disabled.

Acceptance closes only the scanner-material retention row. Service-image
closure, admission, support activation and TASK-0005's final acceptance remain
separate. Support dates stay null and fork isolation stays `NOT_VERIFIED`.
