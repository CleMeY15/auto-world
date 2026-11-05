# Isolated prototype application — operations and recovery

Scope: TASK-0106 under ADR-0028. Fabricated data, local Docker, pinned Linux/amd64 services, V1 API only. PostgreSQL is authoritative; OpenSearch is rebuilt, Redis is disposable, and the S3 object is an infrastructure acceptance probe, not a new canonical raw store. Connector raw bytes remain in PostgreSQL. No production/public/real-source authorization follows from these commands.

## Start and stop

Use Node 22.23.2 and pnpm 10.15.0. Install with `pnpm install --frozen-lockfile`. Docker must be local and `vm.max_map_count` must meet the existing OpenSearch requirement. On Windows, use the Linux Docker/toolchain lane for service commands; do not change the existing Windows preview.

```sh
pnpm prototype:application:start --seed
```

The explicit entrypoint builds the existing services, creates an owned `aw-test-UUID` project with random loopback dependency ports, and binds HTTP to `127.0.0.1:3211`. It prints a sanitized project/port record before preparation, then a separate readiness record only after successful startup. Save that project name even if preparation fails, so retained resources remain identifiable. `--seed` is opt-in and uses a stable idempotent SDK invocation, never direct SQL. Its 1000-listing fixture uses the already validated 10-second effect/policy budget and 100-second run budget. Without it, an empty project is honestly empty; the consumer publishes only committed state. Ports 3100 and 3210 are reserved for the existing web/V2 preview and are rejected.

```sh
pnpm prototype:application:start --project aw-test-REPLACE-WITH-EXACT-UUID
```

Use only the exact name printed by this checkout, not a wildcard or another worktree's state. SIGINT/SIGTERM closes application work and pools before stopping services; volumes and private project state remain. Exit 130/143 records the corresponding cooperative signal, not a failed cleanup by itself. A hard kill cannot guarantee cleanup; readiness is emitted only after releasing the short infrastructure operation lock. Restart the same project after a crash. Never delete an operation lock while its owner is alive.

Run exactly one controller per project, on port 3211. `--port` exists for isolated testing only; concurrent controllers on different ports are unsupported. The listener is reserved before seed/consumption. A failed start closes its own clients but deliberately leaves services and data available for inspection, rather than stopping a controller that might already own the port. After resolving the failure, resume the same project; never reset it as a troubleshooting shortcut.

The loopback V1 endpoint is `POST /v1/demo/search`, with JSON `{"schemaVersion":1,"sort":"listing_asc"}`. The existing Host/Origin/forwarded-header, body and deadline controls remain. The web `/demo` uses V2 and is **not** connected by this task. No frontend persistence or new UI is claimed.

## Observability and ownership

- SDK mutation telemetry provides acquisition failures, committed item/byte counts and terminal receipts. Raw-hash checks plus immutable listing/observation counts provide data-quality inputs. Keep source/run/policy identifiers internal; the acceptance artifact exports aggregate counts only.
- The search runtime exposes pending count, oldest relevant outbox lag, and `none`/`warning`/`critical`. Existing thresholds remain: lag above 60 seconds continuously for 5 minutes warns; halted quarantine is critical. Publication acceptance requires <=60 seconds. The process periodically samples existing health, without an additional scheduler or dashboard product.
- API failures produce the existing typed 503 response and `api.failure` signal. Local process summaries omit raw payloads, SQL, endpoints with credentials, source IDs and request bodies. The acceptance runner observes the failure alerts during PostgreSQL/OpenSearch outages.
- These are tested process signals/dashboard inputs, **not** a deployed dashboard, pager, external alert pipeline or production SLO. Before external exposure, separately design and validate rate limits, edge protection, credentials, privacy/retention and source rights.
- Platform/SRE owns application start/stop, service health and restore; Search/API owns projection failures; Data/Connector owns acquisition/provenance and failed ingestion receipts; Security/Legal owns any real-source takedown/retention decision. No fictitious on-call address or enabled real-source takedown service is implied.

On failure, stop new ingestion, retain the durable terminal receipt or search quarantine, diagnose the typed cause, and correct it. Search exhausts at most five attempts and halts. **Never** automatically call `reviewReplay`, delete failure evidence, edit attempt counters or overwrite canonical history to make it green. Reviewed replay remains the explicit API described in TASK-0105's validation/runbook.

Interrupted full imports follow [ADR-0031](../decisions/ADR-0031-interrupted-full-reconciliation.md): a fresh full invocation reconciles current active canonical projections while preserving explicit withdrawals/deletions and all historical receipts. Once a newer same-scope run exists, an older running checkpoint cannot resume; use a fresh invocation key/run ID. Repairing ingestion does not automatically clear a halted search consumer. An exact completed replay is still audited by one fresh-fence `run.opened` receipt/outbox event, without adding listing, observation, page or finalization effects.

## Backup and isolated acceptance restore

Run `pnpm prototype:application:test` for the complete owned fixture scenario, not against your running manual project. It tests actual HTTP, 1000 listings, 50 timed mixed queries, idempotent replay, hard process restart, graceful stop, four isolated outages, cold backup and fresh-target restore. Only runner-owned disposable resources are reset; an independent labeled sentinel must survive. Failure artifacts and private backups remain under ignored `.local-data/`.

The existing `scripts/data-infra/backup.mjs` is the only backup implementation. Required order:

1. Stop accepting application work; abort and await the consumer; close HTTP and all pools.
2. With no remaining application writer, capture all four schemas, identity sequences, raw hashes and committed causal watermark. Reject unknown relations, excessive fixture sizes or external tablespaces. Close the snapshot pool.
3. Under the existing project lock, call `backup(state)`. It verifies ownership/exclusive writers, stops all four services and archives the entire PostgreSQL and S3 volumes, then restores the exact previous service states.
4. Call `restoreCheck(source, backupId, {verify})` within that source lock. It creates a distinct owned target with fresh OpenSearch/Redis. The callback must compare exact PostgreSQL rows/sequences **before opening any application writer**, verify the S3 probe, then reconcile OpenSearch and compare every public result. Close target clients inside the callback; the existing helper then resets/discards only that target.

The generic foundation `infra:restore-check` default probe is **not** the application proof: this task supplies its own verification callback and does not create the unused `aw_foundation` schema. Do not point a restore at a populated project or roll a physical backup across incompatible versions/platforms. External tablespaces are deliberately unsupported. PostgreSQL's [whole-cluster cold backup requirements](https://www.postgresql.org/docs/17/backup-file.html) apply; pinned images and existing archive verification are retained.

Acceptance records the final durable watermark, backup timestamp, age <=5 minutes at restore start, exact-state RPO 0, and restore plus reconciliation <=10 minutes. The existing restore callback also has its stricter 120-second phase budget. These are bounded fixture objectives, not production RPO/RTO. Archives, state files, raw rows and credentials never enter public CI artifacts; only counts, SHA-256 digests, timings and image/source identities do.

## Rollback

Stop this process normally and preserve its volumes/history. Continue using the unchanged offline demo/V2 preview. Roll back the application branch/code, not the populated database: existing migration `down` intentionally refuses populated state. A future schema alteration needs a new migration. The tested stop/restart path proves durable data remains; no destructive production rollback is claimed. Do not run broad Docker prune, wildcard volume removal, or reset another checkout.

TASK-0005 image/scanner/admission qualification stays deferred until the usable V1 milestone and does not restart automatically after this technical acceptance.
