# PostgreSQL declared component and source inventory

Status: IMPLEMENTATION_IN_PROGRESS, 2026-10-01. This leaf remains a historical diagnostic. TASK-0005A/0005 stay IN_PROGRESS and TASK-0006 stays blocked.

## Problem and implementation plan

The accepted image, restoration and recipe proofs do not yet identify every declared component's source and notice availability. Add one inventory from the independently pinned historical JSON and CycloneDX reports, preserving individual package declarations and distinguishing available materials from missing sources.

Factor the two existing package-validation blocks into private helpers. Keep the current audit evaluator's order, currentness checks and finding semantics unchanged. A separate pure inventory export checks structural cross-report parity; independent full-file SHA256 pins in the native collector authenticate the historical records. A coherently changed report pair may retain structural parity but must fail native byte authentication. No historical clock or freshness bypass is introduced.

The inventory describes fifty packages (forty-six APK and four Go), fifty-two SBOM components, thirty-five named APK source origins and one unresolved virtual package. Preserve raw license representations, absence, empty arrays, order and id/name distinctions without inventing legal obligations. PostgreSQL17.11 is separately referenced from the accepted SQL proof and is not inferred from the virtual package. That reference is not reread during collection.

Authenticate the two reports and five retained public materials through bounded full reads, EOF checks and held descriptor/path/native seals. Exclusively publish one inventory.json in a new UID/GID1000,0700 ext4 directory, with a0600 single-link manifest. The reviewed /home/autoworld parent remains0750. Use the fixed clean source checkout, Node22.23.2 and actual UID/GID1000 with empty supplementary groups, zero capabilities and NNP. The no-argument entry point grants no path, transport or execution override.

Close all descriptors before writing a matching bounded ACK. The ACK writer runs inside the collection failure boundary so a late output failure can retire only the still-proven owned manifest; foreign replacements, unstable parents and original evidence remain untouched. A manifest alone never establishes acceptance: complete matching ACK, process exit0, stdout EOF and empty stderr are required.

## Verification and acceptance

Require tests for report parity, raw declaration preservation, hostile schemas, modified byte pins, native path/link/identity guards, bounded publication and late output failure. Preserve the original current audit diagnostic order and verify that historical inventory does not grant runtime currentness. Run lint, typecheck, tests, build, secret checks and dependency audit; require independent implementation review and exact-head CI before the sole fixed native collection. Then independently review original bytes, native identity, closed schemas, privacy and prior-proof preservation before acceptance and merge.

The fixed policy pins the historical subject, report sizes/SHA256, five materials, limits and separately authenticated PostgreSQL reference. Source and notice closure remain NOT_ESTABLISHED; legal compliance and currentness remain NOT_EVALUATED; runtime permission remains NOT_GRANTED; admission is NOT_AUTHORIZED. Support/retention dates remain null. No network, candidate execution, Docker, SQL rerun, registry write, signing or activation occurs in this collector.

Observability is limited to closed phase/error codes, hashes, sizes and native metadata. Never publish raw reports, environment, credentials or SQL evidence. Rollback disables/reverts this additive diagnostic and preserves all successful and failed private evidence. There is no data migration or user-facing change.

## Delivery prerequisites

PR125 merged at8aa0b60aed653dc8e5f3b45407923f7d226f40ee with reviewed tree7b1179805c16c5222cb095356895dc8b90790031. Exact final-head CI36788341339 and merged-main CI36788693215 pass. Its retained recipe bundle remains independently accepted and unchanged. Native declared-source collection is not yet run.
