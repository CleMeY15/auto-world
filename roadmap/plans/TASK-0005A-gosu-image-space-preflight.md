# TASK-0005A — ordinary-client filesystem headroom preflight

Status: IN_PROGRESS. Owner: Platform/SRE. Base: PR172 main22c876b3ec58fca8f1a4fdbb6923f0d3737c69ee/treec2868df45bd71cd9064436a97caee9dd1a8c8668,991 tracked files. This focused correction precedes actual B1a caller authoring and launch.

## Goal and evidence

Independent pre-actual review found that UID1000 calls statfs on the Root-private dataRoot through infra0700Root. Linux denies that traversal before routing or context consumption. PR172 final CI38711480464/main CI38713181703 both passed but their synthetic tests missed this permission boundary. Their original captures and claims remain immutable; source delivery cannot authorize an actual attempt until this defect is repaired.

## Scope and acceptance

Change only the client's headroom targets to the accessible owned lease root and output directory. Preserve Root-private infra0700, UID/capability isolation, the8GiB threshold, all closed input/receipt/routing checks, build/save/observation behavior and authority limits. The existing Root daemon checks native parent headroom; the later thin Root caller must also check the actual dataRoot before launching UID1000. These are headroom checks, not disk quotas.

Six owned paths: this new plan; scripts/postgres-image/gosu-derivative-image-observation-v2.mjs; tests/postgres-gosu-derivative-image-observation-v2.test.mjs; append-only docs/validation/TASK-0005A-gosu-image-build-observation.md, docs/decisions/ADR-0015-gosu-compiler-derivative.md and roadmap/DELIVERY.md. Protect the remaining986 baseline files, the three existing documentation prefixes, daemon/helper, classification, A/B0, contracts/recipes/locks, dependencies, workflows and incoming product work. No new dependency, schema, public user flow or UI.

## Verification and delivery

Author a behavioral VM regression before the one-line source repair: old source must fail; repaired source must check root/output, never inspect the inaccessible dataRoot, and reach routing. Low native headroom must reject before any runner/context read. Use the real non-fully-injected preflight branch with explicit FORMAT_ONLY mocks, retaining all existing hostile cases. Run pinned Node22.23.2 Windows/Linux targeted suites, lint/typecheck/test/build/secrets/audit, nonzero Turbo tasks, independent source review and exact file/prefix closure.

One focused branch/PR. Its body records this plan before code implementation. Fresh exact-head CI, reviewed identical-tree merge, protected-main CI and independent source delivery are required. This corrective source increment has one new final/main CI capture pair after independent actor review; none of the prior original runs may be queried again or retried. A source pass still authorizes no image admission. The B1a actual operation budget remains unused; no private context/archive, original preparation ZIP, Docker build, Go/Gosu execution, registry, Native, support or currentEvidence change occurs in this increment.

## Operational implications and rollback

The correction removes an impossible unprivileged pathname lookup without widening access. Errors and low-space refusal remain closed and observable. Rollback reverts the focused source/test change and new documentation additions; it must leave actual B1a blocked rather than relax permissions or retry a consumed attempt. TASK0005A/0005 remain IN_PROGRESS, derivative support dates null and authority NOT_AUTHORIZED. Independent review must confirm the boundary and regression coverage before delivery.
