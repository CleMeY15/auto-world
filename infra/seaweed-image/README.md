# Public base metadata for the bounded S3 recipe

These files are public input policy, not a candidate image or source acceptance.
The pure transformation planner consumes no layer and runs no executable.

- `base-manifest.json`: exact Docker Hub Linux/amd64 manifest of `chrislusf/seaweedfs:4.47`, 2,193 bytes, SHA-256 `f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362`.
- `base-config.json`: exact referenced configuration, 13,676 bytes, SHA-256 `31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927`.
- `base-filesystem.json`: deterministic projection of the [verified public inventory](../../docs/validation/TASK-0005A-SEAWEED-IMAGE-INVENTORY.md), 116,924 bytes, SHA-256 `82a8ea5decc1dfd578eacfa8fdf146423c34c357b9cfc1f962ed2b32942a5180`.

The filesystem projection contains all 561 visible entries, sorted by ASCII path:
100 directories, 114 regular files and 347 symlinks. For every entry it preserves
path, type, numeric mode, UID/GID, integer mtime and size; regular files include
their content SHA-256, symlinks their original target. The retained source
inventory established no PAX/xattr/capability metadata or unsupported member
types. Existing special permission bits are preserved, not normalized to 0755.

The projection does not contain layer indices, derived link resolutions or ELF
diagnostic annotations, which are not output filesystem fields. It does not
replace the original layer evidence. A future builder must authenticate all ten
compressed descriptors and uncompressed DiffIDs, inspect complete streams,
reject unsupported metadata and reproduce this inventory from actual bytes
before using the plan. The [read-only replay library](../../docs/validation/TASK-0005A-SEAWEED-BASE-SCAN.md)
implements the bounded reader and inventory comparison. A writer and authenticated
source adapter remain separate requirements; replay alone builds no candidate.

The two registry JSON files are preserved byte-for-byte. `.gitattributes` prevents
Windows line-ending conversion for all three hash-bound metadata files. The
planner checks their exact bytes before parsing; a reserialized equivalent JSON
file requires an explicit policy update.

Base labels remain available in the plan's provenance. They are not copied into
the derivative's labels as its author, vendor or build provenance. The upstream
license label is an upstream statement, not a licence inventory of the derivative.
