# TASK-0005A — PostgreSQL exact bootstrap private read

Status: SOURCE_IMPLEMENTED, NATIVE_NOT_EXECUTED, NOT_ADMITTED.

## Scope and fixed evidence

The [harmless first write](TASK-0005A-POSTGRES-PACKAGE-BOOTSTRAP.md) succeeded in run 36353596729 and its same package is now observed Private. This increment permanently retires that producer and verifies the existing object with `contents: read` and `packages: read` only. It neither publishes nor signs an image, starts PostgreSQL nor admits a service.

Pin `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:9ee2f2da7187b0d0ecd3cbab83b7356f9ef032650b33604ff13e711e3462e408`, config `sha256:cb3e9858fc85bf1fbc4fbaca353cb5b4263b20bd88fb1e6963b4081887eee1bf`, the 524-byte raw manifest identity and the exact 46-byte `/bootstrap.txt` payload. No arbitrary digest, run or input parameter is accepted. Reuse the same workflow identity with a single guarded read-only run 2, attempt 1 after review, full checks and exact-head/merged-main CI. Re-enable the disabled workflow only after the writer is retired on reviewed main.

## Implementation plan

1. Remove executable publication logic and retain only the fixed harmless contract plus explicit retired rejection. Replace the existing workflow job with one input-free GitHub-hosted Ubuntu 24.04 verifier. No `packages: write`, OIDC, attestations, build or push remains.
2. Authenticate clean HEAD and the entire executed file closure; verify protected main before credentials or image retrieval. Use separate owned Docker/Buildx configurations for authorized and anonymous requests, bounded outputs and a monotonic deadline with reserved cleanup time. The token reaches login only through stdin and never enters child environments or the public receipt.
3. Retrieve and validate the exact raw manifest with authorization, require isolated anonymous authorization denial, then retrieve the authenticated manifest again and require identical bytes. Bind its OCI/Docker shape, config digest, sole bounded layer and expected manifest byte length. A successful anonymous fetch or an ambiguous/network failure fails the proof.
4. Reject pre-existing subject/config ID/container name before pull. Record complete bounded image/container inventories. Pull only the pinned digest, inspect its exact config ID/platform/labels/digest, and create an explicitly stopped container without `run` or `start`. Inspect its exact identity, image, labels, command and stopped state before copying the fixed payload; verify its exact bytes.
5. Remove only objects whose creation by this invocation is proved. Partial pull/create outcomes require inspection and inventory reconciliation; preserve foreign/pre-existing/unknown objects and fail uncertain cleanup. Final inventories must match the originals. Remove only owned work/config paths.
6. Publish only one bounded technical receipt, retained for 14 days, and copy the native evidence into the existing private archive. Keep `publication=NOT_ATTEMPTED`, `admission=NOT_AUTHORIZED`, support dates null, package Settings separately observed, and fork test `SKIPPED_BY_USER`/isolation `NOT_VERIFIED`.

## Validation and acceptance

Exercise wrong repository/ref/job/run/attempt, changed protected main, substituted executed imports, wrong digest/config/manifest, successful or ambiguous anonymous read, cached image/config ID, partial pull/create, interrupted inspection, foreign ownership, altered payload, resource/operation timeout and cleanup failure. Prove the retired writer rejects direct invocation without side effects and the workflow has only read permissions and a receipt-only artifact path. Use independent code/architecture review, full fresh Linux checks, exact-head CI and merged-main CI before the guarded native run.

Acceptance requires the actual run to establish both authenticated remote manifests, anonymous refusal, exact digest/config/payload retrieval from the stopped container and owned cleanup. Require the exact run 2, attempt 1 identity, a genuinely executed successful `verify` job and its exact retained artifact/receipt; a green workflow containing only a skipped job is never proof. A configured Private package alone is insufficient. This is a package-access proof, not candidate runtime/audit/signing/admission evidence. Rollback disables the verifier, preserves evidence and remote objects, and never deletes service data, backups or a pre-existing resource.
