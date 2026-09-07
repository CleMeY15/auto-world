# TASK-0005A validation

Status: IN_PROGRESS; no native tool admitted, no dormant installation accepted, activation BLOCKED.

## Current evidence

- Accepted base: `b9d22a2123ff53acded73eaf800a29dc8f2faf66`, PR #6 merged, main CI [34031090389](https://github.com/CleMeY15/auto-world/actions/runs/34031090389) passed.
- PR #7 remains draft at `31a4a2434d28d2bcb5f1ad2dba3904728e706a1b`; [34144881782](https://github.com/CleMeY15/auto-world/actions/runs/34144881782) quality and integration pass, image audit fails. No service acceptance is inferred.
- 2026-09-07 baseline frozen install and forced `pnpm check` pass on Node 22.23.2, pnpm 10.15.0, Turbo 2.10.12. Turbo lint/typecheck/test/build: 9/11/18/9 successful tasks, zero cached. Root tests 10, vehicle 99, registry 77, SDK 157; secrets scan and dependency audit pass. This is base evidence only.
- Native Architect then distinct Critic approved revision 5 planning hashes recorded in ADR-0005. Their approval covers preparation only; implementation reviews remain pending.
- Live main `protected:false`; ruleset and branch-protection GETs both return HTTP 403 requiring Pro/public. No settings, environments, secrets, keys or registry packages were created.
- Implementation commit `0b4401fb0c81ee858a61be4162fc898fd960087e` adds bounded JSON/OCI/archive validation, explicit material proposals, a native candidate builder, audit identity/inventory checks, subprocess isolation and a closed workflow policy. Local full checks passed during implementation; they do not establish native acceptance.
- Exact commit `61a3896dde31044c13628e5b95f1e1c3247c8ece` passes the general [CI 34157849634](https://github.com/CleMeY15/auto-world/actions/runs/34157849634). Its [native preparation run 34157850993](https://github.com/CleMeY15/auto-world/actions/runs/34157850993) exposed Git's space-aligned `ls-tree -l` sizes before material collection. Commit `a5fc179080722c2e461207094af5b40ba1346feb` corrects that parser; its targeted tests and a real 150-entry repository tree pass locally. Later native phases remain pending.
- No native source build, upstream suite, real vulnerability scan or network-disabled signature test has passed yet. The committed native workflow deliberately refuses installation while these gates are missing.

## Required pending evidence

Source/module/test-material closure; explicit patch review; native upstream tests; exact two-build hashes; native scanner identity/inventory/self-scan and known-vulnerable/clean fixtures; strict hostile policy tests; actual network-disabled disposable signatures; workflow capability audit; forced root/fresh-clone checks; independent final implementation/material reviews; final-head CI and main verification.

Do not turn a pending, skipped or failed item into success. Native evidence must bind exact source/material/recipe/compiler/runner/build/run/output/scanner/database identities. Future service image and GHCR proofs are blocked and cannot be represented by blob or fixture tests.

## Operations and rollback

See [ADR-0005](../decisions/ADR-0005-native-image-chain-bootstrap.md) for numerical caps, safe diagnostics and cleanup. Diagnostic artifacts are not admitted runtime evidence; rebuild before admission if expired. Roll back preparation with a reviewed code revert, preserving raw evidence and all existing service data. No new durable secret or registry object needs cleanup in this scope.
