# TASK-0005A — exact SeaweedFS attestation

Status: IMPLEMENTED_AWAITING_NATIVE_PROOF / SIGNING_NOT_ATTEMPTED / ADMISSION_NOT_AUTHORIZED.

## Reviewed evidence and scope

The exact subject is `ghcr.io/clemey15/auto-world-seaweedfs-s3@sha256:9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504`. The [local retention and restoration evidence](TASK-0005A-SEAWEED-LOCAL-RETENTION.md) was independently approved in [PR93](https://github.com/CleMeY15/auto-world/pull/93), merged as `eee5eeb909cd110db8cfd43701a5529abc48d664`. The reviewed head and merged commit share tree `d53b262884ed9315b5beeef3b498a954cd224f72`. Fresh Linux full checks passed 761 root tests with zero failures/skips; [head CI](https://github.com/CleMeY15/auto-world/actions/runs/36337746789) and [main CI](https://github.com/CleMeY15/auto-world/actions/runs/36338282766) passed.

This increment signs the already-reviewed technical evidence through official managed GitHub tooling under [ADR-0007](../decisions/ADR-0007-private-image-admission.md). It neither executes the image nor admits it for supported startup. The original failed publisher and two failed native runtime attempts remain unchanged.

## Implementation plan and privilege boundary

The input-free `seaweed-candidate-attest.yml` workflow accepts only its first dispatch/attempt on protected main, from the existing repository and GitHub-hosted Linux runners. Action commits, Node and the verification CLI are pinned. The retired fixed-file canary is not used.

The signer job has contents/actions read and OIDC/attestations write. It has no package permission, registry authentication or candidate execution. Before the official action, preparation verifies the checked-out protected main commit and committed evidence bytes, retrieves the fixed public audit from run `36325906357`, checks its API identity and all eight evidence files, and reuses the existing publication, audit, runtime and local retention/restore validators. Current vulnerability database age must remain within 48 hours. Java database age remains recorded with no maximum-age rejection. Preparation also requires at least the entire 20-minute signer job budget before that 48-hour limit, so the later action cannot outlive the validated freshness window. The predicate reports freshness at preparation; the workflow timeout and exported budget are checked together.

The closed predicate binds the exact remote digest, source/build/publication identities, audit reports and databases, successful native runtime, retained image configuration/DiffID/archive and local recovery receipts. Its support policy is one year from actual activation, followed by at least 365 retention days. Activation dates remain pending. Only approved public technical identities appear in the predicate; it includes no private host path, archive bytes or credential.

Official `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` signs this custom predicate with `push-to-registry: false` and `create-storage-record: false`. Only `predicate.json`, `pre-sign-receipt.json` and the official bundle are passed to the separate verifier. The public artifact expires after 14 days; the original bundle must also join the existing private retention inventory before admission.

The verifier job has contents/actions/packages read and no signing authority. Official `gh attestation verify` resolves an OCI subject through the registry even with a supplied bundle, so this job uses an isolated Docker-format credential file for manifest retrieval. It runs no Docker command and downloads no image layer. The credential directory/file have modes 0700/0600 and a final always-run step removes only that owned configuration.

The official CLI archive is `gh_2.98.0_linux_amd64.tar.gz`, 14,863,663 bytes, SHA-256 `3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de`. The workflow verifies its size/hash before extraction; the receipt records the actual executable identity. Local execution of the verified release confirms version 2.98.0 (2026-08-20), executable size 41,377,954 bytes and SHA-256 `62885b97de6a0cd85e616cdd94bcda908bf5cf1018094385892b05cea3537163`.

## Verification and acceptance

Both certificate identity and workflow policies must pass separately on the same unchanged bundle, with exact repository, main ref, source SHA, signer SHA, GitHub OIDC issuer, custom predicate type and hosted runner. The signer/source SHA identifies this attestation workflow revision; the older image-build revision is separately bound in the predicate. Exactly one verified statement and one expected subject are accepted. Both official results must agree except for the echoed identity policy.

Actual controls use the same genuine bundle with a different fixed subject, workflow, ref, source SHA and signer SHA. An authentic positive control is required before and after these tests. A separate copy with a changed signed payload must be rejected cryptographically while the original bundle remains unchanged. Missing/truncated/malformed bundles, ambiguous CLI output, authentication/network failures and timeouts remain ERROR; they cannot establish a successful policy rejection. Only bounded technical statuses, hashes and identities are retained publicly.

Before dispatch: targeted regression tests, full lint/types/tests/build/secrets/dependency audit, fresh Linux checkout, independent code and architecture review, exact-head CI, identical reviewed merge and main CI. After dispatch: preserve the real bundle and all outcomes, including failures; do not rerun an exhausted producer merely to repair verification. Signing success alone must never set admission.

## Operations and rollback

The single-run guard prevents routine repeated publication; the producer will be explicitly retired after the native outcome is retained. Failure before signing creates no attestation. Failure after signing leaves an unadmitted signed object whose original evidence must be kept. Rollback disables the new workflow and preserves existing image/source/evidence archives, packages and data volumes.

The next separate admission inventory must establish authentic policy/currentness/revocation, concrete activation/support dates and complete private evidence availability before any supported service execution. TASK-0005A/TASK-0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Primary references

- [Official pinned attestation action and outputs](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml).
- [Official action registry boundary](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/src/attest.ts).
- [Official verification policy flags](https://cli.github.com/manual/gh_attestation_verify).
- [Pinned CLI OCI resolution](https://github.com/cli/cli/blob/v2.98.0/pkg/cmd/attestation/verify/verify.go).
- [Official CLI release identities](https://api.github.com/repos/cli/cli/releases/tags/v2.98.0).
