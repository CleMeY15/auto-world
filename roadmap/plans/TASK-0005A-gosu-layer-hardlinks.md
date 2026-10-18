# TASK-0005A — bounded hardlinks in image layers

Status: PLAN_REVIEW. A focused parser compatibility increment; TASK-0005A and TASK-0005 remain IN_PROGRESS.

## Verified trigger
On 2026-10-18 one current BASE diagnostic read the retained 300,058,112-byte archive, SHA-256 `6851bcdfcc72bccb8b8348798f47843620a14e66a63061025f3e7733d2c76812`, under UID/GID 1000, zero capabilities and private network. The unchanged public scanner rejected type byte 49 (`1`, hardlink), at layer ordinal 4 and uncompressed header offset 288330752. Header SHA-256: `6fb4689d50b4294738e0995c3688dd20dc7282c26e2f35f3c366e7a2a37b3b91`. Private root index: 4290 bytes, SHA-256 `3da0014fa0a3461348aade84ce2e561056ada5e670cfa1a4bf0c854b91360670`. Independent actual reviews are recorded separately before implementation.

The observation establishes this rejected type only. Complete layer/image validity, a functional image, vulnerability status, provenance, candidate admission, cleanup of historical attempts and support activation are not established by this diagnostic.

## Smallest implementation
Use the existing `scanRawUstar` hardlink option in the Gosu V2 observer's image-layer paths only: `allowHardlinks: true` in the controlled gzip scanner and in the raw USTAR layer scanner. Keep both the Docker-save outer archive and build-context scans explicitly false. Do not change shared scanner source, defaults, public exports, projections, workflow permissions or dependencies.

The existing subset requires an earlier regular-file target in the same layer, canonical confined paths, identical mode/uid/gid/mtime, zero link payload, no forward/missing/self/chained targets, duplicate members or special entries. No filesystem link is created and no data is extracted. It is a deliberately bounded subset, not general POSIX linkdata support. Member descriptors can carry the existing scanner type `hardlink`; their field set is unchanged, without a new link-target projection.

Hash the original archive, compressed bytes and complete uncompressed layer bytes. Preserve diffID verification, gzip identity/trailing-data checks, per-layer and aggregate expansion caps, deadlines, aborts, member limits and finite failure details. Unsupported metadata/device entry types remain rejected.

## Regression strategy
Add synthetic observer fixtures using the real shared scanner through the existing VM harness. Prove raw and gzip hardlinks for both BASE and CANDIDATE; check original stored/uncompressed hashes, diffIDs, metadata/type and unchanged result/export field sets. First retain a meaningful RED against the unchanged observer, then GREEN with the two call-site changes.

Reject missing, forward, self and chained targets, metadata mismatches, payload-bearing links, absolute/traversal link targets, duplicate names, unsupported entry flags and diffID mismatch in raw/gzip layers. Keep actual strict rejection tests for shared scanner defaults, Docker-save outer archives and build contexts. Reuse existing gzip abort, expansion, malformed stream, compressed identity and closed diagnostic regressions.

Run targeted Windows and Linux Node 22 tests, syntax, strict lint; then repository lint, typecheck, tests, build, secret scan and dependency audit with Node 22.23.2/pnpm 10.15.0. Check Turbo resolves real nonzero tasks. No UI code changes are planned; the full Linux CI also runs browser regressions. No new dependency or weaker TLS/security setting is authorized.

## Review, delivery and next dependency
Architect approval precedes a distinct Critic. Put this plan in the draft PR before source implementation. Independent code/security and architecture reviews, exact final-head CI, the reviewed merge tree and merged-main CI are required before source delivery. Existing tracked files outside the seven owned paths stay unchanged; original ADR/task text is append-only.

After source delivery, a fresh separately bounded observation against the corrected delivered source must determine whether the current archive passes, or reports another finite incompatibility. Synthetic fixtures cannot supply that claim. Do not replay consumed controls, inspect old unread raw outputs, build/publish an image, activate support or advance TASK-0006 from this source increment.

## Operations and rollback
No service, database schema, migration, registry, image inventory or support date changes. Reverting the observer opt-ins restores strict layer rejection. Preserve original diagnostic evidence, currentEvidence and null support dates. The support policy remains one year from real reviewed activation with continuous security checks; no date begins here.
