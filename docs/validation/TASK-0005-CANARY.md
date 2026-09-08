# TASK-0005 — public attestation canary evidence

Status: IMPLEMENTATION UNDER REVIEW; no real attestation produced or verified yet.
Contract: [ADR-0006](../decisions/ADR-0006-public-attestation-canary.md).

## Finite acceptance

- One fixed harmless file, two manual runs at most, ten-minute timeout per run.
- Main M and metadata-only branch B have identical workflow and fixture bytes.
- Genuine main and branch bundles each pass both official CLI checks under their own identities, with identical unique verified results.
- The genuine branch bundle fails main policy; changed file bytes and wrong expected workflow each fail the relevant policy under valid-bundle controls.
- Missing/truncated input and unexpected CLI/network failures are errors, never successful security negatives.
- Final evidence/removal PR receives review and required gates; verified main no longer contains the canary workflow.

## Current evidence

The six targeted tests pass locally with Node22.23.2. They inspect the real workflow and fixed fixture, exact verifier argv, ambiguous/changed inputs, the two-call conjunction and classification boundaries. Injected CLI results are explicitly synthetic; they prove no signature or real GitHub behavior.

The forced root check passed: 16/16 root tests, zero skips; lint9/typecheck11/test18/build9 Turbo tasks, all uncached; secret scanning of133 tracked files and dependency audit passed. The author log SHA256 is `14b973d3a01242d1bf6f6c1cf25ee6732f50e0e2fc33d9464b2a4ec9c9de6be8`. Fresh-clone, independent-review, final-head/main gates and actual run evidence remain pending.

The real CLI incompatibility was reproduced before any issuance: gh2.98.0 rejects combined `--cert-identity`/`--signer-workflow`. ADR-0006 records the coordinator-approved two-call correction. The exact public fixture SHA256 is `d8bacf5b23f03435e17bde784994c671270c6bc8b610aabe7883e304c8346663`.

| Required real result | State |
| --- | --- |
| Main M run and exact bundle | NOT RUN |
| Branch B run and exact bundle | NOT RUN |
| Main dual-policy positive | NOT RUN |
| Branch own-identity dual-policy positive | NOT RUN |
| Valid branch rejected by main policy | NOT RUN |
| Changed file rejected | NOT RUN |
| Wrong workflow rejected | NOT RUN |
| Missing/truncated bundle fail closed | Unit/filesystem behavior only |
| Workflow removal and verified main | PENDING |

## Reproduction boundary

`scripts/verify-attestation-canary.mjs` exports `verifyPair({ file, bundle, sha, ref })`, using official gh on the exact local file/bundle. Both checks retain all common constraints. Use `mainRef` for M, `branchRef` for the genuine branch control, and `wrongIdentity:true` only for the controlled wrong-workflow negative. `negativeProved` accepts no raw CLI error without the valid same-bundle control and expected perturbation. The final evidence PR will bind calls to actual run IDs and immutable inputs; no placeholders count as completed proof.

Verification outputs and source/ref/runner certificate bindings are distinct from workflow-controlled provenance predicate fields. Manual event origin requires actual run evidence and the exact reviewed workflow; no cryptographic event-binding claim is made.

No image, source/customer payload, registry or durable secret is part of this experiment. Its possible PASS leaves TASK-0005/5A unaccepted and 5B/6 blocked. PR #7 and PR #8 are preserved; the full-roadmap heartbeat remains PAUSED.
