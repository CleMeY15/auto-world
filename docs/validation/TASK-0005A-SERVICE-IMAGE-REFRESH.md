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

Resolve index and platform manifests from the official registry, retain their original bytes and SHA-256 values, and bind the inventory to the unique `linux/amd64` descriptor. Tags are discovery metadata only; scans use immutable digests. A newer digest does not imply fewer vulnerabilities or compatibility.

## Evidence boundary and verification

Changing the diagnostic inventory changes `scanner-lock.json`'s hash. Both new scanner build receipts must bind that new lock, and the subsequent audit must bind those builds, frozen databases and all eight exact image reports. Existing report identity, inventory, vulnerability, resource and freshness gates remain in force; no dispositions are preapproved.

The signed SeaweedFS predicate remains bound to its historical lock `3bcfd01a6b85d7f45646d6139961f438d2a5decb1b80342c12dd3984bfa7da23`, original run and report set. Do not rewrite its receipts or substitute a new generic scanner audit into that signed history. Its retained-byte tests continue to enforce this distinction.

Before native use: validate manifest bytes/platform bindings, run targeted tests and full lint/typecheck/tests/build/secrets/dependency checks from a fresh Linux clone, obtain independent code and architecture review, then pass exact-head and merged-main CI. Run the existing manual scanner workflow on reviewed main and retain complete raw reports even when findings make the diagnostic fail. No automatic workflow trigger is added.

## Operations and rollback

Rollback restores the prior diagnostic inventory without deleting prior reports, archives, packages or data. No admitted inventory or supported data lifecycle exists yet. SeaweedFS remains ATTESTED_UNADMITTED; the three other services still require fresh eligibility and runtime evidence. TASK-0005A/TASK-0005 remain IN_PROGRESS and TASK-0006 remains blocked.

The user's one-year support policy begins at actual reviewed activation and requires security checks throughout support, plus at least 365 further archive days. This candidate selection starts no support clock and makes no promise to privately maintain an unsupported upstream release. Concrete activation dates and supported consumption remain separate admission work.
