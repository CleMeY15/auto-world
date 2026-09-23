# Read-only replay of the pinned public Seaweed base

This increment reads the ten existing public Linux/amd64 layer blobs and reproduces their complete visible inventory. It prepares an observed replay index only. It contains no archive writer, source-run authenticator, filesystem extraction, Docker invocation, network downloader, workflow or publication capability.

## Implementation contract

`scanPinnedBase` authenticates the exact three [base metadata files](../../infra/seaweed-image/README.md) before invoking the caller's stream opener. It reads one layer at a time and compares the compressed byte count and SHA-256 to the manifest descriptor, and the SHA-256 of every decompressed byte to the corresponding configuration DiffID. Bounds are cumulative: 256 MiB compressed, 2 GiB decompressed and 100,000 members. Stream chunks are at most 1 MiB. File bodies are hashed incrementally; only bounded headers and metadata are retained.

The reader accepts USTAR headers with unsigned checksums and octal numeric fields, regular files, directories and symlinks. It validates field termination, ASCII names, numeric ranges, link targets, padding and the complete end of the archive. Unsupported formats, extensions, hardlinks, devices, whiteouts, duplicate paths, traversal and hidden header data fail. Special permission bits and original symlink text are preserved. Directories lose only their TAR separator suffix in the canonical inventory. UID/GID are authoritative; printable USTAR owner names are validated but not part of that inventory. USTAR prefixes are supported and tested with authored fixtures even though the exact base uses none.

Each TAR must finish with exactly two zero blocks and no further decompressed byte. Gzip uses Node22.23.2's normal complete-stream validation, including CRC and ISIZE. Fully consumed concatenated gzip members are permitted to encode one complete TAR; no single-gzip-member property is claimed by the generic reader. A second TAR or extra decompressed padding fails. The compressed byte count must also equal `Gunzip.bytesWritten`, rejecting compressed zero suffixes that Node would otherwise ignore. The fixed base's descriptor hashes authenticate its actual single-member encodings. No permissive `finishFlush` or one-shot `maxOutputLength` is used.

Overlay resolution permits later replacement of the same type only. It rejects type changes, duplicates in one layer and non-directory or missing final ancestors. The complete sorted metadata/content projection must equal all 561 entries in the authenticated `base-filesystem.json`; a matching count alone is insufficient.

The returned `PUBLIC_BASE_REPLAY_INDEX_V1` has authority `PREPARATION_ONLY`. Each winning reference records layer index, compressed digest, member ordinal, uncompressed header/data offsets and exact entry metadata. These are observations, not authorization to trust an edited index. A future content replay must revalidate its inputs and stream bytes independently. No source or candidate acceptance follows from this receipt.

The API accepts caller-owned streams and destroys/awaits consumed streams. It interprets no host pathname and therefore claims no filesystem no-follow or immutability guarantee. A future local/remote opener needs its own file/transport boundary. No original image member is extracted to the host.

## Corpus and validation

The independently retained public corpus contains 195,224,300 compressed bytes, 532,811,776 raw TAR bytes and 609 members. Its conservative overlay has 561 entries: 100 directories, 114 regular files and 347 symlinks. There are 48 replacement events on 38 paths, with no type changes. All 609 actual headers are USTAR, have empty owner-name fields and no prefix; all content padding is zero and each archive ends with exactly 1,024 zero bytes. Each actual gzip blob is one complete member with no optional fields or trailing bytes.

Focused tests exercise hostile gzip/TAR inputs, bounded streaming, the existing synthetic Docker-import fixture, exact overlay metadata and offsets, collisions, early metadata authentication and failure cleanup. The local real-corpus replay, pinned full gates, fresh checkout, independent review and final-head/main CI outcomes are recorded in the PR; synthetic tests alone do not establish the corpus result.

The actual local Node22.23.2 replay consumed all ten retained blobs and reproduced the full 609-member/561-entry inventory. It independently matched every winning layer, raw header/data offset, padded content boundary and file hash/link target against the separate census. All ten input streams were closed before completion, with each previous stream closed before opening the next. The resulting sanitized replay index is 275,230 bytes, SHA-256 `5db4d6b95a3e8007b6d921182f4f9f0f6789a302d064585fc4a00ab4e62678b7`. This is read-only public-base evidence, not a candidate image or source acceptance.

[PR38](https://github.com/CleMeY15/auto-world/pull/38) integrated the preceding pure transformation/notice plan at `5033fb847cf5a657d078c6a57bcb61fdd4714f5e`. Independent Architect/Critic reviews cleared its exact tree. Forced pinned local/fresh checks passed 209 root tests plus two Windows-only skips and all package/security gates; [final-head CI35878139870](https://github.com/CleMeY15/auto-world/actions/runs/35878139870) and [main CI35878603105](https://github.com/CleMeY15/auto-world/actions/runs/35878603105) passed 211 root tests with no skips and all gates.

Source run [35875100636](https://github.com/CleMeY15/auto-world/actions/runs/35875100636) remains a separate acceptance requirement. Actual source authentication, archive construction, native image/runtime checks, private publication/retention and fresh scanner/admission remain downstream work. TASK-0005A/0005 are incomplete and TASK-0006 remains blocked. Rollback removes this preparation library and its documentation/tests; no service or stored data changes.

## Primary streaming references

- [Node22.23.2 zlib API](https://nodejs.org/download/release/v22.23.2/docs/api/zlib.html): complete-stream defaults, streaming transform and `bytesWritten`.
- [Pinned Node gzip processing](https://github.com/nodejs/node/blob/v22.23.2/src/node_zlib.cc): concatenated members and tolerated zero suffixes.
- [Pinned JavaScript zlib stream](https://github.com/nodejs/node/blob/v22.23.2/lib/zlib.js): accounting of bytes consumed by the engine.
- [RFC1952](https://www.rfc-editor.org/rfc/rfc1952.txt) and [zlib manual](https://www.zlib.net/manual.html): member/trailer format and CRC/ISIZE validation.
