# TASK-0005A Go module-info cache validation

Status: DONE_ON_MAIN for the source correction in [PR155](https://github.com/CleMeY15/auto-world/pull/155), identical reviewed merge and final/main CI SUCCESS. Actual preparations remain unaccepted; diagnostics for distinct run38200213629 are in progress.

Revision 1's six source hashes and raw evidence remain immutable under `.omx/gosu-module-info-cache-freeze-v1`; its rejected index is 15,347 bytes with SHA-256 `9f56c7af71ce34fab7ebbeaf8f75acb86f6685076455f43a2efb50f7269ed033`. The reviewer found that `value.modules ?? []` validated only entries that were present, allowing an omitted, empty, partial, duplicate or reordered collection to bypass the claimed complete early validation.

## Evidence and failure history

Manual run `38192612138` failed while cleanup masked any earlier preparation result. Manual run `38194957502` ran from accepted main `9e322643e3a60db5deab907104afa6d3a0c940d8`; both build jobs failed at preparation, and `build_2` exposed the primary closed code `gosu_module_cache_invalid`. Neither run produced a preparation artifact or comparison record.

The bounded diagnosis `.omx/gosu-module-cache-diagnosis-v1.json` is 2,323 bytes with SHA-256 `b732cf298592df40f3a89d13c40f9c13b19dff25e06116b518ae40cab450ed13`. Its identity probe `.omx/gosu-module-cache-identity-probe-v1.json` is 4,549 bytes with SHA-256 `2a0f879d7c09098d4b11baa730228224300f7cf5f32ec398227bc9cb47f6bfce`.

The probe authenticated the existing proxy materials, ran only `go mod download`, and measured the paths returned in the Go command's `Info`, `Zip` and `GoMod` fields. `Zip` and `GoMod` matched their existing locked bytes. The proxy `.info` and cache `.info` had identical values and lengths but different exact serialization:

- `github.com/moby/sys/user@v0.1.0`: public proxy bytes remain 205 bytes / `fbd7c2599ef36388330302f30dd4a7a40808acd6b492db42e4db23129ad42a77`; the Go 1.26.9 cache identity is 205 bytes / `ff3925ca40df076cf8a142585adea7062106e3601a206caa84af3b0a57d0df72`.
- `golang.org/x/sys@v0.1.0`: public proxy bytes remain 188 bytes / `e93abfc8737fa1e3f7e88ab6c26cf9e8cea4c2cc5378b829664d9f7948616235`; the Go 1.26.9 cache identity is 188 bytes / `9e1b3869f6fd67d974f364d46713ecc2fd8ced9fbf260ed745a83b0f21b28e8d`.

The proxy response orders `Origin.Ref` before `Origin.Hash`; the Go cache orders `Origin.Hash` before `Origin.Ref`. Go 1.26.9 decodes proxy JSON in [`proxy.go`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/proxy.go#L342-L361), then writes a fresh JSON cache record in [`cache.go`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/cache.go#L223-L247) and [`cache.go`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/cache.go#L564-L594). The stable field order follows [`codehost.Origin`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/codehost/codehost.go#L82-L115) and [`RevInfo`](https://github.com/golang/go/blob/go1.26.9/src/cmd/go/internal/modfetch/repo.go#L71-L82).

The existing public `.info` hashes remain exact transport-integrity pins for the [module proxy protocol](https://go.dev/ref/mod#protocol). The checksum database does not authenticate `.info` bytes. The new cache identities are separately locked measurements; the implementation does not reproduce Go's private serializer in JavaScript.

## Implemented boundary

Each module's existing `info.file`, `info.bytes` and `info.sha256` still authenticate the downloaded public material and retained `materials/*.info` file. A new closed `info.cache` object contains only `bytes` and `sha256`. The controls consumer requires the exact module path, version, byte count and digest for both known modules and rejects unknown, missing, extra, inherited, malformed or coordinated substitute values.

The builder now calls the existing pure complete lock validator while loading the lock, before returning to code that creates owned paths or downloads materials. That validator requires the exact ordered two-module collection and validates both cache descriptors. Runtime cache verification continues to compare `Zip` and `GoMod` to the public locked identities and compares only `Info` to `info.cache`. The receipt material identity remains the public proxy `.info` identity.

## Verification

The pre-fix RED transcript is retained under `.omx/gosu-module-info-cache-red-v1`: the former comparator rejected the authentic Go 1.26.9 cache bytes, and the new identity selector was absent. Its stdout is 1,517 bytes with SHA-256 `6c3b176793c9f13e55c45057565e965a298cdaf796f81ce4acb8b2725de277f7`.

Pinned Node.js 22.23.2 verification logs are retained under `.omx/gosu-module-info-cache-validation-v1` and `.omx/gosu-module-info-cache-validation-v2`:

- Windows Gosu suite: 30 tests, 29 passed and the Linux namespace test skipped; exit 0. Stdout is 6,849 bytes, SHA-256 `3d5f6ad41290a78df76ab78c6d8342aee278c70b630fc3c61e01c0fbd0bea89e`.
- Linux Gosu suite: all 30 tests passed; exit 0. Stdout is 6,907 bytes, SHA-256 `88019ba747d7a4598d91a5fd07ebc40592a45a4ab1bace7b35e695d95224116b`.
- Repository lint: 12 of 12 tasks passed; exit 0. Stdout is 4,988 bytes, SHA-256 `d999ec0a5925e8e8a1f1fe8b25b176458bf4414eb950a33fc577655abf1410fc`.
- Typecheck: 18 of 18 tasks passed; exit 0. Stdout is 13,506 bytes, SHA-256 `f5143dd1c7e42e19257888ec4158e1a139348c15c649e4eacb6112636db2b71b`.
- Build: 12 of 12 tasks passed; exit 0. Stdout is 8,276 bytes, SHA-256 `cb834ae25ccbc7a7ef398d7b0c97efafb5944495509ee855cd7daf4231582274`.
- Secret scan: 854 repository files passed; exit 0. Stdout is 188 bytes, SHA-256 `a61996283c777209a47d15b08a18775c9b7e48a695df79d534a0fa9a09661ef7`.

The focused tests preserve the old failure as a regression, authenticate the wire and cache identities independently, flip every byte in both authentic cache records, substitute the public wire order, and reject incomplete, extra, malformed, inherited and altered cache descriptors.

Revision 2 adds a separate RED transcript at `.omx/gosu-module-info-cache-v2-red-v1`: the complete collection validator was unavailable, while the four revision-1 identity tests still passed. Its stdout is 2,117 bytes with SHA-256 `cdee29cc5fffd7cb85f463074b05ef5a1a48bf84bddfc67980a0d5b06486dca7`.

Focused revision-2 evidence is retained under `.omx/gosu-module-info-cache-v2-validation-v1`:

- Windows controls and cache tests: 19 tests, 18 passed and the Linux namespace test skipped; exit 0. Stdout is 4,325 bytes, SHA-256 `fb3c7d281e66c3b4fc7594741fda8ea52d2da173e3cca48fcd515f72fd65d087`.
- Linux controls and cache tests: all 19 tests passed; exit 0. Stdout is 4,364 bytes, SHA-256 `e9b90705d3da9294ee5afdcc1bfcfa3a3dd2aa6bfb202e56fb501b503880a702`.
- Targeted ESLint for the builder, controls and focused test passed with empty stdout and stderr; exit 0.

The added collection regressions reject omitted, empty, single-entry, duplicate, unknown and reordered module collections. A source-order assertion binds the production `loadLock` path to the complete validator before owned-path creation and downloads.

No Go command, downloaded binary, workflow dispatch, image, registry, Native, admission or support action was performed by this source repair.

## Independent revision2 acceptance and complete implementation CI

Independent high-risk revision2 review is CLEAR: all six current source identities, all indexed raw evidence, rejected revision1 index and six before/after mappings remain exact before/after. Fresh pinned Node22.23.2 focused tests5/5 and three syntax checks pass. The existing pure full lock validator is called from loadLock before it returns; main awaits it before creating the owned scratch or starting material downloads. No source edits were made by the reviewer. Accepted freeze index9838bytes/SHA25689c9adef92dfe86e5b319ab55e3f20ad4c56fb87927fd18062cc9e8c239cf025.

Complete implementation CI38196567303 on exact source head5f136ce51db83b9f13bac4f9a3cc2be5b4e8797a/tree4ebc93e8d3cd32a96d48efef179d6877450966fc is SUCCESS in all required stages. Original raw log1396574bytes/SHA25607bc4000a42c549a25feaf23ecad6e4a3734f84b77abc66f85ef162546afcb5f and metadata3368bytes/SHA25675b1be55e5b25198beacaf747b7858892cfa809a838891edce6cded70f4cd993 are preserved CNEW. Root1994 tests:1938PASS,zero failures,56 existing platform exclusions;24 workspace test tasks including38 API and159 SDK tests;lint12/typecheck18/build12;browser10PASS/2 existing WebKit matrix/CDP exclusions,secret scan855 andaudit0. This branch's accepted baseline still contains the foundation web preview; separate TASK0103 delivery remains distinct.

This is source implementation acceptance. A documentation closure and integration of accepted main require independent final-source review, exact final-head CI, an identical reviewed merge and successful protected-main CI before any distinct actual preparation. The two failed manual runs and their original transport/log identities remain preserved; no retry, image publication, registry/Native operation, admission or support interval follows from green source CI.

## Accepted main integration and final closure

Accepted TASK0103/PR152 maincf71211d36e4ca49d6c6d88254eeca91d0517904 is integrated with source/merge tree10b9c94f91f9de681ea47cd7a1889f8ef7614a51; final CI38196985003/main CI38197621255 SUCCESS. The prior47-file integration review is CLEAR, index8811bytes/SHA2566e354635aa62a7d801e2f61fbd426f7d418c1dd6f8424053bd8eee102a4eb18a. Four Gosu implementation files remain byte-identical to accepted source5f136ce. The documentation closure records web delivery and the pending Gosu final/main gate. Historical source/CI/actual failures remain immutable. This exact integrated final head must pass independent review and full CI, merge with the same tree and pass main CI before a distinct actual preparation. No supported-service, image, registry, Native or support acceptance follows.

## Source delivery and distinct actual rejection, 2026-10-12

PR155 source correction is DONE_ON_MAIN: final head4731e9464fc828dd4b92f4345769a478d8eedb90 and merge/main59e5b157d93dd12f31d14924a9d8cf8571e83b18 share tree35c4dd782934865cf056cae4a3dfc5c227f8b2f3. Independent49-file source closure CLEAR and final CI38198975540/main CI38199524012 SUCCESS are independently verified. Main raw log1415659bytes/SHA256e1f004004a935f7de26f9b1a55ab5454acdc4ab449f1d3ab2ea8a95b4e043a4b and metadata3368bytes/SHAd957a7bc35c883edb669c58cac3f6e42dcc356a37bcc750ff4efc4b025b6b685 are retained CNEW.

Distinct actual preparation38200213629 attempt1 on that accepted main failed both build jobs before upload; zero artifacts and comparison skipped. Both original logs report gosu_command_failed without a cleanup marker. The first retained original ZIP22434bytes/SHA256a1879ccc04ffb7bfe1c2c4703cbddc74c5e606830dba7343d251b3042ae35e33 and all zero-byte CLI refusals remain preserved. Failure index4624bytes/SHA256415c700c5968a127193e4a68601ed7352716d801a41295ce5ddeb1e15c420253 binds the exact run/API/log identities. The historical failing command/cause is NOT_ESTABLISHED because run() discarded its command result. A closed stage/reason diagnostics increment is in progress; no workflow retry, actual preparation acceptance, image, Native, admission, support or currentEvidence change follows.
