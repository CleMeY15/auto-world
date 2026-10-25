# TASK-0005 — Managed-tool continuation

Status: IN_PROGRESS. Scanner implementation and actual Linux qualification are pending. No image admission, support activation or four-service acceptance is claimed.

## Delivered and preserved

The comparison and official registration/history journeys are delivered separately; HistoVec was accepted through [PR194](https://github.com/CleMeY15/auto-world/pull/194#issuecomment-6378724917). They do not require new infrastructure work.

The existing [PR77](https://github.com/CleMeY15/auto-world/pull/77) Compose implementation already passed seventeen real Linux integration phases on its historical exact images. Its [validation record](TASK-0005.md) remains historical: those images, audits and expired artifacts cannot establish current acceptance. The branch now incorporates accepted main `df00b54c2e8f561447bd0cad0d897a7adfeb654c` through local merge `0dc252d`; local data tests report 50 total, 47 passed, three existing Windows/POSIX exclusions and zero failures.

The Windows Python/GnuPG/Node bootstrap is stopped. Its third real acquisition reached Parent completion and a provisional handoff, then failed during Runner cleanup; no accepted Root DATA receipt exists. A bounded `.ToArray()` correction passes 27 native PowerShell5 regressions, including real stream closure. The capture records preserve their strict failed-evidence classification because module-progress CLIXML was emitted on stderr; the separate interpretation records zero errors. No follow-on acquisition, extraction, Python execution or bootstrap promotion is authorized by that result. [PR197](https://github.com/CleMeY15/auto-world/pull/197) remains a documentation-only draft.

## Reviewed substitution

[ADR-0026](../decisions/ADR-0026-data-foundation-managed-tools.md) received sequential independent Dependency, Architecture and distinct Critic CLEAR reviews. The reviewed decision candidate was 9,588 bytes, SHA256 `5db011001cf5b6333257d14b479cfc5f77a613e867c0e523059c9145afcd5e26`. It selects Linux CI and conditional qualification of the maintained official scanner, preserving the essential security, data, retention and delivery controls. The subsequent status note records that acceptance without extending its scope.

The new workflow uses official GitHub tooling and existing Docker/Compose/scanner helpers. It introduces no custom registry, cryptography, daemon or Windows launcher. Managed setup-node provisioning is explicitly not an independent OpenPGP verification claim.

## Current measured inputs

On 25 October 2026, existing `gh` 2.98.0 verified the received official Trivy 0.76.1 Linux64 archive: 52,676,794 bytes, SHA256 `c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`. Official SLSA verification succeeded for exact source `e713f67f7d54decdcd9b3132c9751833dcced698`, ref `refs/tags/v0.76.1`, the reusable release workflow and its exact certificate identity, with self-hosted runners refused. Four actual negative controls rejected changed bytes, wrong source, wrong workflow and wrong ref. Original verification outputs and bundle are retained locally. The archive was not extracted and its binary was not executed during this check. This proves the recorded provenance check, not scanner fitness or vulnerability coverage.

Registry metadata resolves five candidate tags to immutable Linux/amd64 subjects in [the new diagnostic input](../../infra/scanner/official-release.json): PostgreSQL17.11 Alpine3.24, OpenSearch3.9.0, Redis8.10.2 Alpine3.23, SeaweedFS4.50 and AWS CLI2.38.5. Index and platform JSON bytes match their registry digest headers. No layer or configuration was read during selection, and no security or build-source equivalence is inferred from tag metadata.

## Remaining milestones and stop conditions

1. Review the new scanner implementation independently and run its actual Linux provenance/material/self-audit/fixture controls, including comparison against the baseline using identical captured databases.
2. Collect all five complete image reports and SBOMs, even when a subject is rejected. Keep every CRITICAL and fixable HIGH blocking, unfixed HIGH subject to exact independent disposition, and the vulnerability DB at most 48 hours old. Select the smallest evidence-backed remedy for any remaining blocker.
3. Admit eligible exact subjects with provenance, source/notices, retained evidence, applicable private access checks and second-copy restoration. Any shared admission replacement needs a bounded ADR-0011 amendment; no current PostgreSQL generation is bypassed here.
4. Apply required image/admission changes to the existing Compose implementation, then pass all seventeen real lifecycle/data phases on final subjects, including restart, each dependency failure/recovery, migrations and isolated restoration.
5. Complete quality/security checks, fresh checkout, independent final review, exact-head CI, normal protected merge and corresponding main CI. Mark TASK-0005 Done only after its applicable criteria are satisfied.

Private image/evidence bytes are never uploaded as public Actions artifacts. New diagnostic artifacts contain only explicitly selected public technical provenance and reports. Historical failures, admissions, support duties and Native/B1b operations remain preserved; none is replayed or cleaned up. No source, connector, production deployment or downstream supported task is enabled.
