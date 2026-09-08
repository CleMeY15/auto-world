# EPIC-000 — Foundation and executable contracts

Status: IN_PROGRESS
Priority: P0

## Goal
Create a reproducible monorepo foundation and freeze the first cross-service contracts before source-specific development begins.

## Tasks
1. `TASK-0001-workspace-bootstrap.md` — DONE
2. `TASK-0002-canonical-vehicle-schema.md` — DONE; PR #4 merged at `fe82aaf`, main CI green
3. `TASK-0003-source-registry-contract.md` — DONE; PR #5 merged and main verified at `79e6ab0`
4. `TASK-0004-connector-sdk-contract.md` — DONE; PR #6 merged into accepted main `b9d22a2`
5. `TASK-0005-local-data-infra.md` — IN_PROGRESS; data/native drafts unaccepted; bounded attestation diagnostic only, no automatic continuation
6. `TASK-0006-first-vertical-slice-plan.md` — BLOCKED by TASK-0004 + TASK-0005

## Exit gate
The first connector can be implemented without inventing schemas, source-rights semantics, retry behavior or canonical fields.
