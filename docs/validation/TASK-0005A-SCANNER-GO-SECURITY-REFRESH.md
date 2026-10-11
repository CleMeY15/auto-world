# TASK-0005A — Scanner Go security correction and generation 5 PENDING

Status: **IMPLEMENTED; INDEPENDENT REVIEW AND DELIVERY GATES PENDING**, 2026-10-11. This focused increment repairs the diagnostic scanner and prepares PostgreSQL generation5 `PENDING`. TASK-0005A and TASK-0005 remain `IN_PROGRESS`.

## Actual failure and bounded repair

The unique [current-audit run38176358212](https://github.com/CleMeY15/auto-world/actions/runs/38176358212), attempt1, used reviewed protected main `bc08bf72e39e2af7a9da5cbc2a67c59380540519`, tree `015b6d8785c09f463dba9931a7feade8055bb17f`. Both scanner builds reproduced binary SHA256 `1255e0feaf879d9b34fa7b8842e4b3dca53429171b03b2576fafdee218a59e3d`, 168288382bytes, from original lock SHA256 `f6fc343d36d04ed4ff57549284cf6a73750ac34d487e119839bf659d8e94e232`. The audit failed at `SCANNER_CONTROLS / scanner_self_audit_blocked` and owned cleanup reported `CLEANED`.

The authenticated raw ZIP is439267bytes, SHA256 `6caa9444a77c93ed6aa14047c2bc9bad9c29dec102b083484153121fe2604f96`, matching GitHub artifact11716475806. CRC validation passes. Its eight roles include the receipt, database identity evidence/manifests and original scanner self JSON/CycloneDX. The receipt is `INCOMPLETE`, diagnostic only, with no image or registry-write attempt. No complete P2 projection was published, and no native extraction/replay or authority effect followed. The report concerns `/scanner-subject`; no PostgreSQL candidate vulnerability result is inferred.

The scanner report contains four HIGH occurrences across three CVEs: CVE-2026-78669 in x/net0.58.0, and CVE-2026-78667, CVE-2026-78669 and CVE-2026-97031 in Go stdlib1.26.8. The official [Go1.26.9 release](https://go.dev/doc/devel/release#go1.26.minor) and [GO-2026-6611](https://pkg.go.dev/vuln/GO-2026-6611), [GO-2026-6609](https://pkg.go.dev/vuln/GO-2026-6609), [GO-2026-6607](https://pkg.go.dev/vuln/GO-2026-6607) identify the fixes. HIGH is the actual scanner classification, not a severity claimed from the Go database.

The official [Go linux-amd64 archive](https://go.dev/dl/go1.26.9.linux-amd64.tar.gz) is66935201bytes, SHA256 `42d158b4d8f7b61ac0a830567c940a86098fb7aac52e467a5ebec03ef5cc2f8d`, matching [publisher metadata](https://go.dev/dl/?mode=json&include=all). [x/net0.60.0](https://go.googlesource.com/net/+/refs/tags/v0.60.0) maps to commit `18ece0ce30bc35fa81fe72028bf309bb3ff3f4a5`; its module and go.mod sums are checked through the public Go checksum service. The fourth ordered patch updates only Trivy go.mod/go.sum and the minimal selected closure; the original three patches remain exact.

## Implementation plan

1. Apply all four authenticated patches to exact Trivy source `e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994`, use the publisher-pinned Go1.26.9 archive and verify the actual module closure with read-only Go commands and empty tidy diff.
2. Reject an actual compiler identity that differs from the lock before source checkout, and reject either build receipt with a substituted compiler archive/version. Preserve reproducibility, build-info/self-inventory reconciliation and every zero-finding/blocker gate.
3. Start generation5 revision1 PENDING because build/control bytes are immutable generation4 execution pins. Preserve all generation1–4 summaries and original generation3/generation4 fixture bytes, change only the generation/locator/two scanner pins, and run genuine file-URL Node22 closure loaders including omission/mutation rejection.
4. Complete targeted and repository quality gates, independent architecture/security review, exact-head CI, identical reviewed merge tree and protected-main CI. Only then dispatch a distinct current audit on the reviewed repair. The failed original producer is never replayed.

## Identity and historical boundaries

`0.74.0-autoworld.2` remains the report compatibility version. The lock SHA, compiler archive, patches, modules, actual build-info and binary SHA distinguish the repaired build explicitly. Changing this label would need a separate historical/current validator migration; no broad version allowance is introduced here.

Original historical private-evidence scanner lock, candidate runtime configuration, PostgreSQL/Seaweed attestations and retained audit receipts remain unchanged. The generation3 ACTIVE dates stay2026-10-07/2027-10-07/2028-10-06, its failed SQL remains `NOT_ACCEPTED_NO_RETRY`, and its existing archive-health duty remains in place. Generation4 Root `e3ee73f6da32a258794a0dc21b6e4ef773b1294979b0450ba2f668d3d08c91e7` and PENDING revision1 `5cda8a56b4df41c8bdc615753f436ff8025ab857678cc104f2a6579e3f841ca9` remain preserved, including locator reconciliation and unaccepted constructor15 history from [draft PR144](https://github.com/CleMeY15/auto-world/pull/144). Its complete frozen inventory fixture is23883bytes/SHA256 `9d9ff38a8ebfcfa20cf71d1d0d9f7f7a8730900793b49a6e12ee28eeddcc4024`.

The proposed generation5 locator is448048bytes/SHA256 `7ea3950a9de95e46bd0e7b613e293e8abb5788fe03a258034e27b6e6b71b9b07`; changing only its generation back to4 reproduces the original locator bytes exactly. It is private Windows preparation, not an installed native locator. No archive object or native authority file is copied, mutated or activated by this source increment.

## Frozen generation 5 source

The generation5 canonical Root is `3d89d49e344d58b03a7f82740fb58ea8bc437c7c08452ca83b39e5330784c282`; revision1 is `b29eaef82bd2ab7f48020e23587512c5ddf7a9fedbc4f6ad269777890194660a`. The public inventory is24180bytes/SHA256 `555cade4a5dbd06beab070311d9006742ae7fe40d7c0346f11f4fe409b39f9e0`. The changed pins are build.mjs14357bytes/SHA256 `8f7f6f38af74d1288e4e3979c37ecfeceb3898344629768e3d03dc57906f5b3d` and controls.mjs15332bytes/SHA256 `ca28b19d57e21b3b778da2ff95fa31bf273f814616ce0b190533d1eeaaa82499`. The other72 pins are exact generation4 originals.

The new scanner lock is7208bytes/SHA256 `a01bc85432f1a8c70ba3a0fe0642d1e5b4542df5e781c3786652c8ef8153b84a`; patch4 is7402bytes/SHA256 `bac277b2afc815459d978af005ecd7d19a08793098c183953e7216975c1068dd`. The actual MVS closure selects x/net0.60.0, crypto0.57.0, mod0.41.0, sync0.23.0, sys0.48.0, term0.46.0 and text0.42.0, preserving the selected tools0.49.0 and vuln1.6.0. Actual fresh-source four-patch application, empty `go mod tidy -diff`, read-only download, `go mod verify` and `go test ./cmd/trivy` pass. These module/source tests do not claim a reproduced full scanner binary or a new clean self-audit.

Fresh pinned Windows Node22 targeted tests pass52cases:50passes, two explicit platform skips, zero failures. Four genuine file-URL loaders execute from a tree containing only the74 authenticated pins; omission of required resources and altered pins reject. The first targeted root run exposed an obsolete generation3 comparison in the loader test; the test now compares the unchanged72 pins against the frozen generation4 fixture. This repairs the test's history boundary without changing an execution pin or production validator. Fresh pinned local lint, typecheck, build, tracked-secret scan and dependency audit also pass. The first lint run caught an undefined test-only broker constant after the history comparison changed; the negative tests now require the expected assertion error, rejecting an unrelated exception as evidence. Complete Linux repository/UI CI and independent review remain pending.

## Operational behavior and rollback

The existing diagnostic receipt and phase logs record compiler/source/patch/module/build-info identities and failure stages; no new production runtime or observability channel is created. Compiler/receipt substitutions fail before candidate scanning. New vulnerabilities continue to deny current eligibility. Restoring the old source restores its known scanner failure and cannot authorize admission.

Abandoning this PENDING preparation preserves generation3 duty and every historical generation4 artifact. After a future activation/high-water advancement, rollback follows append-only revocation and a greater generation, never historical rewrite. Native generation5 installation, fresh current evidence, actual archive health, scheduler coexistence, activation and supported SQL are separately reviewed gates; source CI is not their acceptance.
