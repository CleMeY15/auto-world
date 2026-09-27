# TASK-0005A — PostgreSQL gosu correction diagnostic

Status: PREPARATION_ONLY, NOT_ADMITTED. No registry publication or supported startup is authorized by this diagnostic.

## Exact problem and proposed correction

The complete scanner run `36342206206` reports 22 blocking occurrences in PostgreSQL `17.11-alpine3.24`: 21 HIGH and one CRITICAL, all in the Go standard library embedded in `/usr/local/bin/gosu` 1.19 (Go 1.24.6). The rest of this image's recorded package inventory has no HIGH/CRITICAL finding. The exact base is `docker.io/library/postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3` for Linux/amd64, selected from index `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`.

The official Alpine 3.24 repository provides `gosu=1.19-r5`, built from the same gosu version using its newer Go toolchain. Sources: [Alpine package](https://pkgs.alpinelinux.org/package/v3.24/community/x86_64/gosu), [Alpine recipe](https://gitlab.alpinelinux.org/alpine/aports/-/raw/3.24-stable/community/gosu/APKBUILD). Package metadata is only candidate-selection evidence. The actual APK signature, bytes, installed executable build metadata, resulting image inventory and runtime behavior must be verified before any success claim.

## Bounded implementation plan

Use the existing managed Docker 28.0.4 Linux engine for a local disposable diagnostic. Pin the official APK byte identity, preserve its original bytes and source metadata, and verify its signature with the Alpine keys from the exact base. Do not permit unsigned packages or add a compiler/helper image. Build without network access from that base and the retained APK; replace only the old unmanaged gosu executable with the official Alpine package implementation, retaining the PostgreSQL entrypoint and service configuration.

The command must own every temporary image/container/volume through unpredictable run labels, use private bounded directories and logs, publish no port and mount no Docker socket or credentials inside a container. Test PostgreSQL initialization through the normal entrypoint, actual privilege switching, readiness, a synthetic SQL write/read, then a distinct container using the same owned volume and exact readback. Preserve the complete candidate archive and byte identities for a separate full audit. Resource limits, bounded waits, failure receipts and ownership-checked cleanup are required; no global prune or deletion of pre-existing images/data is allowed.

The separate scanner stage must authenticate both existing independent scanner builds, use matching binaries and the reviewed policy, freeze and validate the complete vulnerability/Java databases, and retain full JSON/SBOM reports for the exact saved candidate. Vulnerability metadata must remain within 48 hours; Java age is recorded without a maximum-age rejection. Prove the old Go inventory has disappeared and the replacement inventory is complete. Any CRITICAL, fixable HIGH, missing inventory or failed control remains a blocker.

Unit tests cover substituted image/APK identities, unsafe paths or execution settings, failed commands and ownership/cleanup failures. Before native execution, require independent code and architecture review of the concrete recipe, root checks and exact-head CI. The final record must retain real failures as well as successes, and distinguish signature/build/runtime/audit results. This diagnostic cannot admit PostgreSQL, start its support period, complete the four-service lifecycle or unblock TASK-0006.

## Operational boundary and rollback

No new registry package, workflow privilege, account, service, recurring automation or vulnerability exception. No OpenSearch JAR replacement belongs in this change. Rollback stops and removes only the diagnostic's owned resources while preserving evidence; it never falls back to the vulnerable base for supported service startup. A later governed admission/publication decision is separate. Support remains one year from actual reviewed activation with continuous security controls and at least 365 additional retention days; dates remain null here.
