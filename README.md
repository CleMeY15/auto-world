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
This repository is a pnpm + Turborepo monorepo. Node 22 is the default runtime for TypeScript services/apps. Python services can be introduced only where materially useful for data/ML workloads.

## First Codex instruction
`Read AGENTS.md and ROADMAP.md. Then inspect roadmap/epics/EPIC-000-foundation.md and execute only the first READY task, respecting dependencies and Definition of Done.`
