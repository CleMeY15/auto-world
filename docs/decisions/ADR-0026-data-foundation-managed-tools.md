# ADR-0026 — Finish the data foundation with maintained tools

Status: Accepted for the bounded scanner qualification and diagnostic image audits after sequential independent Dependency, Architecture and distinct Critic CLEAR reviews. Implementation review and actual Linux results remain required; no admission is granted.
Date: 2026-10-25
Scope: TASK-0005 development/CI, not production or real-source activation.

The reviewed decision candidate was 9,588 bytes, SHA256 `5db011001cf5b6333257d14b479cfc5f77a613e867c0e523059c9145afcd5e26`. The three reviews completed in that order on 25 October 2026. This status note records their acceptance; it adds no capability or changed control.

## Problem and outcome

TASK-0005 needs PostgreSQL, OpenSearch, Redis and S3-compatible storage working together. The existing Compose implementation already exercised seventeen real Linux lifecycle phases. Old image audits and expired diagnostic artifacts do not establish current acceptance. Continuing the Windows Python/GnuPG/Node bootstrap does not deliver this outcome.

The user's renewed direction is to finish TASK-0005 using existing maintained tools, preserving essential controls. Stop expanding that bootstrap. Preserve its failed operations and evidence; finish only the bounded resource-closure regression already underway. No acquisition, extraction, Python execution or bootstrap promotion follows.

## Decision

1. Reuse `codex/task-0005-four-service-acceptance` and its Compose, SQL migrations, protocol probes, operation ownership, backup/restore and seventeen integration phases. Integrate accepted main without replaying old Native/B1b operations or replacing historical evidence.
2. Qualify tools and images on disposable Ubuntu 24.04 GitHub-hosted runners. Use existing Docker/Compose/Buildx, official `gh attestation verify` and pinned GitHub actions. Record actual versions. Do not add a Windows qualification prerequisite, global installation, paid service, account or credential expansion.
3. Prefer current official upstream images. Resolve immutable manifests and Linux/amd64 subjects before scanning. Audit every executed service/helper: PostgreSQL, OpenSearch, Redis, SeaweedFS and AWS CLI. A source release or recent tag is not evidence that its image passes.
4. Replace future duplicate builds of the patched Trivy scanner with the official Trivy 0.76.1 Linux64 release only after the qualification below passes. Preserve the old scanner lock, patches, reports and workflow as historical evidence. No retrospective approval follows.
5. Reuse Docker Buildx/BuildKit only when an actual upstream audit demonstrates a specific blocker requiring a derivative. Reuse official attestation tools; do not implement signature, registry or archive formats. Existing accepted subproofs may be reused only for unchanged subjects and still-valid scope.

The managed runner/action trust boundary is explicit. `actions/setup-node` with an exact version is managed provisioning, not independent OpenPGP verification or a reproduced build. This replaces the Windows provider-qualification prerequisite for Linux development/CI tooling. It does not authorize execution of any rejected Windows provider or rewrite its failed evidence. Use already pinned official action commits; an action upgrade is not needed for this decision.

## Scanner qualification and unchanged gates

The selected release is [Trivy 0.76.1](https://github.com/aquasecurity/trivy/releases/tag/v0.76.1), source `e713f67f7d54decdcd9b3132c9751833dcced698`. The announced Linux64 archive is 52,676,794 bytes, SHA256 `c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`. These are expected identities, not measured results. Its exact [go.mod](https://github.com/aquasecurity/trivy/blob/e713f67f7d54decdcd9b3132c9751833dcced698/go.mod) includes x/net 0.60.0 and grpc 1.84.0; the release declares Go 1.27.3 binaries. Verify the actual binary materials before relying on these declarations.

Before execution: verify received archive length/hash and official GitHub attestation for the exact subject, repository `aquasecurity/trivy`, release tag and expected release workflow/source. Preserve the original verification output and bundle. Negative controls must reject changed bytes and wrong subject/source/workflow. Use the official CLI, not locally implemented cryptography. Extract the verified official archive with the runner's standard archive tool into a new disposable directory.

Measured profile, 2026-10-25: diagnostic run40194959739 passed those provenance policies and all four refusal controls, then correctly stopped on the previously assumed clean-build metadata. The official archive's extracted binary has SHA256 `d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83`; its original Go inventory reports main `v0.76.1+dirty`, `vcs.modified=true`, the exact expected source revision, Go1.27.3, CGO0 and Linux/amd64. Recognize only this measured tuple tied to this archive/binary identity; preserve the raw suffix and modified state, and reject other versions/revisions/states. The [exact upstream workflow](https://github.com/aquasecurity/trivy/blob/e713f67f7d54decdcd9b3132c9751833dcced698/.github/workflows/reusable-release.yaml#L100-L115) places build temporaries inside an unignored checkout directory, which provides a strong explanation for the marker, not an exhaustive account of the producer's filesystem. The [Go analyzer](https://github.com/aquasecurity/trivy/blob/e713f67f7d54decdcd9b3132c9751833dcced698/pkg/dependency/parser/golang/binary/parse.go) preserves this main version in its package inventory. Source-to-binary equivalence and reproducibility remain NOT_ESTABLISHED. No generic dirty-build allowance, version normalization or reduced self-audit follows. Independent review of the exact code adaptation still precedes its next diagnostic run.

Before accepting any image report: confirm binary version/hash and embedded build/dependency inventory; self-audit the scanner; run existing known-vulnerable and clean fixtures; preserve all assertions. Compare detection and package coverage with the existing baseline using identical captured databases. Unexpected detection loss, missing inventory or inability to establish qualification blocks use as an acceptance scanner. Reuse existing evaluator functions and fixtures; make only the version/input adaptation needed for the official report schema.

Keep complete package inventories, SBOMs and vulnerability reports bound to exact repository, manifest/platform digest and source/run. Record database bytes and timestamps before/after scans. Vulnerability DB age stays at most 48 hours, ordered/non-future; Java DB age remains recorded without a maximum-age rejection. All CRITICAL and fixable HIGH findings block. Unfixed HIGH still needs an exact independent disposition expiring within 30 days; none is granted here. No global ignore-unfixed, ignore list, omitted helper, missing report, end-of-life OS or suppressed failure can make a candidate pass.

## Admission, data and preservation

Accepted diagnostic correction increment, 2026-10-25: the [bounded correction plan](../../roadmap/plans/TASK-0005-managed-image-corrections.md), after sequential actual Architect and distinct Critic CLEAR reviews, responds to actual audit40196523287: PostgreSQL26, OpenSearch123 and AWS CLI15 blocking occurrences; Redis/SeaweedFS zero. It selects standard Buildx recipes, a truthful source-built gosu1.20/Go1.27.3 component, the exact available AL2023 repository2023.12.20261026, and a source-built OpenSearch3.9.0 minimal core with a coherent Jackson catalogue patch. Exact material locking and Go/JDK builder audits still precede construction; implementation review and actual Linux results remain required. No new registry write, signer, admission, custom archive parser, controller or Windows bootstrap is introduced. Existing locks/generations and their failures remain unchanged. The local Buildx/configID/archive diagnostic identity is explicitly separate from the later private registry subject.

ADR-0007's privacy, provenance, retained source/notices, complete evidence, second private copy/restore, currentness, revocation and support requirements remain in force. Private image/evidence bytes never become public Actions artifacts. Reuse existing package access evidence only within its exact scope; preserve `SKIPPED_BY_USER` for the external fork test. A new package still needs actual privacy/access checks before candidate publication.

No PostgreSQL admission generation, authority, support date or consumer entrypoint changes in this decision. An eventual shared admission mechanism requires a separately bounded amendment to ADR-0011, with equivalent authenticated policy, exact image identity, current audit, archive health and refusal of missing/expired/revoked/substituted evidence. Do not route supported service execution around the current contract. Diagnostic execution remains clearly labelled and grants no admission.

Retain loopback bindings, non-root service execution, resource/deadline bounds, credentials outside Git/public evidence, project ownership checks, raw `nocopy:true`, immutable raw digests, transactional canonical/outbox references, and refusal of nonempty/foreign restore targets. Preserve volumes and backups on tooling rollback. Keep the one-year support period from actual reviewed activation and at least 365 further archive days, with continuous security checks; dates remain null until activation.

## Finite delivery milestones

| Milestone | Observable completion condition | TASK-0005 criterion |
| --- | --- | --- |
| 1. Accept this substitution | Independent review of exact decision, tool provenance and retained controls; bounded implementation plan in PR77 | Operational/security review |
| 2. Qualify and select | Real scanner controls plus fresh complete audit of all five exact upstream roles; blockers reported, smallest necessary remedy selected | Dependency/container audit |
| 3. Admit eligible subjects | Exact provenance, retained evidence/source/notices, private retrieval and second-copy restore, reviewed authenticated consumer policy | Supported runtime, integrity, rollback |
| 4. Reuse Compose | Integrate only required admission/image changes with existing commands/migrations; meaningful refusal regressions pass | Reproducibility, secrets, role separation |
| 5. Run the foundation | All seventeen real Linux phases pass on final exact subjects: usable start, migrations twice/rollback/reapply, raw/outbox, writes/reads, restart, four failures/recoveries, backup/restore and scoped reset | All lifecycle/data acceptance criteria |
| 6. Deliver | Required lint/typecheck/tests/build/security checks, fresh checkout, independent final review, exact-head CI, normal protected merge and corresponding main CI | Definition of Done |

No percentage or deadline is inferred. A failed scan stops adoption of that subject, not the collection of remaining reports. An essential unresolved incompatibility is exposed as a concrete decision; it does not automatically open another toolchain project. TASK-0005 stays IN_PROGRESS and TASK-0006/0104–0106 stay blocked until actual acceptance.

## Substituted procedures and references

The [measured gosu source-component amendment](../../roadmap/plans/TASK-0005-managed-image-corrections.md#measured-gosu-source-component-amendment) received ordered actual Architecture and distinct Critic CLEAR reviews before implementation. It permits only the new diagnostic adapter to classify the exact final-byte/source-bound `(devel)` main separately from the versioned-package view, preserving the complete original report/SBOM, rejecting any main finding and recording `mainVersionLookup=UNAVAILABLE`. It changes neither gen5 predicates/admission nor vulnerability dispositions, and grants no exhaustive main-version coverage claim.

This decision narrowly supersedes ADR-0007's requirement to build the future scanner twice from patched source, conditional on the official-binary qualification above. It supersedes PR197's local Windows bootstrap prerequisite only for the selected Linux development/CI route. It does not approve the broader Node source patch, modify historical scanner/admission bytes, waive vulnerabilities, change storage, remove retention or replace physical restoration with dumps.

Official references: [runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), [setup-node implementation](https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/src/distributions/official_builds/official_builds.ts), [gh verification policies](https://cli.github.com/manual/gh_attestation_verify), [Docker attestations](https://docs.docker.com/build/metadata/attestations/), [Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/), [Compose down and volumes](https://docs.docker.com/reference/cli/docker/compose/down/), [Trivy filtering](https://trivy.dev/docs/latest/configuration/filtering/).
