# TASK-0005 — Gosu offline input reconstruction prerequisite

Status: `PLAN_REVIEW_PENDING / NO_IMPLEMENTATION_OR_PUBLICATION_AUTHORITY`.

## Brief and dependencies

Owner: TASK-0005 coordinator; branch `codex/task-0005-gosu-offline-inputs`,
base `7c49d34db9191db5459b0640c24b53fd24cbaf5b`, accepted through
[PR249's final checkpoint](https://github.com/CleMeY15/auto-world/pull/249#issuecomment-6966235450).
PR249 quality attempt 1 remains CANCELLED; acceptance uses attempt 2 and original
tooling attempt 1. The [M3A six-file measurement](TASK-0005-managed-retention-measurement.md)
and [scanner row closed by PR247](https://github.com/CleMeY15/auto-world/pull/247#issuecomment-6964012598)
remain separate accepted prerequisites. No prior plan approval transfers here.

Proposed result: `GOSU_OFFLINE_INPUTS_RECONSTRUCTED_SAME_TOOLCHAIN`.
This is a representation decision needed before the complete M3 capture design,
not that capture design itself. The existing [measurement index](../../docs/validation/TASK-0005-m3-material-measurements-20261117.md)
does not establish surviving payloads. The six proxy files have never been
proved sufficient to recreate the module trees used for Gosu compilation.

All roles use distinct Codex gpt-6-astra / ultra contexts. Parent owns the one
writer checkout; technical/contract research is read-only. Actual Architect,
then distinct Critic, must approve identical plan bytes before implementation.
This plan proposes no registry write, package change, SSH/Nexus operation,
retained-copy transfer or restoration. Costs and elapsed budget are unknown;
reassess after two failures without new evidence. No product UI or pilot entry.

## Decision and alternatives

Prove whether the fixed Gosu source archive and the six already measured proxy
payloads can reproduce the existing Gosu binary in the same pinned Go builder,
using a fresh source tree, module cache and build cache with network disabled.
Do not infer sufficiency from `go mod verify` against an already populated cache.

The preferred design is a sibling Dockerfile stage starting from the exact
existing Go-builder digest. A same-stage proof with new cache directories is
smaller, but leaves the original source and populated caches available in its
filesystem; it makes accidental reuse harder to rule out. A complete retained
PostgreSQL closure would be more useful operationally, but currently lacks
compiler/base/inherited-source inventories and capacity evidence. It cannot be
claimed by extending this narrow proof.

The result is conditional on the same compiler image and supplied recipes:
seven **data payloads**, not seven total environment files. The builder image,
comparison binary, exact `go.mod`/`go.sum`, measurement descriptor and fixed
helper are additional explicit dependencies. They are not silently counted as
retained or zero bytes. No promise that every `.info` file is read by Go; the
experiment establishes sufficiency of the selected set, not minimality.

## Closed inputs and stage boundary

Add `gosu-offline-reconstruction` in `infra/managed-images/Dockerfile.postgres`,
starting from the same literal Go Linux/amd64 digest as `gosu-build`.
It must not inherit from `gosu-build`, copy its extracted source/module trees,
or mount any cache. Copy only these explicit data and reference inputs:

1. The original 18,160-byte Gosu tar.gz at commit
   `29b939aa5bd4dc588af765b8248f6e39150d2565`, SHA256
   `2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51`.
2. The exact six `.info`/`.mod`/`.zip` payloads named by M3A, in their canonical
   file-proxy paths for `github.com/moby/sys/user@v0.4.1` and
   `golang.org/x/sys@v0.1.0`. No directory-wide cache COPY.
3. The same build's canonical `module-proxy-payloads.tsv`, for byte/hash binding.
4. Reference `/out/gosu` from the original build, mounted read-only only for
   comparison, not as a compiler input or as the output of this proof.
5. Tracked, exact `go.mod`/`go.sum` and the fixed reconstruction shell helper.

The helper accepts no caller-selected module, path, version or compiler. Its
fixed private working root must not exist initially; create separate source,
GOMODCACHE, GOCACHE, GOPATH, HOME and TMPDIR directories there. Reject an existing
root rather than cleaning or reusing it. The fresh module/build caches must be
empty before Go runs. References live outside the writable build root.

Before consumption, revalidate regular/non-symlink/single-link identity, byte
length and SHA256 of the source archive and all six proxy files against the
same-build descriptor. Reuse M3A's fixed six-row grammar, 16 MiB per file and
32 MiB total caps; require exact membership and ordering. Check identities
again after copying/consumption. Reject any extra payload path, missing entry,
changed bytes or noncanonical descriptor. The trusted, pinned archive is
extracted with the existing maintained tar tool, not a new archive parser.
The six historical hashes in the measurement index are observations, not new
lock pins: `.info` metadata can change upstream. Bind to this producer's exact
TSV and payloads, never to a historical TSV hash substituted as a future pin.

Extract into the fresh source directory. Its `go.mod` and `go.sum` must match
the tracked reference bytes and existing `MANAGED_GOSU_SOURCE` identities
**before** any local proxy download. Preserve both module and go.mod checksum
entries for each dependency; missing entries must refuse instead of allowing
Go to add trust. Preserve the originals after all commands as well.

## Offline execution and comparison

Execute the proof with Dockerfile `RUN --network=none`. Set `GOENV=off`,
`GOTOOLCHAIN=local`, `GOWORK=off`, `CGO_ENABLED=0`, `GOOS=linux`, `GOARCH=amd64`,
empty private/no-proxy/no-sum/flags overrides and explicit fresh directories.
Set `GOPROXY=file://` to the closed local payload root with **no fallback** and
`GOSUMDB=off`. The latter is already used by the accepted offline build; here
it is only acceptable with exact prevalidated `go.sum` and archive/proxy bytes.
Do not substitute a network proxy, checksum service or toolchain download.

Use the same pinned Go version and commands as the accepted build: local
`go mod download`, `go mod verify`, upstream `go test -mod=readonly -trimpath
-buildvcs=false`, and `go build -mod=readonly -trimpath -buildvcs=false
'-ldflags=-d -w -buildid='`. Preserve the existing truthful zero-upstream-test
count. Generate a new output in the fresh root; compare its bytes to the
original build's `/out/gosu` and existing pinned binary SHA256. Compare build
information against the existing source-bound contract. Any mismatch fails;
do not update the expected hash to accommodate it.

Required real negative controls use two separate fresh roots and their own
file proxies. After authenticating the complete seven-input set, copy only the
five intended proxy files into each negative proxy, withholding the ZIP for
one of the two fixed modules. Execute actual local `go mod download` against
that proxy in each control; require a nonzero exit whose bounded diagnostic
names the intended module/version and absent local ZIP, and no output binary.
An unrelated tool/compiler failure is not the expected refusal. The valid
positive proof must pass in the same stage. Neither negative control may reuse
the positive module/build cache. Closed-input validation separately rejects
missing inputs; that preflight refusal cannot substitute for these two native
dependency-acquisition refusals. Emit no success receipt until all three pass.

## Existing build graph and freshness

Keep the runtime binary COPY from `gosu-functional` and all existing Alpine
functional/process-replacement assertions unchanged. Make the final runtime
RUN depend on the reconstruction stage through a read-only BuildKit bind of
its success receipt, checking that receipt. It must not copy reconstruction
payloads or proof files into the final image. Export only the bounded text
proof through the existing `evidence` target.

Add `--no-cache-filter gosu-offline-reconstruction` to the **existing PostgreSQL
runtime solve only** in `scripts/scanner/official-audit.mjs`. No third solve,
new builder, global `--no-cache`, registry export or supposed read-only cache
extraction. The evidence solve can reuse the same-job result or execute again
on a cache miss; neither behavior is represented as a read-only export.
Actual source/main build logs must prove the reconstruction RUN executed in
the runtime solve rather than being `CACHED`. Keep the existing 90-minute
solve deadline and resource ownership/cleanup contract; no increased budget.

## Bounded public evidence and audit binding

Emit one new bounded text receipt, `offline-reconstruction.json`, only after
positive comparison and both required refusal controls pass. Canonical JSON
with a final LF, maximum 4 KiB, closed fields:

- `schemaVersion: 1`, `kind: "GOSU_OFFLINE_INPUTS_SAME_TOOLCHAIN_V1"`;
- `sourceArchiveSha256`, `modulePayloadsSha256` (SHA256 of the exact M3A TSV);
- `goModSha256`, `goSumSha256`, `compilerVersion`;
- `referenceBinarySha256`, `reconstructedBinarySha256`;
- `freshSourceAndCaches: true`, `network: "none"`;
- `missingZipRefusals`: the two fixed module/version identities in fixed order.

Canonical serialization uses the field order listed above, compact JSON with
no extra whitespace and one terminal LF. Refusal order is moby/sys/user then
x/sys; the strings are `github.com/moby/sys/user@v0.4.1` and
`golang.org/x/sys@v0.1.0`. The compiler version is the existing exact Go
version identity, not a new mutable lookup. The consumer reconstructs these
canonical bytes and compares them to the captured input.

No payload, environment dump, host path, credential or source tree is exported
publicly. Standard source-controlled code writes/validates the small receipt;
this is not a general archive/manifest controller. Its statements are trusted
only with reviewed recipe, executed native stage and same-job evidence, not
because booleans are present in JSON.

Add a separate `build.gosuOfflineReconstruction` projection in the existing
audit receipt. Read the captured public copy, check its exact captured
length/hash, closed fields and canonical form; bind its input TSV identity to
`build.gosuModulePayloads.evidence`, compiler/source/mod/sum/binary identities
to the existing pinned contract, and result to the same build subject/run.
Missing, altered, extra-field or mismatching evidence fails the PostgreSQL
build's evidence gate. Preserve `bindManagedGosuEvidence`,
`SOURCE_BOUND_GOSU_V1`, `official-controls.mjs`, evaluator, policy and support
dates unchanged. This is a new narrow observation, not a new authority.

## Implementation scope and acceptance

Limited to the PostgreSQL Dockerfile and its new fixed shell helper, the small
audit parser/call site and PostgreSQL-only runtime arguments, meaningful focused
tests/fixtures and affected exact-source guards, plus task/validation pointers.
No other service recipe, dependency, workflow permission, registry package,
scanner-retention tuple or Windows code change.

Required checks:

1. Actual production-helper fixtures verify source/proxy membership, shape,
   bounds and hash correspondence; missing/extra/reordered descriptors, wrong
   source/mod/sum, symlink/hardlink/non-regular/empty/oversized/changed input,
   nonempty work/cache root, output mismatch and false refusal controls reject.
   Fixture stubs may test boundaries but never count as actual compilation.
2. Parser tests bind captured bytes to the same build, TSV and source/binary
   identities; malformed/noncanonical/extra fields or substituted data refuse.
   Regressions preserve the old source-evidence schema/evaluator unchanged.
3. Command/graph tests prove the filter is PostgreSQL/runtime-only, stage
   dependencies reach runtime and evidence, no additional solve or payload
   export exists, and the original runtime binary/functional controls persist.
4. Real source and main managed runs prove fresh network-disabled positive
   reconstruction, two named refusals, byte equality and bounded captured
   evidence. Preserve all existing native/runtime/cleanup gates and exclusions.
5. Serialized lint, typecheck, root/package tests, build, secrets/full audit,
   required source/main quality/tooling/managed and other path-applicable gates
   pass; independent code/security/architecture and original-result reviews
   precede normal protected delivery and its exact-main acceptance.

No acceptance follows from test stubs, a cached stage, source-only CI or a
well-formed receipt alone. Stop on an unpinned/mismatching input, unexpected
download attempt, inherited/nonempty cache, binary mismatch, missing refusal,
unbound evidence or failed existing gate. Preserve failure evidence before
changing hypotheses; never relax the contract merely to obtain green results.

## Remaining gates and rollback

This establishes, at most, sufficiency of the selected Gosu data inputs with
the same supplied compiler image. It does not establish compiler/OS/base source
closure, a bit-reproducible compiler bootstrap, all PostgreSQL inherited sources,
source-to-binary equivalence of Rust helpers, durable capture, two private
copies, cold retained restoration, complete M3 inventory or capacity.

Complete capture design still needs all source/module/compiler/base
representations, production before runner teardown, manifests, two-copy survival
and restoration, missing measurements and fresh capacity with working headroom.
The existing ordered Architect/Critic gate before registry writes remains.
C:/NTFS stays the second-copy contract; eventual VPS migration is not inferred.
TASK-0005/0005A remain IN_PROGRESS, 243 raw upstream blockers unwaived, support
dates null and admission/final 17-phase acceptance open.

Rollback reverts this diagnostic proof addition and its observation field,
preserving the old source binder, receipts, archives, failures and other
worktrees. It performs no deletion, publication or copy/restoration.
