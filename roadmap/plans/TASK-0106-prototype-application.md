# TASK-0106 — bounded application recovery plan

Status: implementation authorized; initial composition design reviewed. The real lane exposed an interrupted-import reconciliation defect; [ADR-0031](../../docs/decisions/ADR-0031-interrupted-full-reconciliation.md) records the reviewed narrow semantic repair. Final implementation review and delivered acceptance remain pending. No new dependency, schema or backup engine is needed.

## Ready and scope

TASK-0104 and TASK-0105 are accepted on main; TASK-0005's functional four-service milestone satisfies ADR-0028. The task defines goal, dependencies, contracts, acceptance, test strategy and Platform/SRE ownership. This is a backend-only isolated fabricated-data composition; there is no new UI flow. Existing web V2 and its port 3210 demo remain unchanged. V1 application HTTP binds only loopback, separately on 3211.

## Smallest vertical change

1. Reuse pinned four-service lifecycle, SDK ingestion, PostgreSQL transaction store, search reconciliation and existing V1 API. Extract existing synthetic ingestion plumbing, without changing the established search scenarios.
2. Keep the project operation lock only during setup/migrations/stop/backup. Release it before serving. On shutdown stop new work, abort and await the consumer, close HTTP/pools, then stop owned services; preserve volumes. No automatic reviewed replay.
3. Run actual HTTP, a 1000-document/50-query performance profile, replay, hard process restart, graceful stop and four-service failure isolation. Preserve failed ingestion receipts. Observe sanitized source-health, search-health and failure counters; do not claim a deployed dashboard or production alerting.
4. Quiesce before a full allowlisted PostgreSQL snapshot and the existing cold backup. Verify raw hashes, all application tables and sequences, reject external tablespaces, record durable watermark and backup age. Restore into a new owned target, compare exact state before any application mutation, rebuild fresh OpenSearch through existing reconciliation, and compare HTTP results. Redis stays non-authoritative and fresh; the S3 acceptance object survives.
5. Retain only sanitized counts/digests/timings/pins in CI. Test scoped cleanup against an independent sentinel. Preserve private backup files and failed evidence; never upload archives, manifests, credentials or raw bytes.
6. Run targeted/unit/real-service/root quality gates and independent application architecture/data/privacy/operations review, then exact PR/main CI. Acceptance remains pending until the delivered checkpoint.

## Evidence-driven repair

The first composed fixture correctly failed publication: a committed page from a
failed full import left an active projection outside the next completed inventory.
Keep this fixture and search's fail-closed coherence check. Amend both existing
stores per ADR-0031: new full runs pin current active projections; older running
checkpoints cannot resume after a newer same-scope run. Preserve explicit ends,
history, failure receipts, normal resume and completed replay. Exact replay adds
only its fresh-fence `run.opened` receipt/outbox event, never duplicate business
effects; the acceptance scenario verifies this distinction explicitly.

## Invariants and stop conditions

PostgreSQL is authoritative. No source activation, public listener, production credentials, image qualification, custom DB/search/backup implementation, UI replacement or deferred scanner work. Backup with live application clients, mutation before restore comparison, automatic reviewReplay, or broad cleanup blocks acceptance. RPO 0 is relative only to the captured committed fixture watermark; backup age <=5 minutes, restore plus reconciliation <=10 minutes, search p95 <500 ms and publication lag <=60 seconds are measured acceptance targets, not production SLOs.

The alternative of extending the search integration runner was rejected: it starts only two services, holds the project lock throughout and uses injected HTTP. A thin composition with a real listener is necessary to test process and recovery boundaries without duplicating the engines.
