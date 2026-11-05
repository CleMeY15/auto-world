# ADR-0028 — Develop the functional V1 prototype before image security qualification

Status: Sequencing explicitly authorized by the user on 2026-11-05; independent architecture/contract review APPROVE and local quality checks passed. Exact-source CI and repository delivery remain pending. This is not image admission or production approval.
Scope: Isolated local/development CI and fabricated data, including the container-backed application path.

## Context and evidence

The user directed that TASK-0005's remaining security work be revisited only after a good functional V1 site prototype exists, and no longer block development in the meantime. ADR-0027 permitted only infrastructure diagnostics, so it did not implement this broader development permission.

[PR222's accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/222#issuecomment-6656692551) records the existing four-service lifecycle on main `39521a7f630ef4cbc4896f39129859a201ef5203`: [integration42015103402](https://github.com/CleMeY15/auto-world/actions/runs/42015103402) passes all seventeen phases and [quality42015103516](https://github.com/CleMeY15/auto-world/actions/runs/42015103516) passes general quality and browser checks. Both are attempt 1, with independently reviewed originals. These results establish functional evidence on that source, not security, future adapter behavior or this amendment's delivery.

## Decision

1. Treat TASK-0005's accepted functional milestone as a **satisfied infrastructure dependency for V1 prototype development**. Do not require completion of TASK-0005A, scanner/image qualification, signing, private-image retention/admission or supported-runtime activation before developing this prototype.
2. Extend the existing synthetic product lane to an explicitly selected container-backed dev/test composition. Reuse the existing pinned Compose stack and maintained tools; preserve the offline demo entrypoint and its production-import exclusions. This amendment introduces no runtime implementation, dependency or automatic connection to a data service.
3. Execute TASK-0104 (PostgreSQL store), then TASK-0105 (OpenSearch projection/API adapter), then TASK-0106 (application recovery) on focused branches. Each predecessor must be accepted on main in the prototype scope before its successor starts. Other tasks retain their own contracts, functional dependencies, Definition of Ready and UI/UX gates; this is not blanket approval of the entire roadmap.
4. A prototype task can be reported `DONE_FOR_V1_PROTOTYPE` after its own applicable acceptance criteria, functional tests, quality checks and independent review pass. This scope satisfies downstream **prototype** dependencies only. No full infrastructure, image-admission or production Done is inferred.
5. Defer the remaining TASK-0005/TASK-0005A security qualification until the functional V1 prototype milestone below. Preserve findings, failed runs, source/archive evidence and the later admission obligations. Do not relaunch scanner/qualification work merely because a prototype task begins or completes.

## Scope and controls that still apply

- Only fabricated fixtures in a local or isolated CI environment. No external listing acquisition, real user/seller data, production credentials, public deployment, registry publication or new private-archive operation is authorized.
- Host-facing service/API ports remain loopback-only; required connections between the isolated application and its database/search containers are allowed. The original offline lane remains network-free apart from its existing loopback API. The container-backed lane is selected by a dev/test entrypoint, never an end-user request or a production feature flag.
- Keep credentials out of Git and public artifacts, non-root execution, immutable image identities, project-owned resources, bounded resources/timeouts, scoped cleanup, restore-target refusal and sentinel checks. Do not bypass an existing admission broker or forge an admitted result: use the separate explicit prototype composition.
- Keep raw bytes and hashes, provenance, versioned observations, fenced transactions, canonical/outbox integrity, migration/replay and backup/restore requirements. PostgreSQL remains authoritative; OpenSearch is derived; Redis/S3 do not acquire new roles by implication.
- Retain lint, typecheck, tests, build, ordinary secret/dependency checks, relevant failure cases, accessibility, browser and visual/performance checks. The deferral concerns the remaining **TASK-0005 image/scanner qualification**, not deletion of existing tests or permission to introduce a secret, unsafe exposure or broken behavior.
- Existing checks/workflows are not disabled or modified by this documentation-only change. Do not manually dispatch the deferred image/scanner workflows. If a later prototype diff touches a path that automatically starts that work, separate the changes or make a narrow reviewed routing amendment; do not skip unrelated quality checks or disguise a failed run as success.
- Synthetic UI remains explicitly labeled; no fabricated vehicle, history, valuation, source right or security result is presented as verified fact. Source Registry rights and Vehicle Intelligence/provenance contracts are unchanged.

## State and dependency interpretation

| Concern | State / meaning |
| --- | --- |
| TASK-0005 functional evidence | PR222 `VERIFIED_DIAGNOSTIC_ONLY`, unchanged and source-bound |
| TASK-0005 dependency for the V1 prototype | Satisfied by that functional milestone under this user-authorized sequencing amendment |
| TASK-0005/TASK-0005A security qualification | `DEFERRED_UNTIL_V1`; no pass or vulnerability waiver is claimed |
| Image admission / supported runtime | `NOT_AUTHORIZED`; activation/support dates remain null |
| TASK-0104 | Next prototype task after acceptance of this amendment; storage design/migrations must be specified before coupling |
| TASK-0105 / TASK-0106 | Wait for their actual prototype predecessors; this amendment does not implement them |
| Production / public deployment / real-source operation | Not authorized by the prototype milestone or by this amendment |

This supersedes the conflicting prototype sequencing restrictions in ADR-0012, ADR-0026, ADR-0027, the TASK-0006 plan and TASK-0005/0005A/0104–0106 records. Their image-security/admission policies still govern later supported/production use. Historical checkpoints remain historical; do not rewrite them as successful qualification. The accepted TASK-0006 synthetic plan remains Done; it is not reopened.

## V1 milestone and return to security

Continue developing the agreed site journeys into a usable V1 prototype, including persistent synthetic data and the actual application search path. Finishing one technical task, compiling the site or passing TASK-0106 alone does not declare the full V1 delivered. Record a demonstration of the implemented V1 journeys, their functional/UX evidence, remaining product limitations and the user's confirmation that the prototype is usable.

At that milestone, revisit the retained TASK-0005/TASK-0005A security backlog as a distinct release-readiness task. In all cases this must happen **before** public deployment, supported-runtime activation, real-source/customer data or production operation. Such a request ends the deferral for that exposure and requires its own qualification and authorization; a local demo link does not authorize publication. No completion date or automatic security acceptance is invented.

## Alternatives and consequences

- Waiting for all image qualification before application development preserves the old gate but contradicts the user's chosen order; it is not the prototype path.
- Declaring all security checks passed or removing safeguards would misrepresent evidence and expand exposure; it is not authorized.
- The selected bounded deferral makes application development possible while retaining a visible release debt. An isolated prototype can still contain known or unassessed image vulnerabilities and must not be described as secure or production-ready. Isolation limits exposure; it is not a vulnerability fix.

## Verification and rollback

Review current task/roadmap/DoD wording for the same boundary and ordered dependencies. Confirm that this increment changes documentation only and does not alter Compose, image pins, workflows, lockfiles, tests or admission state. Run normal repository quality checks and retain their exact-source results; do not rerun the image qualification as a prerequisite for this amendment. [Validation record](../validation/ADR-0028-V1-PROTOTYPE.md).

Rollback the sequencing through a reviewed documentation revert and stop only the owned prototype processes. Preserve volumes, fixtures, backups and evidence. After downstream prototype changes exist, freeze new prototype progression and assess those changes explicitly; reverting this ADR neither deletes their data nor converts them to admitted production code.
