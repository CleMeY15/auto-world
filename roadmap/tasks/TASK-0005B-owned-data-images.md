# TASK-0005B — Owned corrected data images

Status: BLOCKED by accepted TASK-0005A activation
Priority: P0
Owner: Platform/SRE executor; independent infrastructure/security reviewers

## Goal, scope and contracts

Complete TASK-0005 on existing draft PR #7 using owned corrected private service images after actual 5A activation. Preserve the canonical/raw/outbox contracts, readiness, migrations, backup/restore, UID/GID 1000 and raw-volume `nocopy:true` behavior proven in the existing 17-phase integration oracle. Follow TASK-0005, ADR-0005, architecture/data/security and Definition of Done; no production resources or source activation.

## Dependencies and readiness

Requires 5A DONE with committed main-verified activation identity, admitted native tools and complete source/audit/signature/export evidence. A dormant workflow, reviewed plan or public key does not satisfy this dependency. Service correction recipes and exact OpenSearch module/JDK profile must be independently reviewed before implementation; retain original PR #7 and planning evidence until then.

## Acceptance and test strategy

- Fresh corrected service images, exact source/material/recipe pins, source/notices/SBOM/provenance/signature closure and unchanged CRITICAL/HIGH audits, including scanner image self-audit.
- Two independent fresh reconstructions per image with reviewed reproducibility contract; no automatic pin/adoption update.
- Full real 17-phase runtime, readiness, migration, persistence, backup/restore and failure-cleanup matrix. Refuse every nonempty, incompatible or foreign restore target; preserve unrelated resources.
- Independent code/security and architecture review, forced root checks, fresh HTTPS clone, exact final-head CI and postmerge main verification.
- Document resources, logs/health, rollback, unavailable capabilities, retained evidence and source provenance. Accepted evidence retained supported lifetime plus 365 days; missing closure/revocation blocks use.

Stop on any failed gate; do not merge PR #7 or start TASK-0006 from current preparation. No implementation or completion is claimed by this task contract.
