# TASK-0005A — Shared archive primitives and generation 6 PENDING

Status: `SOURCE_PREPARATION / INDEPENDENT_REVIEW_PENDING`, 16 November 2026.
No installed recipe, archive migration, runtime authority or image admission.

## Trigger and bounded change

[PR 241](https://github.com/CleMeY15/auto-world/pull/241)
[quality run 43909367783](https://github.com/CleMeY15/auto-world/actions/runs/43909367783)
failed its two admission-closure checks because the scanner-retention feature
changed three frozen generation 5 modules. The first
reported mismatch was `scripts/seaweed-image/archive.mjs`; the downloader and
ZIP reader also differ. Two separate native bootstrap tests failed because the
ZIP reader eagerly loaded the scanner-only qualification inventory JSON.
The failed run remains failed and is not reinterpreted as environment-only.

The [ADR-0011 addendum](../decisions/ADR-0011-postgres-admission-runtime.md#2026-11-16-addendum--shared-archive-changes-and-generation-6-pending)
follows the generation 5 precedent: retain the complete old public inventory,
advance to generation 6 revision 1 PENDING, keep dates/current evidence null,
change only the generation/locator/three shared execution pins and authenticate
the complete new canonical root/revision chain. All 71 other execution pins,
image/build/material identities, old evidence and waivers remain unchanged.

Generation 5's original public inventory is retained at
`tests/fixtures/postgres-admission/generation-5-pending.json`: 24180 bytes,
SHA256 `555cade4a5dbd06beab070311d9006742ae7fe40d7c0346f11f4fe409b39f9e0`.
Its root remains
`3d89d49e344d58b03a7f82740fb58ea8bc437c7c08452ca83b39e5330784c282`,
and PENDING revision 1 remains
`b29eaef82bd2ab7f48020e23587512c5ddf7a9fedbc4f6ad269777890194660a`.
Generation 3 ACTIVE history and all generation 4/5 pending preparations stay intact.

## Private locator proposal

Read-only inspection of the retained WSL capsule located the original
generation 4 locator: 448048 bytes,
SHA256 `1b390c716c705d7c15fd01a888bb97bb21a4cea84d7af866eca32eb679956ed7`.
Its exact compact-JSON-plus-LF encoding was checked. Changing only its generation
to 5 reproduces the existing generation 5 public locator binding exactly:
448048 bytes/SHA256 `7ea3950a9de95e46bd0e7b613e293e8abb5788fe03a258034e27b6e6b71b9b07`.
Changing that sole field to 6 produces the private proposal:
448048 bytes/SHA256 `5b3adcf8e8497bd1c6072ba4c1123bb568ae8e2747e4b469a262a6381d1c25fc`.

Only that proposed metadata file is retained in ignored private workspace
storage. The source capsule and every original archive remain unchanged. No
native ownership, live filesystem tuple, restored object, installed locator or
VPS admission is inferred from the copied historical metadata. Public evidence
contains hashes and lengths, not private paths or native identities.

## Frozen generation 6 source

After completion of the shared-source fixes, the public inventory is 24477 bytes,
SHA256 `a4f628a491bc75d597c16743888c0b9ccdeaf502da24ef1787d7e8cf207012d5`.
The canonical root is
`695eb186f69faf1d4fb3fe653b5255c6d552b627fe1e123562310090eaf6e6d1`;
PENDING revision 1 is
`500ea501201afcb20c78c6e3bfaa1821b8408004c931e740fbc426274c27a5d0`.
Exactly these three execution pins change from generation 5:

| Shared module under `scripts/seaweed-image/` | Bytes | SHA256 |
| --- | ---: | --- |
| `archive.mjs` | 16131 | `8649d9702a222fc75fc2e2c2298a7ca3898cd023ceb98160d0f47b685572ec6b` |
| `download-artifact-zip.mjs` | 9610 | `3bd6b3121f842e5e7b690b166724e67fd840583e73897169a8d6462f92e1f41f` |
| `read-artifact-zip.mjs` | 30847 | `f476a7ae6475a6c8d998b44759b083f756392399464f85d763ee34e96c575116` |

Recalculation authenticates the complete original generation 5 fixture, verifies
the private proposal's exact canonical bytes and its reversed generation 5 hash,
reads all 74 source files, rejects any change outside those three modules, then
hashes the new root and revision using compact JSON plus a single LF. It appends
the preserved generation 5 summary and writes the new public inventory. No
evidence-producing command participates in this source calculation.

## Verification and delivery boundary

The inventory tests retain byte-exact generation 5 history and require the
three-pin-only transition, unchanged 71 pins, exact new locator binding and
PENDING/null evidence. Genuine Node 22 file-URL imports succeed from only
the 74 pinned files without the scanner-only profile JSON; existing missing-file
and mutation cases remain. Scanner ZIP intake still requires the fixed profile
bytes when explicitly selected. Native private-evidence and runtime-audit
bootstrap regressions must pass independently.

On the source bytes above, Node 22.23.2 passes the admission inventory,
execution-closure and authority suites: 10 top-level tests, no failures or skips.
ESLint passes both changed admission test files. These are source and isolated
loader tests; they do not install a recipe or inspect a native archive.

Independent source/digest review remains pending. The final commit must contain
these exact shared-module bytes and inventory: rerun the admission inventory and
execution-closure suites on that commit before treating its CI as delivery
evidence. If a shared module changes before delivery, recompute the PENDING
proposal and its recorded hashes and obtain review of the final bytes; never
rewrite the retained generation 5 fixture. Actual native observations require
their own execution and records.
Protected-main delivery, native generation 6 installation/activation, complete
archive health, current audits and final TASK-0005 acceptance remain separate.

Rollback abandons this PENDING proposal without touching installed generations,
old preservation duties, archive objects, support dates or runtime data. If a
future generation activates, rollback follows the existing append-only
revocation/greater-generation contract, not historical rewriting.
