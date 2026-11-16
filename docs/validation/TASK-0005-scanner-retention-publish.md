# TASK-0005 M3B — scanner archive publication and local byte restoration

Status on 16 November 2026: `NATIVE_AND_TOOL_CI_VERIFIED / CURRENT_IMAGE_CORRECTION`.
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

## 16 November — actual Windows CI and hosted-tool drift

The [Windows run43915611898](https://github.com/CleMeY15/auto-world/actions/runs/43915611898),
attempt1/job133468781379, passed all10 tests with zero failures or exclusions.
Independent review of its original API responses and log returned **APPROVE**.
Source83585cddc2b4a8549fbdac137ca49f8329c8ebca and its merge checkout
8c43decd9a939ce2cb26b7347d2d4ecdb8569334 share tree
f0103aefc629cf8731be8f1bd387f15536886a27; the other parent is the expected
protected main cc8ea880. The runner was Windows Server2025/image20261103.298.1,
with PowerShell7.6.9 and Node22.23.2. Every step succeeded. The original log is
22844bytes/SHA256`d6b518603b35442bbc753b4de16967c8d2e6c6252a8de89d1670073d16969155`.
The seven native cases compiled the actual helper and exercised the NTFS
copy/restore fixtures, including legitimate empty provenance outputs.
This accepts the fixture execution, not a real NexusLite archive copy.

The user clarified that SSH currently connects NexusLite to the VPS only;
there is no reverse access. A local NexusLite execution will therefore be
needed unless remote access becomes available. No new SSH server was installed.

Independent pre-dispatch inspection of the original artifact14248574952 from
[cancelled run43913864964](https://github.com/CleMeY15/auto-world/actions/runs/43913864964)
found a real tool mismatch. The run's whole diagnostic is not accepted; its
tool-recording and upload steps succeeded, and its518618-byte ZIP has API-bound
SHA256`04ca6fff3d8ed8d13b02b0979c6f762cccae8ec8a91f5413ad82df9aa6347651`.
Go1.24.13 and the full Docker28.0.4 JSON match PR237 exactly. Buildx changed from
v0.38.1/0dbe87f36ed472fe36b6796c3f70b4210a731fc5 to
v0.38.2/3c4cbd35852fc1a476923627a780a7836c28b654 on
ubuntu24/20261111.370. The unchanged publisher correctly refuses that mismatch.

Preparation now pins the already qualified official Buildx0.38.1 binary on the
disposable runner, without creating a builder or changing the strict publisher
comparison. The [official release](https://github.com/docker/buildx/releases/tag/v0.38.1)
API asset660618355 and its checksums agree on68366498bytes/SHA256
`e25d5cd675092bb5d1d03632fdc46cdf3fede7b514dc5f023a105e00d3ce5ad4`.
Downloaded bytes were verified without execution on the VPS. Docker's
[documented system plugin search](https://github.com/docker/cli/blob/v28.0.4/cli-plugins/manager/manager_unix.go)
supports discovery even with the publisher's fresh HOME/DOCKER_CONFIG.
An independent source review and actual read-only hosted probe are required
before this preparation is accepted. No publisher dispatch has been consumed.

The preparation uses one CI-only installer in both workflows. It refuses local
or self-hosted contexts and existing destinations, authenticates the bounded
download, rechecks the root-owned staged copy, then uses an exclusive hard link
to install it. The probe imports the real publisher child-environment factory,
uses fresh HOME/config directories and compares the before/after Docker image
and container inventories. It has no package/OIDC permission. The unchanged
publisher still compares its actual Docker/Buildx observations to PR237.
All86 portable retention tests pass, with seven explicit Windows exclusions;
Bash syntax, focused ESLint and whitespace checks pass. Native Windows success
above remains bound to83585cdd; the new preparation requires fresh branch/main CI.
The independent setup source/security review returned **APPROVE**, reproduced
15 focused passes without exclusions and independently rehashed the downloaded
binary against the official API/checksum. No production publisher JS, policy,
shared primitive or admission execution pin changed. The probe logs the actual
Docker JSON; comparing that original with PR237 before dispatch remains required.

## 16 November — preparation accepted; current image gates fail

On source`de3868801d479537a85106414965ea3201bb1cd3`,
[Windows43919546237](https://github.com/CleMeY15/auto-world/actions/runs/43919546237)
passes10/10 with no exclusions, and
[the actual Buildx probe43919546414](https://github.com/CleMeY15/auto-world/actions/runs/43919546414)
passes its two tests, authenticated installation and discovery. Independent
original-evidence review returned **APPROVE** for both. Their merge checkout
6e4deabf43bb83248f9c8967ad627aeedeab3bd5 has the same source tree
c97ae2983c7c4b7f84f43de082d73d90bf52ee6c. Actual Go, Buildx and complete Docker
JSON match PR237 byte for byte; Docker JSON1077bytes has SHA256
`f84a732dfdccfea6fe1ce0a1d40a45f6d9bde5a053a6b4ad35b19ad565fa7dc8`.
All steps succeeded with Contents/Metadata read permissions only; Docker image
and container inventories are unchanged. The unique publisher is still unused.

The earlier [managed run43915611761](https://github.com/CleMeY15/auto-world/actions/runs/43915611761)
on83585cdd finished **FAILED**, not cancelled. Its artifact14253410729 is
4081162bytes/SHA256`ef8b8f8ae79623cc5a16a5946739d86b841bb98f6a23f5426bf6fe1d2ae542f2`.
Independent inspection authenticated its original reports/SBOMs and reproduced
the actual policy rejections:19 fixable HIGH occurrences for PostgreSQL,
34 for AWS CLI, and no built OpenSearch image. These are53 occurrences across
31 distinct CVEs, not53 distinct vulnerabilities. The blocked packages are:

| Subject | Package | Observed version | Fixed version reported |
| --- | --- | --- | --- |
| PostgreSQL | krb5-libs | 1.22.2-r1 | 1.22.3-r0 |
| PostgreSQL | libxslt | 1.1.43-r3 | 1.1.43-r4 |
| AWS CLI | glibc/common/minimal-langpack | 2.34-231.amzn2023.0.5 | 2.34-231.amzn2023.0.6 |
| AWS CLI | rpm/libs/build-libs/sign-libs, python3-rpm | 4.16.1.3-29.amzn2023.0.8 | 4.16.1.3-29.amzn2023.0.9 or0.10, by finding |
| AWS CLI | sqlite-libs | 3.40.0-1.amzn2023.0.8 | 3.40.0-1.amzn2023.0.9 |

OpenSearch's Git ADD receives HTTP403 in both runtime and evidence attempts,
before Gradle or tests. No image report follows. The exact commit remains
available through the GitHub API and a separate unauthenticated Git tag read
from this VPS; neither proves the runner transport works. The original logs
contain no HTTP body/headers, so the cause of403 is unknown. Do not change its
source commit or suppress that failure based on this observation.

The scanner controls, Go/JDK builders and Redis/Seaweed audits pass in that run;
the vulnerability database remains fresh. No produced-image runtime phase runs.
The global `managed_image_builds=passed` means collection finished; its nested
OpenSearch result is failed and must not be described as a successful build.
The Buildx setup correction does not alter these image subjects or waive their
rejections. Official immutable OS update candidates are under read-only discovery;
actual fresh audits/runtime and source/main delivery remain required.

The [bounded current OS refresh plan](../../roadmap/plans/TASK-0005-current-os-refresh-20261116.md)
received independent architecture/security **APPROVE** at6174bytes/SHA256
`ba2b743d38222305ab12d9ae689d2025fe8a48aa15528a33e976e3a63a8e6d18`.
The reviewer independently checked21 original files, both PostgreSQL registry
chains, Amazon repomd/primary and20 selected package versions. The
[public provenance record](current-os-refresh-20261116/provenance.json) is
13340bytes/SHA256`12a4b103d4f1eb7ebcb2964164a635b3d2ead449aa622823d499d0669b72f1aa`.
PostgreSQL17.12-alpine3.24 supplies the fixed packages while preserving major17;
the new17.11 digest still declares the rejected versions and is not selected.
AL2023.12.20261112 supplies the coherent signed RPM update for AWS CLI/OpenSearch.
Implementation and fresh actual qualification remain pending at plan approval.
Only fresh diagnostic PostgreSQL data is in scope; a later installed-runtime
upgrade must separately address the official index/backup/extension precautions.

The implementation changes six active files and three directly affected tests.
It requires16 exact AWS CLI RPM versions and19 OpenSearch versions, including
all newly rejected installed components. The existing complete DNF transaction,
GPG checks and CLI/JDK preservation remain mandatory. A PostgreSQL test's
no-tag expression was corrected to distinguish a digest starting with digits;
the current OpenSearch source hash expectation was advanced only after proving
the four Amazon pin substitutions reproduce the exact old audit source when
reversed. Historical source hashes and fixtures remain intact.

Independent implementation/security review returned **APPROVE**, with37 focused
tests passing without exclusions. The reviewer checked all74 generation6
execution-file identities and found no overlap with the changed active files.
The broader local regression passed805 tests with eight existing platform
exclusions and no failures. Lint, typecheck, build, JS/embedded Bash syntax,
whitespace and secret scanning (1413 files) pass. Original reports and the first
failed negative-test mutation are retained; correcting that test did not change
the production implementation. Fresh changed-source/main CI must still prove
real transactions, all image audits, OpenSearch tests and runtime outcomes.

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
