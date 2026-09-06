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

The current workspace members are architecture-only placeholders. They establish package boundaries and quality-gate execution without implementing product UI, vehicle contracts, real connectors, authentication or production infrastructure.

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

`pnpm check` runs the same gates in release order. Every workspace placeholder exposes real lint, typecheck, test and build tasks; a zero-task Turbo run is not accepted as validation. The dependency audit fails on any known vulnerability severity.

## Local environment

Copy `.env.example` to `.env` and keep local values out of Git. The example contains local endpoints only and is never a production secret source.

```sh
cp .env.example .env
```

The services are placeholders in TASK-0001, so no local data infrastructure is started by this bootstrap.

## CI

Pull requests and pushes to `main` run the frozen install and each quality gate as a separate GitHub Actions step. The CI runtime is read from `.nvmrc`; the pnpm action version must stay aligned with `packageManager` in `package.json`.

## First Codex instruction
`Read AGENTS.md and ROADMAP.md. Then inspect roadmap/epics/EPIC-000-foundation.md and execute only the first READY task, respecting dependencies and Definition of Done.`
