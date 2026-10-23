# TASK-0005A — fast-uri security prerequisite

Status: PLAN_REVIEWED / IMPLEMENTATION_PENDING. TASK-0005A and TASK-0005 remain IN_PROGRESS. No image admission, Native execution, activation or support date follows from this source increment.

## Problem and plan

PR193 source `25638edee146bab815a2f48bd315cadb274a3188` passed all functional quality steps in [CI40040103783](https://github.com/CleMeY15/auto-world/actions/runs/40040103783), including 375 browser tests with seven existing exclusions. Its final dependency audit failed with eight occurrences across four advisories, affecting both existing fast-uri versions 3.1.8 and 4.2.2. The original failure remains preserved.

Update only the two transitive patch resolutions to 3.1.9 and 4.2.3. Existing AJV, Fastify compiler and stringifier dependency ranges permit these versions. The lock mutation is exactly nine lines: two package keys, two integrity values, two empty snapshots and three resolved edges. No manifest, parent package, override, new dependency or workflow changes.

Independent dependency review, Architect review and a distinct Critic review approved the plan before implementation. The patches intentionally tighten malformed URI handling, so a zero-result audit alone is insufficient validation.

## Verification contract

An ignored, retained compatibility probe will load each URI version through its actual installed parent context. It will verify the four advisory cases and legitimate URI controls, AJV relative schema references and encoded fragments, and installed Fastify validation/serialization. This is synthetic dependency compatibility evidence. The seven existing API test files separately exercise actual product behavior; current product routes use custom contract parsers without Fastify route schemas.

Frozen online installation must verify downloaded bytes against the exact registry-published integrity values; a subsequent frozen offline installation must preserve that lock and reuse the verified store. No independent npm signature, attestation or publisher-provenance verification is claimed.

Lint, typecheck, repository tests, build, Secretlint and a fresh audit must pass. The final exact source head and protected merged main must each pass the complete CI, including the unchanged browser suite. Independent implementation/delivery reviews and identical reviewed/merged trees remain required. This initial planning snapshot claims none of those later results.

## Operations and rollback

The source-only patch changes stricter URI parsing/normalization in existing dependencies. It does not touch an installed image recipe, archive, actor, daemon or historical evidence. Rollback reverts the focused source change and reintroduces known advisory exposure, which must be reassessed before use. The consumed Native attempts remain immutable and are not retried or inspected.

## Official references

- [Encoded scheme advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)
- [Host confusion advisory](https://github.com/advisories/GHSA-wjr9-j795-jxcr)
- [Relative path advisory](https://github.com/advisories/GHSA-xhq7-xmqj-769h)
- [Suffix scheme advisory](https://github.com/advisories/GHSA-333x-w4r6-6crp)
- [fast-uri 3.1.9](https://github.com/fastify/fast-uri/releases/tag/v3.1.9)
- [fast-uri 4.2.3](https://github.com/fastify/fast-uri/releases/tag/v4.2.3)
- [pnpm 10 frozen installation](https://pnpm.io/10.x/cli/install)
