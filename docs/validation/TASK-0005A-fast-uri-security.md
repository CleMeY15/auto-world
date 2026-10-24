# TASK-0005A — fast-uri security prerequisite

Status: SOURCE_IMPLEMENTATION_REVIEWED / LOCAL_GATES_PASSED / DELIVERY_PENDING. TASK-0005A and TASK-0005 remain IN_PROGRESS. No image admission, Native execution, activation or support date follows from this source increment.

## Problem and plan

PR193 source `25638edee146bab815a2f48bd315cadb274a3188` passed all functional quality steps in [CI40040103783](https://github.com/CleMeY15/auto-world/actions/runs/40040103783), including 375 browser tests with seven existing exclusions. Its final dependency audit failed with eight occurrences across four advisories, affecting both existing fast-uri versions 3.1.8 and 4.2.2. The original failure remains preserved.

Update only the two transitive patch resolutions to 3.1.9 and 4.2.3. Existing AJV, Fastify compiler and stringifier dependency ranges permit these versions. The lock mutation is exactly nine lines: two package keys, two integrity values, two empty snapshots and three resolved edges. No manifest, parent package, override, new dependency or workflow changes.

Independent dependency review, Architect review and a distinct Critic review approved the plan before implementation. The patches intentionally tighten malformed URI handling, so a zero-result audit alone is insufficient validation.

## Verification contract

The retained compatibility probe loads each URI version through its actual installed parent context. It checks the four advisory cases and legitimate URI controls, AJV relative schema references and encoded fragments, and installed Fastify validation/serialization. This is synthetic dependency compatibility evidence. The seven existing API test files separately exercise actual product behavior; current product routes use custom contract parsers without Fastify route schemas.

Frozen online and offline installations passed with Node 22.23.2/Corepack pnpm 10.15.0 and unchanged lockfile. Their retained records are transcript-derived summaries, not original stdout captures. Installation enforces the exact registry-published tarball integrity values; no independent npm signature, attestation or publisher-provenance verification is claimed. An initial summary contained a case-only hash transcription error; the appended correction and independently checked current lock identify SHA256 `6c77deb44e33302ff4daf2cd3a80ef7971caa107556464af6584d29435aa3d5f`.

The original probe V1 observed 12 cases: four passing controls and eight security failures on the old dependencies. Its first patched run passed ten cases but failed two suffix-reparse assertions because the probe itself supplied an option that injects scheme `x`. V1 also substituted a suffix-resolution input from the approved vector. Both outcomes remain transcript-derived summaries with missing raw stdout explicitly disclosed; they are not relabeled as successful runs.

After separate dependency, Architect and distinct Critic review, a new immutable V2 corrected default reparsing and restored the exact approved encoded-input resolution vector. Its single patched-only execution passed 12/12 with empty stderr, actual parent resolution paths and stable source/Node/lock pins. V2 source SHA256 is `573c19a56cc26678478b8f3dc9eb6b5e294e83859f24d7bf830d31975cab999a`; authentic stdout SHA256 is `7fbae3a69cf51ef2786b0ca74e204d39f01f642c0fe61c17fc7d16c9c6b425e5`. No old dependency reinstall or baseline replay occurred. The V1/V2 evidence is not an identical-script RED/GREEN pair.

Independent implementation review approves the exact nine-line lock mutation and these evidence boundaries. A complete sequential local matrix passed lint, typecheck, repository tests, build, Secretlint and the dependency audit with stable subjects. Root tests: 2018 total, 1573 passed, 445 existing Windows/platform exclusions, zero failures. All 28 workspace tasks passed, including 50/50 actual API tests across seven files; Secretlint passed 1061 files and the audit reported no known vulnerabilities. Matrix SHA256 is `ad05e5896c1ddce1d92fffddeccda966ea93e442b6e3c35d4c40822bf643e50f`.

That matrix used the unchanged lock/manifest and initial planning document; this factual documentation update follows it. The final document review and secret scan are separate checks. Earlier focused API/audit attempts reached a stale temporary shim and Node 24; their environment failures remain disclosed, and fixed-PATH runs used Node 22.23.2. The complete matrix uses the fixed toolchain with authenticated Node bytes and original per-gate logs.

Browser validation is deferred to this PR's exact-head Linux CI. The final source head and protected merged main must each pass the complete CI, with identical reviewed/merged trees and independent delivery verification. This is a pre-delivery snapshot; its final PR checkpoint governs acceptance. Passing local checks alone does not establish delivery.

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
