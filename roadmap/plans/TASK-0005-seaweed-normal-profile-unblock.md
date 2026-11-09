# TASK-0005 — Unblock the unchanged Seaweed normal profile

Date: 2026-11-09. Status: ACCEPTED_FOR_DIAGNOSTIC_IMPLEMENTATION. Architecture APPROVE followed by distinct Critic APPROVE on candidate SHA-256 `5944db1a4edc395fa0d3ef792dcfe05bde285cb9ffe7daa2854bcc9e19c08583`. The preceding critic revision required the single immutable capture below; this status note adds no capability. Amendment to [the maintained Go derivative plan](TASK-0005-seaweed-managed-go-refresh.md). No image admission, publication, support activation or production change.

## Actual diagnostic

The exact source89eef28 recipe materials were reproduced locally after fresh official-scanner and exact-Go-builder qualification. The default BuildKit ignored resource flags, so two standard bounded containers executed the exact preparation/profile scripts instead. Each verified two CPUs,8GiB/no swap and2,048 PIDs; preparation used bridge networking and tests/build used none. This is diagnostic equivalence, not managed Buildx acceptance. Original evidence stays in owned private diagnostic scratch.

Preparation, package listing, capture, build and build validation return0; tests return1. The complete reader validates24,242,992 original bytes,96,563 events and49 ordered chunks, stream SHA-256 `21942c158663f93415d229b842cef6bb00c2a0a035a4ccfd63c485b692c066a6`. There are234 packages (156 pass,2 fail,76 skip) and14,290 tests (14,195 pass,23 fail,72 skip). All148 skip identities remain unreviewed. No runtime eligibility follows.

Twenty-two erasure-coding tests fail before their behavior runs: the upstream harness reconstructs a source path from `runtime.Caller`, whose path is intentionally trimmed. Its implicit build attempts `chdir github.com/seaweedfs/seaweedfs/weed`. One server test fails while resolving `oauth2.googleapis.com` before constructing a GCS client; no API exchange is needed.

Separately, three IAM output events match the credential filter even though their subtests, parent test and package pass. The original test helper logs successful XML responses and an expected NoSuchEntity response; production error logging emits the third event. These are two fixed public upstream test fixtures, not an asserted AWS documentation example. Changing production logs alone cannot fix this without changing a legitimate API response. Do not patch the API, upstream tests, fixture inputs, assertions or original events.

## 1. Use the upstream prebuilt-binary contract

Run the existing exact normal-profile build once before the tests, into the owned absolute temporary executable path. Preserve all compiler/environment/readonly/trimpath/buildvcs/ldflags settings and derivative identity. Supply that path as `WEED_BINARY` to the otherwise unchanged full Go test command. The upstream harness explicitly accepts this variable before attempting its implicit build; its README and integration workflow use this mechanism.

Record the binary hash before testing, retain the same binary afterward, and require the final hash to match before successful build validation. Tests must exercise this candidate, not a second implicit build. On build failure, retain original build stdout/stderr/status, mark tests and capture125 NOT_RUN, preserve the canonical empty stream/manifest and no chunks, and keep build validation nonzero. Add a strict reader branch for only this explicit failed-build shape: failed result, no test success or runtime eligibility. Reject contradictory zero statuses, fabricated events, missing evidence or a credential profile in this branch. Existing preparation-failure behavior remains.

## 2. Resolve the single offline test hostname

Add the standard `--add-host oauth2.googleapis.com:142.250.72.10` argument to exactly the two Seaweed Buildx commands (runtime and evidence). The IP is the existing neighboring upstream test's deterministic resolver fixture. Keep every `RUN --network=none`, the SSRF guard and all source/test bytes unchanged. No DNS server, external connectivity, resolver bypass, extra host mapping, new dependency or image-layer `/etc/hosts` edit is introduced. The mapping belongs only to build execution; final image configuration and runtime behavior stay unchanged.

For local diagnostic verification, use the same host argument on the owned networkless profile container. First run the unchanged failing server test and erasure-coding package with the exact prebuilt candidate; then rerun the whole normal profile with fresh original evidence. A targeted success does not replace the full run.

## 3. Classify only the measured public test-fixture emissions

Introduce a dedicated, fixed Seaweed export entry point and internal profile `SEAWEED_IAM_PUBLIC_FIXTURE_V1`. The generic `exportManagedTextEvidence` entry point and its credential policy remain strict for every existing caller. Reuse the current full-tree bounds, regular-file/link checks, UTF-8 checks, original-byte hashing and atomic write-after-all-validation behavior; do not build a second permissive exporter.

Capture the bounded tree once into privately owned immutable byte snapshots. The complete test reader, source-binding checks, classifier and final export must consume that same capture. Neutralize only an in-memory copy for scanning, then write exactly the original captured buffers. Do not reread or re-enumerate the filesystem between capture, validation and writing; expose no mutable snapshot aliases to callers. Add a regression that changes the filesystem after capture and proves the validated/exported bytes cannot diverge.

Trees with no credential-pattern match retain generic behavior, including failed-preparation/build evidence. If the Seaweed-specific entry point encounters a match, require the complete existing manifest/package/event reader and the source binding below before classifying any position. Other image roles cannot select this profile; callers cannot provide arbitrary allowed tokens, paths, hashes or replacement patterns.

Bind the existing source commit/archive and exact original/corrected module hashes, plus these archive-verified unchanged files. Preparation must verify and export their fixed identities before source execution:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| `weed/iamapi/iamapi_authz_test.go` | 8,153 | `1bcd8c6bf19ff9727d5836ba3253c8291710122bb1068cfab8264ef77d2b0285` |
| `weed/iamapi/iamapi_management_handlers.go` | 68,613 | `20c370620e0f15f342c90aad57a6b956e67b4ff4f43a7c486d242f9f2aa9e7a2` |
| `weed/iamapi/iamapi_handlers.go` | 1,854 | `cb4ee02bb29825df0a27a8bf275f7db73da1d3ecbe415d6c22b02fe843af5966` |

Require exactly three occurrences across the entire tree, exclusively in JSON `Output` of package `github.com/seaweedfs/seaweedfs/weed/iamapi`, action `output`, under `TestImplicitUserNameUsesVerifiedIdentity`:

- `ListAccessKeys`: one full20-byte fixture, SHA-256 `1a5d44a2dca19669d72edf4c4f1c27c4c1ca4b4408fbb17f6ce4ad452d78ddb3`, in the exact successful XML envelope for `power_user`, Active status and nontruncated result.
- `UpdateAccessKey`: two occurrences of the distinct full21-byte fixture, SHA-256 `700044f094b68554a5831fb859c2ea6c501d142bc5c9602d41dd6452f5212d52`, once in the exact `iamapi_handlers.go:30` error-log envelope and once in the NoSuchEntity XML envelope for `power_user`. The generic regex matches only its first20 bytes; do not authorize that prefix independently.

Bind the complete upstream-derived envelope, allowing only its documented dynamic timestamp/request-ID fields with their exact formats. Require PASS terminals for both subtests, their parent and the IAM package. Classify only the fixed literal values reconstructed from the pinned source fixtures and confirmed by their full-length hashes; no user-supplied classifier data. A fourth occurrence, duplicate envelope, different full value/suffix, different field/package/test/action, failing or absent IAM terminal, source drift, incomplete/malformed/reordered events or another credential form refuses atomically.

For credential scanning only, neutralize precisely those validated positions in an in-memory copy; apply the unchanged generic pattern to all remaining content. Export the original bytes and original manifests without transformation. Public receipts contain profile ID, source/event/stream hashes and counts only, never the fixture text. This profile grants only permission to export these exact public-source fixture emissions. It does not waive failed tests, skips, vulnerabilities, generic main-module coverage or runtime/admission gates.

## Review and verification

Architecture review followed by a distinct Critic review is required before implementation of this amendment. Keep execution repairs and the exporter classifier in separate owned implementation slices; integrate the shared audit file under one owner. Obtain a distinct implementation review before pushing.

Regressions must prove the prebuild is unique, `WEED_BINARY` identifies the same final bytes, a changed binary is refused, build failures preserve original diagnostics and canonical NOT_RUN semantics, and every original test flag remains. Prove the DNS mapping appears only on both Seaweed builds and network isolation remains. For the classifier mutate each binding/count/value/suffix/envelope/field/terminal/manifest/source predicate; preserve generic refusal tests, add other-credential and unrelated-file injections, and verify byte-identical output plus atomic refusal. Preserve the whole-file audit integrity guard by updating its reviewed actual hash, never deleting it.

Run affected native tests, lint, typecheck, build, secrets/dependency checks and the existing combined quality gates. Retain all original actual failure evidence. Fresh same-job scanner/builder qualification and the full managed CI workflow remain mandatory. Review the actual skip identities separately before accepting a normal profile; no allowance is inferred here. Actual main-module inventory, Rust helper binding, runtime, provenance, retention/restoration and final acceptance remain open.

## Pinned upstream evidence

[Harness contract and path reconstruction](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/test/volume_server/framework/cluster.go), [prebuilt-binary documentation](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/test/volume_server/README.md), [upstream integration workflow](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/.github/workflows/volume-server-integration-tests.yml), [offline resolver fixture and failing test](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/weed/server/volume_grpc_remote_test.go), [IAM fixtures and original response logging](https://github.com/seaweedfs/seaweedfs/blob/ffa87c25fdf587178b1521ad87f2a4a72a02e584/weed/iamapi/iamapi_authz_test.go).
