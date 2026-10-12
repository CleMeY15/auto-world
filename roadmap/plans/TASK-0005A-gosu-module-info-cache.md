# TASK-0005A — exact Go module-info cache identity

Status: DONE_IMPLEMENTATION / DELIVERY_PENDING in [PR155](https://github.com/CleMeY15/auto-world/pull/155). Strict source revision2 has independent high-risk CLEAR and full implementation CI38196567303 SUCCESS. Exact final-head/main delivery and a distinct actual preparation remain pending; preparation/admission/support are NOT_ESTABLISHED/NOT_AUTHORIZED.

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
