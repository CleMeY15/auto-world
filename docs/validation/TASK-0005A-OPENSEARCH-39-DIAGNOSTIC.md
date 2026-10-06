# TASK-0005A — OpenSearch3.9 diagnostic candidate

Status: IMPLEMENTED, validation and delivery pending, 2026-10-06 UTC. TASK-0005A/0005 remain IN_PROGRESS; TASK-0006 remains blocked. This increment changes a diagnostic pin only. [PR139](https://github.com/CleMeY15/auto-world/pull/139) records the plan before implementation.

The retained3.8.0 audit contains42 historical findings. Its public tag still identifies the same blocked subject. The official [3.9.0 release](https://github.com/opensearch-project/OpenSearch/releases/tag/3.9.0), published2026-09-29, is the next same-major candidate for a real scan. Registry/source provenance does not establish clean inventory, complete licences, admission or runtime compatibility.

## Implementation plan

1. Retain exact versioned public Docker index/platform bytes and bounded provenance for3.9.0. Preserve the3.8.0 materials and original findings. Record this record's new retrieval time separately from the original collection; do not imply that unchanged records have been fetched again.
2. Change only the OpenSearch scanner-lock version/index/platform pin. Preserve seven other image pins, scanner source/compiler/patches, clean/vulnerable controls, PostgreSQL generation2 and all support dates.
3. Add focused new-pin and historical-material checks while keeping the existing generic index/platform binding tests. Run fresh full quality gates and independent code/security and architecture review.
4. Require passing exact-head CI, an identical reviewed merge tree and passing main CI. Do not merge while the current PostgreSQL audit is running: its final protected-main check must see its reviewed recipe.
5. Invoke the existing manual scanner workflow for a real audit of the changed pin and all existing roles. Retain the original reports and all failures, compare actual3.9 findings with the historical42, and continue from measured blockers. No private publication or image admission follows from this diagnostic result.

## Candidate selection evidence

Public Docker index:647bytes/SHA256 `adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c`. Its unique unvaried linux/amd64 manifest is1622bytes/SHA256 `13487e0953520edf6cc866dfc672fd67a70ab122aa7d84d4a6c97106f84d3f84`, whose config is6545bytes/SHA256 `903c4fa852a67838269696e031077c6d726ca0a369f8b709a311083e514f1dad`. Actual registry responses match all three identities. The official [build12228 manifest](https://ci.opensearch.org/ci/dbc/distribution-build-opensearch/3.9.0/12228/linux/x64/tar/builds/opensearch/manifest.yml) is421316bytes/SHA256 `e121eced0df2aa50478fe5c9234e9091dd4eb920c5728fb3f5c23c3e5994d424`; the tag and manifest bind source commit4ee42a94e87f66fbf1e62a9871b1b87f91e02472, GitHub-verified. These are candidate-selection facts; no image signature or binary equivalence is inferred.

The earlier research identified updated core Netty/HttpCore/JLine versions, but plugins can retain other versions. The actual whole-image scan remains mandatory. No vulnerability exception is introduced.

## Rollback and operational boundary

Revert the diagnostic pin and current provenance record while preserving both versions' raw material and reports. The older result remains blocked. This adds no application dependency, service process, package grant, paid resource, source access right, support activation or production schedule.

## Implementation evidence

The OpenSearch lock entry and corresponding provenance record now bind the retained3.9.0 index and platform bytes. Only this record carries the actual retrieval timestamp2026-10-06T21:56:37.8669999Z; the original collection timestamp and four other provenance records stay unchanged. The older3.8.0 raw index/platform files retain their exact hashes. Seven other image pins, eleven scanner fixtures and all scanner build inputs are unchanged. Focused Windows scanner checks pass41 tests with one explicit Linux-root skip, ESLint and diff checks pass.

Fresh actual Linux UID/GID1000 full quality checks on implementation6c7a15bd9fbd9f68f989da53cfb8ff80f796a0e2/treefa837c1bf9a7458562f31db0f867fd1b8bd5f0a1 pass: root2058 tests/2008 passes/50 explicit actor-specific skips/0 failures, lint9/9, typecheck11/11, workspace tests18/18 and build9/9, with zero cached Turbo jobs. Secretlint704 files and dependency audit0 known vulnerabilities pass. The593200-byte completed log SHA256 is `9e1bf1cb05e55ea7b461646f3551113f54d594c33a3be5192fed800144dd15cd`. Independent code/security review APPROVES this exact implementation with no findings and fresh targeted33/33 passes. Architecture review, final-head/main CI and the real native scanner result remain separate delivery requirements.

Predecessor [PR138](https://github.com/CleMeY15/auto-world/pull/138) is delivered on exact reviewed head f6ae9d6e87501676079285651d86b4d00709e8ca/CI37537513182 and identical merge fe397f1fc3f49ce4ef850338cec319366cb22c55/tree6cbf7a4bb85bb2caa1de03052dbf02462ffab0ec/main CI37537944436. Its new [PostgreSQL current audit37538340223](https://github.com/CleMeY15/auto-world/actions/runs/37538340223), number2/attempt1, is running on that reviewed merge. The first failed audit and historical scanner controls remain preserved.
