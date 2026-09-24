# TASK-0005 — public attestation canary evidence

Diagnostic result: **ATTESTATION_CANARY_PASS**, 2026-09-14. The workflow was disabled after exactly two successful manual runs and is retired in this change. Delivery gates for the removal and bounded verifier correction are recorded in the associated PR. This result does not accept TASK-0005 or the native image architecture.

Contract: [ADR-0006](../decisions/ADR-0006-public-attestation-canary.md). Specific user consent was recorded on 2026-09-08 at 14:31:55 UTC and reread before each dispatch on 2026-09-14. No image, private payload, new secret, subscription or registry write was involved.

## Reviewed producer and actual runs

PR #9 was independently approved by code/security and architecture reviewers at `522ffb3276bb9a345a48eae5591fe037a1786479`. Protected merge M `66af1435f4b8e92b302e7aa4e1edba84daa6a85e` had the identical tree; [main CI](https://github.com/CleMeY15/auto-world/actions/runs/34243989844) passed. B `6042a5d705a5f48e50af957dded6ccc6df9ccaac` differs only by a harmless branch-identification text file. Workflow and fixture bytes are identical.

| Run | Identity | Result | Artifact ID |
| --- | --- | --- | --- |
| [34804951573](https://github.com/CleMeY15/auto-world/actions/runs/34804951573) | main, M, attempt1 | SUCCESS | 10332139163 |
| [34805000357](https://github.com/CleMeY15/auto-world/actions/runs/34805000357) | codex/task-0005-attestation-negative, B, attempt1 | SUCCESS | 10332761934 |

The [run inventory](attestation-canary/run-list.json) contains exactly two dispatches. Raw API responses, job logs, genuine unmodified action bundles, downloaded fixtures and runner receipts are retained in each run directory. Git attributes disable text conversion for evidence. The exact [producer archive](attestation-canary/workflow.json) is inert outside `.github/workflows/`. Workflow ID353251429 was [disabled manually](attestation-canary/workflow-disabled.json) after capture and is removed in this change. No rerun or third dispatch occurred.

| Input | SHA256 |
| --- | --- |
| Fixed fixture | `d8bacf5b23f03435e17bde784994c671270c6bc8b610aabe7883e304c8346663` |
| Reviewed M/B workflow | `013bf0a12942d74efa631e715a4b8d19c05f422814a184b7e831babd9331b9bd` |
| [Main bundle](attestation-canary/runs/34804951573/_temp/5ZtQEN/attestation.json) | `dc8f60bd10c5831104916fa4fc784863a0a3f7af9fcfeea3a5f0db56ecbf0d58` |
| [Branch bundle](attestation-canary/runs/34805000357/_temp/1ohHrJ/attestation.json) | `04f97a99a0973b750e0f0b41d16b2bb054d4101cf21ddf5c30278e1578e010d9` |

GitHub archive digests are separately retained in each `github-artifacts.json`; they are not bundle digests. Artifact retention is 14 days, while this repository preserves the public evidence. Sigstore records are irreversible.

## Actual official verification

[verification.json](attestation-canary/verification.json), SHA256 `71e51e08d2d1e6aaa272135dc5f76591c73c4e257652d44a1e4da1c2b911be1a`, records actual argv, stdout, stderr, numeric exits, classifications and real positive controls. Local official gh2.98.0 has executable SHA256 `a1701e3c806a805981554ace7df04812772c6449bdcfd1a77675013d97786401`. Both managed runners used image `ubuntu24/20260907.300.1` and gh2.100.0, executable SHA256 `553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee`. Producer utilities are distinct from the local verifier.

Each pair invokes official gh on one unchanged unique bundle/file twice: exact certificate identity, then signer workflow. Both retain exact repo, GitHub OIDC issuer, source ref/SHA, signer SHA, GitHub-hosted runner requirement and SLSA provenance/v1. Official gh performs cryptographic verification.

| Actual check | Official exits | Result |
| --- | --- | --- |
| Main bundle, exact M/main identity | 0 / 0 | VERIFIED |
| Branch bundle, exact B/branch identity | 0 / 0 | VERIFIED |
| Genuine valid B bundle under exact M/main policy | 1 / 1 | REJECTED; branch negative proved |
| Changed public file against genuine M bundle | 1 / 1 | REJECTED; tamper negative proved |
| Wrong workflow against genuine M bundle | 1 / 1 | REJECTED; wrong-workflow negative proved |
| Missing bundle | No CLI call | Input ERROR, not a security negative |
| Truncated genuine bundle | No CLI call | Input ERROR, not a security negative |

Every negative uses the actual successful main control. The branch proof additionally uses its successful own-identity control and explicit `expected BuildSignerDigest to be M, got B` rejection. Main and B bundles differ; each stayed unchanged across its checks. Tampering used a separate public file.

## One bounded correction from real outputs

The initial wrapper conservatively returned FAIL despite four official positive exits0. [initial-verification.json](attestation-canary/initial-verification.json), SHA256 `2a445cfe2b8f6215d4c63d1355e4cb0a409a5b8c15eed7d2fbf8547915eb9791`, preserves that result. One local correction used the same two bundles, without additional issuance:

- `verifiedIdentity` echoes the selected policy: exact SAN versus workflow regexp. Only that echo is excluded from deep equality; the attestation, certificate, statement and every other verification field must remain equal.
- Non-TTY gh2.98.0 omits progress banners. Only the exact final diagnostics are accepted, with operational/CLI errors still ERROR and real positive controls plus prescribed perturbations still mandatory for a negative proof.
- Numeric `exitCode` is preserved independently of the textual classification `code`.

The recorded-output regression failed before correction and passed afterwards. Seven targeted tests cover retirement/archive bytes, CLI constraints, real-output replay, altered signed content, operational errors, unique unchanged inputs and exact-M binding. Replay tests do not prove signatures; the real process evidence above does.

## Reproduction and retirement gates

From the repository root with official gh installed, import `verifyPair`, `negativeProved`, `mainRef`, `branchRef` from `scripts/verify-attestation-canary.mjs`. Use `docs/fixtures/attestation-canary.txt` and the retained main/B bundles linked above. First obtain actual controls with `verifyPair({file,bundle:mainBundle,sha:M,ref:mainRef})` and the equivalent B/branch call. Then verify B's bundle under M/main, retained `tampered-public.txt` against M/mainBundle, and `wrongIdentity:true` with the unchanged main inputs. Pass the real main control as the fourth argument of every `negativeProved` call. Verification creates no attestation. Historical absolute paths in raw argv identify the original workstation; substitute retained equivalent paths.

The author forced root check passed:17/17 root tests,0skips; Turbo lint9/typecheck11/test18/build9, all uncached; Secretlint159 files and dependency audit passed. Log SHA256: `fb8ce287f3303fc4bc79a69c9f318add56f24b67518898b7977a00c446ee653d`. Final clone/CI and independent-review gates must be recorded in the associated PR before normal protected merge. Root tests assert producer absence and exact archived bytes. Rollback means repairing the diagnostic reader if needed; do not restore/enable the producer or redispatch without a separate scope decision.

Only certificate bindings and witnessed timestamps are authenticated. Manual event origin is supported separately by GitHub run API evidence and the reviewed workflow, not by a workflow-controlled predicate claim. Managed actions/runner and official gh remain trust boundaries. This diagnostic proves no registry write isolation, image vulnerability compliance, native/data acceptance or long-term registry retention. TASK-0005/5A stay IN_PROGRESS, TASK-0005B/6 blocked, PR #7/#8/#10 draft and untouched, full-roadmap heartbeat PAUSED.
