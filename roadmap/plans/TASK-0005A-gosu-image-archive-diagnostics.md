# TASK-0005A — closed archive failure diagnostics

Status: IMPLEMENTATION_VALIDATED; final-head and merged-main source delivery pending. Owner: Platform/SRE. Independent code review: APPROVE; architecture review: CLEAR for source observability only. No actual operation or parser repair is approved by this plan.

## Goal and dependencies

The separately reviewed B1a generation2 attempt reached OBSERVE and failed with `gosu_derivative_image_observation_archive_invalid`. Its UID receipt retains no archive role or validation branch. Root subsequently failed its EMPTY inventory check and reported uncertain cleanup. Two independent reviews accept the retained failure metadata only; image format, profiles, functionality, vulnerability status and admission remain unestablished. The exact historical archive branch cannot be recovered from that receipt.

PR175 is SOURCE_DONE_ON_MAIN. Its public observation implementation and the retained generation2 evidence are prerequisites, not evidence of image acceptance. TASK-0005A/0005 remain IN_PROGRESS. Product TASK-0110 is separately delivered on main by PR177; no product code belongs to this increment.

## Closed ownership

Modify only `scripts/postgres-image/gosu-derivative-image-observation-v2.mjs` and its existing test. Add this plan and `docs/validation/TASK-0005A-gosu-image-archive-diagnostics.md`. Append only to ADR-0015, the decisions index, the original B1a observation plan and DELIVERY.md. These eight paths form one focused branch/PR.

The scanner, accepted archive language, successful observation result, original diagnostic getter, daemon, private callers, context, recipes, locks, source materials, admission consumers, workflows, dependencies and product surfaces retain their existing contracts. Existing private evidence and consumed claims are immutable.

## Opt-in contract

Add exactly one public export: `gosuDerivativeImageObservationArchiveFailureDetailV1(error)`. It returns `null` for an unbranded error, or an immutable exact data object `{version:1,role,stage,reason}`. A module-private WeakMap brands errors created by this module; the getter reads no properties of its argument. `closed()` preserves this branded detail when retaining a post-build failure.

Roles: BASE, CANDIDATE, UNKNOWN. Stages: READ, BIND, OUTER_TAR, MANIFEST, CONFIG, LAYER. Local reasons: READ_INVALID, SIZE_INVALID, IDENTITY_MISMATCH, MEMBER_INVALID, JSON_INVALID, SCHEMA_INVALID, EXPANSION_LIMIT, UNKNOWN. A scanner reason may additionally be an exact member of a hard-coded allowlist of existing `seaweed_archive_*` codes. Read an internal caught error's own data message descriptor safely; arbitrary text, inherited fields, accessors, proxies and unknown reasons yield UNKNOWN. No raw exception text, path, archive bytes or command output enters the detail.

The historical `gosuDerivativeImageObservationFailureDiagnostic()` continues to return exactly `{code,phase,state}` with unchanged behavior. Existing accepted results and rejection codes remain unchanged. Distinguish the first failing base/candidate identity comparison deterministically. Preserve accepted OPAQUE layers and their NOT_ESTABLISHED predicates.

This source API alone does not add detail to the consumed generation2 receipt. A future separately reviewed caller must opt into it. No retry, context reread, original archive replay, Docker operation, publication or support activation follows from source delivery.

## Acceptance and verification

Before implementation, record a meaningful failing regression for the missing detail API. Use existing synthetic TAR fixtures and VM seams, without native Docker, WSL or private bodies. Cover BASE/CANDIDATE reads and bindings; outer USTAR checksum/EOF; manifest/config member, JSON and schema failures; missing/invalid layers, DiffID and expansion bounds; retained MAY_HAVE_BEEN_BUILT detail; unchanged accepted and OPAQUE results; frozen exact packets; hostile reflection and no raw-data disclosure.

Run targeted regressions, syntax/static analysis, lint, typecheck, repository tests, build, secret scan and dependency audit on pinned Node22.23.2/pnpm10.15.0. Require independent code/security and architecture review. Final-head CI, identical reviewed merged tree and merged-main CI establish source delivery only. Do not mark TASK-0005A or image acceptance Done.

## Operations and rollback

No migration, daemon action or new persisted state is introduced. The new getter is opt-in and diagnostic-only. Rollback reverts this source increment; it cannot erase earlier failed attempts or reinterpret their authority. Keep the old diagnostic schema available throughout rollback and preserve all existing resource, deadline, ownership and parser limits.
