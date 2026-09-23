# Bounded SeaweedFS artifact ZIP reader

The successful [native source run35884717093](https://github.com/CleMeY15/auto-world/actions/runs/35884717093)
provides two independently built public material archives. Their local replay
confirms the complete source comparison, but the one-off diagnostic transport is
not a reusable input boundary for candidate construction. This increment adds
a bounded reader for the observed GitHub artifact ZIP format. It does not fetch
network bytes, create an extraction directory, authenticate a workflow run,
construct a Docker image or publish a package.

## Boundary

The caller supplies a seekable source, expected raw ZIP size and SHA-256, a
closed artifact profile, and a synchronous sink opener. A pure scanner works
with a caller-owned source, including synthetic Windows tests. A separate
Linux wrapper opens an owned regular ZIP file directly under a trusted root
using `O_NOFOLLOW`. The root and file must belong to the running user and deny
group/other writes. The wrapper checks their identities before and after
reading and closes the file on every path. These checks rely on the trusted
workflow-owned parent directory; they do not defeat a privileged concurrent
writer. Neither interface grants origin authority: matching a caller's
descriptor is only byte consistency. A later source adapter must bind that
descriptor to the verified repository, workflow, attempt, jobs and exact five
GitHub artifact records.

The reader verifies the complete raw ZIP digest, its central and local records,
and the exact archive layout before opening a content sink. It verifies the raw
digest again after streaming. The pure source contract assumes caller-owned,
stable bytes during that interval; even repeated hashing cannot make a hostile
concurrent writer immutable. Each sink receives
one frozen entry and an explicit provisional-integrity context. Entry bytes
stream under backpressure through size, CRC-32 and SHA-256 checks. A complete
receipt is returned only after every entry and final source checks pass. Until
then, any bytes emitted to a caller sink are provisional; a later intake runner
must own exclusive partial files, close and revalidate the full extracted trees,
and promote them only after all source and material gates pass.

## Accepted archive profile

Only single-disk classic ZIP32 with a final empty-comment EOCD is accepted.
Central records, local records and signed data descriptors must match in one
contiguous ordered layout with no prefix, gap, overlap or trailing data. Names
are unique canonical printable ASCII regular-file paths. The observed GitHub
format uses Unix creator metadata, version 2.0 extraction, data-descriptor
flag and ordinary `0600`, `0644` or `0755` file modes. Build members use store;
the single JSON member in each gate or comparison archive uses raw deflate.
The `weed` entry is mode `0755`, module `source.zip` entries are `0600`, and
every other accepted entry is `0644`.
ZIP64, extras, comments, alternate encodings, links and special files are
outside this closed profile. For build archives the scanner bounds the ZIP and
cumulative output at 2 GiB and entries at 65,534. The single JSON entry in a
gate or comparison archive is capped at 1 MiB raw, with a 2 MiB ZIP cap. Every
source read and content chunk is at most 1 MiB. Build paths must
pass the existing `validateArtifactAllowlist`; gate and comparison archives
have one exact JSON path each.

The actual successful build archives are 1,559,755,770 and 1,559,676,896 raw
ZIP bytes with 4,854 entries each. The local diagnostic independently matched
their GitHub size/digest metadata and checked every entry CRC. A separate
pinned Node 22.23.2 replay of the new pure reader has also scanned both raw
archives, independently counted and hashed all 9,708 delivered contents, and
matched all 4,817 deterministic material identities against each other and
the native comparison receipt. The local proof is retained under ignored
`.omx/validation/zip-reader-real-corpus-proof.json`; it explicitly records
`sourceAuthority: NOT_EVALUATED` and `candidateAuthorization: NOT_AUTHORIZED`.
The three small raw ZIPs were separately downloaded after exact run/artifact
metadata checks. Their sizes and SHA-256 values match the GitHub records:
gate 1, 277 bytes / `bb5ebe41e7fa8e52987a91ab4dae19f88ac412fedfa8ec78b368b861efe2759c`;
gate 2, 278 bytes / `15a9e2e02c985ccdfb0c949c5141265a4c8b6af0b864a4951586d2c84e1ce69d`;
comparison, 244,644 bytes / `e58db0edbd41cc2dcb6243464f0110fb4db1ec52dc81fbcd05860b1598254092`.
The pure reader accepted each exact one-file profile, and independent sinks
matched the retained JSON bytes and PASSED semantics. The ignored
`.omx/validation/zip-reader-tiny-real-corpus-proof.json` retains this local
replay; it does not claim GitHub origin authority for a production caller.
Pinned Node 22.23.2 local verification passes 11 targeted cases and skips
three Linux-only owned-file cases on Windows. The full forced `pnpm check`
passes 262 root tests with five expected Windows-only skips, all package
tests, lint, typecheck, nine builds, Secretlint over 279 repository files and
dependency audit with no known findings. Independent Critic review found no
P0/P1/P2 issues on reader SHA-256
`28389ef13cbf8b4bcd126add8f7ed87c1e6af19ee524be97122f57f7d1114978`
and test SHA-256
`c0d22933a9ee0100cbe8c85fa2b8999717e463b5cc9f42165271e6a69e825945`.
The focused PR records the exact commit, fresh-checkout and Linux CI gates;
the three owned-file controls must pass there before integration.

## Integration and rollback

The existing `validateArtifactDirectory` and `compareBuilds` remain the
authoritative material and actual-byte comparison checks. A future transport
adapter must prove successful attempt-1 run identity and closed artifact set
against fresh GitHub records before opening archives. A future output runner
must use exclusively owned partial paths and revalidate before promotion.
This library has no migration or service runtime effect; rollback removes the
reader and its tests. Native source success does not satisfy image audit,
private-image admission or the four-service infrastructure lifecycle.

## References

- [PKWARE ZIP APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [Node.js 22.23.2 zlib CRC-32](https://nodejs.org/download/release/v22.23.2/docs/api/zlib.html#zlibcrc32data-value)
- [Native source evidence](TASK-0005A-SEAWEED-SOURCE.md)
