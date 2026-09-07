# Auto World

Global automotive search platform: one search across permitted/partner vehicle listings, with canonical normalization, deduplication, market pricing, history, import-cost intelligence, saved searches and AI-assisted discovery.

## Source of truth
- `AGENTS.md` — rules for Codex/agents
- `ROADMAP.md` — master execution roadmap
- `docs/` — architecture, data, AI, product, security and quality contracts
- `roadmap/` — executable epics/tasks

## Initial target
Vertical slice: one real permitted source -> ingestion -> raw store -> normalization -> canonical vehicle -> search index -> API -> web results.

## Workspace
This repository is a pnpm + Turborepo monorepo. Node `22.23.2` and pnpm `10.15.0` are the reproducible toolchain for TypeScript services and apps. Python services can be introduced only where materially useful for data/ML workloads.

`packages/vehicle-schema` provides the internal V1 VehicleEntity/Listing/Observation contract, strict runtime validation and immutable provenance-bearing evidence. See its [contract guide](packages/vehicle-schema/README.md) and [ADR-0001](docs/decisions/ADR-0001-canonical-vehicle-contract.md). `packages/source-registry` adds declared source policies, immutable audit revisions, contextual eligibility and operational health under [ADR-0002](docs/decisions/ADR-0002-source-registry-contract.md). Structural eligibility is not real source authorization. The [Connector SDK](connectors/_sdk/README.md) executes bounded ingestion, raw staging, provenance mapping and scoped reconciliation through injected ports under [ADR-0003](docs/decisions/ADR-0003-connector-sdk-contract.md). Its transactional test store and source fixtures are synthetic, not production integrations. The six other workspace members remain architecture-only placeholders; no product UI, real source adapter, authentication or production infrastructure is implemented yet. Track delivery and current validation status in [the roadmap ledger](roadmap/DELIVERY.md).

## Deterministic bootstrap

Prerequisites:

- Git;
- a Node version manager that reads `.nvmrc`;
- Corepack, included with the supported Node release.

From a fresh clone:

```sh
git clone https://github.com/CleMeY15/auto-world.git
cd auto-world
nvm install 22.23.2
nvm use 22.23.2
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

`pnpm install --frozen-lockfile` is intentional: dependency changes must update and commit `pnpm-lock.yaml`. Never replace it with a non-frozen CI install.

## Quality commands

Run gates independently when diagnosing a failure:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm secrets:check
pnpm run audit:dependencies
```

`pnpm check` runs the same gates in release order. Every workspace member exposes lint, typecheck, test and build tasks; the three active packages have runtime and type regression tests, while six placeholders have build-boundary smoke tests. Direct source-registry and SDK build/test/typecheck rebuild their public workspace dependencies; Turbo also orders dependency builds before typechecking. A zero-task Turbo run is not accepted as validation. The dependency audit fails on any known vulnerability severity.

## Local environment

Copy `.env.example` to `.env` and keep local values out of Git. The example contains local endpoints only and is never a production secret source.

```sh
cp .env.example .env
```

The local/CI data foundation is being implemented in TASK-0005. Its [operations guide](infra/README.md) describes the isolated Compose stack and explicit lifecycle commands. Check the delivery ledger and validation evidence before treating a task as accepted. This foundation is not a production deployment or a ConnectorStorePort implementation.

## CI

Pull requests and pushes to `main` run the frozen install and each quality gate as a separate GitHub Actions step. The CI runtime is read from `.nvmrc`; the pnpm action version must stay aligned with `packageManager` in `package.json`.

TASK-0005 adds separate mandatory real-container integration and immutable-image audit jobs. Only sanitized health records and upstream image vulnerability reports are uploaded; local credentials, database archives and raw payloads are excluded.

## First Codex instruction
`Read AGENTS.md and ROADMAP.md. Then inspect roadmap/epics/EPIC-000-foundation.md and execute only the first READY task, respecting dependencies and Definition of Done.`
