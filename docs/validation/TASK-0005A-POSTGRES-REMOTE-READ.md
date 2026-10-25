# TASK-0005A — Exact remote PostgreSQL candidate read

Status: REMOTE_READ_VERIFIED. This read receipt does not establish an audit or admission. The subsequent [independent native audit](TASK-0005A-POSTGRES-REMOTE-AUDIT.md) is recorded separately. The [V4 publication](TASK-0005A-POSTGRES-CANDIDATE-PUBLICATION.md) established one Private staging subject, not an admitted or supported image.

## Retained V1 failure

The first native remote-read workflow was reviewed and dispatched once. [Run `36364189061`](https://github.com/CleMeY15/auto-world/actions/runs/36364189061), attempt 1, failed read-only after about eleven seconds in the archive callback. Public artifact `10946583071` contains only its 524-byte bounded failure receipt (SHA-256 `9603c42fcff6b480e25ee4b7e7122f1613476582fa4aeba4d2354626c3e56748`); cleanup passed. No registry write, scanner, candidate execution, signing or admission occurred. The exhausted V1 workflow is disabled.

The failure came from an application identity check after the core validator had defensively cloned the policy: the CLI compared `value.policy !== policy` by JavaScript object reference, so equal validated policy data was rejected. V2 replaces that reference-identity check with a validated semantic boundary and uses a new one-shot workflow definition. The failed V1 result does not activate support, establish an audit, or change `PUBLISHED_UNADMITTED` / `NOT_AUTHORIZED` status.

A local non-root Docker 28.0.4 reproduction against the exact Private digest completed all 14 read phases and owned cleanup after the V2 correction, with the protected-main API check injected for the local simulation. It proved the repaired callback path locally before the separate native V2 run recorded below.

## Native V2 result

The single [V2 run `36365364468`](https://github.com/CleMeY15/auto-world/actions/runs/36365364468), number 1/attempt 1, **PASSED** on protected main `a396099aff202fc9df82922edcd6fefb40a69e8e` after [PR109](https://github.com/CleMeY15/auto-world/pull/109). Its sole public artifact `10947342007` contains only `receipt.json`; that extracted file is 8,080 bytes with SHA-256 `37d443af9d8d3d32efbd5fd15b37a9f273521d1e78b8db71f238d0976e4cdcd2`. The receipt validates against the reviewed policy with all 14 phases `PASSED`; the original was retained privately at `C:\Users\Administrator\Documents\ChatGPT\Auto-world\.omx\private-archive\local-engine-setup\postgres-candidate-remote-read-36365364468\receipt.json`.

The bound subject is `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`, with config/image ID `sha256:8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda` and twelve ordered DiffIDs. Managed pull and private `docker save` both returned success. The 305,474,048-byte saved archive validated at SHA-256 `3a8080fa22ef37c75ac72a7ec516cd0d1094d3f3f67d9b47f4121a546150fe93`; it was deleted with the owned image/configuration before artifact upload. This archive hash identifies the V2 runner's saved uncompressed material and does not replace the remote manifest digest or independently rehash its compressed layers.

The package remains Private with exactly the bootstrap and this candidate version. V2 was disabled after its only run. The receipt says `vulnerabilityAudit=NOT_ATTEMPTED`, `imageExecution=NOT_ATTEMPTED`, `admission=NOT_AUTHORIZED`, and null support/archive dates. This is an independent read proof, not an audit, runtime proof, signature or activation.

## Subject and boundary

Read only `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93` on a fresh GitHub-hosted Linux runner. The fixed policy must bind package ID `15408021`, tag `candidate-36361670116-attempt-1`, V4 run `36361670116` attempt 1 on protected main `b93b0c76ec76abe283d66a17fa62eab7e580e679`, and the exact 22,970-byte publication receipt SHA-256 `d0cad244921e91229027c625440aa654624f1e754a975901b5b9a763135d3287`. The receipt is technical provenance only; the remote digest remains the image authority.

The manual workflow has no inputs or registry write permission. It is restricted to the first run and first attempt on protected `main`; the read job receives only the permissions necessary for source and Private package reads. No candidate container is started or executed, and no scanner, signing or admission decision occurs in this increment. Any successful read remains `REMOTE_READ_ONLY` with `vulnerabilityAudit=NOT_ATTEMPTED`, `imageExecution=NOT_ATTEMPTED`, `admission=NOT_AUTHORIZED`, and null support/archive dates.

## Verification plan

1. Authenticate the committed policy and exact V4 receipt against their reviewed byte identities and the fixed subject. Verify the package remains Private and the tag and digest return byte-identical raw manifests. An anonymous manifest read must be denied; an ambiguous response fails closed.
2. Validate the Docker schema 2 manifest's digest, byte size, config descriptor, ordered ten public-base layers and two candidate layers. Record compressed descriptor sizes separately from uncompressed layer DiffIDs; do not equate them.
3. On a fresh managed Docker 28.0.4 runner, reject local image/name collisions, pull only by the fixed digest and verify the exact config/image ID, platform and all twelve DiffIDs. The managed Docker pull is the compressed-layer integrity boundary; the application must describe that trust boundary accurately.
4. Save the exact pulled image under one owned local alias to a bounded private archive. Reuse the strict twelve-layer PostgreSQL archive validator to hash and inspect its config, uncompressed layers, members and compatibility records. The archive's SHA may differ from the publication runner's local archive; it is not a replacement for the remote digest.
5. Expose the private archive only inside a bounded callback for the subsequent scanner integration. Remove the owned archive, authentication directory and Docker references afterward; compare complete before/after inventories. A failed or uncertain cleanup cannot yield a complete receipt.

The only public Actions artifact may be a bounded technical receipt. The Docker archive, private layers, credentials, Docker configuration, raw registry responses, vulnerability databases and unfiltered command output stay in the runner's private temporary directory and are never uploaded. Each workflow definition was disabled after its single native run; no uncertain read/write outcome was retried under the same definition. Both V1 and V2 are disabled.

## Validation and next gate

Tests must reject a changed receipt, tag/digest mismatch, wrong config or layer order/count, missing/extra DiffIDs, anonymous success, foreign local image, ambiguous pull, altered archive, failed callback and uncertain cleanup. Require targeted hostile tests, fresh Linux lint/typecheck/tests/build/secrets/dependency checks, exact-head CI, independent code/security review and matching reviewed merged-main tree with green CI before the first native run. The published package privacy and workflow run count are checked immediately before dispatch.

The next focused audit must rematerialize this same digest in its own read-only run, then perform fresh scanner database controls and JSON/CycloneDX policy checks. It must not consume this run's temporary archive or infer an audit from the remote-read receipt. Runtime, second private copy/restoration, signing, admission, and the one-year support interval with continuous security controls remain separate gates under [ADR-0007](../decisions/ADR-0007-private-image-admission.md).
