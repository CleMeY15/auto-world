# TASK-0005A — exact Go module-info cache identity

Status: DONE_ON_MAIN for the source correction in [PR155](https://github.com/CleMeY15/auto-world/pull/155), identical reviewed merge and final/main CI SUCCESS. Actual preparations remain unaccepted; diagnostics for distinct run38200213629 are in progress.

## Defect

The preparer authenticates each public module proxy `.info` response and later compares the Go-reported cache `Info` file to those same wire bytes. Go 1.26.9 deterministically rewrites the nested `Origin` object with `Hash` before `Ref`, while the authenticated proxy response has `Ref` before `Hash`. Values and byte lengths are unchanged, but exact byte identities correctly differ, producing `gosu_module_cache_invalid`.

Go 1.26.9 implements this boundary by decoding the proxy response in [`proxy.go`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/proxy.go#L342-L361) and writing a newly marshalled cache record in [`cache.go`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/cache.go#L223-L247) and [`cache.go`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/cache.go#L564-L594). The fixed field order comes from the [`codehost.Origin`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/codehost/codehost.go#L82-L115) and [`RevInfo`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/repo.go#L71-L82) structs. The [module proxy protocol](https://go.dev/ref/mod#protocol) defines `.info` transport; its bytes are pinned here for transport integrity and are not authenticated by the checksum database.

## Change

- Preserve each existing `info.file`, `info.bytes` and `info.sha256` as the exact authenticated proxy material identity.
- Add one closed `info.cache` descriptor per locked module with exact byte count and SHA-256 for the Go 1.26.9 cache serialization.
- Lock the measured Go cache bytes directly; do not reproduce Go's private serialization rules in JavaScript.
- Extend the existing controls consumer only enough to accept the new closed field and enforce the two fixed module-specific cache identities.
- Validate the cache descriptor as a closed object with the fixed module-specific identity before creating preparation paths or downloading material.
- Validate the complete lock and exact two-entry ordered module collection before returning from `loadLock`; reject omitted, empty, single, duplicate, unknown and reordered collections.
- Continue comparing `Zip` and `GoMod` cache files to their authenticated wire identities; compare runtime `Info` only to the distinct locked cache identity.
- Keep the compiler, source, module versions, h1 sums, proxy URLs, receipts, workflow, registry, Native and admission boundaries unchanged.

## Test-first verification

1. Preserve a RED test showing the previous comparator rejects the authentic Go 1.26.9 cache bytes.
2. Prove authenticated wire `.info` and cache `.info` identities independently.
3. Reject every byte mutation and the observed `Ref`/`Hash` order substitution.
4. Reject missing, extra, non-integer, non-positive, wrong-length and non-hex cache descriptor fields, plus altered fixed identities.
5. Run pinned Node.js 22.23.2 focused Gosu tests on Windows and Linux, repository lint, typecheck, applicable build, syntax/static checks and diff validation.

Rollback removes the cache descriptors and restores the prior `Info` comparison. Actual preparation must remain blocked until this source repair receives independent review, merge and green CI.

## Accepted main integration and final closure

Accepted TASK0103/PR152 maincf71211d36e4ca49d6c6d88254eeca91d0517904 is integrated with source/merge tree10b9c94f91f9de681ea47cd7a1889f8ef7614a51; final CI38196985003/main CI38197621255 SUCCESS. The prior47-file integration review is CLEAR, index8811bytes/SHA2566e354635aa62a7d801e2f61fbd426f7d418c1dd6f8424053bd8eee102a4eb18a. Four Gosu implementation files remain byte-identical to accepted source5f136ce. The documentation closure records web delivery and the pending Gosu final/main gate. Historical source/CI/actual failures remain immutable. This exact integrated final head must pass independent review and full CI, merge with the same tree and pass main CI before a distinct actual preparation. No supported-service, image, registry, Native or support acceptance follows.

## Source delivery and distinct actual rejection, 2026-10-12

PR155 source correction is DONE_ON_MAIN: final head4731e9464fc828dd4b92f4345769a478d8eedb90 and merge/main59e5b157d93dd12f31d14924a9d8cf8571e83b18 share tree35c4dd782934865cf056cae4a3dfc5c227f8b2f3. Independent49-file source closure CLEAR and final CI38198975540/main CI38199524012 SUCCESS are independently verified. Main raw log1415659bytes/SHA256e1f004004a935f7de26f9b1a55ab5454acdc4ab449f1d3ab2ea8a95b4e043a4b and metadata3368bytes/SHAd957a7bc35c883edb669c58cac3f6e42dcc356a37bcc750ff4efc4b025b6b685 are retained CNEW.

Distinct actual preparation38200213629 attempt1 on that accepted main failed both build jobs before upload; zero artifacts and comparison skipped. Both original logs report gosu_command_failed without a cleanup marker. The first retained original ZIP22434bytes/SHA256a1879ccc04ffb7bfe1c2c4703cbddc74c5e606830dba7343d251b3042ae35e33 and all zero-byte CLI refusals remain preserved. Failure index4624bytes/SHA256415c700c5968a127193e4a68601ed7352716d801a41295ce5ddeb1e15c420253 binds the exact run/API/log identities. The historical failing command/cause is NOT_ESTABLISHED because run() discarded its command result. A closed stage/reason diagnostics increment is in progress; no workflow retry, actual preparation acceptance, image, Native, admission, support or currentEvidence change follows.
