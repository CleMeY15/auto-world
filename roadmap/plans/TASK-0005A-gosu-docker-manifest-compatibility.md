# TASK-0005A — Docker-save manifest compatibility

Status: PROPOSED_FOR_INDEPENDENT_PLAN_REVIEW. Owner: Platform/SRE. One focused source branch/PR; no actual operation is authorized by this plan.

## Goal, readiness and evidence

Fix the observer's use of an exact internal three-key record predicate against a Docker-save manifest that has documented optional metadata. PR178 is SOURCE_DONE_ON_MAIN at 4c07655664c428db5e8d6965366503ffa1d3c65c with accepted final-head/main CI. TASK-0005A/0005 remain IN_PROGRESS. Product TASK-0110 is independently delivered; no product change belongs here.

A separately reviewed current-only BASE diagnostic reports MANIFEST_ENTRY_KEYS_INVALID after a complete bounded manifest read, valid UTF8/JSON, root array length one and a plain entry. Its accepted index is3626 bytes/SHA25606d99c7911a29271da9bc250d22ee56f3698b2de09e34d50662915e70e5a5498. This establishes neither which key is missing/additional nor conformity to Docker, an original historical failure branch, image identity or acceptance. No retained archive or original CI capture will be replayed.

Normative upstream references:
- Docker image spec at1789f1ff5752290c18b57cfebcce12205a607dee documents Config/RepoTags/Layers and optional Parent: https://github.com/moby/docker-image-spec/blob/1789f1ff5752290c18b57cfebcce12205a607dee/spec.md#L683-L710
- Moby v28.5.2 at89c5e8fd66634b6128fc4c0e6f1236e2540e46e0 defines Config/RepoTags/Layers plus Parent and LayerSources with omitempty: https://github.com/moby/moby/blob/89c5e8fd66634b6128fc4c0e6f1236e2540e46e0/image/tarexport/tarexport.go#L22-L28
- Its save writes the optional metadata: https://github.com/moby/moby/blob/89c5e8fd66634b6128fc4c0e6f1236e2540e46e0/image/tarexport/save.go#L310-L325
These are source-contract references, not a claim about our installed engine version or actual manifest contents.

## Closed source ownership

Modify only scripts/postgres-image/gosu-derivative-image-observation-v2.mjs and its existing tests/postgres-gosu-derivative-image-observation-v2.test.mjs. Add this plan and docs/validation/TASK-0005A-gosu-docker-manifest-compatibility.md. Append only to docs/decisions/ADR-0015-gosu-compiler-derivative.md, docs/decisions/README.md, roadmap/plans/TASK-0005A-gosu-image-build-observation.md and roadmap/DELIVERY.md. Eight paths total. Root owns the six documents/integration; a bounded executor owns source/test. Others coexist; never revert their work.

## Selected contract

Keep V2, its four exports, arguments, exact success and diagnostic schemas unchanged. Replace only the exact-three-key manifest-entry predicate with a closed predicate:
- Require a plain non-Proxy entry, own data-only Config, RepoTags and Layers.
- Allow only the optional own data-only Parent and LayerSources; reject any other top-level key, symbol or accessor.
- Parent, when present, must be a string; LayerSources, when present, must be a plain non-Proxy JSON object. Absent optional fields preserve prior behavior. Explicit null, arrays and scalars are not accepted as LayerSources. This is a deliberately bounded producer projection, not the full permissive Moby load language.
- Do not traverse or validate the nested descriptor values or canonicalize Parent as an identity. They are unused metadata under the existing4MiB manifest cap. This increment does not establish their validity, provenance or content; no raw optional value or structured optional field is projected; existing archive and manifest byte hashes still cover the complete original bytes, including optional metadata, unchanged. Requiring DiffID subsets/descriptor semantics would introduce an unrelated metadata interpretation.
- Never interpret optional metadata for subject identity, config/layer selection, Parent linkage, remote fetch, paths, authority, admission or historical conclusions. No URL following, command, callback, network operation or new read follows from it.
- Keep all existing semantic checks on the three core values, candidate reference membership, BASE tag policy, configuration digest/image ID/platform, member presence, actual layer bytes/DiffIDs, accepted OPAQUE behavior, bounds/deadlines and first-failure diagnostic unchanged.
Unknown keys and malformed optional top-level types fail with the existing archive-invalid code and MANIFEST/SCHEMA_INVALID detail. This intentionally broadens only the manifest-entry accepted language for the two documented optional fields. The PR178 no-parser-change constraint was scoped to its diagnostic-only increment and is superseded here only for this predicate.

## Acceptance and tests

Before source edits, get independent architecture and code/security plan approval and put this concrete plan in the draft PR body. Write a meaningful regression first: valid synthetic BASE/CANDIDATE exports with Parent, LayerSources and both must fail on the unchanged source, then pass after the predicate repair. Preserve the old source/test bytes and RED output privately.

Tests must also prove missing core fields, unknown extras, wrong optional types, symbols/accessors/Proxies reject without invoking application getters; required tag/binding/config/layer/limit failures remain unchanged; no optional marker string or URL is projected verbatim and no structured optional field is added to results or diagnostics; no metadata causes retrieval; existing full-byte archive/manifest hashes still bind optional metadata and may differ when its bytes change; accepted/OPAQUE results and exact four exports stay unchanged. Use existing synthetic TAR/VM seams only, never native Docker, private archives/context or forged real acceptance.

Run pinned Node22.23.2 syntax/targeted tests/strict lint, then lint, typecheck, repository tests, build, secrets and dependency audit with pnpm10.15.0. Require fresh focused Linux validation and independent final code/security and architecture review. Final exact-head CI, reviewed merge-tree identity and merged-main CI are mandatory source delivery gates. Record operational implications and rollback in the six owned documents.

## Operations, delivery and rollback

No dependency, scanner, workflow, caller, daemon, recipe, lock, admitted inventory or persisted-state schema changes. The output remains FORMAT_OBSERVED_ONLY with all existing NOT_ESTABLISHED predicates. No source proof alone resolves the retained key mismatch or validates an actual image. Any post-delivery current archive validation requires its own reviewed plan; no original claim/budget is reset or consumed by this source increment. Preserve all previous evidence, including failed/consumed originals.

Rollback reverts this predicate compatibility increment, restoring the stricter rejection and blocking exports with the documented optional metadata; it does not admit any previous image or erase evidence. No migration or cleanup occurs. currentEvidence remains unchanged, support dates null, TASK0005A/0005 IN_PROGRESS and supported0104-0106 BLOCKED.
