# TASK-0005A — PostgreSQL exact-subject attestation

Status: IMPLEMENTATION_IN_REVIEW. No PostgreSQL attestation has been created or accepted by this increment yet. The subject remains NOT_ADMITTED; support and archive dates remain null.

## Accepted prerequisite

[PR129](https://github.com/CleMeY15/auto-world/pull/129) delivered the complete technical P1 closure. Final six-file head `de0972a5f0c09153dc8eae0ab74e6ed4ff7c5524` passed [CI36848835648](https://github.com/CleMeY15/auto-world/actions/runs/36848835648); merged main `2dcad7fe92431af1ece96f6f200655226713d77f` has the identical independently approved tree `5f8d2f2318f0b9a2cd04529eafc23c3ce173e604` and passed [CI36849170358](https://github.com/CleMeY15/auto-world/actions/runs/36849170358). The actual retrieval recipe remains `4a28d5e3cef525a8cf54ba5a1336d7af8573df1d`, separately from delivery and future signing revisions. Its 496-reference root ACK, receipt, inventory, all 22 group digests and public projection received independent APPROVE.

The [acceptance loader](../../scripts/postgres-image/core-evidence-acceptance.mjs) authenticates the complete public P1 files against the reviewed byte sizes/SHA256 values before parsing. A candidate-controlled `CORE_COMPLETE` field cannot grant this authority. Private raw ACKs, policies, receipts, native identities and source/archive bodies are never downloaded to this public workflow. Existing accepted runtime, cold-load, SQL and retention subproofs are bound through the P1 group digests; they are not replayed during signing.

## One bounded workflow, three capabilities

The [workflow](../../.github/workflows/postgres-candidate-attest.yml) has no inputs and accepts only workflow_dispatch, this repository, protected main, GitHub-hosted Ubuntu24.04, run number1 and attempt1. Every checkout uses a fixed action revision with persist-credentials:false. Node22.23.2 and all actions are fixed. There is no automatic trigger or reuse of the retired SeaweedFS/canary producers.

| Job | Permissions | Result and exclusion |
| --- | --- | --- |
| access | contents:read, packages:read | Authenticate current main and committed policy; read the exact private manifest, require an isolated anonymous authorization denial, read it again authenticated and require identical full bytes. No image pull/save/start, registry write or signing. |
| signer | contents:read, actions:read, id-token:write, attestations:write | Authenticate access/audit artifacts, validate P1/P2/P3 and build the closed predicate before the official action. No package permission, Docker image access or candidate code execution. |
| verifier | contents:read, actions:read, packages:read | Authenticate only this run's signed artifact; apply both official policies and actual positive/negative controls to the same immutable bundle. No signing, registry write or candidate execution. |

The fixed subject is `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`. Its config and twelve ordered layer descriptors come from the committed [remote policy](../../infra/postgres-image/candidate-remote.json). No tag, arbitrary digest, artifact name or branch/run parameter is a trusted expectation.

## P3 observation and current remote proof

The versioned [package controls](../../infra/postgres-image/package-controls.json) preserve the authenticated Settings reload observed at approximately10:06UTC on 2026-10-01, explicitly with MINUTE precision: Private, source repository CleMeY15/auto-world, inheritance checked, one Actions grant for that repository with Admin role, no Codespaces repositories and zero explicit members. No setting or credential was changed.

That UI observation is distinct from the current manifest-access receipt. GITHUB_TOKEN does not claim to revalidate every Settings field. The dynamic proof must establish authenticated-before, actual anonymous AUTHORIZATION_DENIED, authenticated-after and exact unchanged manifest/config/layers. Network/authentication errors or unrelated diagnostics cannot count as anonymous denial. The waived external authenticated fork test stays SKIPPED_BY_USER and fork isolation NOT_VERIFIED. There is no invented configuration TTL, extra account or publisher requirement.

The access job uses owned private temporary credential directories; cleanup checks their native identities and exact allowed contents before removal. Foreign replacement, links or uncertain cleanup fail and preserve the object. Only the closed non-sensitive access receipt is uploaded.

### Complete package-read workflow inventory

The reviewed tree contains these eleven package-read jobs. All have an input-free workflow_dispatch trigger, this-repository/main guard and checkout with persist-credentials:false. None has package-write, OIDC or attestation capability; the separate signer has no package-read capability. No package-read job accepts PR/fork-controlled checkout, reusable-workflow inputs or fork artifacts. This is a reviewed workflow boundary, not the waived server-side fork-isolation proof. Existing exhausted or retired workflows are never redispatched by this increment.

| Workflow under `.github/workflows/` | Job | Run/attempt guard | Artifact authority | Candidate behavior |
| --- | --- | --- | --- | --- |
| `postgres-candidate-attest.yml` | access | 1/1 | None | Two authenticated manifest reads around anonymous denial; no pull/save/start. |
| `postgres-candidate-attest.yml` | verifier | 1/1 | Same-run signer artifact ID, API digest and head SHA | Official OCI subject resolution only; no layers/start. |
| `postgres-candidate-remote-audit.yml` | audit | 1/1 | Same-run/main scanner-build artifacts, needs:build | Pull/save/scan archive; candidate never started. Diagnostic scanner carriers only. |
| `postgres-candidate-remote-read-v2.yml` | read | 1/1 | None | Exact pull/save/archive validation, no start; exhausted/disabled. |
| `postgres-candidate-remote-read.yml` | read | 1/1 | None | Same read-only materialization; original failed V1 preserved, exhausted/disabled. |
| `postgres-candidate-remote-runtime-diagnostic-v2.yml` | runtime | 1/1 | Fixed audit ID11079393568/run36673766454/main5186a2… | Isolated audited diagnostic candidate execution and cleanup; exhausted/disabled. |
| `postgres-package-bootstrap.yml` | verify | 2/1 | None | Fixed harmless bootstrap pulled into a stopped container; no candidate; exhausted. |
| `private-package-proof.yml` | verify | Repo/main only | None | Fixed harmless bootstrap/canary and stopped container; no candidate; retired. |
| `seaweed-candidate-remote-audit.yml` | audit | 1/1 | Same-run/main scanner-build artifacts, needs:build | Pull/save/scan archive; candidate never started; exhausted. |
| `seaweed-candidate-remote-runtime.yml` | runtime | 3/1 | Fixed audit run36325906357 | Isolated audited diagnostic candidate execution and cleanup; exhausted. |
| `seaweed-package-bootstrap.yml` | verify | 2/1 | None | Fixed harmless bootstrap in a stopped container; no candidate; exhausted. |

The [workflow contract tests](../../tests/postgres-image-candidate-attestation-workflow.test.mjs) enumerate every workflow granting package read and compare its exact path/job, trigger, checkout and main/run guards to this inventory. Quality CI and the generic package-bootstrap workflow's PR trigger have no package-read permission. Only the two historical runtime jobs above can execute candidate images, within their existing isolated diagnostic contracts.

## Authenticated artifact intake and P2 currentness

[Intake](../../scripts/postgres-image/attestation-artifact-input.mjs) checks the exact GitHub artifact ID, name, current run and head SHA, non-expiration, size and API digest. It downloads the ZIP through the existing bounded stream, checks complete size/SHA/EOF, validates its closed flat ZIP profile, writes only allowlisted private files and authenticates each readback with native path/FD seals. All handles close before return. The fixed historical audit additionally requires the successful reviewed audit run and exact API artifact identity from [candidate-runtime.json](../../infra/postgres-image/candidate-runtime.json).

The original audit ZIP has sixteen method0 entries with mode0100600. This was verified from its retained central directory and exact1,729,322-byte SHA256 `4af33dc1223aa8264379ec201ded916cdcc39a2288859e505ecca878498c1b42`; it is not inferred from generic upload settings. New access/signed artifacts use compression level6 and their exact method8/private-mode profiles. Existing Seaweed profiles remain unchanged. No private image, layer, database, source archive or credential enters a public artifact.

The signer reuses the existing full audit/report/SBOM/scanner-control validators and freshness contract. The current audit is run36673766454, with zero findings/blockers and complete inventory. Its effective deadline is `2026-10-02T01:15:45.849Z`, determined by the vulnerability database. The signer reserves its complete20-minute job budget; preparation at or after `2026-10-02T00:55:45.849Z` fails closed. This is execution currentness, not a new age rule caused by a documentation commit. Only actual expiration or insufficient execution budget requires a new reviewed audit. The exhausted old audit producer is never rerun.

Java metadata remains validated for format, ordering and non-future dates; its maximum age is null under the user's waiver. The report and vulnerability database still have their unchanged48-hour gates. A historical audit cannot establish current eligibility after its validity ends.

## Signature, verification and honest claims

[Preparation](../../scripts/postgres-image/candidate-attestation.mjs) emits a closed predicate and pre-sign receipt. It binds the exact subject, publication/build identity, accepted P1 byte identities/group digests, current audit, current access receipt/API artifact, Settings observation, signing workflow revision and support policy. The build revision `b93b0c76ec76abe283d66a17fa62eab7e580e679` / run36361670116, P1 retrieval recipe4a28d5e and signing workflow main SHA remain separate identities.

The official action is `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`, predicate type `https://github.com/CleMeY15/auto-world/attestations/postgres-private-image-evidence/v1`, push-to-registry:false and create-storage-record:false. It creates public technical attestation metadata, without granting image admission or registry-write capability.

[Verification](../../scripts/postgres-image/verify-candidate-attestation.mjs) uses the exact official gh2.98.0 binary:41,377,954bytes/SHA256 `62885b97de6a0cd85e616cdd94bcda908bf5cf1018094385892b05cea3537163`. Certificate identity and signer-workflow policies are mutually exclusive CLI flags, so they run separately on the same preserved bundle. Certificate source-digest and signer-digest both bind the signing workflow SHA; the older image build revision remains in the predicate. The whole verified statement/predicate and exact run invocation URI are checked.

Actual controls require a valid positive before and after the negatives, wrong subject/workflow/ref/source/signer expectations, a modified signed payload, and missing/truncated/malformed input or output. The wrong-subject control uses the known existing PostgreSQL bootstrap manifest, so it exercises official attestation-policy rejection against a resolvable object instead of treating a registry 404 as a negative proof. VERIFIED, REJECTED and ERROR remain distinct; operational failures cannot prove a policy rejection. No additional branch attestation or canary execution is introduced.

Technical P1 does not establish blanket legal compliance or full upstream binary reproduction. Official attestation is ATTESTED_UNADMITTED until P5–P7 pass. The second COMPLETE private copy including its signed bundle remains required before activation. Support starts only at actual reviewed activation, lasts one calendar year, requires continuous security controls, and retains all archives for at least365 further days without automatic deletion.

## Review, validation and rollback

Before the first actual dispatch, require fresh targeted/native and full quality gates, exact-head CI, an Architect review followed by a distinct Critic review of the concrete workflow/credentials/privacy/retention plan, an identical reviewed merge tree and passing main CI. Tests cover artifact/source/currentness substitution, context guards, closed schemas, cleanup failure, inherited serialization hooks and actual verifier outcome distinctions. Native signature/verification results are still pending at this checkpoint.

Retire the one-shot workflow after its result and preserve the reviewed recipe and all failed/public technical proofs. Rollback disables the producer and refuses admission; it never deletes registry objects, evidence, volumes or backups and never falls back to an unverified tag/digest. TASK-0005A/0005 remain IN_PROGRESS and TASK-0006 blocked.

Official references: [attestation action](https://github.com/actions/attest), [gh verification policies](https://cli.github.com/manual/gh_attestation_verify), [pinned upload action](https://github.com/actions/upload-artifact/tree/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a).
