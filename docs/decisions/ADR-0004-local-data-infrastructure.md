# ADR-0004 — Local/CI data foundation and recovery contract

Status: Accepted for TASK-0005 implementation after sequential independent Architect and Critic plan approval, 2026-09-06. Runtime acceptance remains pending.

## Decision and boundaries

Use one digest-pinned Docker Compose specification for local development and Linux CI. Supply PostgreSQL canonical foundations, OpenSearch derived index, Redis disposable cache and SeaweedFS S3-compatible raw storage. Use the official AWS CLI for signed S3 calls and Trivy for immutable-image vulnerability reports. No new external npm library is introduced.

This implements [TASK-0005](../../roadmap/tasks/TASK-0005-local-data-infra.md), not a production topology or the [ConnectorStorePort](ADR-0003-connector-sdk-contract.md). It does not execute connectors, authorize sources, implement authenticated registry/leases/fences/checkpoints/inventory, run retention/takedown workers, deploy a dashboard or expose UI. PostgreSQL and S3 do not magically form one atomic transaction. A future SDK store must explicitly solve staging, orphan reconciliation, receipts and old-writer quiescence before real activation.

Prerequisites: TASK-0004 merged at main `b9d22a2123ff53acded73eaf800a29dc8f2faf66`; [main CI](https://github.com/CleMeY15/auto-world/actions/runs/34031090389) and postmerge frozen/forced root gates pass. The current Windows host has no Docker/Podman CLI; real Linux CI containers are the acceptance lane, not a mock substitute.

## Principles, alternatives and consequences

1. Test the exact shipped artifacts and lifecycle.
2. Isolate local/CI state, credentials and destructive operations.
3. Preserve distinct vehicle/publication/version/observation/raw evidence and outbox transactions.
4. Do not confuse a storage foundation with authenticated distributed SDK ports.
5. Keep operations explicit, bounded and reversible.

One Compose model is preferred to separate local Compose and CI service definitions: it proves the actual named volumes, restart, reset and recovery behavior. CI-native services and logical dumps would be simpler/more portable, but do not alone prove the shipped local lifecycle. Managed cloud services exceed this task's cost/credential/resource boundary. Physical recovery intentionally trades portability for exact local recovery evidence; logical dumps remain a documented complementary option, not a substitute or unexecuted success claim.

SeaweedFS is chosen for its maintained Apache-2.0 single-node path. Garage is a credible alternative with additional metadata/configuration and AGPL considerations; MinIO Community's archived/unmaintained legacy binary distribution is not the selected baseline. SeaweedFS conditional-write behavior is a real-image acceptance gate, not assumed from marketing compatibility. If it fails, return to an explicit architecture decision; never quietly overwrite raw data. See upstream references below.

## Pinned artifacts and supported runtime

The following tags and immutable manifest digests were re-resolved directly from Docker Registry on 2026-09-06. `infra/images.json` will also record the resolved Linux/amd64 image manifest. Compose is restricted initially to Linux/amd64; other platforms require their own validated pins and restore evidence.

| Artifact | Version | Manifest digest | Linux/amd64 image digest |
| --- | --- | --- | --- |
| postgres | 17.11 | `sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675` | `sha256:d13db94ae661d517c5ed57c509a578d5ea64aae639871ba25294f4f42d83de28` |
| opensearchproject/opensearch | 3.8.0 | `sha256:bcc1797519726ceb6d651d4a3e60b7c30da91793914a8dfe75fd441d4f641509` | `sha256:39a8f8c63028e8b5d6b70539af1d0339b15a6729002dd5b3f4a65f520376fd30` |
| redis | 8.4.6 | `sha256:8df317692c59703c19ecfa90a8cb17703089f3c8e12c2bd0cd6b3c31005e69d8` | `sha256:84025030277f4e008a6fceb9f816aff783e88667ff7bc94efdaa97d8ea7ba53f` |
| chrislusf/seaweedfs | 4.45 | `sha256:fc9f76fa993ad69966ffeb2f65d0318fcae39c6f8e20cf68ef7b3a5cb97769e5` | `sha256:0a94aac557ead0a6b3350df86b2d4fea0a5793590e1fbf5f35d41cac0dc22b40` |
| amazon/aws-cli | 2.36.40 | `sha256:b6aeb95d19d7f5a8cae4eb814cb16739b6b2a4f2f46f427ada6a8c9a20d9881d` | `sha256:5b3fa9da281ab658171716b2c01beff540614f6697ac6d6ebd8e369aca75fb9c` |
| aquasec/trivy | 0.74.0 | `sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969` | `sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9` |

If audit demands a patched variant, document and review the exact changed pin before acceptance. A tag or an earlier green scan does not validate a changed image.

Actions tag-to-commit and `action.yml` Node24 runtime were independently checked through the official GitHub API: checkout7.0.1 at `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node7.0.0 at `820762786026740c76f36085b0efc47a31fe5020`, pnpm/action-setup6.1.0 at `ea17c68df8912ef543352723c149a84f56e3d413`. Application Node22.23.2/pnpm10.15.0/Turbo2.10.12 stay pinned; updating the Actions runtime does not upgrade project Node.

## Topology and trust

`infra/compose.json` is a strict JSON/YAML-subset document, validated with Node built-ins and real `docker compose config`. Four service keys: `postgres`, `opensearch`, `redis`, `object-store`. No globally fixed container_name, host network, privileged mode, Docker socket or broad host mount. Use one project-owned `bridge` network with `internal:false`, default `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`, and separately owned named volumes. All published ports explicitly bind127.0.0.1, defaults5432/9200/6379/9000 respectively; integration uses ephemeral loopback ports and discovers actual mappings.

Networking correction independently approved by Architect on 2026-09-06 before implementation: Docker's internal-only network cannot supply the promised published localhost endpoints ([Compose networking](https://docs.docker.com/compose/how-tos/networking/), [upstream reproduction](https://github.com/moby/moby/issues/36174)). The bridge provides ordinary container egress; it is not an outbound firewall or production isolation guarantee. TASK-0005 still forbids real source data, connector execution, production credentials and deployment. Validate actual network ownership/options plus all four loopback mappings. Host probes must observe PostgreSQL's SCRAM authentication challenge, authenticated Redis PING, OpenSearch HTTP health and S3 anonymous refusal; authenticated SQL and signed S3 data checks additionally use the same containers through their internal service interfaces. A PostgreSQL challenge proves protocol reachability, not successful host-side authentication.

Resource budget: aggregate service memory <=4GiB, OpenSearch heap512MiB with container allowance >=1.5GiB; all services have explicit CPU, memory, PID and bounded log limits. Local restart policy is unless-stopped. Document Docker/Compose prerequisites, available memory/disk and OpenSearch `vm.max_map_count=262144`. No automatic host installation/sysctl modification outside a disposable CI runner.

Postgres uses its17.x `/var/lib/postgresql/data` volume convention, explicit UTF-8/locale configuration, SCRAM credentials and separate bootstrap/migration/application roles. Init scripts may create initial roles/database only, not stand in for versioned migrations. OpenSearch is single-node with security disabled strictly for this isolated local/CI topology, fixed heap/memlock/nofile settings and a one-shard/zero-replica synthetic index probe. Redis uses explicit AOF persistence and authenticated PING; graceful-restart proof is not a zero-loss crash guarantee.

SeaweedFS uses `server -dir=/data -s3` without a conflicting filer.toml: volume, master and `/data/filerldb2` metadata share the persistent volume. The shipped image's relative filer configuration resolves under its `/data` working directory. Only the S3 endpoint is published. Its default open-key behavior is prohibited: mount a generated explicit identity configuration, no anonymous identity, and the fixed bucket-scoped lifecycle rights specified below. The startup shim copies that read-only host configuration into a private tmpfs owned by UID/GID1000 before upstream drops privileges; it never loosens or changes host credential ownership. Unsigned/wrong-key denial, bucket/object persistence and conditional writes must pass on the exact image, including after restart.

## Command and credential contract

The local lifecycle S3 identity additionally requires `Admin:aw-raw` to create its fixed bucket: SeaweedFS 4.45 routes PutBucket through `ACTION_ADMIN` ([versioned upstream handler](https://github.com/seaweedfs/seaweedfs/blob/4.45/weed/s3api/s3api_server.go)). All four actions are scoped to `aw-raw`, never global Admin. This is a local initialization/validation identity, not a production connector least-privilege credential. Read/List/Write alone cannot initialize a fresh store; wrong-key and unsigned denial remain required.

`scripts/data-infra/*.mjs` uses Node built-ins and argument-array subprocesses, never a shell-built command. Root scripts expose init, up, status, migrate, stop/start, backup, restore-check, test, down and explicit reset. Commands accept only known options/project IDs and validated local Docker contexts; arbitrary remote endpoints/projects/paths are rejected.

State lives in ignored `.local-data/` per-project directories. Generate strong random local-only secrets exclusively on first initialization; never overwrite inconsistent existing state or print credentials/resolved Compose environment. `.env.example` contains non-secret defaults and generation guidance only. Restore needs matching PostgreSQL credentials separately because the cold volume contains role password hashes. No backup/env/raw content enters CI artifacts.

Project names have a fixed local/test prefix; ownership additionally binds labels and an initialization token to this checkout. Names alone do not authorize cleanup. A project operation lock serializes lifecycle/writer commands. Integration creates a new uniquely owned test project, never uses the developer dataset, and proves an independent sentinel resource survives scoped reset.

Normal down preserves volumes and credentials. Reset is explicit and targets only enumerated, label-verified known volumes/containers of that project; no prune, broad glob or unrelated volume deletion. Backup files are outside reset targets. Restoration refuses active, nonempty, unknown or incompatible targets before extraction.

`.mjs` is linted/native-tested; existing TypeScript packages keep strict typecheck. Root adds only `workspace:*` development dependencies on public vehicle-schema/source-registry, and infra:test builds those public exports before fixture validation. Do not import package-private modules or test fixtures, introduce a YAML parser, or call runConnector here.

## First relational foundation

Use `aw_foundation`, with migration bookkeeping outside it. Domain IDs follow ADR-0001 and SDK listing-version/operation key declarations. SQL protects relational integrity; public V1 parsers protect exhaustive payload validity before persistence. Successful SQL insertion never proves rights. No public row serializer or general ingestion API is supplied.

| Relation | Identity and relevant fields | Integrity contract |
| --- | --- | --- |
| source_reference | source_id | Source domain; no enabled/authority flag |
| connector_run_reference | run_id, source_id | Source FK; unique run/source pair |
| raw_snapshot_reference | snapshot_id, run_id, source_id, sha256, bucket, object_key, length, captured_at, retention deadlines, policy metadata | Composite run/source FK; unique snapshot/run/source/SHA and bucket/key; immutable metadata, raw bytes separate |
| vehicle_candidate | vehicle_id, identity_status | Candidate only, never verified |
| listing | listing_id, source_id, source_listing_id, nullable candidate_vehicle_id | Source/vehicle FKs; unique source/publication with deterministic `COLLATE "C"`; URL never identity |
| listing_version | version_id, listing/source/run/snapshot/SHA, mapper, capture, optional URL, deadlines | Composite stable-listing/source and raw-reference FKs; append-only |
| observation | observation_id, subject, field/value, source/run/snapshot/SHA, observed_at/method/status/confidence | Exactly one vehicle/listing subject with FK; complete raw composite FK; append-only distinct contradictions |
| listing_version_observation | version_id, listing_id, observation_id | Composite FKs enforce that version and observation belong to the same listing |
| outbox_event | operation_key, fixed event name, source/run/listing IDs, recorded_at, schema_version | Immutable fixed metadata and existing domain event vocabulary; no arbitrary raw payload |
| outbox_delivery | operation_key, available_at, delivered_at, attempts | Event FK; mutable delivery metadata kept separate |

Use source/listing/version/observation/raw prefixes and bounded fields, lowercase SHA256, finite supported timestamptz(3), confidence0..10000 and known field/method/status discriminants. Keep measurement/currency value JSONB after public validation, not a lossy SQL reinterpretation. `policy_metadata` is the complete V1 `SourceRegistry` snapshot accepted by its public parser, with the same source ID; it is neither the SDK's unversioned `PolicyObligations` object nor an operational authorization flag. Synthetic fixtures keep that registry disabled. Do not duplicate the entire TypeScript parser in SQL or add speculative JSONB indexes. Version/observation membership is a set, not a new ordering contract.

Every non-covered FK access path is indexed. Pending outbox delivery has a partial index; inspect EXPLAIN with synthetic rows without claiming production scale. Evidence FKs use RESTRICT, never cascading history deletion. Application roles cannot UPDATE/DELETE immutable evidence or perform DDL; defensive immutable-row triggers reject accidental owner updates/deletes too, without claiming tamper resistance to superusers. Revoke PUBLIC schema/execute defaults; no security-definer ingestion API.

The test writer inserts canonical evidence and fixed outbox event in one short transaction. Injected failure rolls back both; exact replay preserves prior data and changed key/content conflicts. Never use ON CONFLICT DO UPDATE to rewrite history. No SQL transaction remains open around a network request.

## Migration and raw-write semantics

Migration0001 is applied under a transaction-scoped advisory lock with statement/lock timeout and immutable SHA256 bookkeeping. Identical apply is a no-op; checksum drift/partial failure aborts without schema or ledger progress. Concurrent apply serializes. Initial rollback is supported only when every foundation table is empty; nonempty state is refused atomically and retained. Reapply of the same migration is tested in a disposable database. Do not mask drift with indiscriminate IF NOT EXISTS or DROP CASCADE.

Raw address is exactly `v1/raw/<source_id>/<run_id>/<snapshot_id>` from validated ASCII domain IDs; no external path, publication ID or URL enters it. SQL unique bucket/key forbids sharing or ambiguous retention ownership. Protocol:

1. Conditional PutObject with If-None-Match:*; first success is read back and verified for exact SHA256/byte length before SQL metadata.
2. HTTP412: read existing object; identical digest/length means replay, changed content means typed conflict, never overwrite.
3. HTTP409: at most two additional conditional attempts under the same deadline.
4. Timeout/unknown transport: indeterminate; do not write SQL metadata or invent success.
5. Concurrent same/different payload tests must preserve one correct winner and replay/conflict outcomes.

This is a client write protocol, not native WORM/ObjectLock against privileged direct S3 access. A raw upload can become an orphan before SQL commit; hosting services is not cross-store atomicity or the SDK's durable staging implementation. No existing reference may be silently redirected or erased to conceal conflict.

## Cold backup and isolated restore

Capture exact running/stopped state of every declared project writer under the operation lock; refuse ambiguous paused/restarting/unowned writers. Stop the running writers and verify all are stopped before copying. Helpers never auto-start dependencies.

Archive only the exact PostgreSQL/raw volumes mounted read-only through an isolated bounded helper, using the already pinned PostgreSQL image if its tar capability passes CI. Mount only the intended archive directory, never host root or daemon socket. Record schema version, immutable image manifest and platform digest, OS/architecture/variant, fixed archive names/lengths/SHA256. No live filesystem copy is accepted as a consistent backup.

Restore only into a new stopped project with freshly owned empty volumes. Validate exact digest AND platform and archive integrity before extraction/start. Matching generated PostgreSQL credentials are a separate input, never part of the uploaded evidence. Verify SQL rows/relations/outbox and retrieved raw hashes afterward; index/cache are rebuildable and not canonical backups. Finally restart only original services captured as running; originally stopped ones remain stopped, including failure/cancellation paths. Preserve original data and backups.

## Deadlines, health and image audit

CI integration job30min, integration orchestration20min overall including pulls. Phase limits: config10s, pull600s, usable readiness180s after pulls, API/SQL probe15s, migration30s, stop60s, archive/restore120s each, recovery readiness120s, cleanup120s. Every phase is clipped to remaining overall budget. Audit job30min, each image scan5min. Timeouts fail; no hanging helper or partial run counts as success.

Docker running/healthy state is not sufficient: verify usable SQL/schema transaction, authenticated Redis, OpenSearch index read/write and signed S3 digest retrieval. Structured health contains fixed service/phase/status/code/duration metadata, never credential-bearing URLs, raw source values, SQL row contents or exceptions. Diagnostic artifacts are allowlisted/sanitized; capture evidence before bounded scoped cleanup.

Trivy scans each exact service/tool digest remotely or via verified read-only docker-save archive, never a mounted Docker socket. Retain complete HIGH/CRITICAL JSON including unfixed findings and scanner/database timestamp. Block all CRITICAL and fixable HIGH. Every unfixed HIGH requires dated package-specific independent disposition; any suppression has scope/reason/expiry. No blanket ignore, sole ignore-unfixed report, hidden continue-on-error, unaudited replacement or lowered gate just to obtain green. A scan is not a complete security guarantee.

## Verification and delivery

Required real CI evidence: fresh usable startup; migration twice/drift/partial failure/concurrency/empty rollback/reapply; source/raw/subject/digest FK errors; immutable evidence/least privilege/outbox commit and abort; signed S3 first/replay/conflict/race/timeout; index/cache writes and independence; all-service restart preservation; each dependency failed/recovered; mixed-state cold backup/isolated restore and incompatible/tampered target refusals; scoped reset with surviving sentinel; image audit and sanitized health.

Run local static/lint/native tests plus existing strict typecheck/build/root/secrets/dependency gates. Run real integration/audit in GitHub Actions and document local Docker absence. Require fresh remote checkout, independent implementation infra/code/security APPROVE and architecture CLEAR on the same SHA, implementation CI, committed validation/DONE, final-head CI, merge and main proof before TASK-0006. Plan simulations, ADR-only CI and image metadata lookup do not prove runtime success.

Pre-mortem: reset erases unrelated data (ownership/sentinel guards); migration/backup loses evidence (checksums/transactions/empty rollback/isolated restore); superficially healthy/open services leak data (authenticated probes/negative access/failure/budgets/audit). Every mitigation above has an executable negative case.

## Upstream references

- [Compose trust and pinning](https://docs.docker.com/compose/trust-model/), [Compose up/wait](https://docs.docker.com/reference/cli/docker/compose/up/).
- [PostgreSQL official image](https://hub.docker.com/_/postgres), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html), [advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).
- [OpenSearch Docker](https://docs.opensearch.org/latest/install-and-configure/install-opensearch/docker/), [security-disable limitations](https://docs.opensearch.org/docs/install-and-configure/configuring-opensearch/security-settings/), [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).
- [SeaweedFS releases](https://github.com/seaweedfs/seaweedfs/releases), [S3 auth implementation](https://github.com/seaweedfs/seaweedfs/blob/79b87202136cebdaaa7db4d94eaa5915ad381276/weed/command/s3.go), [server data-path wiring](https://github.com/seaweedfs/seaweedfs/blob/79b87202136cebdaaa7db4d94eaa5915ad381276/weed/command/server.go), [filer default store](https://github.com/seaweedfs/seaweedfs/blob/79b87202136cebdaaa7db4d94eaa5915ad381276/weed/command/filer.go).
- [SeaweedFS image and non-root entrypoint](https://github.com/seaweedfs/seaweedfs/blob/4.45/docker/entrypoint.sh), [image working directory](https://github.com/seaweedfs/seaweedfs/blob/4.45/docker/Dockerfile.local).
- [MinIO upstream status](https://github.com/minio/minio), [Garage quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/), [Garage compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/).
- [Official AWS CLI Docker](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-docker.html), [conditional PutObject](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html), [S3 conditional-write semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
- [Trivy installation](https://www.trivy.dev/docs/latest/getting-started/installation/), [vulnerability scanning limits](https://trivy.dev/docs/latest/scanner/vulnerability/), [GitHub immutable action references](https://docs.github.com/en/enterprise-cloud%40latest/actions/reference/security/secure-use).
