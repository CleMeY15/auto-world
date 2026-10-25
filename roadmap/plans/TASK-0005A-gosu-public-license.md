# TASK-0005A - distinguish authenticated public licenses from generated private data

Status: PLAN_REVIEW_PENDING. Owner: infrastructure preparer. Base: accepted PR166 main75ca260c49510236cfbaa2e79f61e344ea3dd073/treea4179818ebcaea613f8dbd078997c5a93cecbc0e. TASK0005A/0005 remain IN_PROGRESS; TASK0104 remains BLOCKED.

## Problem and evidence limits

New actual10 run38473597270/attempt1/manual main failed both build jobs; comparison skipped and artifacts0. Original capture is retained once under .omx/gosu-real-preparation-run38473597270-v5. Its17152-byte ZIP/SHA256ce5b022d90d0eab0204af85f7905d7d55f1e44838fee52be21d3aab7b531b3da contains two821-byte preparation step logs, each with only gosu_public_private_data_invalid and no child/cleanup marker. Provider step metadata is incomplete/inconsistent; do not fabricate statuses. The exact historical failing file, Go execution, cleanup success, preparation/admission and support authority remain NOT_ESTABLISHED.

Current validateSemanticDocuments first authenticates six LICENSE/PATENTS bodies against lock identities. Later validateRetainedEntries applies assertNoPrivateText to these authenticated upstream texts. The Windows-drive pattern also matches a substring in http:// and https://. A separate current-source VM diagnostic rejects the exact11358-byte Gosu upstream LICENSE (SHA256cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30). This establishes a code defect, without claiming runner-level cause or provenance.

## Smallest complete correction

Only the six exact keys from existing expectedLicenseIdentities(lock), after successful existing semantic/hash validation, are excluded from the generated-text privacy scan. No prefix/directory exception. licenses/notices.json and every generated document retain the exact current privacy regex and validation order. License identities/content, lock authority, receipts, public allowlist, public exports, helper closure, dependencies, workflows, compiler/modules, builder/offline and diagnostic packets remain unchanged. A modified/missing/renamed license must still fail before reaching the privacy scan.

Owned source: scripts/postgres-image/gosu-derivative-controls-v1.mjs (one final-loop condition); tests/postgres-gosu-public-license-v1.test.mjs (new); tests/fixtures/gosu-public-license/ (four deduplicated public LICENSE/PATENTS files, exact lock hashes, source URL manifest); .gitattributes (byte preservation for those fixture files); this plan; docs/validation/TASK-0005A-gosu-public-license.md; ADR0015 plus decisions/README.md and roadmap/DELIVERY.md checkpoint. All other base933 paths remain byte/mode preserved. No public UI change.

## Test strategy and acceptance

Before production editing, run a bounded VM harness against REAL current retained-validation functions and exact lock-authenticated license fixtures, with non-license receipt/archive scaffolding explicitly synthetic and all process/network/filesystem writes denied. Preserve a semantic RED for complete authenticated license acceptance; harness errors are not RED. Test every exact license key, mutated byte/hash, missing license, extra/renamed license, and private markers in generated documents including licenses/notices.json. Existing privacy regex and receipt/control filters must remain byte-identical. Tests never execute Go/Gosu, source/compiler tools, privilege/namespace operations, downloads or archive extraction. Fixture retrieval is a separate bounded official-public-text collection, hash checked before fixture use; no network during tests.

Run pinned Node22.23.2 on Windows and ordinary Linux targeted tests, then lint/typecheck/test/build/secrets/audit with nonzero Turbo tasks and truthful exclusions/cache reporting. Record immutable base/final source identities and targeted/full raw outputs. Independent architecture/critical review precedes edits; independent source/privacy/evidence review and exact final-head CI, identical reviewed main tree and protected-main CI precede any distinct actual11. Source delivery alone establishes no preparation or admission.

## Operation and rollback

Existing fixed failure diagnostics/observability remain unchanged. Revert this focused source increment for rollback; no migration, activation or new configuration. Preserve all originals and failed drafts. Never retry/redownload actual runs38192612138,38194957502,38200213629,38204301387,38209201492,38214245572,38227184667,38432916399,38449087110,38473597270. Native/publisher/admission/support/currentEvidence and the one-calendar-year support plus continuous security policy remain untouched. Actual preparation, reproducibility, functional/vulnerability clearance, supported services and downstream roadmap gates stay separate.
