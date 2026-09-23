# TASK-0005A — Authenticated flattened SeaweedFS root filesystem

Status: implementation under validation. This transaction prepares a raw USTAR root filesystem; it does not import, execute, scan, publish or admit an image. TASK-0005A/0005 remain IN_PROGRESS and TASK-0006 remains blocked.

## Input and authority boundary

The source and pinned public base are reacquired in one Linux process. Their earlier diagnostic receipts are evidence of successful past runs, not reusable access to material. Each materializer authenticates fresh remote bytes and retains its file authority in a private WeakMap tied to the exact live receipt. The rootfs transaction borrows both authorities for the duration of content reads; serialized receipts and caller-supplied filesystem paths cannot stand in for a live borrow.

The source capability supplies the compared `weed` binary, module closure and exact notice materials. Its binary read is single-use per borrow; it exposes no arbitrary compared-file reader. The base capability supplies its authenticated metadata, visible-entry index and bounded reads from verified raw TAR offsets. Base file reads are serialized and each path is read at most once per borrow. The planner preserves the 558 unchanged base entries, replaces `usr/bin/weed`, removes `usr/bin/weed-volume` and `usr/bin/weed-worker`, and adds every accepted notice, generated attribution index and necessary directories. The recipe revision and timestamp describe this rootfs run; they are never inferred from the older source code SHA or an API observation time. The planned Moby import profile is structural input at this stage, not a claim that Docker has run.

## Output and validation boundary

Write only to a new private `rootfs.tar.partial` with exclusive no-follow creation and mode `0600`. Stream deterministic USTAR content in canonical planned order, enforce each file's size and SHA-256, then `fsync` and close. Reopen the closed file without following symlinks, independently consume its complete raw stream, verify the DiffID, headers, padding and exactly two terminal zero blocks, and compare the scanner's full inventory with a freshly recomputed plan. Recheck owned identities, publish through an exclusive same-filesystem hard link that cannot replace an existing destination, remove the partial name, and scan the published file again before returning the receipt. A failure or uncertain cleanup yields no success receipt; never remove an unknown replacement.

The receipt is `SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1/MATERIALIZED/PREPARATION_ONLY/NOT_AUTHORIZED`. It reports bounded size, DiffID, member count and input identities without a host path or admission authority. Cleanup must dispose the rootfs, base and source closures through their respective live authorities. A future Docker-import transaction must borrow this exact live output after its own review; this diagnostic does not create an image candidate.

## Operation and gates

The one-time workflow is manual on reviewed protected main, run 1 attempt 1, with `contents: read` and `actions: read`. It verifies the checked-out recipe SHA, requires at least 12 GiB of free temporary storage for both source builds and ZIPs, the public base and output plus margin, publishes no artifact, and has no Docker socket or package-write permission. It must finish before the accepted source artifacts expire on 7 October 2026. The native result and cleanup are still pending; passing unit tests or CI does not establish real rootfs materialization.

Focused tests cover raw scanner completeness and DiffID, content routing and mutation, live-borrow lifetime, filesystem substitution, promotion collision, abort and cleanup. Run lint, typecheck, all affected tests/builds, independent code and architecture review, exact-head Linux CI and protected-main CI before the one-time native dispatch. Rollback reverts this preparatory transaction, diagnostic and tests; it changes no service, registry package or persistent user data.
