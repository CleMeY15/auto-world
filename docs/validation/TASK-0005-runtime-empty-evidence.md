# TASK-0005 — Empty public runtime evidence

Status, 26 October 2026: REVIEWED_REPAIR_IN_PROGRESS / FRESH_LINUX_ACCEPTANCE_PENDING. TASK-0005/0005A remain IN_PROGRESS; no merge, B0, admission or support activation is established.

## Actual checkpoint and failure

[Source9c6f540](https://github.com/CleMeY15/auto-world/commit/9c6f5400c81db306d57d1ddcc6780f3e77a87a7e), tree `41208bd81111b87047f279e6131ce19fad0cc118`, passed independently reviewed [quality40372965590](https://github.com/CleMeY15/auto-world/actions/runs/40372965590): lint/types/tests/build/security,2,615 root passes/60 existing skips,624 workspace passes,393 browser passes/7 existing WebKit skips, no failure/flaky/retry. The actual PR merge checkout `534ec933c69ddf2609b7930e8913fc54c323a97e` has parents maina52884b2 plus9c6 and the identical tree. These results are historical for the next changed source.

[Managed40372965559 attempt1](https://github.com/CleMeY15/auto-world/actions/runs/40372965559) passes scanner qualification, DB/fixtures, both builders, all three builds and all five image audits within their measured coverage. Independent original review confirms41 exact managed source files, all seven JSON/SBOM pairs and complete OpenSearch native output:1,735 cases,1,687 passes/48 known skips/zero failures. SeaweedFS4.51 has corrected curl/libcurl8.23.0-r0 and the expected configID; its separate Rust coverage/provenance limitations remain in [the candidate record](TASK-0005-seaweed-451-candidate.md).

The run fails at `produced_image_runtime`: clean Node exit1, no signal/error, private output withheld, then missing `runtime-result.json`. Four case outcomes and runtime-owned cleanup remain NOT_ESTABLISHED. The28 scanner-owned container-absence checks do not establish runtime cleanup. Original ZIP:2,210,266bytes, SHA256 `0e4004fa03e9fd634412ac55a1f0ec30f0a2087ed2435bd69170d6a377c06e2b`;317 safe regular files/14,932,777 extracted bytes. Earlier failures and positive source boundaries remain preserved.

## Demonstrated mismatch

The producer forwards all264 public managed evidence files, including exactly one legitimate empty file: `opensearch/build/test-output-fixture.log`, size0 and SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. The extracted original matches. The runtime schema and actual reader both require positive size for every proof. A controlled input changes only that proof from positive to the real empty proof and switches from acceptance to rejection. Root and an actual independent debugger confirm this necessary pre-context rejection. No private stack/subcase detail is inferred.

Because `context = await initialize()` never completes on that rejection, no result is written. The parent's unconditional read then masks the failure as ENOENT. An absent result alone cannot prove which case ran or whether runtime resources were cleaned.

## Reviewed repair and verification

The bounded deliberate plan SHA256 `a8dfd5d3b360c7822ace461deb54961b2882618b3eb8d31e3f9cd0ab04b18bb4` received actual Architect APPROVE then distinct Critic APPROVE. Its COMPLETE handoff and implementation plan were published/read back in [PR199](https://github.com/CleMeY15/auto-world/pull/199) before code edits.

Accept zero bytes only for typed `role.evidence`, with the canonical empty hash. Preserve that classification through deduplication, initial IO and every revalidation; size/hash alone never grants authority. Retain every original file and all regular-file/owner/nlink/canonical-path/no-follow/nonblock/stable-identity/EOF/hash checks. Source inputs, reports/SBOMs, runtime-input and archives remain positive. An absent result yields finite publication non-acceptance without private output, fabricated case outcomes or cleanup proof; uncertain termination keeps its stronger refusal.

Required regressions use real small non-root Linux files for empty acceptance, default-strict refusal, wrong hash/size, revalidation, missing files and reproducible symlink/hardlink refusals. Owner/link/identity guards remain unchanged; no privileged chown or new mocking framework is introduced. Startup preparation with complete empty evidence stops before Docker. Missing-result IO must emit only the finite failure, including when the child exited0; existing valid/invalid results and private-output controls remain. Windows Linux-only exclusions are explicit, never native proof.

Prepared-source verification: two actual independent source/test reviews PASS after the directly coupled adapter-hash regression and cross-type/publication tests were completed. Exact workflow-style pure suites on pinned Node22.23.2 pass400 tests:365 passes/35 explicit Windows exclusions/zero failures. Three new real-file tests require non-root Linux execution. Syntax, targeted ESLint, whitespace and Secretlint on1,180 files pass. The new diagnostic adapter SHA256 `9c6409f318a819237b3dd793751d335314346959bddb6d1151b6b21f373a1feb` is deliberately bound in the existing OpenSearch source guard; every other frozen guard remains unchanged. No LSP service is available; actual parser/refusal/IO tests and fresh Linux CI provide the stated verification, without invented diagnostics.

Fresh quality and complete managed Linux runs must execute these regressions, qualify/audit the exact subjects, retain OpenSearch causal/full evidence, and pass all four real runtime scenarios plus cleanup. Independent source/original-artifact review, protected merge and matching main checks remain required. Prior9c results do not transfer. Final17 phases, full private retention/second-copy restore, signing/admission and support activation remain separate.

No image pin, recipe, frozen gen5/shared policy, cap, resource limit, Java-age rule or Rust profile changes. Only the official diagnostic adapter's finite result handling may change its source hash. Rollback reverts this unadmitted consumer/diagnostic repair while preserving data, volumes, artifacts and historical retention duties. New support dates stay null.
