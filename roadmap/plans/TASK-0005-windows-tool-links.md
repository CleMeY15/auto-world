# TASK-0005 — System32 tool hardlinks and copy preflight

Status: PLAN_REVIEW_PENDING. Owner: infrastructure task coordinator. Date: 2026-11-17.
Branch: `codex/task-0005-windows-tool-links`; accepted base/main
`548630dfc199da06c482a782a629ae168f5f518e`, tree
`96673297ddb5227244054397bc42d8762d49cf5c` ([PR245](https://github.com/CleMeY15/auto-world/pull/245)).
Codex coordinator and independent reviewers: gpt-6-astra / ultra, inherited.
Risk: local executable trust boundary. No UI, service, publisher or image change.
Budget/cost unknown; reassess after two identical failures without new evidence.
The VPS checkout is the only implementation checkout; serialize quality commands.
NexusLite is initially read-only. Preserve its checkout and original evidence.

## Problem and evidence

The real NexusLite invocation on 17 November at06:13Z exited1 with
`scanner_retention_copy_failed`, empty stdout and no accepted copy/restore receipt.
The original log has no internal phase. A later read-only reconstruction found
`scanner_retention_local_tool_identity`: System32 tar has two hardlinks while
`checkFileIdentity` requires one. Do not describe reconstruction as an original
trace. Original evidence is retained under the private archive directory
`scanner-nexuslite-pr245-20261117-3aa91d8e`; its failed attempt remains failed.

Authenticated SSH observation on17 November confirms both names below have
fileID `000000000000000000010000000837ed`, size77824 and the existing pinned
SHA256 `2ca7db442feafa8e6d7a88c7dddf3113128f85701a4eb1182c71cfbf3d479a56`.
Both have TrustedInstaller ownership, the same protected DACL (TrustedInstaller
full access, other listed principals read/execute), and no reparse attributes;
their observed ancestors are not reparse points. The scanner directory is absent.

- `C:/Windows/System32/tar.exe`
- `C:/Windows/WinSxS/amd64_bsdtar_31bf3856ad364e35_10.0.22621.3810_none_35e98cf4e7b7317f/tar.exe`

Windows uses component-store hardlinks; aliases share the file security descriptor
([Microsoft component store](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/manage-the-component-store?view=windows-11),
[CreateHardLink](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw)).
These facts explain this observed topology, not arbitrary hardlink acceptance.

## Bounded implementation

1. Preserve the original retention/recovery plans. This amendment changes only
   the installed Windows tar tool's link rule. Bind its exact second path in
   `local.tar` of the hash-pinned retention policy. Default every other tool to
   one link. Do not change publisher observations, archive identities, helper
   bytes, archive/sidecar/manifest/extracted-file single-link guards or admission.
2. Reuse the current regular-file, canonical-path, size, hash and opened-handle
   identity checks. Require exactly two links for tar, both fixed canonical
   non-symlink paths naming the same device/inode; compare count and identity
   before/after hashing and after alias inspection. Reject missing/extra links,
   substituted alias, changed bytes or metadata. No generic production opt-out.
   The same helper remains testable using temporary real files/hardlinks.
3. Add the production tool/capacity preflight before authenticated network
   intake, retaining the existing recheck immediately before StageTar and the
   restore-side preflight. A read-only preparation can call the
   same exported preflight without invoking copy or helpers. Preserve the exact
   closed environment, paths and no-argument coordinator interface.
4. Add a closed safe error mapping for known local preflight errors at the CLI
   boundary; unknown errors remain generic. Never print raw errors/stacks,
   credentials, arbitrary paths or payloads. The error names distinguish tool
   identity from host/capacity refusal, without claiming an unobserved phase.

This preserves the existing trusted local host/Windows servicing assumption.
File owner/DACL observations are baseline evidence, not a new runtime ACL broker.
The checker closes its file handle before later spawn, as before; it does not
claim resistance to concurrent privileged replacement or servicing. No private
tar.exe copy, Windows-link deletion, ACL mutation, native broker or tool install.

## Acceptance and delivery

Actual temporary hardlink tests must pass only for the bound tool topology;
single-link tools with aliases still fail. Test missing/extra/duplicate aliases,
wrong digest/size, distinct same-content file substitution, symlink redirection,
and deterministic count/identity instability. Test early preflight refusal before
network/download/staging/commit/restore; also test an early pass followed by a
post-intake refusal with no staging effects. Test safe error mapping. Keep existing
archive hardlink negatives. Add the executable-guard fixtures to the native
Windows workflow; Linux fixtures alone are not Windows acceptance.

Obtain independent Architecture then distinct Critic plan review before code.
Run targeted scanner tests, lint/types/build, secrets/audit and applicable final
quality gates; preserve VPS environment limitations rather than weakening tests.
Require independent implementation review, four applicable source/main workflows
and original-evidence review before source/main acceptance. No claim of actual
Nexus copy from fixtures or hosted Windows CI. A later production retry requires
accepted delivery, fresh actual preflight, preserved original failure and absent
owned targets. No further publisher run is authorized.

Rollback: revert this source increment; that restores the old tar refusal and
does not mutate Windows or retained data. TASK-0005/0005A stay IN_PROGRESS;
243 upstream blockers, binary equivalence, image admission/support and final
lifecycle gates remain open. This infrastructure correction is outside the six
product tasks of the full-Codex pilot; costs and timing are recorded separately.
