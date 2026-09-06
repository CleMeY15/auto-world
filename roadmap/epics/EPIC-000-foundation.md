# EPIC-000 — Foundation and executable contracts

Status: READY
Priority: P0

## Goal
Create a reproducible monorepo foundation and freeze the first cross-service contracts before source-specific development begins.

## Tasks
1. `TASK-0001-workspace-bootstrap.md` — DONE
2. `TASK-0002-canonical-vehicle-schema.md` — BLOCKED by TASK-0001
3. `TASK-0003-source-registry-contract.md` — BLOCKED by TASK-0002
4. `TASK-0004-connector-sdk-contract.md` — BLOCKED by TASK-0002 + TASK-0003
5. `TASK-0005-local-data-infra.md` — BLOCKED by TASK-0001
6. `TASK-0006-first-vertical-slice-plan.md` — BLOCKED by TASK-0004 + TASK-0005

## Exit gate
The first connector can be implemented without inventing schemas, source-rights semantics, retry behavior or canonical fields.
