# TASK-0005A — exact remote SeaweedFS runtime diagnostic

Status: IMPLEMENTATION_IN_PROGRESS. No native runtime receipt exists for the published subject. The remote audit run `36325906357` completed successfully with zero findings/blockers and successful cleanup. Its actual receipt/report hashes and artifact identity are pinned in [the runtime policy](../../infra/seaweed-image/candidate-remote-runtime.json); [audit evidence](TASK-0005A-SEAWEED-REMOTE-AUDIT.md) records the native result. This runtime lane still needs full verification, independent review, integration and native execution.

## Reviewed implementation plan

Architecture review selected a separate read-only workflow for the fixed private subject already bound by `candidate-remote.json`. The old local runtime workflows and the remote scanner workflow remain unchanged. No new source, production deployment, registry write, signing or admission is included.

1. Bind the actual successful remote audit to its workflow, run/attempt/revision, artifact identity and exact receipt/report bytes. Require complete, fresh evidence, zero blockers and all cleanup controls before any candidate execution.
2. Factor the existing remote pull/save/validate transaction behind two explicit wrappers. Preserve the scanner wrapper's arguments, phases, receipt and `execution: NOT_ATTEMPTED` behavior. Its existing regression tests lock that contract before the refactor.
3. The new runtime material wrapper exposes only its owned parent, Docker configuration, exact image/subject, archive proof and current diagnostic run/revision to the runtime suite. It uses a distinct diagnostic receipt and never emits the scanner receipt for executed material.
4. Execute the five existing verifiers in order: runtime profile, restart persistence, strict contention, backup/restore and host loopback. Validate every proof against the same config image ID and current diagnostic run/revision. Return success only after every verifier and provider cleanup succeeds.
5. Preserve the primary runtime diagnostic, runtime cleanup uncertainty, image cleanup failure and temporary cleanup failure separately. Never force-remove uncertain Docker resources. Upload only bounded, sanitized technical receipts, with no private image archive, layer, credential or source payload.
6. Add an input-free, first-run/first-attempt protected-main workflow with `contents/actions/packages: read`, pinned tooling and a GitHub-hosted Linux runner. Verify the complete implementation with targeted tests, a fresh-clone full check, independent review, exact-head CI and merged-main CI before native dispatch.

The exact-subject audit gate passed before the concrete runtime policy was committed. A pending or failed audit cannot authorize execution. The final receipt remains `DIAGNOSTIC_ONLY`, `PUBLISHED_UNADMITTED` and `NOT_AUTHORIZED` for admission, with truthful `VERIFIED_DIAGNOSTIC` image execution and no registry write or signing.

Integration review also found that the existing basic and persistence verifiers discarded the primary diagnostic when their own cleanup failed. Their adapters now preserve the primary phase/reason and a separate bounded cleanup failure, consistently with the existing backup and host-loopback behavior. Real verifier regressions cover combined failures and refusal to remove uncertain resources; legacy local adapters retain both diagnostics as well. Ownership and removal controls remain mandatory.

## Remaining admission boundary

The local second private copy still requires package-read authority that the current local OAuth token lacks. This lane uses the already established GitHub Actions package-read boundary and does not expand that local token. Full image/evidence closure, local restoration, official attestation, consumer admission and four-service lifecycle acceptance remain later requirements.

Rollback disables this manual diagnostic while preserving the stored candidate and historical evidence. It neither deletes the remote object nor changes an admitted inventory.
