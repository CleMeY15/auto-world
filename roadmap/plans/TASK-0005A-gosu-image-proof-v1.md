# B1b.1 — conditional Gosu Docker-save pair proof

Status: APPROVED_FOR_SOURCE_IMPLEMENTATION on 2026-10-20, Architect CLEAR followed by distinct Critic OKAY, including the separately reviewed pinned Docker28 layout amendment. Owner: Platform/SRE. This is a source-only increment after PR182 and the independently accepted current BASE (10 USTAR layers) and CANDIDATE (12 USTAR layers) format observations. It does not accept a real B1b image or authorize a new native operation. TASK-0005A and TASK-0005 remain IN_PROGRESS.

## Goal and boundaries

Connect real Docker-save bytes to the existing genuine candidate-lock filesystem/configuration predicates, without extraction, native links, filesystem access, commands, network, or a caller-provided validator. The current format observations do not contain a full configuration/history, member paths, or an authenticated build window. They establish the observed USTAR format, not satisfaction of this new proof. No exact historical `created_by` string or build timestamp is inferred.

One focused branch/PR adds `scripts/postgres-image/gosu-derivative-image-proof-v1.mjs`, its independent test, this plan and a validation document, plus append-only notes in ADR-0015, TASK-0005A and TASK-0005. Preserve every existing implementation, lock/recipe, accepted/failure record and private control. Coordinate shared ROADMAP/DELIVERY ownership with the concurrent product chat; do not edit those shared files in this increment. No new dependencies. The pure module is not an admission entrypoint and needs no change to admission-consumers.json.

## Closed API

Only two exports:

```js
openGosuDerivativeDockerSaveV1(bytes, subject) // Promise<opaqueSaveHandle>
proveGosuDerivativeImagePairV1(candidateLockHandle, {
  baseSave, candidateSave, buildWindow: { startedAtMs, completedAtMs }
}) // frozen conditional result
```

`subject` has exactly `{ role: "BASE" | "CANDIDATE", archive: { bytes, sha256 }, configId: "sha256:<64 lowercase hex>" }`. Archive bytes is a positive safe integer, no more than 1 GiB and exactly the snapshot length. Archive sha256 is exactly 64 lowercase hexadecimal characters without a prefix; the SHA-256 of the complete snapshot must equal it before decoding. Reject proxies, accessors, symbols, unexpected prototypes/fields and forged/cross-instance save handles without invoking caller behavior. Accept only native Buffer/Uint8Array backed by a non-shared, non-resizable, attached ArrayBuffer. Snapshot bytes and subject synchronously before the first await with intrinsic getters/set; never use caller iteration or overridden Buffer methods. The caller may mutate its original bytes immediately after invocation without changing the result. A WeakMap retains only parsed metadata and immutable logical inode state, not archive bodies; frozen empty null-prototype handles expose no payload.

All failures project to a fixed module-owned error code (`gosu_derivative_image_proof_input_invalid`, `gosu_derivative_image_proof_archive_invalid`, or `gosu_derivative_image_proof_pair_invalid`). Never expose parser causes, untrusted names, JSON, link targets, or body bytes. No injectable production test hooks or CLI are added.

## Supported archive profile

- Raw USTAR only, at most 1 GiB per archive; at most 2 GiB per pair. Shared scanner receives chunks no larger than 1 MiB. Outer scan: at most 4096 members, no symlinks or hardlinks, one regular manifest/config and regular selected layers. Non-selected regular metadata remains covered by the archive hash and is not interpreted or surfaced.
- Selected JSON at most 4 MiB each; UTF-8 fatal decoding, no BOM, bounded parsed graph (depth 32, nodes 100000, key/string 65536 bytes), finite JSON numbers. Manifest is a single image with the three required fields Config/RepoTags/Layers and only optional Parent(string)/LayerSources(plain record), preserving the already delivered Docker manifest compatibility. RepoTags is null or an array of bounded strings. LayerSources is bounded opaque compatibility metadata, never an image/layer selector; the OCI descriptor-extension rules below apply to OCI descriptors only. All selected layer paths are canonical, distinct and refer to regular outer members. Preserve own JSON keys such as __proto__ as inert data.
- Config path is exactly `blobs/sha256/<configId without sha256:>`; the complete config file hash is configId. Full configuration has os=linux, architecture=amd64, lowercase runtime object `config`, rootfs `{type:"layers", diff_ids:[...]}` and optional history/created as specified below. Do not consume image-inspect `.Config`. This path follows both pinned Moby28 exporters, rather than assuming an older root JSON layout.
- BASE has exactly 10 layers, CANDIDATE exactly 12. Each ordered uncompressed TAR hash equals the corresponding config DiffID. At most 100000 aggregate layer members per save and 100000 for the accepted pair. Paths are limited to 512 printable ASCII bytes and 32 segments; inode metadata must also fit the existing V2 inventory limits.
- All layers pass the unchanged shared raw USTAR scanner with its bounded same-layer, earlier-regular hardlink option. Refuse GZIP/opaque, PAX, special files, whiteouts, opaque whiteouts and unsupported ancestor/link cases. A refusal means unsupported proof profile; it does not redefine the validity of other OCI images.

The supported Docker28 layout is the direct single-image OCI compatibility profile. Require regular `oci-layout` with exactly `{imageLayoutVersion:"1.0.0"}` and regular `index.json` with exactly `{schemaVersion:2,mediaType:"application/vnd.oci.image.index.v1+json",manifests:[descriptor]}`. The single descriptor has required mediaType/digest/size, optional annotations and platform, and no other fields. Its mediaType is exactly `application/vnd.oci.image.manifest.v1+json`; digest is exactly `sha256:<64 lowercase hexadecimal characters>`; positive safe integer size is at most 4 MiB. Annotations, if present, are a bounded string-to-string record; platform, if present, is exactly `{os:"linux",architecture:"amd64"}`. Values do not confer tag/source authority.

The descriptor resolves only to the regular hash-bound `blobs/sha256/<64 lowercase hex>` member, obtained by stripping the required sha256: prefix from descriptor.digest, with the exact size. Its JSON is exactly `{schemaVersion:2,mediaType:"application/vnd.oci.image.manifest.v1+json",config:descriptor,layers:[descriptor,...]}`. Config/layer descriptors each have exactly mediaType/digest/size. Config mediaType is `application/vnd.oci.image.config.v1+json`, digest/size match the complete selected config bytes and configId. Each ordered layer mediaType is `application/vnd.oci.image.layer.v1.tar`, digest equals the corresponding uncompressed DiffID and selected layer byte hash, size equals that selected TAR size, and the legacy manifest layer path equals `blobs/sha256/<64 lowercase hex>` after removing that digest's sha256: prefix. All OCI config/layer descriptor digests use exactly the same prefixed digest syntax. Both selector views therefore identify the same complete config and ordered raw layers. Refuse nested OCI/Docker indexes, multiple images, alternate media types, inconsistent selector graphs or unsupported descriptor extensions; these are profile limits, not universal Docker validity claims. Other hashed compatibility metadata remains unselected and cannot substitute an image selector. Enforce at most 100000 live filesystem nodes including inferred ancestors, not just 100000 TAR members.

## Layer semantics and exact delta

Apply layers in order without extracting. Directory-over-directory updates attributes and retains descendants. Every other replacement removes the old path and descendants before creating the new entry. Missing ancestors use internal unresolved placeholders; every surviving placeholder must acquire an explicit directory entry by final projection. Never traverse a symlink/non-directory ancestor. Reject invalid path or metadata before applying an entry.

Keep hardlinked files as shared internal inode objects: the unchanged scanner still requires an earlier regular target in the same layer, matching metadata, and rejects forward/chained/cross-layer links. Overwriting a target in a later layer detaches that path while surviving aliases retain the old content and attributes. Project files to V2 material-file entries, and separately preserve/check the alias equivalence of every unchanged path across the pair. A Gosu inode shared with another base path is refused for replacement; no unmodeled alias side effect is accepted.

The pair proof obtains the contract through real `candidateContractV2`, binds the BASE configId to contract.base.configId, requires BASE/CANDIDATE roles and different genuine handles, and compares the ten inherited layer byte sizes/hashes and ordered DiffIDs exactly. Derive allowed added-layer paths from that genuine contract: Gosu, the twelve evidence files, and six parent directories. The two appended layers may contain only those paths and no symlink/hardlink. Then call real `validateCandidateFilesystemV2` with projected inventories, lowercase runtime config objects and the checked build window. No contract or predicate may be supplied by the caller.

Window is an exact data record of nonnegative safe integer milliseconds, ordered and at most 600000 ms; authentication is a caller obligation, explicit in the output scope. Existing V2 rules govern file identities/metadata, parent creation/mtime, the twelve evidence files, unchanged paths, runtime configuration and the known base executable. Preserve all their checks.

## Full configuration relationship

The full base and candidate configurations agree deeply outside `created`, `rootfs`, and `history`; rootfs has only type/diff_ids and the exact 10+2 relation. Extension fields elsewhere are bounded and equal, not interpreted. Runtime config is additionally verified by V2. History is optional for OCI generally, but this bounded proof profile requires it on both inputs: candidate prefix equals the complete base history, with exactly two appended records and no appended `empty_layer:true`. Existing history must have exactly ten non-empty-layer entries. Known history fields have OCI types (created/created_by/author/comment strings, empty_layer boolean); bounded unknown extension fields remain opaque. No particular instruction text is claimed. Missing or different history profiles fail closed for this proof.

Optional candidate full-config `created` and optional `created` on each appended history record must be UTC RFC3339 timestamps within the supplied millisecond window. Require suffix Z, an absent fractional part or 1-9 fractional digits, and real calendar/time components without leap-second normalization. Explicit syntax and calendar validation is authoritative; do not rely on Date.parse's permissive normalization or fraction truncation. Compare at nanosecond precision against BigInt(startedAtMs) * 1000000 and BigInt(completedAtMs) * 1000000, with inclusive bounds. Absence is allowed. Base created/history timestamps are not treated as build dates. Timestamp checks prove relationship to the supplied window only; they do not authenticate that window.

## Closed result and privacy

Positive result has exactly the following literal shape. `delta` is the complete genuine validateCandidateFilesystemV2 result, including its scope/authority, counts and fixed-path arrays, without additions or omissions.

```js
{
  scope: "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW",
  authority: "NOT_AUTHORIZED",
  profile: "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1",
  base: { archive: { bytes, sha256 }, configId, layers: 10 },
  candidate: { archive: { bytes, sha256 }, configId, layers: 12 },
  inheritedLayers: 10,
  addedLayers: 2,
  configProfile: "STRICT_INHERITED_CONFIG_V2",
  delta
}
```

All nested data are frozen. No arbitrary member paths, links, configuration, payload or history text is projected; V2 lists only its fixed expected change paths. There is no historical-G2, source/build provenance, functional, vulnerability, remote publication, admission, activation or support verdict. `currentEvidence` stays unchanged and dates stay null.

## Verification and delivery

Before implementation, obtain Architect approval then a distinct Critic approval of this closed plan. Separate production implementation from independent test ownership. Tests use genuine small USTAR and Docker-save bytes; no private archives/context/raw records or old controls are accessed. A full positive uses an explicitly named FORMAT_ONLY VM contract seam replacing only candidate-lock authenticity; the shared scanner and the filesystem/configuration V2 implementations remain real. The production API has no seam. Genuine production handles must reject synthetic content, forged/clone/proxy/cross-instance handles and unauthorized config identities.

Test ordered layer/size/hash/DiffID/config bindings, duplicate/unsafe/missing paths, all bounds via targeted boundary probes, manifest compatibility, full/runtime configuration and history mutations, timestamps/window edges, directory replacement/retention, unresolved/non-directory ancestors, hardlink alias survival and attacks, prohibited formats and type flags, hostile object/byte views and immediate mutation, closed errors and deep-frozen privacy-preserving results. Real fixtures include coherent OCI layout/index/manifest blobs. Independently mutate OCI and legacy selection, descriptor paths/sizes/hashes/media types, config/layer order, missing blobs, root-style config paths, descriptor extensions, multi/nested indexes and platform/annotation types; each mismatch must fail closed. Explicitly prove real predicates execute by corrupting a filesystem/runtime invariant that passes the structural codec. Synthetic success is never a real-image acceptance claim.

Run targeted tests on pinned Node22.23.2 Windows/Linux, full lint/typecheck/tests/build/secrets/audit with nonzero workspace tasks, independent code/security reviews and fresh exact-head/main CI. Validation distinguishes local, source CI, merged-main and actual-operation facts. Rollback removes only unused new module/test and append-only notes through review; it never deletes private artifacts, signals daemons, rewrites retained history or changes admission. Subsequent real proof needs a separately reviewed caller with authenticated input identities and build window, its own bounded operation and independent actual reviews.

Primary sources: [OCI config v1.1.1](https://github.com/opencontainers/image-spec/blob/v1.1.1/config.md), [OCI layer application](https://github.com/opencontainers/image-spec/blob/v1.1.1/layer.md), [Docker image save](https://docs.docker.com/reference/cli/docker/image/save/), [Docker API history and inspect.Config differences](https://docs.docker.com/reference/api/engine/version-history/), [pinned Moby28.0.4 classic export](https://github.com/moby/moby/blob/6430e49a55babd9b8f4d08e70ecb2b68900770fe/image/tarexport/save.go), [pinned containerd compatibility export](https://github.com/moby/moby/blob/6430e49a55babd9b8f4d08e70ecb2b68900770fe/vendor/github.com/containerd/containerd/v2/core/images/archive/exporter.go). Both use content-addressed config paths and OCI selectors; containerd can also emit nested-index profiles that this increment deliberately refuses. These describe format semantics; they do not attest our retained images or an operational build window.
