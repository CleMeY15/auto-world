# Local and CI data foundation

TASK-0005 implementation in progress. Passing static tests does not prove Docker startup, recovery or image safety. Acceptance evidence is recorded separately before the task becomes Done.

This stack implements [ADR-0004](../docs/decisions/ADR-0004-local-data-infrastructure.md): PostgreSQL canonical evidence/outbox, SeaweedFS raw bytes, rebuildable OpenSearch index and Redis cache. No real source is authorized or fetched, no connector runs, and no production infrastructure is deployed.

## Supported prerequisites

- Project Node22.23.2 and pnpm10.15.0, frozen workspace installation.
- A local Linux/amd64 Docker Engine and Docker Compose V2 with long-form port mapping, `create`, `up --wait` and resource-limit support. Remote Docker contexts are rejected.
- At least 6GiB available Docker memory (the four service limits total3840MiB; helpers need headroom), 10GiB free disk initially, and additional room for immutable images/backups.
- OpenSearch requires `vm.max_map_count` at least262144 in the Docker Linux host/VM. The CI sets this only on its disposable runner. The scripts never install Docker or alter the workstation/host kernel.

The current Windows development host has no Docker/Podman CLI. Local static gates remain usable; real Linux GitHub Actions containers are the runtime acceptance lane. A Windows Docker Desktop Linux backend needs the same prerequisites; do not infer desktop validation from Linux CI.

## Start and inspect

```sh
pnpm install --frozen-lockfile
pnpm infra:init
pnpm infra:up
pnpm infra:status
```

`init` creates strong, separate local-only PostgreSQL role, Redis and S3 credentials. It refuses inconsistent state rather than overwriting it. Files are in ignored `.local-data/projects/aw-local-default/`; POSIX permissions are restricted where supported. Windows ACL hardening is not claimed. Do not copy these files into reports, commits or a production deployment.

`up` verifies ownership, pulls immutable pins, starts the four services, applies the migration and checks usable authenticated APIs. Endpoints bind127.0.0.1 only: PostgreSQL5432, OpenSearch9200, Redis6379, S3-compatible9000. Explicit identity configuration disables SeaweedFS anonymous/default open-key access. OpenSearch security is disabled only for this isolated local/CI stack; other local users may reach loopback, so this is not a multi-tenant security boundary.

Use `--project aw-local-<name>` consistently on commands if the default name/ports are unsuitable for the current checkout. Project names do not grant ownership: labels and a per-checkout token are checked before mutation. Parallel development stacks currently need separate Docker hosts or an explicit reviewed port configuration change; the supported CLI does not accept arbitrary endpoints/paths. CI uses unique test names and ephemeral loopback ports.

`infra:status` emits fixed service/phase/status/code/duration fields and exits nonzero if a dependency is unusable. It never emits credentials, resolved Compose configuration, query rows or raw content. Do not publish `docker inspect`, resolved Compose output or unsanitized service logs; those may contain secrets or source values. Container json-file logs are bounded to3×10MiB per service. No production dashboards/alerts are implemented.

## Stop, resume and reset

```sh
pnpm infra:stop
pnpm infra:start
pnpm infra:status
pnpm infra:stop --service redis
pnpm infra:start --service redis
pnpm infra:down
```

Stop/start preserves containers and data. Down removes only the verified project containers/network and preserves its data volumes and credentials. A later `infra:up` reuses them. Redis AOF/graceful restart is not a zero-loss crash guarantee; index/cache remain rebuildable, not canonical authorities.

```sh
pnpm infra:reset
```

Reset is explicitly destructive: it removes only this project's enumerated, label-verified four data volumes after shutdown. It cannot recover those volumes without a separate backup. Credentials and `.local-data/backups/` remain. It does not call Docker prune, delete unrelated volumes or recursively delete workstation directories. Integration creates and verifies an independent sentinel survives reset, then removes that sentinel itself.

Every lifecycle/writer command acquires a project operation lock. Overlapping operations fail. After a killed process, do not blindly remove a lock: first establish that its recorded PID no longer runs and no helper/writer remains. SIGKILL, host failure or daemon loss can prevent in-process cleanup; inspect owned resources and recover the prior service state. Ordinary reported failures run bounded recovery.

## Schema, raw evidence and rollback

```sh
pnpm infra:migrate
pnpm infra:migrate --direction down
pnpm infra:migrate --direction up
```

Migration0001 uses a short transaction, advisory lock and immutable checksum/event ledger. Reapplying identical SQL is a no-op; drift and partial failure abort. Down takes exclusive table locks and refuses any populated foundation before dropping the schema. It never uses cascading history deletion. Keep applied migration files unchanged; later evolution requires a new reviewed migration, not a checksum rewrite.

`aw_migrator` owns DDL; `aw_writer` may select/insert immutable evidence and update only delivery metadata; `aw_reader` is read-only. Bootstrap is separate. Immutable triggers are defensive, not tamper resistance to the database owner/superuser. No lawful retention operator, authenticated rights service or public row serializer is implemented.

Raw object keys use validated source/run/snapshot IDs. Conditional writes, SHA256 and length readback precede SQL references. Replays compare existing bytes; conflicts never overwrite. Unknown effects produce no SQL metadata. There is no PostgreSQL+S3 distributed transaction: orphan raw objects remain possible. The protocol is not native WORM/ObjectLock and does not stop a privileged user from bypassing it. Policy snapshots remain distinct from operational authorization.

## Cold backup and isolated restore check

```sh
pnpm infra:backup
pnpm infra:restore-check --backup <backup-uuid>
```

Backup requires all four project containers to exist in unambiguous running/stopped states. It records those states, refuses other volume writers, stops only running services and verifies all writers stopped. Exact PostgreSQL/raw volumes are archived through a resource-bounded, network-isolated pinned helper. Only those volumes and the generated backup directory are mounted. Minimal tar ownership capabilities are required; no privileged container or daemon socket is used.

Backups are outside reset targets. Their manifest binds fixed filenames, sizes/SHA256, exact image manifest and platform digests, OS/architecture/variant. The initial format accepts ordinary relative files/directories, not filesystem links or device nodes. Archive hashes detect accidental change; they are not signatures against an owner able to replace both archive and manifest.

Restore-check validates the manifest/archives/platform before extraction, creates a fresh isolated stopped project with empty owned volumes, imports and verifies SQL/raw references, then removes only that temporary project. Matching PostgreSQL credentials come separately from the original ignored state because the volume includes role password hashes. Never upload archives or credentials as CI evidence. Restore never replaces the active developer database. Original services resume only if they were running before backup; originally stopped services remain stopped.

This is exact-image/architecture cold recovery, not a major-version upgrade or cross-platform backup. A separately managed PostgreSQL logical `pg_dump`/`pg_restore` workflow can complement it; no unexecuted logical-restore success is claimed. Review a migration/upgrade plan before changing image versions.

## Validation and budgets

```sh
pnpm check
pnpm infra:test
pnpm infra:audit
```

`infra:test` builds public contract exports, validates fabricated fixtures, then uses a uniquely owned real Compose project. It exercises startup, migration transaction/replay/drift/concurrency/empty rollback, provenance/FK/role protections, atomic evidence/outbox abort, conditional S3 races, restart/dependency failure, cold recovery and scoped reset. It never imports private package tests or calls `runConnector`.

Integration has20min overall including pulls: config10s, pulls600s, usable startup180s after pulls, SQL/API15s, migration30s, stop60s, archive/restore120s per phase, recovery120s and bounded cleanup120s. Timeouts fail. CI job cap30min provides cleanup/artifact headroom.

The separate image audit scans all six immutable service/tool pins remotely without a Docker socket. Complete HIGH/CRITICAL reports retain unfixed findings and scanner/database timestamps. Every CRITICAL and fixable HIGH blocks; unfixed HIGH needs an exact package/version/image-specific, dated independent disposition, maximum30days. The initial disposition list is empty. Never use blanket ignores or change the gate to obtain green. Audit per-image cap5min, job cap30min. This does not replace a broader security review.

Only `.local-data/integration/*/evidence/*.json` and `.local-data/audits/*/evidence/*.json` are CI artifact inputs. Secrets, raw files, database archives, generated environment and resolved Compose output are excluded.
