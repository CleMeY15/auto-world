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

`packages/vehicle-schema` provides the internal V1 VehicleEntity/Listing/Observation contract, strict runtime validation and immutable provenance-bearing evidence. See its [contract guide](packages/vehicle-schema/README.md) and [ADR-0001](docs/decisions/ADR-0001-canonical-vehicle-contract.md). `packages/source-registry` adds declared source policies, immutable audit revisions, contextual eligibility and operational health under [ADR-0002](docs/decisions/ADR-0002-source-registry-contract.md). Structural eligibility is not real source authorization. The [Connector SDK](connectors/_sdk/README.md) executes bounded ingestion, raw staging, provenance mapping and scoped reconciliation through injected ports under [ADR-0003](docs/decisions/ADR-0003-connector-sdk-contract.md). Its transactional test store and source fixtures are synthetic, not production integrations. [The design system](packages/design-system/README.md) provides shared semantic tokens and accessible primitives; `apps/web` is a real Next.js component preview, not a working vehicle search. Five other members remain architecture-only placeholders. No real source adapter, authentication or supported four-service acceptance is implemented by this preview. Track delivery and current validation status in [the roadmap ledger](roadmap/DELIVERY.md).

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
pnpm --filter @auto-world/web exec playwright install --with-deps chromium webkit
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
pnpm test:ui
pnpm secrets:check
pnpm run audit:dependencies
```

`pnpm check` runs the same gates in release order. Every workspace member exposes lint, typecheck, test and build tasks; the active contracts/design system have runtime and type regression tests, the web preview has build-boundary and browser tests, and five placeholders have build-boundary smoke tests. Direct source-registry and SDK build/test/typecheck rebuild their public workspace dependencies; Turbo also orders dependency builds before typechecking and each package's build before its tests. A zero-task Turbo run is not accepted as validation. The dependency audit fails on any known vulnerability severity.

Root build, typecheck and test commands schedule one Turbo task at a time. This prevents those direct dependency rebuilds from overwriting shared declarations while another task reads them; lint remains parallel. Some quality gates may take longer. Run one quality command at a time in a checkout: this scheduling does not coordinate separate shell commands.

## Local environment

### Web component preview

```sh
pnpm --filter @auto-world/design-system build
pnpm --filter @auto-world/web dev --port 3100
```

Open `http://127.0.0.1:3100`. Form validation, reset, selected chip, appearance and recovery controls run locally and store nothing. This is not the later Search/Results/Listing/Saved flow. It does not need `.env`, Docker, database, network data or credentials. For the production preview, run `pnpm build`, then `pnpm --filter @auto-world/web start --port 3100`. Both commands bind loopback only. For UI testing install the pinned Chromium/WebKit runtimes once, then run `pnpm build` and `pnpm test:ui`. CI records browser reports, traces on failure and screenshots for 14 days; reviewed screenshots and measurements are retained under `docs/validation/artifacts/TASK-0007/`.

### Future service environment

Copy `.env.example` to `.env` and keep local values out of Git. The example contains local endpoints only and is never a production secret source.

```sh
cp .env.example .env
```

The services are placeholders in TASK-0001, so no local data infrastructure is started by this bootstrap.

## CI

Pull requests and pushes to `main` run the frozen install and each quality gate as a separate GitHub Actions step, including production-build browser interactions, accessibility and bounded mobile performance. The CI runtime is read from `.nvmrc`; the pnpm action version must stay aligned with `packageManager` in `package.json`. Next.js telemetry is disabled in CI; no application analytics collector is configured by the preview.

## First Codex instruction
`Read AGENTS.md and ROADMAP.md. Then inspect roadmap/epics/EPIC-000-foundation.md and execute only the first READY task, respecting dependencies and Definition of Done.`
