# Persistent web prototype — operations and recovery

Scope: TASK-0119 under [ADR-0032](decisions/ADR-0032-persistent-web-prototype.md). This is a local, loopback-only prototype using fabricated data. PostgreSQL remains authoritative, OpenSearch remains a rebuildable projection, and browser-saved searches and comparisons remain local to the browser. These instructions do not authorize production use, public exposure, or any real data source.

TASK-0119 is locally validated; [the evidence record](validation/TASK-0119.md) distinguishes those results from pending PR/protected-main delivery. This runbook is not a production acceptance record.

## Fixed boundaries

- Use Node 22.23.2 and pnpm 10.15.0. Install with `pnpm install --frozen-lockfile`. Docker must be local and satisfy the existing OpenSearch `vm.max_map_count` requirement.
- The persistent web prototype is available only at `http://127.0.0.1:3111/demo`; its API binds only to `127.0.0.1:3211`.
- Ports 3100 and 3210 belong to the existing offline preview and its API. This prototype does not replace, proxy, or mutate them.
- Prototype mode is an explicit closed opt-in. It does not accept arbitrary upstream endpoints and has no fallback to the offline fixture or a remote backend.
- The seed contains exactly 1000 deterministic synthetic listings. Exactly 900 expose an authored synthetic vehicle description; every tenth listing deliberately exposes `description.status = "unavailable"`.
- Browser state uses the prototype-only keys `auto-world.prototype.favorites.v1`, `auto-world.prototype.saved-searches.v1` and `auto-world.prototype.saved-comparisons.v1`. It does not overwrite the offline preview's `auto-world.demo.*` keys. Browser storage is not server-side account persistence.

## Start and seed a distinct project

From the repository root, start a new owned project and seed it once:

```sh
pnpm prototype:web:start --seed
```

The command builds the affected search and web packages, creates a distinct owned project named `aw-test-UUID`, applies the existing connector/search migrations plus additive search migration 2, starts the API on port 3211 and Next.js on port 3111, then prints JSON records. Save the exact `project` value from `prototype_application_project`. Readiness is established only when `prototype_application_ready` includes:

```json
{"port":3211,"webUrl":"http://127.0.0.1:3111/demo"}
```

The seed goes through the existing connector SDK and canonical store; it does not write directly to the search index. Running the same seed invocation against the same project is idempotent and preserves audited canonical history.

After Docker reports the containers healthy, the web controller waits up to 120 seconds (or the shorter project deadline) for all four usable-service probes. OpenSearch must be green/yellow and the S3 bucket must respond; container HTTP readiness alone is insufficient. Failed probe diagnostics are retained without credentials. The wait never resets data, reseeds the project, or relaxes a probe; expiration fails startup.

Do not pass `--no-consume`: the user-facing prototype requires the consumer to publish committed canonical state. Do not pass `--port`; TASK-0119 deliberately fixes the API at 3211.

## Stop without losing data

In the terminal running the prototype, press `Ctrl+C` once. The controller closes the owned Next.js process, API, consumer and database clients, then stops the project's services. It preserves PostgreSQL, OpenSearch, object-store and Redis volumes together with the private project state required for restart.

An exit code of 130 after `SIGINT`, or 143 after `SIGTERM`, records cooperative shutdown and is not by itself evidence of lost data. A hard kill cannot guarantee orderly client cleanup; keep the printed project name and use the restart procedure below.

If a crashed controller left services running, stop only that exact owned project after confirming no controller still owns it:

```sh
pnpm infra:stop -- --project aw-test-REPLACE-WITH-EXACT-UUID
```

Never use a wildcard, Docker-wide prune, or another worktree's project name.

## Restart the persistent project

Restart with the exact project name printed at first launch:

```sh
pnpm prototype:web:start --project aw-test-REPLACE-WITH-EXACT-UUID
```

Do not add `--seed` for a normal restart. The command reuses the retained canonical data and search projection, verifies the stored V2 profile before listening, and makes the same browser-local saved state visible in the same browser profile.

If a previous seed was interrupted before reaching a terminal committed state, the bounded recovery is to rerun the same owned project with the fixed idempotent seed:

```sh
pnpm prototype:web:start --project aw-test-REPLACE-WITH-EXACT-UUID --seed
```

Do not edit rows, outbox attempts, raw payloads, mapping metadata, or operation locks to force recovery.

## Profile and migration safety

Search migration 2 is additive: it introduces the V2 projection without modifying migration 1 or converting an existing V1 index in place. Historical V1 factories and payloads remain readable by their existing path.

Before seed, API listen, or web listen, the runtime compares the expected fixture, catalog, mapper, canonical-run/raw-reference metadata and recorded mapping/profile with the stored project. A project created with V1 or a different fixture/mapper is rejected. OpenSearch ownership metadata, sealing and document content are additionally verified during publication and reconciliation. There is no automatic profile conversion, destructive repair, or fallback to a different backend.

Use a fresh distinct project for a different profile. Preserve an incompatible project for diagnosis rather than resetting it as a shortcut.

## Explicit destructive reset

Reset is exceptional and destructive. It is permitted only for the exact locally owned `aw-test-UUID` after the prototype controller has stopped and the operator has verified the project name:

```sh
pnpm infra:status -- --project aw-test-REPLACE-WITH-EXACT-UUID
pnpm infra:reset -- --project aw-test-REPLACE-WITH-EXACT-UUID
```

`infra:reset` removes that project's owned data volumes while preserving backups. It destroys the persistent prototype data and cannot be used as evidence that restart or migration recovery works. It does not authorize deleting project state, unrelated Docker resources, backups, or another checkout's volumes.

## Bounded troubleshooting

### Port 3111 or 3211 is unavailable

Run only one persistent web controller at a time. Stop the process that owns the conflicting loopback port, or cooperatively stop the known prototype controller. Do not move TASK-0119 to another port and do not stop the preview on 3100/3210 merely to make the prototype start.

### Startup reports `prototype_web_start_failed`

Keep the preceding sanitized JSON records. Check the exact project's services:

```sh
pnpm infra:status -- --project aw-test-REPLACE-WITH-EXACT-UUID
```

Resolve a failed local dependency, Docker readiness issue, or port conflict, then restart the same project. Do not reset first: the retained state is the evidence needed to distinguish infrastructure failure from profile rejection.

### The project is rejected before readiness

Treat rejection before `prototype_application_ready` as intentional when the stored canonical or search profile differs. Confirm that the `aw-test-UUID` came from this TASK-0119 checkout. Start a new project for the current synthetic profile; do not edit profile fingerprints, migrations, raw-reference metadata or OpenSearch `_meta` values.

### The page loads but data is unavailable

The UI must show honest dependency-unavailable states; it must not silently switch to the offline fixture. Check project health with `infra:status`, stop the controller normally, then restart the same project. Docker may reassign an ephemeral published database/index port when a container restarts; reopening the controller resolves the current service addresses, as in TASK-0106. This prototype does not promise automatic hot rebinding of existing clients. If OpenSearch alone was interrupted, the retained PostgreSQL history remains authoritative and the bounded publication/reconciliation path should restore the projection.

### Saved searches or comparisons appear missing

Use the same browser profile and origin `http://127.0.0.1:3111`. Prototype saved state is namespaced local storage, not PostgreSQL data, and therefore does not follow the project to another browser profile or device. Do not copy values into the offline preview's `auto-world.demo.*` namespace.

### The retained synthetic results are marked stale

The seed is a fixed snapshot, not a live vehicle feed. Its original `dataAsOf` is preserved, so results eventually use the existing `projection_stale` state and omit a fresh exact count while remaining readable. Restart or idempotent reseed does not invent a newer observation time. This warning is not data loss; do not change timestamps or reset a retained project to hide it.

## Rollback and deferred qualification

Stop the persistent prototype normally and continue using the unchanged preview on ports 3100/3210. Roll back code, not a populated project: destructive in-place downgrade is refused, and a future schema change requires a new additive migration.

The TASK-0005 V1 image, scanner and admission qualifications remain deferred and non-production for this prototype milestone. TASK-0119 does not restart those qualifications, weaken their eventual controls, or grant production admission.
