# TASK-0005A — owned Gosu cache cleanup repair

Status: implementation plan. Scope is limited to the Gosu preparation scratch tree cleanup after run `38192612138` demonstrated that Go module-cache directories can become read-only.

## Defect

The preparer currently calls `rm(scratch, { recursive: true })` after changing only the scratch root mode. Go creates nested module-cache directories with mode `0555`; recursive removal can fail with `EACCES`. Because cleanup runs in `finally`, that failure can also replace an earlier preparation error.

## Boundaries

- Remove only `aw-gosu-preparation-1` or `aw-gosu-preparation-2` beneath the already verified runner temporary parent.
- Reject the parent itself, filesystem roots, wrong child names, missing targets, symbolic-link roots and targets outside the canonical parent.
- Traverse with `lstat` and never follow symbolic links.
- Change directory permissions to `0700` before visiting children and removing the directory.
- Unlink symbolic links and multiply linked files without changing their targets or inode permissions.
- Bound traversal by entry count, depth and path length while accommodating the pinned compiler and Go caches.
- Preserve the primary preparation failure when cleanup also fails and emit a fixed `gosu_cleanup_failed` marker without raw cleanup details. Report cleanup failure when cleanup is the only failure.
- Do not remove the public output tree, retained materials, transport archives or any arbitrary caller-selected directory.

## Test-first validation

1. Reproduce the current cleanup failure on Linux with an owned nested `0555` Go module-cache tree.
2. Verify successful removal after the repair.
3. Reject wrong-child, parent/root-boundary and symbolic-root inputs.
4. Verify an external symbolic-link target remains untouched.
5. Verify a hard-linked external file retains its permissions and content while the owned link is removed.
6. Verify cleanup-error precedence does not mask a primary preparation error.
7. Run the focused tests with pinned Node 22.23.2 on Windows and Linux, followed by repository lint and diff checks.

Rollback is deletion of the bounded helper and restoration of the prior `finally` cleanup. No production image, registry, Native profile, source pin, lock, workflow or admission authority changes are in scope.
