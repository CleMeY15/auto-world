# TASK-0005/A upstream candidate comparison

## Scope and baseline

Codex gpt-6.2-astra / ultra owns this diagnostic on branch codex/task-0005-remaining-upstream. The accepted PR253 main is 5d0599cdeb3589b0c2ab0e42778769c9ad771b32. Its raw run 44321947040 attempt 1 remains FAILED with 110 ordered blockers, one CRITICAL and 109 HIGH. PostgreSQL contributes 26, OpenSearch 82, SeaweedFS two, Redis and AWS CLI zero. The original ZIP is 923,534 bytes, SHA-256 838d34d5ecbfc9b423342e47e39120be6ccad3908cbf8809a880cce074e1ea0b. All 50 members were verified. [Original push run](https://github.com/CleMeY15/auto-world/actions/runs/44321947040)

The four maintained PostgreSQL 17.12 variants install identical Gosu 1.19 bytes (52c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0). The 94 stable tags examined resolve to 57 Linux/amd64 manifests. Their helper installation layers yielded Go 1.24.6 or 1.18.2. Gosu 1.20's official release binary also contains Go 1.24.6. Keep the measured raw pin pending a compatible published replacement. On the same scanner and databases, the 1.27.3 managed rebuild had zero detected blockers, with its main-module version lookup unavailable. [Go advisory](https://pkg.go.dev/vuln/GO-2026-4337) · [Maintainer issue](https://github.com/docker-library/postgres/issues/1425) · [Managed original](https://github.com/CleMeY15/auto-world/actions/runs/44321946889)

The official full OpenSearch 3.10.0 binary distribution contains versions meeting the historical fixed floors at 75 of the 82 paths/occurrences mapped from 3.9.0. Six Guava occurrences and one JLine occurrence remain below their floors. The selection preserves the complete official distribution, the managed 3.9 base and its existing native/runtime qualification. The additional scan measures the candidate alongside the original five and the AWS control. [Approved plan and pins](../../roadmap/plans/TASK-0005-opensearch-3.10-comparison.md)

The two SeaweedFS 4.51 occurrences match the fixed go-jose v4.1.6 and x/net v0.62.0 versions inside the normal 4.54 binary. Its three Rust helper inventories of 498, 656 and 659 entries describe source Cargo.lock files. A future managed port requires coverage of the vector helper, reconciliation of changed native assertions, runtime and restore. [SeaweedFS 4.54](https://github.com/seaweedfs/seaweedfs/releases/tag/4.54)

## Plan reviews and execution

Independent Architect and Critic contexts used Codex gpt-6.2-astra / ultra. The V1 Architect requested correction of the index digest, comparator sequencing, advisory scope and per-copy coverage inputs. The V2 Architect approved the amended plan. The V2 Critic required role-level replay of all blocker objects and independently recoverable execution and cleanup records. Architect then Critic approved the frozen V3 at 6e1609cfa0f2f366d5d66ddd3bef4e229d4ab4db. Plan SHA-256 e657b0d95d050c53b4afe53838e0f986dbe2cd61f99915fe3b6a797c5a9f7a5f. Architect report 2558090dce680d57b084463247427ef7fa578cb98752f6f7a4e0c10ddd8bab98. Critic report 3aa595afb165073a12fdad3faf5461a92817b5b46a3d76c90557a4111c0ef98b. [PR257](https://github.com/CleMeY15/auto-world/pull/257)

Implementation is in progress. The candidate's measured policy decision, integrated local gates, source review, new CI originals and exact-main review are pending. First complete implementation presentation, cost and human time are unknown. Both tasks remain IN_PROGRESS. Rollback removes this additional diagnostic while retaining all original reports, failures and existing service image pins.

## First assembled source and review corrections

Local revision 3df1e9c913fbe29d03a4c84d59b068c2b6e3b6cd, tree 1f5c420a683fcd6222cc0dd4c75d2f0020fa540a, passed 111 focused tests. Its six serialized gates passed: lint, typecheck, tests, build, secrets:check and audit:dependencies. The root suite recorded 3,405 passes and 123 skips. The two independent source reviews requested changes before operational CI. They identified unexplained per-copy inventory loss, insufficient OCI layer binding and delta evidence, incomplete AWS replay, missing end-to-end candidate reachability and interruption tests, lease attribution, and a late report size check.

The historical gate results above apply to 3df1e9c9. The revised implementation requires its own frozen source review and serialized gates. The original raw verdict remains FAILED110.
