# Node.js 22.23.4 narrow security patch — public plan candidate V7

Status: `RESOLVED_CANDIDATE_NOT_EXECUTABLE_PENDING_3_REVIEWS`

Architecture accepted directions A, B, and C as resolutions to V5's open branches; that is not approval of V5 or this V7. V7 is executable only after the exact document passes Dependency -> Architect -> distinct Critic with `CLEAR` verdicts. Until then it authorizes no tool execution, download, signature operation, source edit, legacy execution, Gosu rebuild, Native action, admission, activation, or support-date change.

## Goal and invariants

Move the current workspace and directly affected Gosu source guards from Node.js `22.23.2` to security patch `22.23.4`, keeping `pnpm@10.15.0` unchanged.

No Node 24/26 migration, new production dependency, override, historical rewrite, legacy runtime installation/replay, global process mutation, image admission, Native execution, activation, or support authority. No new exclusion, skip, reduced graph, relaxed assertion, or weakened gate. TASK-0005A/TASK-0005 remain `IN_PROGRESS`; downstream complete-descendant closure is unchanged.

## Delivery barriers

The PR193 foundation is merge `d9a2c348f2e605fa1de1b02c9619129c292b63a1`. The public implementation base must be the accepted main after PR194 delivery.

1. A documentation-only plan may be prepared after PR193 acceptance and coordination with PR194; it contains no runtime edit or preparation implementation.
2. This V7 must pass Dependency, Architect, then distinct Critic.
3. Phase 0 tool qualification may run only after all three `CLEAR` reviews and after PR194 release is coordinated.
4. Phase 1 Node authentication/download and Phase 2 private Windows preparation require independent acceptance of Phase 0 evidence.
5. Public runtime edits start only after PR194 is delivered and its exact accepted main SHA/tree are known.
6. The public patch requires independent final review, exact source-head CI, normal protected merge without bypass, then exact merged-main CI.

Any material base, scope, provider, tool identity, capability, trust-envelope, or classification change invalidates downstream reviews.

## NARROW public source scope

### Current workspace and guidance

Update only current guidance/contracts:

- `.nvmrc`;
- `package.json` Node engine;
- `tests/workspace-contract.test.mjs`;
- `README.md`;
- `apps/web/README.md`;
- `connectors/_sdk/README.md`;
- current workspace-toolchain instruction at `roadmap/tasks/TASK-0005A-managed-image-tooling.md:132`.

Move these current surfaces to Node `22.23.4`; keep every pnpm value `10.15.0`. Do not rewrite historical TASK-0005A entries that record past toolchains.

### Three binary contracts plus Observation V2

1. `scripts/postgres-image/gosu-retained-pair-controller-v1.mjs`: Linux path, version, bytes, SHA-256.
2. `scripts/postgres-image/gosu-retained-pair-worker-v1.mjs`: Linux path, version, bytes, SHA-256.
3. `scripts/postgres-image/gosu-derivative-image-daemon-v2.mjs`: Linux path, bytes, SHA-256, runtime version/path guard.
4. `scripts/postgres-image/gosu-derivative-image-observation-v2.mjs`: runtime version changes to `v22.23.4`; add no binary path/size/hash contract.

Update their four focused suites while preserving unrelated resource, import, identity, ownership, platform, and process guards.

### Admission source-compatibility test — decision A

`tests/postgres-image-admission-execution-closure.test.mjs` becomes `ACTIVE_PATCH` only as a current source compatibility test:

- change its unique host assertion to Node `22.23.4`;
- every real child it launches through the current `process.execPath` returns `observedNode: process.versions.node` in its bounded success result;
- assert every such child reports exactly `22.23.4`;
- label the test/evidence `SOURCE_COMPATIBILITY_ONLY`;
- preserve all 74 execution-file pins, every exact size/SHA, resource/import negative, no-write assertion, sorted/unique membership check, and generation-5 source bytes unchanged.

This test performs no Native action and changes no generation, policy, recipe, admission inventory, admission authority, or migration. There is no dual-runtime legacy CI lane.

### Legacy Gosu diagnostics — decision B

The two historical diagnostic cases in `tests/postgres-gosu-command-failure-v1.test.mjs` remain unit coverage without installing or replaying Node `22.23.2`:

- load the public source through independent `vm.SourceTextModule` contexts;
- provide a synthetic frozen `process.version === "v22.23.2"` only inside each VM context;
- invoke the real public `TEST_ONLY.main` unchanged;
- use a closed linker allowlist;
- deny native Go spawning and any unexpected child/process capability;
- label their evidence `SIMULATED_LEGACY_UNIT_ONLY`.

Do not mutate global `process`, install an old runtime, run the old CLI, or claim Native/legacy execution.

Add one separate current-runtime regression under real Node `22.23.4`:

- create a new private three-helper copy with the relative lock deliberately absent;
- launch one real current-Node child only;
- require exact `runtime_invalid`, empty stdout, and exit status 1;
- prove the runtime guard rejects before lock access or any Go/native spawn.

The public V1 main/helper sources remain unchanged by this test adaptation.

### Explicit exclusions and separate lanes

- Do not modify `scripts/postgres-image/admission-archive-observation.mjs` or its test; that immutable admission binding requires a separately reviewed generation-6 plan.
- Do not upgrade the three `setup-node` pins in `.github/workflows/gosu-derivative-preparation-v1.yml`. They and the V1 lock, receipt, builder, controls, and command bodies authenticate historical `actual11`.
- Do not rebuild Gosu or execute the legacy V1 workflow.
- A future source-build V2 is a separate reviewed plan.
- Context V2 is outside the direct controller/worker/daemon/Observation closure. Prove these patched paths contain no direct import, dynamic import, child invocation, callback route, or external dispatch to Context V2; do not claim Context V2 absent project-wide.

## Historical V1 workflow quarantine

Change only orchestration required to make V1 technically dormant:

- all three jobs use the exact JSON string value `"${{ false }}"` for `if`, never an ambiguous JSON boolean;
- all three `setup-node` values remain frozen at `22.23.2`;
- lock, builder, controls, receipts, historical command bodies, and authenticated identities remain unchanged;
- source tests require exactly three jobs, each with exact string deny-all, unchanged frozen pins/bindings, and no alternate dispatch path;
- reject enabled/missing/non-string conditions, changed pins/bindings, added jobs, partial quarantine, or workflow/receipt mixtures.

Quarantine denies future execution; it does not replay, repair, supersede, reinterpret, or secure the historical fleet.

## Exhaustive public classification

Root's private V1 inventory is a historical draft with open decisions. It is not the updated actual classification for V6.

The predecessor classification planned `334` occurrences across `209` public files with amended totals:

- `42 ACTIVE_PATCH`, adding the admission execution-closure host entry;
- `6 DORMANT_DENY`;
- `100 SEPARATE_LANE`;
- `186 FROZEN_HISTORICAL`.

The 334/209 and 42/6/100/186 numbers describe only the exact reviewed predecessor d11908f42813f5c6c434e0630f174b271a5e0655, which already includes this PR initial plan. They are historical baseline measurements, not invariants of later commits. After PR194 delivery and before an engine edit, generate a new inventory from the exact accepted implementation base and publish a compact table. Derive its actual totals from that tracked public tree; account explicitly for every added, removed or moved occurrence compared with the predecessor. Each row contains repository-relative file, exact lines/occurrences, exactly one category, justification, and intended action/preservation rule.

Closed categories:

- `ACTIVE_PATCH`: current workspace/guidance, C/W/D/O, their focused tests, and source-only admission closure compatibility;
- `DORMANT_DENY`: quarantined V1 workflow/test and synthetic legacy diagnostic occurrences;
- `SEPARATE_LANE`: generation 6, source-build V2, or another reviewed future increment;
- `FROZEN_HISTORICAL`: retained documentation, receipt, lock, builder, control, or evidence.

Require exhaustive coverage of the actual inventory, no missing line, duplicate category, unknown or unjustified action. A changed count alone is not a contract violation: evidence-only document additions can be classified with their exact source binding and disclosed delta. A new runtime guard, changed execution dependency, altered frozen profile or expanded patch scope stops and requires review before source mutation. No global replacement. Classification proves public source disposition only; it does not prove the legacy fleet secured.

## Official Node inputs

Use only `https://nodejs.org/dist/v22.23.4/`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `node-v22.23.4-win-x64.zip` | `35604229` | `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20` |
| `node-v22.23.4-linux-x64.tar.xz` | `31029996` | `1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce` |

Pin Node release-key commit `5b7f55f4a7e35d1176d27a6b81b0c3c3b794216b`. Authorized primary fingerprint:

`5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`

Key blob:

`https://raw.githubusercontent.com/nodejs/release-keys/5b7f55f4a7e35d1176d27a6b81b0c3c3b794216b/keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc`

Expected key blob: `924` bytes, SHA-256 `5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a`.

No GPGV or Node `22.23.4` executable has been run under this plan. Extracted binary sizes/hashes remain unknown until authorized derivation.

## Phase 0 — local trusted-toolchain qualification, decision C

Phase 0 starts only after three `CLEAR` reviews. Invariant:

`NO_NODE_KEY_MANIFEST_DOWNLOAD_NO_SIGNATURE`

It must not download the Node key, publisher snapshots, checksum manifest, or archives and must not verify a signature.

Selected provider/trust model:

- provider: `EXISTING_ADMIN_MANAGED_GIT_FOR_WINDOWS`;
- provider class: `TRUSTED_TOOLCHAIN_PROVIDER`;
- trust basis: `LOCAL_TRUST_BASE`;
- installed product basis: pre-existing administrator-managed Git for Windows `2.55.0.windows.3`;
- `officialSignedBundleReproduction: NOT_ESTABLISHED`;
- scope: local/private preparation only.

This trust model does not claim the Git installation is officially authenticated, reproduced from an official signed bundle, uncompromised, or safe against a compromised OS/administrator. Threat exclusions are OS/admin compromise and a malicious pre-existing installation. If local identity checks are ambiguous, stop.

Qualify the existing GPGV tool with bounded version/capability queries and exact measurements:

- executable bytes and stable native identity;
- complete required DLL closure hashes/identities;
- absolute ancestor identities, owners, ACLs, types, reparse-point absence, and stability;
- bundle/product provenance consistent with the pre-existing admin-managed installation;
- required options/capabilities and exact invocation semantics;
- empty controlled working directory, controlled environment/PATH, explicit keyring, and no default configuration/network/agent path;
- pre/post stability of executable, DLLs, ancestors, owners, ACLs, and reparse properties.

Do not require comparison with an official or signed Git bundle. Do not convert the local trust basis into an official provenance claim.

Retain a bounded receipt containing at least:

```text
status=TOOL_PROFILE_READY_NO_DOWNLOAD_NO_SIGNATURE
provider=EXISTING_ADMIN_MANAGED_GIT_FOR_WINDOWS
providerClass=TRUSTED_TOOLCHAIN_PROVIDER
trustBasis=LOCAL_TRUST_BASE
officialSignedBundleReproduction=NOT_ESTABLISHED
```

An independent reviewer must accept the exact receipt before Phase 1. Any qualification-to-use drift in executable, DLL closure, ancestor, owner, ACL, reparse state, product identity, version, or capability invalidates the receipt and stops before download.

## Phase 1 — publisher evidence, signature, and archives

After Phase 0 acceptance, derive one explicit binary keyring from the exact pinned armored Node key using reviewed standard-library strict Base64 plus RFC 4880 CRC-24 validation. Use no default keyring/configuration/network/agent.

Resolve these two official moving sources to commits, then use immutable commit URLs and record commit, content SHA-256, and observation timestamp:

- `nodejs/release-keys` main README;
- `nodejs/node` main README.

Both immutable snapshots must identify the exact primary fingerprint as active/authorized and not retired and match the pinned armor. From the older snapshot observation through the signature decision, elapsed time is at most 15 minutes in one bounded envelope; this is not a global TTL. Stale, divergent, ambiguous, retired, or mismatched evidence denies.

GPGV does not enforce publisher-key expiration/revocation semantics for this decision. The three reviews must explicitly accept this closed publisher-authorization model; never claim cryptographic proof that the key is unrevoked.

Verify and extract `SHASUMS256.txt.asc` in one GPGV invocation using `--status-fd 1`, the explicit keyring, and a nonexistent output path inside a new exclusive directory. Require a new stable regular non-reparse output with bounded full readback.

Closed status contract:

- exit zero and complete stream closure;
- exactly one terminal signature outcome and it is `GOODSIG`;
- exactly one `VALIDSIG` with the authorized primary fingerprint;
- no second signature context;
- if `NEWSIG` is emitted, exactly one; require it only if Phase 0 capability profiling contractualizes it;
- reject `BADSIG`, `ERRSIG`, `EXPSIG`, `EXPKEYSIG`, `REVKEYSIG`, `KEYREVOKED`, `NO_PUBKEY`, `FAILURE`, unknown security status, duplicate/conflicting fingerprint;
- `TRUST_*` is bounded non-decision metadata only; never use always-trust, UID/key-ID trust, or `GOODSIG` alone.
- assess completion only after the status stream closes. After the single `GOODSIG`/`VALIDSIG` result, allow only bounded recognized non-decision metadata belonging to that same signature context, including `TRUST_*`, `ASSERT_SIGNER`, `KEY_CONSIDERED`, and `SIG_ID`; reject any later `NEWSIG`, terminal `*SIG` outcome, `VALIDSIG`, conflicting fingerprint, error/failure, or unknown security-relevant status.

Require verified signed text to bind the two exact archive names to expected SHA-256 values. Prove each archive URL, bytes, physical EOF, SHA-256, stable identity, and complete readback. Recheck the entire Phase 0 identity envelope before and after GPGV use.

## Phase 2 — private Windows preparation

Use a new exclusive Windows workspace.

1. Extract the Windows ZIP to a new fixed destination; reject absolute/traversal paths, duplicates, collisions, links/reparse points, unexpected types, budget overflow, or outside writes.
2. Derive actual `node.exe` bytes/SHA-256. Run only that new controlled Windows executable with `--version`; require `v22.23.4`. Do not activate Corepack or alter global `PATH`.
3. Do not extract the whole Linux archive. With standard-library `tarfile`, require exactly one regular `node-v22.23.4-linux-x64/bin/node`; stream it to a new fixed file and prove EOF, size, SHA-256, stable readback. Reject duplicate, link, traversal, sparse/special/type, trailing, or budget ambiguity.
4. Treat the Linux member only as data: no deployment, WSL/Linux copy, installation, or execution.
5. Retain a bounded non-secret `TOOLCHAIN_CANDIDATE_ONLY_NO_NATIVE_AUTHORITY` receipt binding reviews, Phase 0 local trust basis, publisher evidence, signature result, archives, derived pins, and Windows version.

Independent receipt acceptance precedes public edits.

## Public implementation after PR194 delivery

On accepted post-PR194 main:

1. generate and publish/review the exhaustive inventory for the exact accepted implementation base, with measured totals and a complete delta from the historical 334/209 predecessor;
2. add exact-string deny-all quarantine to the three V1 workflow jobs while preserving frozen Node pins and historical bindings;
3. update current workspace/guidance surfaces;
4. update C/W/D binary contracts from one accepted Linux-member pin;
5. update Observation V2 runtime version only;
6. implement source-compatibility decision A in the admission closure test;
7. implement simulated-legacy/current-runtime decision B in command-failure tests;
8. update only the four focused C/W/D/O suites with meaningful positive/refusal cases;
9. add C/W/D/O no-direct/dynamic-Context-V2 proof;
10. preserve admission archive observer, setup-node pins, legacy lock/builder/controls/receipts, generation-5 source, and every frozen/separate-lane entry.

No deliverable commit may mix old/new version, path, bytes, or hash. No global replacement.

## Verification

Run targeted checks then all gates on one source head:

- Phase 0 receipt and qualification-to-use drift: executable, DLL, ancestors, owners, ACL, reparse, product identity, version, capabilities;
- strict armor/keyring conversion, official snapshot 15-minute boundary, stale/divergent denial, closed signature status parser;
- archive/extraction negatives: duplicate, link, traversal, type, size, hash, EOF, stability;
- exact actual-tree inventory completeness/category totals and every disclosed delta from the historical predecessor;
- V1 workflow exact string `"${{ false }}"`, three-job dormance, and mixed lock/receipt/builder/control/pin rejection;
- workspace contract and current guidance consistency;
- four focused C/W/D/O suites with negatives matching actual guards;
- admission closure `SOURCE_COMPATIBILITY_ONLY`: current host, observed child Node, unchanged 74-pin graph/SHA/resources/import negatives/no-write/generation-5 source;
- command-failure `SIMULATED_LEGACY_UNIT_ONLY`: isolated VM processes, linker allowlist, Go/native spawn denial, unchanged `TEST_ONLY.main`;
- current Node private-copy regression: exact `runtime_invalid`, empty stdout, exit 1, no lock/native access;
- C/W/D/O Context V2 no-call/dynamic-dispatch regression;
- frozen-lockfile install with Node `22.23.4` and Corepack/pnpm `10.15.0`;
- lint, typecheck, unit/integration tests, build, secrets, current vulnerability audit;
- UI interactions, accessibility, representative viewports, expected-skip accounting;
- lockfile/diff review proving no dependency, override, policy, historical, admission, generation, or separate-lane drift.

Linux CI must prove Node `v22.23.4` and exact configured C/W/D path/bytes/SHA matching the Windows-derived member. This is source/contract CI, not Gosu rebuild, legacy runtime execution, Native action, or admission.

## Delivery, rollback, and stop rules

Delivery requires independent final review, exact source-head CI, protected merge with matching head/no bypass, exact merged-main CI, and a bounded record binding commit/tree, run/attempt, classification, tests, audit, quarantine, provider trust receipt, signature evidence, archives, and derived pins. Activation/support/archive dates remain `null`.

Before merge, failure leaves the branch unmerged and candidates inert. After merge, a defect requires reviewed revert with Native disabled. Never silently fall back to `22.23.2`, overwrite toolchains, execute frozen workflow jobs, install old Node, or delete retained material.

Stop if any of the three reviews is not `CLEAR`, Phase 0/1/2 evidence is missing, local provider identity is ambiguous, qualification drifts, publisher snapshots are stale/divergent, the actual-tree inventory is incomplete or contains an unreviewed runtime/scope delta, workflow quarantine is partial, frozen material changes, admission/generation policy changes, a real guard is relaxed, an exclusion is added, a targeted/full gate fails, or exact source/main CI fails.

All V5 open branches are resolved by A/B/C above. Until the exact V7 passes Dependency -> Architect -> distinct Critic and Root promotes it, it remains `RESOLVED_CANDIDATE_NOT_EXECUTABLE_PENDING_3_REVIEWS`.
