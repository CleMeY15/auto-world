# TASK-0005A — B1b fresh build and conditional pair proof V1

Status: Architect CLEAR, then distinct Critic OKAY on 2026-10-20; no native operation, image acceptance or admission.

## Goal and dependencies

Connect the delivered PR183 pure Docker-save pair proof to a fresh, source-owned cold build. Baseline main470b8f3e0604ce51d07f1c0fa312fdead10e3a0f/tree8703a7916e3864a53ba5ff2fc9c5eb4c66392cf6. The existing accepted BASE/CANDIDATE metadata establishes current format only: neither has an authenticated narrow build window. File timestamps or the old overall operation start cannot supply that missing fact. Do not reread those archives or replay their consumed controls.

B1a lease/routing/context/command/reader boundaries and B1b.1 pure proof are prerequisites. TASK0005A/0005 remain IN_PROGRESS. No new business decision is needed. Product work owns apps, ROADMAP and DELIVERY in its separate chat.

## Eight owned paths

- scripts/postgres-image/gosu-derivative-image-observation-v2.mjs
- tests/postgres-gosu-derivative-image-observation-v2.test.mjs
- tests/postgres-gosu-derivative-image-build-proof-v1.test.mjs (new)
- roadmap/plans/TASK-0005A-gosu-build-proof-v1.md (new)
- docs/validation/TASK-0005A-gosu-build-proof-v1.md (new)
- docs/decisions/ADR-0015-gosu-compiler-derivative.md (append only)
- roadmap/tasks/TASK-0005A-managed-image-tooling.md (append only)
- roadmap/tasks/TASK-0005-local-data-infra.md (append only)

No dependencies, recipes, locks, daemon, shared scanner, pure proof, admission routes or classification changes. The existing effectful observation module is already diagnosticOnly. Preserve all unrelated files and the three existing document prefixes.

## Fixed opt-in interface and compatibility

Add runGosuDerivativeImageBuildProofV1 as a fifth export in the existing observation module. Its exact input is { purpose: GOSU_DERIVATIVE_IMAGE_BUILD_PROOF_V1, nonce, lease }; the lease retains B1a's existing fixed purpose and schema. Existing runGosuDerivativeImageBuildObservationV2 keeps its purpose, input, successful result, diagnostics and behavior. Both thin exports select a private fixed execution path. No public mode, proof bypass, supplied clock window, validator, command, path or result callback is accepted. Existing dependencies remain only now/runner/contextReader/archiveReader; any injected dependency forces a simulation result. Runtime defaults still require genuine UID1000 Linux Node22.23.2 and accepted private preflight.

Reuse one private pipeline, preserving B1a command order, sole context read/build, exact anonymous base pull/inspect/save before build, fixed build argv, isolated inventory/identity checks, candidate inspect/save, reader/hash/physical identity binding, deadline and cleanup. Context authentication retains the genuine openCandidateLockV2 handle privately alongside its unchanged public observation; it never becomes a caller-supplied handle or projected field. No handle close API exists; retain only for this call.

## Authenticated window and archive binding

Only the new path samples the existing source-owned now() immediately before and immediately after the awaited fixed build command. Native defaults use Date.now, never Docker logs or archive metadata. Require nonnegative safe integer times, ordered within the original operation/deadline, a safe completedAtMs = sampled completion + 1 (conservative inclusive upper bound for submillisecond created values), and duration at most600000ms. Reject rollback, nonfinite, unsafe or deadline-exceeding samples without retry. The same frozen { startedAtMs, completedAtMs } is passed to the proof and included in its enclosing result.

After both stable archive reads, require stream identities equal reader identities and the same per-role byte/hash/config identity already bound to fresh inspect. Call openGosuDerivativeDockerSaveV1 once per same in-memory buffer, with exactly { role, archive: stream identity, configId: fresh subject configId }, then proveGosuDerivativeImagePairV1 once with the retained lock and both opaque handles plus that window. The proof path does not also call the old inspectSave format observer. Its snapshots and genuine proof predicates remain unchanged. Guard the existing deadline before/after each awaited proof opener and synchronous pair proof; pure parsing retains its delivered bounded resource profile, not a new interruptible-parser promise.

## Closed results, failures and authority

New native result: state IMAGE_PAIR_PROOF_OBSERVED_REVIEW_PENDING, authority NOT_AUTHORIZED, image BUILT_UNVALIDATED, candidateAdmission NOT_AUTHORIZED, functional/vulnerabilities NOT_ESTABLISHED. Include only nonce, lease identity, existing builder/profiles/preflight/context observations, buildWindow, pairProof and dates:null alongside those fixed fields. PairProof is the unchanged nine-key conditional result from PR183. Historical provenance, actual-evidence acceptance, admission, activation, support dates and currentEvidence are not established.

Any injected dependency yields state PAIR_PROOF_SIMULATION, scope CONDITIONAL_PAIR_PROOF_ONLY, authority NOT_AUTHORIZED, image/candidateAdmission/functional/vulnerabilities NOT_ESTABLISHED; same structural observations but no operational claim. The dependency gate cannot be overridden by a supplied result. Reuse closed observation diagnostics: proof open/pair refusal maps to existing archive_invalid in OBSERVE, without arbitrary messages, causes, raw bytes/paths or new public archive-detail claims. Existing read/bind details stay intact. Invalid window maps to existing deadline_exceeded in BUILD. A failure after the build attempt remains MAY_HAVE_BEEN_BUILT. Always release context session and timer on success/failure; preserve owned partials and native state, no retries/cleanup expansion.

## Verification and delivery

Architect then distinct Critic review this plan before implementation. One executor owns production changes; an independent executor owns tests. New VM tests must actually run in ordinary test invocation through an explicit VM child wrapper (no silent platform skip). Verify fixed new purpose and unknown-field/dependency rejection; lease/runtime/preflight/routing failures before context/build; same single context Buffer sent to one build; pre/post window sampling and conservative bound; wrong/unsafe/rollback/excessive times; same buffer and stream/config identity to each opener exactly once; retained genuine handle routing; proof failure closure and MAY_HAVE_BEEN_BUILT; no proof on failed read/bind/build; no old double parse; deadlines and cleanup; any injection remains simulation. Use genuine delivered proof/scanner and candidate contracts in bounded integration fixtures where possible; any substituted authentication or proof spy is protocol-only, never actual acceptance. Existing V2 success/schema/error tests remain unchanged except fifth-export expectation and providing an unavailable proof import in VM fixtures.

Run targeted tests on pinned Windows/Linux Node22.23.2, then nonempty lint/typecheck/test/build, secrets and secure dependency audit. Independent final code/security review and immutable source/evidence closure precede commit/PR. Deliver through exact-head CI, normal protected merge with matching head, and merged-main CI. PR text carries plan, validation and limitations. Only after source delivery may a separate reviewed private caller/control authorise ONE fresh operation; this increment does not run Docker, read native context/archives, execute Gosu or consume any actual claim.

Rollback removes the opt-in export/new tests and reverses only the appended paragraphs via a focused review; preserve original evidence and existing V2 behavior. No migration or user-facing change. Support remains one calendar year from separately approved activation with continuous security checks; activation/support/archive dates remain null.

## Concurrent product integration

Before implementation, fast-forward to PR184 main21eff034d2901093b0cdd3e62940ea09a2398187/tree9ac908796e8aeaa1981fcfa37658e7557671a66d. Its eighteen product/design/test/task files are disjoint from the eight owned paths; all infra prerequisites are unchanged. Preserve that merged product content exactly. Final local and delivery checks run the combined baseline. Product merged-main CI is tracked independently in its owning chat.
