# TASK-0005 M3B — scanner archive publication and local byte restoration

Status on 16 November 2026: `SOURCE_REVIEWED / NATIVE_CI_PENDING`.
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

At that initial checkpoint no independent review was claimed and no subagent had
been started. The user subsequently authorized agents; the actual reviews and
corrections are recorded below. A future VPS archive migration must preserve
the Windows originals and prove private ownership, byte identity, complete local
restoration and retention before replacing that copy's role. Approved plan bytes
(including Markdown trailing spaces) remain intact; these source fixes do not
amend its acceptance thresholds or previously recorded approval identity.

## 16 November — PR241 reviews and integration corrections

[PR241](https://github.com/CleMeY15/auto-world/pull/241) was opened as a draft on
`a77fcbb8ac2bca4b25456860e33c5bf6d9510984`, after the user completed the GitHub
workflow authorization. Two independent source reviews returned **REQUEST_CHANGES**
on that revision. Their findings are not approvals of the following corrections.

Publisher review found the4MiB bootstrap cap incorrectly applied to the scanner
layer, a public receipt0400/profile100644 mismatch, cleanup of unacquired paths or
container names, ambiguous nonzero inspection statuses counted as absence,
unbounded download closure, and loss of known facts in failed receipts. Restore
review found rejection of legitimate zero-byte provenance stdout files, a WSL
target from another checkout, and the same download deadline issue.

Corrections prepared:

- Publisher descriptors use their separate archive-layer cap; bootstrap/read caps
  remain unchanged. Public receipts are explicitly0644 and tested through the
  ZIP consumer using the actual producer file mode.
- Cleanup tracks acquired directory identities and successful container IDs;
  collisions and substituted paths are preserved. Docker absence requires the
  expected refusal, and final inventory must match the baseline. Failed receipts
  retain completed phases, the failed phase and known publication identities;
  uncertain cleanup remains unknown, never a successful claim.
- Both download callers pass their bounded budget. The shared transport races
  timeout/abort and refuses unknown child closure after at most five additional
  seconds. Tests cover suspension both before output and after all bytes.
- Native restore accepts zero-byte files under the authenticated manifest and
  retains all hashes/inventory checks. The native fixture now includes the four
  empty stdout files. Helper/wrapper/policy pins change together; native Windows
  execution remains pending.
- Production copying requires the exact Windows checkout used by the fixed WSL
  command before API intake or credential transfer; worktrees, UNC and substituted
  paths are refused. Delivery must update that checkout, not execute another tree.

The first [quality run43909367783](https://github.com/CleMeY15/auto-world/actions/runs/43909367783)
failed with3077 passes, four failures and67 exclusions. Two failures detect changed
shared-library pins in generation5; two isolated native bootstraps lack the newly
eager-loaded scanner profile. These are actual source integration defects, distinct
from the earlier local tmpfs failures. The scanner ZIP profile is now loaded only
when that profile is selected. A new **PENDING** admission generation preserves the
historical generation5 instead of rewriting its pins; its separate evidence and
ADR record no installation, support activation or image admission.

The corrected focused suites pass131 tests/seven Windows exclusions. An actual
download of the fixed5119275-byte qualification ZIP through the production
transport and owned reader completed successfully:689 entries fully verified,
11 selected sinks, original digest unchanged. This read-only replay validates the
lazy scanner-profile path; it is not a new qualification scan or archive publication.
Fresh corrected-source reviews and branch/main CI remain required.

The independent generation6 review on`f86d45bd` returned **APPROVE** for source
only after rehashing all74 files, reproducing the historical locator binding,
checking the exact gen5 fixture and running10 tests without exclusions. No
native installation, archive migration or admission was approved.

The independent publisher re-review on`f86d45bd` also returned **APPROVE** for
its source scope, including the workflow/policy and three shared primitives.
All six prior publisher findings were verified corrected;85 pure tests passed
without exclusions. This does not establish actual private publication/readback.

The independent restore re-review on the same revision confirmed the three
previous fixes but returned **REQUEST_CHANGES** for the Linux copy's own image
inspection: status1 alone could mean a daemon failure, not absence. That caller
now requires explicit `No such image/object` output before login/pull; errors,
signals and other statuses refuse before any image acquisition. A regression
covers absence, an existing image and ambiguous daemon/error/signal results.
This correction does not change the generation6 execution pins or native helper.

The independent delta review on`1f7f50aa` returned **APPROVE** for the correction
and confirmed that the previously approved publisher, workflow, policy, shared
primitives and generation6 files are unchanged. Its source tests passed26 cases,
with seven native Windows exclusions. Combined targeted checks on this commit
passed142 cases, with the same seven exclusions.

To exercise those native cases before delivery, a dedicated `contents:read` CI
job uses the documented [GitHub Windows2025 runner](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)
and Node22.23.2. Only the synthetic test harness accepts the runner's absolute
PowerShell executable path. Production host/hash/path checks are unchanged.
The job compiles and exercises the actual C# helper in newly owned temporary NTFS
fixtures, including empty provenance files, collisions, ACL/identity checks and
cleanup refusals. It has no package/OIDC authority and never invokes the real
copy entrypoint, scanner, publisher, private archive or service lifecycle.
Its independent source review returned **APPROVE**, including LF preservation
before checkout and the fixture-only host override. The reviewer reproduced
three portable passes/seven Windows exclusions, lint and whitespace checks.
Acceptance requires the actual Windows run to pass all ten tests with no skips;
it cannot replace the real fixed-host NexusLite copy/offline-restore proof.

Before consuming the single publisher dispatch, compare fresh managed-job tool
observations with the fixed qualification: the publisher requires Go1.24.13
and exact Docker/Buildx observations. Hosted-runner drift must be resolved and
reviewed before dispatch, not by rerunning a consumed first attempt.

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
