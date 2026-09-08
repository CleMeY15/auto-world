# ADR-0006 — Diagnose exact-main attestation verification with a public file

Status: Diagnostic implementation under review; real issuance and verification pending.
Date: 2026-09-08
Scope: One bounded experiment under TASK-0005. No image architecture or activation is accepted.

## Context and decision

TASK-0001 through TASK-0004 are accepted on main `b9d22a2123ff53acded73eaf800a29dc8f2faf66`. The data implementation in draft PR #7 and native preparation in draft PR #8 remain intact and unaccepted. The latest bounded upstream comparison found no conforming six-image set: PostgreSQL, OpenSearch and Trivy retained refused digests; new Redis and SeaweedFS candidates were not audited.

The repository became public with protected main on 2026-09-08. The private-repository/API403 observations in PR #8's ADR-0005 are historical. This change does not establish branch-specific GHCR write denial. An attestation policy that rejects a non-main artifact at consumption is a different security objective from isolating registry writes. Neither that revised image architecture nor registry availability, deletion prevention or retention is approved here.

Approve only one fixed public text canary, at most two manual attestation-producing runs, each limited to ten minutes, then reviewed removal of the workflow. The coordinator recorded explicit consent at 2026-09-08 14:31:55 UTC for the irreversible public Sigstore metadata. It covers this harmless fixture and repository/workflow/provenance identifiers, not images, source/customer data, secrets or paid resources. Recheck the recorded consent and unchanged scope immediately before dispatch. Do not infer it from repository visibility or general account access.

The reviewed diagnostic plan has SHA256 `d5fa3a181d1e24485748a7fdfdc98edd664c783dd307bc905e9cd3fe57290caf`, with sequential independent Architect and Critic approvals. Its pre-review status fields were frozen with those bytes; the coordinator's final handoff and consent record carry the later authorization. These plan approvals do not substitute for implementation review.

## Small fixed producer

`.github/workflows/attestation-canary.yml` is manual-only, has no inputs and one GitHub-hosted `ubuntu-24.04` job. It admits only main and the dedicated negative branch, rejects a rerun attempt, and has no automatic follow-up. The two-run budget is also checked against actual GitHub runs by the operator before each dispatch; workflow conditions alone cannot enforce a lifetime counter.

The committed fixture is `docs/fixtures/attestation-canary.txt`, SHA256 `d8bacf5b23f03435e17bde784994c671270c6bc8b610aabe7883e304c8346663`. LF attributes keep its bytes and workflow bytes stable across Windows and Linux. The workflow checks the fixed checksum before issuance, records managed runner/gh identities and gh's actual flag interface, and executes no repository program, image or source adapter.

New actions are full-commit pins, resolved directly from their official repositories on 2026-09-08:

| Action | Commit | Purpose |
| --- | --- | --- |
| actions/checkout (v4) | `11d5960a326750d5838078e36cf38b85af677262` | Sparse read of only the fixture, workflow and LF attributes; persisted credentials disabled |
| actions/attest (reviewed v4) | `1e69f48acb82d1966a394da916b4c1698aa569d6` | Fixed `subject-path`; `push-to-registry:false`, `create-storage-record:false` |
| actions/upload-artifact (v4) | `ea165f8d65b6e75b540449e92b4886f43607fa02` | Real action `bundle-path`, fixed fixture and five public receipts, named by actual run ID/attempt |

Global permissions are empty; the sole job has only contents-read, id-token-write and attestations-write. No packages-write, artifact-metadata-write, environment, durable secret, registry, publisher repository or reusable workflow exists. The permission choice follows the [exact action definition](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml) and its guarded [registry implementation](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/src/attest.ts).

The workflow uses JSON syntax, which is valid YAML, so tests can inspect the actual mapping with the built-in JSON parser. No YAML dependency, custom parser or workflow framework is introduced. The existing accepted CI is unchanged.

## Official verifier and invocation erratum

The local official CLI is gh 2.98.0 (2026-08-20), executable SHA256 `a1701e3c806a805981554ace7df04812772c6449bdcfd1a77675013d97786401` on this Windows host. Record the actual binary version/hash again during verification. GitHub's managed runner image, utilities, official action code and CLI are explicit service/tool trust boundaries; this experiment does not reproduce them.

Before issuance, both principals reproduced that gh 2.98.0 rejects `--cert-identity` with `--signer-workflow` in one invocation. The official [CLI source](https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/attestation/verify/verify.go#L255) declares them mutually exclusive. The coordinator authorized the smallest invocation correction, retaining the reviewed plan's original hash:

1. Verify the exact unique bundle/file with the exact certificate identity.
2. Verify the same unchanged bundle/file with the exact signer workflow.

Both calls retain repo `CleMeY15/auto-world`, GitHub OIDC issuer, source ref, source SHA, signer SHA, denial of self-hosted runners, SLSA provenance/v1 and JSON output. Both must succeed and produce one identical official verified result. Multiple JSONL bundles, ambiguous result sets, different results or file/bundle substitution fail closed. The wrapper only checks this fixed shape and delegates signatures, certificates, transparency and policy verification to official gh; it implements no cryptography.

At merged main commit M, the expected SAN is `https://github.com/CleMeY15/auto-world/.github/workflows/attestation-canary.yml@refs/heads/main`, with source and signer digests M. Every negative requires the separately successful main control with two positive invocations, main ref and normal identity, and its alleged main-policy SHA must equal that verified M. Branch B differs only by a harmless metadata commit; workflow and fixture must be byte-identical to M. Its own-identity control binds B and `refs/heads/codex/task-0005-attestation-negative` before testing rejection under the main policy. Main and branch controls must name the same fixed file but distinct genuine bundles; the B bundle remains unchanged between its positive and rejection. Neither an invalid B bundle nor a rejection under some arbitrary commit C counts as a successful negative.

The three required security negatives are the valid branch bundle under main policy, changed fixture bytes against the genuine main bundle, and a wrong expected workflow against that same genuine main bundle. Missing/truncated bundles, unavailable CLI, timeouts and network errors remain operational/input errors. gh sometimes reports only its fixed Sigstore-failure phase rather than the inner digest/SAN cause. Therefore the classification also requires the exact unchanged bundle's successful positive control and the prescribed byte/policy perturbation; no arbitrary nonzero exit proves a mismatch. The branch's signer-workflow call additionally requires the explicit certificate source mismatch reported by gh.

Only certificate bindings and witnessed timestamps are authenticated in [official verifier output](https://cli.github.com/manual/gh_attestation_verify). The workflow-controlled predicate is not an authenticated event assertion. gh has no event flag: manual-only execution follows from the exact reviewed workflow and separately recorded GitHub run evidence, not a copied predicate. Failure to prove the required source/ref/signer bindings ends the experiment with FAIL.

## Gates, observability and retirement

Before merge: targeted workflow/verifier tests; forced root lint/typecheck/tests/build; secrets/dependency checks; fresh HTTPS clone; independent code/security APPROVE and architecture CLEAR at one exact SHA; final-head quality and verified main. Static tests and injected verifier results establish wrapper behavior only, never cryptographic success.

Before each of the two dispatches: read consent and budget, verify main/B SHAs and equal workflow/fixture bytes, inspect exact workflow/permissions and record the dispatch. Retain actual run IDs, head SHAs, public metadata, genuine bundles, hashes, official outputs and bounded failure categories. No third run is allowed, including an implicit rerun after issuance failure. A bounded local diagnosis can use the already captured evidence; a need for another run ends FAIL.

After real evidence: a short reviewed follow-up PR records `ATTESTATION_CANARY_PASS` or `ATTESTATION_CANARY_FAIL` and removes the workflow, with root/final-head/main gates again. Preserve the bundles and receipts; do not delete the GitHub attestation objects. The public Sigstore/Rekor records cannot be recalled even if GitHub's separate attestation objects are deleted. No automatic dispatch, native build, PR #8 restart or heartbeat resumption follows.

TASK-0005 and native preparation remain IN_PROGRESS/unaccepted; TASK-0005B and TASK-0006 remain blocked. There is no data migration or user-facing UI change. This result cannot establish image vulnerability compliance, registry write isolation, private-package access, supported-lifetime retention or local-data acceptance.
