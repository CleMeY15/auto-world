# TASK-0005A — exact remote SeaweedFS runtime diagnostic

Status: NATIVE_RUNTIME_FAILED. [PR87](https://github.com/CleMeY15/auto-world/pull/87) merged at `0ddbf9e2ce37dae1efc9d56f894e751481142777`, with identical reviewed blobs, independent approval and passing [exact-head CI](https://github.com/CleMeY15/auto-world/actions/runs/36327288447) and [main CI](https://github.com/CleMeY15/auto-world/actions/runs/36327666447). Both Linux runs passed all 708 root tests with zero skips and all required gates. The final-head fresh-clone full check also passed. The [first native runtime run](https://github.com/CleMeY15/auto-world/actions/runs/36327798215), number 1 attempt 1, **FAILED** at `PERSISTENCE_SERVICE_TWO/SECOND_READ_FAILED` after the basic runtime verifier. No complete runtime proof exists for the published subject.

The original failure receipt is 664 bytes with SHA-256 `c622135dca912dfd1d45754a05ef405136dd9cef907b63a41da750cf1560a130`. Artifact `10934517674` is 818 bytes with API digest `sha256:c45bd74e68e63be79f47495db007cfaf1994d201474a0b6d001c48bbc882d406`. The receipt records `seaweed_candidate_runtime_persistence_failed`, no runtime cleanup failure, no image cleanup failure and no temporary cleanup failure. The separate cleanup command returned `CLEANED`. The bounded error does not establish the response status or a root cause; it cannot support a persistence PASS or a guessed diagnosis. The failed run is preserved while the readback failure is investigated before any new reviewed dispatch.

The remote audit run `36325906357` completed successfully with zero findings/blockers and successful cleanup. Its actual receipt/report hashes and artifact identity are pinned in [the runtime policy](../../infra/seaweed-image/candidate-remote-runtime.json); [audit evidence](TASK-0005A-SEAWEED-REMOTE-AUDIT.md) records the native result. The [local retention record](TASK-0005A-SEAWEED-LOCAL-RETENTION.md) distinguishes preserved public evidence from the still-missing complete image archive and offline restore.

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
