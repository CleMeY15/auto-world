# TASK-0005 — bounded manifest observation and quality setup amendment V1

Status DRAFT / NO IMPLEMENTATION GO for this amendment. Parent locked Go/S3 V2 plan b1e88e79f2c07411e97553383ae5c6ac9c949fcfaf89420684dff9a742e51990 remains approved; source571978804272c107c32d876c45065bc63813a3c5 is NOT ACCEPTED. No image construction, new OCI tool, parser/merger, publication or admission is selected.

## Observed failures and uncertainty

Managed40423745516/1 original acquired once and independently reviewed: nine prior phases pass, including 3 managed builds, 7 report pairs, five image audits, full Rust controls/source/helper gate. Pure536=535PASS/1knownSKIP, all20 new Node cases pass. New preflight refuses save_manifest_invalid before config/layer selection. Complete bound receipt: source confige953, Docker28.0.4/API1.48/Python3.12.3/GNUtar1.35, save536569344B/SHA b76c234e82dad09a8a7e7132e24fd0baba13e8435939a3490a30e320009d1ab0, unchanged inputs and archiveRemovedtrue. No qualifying layer-metadata observation or candidate/runtime exists. The receipt does NOT distinguish member/JSON/root/cardinality/exact-key predicates. Actual archive correctly removed, not reacquired or reconstructed.

Distinct Native causal review passes SAMEoriginal:16reports1736tests1688PASS48knownSKIP0FAILERROR, RED1expected and seeded3PASS, capture/JDK exact; externally verified sourcecheckout tree57552 and adapter50688961 bind mergec06b/head5719. This is diagnostic only.

Sourcequality40423745505/1 is CANCELLED by exact20minute job timeout. Lint14/types21/root2758PASS60SKIP/workspace624PASS/build14 allpassed; installer00:07:09–00:22:25 cancelled while APT downloaded dependencies. Browser/secrets/audit skipped, no browserartifact. Prior acceptedmain installer48s and browser8.7m. Rootcause mirror vsrunnernetwork remains unknown. No application test failed, but quality is PARTIAL_NOT_ACCEPTED.

## Primary-source facts, not actual-archive inference

Actual researcher inspected pinned Moby28.0.4: image/tarexport/tarexport.go20-26 manifestItem includes Config,RepoTags,Layers, optionalParent and LayerSources (notomitempty); save.go281-300 uses blobs/sha256 paths,326-368 emits oci-layout/index.json. Canonicaldigest parseNames has no repoTag; repoTags and LayerSources may serialize null. This shows the existing legacy-only assumption may be incompatible, but does NOT identify the actual failing predicate or actual saved key/path forms. Official Docker save does not promise the narrowly assumed legacy schema.

https://github.com/moby/moby/blob/v28.0.4/image/tarexport/tarexport.go
https://github.com/moby/moby/blob/v28.0.4/image/tarexport/save.go
https://docs.docker.com/reference/cli/docker/image/save/

## Decision and alternatives

First obtain bounded actual manifest-shape evidence using the SAME source-save lifecycle, standard tarfile/JSON reader, resource and cleanup guards. Do NOT accept a new envelope yet. Separately give quality dependency setup a measured bounded budget so full browser/security checks can run. Existing user autonomous development authorization covers this reversible diagnostic/CI repair; no additional permission handoff.

Alternative A, chosen: add technical shape evidence without changing any manifest/config/layer acceptance predicate. Smallest correction to the observed lack of diagnostic precision.
Alternative B: immediately accept presumed Moby28 fields/blob envelope. Primary source makes it plausible, but actual archive shape and reference closure are still unobserved. Defer until measured and separately reviewed finite compatibility amendment.
Alternative C: adopt another OCI tool now. No actual unsupported layer metadata has been established; unnecessary selection/maintenance. Defer DependencyExpert comparison until measurement proves existing tool cannot represent required semantics.

## Exact implementation scope and ownership

Python executor owns scripts/scanner/seaweed_profile_archive.py only. Add optional finite manifestDiagnostic on save_manifest_invalid or save_manifest_missing refusal; stdout JSON only, no output path/sidecar writer, raw JSON, archive extraction or TAR/header parser. Use current already-bounded stdlib outer inventory and bounded <=4MiB manifest read. Diagnostic <=2KiB canonicalJSON and strictly typed finite structure, no raw field values or unknown-key names:
- outer flags for exact oci-layout/index.json/repositories presence and any blobs/ prefix;
- member present/type, byte count and SHA256 where regular+readable;
- JSON parse state, root type, record count and first-record type where established;
- sorted presence of known Config/RepoTags/Layers/Parent/LayerSources, exact finite value-type tags;
- unknown key count and SHA256 commitment to sorted names, never raw names;
- Config path category legacy-config/oci-blob/other/absent, Layers count and counts by legacy-layer/oci-blob/other, RepoTags type/count, Parent type, LayerSources type/count. No string values/config/layer payloads.
If an earlier archive/size/JSON guard prevents some observation, use explicit not-observed/null fields; don't weaken the guard to collect evidence. Missing diagnostic cannot imply compatibility. Global integrity/finalization still overrides every metadata refusal; no qualifying refusal receipt on drift/process/cleanup failure.

JS executor owns scripts/scanner/seaweed-go-s3.mjs and minimal official-audit.mjs integration only. Strictly validate optional finite diagnostic keys/types/counts/hash/2KiB and allow it only on named manifest refusal. Existing full REFUSED receipt already binds source/tools/resources/archive/unchanged/cleanup; preserve it and corephaseFAILED. Never transform diagnostic into a pass or relax exact current manifest/config/layer predicates. Adapter may remain unchanged if nested proof flows through existing typederror/receipt. Preserve oldRustgate, all original role/control/source/helper reports and test/policy/GoJava byte guards.

Test engineer owns current two Go/S3 test files only. Independent tiny stdlib fixtures demonstrate member/invalidJSON/root/cardinality/missing/extra keys/null types and legacy-vsOCI path categories are distinguished while ALL remain refused under unchanged policy. Bound malicious/large/unknown names, key collisions/duplicates and output caps; no raw payload/localpath/unknown-name leakage; integrity and cleanup precede qualifying evidence. Existing 39Python/20Node tests remain; add only meaningful new behavior cases, no mirrored implementation.

Root owns .github/workflows/ci.yml budget-only repair, docs/validation/task/PR checkpoints, adapter SHA anchor if changed, Git/CI/integration and review transcription. Set job timeout20→45minutes and installer step timeout25minutes. Measured full normal postinstall browser takes8.7m plus security; 45 leaves a separate completion margin around the bounded25m setup and existing approximately5m prechecks. This accommodates measured slow package fetching without claiming a network rootcause fix. No command, dependency/version/action, cache, retry, browser/UX performance assertion, test exclusion, package source, privilege or secret handling changes. No new test just to mirror YAML numeric values; parse/diff and independent review plus fresh complete CI prove outcome. All native/export/database/profile operation budgets remain unchanged.

All owners are not alone and preserve others; no workers/tmux/goals/automations, no localDocker/Java/Gradle/Rust/scanner/provider. Root ownsGit/PR/CI. New external account/token/registry/signer/tool/dependency/parser/merger requires separate authorization/review, not this amendment.

## Verification, sequence and stop conditions

1. Actual Architect review of exact amendment then distinct actual Critic; durable approved handoff and PR publication/readback BEFORE code. No repeat userpermission request under existing autonomy.
2. Separate App-native implementation with stated owners; targetedNode/Python/WSL tests and lint/staticchecks; independent actual code/spec/security review 0openfindings. Retain original twofailedruns and exactreceivedfiles; no unchanged rerun or oldgreen transfer.
3. Push genuine changed diagnostic+budget code. Fresh exact-source quality/managed/upstream originals acquiredONCE/independentreviews. Sourcequality onlyaccepted if browser+security+auditactuallycomplete with0failure/flaky/retry and explicitknownskips. A larger budget alone is not success; actual fresh proof required. Managed remains honestly failed at unchanged manifestpredicate, now with actual boundedshape evidence, or another real prerequisitefailure.
4. Only after measuredshape, route a bounded finite Moby28 envelope-compatibility decision for actualArchitect/distinctCritic review. Standard JSON/tarfile reference inspection may fit existing tools, but no customdecompressor/headerparser/OCIchangesetmerger. Actual unrepresentablemetadata or necessary newtool goes DependencyExpert separately. Never silently accept inferred shape from officialsource alone.
5. No candidateconstruction until all relevant source preflight/qualification gates reallypass. No TaskDone/M2/admission/supportdate. B0 and complete source/notices/private-copy/signing/activation/final17 remain open.

Pre-mortem: (a) diagnostics accidentally allow a new envelope — unchanged acceptance predicates, negative OCI-likefixture and explicit failedphase; (b) JSON leaks payload/paths or oversized names — finite categories/counts/hashes only and2KiB/4MiB caps; (c) CI45m masks a hung installer or weakensquality — independent25m setup deadline, unchangedtests/performance/retries, noacceptanceuntilactualcompletefreshCI. Rollback: revert these diagnostic/budget changes, preserve originals/policy and ownedcleanup; no production/customerdata/registry changes.

## Handoff roster

Actual Architect then distinct Critic sequential, root integrator, executorPython, executorJS, test-engineer, actual code-reviewer, separate actual quality/managed/native verifiers. Max4active includingroot. App-native explicitexecution after terminalplanningapproval/publication; no inferred goal or unavailabletmux mode. This is a bounded amendment to the existing Go/S3 execution, not a replacement roadmap or new task.