# TASK-0005 — Managed-tool continuation

Status: IN_PROGRESS. Actual Linux scanner controls pass; three upstream image roles remain blocked by vulnerability findings. No image admission, support activation or four-service acceptance is claimed.

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

## Actual Linux continuation

[Integration run40194959748](https://github.com/CleMeY15/auto-world/actions/runs/40194959748) succeeds on source `6e6537f770e40ae3c535d6ca4e3f9694ce1fbf0b`, reviewed tree `c60af22ee4b087d7ef9a07c3ecf1633ab5c5bf13`. Its tested pull-request merge `1fa9ff6e7f87e1f10f38b6862b6985b9c09a9a0a` has the same tree. All seventeen named verification phases pass. Ten failed health observations occur during the deliberately stopped/restarted dependency scenarios; their recovery phases and overall validation pass. The original validation JSON is 7,527 bytes, SHA256 `0179b405cf6d9fbf0f1677f32a1f1b479a64c20b5418a42103e2dcd7d3ed8993`; artifact12599314437 is 1,094 bytes, advertised SHA256 `ac7dd577b9d46a7cf005df2444be4755014623a8842464e7dd391eaa90e3000d`. This remains DIAGNOSTIC_ONLY on the old exact Compose images, not admission or acceptance of the five new candidates.

[Scanner run40194289850](https://github.com/CleMeY15/auto-world/actions/runs/40194289850) remains FAILED before extraction: copying the read-only archive also made the negative-control copy read-only. The independently reviewed correction makes only that new test copy writable. [Run40194959739](https://github.com/CleMeY15/auto-world/actions/runs/40194959739) then passes provenance, all four real refusal controls and inert extraction, but stops before executing the scanner because the official Go inventory contains the previously unanticipated `v0.76.1+dirty` / `vcs.modified=true` markers. Both failures and original artifacts are preserved. No scanner-fitness result or image report is inferred.

The original Go inventory is 36,605 bytes, SHA256 `c0635189c3438986aecc0b7a4ac17cf90bac00259a982e1eb594dd817758cded`, now retained as an immutable public test fixture. The [narrow measured-profile note](../decisions/ADR-0026-data-foundation-managed-tools.md) ties these raw markers to the same authenticated archive, exact extracted binary SHA, source/Go/dependency/platform tuple and unchanged qualification gates. It neither strips the marker nor authorizes future dirty builds. Source-to-binary equivalence and reproducibility remain NOT_ESTABLISHED.

### Complete upstream audit, 25 October 2026

[Run40196523287](https://github.com/CleMeY15/auto-world/actions/runs/40196523287), source `26508f499211166b53fd33f1b3b93d26effa7aff`, reviewed tree `0baea8e2180c117872083d0cb48bb159a6bfe17b`, passes actual official provenance/refusal controls, binary/material checks, scanner self-audit, main-version detection, vulnerable/clean fixtures and comparison with the baseline on the same captured databases. All five complete image JSON/CycloneDX pairs are collected. The job remains FAILED because the unchanged vulnerability policy rejects three subjects; this is not an acquisition, parser or missing-report failure. Original artifact12599922319 is 815,664 bytes, advertised SHA256 `5fcb13cee2e91a10fc33a8dfb50be76e5dd357d1495206386c33e95bc510d78c`.

| Exact candidate in official-release.json | Blocking findings | Observed scope |
| --- | ---: | --- |
| PostgreSQL17.11 Alpine3.24 | 26 | gosu's Go1.24.6 stdlib: one CRITICAL and25HIGH |
| OpenSearch3.9.0 | 123 | 52OS and71Java HIGH findings; repeated packaged dependencies count separately |
| Redis8.10.2 Alpine3.23 | 0 | Complete report/SBOM passes this diagnostic policy |
| SeaweedFS4.50 | 0 | Complete report/SBOM passes this diagnostic policy |
| AWS CLI2.38.5 | 15 | Amazon Linux OS HIGH findings |

All ten report identities match the receipt. Independent pure reevaluation reproduces these counts and validates each SBOM. The distinct full actual-evidence review accepts scanner qualification within the diagnostic milestone: exact provenance/source/ref/workflow, four refusal controls and paired positive, material inventory, self/fixture/comparison results,29 recorded commands without errors and20 final container-absence checks. Its verdict grants no image admission or vulnerability disposition. The original receipt is156,200bytes, SHA256 `4cdf612345586f763b3b361ce5b73f853eded63eee5842f2e0e823b45f7ba3f7`; the tested PR merge `d2029936906a17909c37503cccb63368d9a3870b` has the same reviewed source tree. DB binaries are absent from the public artifact: their recorded hashes are runtime observations, not an independent current rehash.

The captured vulnerability DB was updated at12:57:48UTC and checked at13:13:17UTC, approximately15minutes old; its actual bytes are SHA256 `73431481129de1e7c742fd3eab7d2d8ec592504a641b73df8ca433479e5da47f`. The Java DB was updated at00:59:20UTC, with bytes SHA256 `96f89ba46e64eaa8a3b0c7c5220457aff8de127b5342d09e8a49615f8d605944`. Both captured registry manifests remain identical before/after acquisition, and database bytes are checked unchanged through the scans. These dated diagnostic results do not replace continuous currentness checks, source/notices retention, private access/restore or reviewed admission.

[Integration40196523288](https://github.com/CleMeY15/auto-world/actions/runs/40196523288) also succeeds on this source with all17 verified lifecycle phases. Its46 records include nine failed health/readiness observations during deliberate restart/fault scenarios, followed by successful recovery. The original validation JSON is7,331bytes, SHA256 `562f26d5c20690f83038eb3b4587d115b408b75dff53a3c2170c1d2d76b5d333`; artifact12599818103 is1,100bytes, advertised SHA256 `35ab3d2c67a71745df3486a3ac2c5f072ce9d18e23c7105fbbe986b8043b758b`. It still tests the old exact Compose images and grants no admission to the newly audited or future corrected subjects.

[Quality CI40196523324](https://github.com/CleMeY15/auto-world/actions/runs/40196523324) succeeds on the same exact source: lint14/14, typecheck21/21, workspace test tasks28/28 and build14/14. Root tests report2,308 total,2,249 passed,59 existing platform exclusions and zero failures. Browser checks report393 passed and seven existing exclusions. Secrets and dependency audit steps pass; the dependency audit reports no known vulnerabilities. This validates the reviewed scanner source and existing product/data code, not the rejected image subjects.

### Managed correction source, 25 October 2026

The [reviewed correction plan](../../roadmap/plans/TASK-0005-managed-image-corrections.md) received ordered independent Architecture and distinct Critic approval before implementation. The first implemented subset uses standard Buildx recipes: source-built gosu1.20 with Go1.27.3 for PostgreSQL, a coherent signed transaction from the exact dated AL2023 repository for AWS CLI, and the upstream OpenSearch3.9.0 minimal no-JDK core build with the targeted Jackson catalogue fixes and its original runtime JDK preserved. Both compiler images are audited before compilation; all five final runtime/helper roles must receive complete fresh reports and SBOMs. Local configID and Docker-save archive identities remain distinct from registry subjects.

Independent recipe and complete implementation reviews approve diagnostic CI only. The complete source suite reports93 total,88 passed, five new Windows-only exclusions and zero failures. The exclusions are three OpenSearch shell cases and two evidence-symlink cases; they remain required on Linux. Separate legacy/data regressions report58 total,55 passed, three existing Windows/POSIX exclusions and zero failures. Full local lint14/14 and typecheck21/21 pass without cached tasks; secret checks pass for1,147 repository files and the dependency audit reports no known vulnerabilities. No local Docker, candidate execution or full-build success is claimed; Linux CI must establish the actual builds and platform-specific checks.

The managed workflow exposes validated bounded technical text only. Candidate archives, database binaries, compiler binaries and raw evidence exports are excluded from public artifacts. Every managed receipt explicitly keeps `functionalRuntime=PENDING_NOT_ACCEPTED`, `milestone2Completion=NOT_ESTABLISHED` and `admission=NOT_AUTHORIZED`: this first construction/audit subset cannot establish the produced images' entrypoint/persistence, signed S3 refusals, index/search/restart/restoration or completion of the plan. Those runtime tests and the existing final acceptance gates remain pending.

## Remaining milestones and stop conditions

1. Preserve the independently accepted diagnostic scanner qualification, the two earlier failures and the current failed overall image audit. Scanner/current-database controls remain required for every final acceptance audit.
2. Resolve the measured PostgreSQL, OpenSearch and AWS CLI blockers using the smallest maintained-tool correction, then obtain fresh complete reports/SBOMs for final exact subjects. Keep every CRITICAL and fixable HIGH blocking, unfixed HIGH subject to exact independent disposition, and the vulnerability DB at most48hours old.
3. Admit eligible exact subjects with provenance, source/notices, retained evidence, applicable private access checks and second-copy restoration. Any shared admission replacement needs a bounded ADR-0011 amendment; no current PostgreSQL generation is bypassed here.
4. Apply required image/admission changes to the existing Compose implementation, then pass all seventeen real lifecycle/data phases on final subjects, including restart, each dependency failure/recovery, migrations and isolated restoration.
5. Complete quality/security checks, fresh checkout, independent final review, exact-head CI, normal protected merge and corresponding main CI. Mark TASK-0005 Done only after its applicable criteria are satisfied.

Private image/evidence bytes are never uploaded as public Actions artifacts. New diagnostic artifacts contain only explicitly selected public technical provenance and reports. Historical failures, admissions, support duties and Native/B1b operations remain preserved; none is replayed or cleaned up. No source, connector, production deployment or downstream supported task is enabled.
