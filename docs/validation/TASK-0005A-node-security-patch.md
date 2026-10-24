# Node.js 22.23.4 security patch — preparation and source update plan

Status: `PROPOSED_NOT_EXECUTABLE`

Scope: [TASK-0005A](../../roadmap/tasks/TASK-0005A-managed-image-tooling.md), with immutable execution bindings governed by [ADR-0011](../decisions/ADR-0011-postgres-admission-runtime.md).

Proposed implementation plan. No download, signature operation, tool preparation or runtime-pin edit is authorized before the ordered review gates below. It grants no Native execution, admission, activation or support-date change.

## Goal and fixed scope

Upgrade active workspace and PostgreSQL/Gosu contracts from Node.js `22.23.2` to security patch `22.23.4`, keeping `pnpm@10.15.0` unchanged.

No Node 24/26 migration, package-manager change, new production dependency, integrity/test/platform override, historical global replacement, Native/Docker/registry/admission/activation/support authority. TASK-0005A/TASK-0005 remain `IN_PROGRESS`; source delivery advances neither admission nor complete-descendant closure.

## Current delivery boundary

The accepted base is PR193 merge `d9a2c348f2e605fa1de1b02c9619129c292b63a1`, tree `f14f21175f67bfbbd824ba25d4d4005747ee954a`. Reviewed source `7ccff31e0079f70ce0dcfc14e5345fd924c71575` passed [source CI40046726091 attempt1](https://github.com/CleMeY15/auto-world/actions/runs/40046726091); the merge passed [main CI40048170615 attempt1](https://github.com/CleMeY15/auto-world/actions/runs/40048170615). Independent final acceptance is `PASS_CONTEXT_DIRECTORY_SOURCE_DELIVERED_ON_MAIN_ONLY`, recorded in [the delivery checkpoint](https://github.com/CleMeY15/auto-world/pull/193#issuecomment-6378130106). The PR194 freeze was released after that acceptance; public Node engine changes remain held until its separate delivery.

Two distinct PR194 barriers apply:

1. **Private Windows preparation** may start only after PR193 is accepted, release of the PR194 freeze is explicitly **coordinated**, and Dependency -> Architect -> distinct Critic have each returned `CLEAR` on the exact plan.
2. **Public engine changes** may start only after PR194 is **delivered** and its accepted main SHA/tree are known.

A documentation-only plan PR may follow PR193 acceptance before PR194 delivery, but contains no engine, workflow, contract, test-pin, or preparation implementation. A material base, tool, contract, or trust-model change invalidates downstream reviews.

The Windows preparer source contract is currently assessed `CLEAR`; this is not preparation or execution authority. The cryptographic profile remains conditional on the gates below.

## Official immutable inputs

Use only `https://nodejs.org/dist/v22.23.4/`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `node-v22.23.4-win-x64.zip` | `35604229` | `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20` |
| `node-v22.23.4-linux-x64.tar.xz` | `31029996` | `1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce` |

Pin the Node release-key repository at commit `5b7f55f4a7e35d1176d27a6b81b0c3c3b794216b`. Authorized primary fingerprint:

`5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`

Key blob URL:

`https://raw.githubusercontent.com/nodejs/release-keys/5b7f55f4a7e35d1176d27a6b81b0c3c3b794216b/keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc`

Expected key blob: `924` bytes, SHA-256 `5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a`.

No GPG, GPGV, or Node.js 22.23.4 executable has been run. Extracted `node.exe` and Linux `bin/node` sizes/hashes remain unknown until authenticated derivation.

## Shared cryptographic result contract

Whichever profile is selected must verify the clear-signed `SHASUMS256.txt.asc` and write the verified clear text in the same invocation. Use a dedicated machine-readable status stream. `--output` must name a nonexistent path inside a newly created caller-only exclusive directory; exclusivity applies to the directory/lease, not to pre-creating the file. Fail if the path exists before invocation, and after success require a new regular non-reparse file with stable identity, bounded size, full hash, and complete readback.

Parse status as a closed state machine:

- exit code must be zero and all streams must close completely;
- exactly one terminal signature outcome from `GOODSIG`/`BADSIG`/`ERRSIG`/`EXPSIG`/`EXPKEYSIG`/`REVKEYSIG` is allowed, and it must be `GOODSIG`;
- exactly one `VALIDSIG` is required, with the exact authorized primary fingerprint;
- a second signature context is forbidden;
- if `NEWSIG` is emitted, exactly one is allowed; require `NEWSIG` unconditionally only when the reviewed capability profile contractualizes its emission;
- reject `BADSIG`, `ERRSIG`, `EXPSIG`, `EXPKEYSIG`, `REVKEYSIG`, `KEYREVOKED`, `NO_PUBKEY`, `FAILURE`, unknown terminal signature results, duplicates, or conflicting fingerprints;
- assess completion only after the status stream closes. After the single `GOODSIG`/`VALIDSIG` result, allow only bounded recognized non-decision metadata belonging to that same signature context, including `TRUST_*`, `ASSERT_SIGNER`, `KEY_CONSIDERED`, and `SIG_ID`; reject any later `NEWSIG`, terminal `*SIG` outcome, `VALIDSIG`, conflicting fingerprint, error/failure, or unknown security-relevant status;
- log `TRUST_*` as bounded non-decision metadata only; never use `--always-trust`, an always-trust model, UID trust, short/long key ID, or `GOODSIG` alone as authorization.

Hash and fully read back the verified clear text before parsing the two exact archive records. Status text and diagnostic stderr never become signed content.

## Primary profile: controlled GPG

Dependency review must privately pin the executable, official or signed-bundle provenance, required libraries, version, bytes, ancestors, ACL/reparse properties, and stability. Resolve by pinned absolute identity, never ambient `PATH`.

Before use, verify all required options through capability output. Use an empty working directory, controlled environment, unique empty private home, explicit streams, and:

- `--no-options`, `--batch`, `--no-tty`;
- `--no-auto-key-retrieve`, `--no-auto-key-import`, disabled automatic key location;
- `--disable-dirmngr`, `--no-autostart`;
- `--exit-on-status-write-error`;
- `--assert-signer` when the reviewed version supports it.

Reject configuration, old/default keyrings, agents, network helpers, proxies, unstable parents/libraries, unsupported options, or status shapes outside the shared contract. `TRUST_*` cannot change the verdict.

## Conditional fallback: controlled GPGV

GPGV is selectable only if Dependency pins an official distribution or officially signed bundle plus exact executable, DLL, parent, ACL/reparse, provenance, version, capability, byte, and stability identities to the same standard as GPG. Use one explicit binary keyring, disabling default keyrings; expose no configuration, network, dirmngr, or agent path.

Derive the binary keyring from the exact pinned armored blob using reviewed standard-library code with strict Base64 decoding and RFC 4880 CRC-24 verification. Reject extra armor blocks, malformed headers, trailing data, CRC mismatch, empty output, or unstable readback.

GPGV must follow the shared single-invocation contract with `--status-fd 1` and the nonexistent output path inside the caller-only exclusive directory described above. GPGV does not enforce expiration or revocation for this publisher-authorization decision; therefore never call its result cryptographic proof that the key is unrevoked.

Immediately before use, pin commit, content SHA-256, and retrieval timestamp for both official sources:

- `https://github.com/nodejs/release-keys/blob/main/README.md`;
- `https://github.com/nodejs/node/blob/main/README.md`.

Both snapshots must independently classify the exact primary fingerprint as currently authorized/active and not retired, and must remain consistent with the exact original armored key blob. Missing, stale, conflicting, ambiguous, or retired status stops the fallback.

Architect and then distinct Critic must explicitly accept this closed Node publisher-authorization semantics despite GPGV's expiration/revocation limitation. Otherwise use the approved GPG profile or stop; never weaken the fallback.

## Private Windows preparation

Run only after PR193 acceptance, coordinated PR194 release, and three ordered `CLEAR` reviews, in a new exclusive Windows workspace using existing bounded stream/hash/readback patterns.

1. Authenticate the pinned key blob, signed checksum manifest, and both exact archives with the selected profile.
2. Require verified signed text to bind the two exact archive names to expected SHA-256 values.
3. Read archives with bounded streams, physical EOF, exact byte count, full SHA-256, stable identity, and complete readback before extraction.
4. Extract the Windows ZIP to a new fixed destination; reject absolute/traversal paths, duplicates, collisions, links/reparse points, unexpected types, budget overflow, or outside writes.
5. Derive actual `node.exe` bytes/SHA-256. Run only that new controlled Windows executable with `--version`; require exactly `v22.23.4`. Do not activate Corepack or alter global `PATH`.
6. Do not extract the whole Linux archive. With standard-library `tarfile`, require exactly one regular `node-v22.23.4-linux-x64/bin/node`; stream it to a new fixed file and prove EOF, output size, SHA-256, stable readback. Reject duplicates, non-regular/link/traversal/sparse/special ambiguity, trailing or budget violations.
7. Treat the Linux member only as data: do not deploy, install, copy to WSL/Linux, or execute it. Linux version is validated later by source contract and CI.
8. Retain a bounded non-secret receipt binding reviews, selected signature profile, official inputs, status verdict, archives, derived pins, Windows version, and `TOOLCHAIN_CANDIDATE_ONLY_NO_NATIVE_AUTHORITY`.

Independent receipt acceptance precedes every public engine edit.

## Public patch after PR194 delivery

Reconfirm active inventory on accepted post-PR194 main, then update atomically:

- `.nvmrc`, `package.json`, and `tests/workspace-contract.test.mjs` to Node `22.23.4`, preserving `pnpm@10.15.0`;
- exactly three `setup-node` values in `.github/workflows/gosu-derivative-preparation-v1.yml`;
- four binary contracts and focused tests:
  - retained-pair controller: Linux path, version, bytes, SHA-256;
  - retained-pair worker: Linux path, version, bytes, SHA-256;
  - derivative-image daemon: Linux path, bytes, SHA-256, runtime version/path guard;
  - admission archive observer: Linux path, bytes, SHA-256;
- Observation V2 Linux/runtime guard to `process.version === "v22.23.4"`, without adding a binary path/size/hash contract.

Use one accepted preparation receipt. Never mix new version with old path/hash or old version with new pins. Preserve unrelated guards.

Tests must match controls actually present:

- controller/worker host-guard positive and refusal behavior;
- daemon VM fixture plus runtime version/path refusal;
- admission observer path/size/SHA substitution rejection, without inventing a version field;
- Observation V2 success at `v22.23.4` and explicit different-version refusal, without adding a binary pin.

Search bounded active scope for residual `22.23.2`. Exclude historical docs, ADRs, retained evidence, frozen recipes, and private actor pins.

## Verification and delivery

Run targeted tests then all gates on one source head:

- signature-profile state-machine and fail-closed cases;
- key armor/keyring conversion tests for the selected profile;
- archive parser/extraction tests: duplicate, link, traversal, type, size, hash, EOF, stability;
- workspace contract, four binary-contract suites, Observation V2 suite, meaningful negative guards;
- frozen-lockfile install with Node `22.23.4` and Corepack/pnpm `10.15.0`;
- lint, typecheck, unit/integration tests, build, secrets, current vulnerability audit;
- UI interactions, accessibility, representative viewports, expected-skip accounting;
- lockfile/diff review proving no dependency, override, or policy drift.

Linux CI must prove `process.version === "v22.23.4"` and exact configured path/size/SHA matching the Windows-derived member. This is no local Linux installation or Native authority.

Delivery requires independent final diff review, exact source-head CI success, normal protected merge with matching head/no bypass, exact merged-main CI success, and a bounded delivery record binding commit/tree, run/attempt, tests, audit, signature evidence, archives, and derived pins. Activation/support/archive dates remain `null`.

## Rollback and stop rules

Before merge, failure leaves branch unmerged and candidate inert. After merge, a defect requires reviewed revert with Native disabled. Never silently fall back to `22.23.2`, overwrite old toolchains, or delete retained material.

Stop if:

- delivery/coordination order is incomplete;
- any ordered review is not `CLEAR`;
- tool provenance, capabilities, libraries, ancestors, official publisher authorization, or status semantics are ambiguous;
- status differs from the exact single-signature contract;
- archive URL/name/size/SHA/type/stability differs;
- the unique Linux member is not exact and regular;
- derived pins are missing/inconsistent or Windows version differs from `v22.23.4`;
- a guard is relaxed, contract mixed, targeted/full gate fails, or exact source/main CI fails;
- the diff touches historical/private/Native material or adds an unapproved dependency.

Root must verify current repository/GitHub state, publish the exact plan, and obtain ordered reviews. Until then: `PROPOSED_NOT_EXECUTABLE`.
