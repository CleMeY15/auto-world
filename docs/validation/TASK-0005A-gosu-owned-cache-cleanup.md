# TASK-0005A Gosu owned-cache cleanup validation

Status: local implementation verified; independent review, PR CI and any later manual preparation run remain separate gates.

## Defect evidence

Manual preparation run `38192612138` is preserved without modification. Its original workflow log archive is `.omx/gosu-real-preparation-run38192612138-v1/run-logs.zip` (22,432 bytes, SHA-256 `8494573fe6083d1ed3a9198a4109ea4dc091f32a8aebffd9969596977ad9413d`). The bounded diagnosis is `.omx/gosu-real-preparation-cleanup-diagnosis-v1.log` (1,563 bytes, SHA-256 `2a652eafcd9dc9f0641402616a405337329881d13c245112fe73b36070337048`).

A fresh Linux Node 22.23.2 reproduction of the former `finally` logic created an owned nested Go module-cache directory with mode `0555`. Changing only the scratch root to `0700` and calling recursive removal failed with `EACCES` on `rmdir`. The raw stderr is `.omx/gosu-owned-cache-cleanup-v1/red-linux-current-finally.stderr.log` (64 bytes, SHA-256 `6e372ab40f5ef7f9047a95aa5af169a9107d42f067953ef3bc7e58c5a30f62f1`).

The archived run and reproduction establish the cleanup defect. They do not establish whether the workflow had an earlier preparation failure, so the primary preparation result remains `NOT_ESTABLISHED`.

## Implemented boundary

The preparer now removes only the canonical `aw-gosu-preparation-1` or `aw-gosu-preparation-2` direct child of the verified runner temporary parent. It rejects filesystem roots, the parent itself, wrong child names, symbolic-link roots and symbolic ancestors. Traversal uses `lstat`, does not follow symbolic links, changes owned directories to `0700` before visiting their children, and changes singly linked regular files to `0600` before unlinking them. Symbolic links and multiply linked files are unlinked without changing their targets or shared inode permissions.

Traversal is limited to 100,000 entries, depth 64 and 4,096 bytes per relative path. A limit or filesystem failure can leave a partially removed owned scratch tree; it remains a real cleanup error. The helper never accepts the output sibling, its retained materials, a caller-selected arbitrary directory or the runner temporary parent.

If preparation and cleanup both fail, the primary error remains the first public error line, a fixed `gosu_cleanup_failed` second line makes the cleanup failure observable without raw details, and both errors remain available in an `AggregateError`. If cleanup is the only failure, the cleanup error fails the command.

## Verification

All commands used the pinned Node.js 22.23.2 toolchains. Raw stdout, stderr, command and exit-code files are retained under `.omx/gosu-owned-cache-cleanup-validation-v3`.

- Windows focused Gosu suite: 26 tests, 25 passed, 1 platform-specific Linux namespace test skipped, exit 0. Stdout is 6,050 bytes, SHA-256 `b0e0294d201c7fed74515dc2ba9a474c0d94584941339bc0fd9af3f3daefce8d`; stderr is empty.
- Linux focused Gosu suite: 26 tests passed, no skips, exit 0. Stdout is 6,100 bytes, SHA-256 `3bdaf3a6358afb92975697dad22f288db68266fce0436be7dc2d3ee8cd0fc638`; stderr is empty.
- Repository lint: 12 package lint tasks passed, exit 0. Stdout is 4,988 bytes, SHA-256 `f1df639814d9a49f6a2e88e61183bee7809a68412a581e1e31a7b23cc247cdc2`; stderr contains only the Turbo version line and is 19 bytes, SHA-256 `6a63836a7a9b1c64b4a35a77e2f6b046a221ab1788818ce02056f2c0f1e10188`.
- `git diff --check`: exit 0 with empty stdout and stderr.

The focused regression covers nested read-only module-cache directories, parent/root/wrong-child rejection, symbolic roots and ancestors, external symbolic-link preservation, hard-link permission preservation, the depth bound, cleanup-only failure and simultaneous primary/cleanup failure.

No Go compiler or downloaded binary was executed for this repair. No workflow was dispatched, no image was built or published, and no admission or support authority changed.
