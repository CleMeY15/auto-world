# TASK-0005A — Docker-save optional manifest metadata

Status: IMPLEMENTATION_VALIDATED. Source-only increment in PR179; independent code/architecture reviews and local gates pass. Final-head and merged-main CI remain pending. TASK-0005A/0005 remain IN_PROGRESS.

## Verified starting point
PR178 is SOURCE_DONE_ON_MAIN: source229569dff687b8ebb1dbe097d897f0d8871e1526, main4c07655664c428db5e8d6965366503ffa1d3c65c, identical tree16e9894b32870801cdf24215e2aad0b6af771c6d; source/main CI39118622387/39119719466 SUCCESS. Its originals remain retained and are not re-fetched here.

Three separately reviewed current-only observations narrowed retained BASE failure from headers/padding to a decoded single-entry manifest and finally MANIFEST_ENTRY_KEYS_INVALID. The final accepted index is3626 bytes/SHA25606d99c7911a29271da9bc250d22ee56f3698b2de09e34d50662915e70e5a5498. Its execution completed normally with45 reads/20702 bytes:29 headers14848 bytes,15 padding reads2663 bytes, one manifest3191 bytes. Configuration and candidate reads remain zero. The acceptance3896/SHA256cc4d1878b751720d39459f01a247b314a424dcc7a54b71339c40ed0c32b096a9 establishes only that the exact expected entry-key set failed. It identifies neither missing/additional keys nor historical cause, Docker conformity, full image validity, cleanup, functionality, vulnerabilities or admission.

## Contract and boundary
The [approved plan](../../roadmap/plans/TASK-0005A-gosu-docker-manifest-compatibility.md) uses the pinned [Docker image specification](https://github.com/moby/docker-image-spec/blob/1789f1ff5752290c18b57cfebcce12205a607dee/spec.md#L683-L710) and [Moby manifestItem](https://github.com/moby/moby/blob/89c5e8fd66634b6128fc4c0e6f1236e2540e46e0/image/tarexport/tarexport.go#L22-L28), which support optional Parent and LayerSources metadata. Those references are independent of our unknown actual key contents and installed engine version.

The focused V2 entry predicate requires three core own data fields, allow only Parent(string) and LayerSources(plain non-Proxy object), and reject unknown keys, symbols, accessors and incorrect optional top-level shapes. Optional raw/structured fields are not projected or interpreted for selection, identity, authority or remote fetching. Their complete bytes remain covered by existing archive/manifest hashes. All core binding/configuration/layer checks, four exports, success/diagnostic schemas, OPAQUE treatment and resource limits remain unchanged.

## Validation and delivery
Independent architecture and code/security plan approvals apply to6972/SHA256e281c828fe7048ef861a3a9723384c2a77beb82c49a8aca2a1aed2709fdc113d. A draft PR contained this plan before implementation. Meaningful RED/GREEN, targeted Windows/Linux tests, six local gates and distinct final code/security and architecture reviews pass. Final-head CI, matching reviewed merge tree and merged-main CI remain required. The baseline protects1002 unrelated tracked files and four exact append-only document prefixes; the final increment owns eight paths.

## Operations and rollback
No new dependency, workflow, caller, native Docker/context/archive operation, migration, admission or support activation occurs. Reverting this source change restores the stricter rejection of documented optional metadata. Existing failed/consumed evidence stays immutable, currentEvidence unchanged and support dates null. A post-delivery real archive observation needs its own independently reviewed plan; this source proof alone does not resolve the retained mismatch.


## Targeted regressions and independent reviews

Final source62994/SHA256759cdb89c5296e17c6a9372f7f80b2e3c466b2bdb0f8684b37d7b39154f64785 and test84264/dc68f051a48df11bc2394f75309dcba21f883762c8afc3af29f30bca56a7f2c5 are frozen. The source diff is twelve added lines and one predicate replacement; the shared exact() helper is unchanged. Six positive producer variants (Parent, LayerSources and both, for BASE and CANDIDATE) fail on the unchanged source at MANIFEST/SCHEMA_INVALID. Retained RED index1345/SHA256932cc64635089842649de66ff68db8951717acf99892ab82548c35e0cdcd6b0b binds that old source and its complete failure output.

GREEN1464/SHA25602169ea9e9affbb4a5db4f9a80100d027237e1f069d50070b03f4da8670fce0f records six focused passes,62 VM cases and19 standard wrappers passing on Node22.23.2, syntax and strict ESLint. Negative tests preserve missing-core/unknown-field/type/tag/binding/layer rejection and finite diagnostics; hostile own descriptors, symbols, getters and proxies fail without invoking application getters. Nested unused metadata is untraversed. Optional marker strings and URLs are absent verbatim from results and diagnostics, the export set remains four, and full archive/manifest hashes still cover optional bytes.

A fresh independent Linux clone passes19/19 wrappers under UID1000 and pinned Node22.23.2, with empty stderr and unchanged final source/test hashes. Its index823/SHA256859442dfc96c233d8880925dbcc663f850ad75019b6bb7b8d5e1f1a5be58ac33 retains original stdout/stderr. Distinct architecture APPROVE/CLEAR and code/security CLEAR_CODE_CONTRACT_ONLY report no findings; review record1606/SHA2568a88fe695b7a3bfd578483c3d4739534c6893a604f20ed593c24c13563667f47 binds the same final source/test and targeted proofs. These are source-implementation reviews, not image or delivery acceptance.

## Complete local gates

Node22.23.2/pnpm10.15.0 pass lint, typecheck, repository tests, build, secret scan and dependency audit. Turbo dry runs resolve14/21/28/14 tasks; all28 test tasks pass. Windows root TAP reports2007 tests,1564 passes,443 explicit platform exclusions and zero failures/cancellations/todos. Secretlint scans1010 files; dependency audit reports no known vulnerabilities. All1002 protected files and four original document prefixes remain byte-identical; source/test hashes remain unchanged.

The initial gate index9217/SHA256ac6d8332104f2dfd9d3560c9b2c43b4d29928f056f2b98c2985c9423e8fcfc56 retains five successful gates and an audit TLS-chain failure (UNABLE_TO_VERIFY_LEAF_SIGNATURE). A separate audit, using only process-local Node --use-system-ca with TLS verification enabled and no persistent configuration change, succeeds with empty stderr; index1586/SHA256b45178a8a38c736edf908805725b1260750592537bd1dff154aad0e5cacd6482 binds unchanged dependency/source inputs and preserves the failed attempt. Combined local acceptance1851/SHA256eba0303e18971399b9eee90cf6ab1e86bd80d6ae5c206f6e822124c2ab830c9e verifies every referenced original. No TLS verification bypass, source edit or full-gate replay was used to resolve that environment failure.

Only owned status/evidence text changes after these code gates. Final diff, owned-document links, protected-prefix and secret checks precede commit. Source delivery still requires exact-final-head CI, the same reviewed merge tree and successful merged-main CI.
