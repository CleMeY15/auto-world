# TASK-0005A — service image audit refresh

Status: PREPARATION_ONLY. These are diagnostic candidates, not admitted service images.

## Baseline and scope

[PR95](https://github.com/CleMeY15/auto-world/pull/95) retained the successful native SeaweedFS attestation and retired its producer. Reviewed head `db8906bc7b1940192d73ab0fe74576b2a0e2aaa9` and merge `5a15e9d81d0b51124c64b9cb118351e863764d4a` share tree `9994058c317bf7baab21a99d1b444088b9173943`. Independent code review returned APPROVE with zero findings and architecture review returned CLEAR. Fresh Linux full checks passed 784 root tests with zero failures/skips; [head CI](https://github.com/CleMeY15/auto-world/actions/runs/36340643440) and [main CI](https://github.com/CleMeY15/auto-world/actions/runs/36340915463) passed.

The existing manual [scanner run 36341060453](https://github.com/CleMeY15/auto-world/actions/runs/36341060453), number 26 attempt 1, was dispatched on that exact main to refresh the original eight-image diagnostic inventory. Its result is pending. Historical September 14 findings do not establish current eligibility.

Official image publications now offer refreshed PostgreSQL/OpenSearch builds and a Redis security patch. The next bounded change selects exact published `linux/amd64` candidates for the existing five PostgreSQL/OpenSearch/Redis inventory entries, including the two existing Alpine alternatives. It leaves scanner source/compiler/patches, the executed baseline tool and the SeaweedFS evidence unchanged. There is no runtime migration or startup in this increment.

## Candidate selection

- PostgreSQL remains on the 17.11 application release. Compare its current Trixie image with the existing Alpine alternative, now explicitly selecting Alpine 3.24. Their libc and extension behavior still require actual runtime validation before selection. Sources: [release 17.11](https://www.postgresql.org/docs/17/release-17-11.html), [official image variants](https://github.com/docker-library/docs/blob/master/postgres/README.md).
- OpenSearch remains on the released 3.8.0 version. A rebuilt tag is a different image subject and receives its own audit. Source: [official release](https://github.com/opensearch-project/OpenSearch/releases/tag/3.8.0).
- Redis moves from 8.10.1 to the published 8.10.2 security patch, comparing Trixie and the existing Alpine alternative, explicitly Alpine 3.23. Source: [official release](https://github.com/redis/redis/releases/tag/8.10.2).

The [registry provenance record](service-image-refresh/manifest-provenance.json) binds the five explicit tags and immutable index/platform URLs to ten original manifest files fetched from `registry-1.docker.io` on 27 September. Each response was limited to 1 MiB, hashed before parsing and checked against its expected digest. Each index has exactly one requested `linux/amd64` descriptor, whose digest and byte size match the retained platform manifest. No image layer was fetched or executed for this discovery. Tags are discovery metadata only; scans use immutable digests. A newer digest does not imply fewer vulnerabilities or compatibility.

| Role | Explicit publication tag | Exact platform candidate |
| --- | --- | --- |
| PostgreSQL | `17.11-trixie` | `sha256:e31e3d5327d1806f6177827c9710643e4f35f7ab3f14d26d05332753d3e95ee0` |
| PostgreSQL alternative | `17.11-alpine3.24` | `sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3` |
| OpenSearch | `3.8.0` | `sha256:68a688de28fb9bb66601552650b91a52a9fd5e7eac5481dd2b225ecb66fd09b0` |
| Redis | `8.10.2-trixie` | `sha256:7ef5b5cec96495a04ca7feff88a9492efeab8053fb284d24bdd73344c9245a48` |
| Redis alternative | `8.10.2-alpine3.23` | `sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23` |

## Evidence boundary and verification

Changing the diagnostic inventory changes `scanner-lock.json`'s hash. Both new scanner build receipts must bind that new lock, and the subsequent audit must bind those builds, frozen databases and all eight exact image reports. Existing report identity, inventory, vulnerability, resource and freshness gates remain in force; no dispositions are preapproved.

The signed SeaweedFS predicate remains bound to its historical lock `3bcfd01a6b85d7f45646d6139961f438d2a5decb1b80342c12dd3984bfa7da23`, original run and report set. Do not rewrite its receipts or substitute a new generic scanner audit into that signed history. Its retained-byte tests continue to enforce this distinction.

Before native use: validate manifest bytes/platform bindings, run targeted tests and full lint/typecheck/tests/build/secrets/dependency checks from a fresh Linux clone, obtain independent code and architecture review, then pass exact-head and merged-main CI. Run the existing manual scanner workflow on reviewed main and retain complete raw reports even when findings make the diagnostic fail. No automatic workflow trigger is added.

## Operations and rollback

Rollback restores the prior diagnostic inventory without deleting prior reports, archives, packages or data. No admitted inventory or supported data lifecycle exists yet. SeaweedFS remains ATTESTED_UNADMITTED; the three other services still require fresh eligibility and runtime evidence. TASK-0005A/TASK-0005 remain IN_PROGRESS and TASK-0006 remains blocked.

The user's one-year support policy begins at actual reviewed activation and requires security checks throughout support, plus at least 365 further archive days. This candidate selection starts no support clock and makes no promise to privately maintain an unsupported upstream release. Concrete activation dates and supported consumption remain separate admission work.
