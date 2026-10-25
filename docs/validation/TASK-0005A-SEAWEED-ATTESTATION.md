# TASK-0005A — exact SeaweedFS attestation

Status: ATTESTED_UNADMITTED. Native signing, official verification and rejection controls passed. The producer is disabled and removed; supported admission remains NOT_AUTHORIZED.

## Native result, 27 September 2026

[PR94](https://github.com/CleMeY15/auto-world/pull/94) merged reviewed head `3cf5cb07b22fbc81acbbac25ad746180eba84361` as `83d93ca2801ab2385c680e98acd12ed21f5110b9`, with identical tree `b41f86c2686ea20eaf94c44f2bd76ee51c487ceb`. Independent code/security review approved with zero findings and the architecture review was CLEAR. A fresh Linux HTTPS clone passed uncached full checks with 779 root tests, zero failures/skips, all package checks and dependency/secret audits. [Exact-head CI](https://github.com/CleMeY15/auto-world/actions/runs/36339446825) and [merged-main CI](https://github.com/CleMeY15/auto-world/actions/runs/36339598262) passed before dispatch.

[Native run 36339762446](https://github.com/CleMeY15/auto-world/actions/runs/36339762446), number 1 attempt 1, succeeded on that exact main commit. Both the signer and the separate read-only verifier passed. The original [predicate](../../infra/seaweed-image/attestation/predicate.json), [pre-sign receipt](../../infra/seaweed-image/attestation/pre-sign-receipt.json), [official bundle](../../infra/seaweed-image/attestation/bundle.json) and [verification receipt](../../infra/seaweed-image/attestation/verification-receipt.json) are retained byte for byte. These are approved public technical evidence; no image layer, source archive or credential is added to Git.

| Original evidence | Bytes | SHA-256 |
| --- | ---: | --- |
| Signer artifact `10938860683` | 21,803 | `af9731420f8f58ecf5985dc313fcdcb0a49009cd87952664893f9cbbb707d751` |
| Predicate | 5,102 | `b57a5fab7e9ad40aa3209660d6eaf0d6c0ebf5004c2d2e181e56ebb075f35c5b` |
| Pre-sign receipt | 925 | `4030f476c6030f26deba15d36cdb7b159d6fccc63ba42253b1975a8a21dd59ed` |
| Official bundle | 15,386 | `5017d2a24feb59dc714fc6652e9985098b47c3d2ba0bb779db7d2b3db9641f1b` |
| Verification artifact `10938900551` | 37,679 | `bfc3dd12bd4e05d69451deddd191f22bbe720139e34d38ae2319c8301c6c4c19` |
| Verification receipt | 37,515 | `a2fb40814f344d920410408356b38eb44b8ba0175543c0a763f9b71bc9dfeb12` |

Both genuine positive pairs were VERIFIED. Wrong subject, workflow, ref, source digest and signer digest were REJECTED with the same original bundle. A separate changed signed payload was also REJECTED; missing, truncated and malformed bundles were ERROR, never counted as policy rejection. The final positive ran after every negative. Registry authentication cleanup passed, and no candidate image was executed.

Both original artifact ZIPs match their GitHub API digest/size, and every extracted file matches its retained bytes. The files were copied into the existing protected Windows private archive and reimported into the existing private ext4 recovery root, with readback SHA-256 comparisons for all nine new evidence/tool/recipe files. The two locations are on this workstation; they do not protect against its loss. The private version-3 inventory covers 35 files totalling 289,842,284 bytes; it is 9,334 bytes with SHA-256 `3b974bccae5da2505f46d1bcf181255e1d5cb3198d0db0a91bb33051949455fc`. Earlier inventories and failures remain unchanged. Source ZIPs remain separately referenced. No automatic deletion is enabled.

The full-history signer recipe bundle is 5,539,726 bytes, SHA-256 `7de2ef193736be3f41ac1c95efbb5fcb8e8213320103e37f837be47a308b491a`; `git bundle verify` passes. The official CLI release archive is also retained privately. The public artifacts expire on 11 October 2026; neither image nor attestation retention depends on that expiration.

GitHub reports workflow `368488673` as `disabled_manually`. Its [exact original recipe](seaweed-attestation/workflow.json), [bounded run record](seaweed-attestation/run.json) and [disable record](seaweed-attestation/workflow-disabled.json) remain inspectable; the active workflow file is removed in this change. Its run budget is exhausted. Do not rerun the producer or the retired canary. The verifier library remains available for the later admission consumer.

The next step is a fresh manual audit of the other service/helper images before selecting the complete admission inventory. Historical scanner results are not current eligibility. Admission, concrete activation/support dates and four-service acceptance remain open; TASK-0005A/TASK-0005 stay IN_PROGRESS and TASK-0006 stays blocked.

## Reviewed evidence and scope

The exact subject is `ghcr.io/clemey15/auto-world-seaweedfs-s3@sha256:9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504`. The [local retention and restoration evidence](TASK-0005A-SEAWEED-LOCAL-RETENTION.md) was independently approved in [PR93](https://github.com/CleMeY15/auto-world/pull/93), merged as `eee5eeb909cd110db8cfd43701a5529abc48d664`. The reviewed head and merged commit share tree `d53b262884ed9315b5beeef3b498a954cd224f72`. Fresh Linux full checks passed 761 root tests with zero failures/skips; [head CI](https://github.com/CleMeY15/auto-world/actions/runs/36337746789) and [main CI](https://github.com/CleMeY15/auto-world/actions/runs/36338282766) passed.

PR94 signed the already-reviewed technical evidence through official managed GitHub tooling under [ADR-0007](../decisions/ADR-0007-private-image-admission.md). This follow-up retains the native outcome and retires its producer. Neither change executes the image or admits it for supported startup. The original failed publisher and two failed native runtime attempts remain unchanged.

## Retained implementation and privilege boundary

The archived input-free `seaweed-candidate-attest.yml` recipe accepted only its first dispatch/attempt on protected main, from the existing repository and GitHub-hosted Linux runners. Action commits, Node and the verification CLI are pinned. The retired fixed-file canary was not used. The following describes that retained recipe, not an active producer.

The signer job has contents/actions read and OIDC/attestations write. It has no package permission, registry authentication or candidate execution. Before the official action, preparation verifies the checked-out protected main commit and committed evidence bytes, retrieves the fixed public audit from run `36325906357`, checks its API identity and all eight evidence files, and reuses the existing publication, audit, runtime and local retention/restore validators. Current vulnerability database age must remain within 48 hours. Java database age remains recorded with no maximum-age rejection. Preparation also requires at least the entire 20-minute signer job budget before that 48-hour limit, so the later action cannot outlive the validated freshness window. The predicate reports freshness at preparation; the workflow timeout and exported budget are checked together.

The closed predicate binds the exact remote digest, source/build/publication identities, audit reports and databases, successful native runtime, retained image configuration/DiffID/archive and local recovery receipts. Its support policy is one year from actual activation, followed by at least 365 retention days. Activation dates remain pending. Only approved public technical identities appear in the predicate; it includes no private host path, archive bytes or credential.

Official `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` signs this custom predicate with `push-to-registry: false` and `create-storage-record: false`. Only `predicate.json`, `pre-sign-receipt.json` and the official bundle are passed to the separate verifier. The public artifact expires after 14 days; the original bundle now also belongs to the existing private retention inventory.

The verifier job has contents/actions/packages read and no signing authority. Official `gh attestation verify` resolves an OCI subject through the registry even with a supplied bundle, so this job uses an isolated Docker-format credential file for manifest retrieval. It runs no Docker command and downloads no image layer. The credential directory/file have modes 0700/0600 and a final always-run step removes only that owned configuration.

The official CLI archive is `gh_2.98.0_linux_amd64.tar.gz`, 14,863,663 bytes, SHA-256 `3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de`. The workflow verifies its size/hash before extraction; the receipt records the actual executable identity. Local execution of the verified release confirms version 2.98.0 (2026-08-20), executable size 41,377,954 bytes and SHA-256 `62885b97de6a0cd85e616cdd94bcda908bf5cf1018094385892b05cea3537163`.

## Verification and acceptance

Both certificate identity and workflow policies must pass separately on the same unchanged bundle, with exact repository, main ref, source SHA, signer SHA, GitHub OIDC issuer, custom predicate type and hosted runner. The signer/source SHA identifies this attestation workflow revision; the older image-build revision is separately bound in the predicate. Exactly one verified statement and one expected subject are accepted. Both official results must agree except for the echoed identity policy.

Actual controls use the same genuine bundle with a different fixed subject, workflow, ref, source SHA and signer SHA. An authentic positive control is required before and after these tests. A separate copy with a changed signed payload must be rejected cryptographically while the original bundle remains unchanged. Missing/truncated/malformed bundles, ambiguous CLI output, authentication/network failures and timeouts remain ERROR; they cannot establish a successful policy rejection. Only bounded technical statuses, hashes and identities are retained publicly.

Before dispatch: targeted regression tests, full lint/types/tests/build/secrets/dependency audit, fresh Linux checkout, independent code and architecture review, exact-head CI, identical reviewed merge and main CI. After dispatch: preserve the real bundle and all outcomes, including failures; do not rerun an exhausted producer merely to repair verification. Signing success alone must never set admission.

## Operations and rollback

The single-run guard prevented routine repeated publication; the producer is now explicitly retired after retention of the native outcome. Failure before signing would create no attestation. Failure after signing would leave an unadmitted signed object whose original evidence must be kept. Rolling back this proof change must leave the producer disabled and preserve existing image/source/evidence archives, packages and data volumes; restoring a workflow file does not authorize another run.

The next separate admission inventory must establish authentic policy/currentness/revocation, concrete activation/support dates and complete private evidence availability before any supported service execution. TASK-0005A/TASK-0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Primary references

- [Official pinned attestation action and outputs](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml).
- [Official action registry boundary](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/src/attest.ts).
- [Official verification policy flags](https://cli.github.com/manual/gh_attestation_verify).
- [Pinned CLI OCI resolution](https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/attestation/verify/verify.go).
- [Official CLI release identities](https://api.github.com/repos/cli/cli/releases/tags/v2.98.0).
