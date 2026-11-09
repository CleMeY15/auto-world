# TASK-0005 — M3A Gosu module-proxy payload measurement

Status: `PLAN_APPROVED / IMPLEMENTATION_READY`.

Actual Architecture APPROVE followed by distinct Critic APPROVE on 9 November
2026 for the 8,732-byte candidate SHA-256
`b238d618f980d8fc38364d2e4d5def830bee91031d5394db68d46e34299fd87f`.
This status note changes no scope or prerequisite. Diagnostic M2 is accepted
on protected main `eb720fc67f2e9ae1311497fb52824e168cf0020e` through the
[PR236 final checkpoint](https://github.com/CleMeY15/auto-world/pull/236#issuecomment-6747949881).

Proposed goal: `GOSU_MODULE_PROXY_PAYLOADS_MEASURED`.

This is the smallest feasible M3 increment after diagnostic M2. Its prerequisites
are now satisfied: accepted diagnostic M2 and actual Architect approval followed
by distinct Critic approval of the exact plan candidate identified above.

## Result and limits

Measure the six module-proxy files already downloaded for the two fixed Gosu
dependencies used by the PostgreSQL managed recipe:

| Module | Version | Kinds |
| --- | --- | --- |
| `github.com/moby/sys/user` | `v0.4.1` | `.info`, `.mod`, `.zip` |
| `golang.org/x/sys` | `v0.1.0` | `.info`, `.mod`, `.zip` |

The increment records their actual byte lengths and SHA-256 digests. It does
not retain the files, prove complete source closure, establish restoreability,
capacity, publication, admission, either private copy or support dates.

The existing 18,160-byte Gosu source archive remains bound by its current
length and SHA-256 checks. It is not duplicated as a seventh measurement row.
Existing image/archive, database, scanner and source measurements need no new
code in this increment.

## Production placement

Extend the first existing `gosu-build` `RUN` in
`infra/managed-images/Dockerfile.postgres`. Generate the measurement only after
`go mod download -json all` and `go mod verify` succeed, and before the later
network-disabled test and compile `RUN`.

Read only these six fixed cache paths beneath `GOMODCACHE`:

- `cache/download/github.com/moby/sys/user/@v/v0.4.1.info`
- `cache/download/github.com/moby/sys/user/@v/v0.4.1.mod`
- `cache/download/github.com/moby/sys/user/@v/v0.4.1.zip`
- `cache/download/golang.org/x/sys/@v/v0.1.0.info`
- `cache/download/golang.org/x/sys/@v/v0.1.0.mod`
- `cache/download/golang.org/x/sys/@v/v0.1.0.zip`

The recipe accepts no caller-provided module, version, kind or path. Before and
after hashing each file, standard tools already present in the trusted builder
must establish the same identity and size. Missing paths, symlinks, hard links,
non-regular files or files changed during measurement fail the build. Each file
must be non-empty and at most 16 MiB; the six-file total must be at most 32 MiB.
The measured bytes are the proxy representations produced by the same verified
download that materializes the module cache used by the subsequent offline Go
commands. Those commands may read the extracted module trees; this measure
does not establish byte identity or completeness of those excluded trees.

Write `/out/evidence/module-proxy-payloads.tsv` as ASCII with LF endings and a
final LF. It has no header and exactly six tab-separated rows with five fields:

`module`, `version`, `kind`, `bytes`, `sha256`.

Rows are ordered by the two module paths above, then `info`, `mod`, `zip`.
Module, version and kind are fixed literals; `bytes` is canonical positive
decimal without leading zeroes; `sha256` is 64 lowercase hexadecimal
characters. No absolute cache path or payload content enters public evidence.

The existing `evidence` target exports this file with the other bounded Gosu
text evidence. There is no new Buildx solve, target, cache handoff, process
supervisor, workflow step, dependency, archive format or tool controller.

## Audit binding

Keep `bindManagedGosuEvidence`, `SOURCE_BOUND_GOSU_V1`, its evaluator and the
closed managed-Gosu controls contract byte-for-byte unchanged. The fixed-field
guard in `official-controls.mjs` remains mandatory; this increment adds no
field to `gosuSourceEvidence` and makes no policy change.

Add a separate bounded six-row parser in the existing
`scripts/scanner/official-audit.mjs`. Its fixed PostgreSQL call site reads
`module-proxy-payloads.tsv` from the already captured evidence directory; it
accepts no external path. The parser requires the exact canonical form,
module/version/kind set and order, per-file and aggregate caps, and recomputes
the aggregate from the six row lengths. Duplicate, missing, extra, reordered,
malformed or non-canonical rows fail the build.

Store the closed projection as `build.gosuModulePayloads`, alongside the
unchanged `build.gosuSourceEvidence`, inside the existing build receipt. Its
six descriptors and derived `totalBytes` are bound to the same build subject,
source, recipe and run. The consumed TSV must also appear with the same bytes
and SHA-256 in that build's existing `build.publicEvidence` hashes. This is
neither a new receipt nor a claim that the payload files were retained.

The trust boundary is explicit: the reviewed Dockerfile generates the TSV from
the six actual files, while the audit parser validates only its canonical
closed form and caps. Acceptance depends on independent review of the actual
artifact plus its source, recipe, run and captured public-evidence hash
bindings. The parser cannot by itself detect a coordinated, well-formed
substitution of both a byte count and digest without the payload files.

## Implementation scope

If the reviews accept this plan, implementation is limited to:

- `infra/managed-images/Dockerfile.postgres`;
- `scripts/scanner/official-audit.mjs`, only the bounded parser and its fixed
  existing PostgreSQL build call site;
- the focused PostgreSQL/Gosu audit tests and six-row fixtures;
- existing whole-file/source-order guards that must recognize the added
  Dockerfile evidence and parser call.

Do not change SeaweedFS, OpenSearch, AWS CLI, Redis, managed workflow
permissions, publication, packages, signing, admission, C: copies, activation
or support-date code. Do not edit `official-controls.mjs`, the existing Gosu
source-evidence binder, evaluator or policy.

## Acceptance

1. A real Linux managed build generates exactly the six rows after successful
   download and verification, then completes the existing network-disabled Gosu
   tests and compilation in that same stage. This does not prove that each
   proxy file is read directly or equate it with an extracted module tree.
2. Focused tests reject missing, extra, duplicate, reordered and malformed TSV
   rows; wrong module, version or kind; malformed digest or byte count; CRLF,
   missing or extra final newlines; and every 16 MiB/32 MiB cap breach.
3. Linux production-boundary tests reject a missing file, symlink, hard link,
   non-regular file and a file changed while it is measured. They prove the TSV
   digest and byte count against the actual six files.
4. Audit tests prove canonical parsing, derived totals and
   `build.gosuModulePayloads` in the same build whose `publicEvidence`
   authenticates the captured TSV. Missing or malformed measurement fails that
   build, and the existing publication-hash boundary refuses TSV byte changes
   against the captured identity.
5. Regression tests prove `gosuSourceEvidence`, `SOURCE_BOUND_GOSU_V1`, its
   exact closed fields and the existing controls/evaluator behavior are
   unchanged.
6. Existing `go mod verify`, source-archive, `go.mod`, `go.sum`, build-info,
   binary and final-image checks remain mandatory. Existing focused managed
   tests, complete root tests, lint, typecheck, build, secret scan and dependency
   audit pass.
7. Actual source CI, independent result review, normal protected merge and fresh
   protected-main CI all pass before this M3 increment can be accepted.

## Explicitly unresolved closure

Existing dated, source-bound measurements for the four managed image archives,
scanner and database payloads remain historical observations and are not reset
or replaced by `null`. They do not prove that their bytes survive or establish
complete current capacity.

Only missing members or required representations remain unmeasured with size
`null`, including complete base/final image retention representations,
compiler/JDK/OS sources, RPMs and repository metadata, remaining SeaweedFS and
Rust-helper closure, Redis retention material, missing scanner/database
representations, reports, SBOMs, runtime evidence and future attestations.

The six proxy payloads are only one representation of two Go dependencies.
Module ZIP hash sidecars (`.ziphash`), checksum-database cache files, extracted
module trees, mutable metadata and other cache entries are excluded; they are
neither counted as zero nor claimed retained or independently restorable. A
later reviewed closure decision must state which representations are required
for offline reconstruction and retention.

Private primary storage, complete capacity with working headroom, the authorized
C: copy, byte-identical second copy and cold restore remain later gates under
the existing ADR contracts. This increment authorizes none of them.
