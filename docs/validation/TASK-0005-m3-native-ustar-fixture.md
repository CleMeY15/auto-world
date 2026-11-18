# TASK-0005 / M3 native large-member fixture

Implementation owner: Codex gpt-6.2-astra, ultra. Isolated branch
`t3/native-os-fixture-qualification` from main
`5d0599cdeb3589b0c2ab0e42778769c9ad771b32`. Parent owns independent
review, integration order and acceptance. TASK-0005/0005A remain in progress.

## Scope and plan

The [accepted plan](../../roadmap/plans/TASK-0005-postgres-gosu-material-capture.md)
requires representation and capacity evidence before retention. The observed
OpenSearch archive length motivates one synthetic payload of 2,429,026,304
bytes. All input bytes and expected identities for this experiment are in the
repository. No build, scanner, package, database or daemon input is needed.

1. Write one fixed two-member USTAR fixture at a time. Exercise member lengths
   2 GiB ± 1 byte and exact, archive lengths 2 GiB ± 512 bytes and exact, then
   the measured-size case. Verify bounded reads, exact bytes and closed EOF.
2. Independently list and read with each OS tar. Require native NTFS for the
   Windows file. Check late corruption, truncated/missing terminator and an
   additional member against the same verifier.
3. Run serial local checks and the focused path-filtered hosted matrix.
   Preserve first-attempt results, including actual tool errors. Parent
   reviews the exact source and per-OS originals before any profile decision.

## Reproduce and inspect

From the checkout root on Linux run
`python3 -I -B scripts/fixtures/m3_native_ustar.py`. On native Windows run
`python -I -B scripts/fixtures/m3_native_ustar.py`. Stdout is the JSON result.
Stderr carries current case and native diagnostics. The PR job checks out its
head SHA and main checks out the push SHA. Each OS retains only its result as
`m3-ustar-<runner>-<run ID>-<attempt>` for 14 days. Check the source SHA,
script hash, platform/tool version, seven rows, four refusals and cleanup.
A missing or incomplete result leaves that runner unqualified.

Scratch is an exclusively created, fixed `auto-world-m3-ustar-fixture`
directory under RUNNER_TEMP (local Linux: TMPDIR or /tmp, local Windows:
TEMP). A collision stops the run. Windows queries GetVolumeInformationByHandleW
on the open fixture before writing data. Only the one fixture file is
created, written densely and reused. Peak logical bytes are 2,429,029,376
(including the extra-member control). Preflight requires 3 GiB free on its
volume. Hash reads are at most 1 MiB. Work has a 25-minute deadline inside a
30-minute hosted job. Cleanup checks file and directory identities and uses
unlink/rmdir. Forced termination may leave scratch behind and cannot report
cleanup success.

The independent Linux seed-file digests cover a fixed prefix, zeros, then byte
values 0 through 15. The fixture writes these bytes into stdlib USTAR headers.
Each native tar must list exactly two paths and emit the exact manifest and
payload through stdout to EOF. The stricter fixture reader checks the fixed
headers, all padding, two zero end blocks and exact file length, including
cases native tar may accept permissively.

## Evidence and limits

Local development pass on Ubuntu 26.04.1, GNU tar 1.35: seven positive rows,
four intended refusals, scratch removed. The measured-size case consumed
2,429,026,304 payload bytes in 2,429,028,864 TAR bytes. Exact-revision local
checks are recorded in the draft PR. Hosted Ubuntu 24.04 and Windows 2025
results require their own original artifacts and independent review.

This exercises native file offsets, fixed USTAR representation and native
listing/streamed extraction to stdout. Selection of a shipping verifier,
larger/outer layer limits, ENOSPC/interruption, NTFS promotion or restore,
real publication and retention capacity remain open. No application package,
production scanner, existing ceiling, UI or CLI changes. Ordinary CI quality
gates retain their existing scope. Rollback is a targeted revert of the
fixture, focused workflow and this note. Preserve historical run evidence.
