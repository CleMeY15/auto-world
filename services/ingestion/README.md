# Ingestion service

Owns source runs, immutable raw snapshots, idempotency, retry/DLQ and listing lifecycle events. Source-specific logic belongs in connectors/.

## Isolated PostgreSQL prototype — TASK-0104

The ordinary service remains a production placeholder. [ADR-0029](../../docs/decisions/ADR-0029-prototype-postgres-store.md) implements the existing SDK store/lease ports separately under `prototype/`; nothing connects the public API or UI to this database yet (TASK-0105).

The user approved `pg` and its TypeScript types, without an ORM. They and the SDK/contracts are development dependencies. The only package export is `@auto-world/ingestion/prototype` under the explicit `auto-world-prototype` Node condition. `NODE_ENV=production` rejects it. Ordinary `dist/` and the package file list exclude prototype code, test data and connection logic; `.prototype-dist/` is separate and reproducibly built/cached.

```js
// Explicit dev/test composition only, never a production feature flag.
import { createPostgresPrototype } from "@auto-world/ingestion/prototype";
const runtime = createPostgresPrototype({ host: "127.0.0.1", port, password });
// Inject runtime.store and runtime.lease into the existing SDK, with synthetic ports.
// Close after the run: await runtime.close();
```

Connection configuration accepts only literal loopback, the generated writer password and a valid port. Database/user, connection count and timeouts are fixed. Credentials are not logged or committed. The SDK obtains the original errors only as fixed failure codes; driver errors never become log payloads.

## Validation command

From the repository root with Node 22.23.2, pnpm 10.15.0 and local Linux Docker/Compose:

```sh
pnpm install --frozen-lockfile
pnpm --filter @auto-world/ingestion test
pnpm prototype:test
```

The real-database command selects only the existing pinned PostgreSQL service, initializes a new owned `aw-test-*` project with random loopback port/credentials, applies the separate connector migration and executes the real transaction/recovery scenarios. It uses standard `pg_dump`/`pg_restore` to restore into a distinct empty owned project and verifies an independent sentinel. No scanner, admitted-runtime broker, S3, Redis or OpenSearch is started. Normal quality and dependency checks remain required.

The command deletes only the temporary synthetic databases/containers it created. It retains sanitized JSON evidence under `.local-data/prototype-postgres/<run-id>/result.json`; the CI workflow uploads only that file, never raw bytes, SQL dumps, credentials or project state. `--migrations-only` on `scripts/prototype-postgres/integration.mjs` proves only migration/privilege behavior, not the StorePort.

On Windows, run the database command inside the existing Linux environment. The host preview is unrelated and must not be stopped. A task-local Compose plugin can use Docker's documented `DOCKER_CONFIG/cli-plugins` layout without changing global configuration.

## Data and recovery

`aw_connector` holds raw bytes separately from append-only canonical evidence, with mutable scoped projections/checkpoints. Raw staging, canonical commits and full finalization each commit their receipt/outbox in the same PostgreSQL transaction. A source row serializes lease takeover and writes; leases use database time and monotonic fences. No automatic retry follows an unknown commit: acquire a new lease, open the identical run, then use its receipt to resume.

Migration checksums and history live separately in `aw_connector_migration`. Reapplying the same migration is a no-op; changed bytes conflict. The initial down migration refuses every nonempty application table. Roll back application code and stop the owned prototype first; keep its database and history intact. Never drop observations or use a forced reset to make a migration pass. Backup restore refuses a target already containing the connector schema/history.

Only fabricated data is authorized. Runtime expiry checks do not claim production retention/takedown workers, authenticated real-source policy, image qualification or release readiness. See [ADR-0028](../../docs/decisions/ADR-0028-v1-prototype-functional-gate.md) for the deferred TASK-0005 qualification and the later V1 release boundary.
