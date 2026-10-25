# TASK-0005A — bounded hardlinks in Gosu image layers

Status: IMPLEMENTATION_VALIDATED in [PR182](https://github.com/CleMeY15/auto-world/pull/182). TASK-0005A and TASK-0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Verified starting point
One current-only diagnostic on 2026-10-18 read the exact retained BASE archive: 300,058,112 bytes, SHA-256 `6851bcdfcc72bccb8b8348798f47843620a14e66a63061025f3e7733d2c76812`. The file was opened, fully read in 287 positive positioned reads plus EOF, hash-checked and closed under Node 22.23.2, UID/GID 1000, zero capabilities, no-new-privileges and private network. Root, parent and child exited normally; monitors, original raw-file identities and postguards passed; both stderr outputs were empty. Prior failed raw outputs remained unread and were checked only by metadata.

The first type rejected by the unchanged public scanner is ASCII `1` (byte49), a [TAR hardlink](https://www.gnu.org/software/tar/manual/html_node/Standard.html), in zero-based layer4 at uncompressed offset288330752. Its 512-byte header SHA-256 is `6fb4689d50b4294738e0995c3688dd20dc7282c26e2f35f3c366e7a2a37b3b91`. The private root index is4290 bytes/SHA256 `3da0014fa0a3461348aade84ce2e561056ada5e670cfa1a4bf0c854b91360670`; the separate acceptance is1626/SHA256 `66144257919dc928543fda0fcfd6b2db423fdf7d204c491dd9a751c6f56c6215`. Two independent reviewers accepted only this type-prefix observation. No member path, link target or payload was projected.

This proves the rejected entry type; complete layer/image validity, functionality, vulnerabilities, provenance, candidate cleanup, admission and support activation remain unestablished. Local Python/native ESM import bytes were pinned before/after execution, without atomic loaded-byte attestation against concurrent local mutation; that threat is outside this bounded diagnostic.

## Reviewed change
The [plan](../../roadmap/plans/TASK-0005A-gosu-layer-hardlinks.md) was approved by an Architect and then a distinct Critic before implementation and committed/pushed in the draft PR. It integrates PR181/main `1d0133e17a9b8bcf763ae520ab1a2a05bc25e334`. The private integration baseline covers1026 tracked files; eight paths are owned and four existing document prefixes are append-only.

The Gosu V2 observer opts into the existing hardlink subset in exactly two image-layer readers: controlled gzip and raw USTAR. Shared scanner source/defaults, Docker-save outer archive and authenticated build-context readers remain strict. The subset requires a canonical earlier regular-file target, equal mode/uid/gid/mtime and zero link payload. Missing, forward, self, chained, duplicate, traversal and metadata-inconsistent links remain rejected. No extraction or filesystem link creation occurs. This deliberately does not implement general POSIX linkdata, PAX or device entries.

All original byte hashes, DiffID checks, gzip identity/trailing-data checks, layer/aggregate expansion caps, member limits, deadlines, abort signals, four public exports and result fields remain. The existing member descriptor may report `type: hardlink` and size0, without adding a link-target field. No new dependency or migration is involved.

## Validation and delivery gates
Targeted RED/GREEN tests, complete local checks and independent implementation reviews pass as recorded below. Exact final-head CI, the identical reviewed merge tree and merged-main CI remain required for source delivery, tracked in PR182. Synthetic fixtures establish parser behavior only; a new bounded current BASE observation against delivered source remains a separate next step.

## Operations and rollback
Revert the two observer opt-ins to restore strict image-layer rejection. Existing diagnostic originals remain retained; no consumed control is replayed, no image is built or published, currentEvidence remains unchanged and support dates remain null. The one-year support period with continuous security checks starts only at real reviewed activation, with archives retained at least one further year.

TASK-0005 also still requires the remaining reviewed PostgreSQL image/current-audit/admission work, application migrations and integrated PostgreSQL/OpenSearch/Redis/S3-compatible acceptance. This source increment does not satisfy those dependencies or unblock TASK-0006.

## Targeted regressions

Frozen observer63021/SHA256 `b53f800f424d9289c74e669b853822a4d5cf59c541b8f6d14dcbe33f4cdf2599` and test91616/SHA256 `5bf56b436d13c526a9ceef8300334c7330b3663d45ccbf4b87477443d634e8c4` differ by only two source opt-ins plus fixture/regression coverage. The meaningful RED retained four expected type-invalid failures on the old observer. GREEN passes seven focused cases, covering USTAR/GZIP for BASE/CANDIDATE, original hashes/DiffIDs, unchanged descriptor/result fields, unsafe links and strict outer/context boundaries.

Pinned Node22 on Windows and Linux each passes69/69 VM cases and23/24 standard wrappers, with the direct VM-only wrapper explicitly skipped there and exercised in the VM run. Shared archive regressions pass19/19 on both actors; syntax and strict ESLint pass. The targeted private manifest2217/SHA256 `a9b56fad9c08c83dde86326e27ee8873eb3f1198e348942fc5b9d64ad9c6440e` binds the retained original RED/GREEN outputs and final code/test pins. These are synthetic parser proofs, not real-image acceptance.

## Complete local gates and independent reviews

Node22.23.2/pnpm10.15.0 pass lint, typecheck, tests, build, secret scan and dependency audit. Dry runs resolve real Turbo tasks: lint14, typecheck21, test28, build14. Root TAP reports2012 tests, 1568 passes, 444 explicit platform/actor exclusions and0 failures; all28 workspace test tasks pass. Runtime code/test/toolchain inputs remain byte-identical across all gates. Secretlint scans1027 repository files and dependency audit reports no known dependency vulnerabilities. The private six-gate index is5240/SHA256 `f8a181484daf750dbb0d2f66459453ea547a1507edbc9b02df99b4ab2d3dc63f`. Dependency audit uses only process-local Node system CAs with TLS verification enabled, without persistent configuration changes.

Distinct code/security and architecture reviews report CODE_SECURITY_CLEAR and CLEAR_CODE_CONTRACT_ONLY, with no findings on the frozen source/test. Fresh independent syntax, strict lint,69/69 VM and19/19 shared archive regressions confirm the source contract. Incoming PR181 product work and1019 unrelated tracked files are preserved; four original document prefixes remain byte-identical. Final eight-path diff, documentation/secret checks and exact-final-head/main delivery follow this source checkpoint. No image-format or functional/security/admission claim follows from these source-only checks.
