# PostgreSQL declared component and source inventory

Status: ACCEPTED_LOCAL_DECLARED_INVENTORY, 2026-10-01. The sole fixed native collection succeeds and distinct original/default plus scoped privacy/preservation reviews APPROVE. Final-head/main CI and matching reviewed merge tree pass. TASK-0005A/0005 stay IN_PROGRESS and TASK-0006 stays blocked.

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

PR125 merged at8aa0b60aed653dc8e5f3b45407923f7d226f40ee with reviewed tree7b1179805c16c5222cb095356895dc8b90790031. Exact final-head CI36788341339 and merged-main CI36788693215 pass. Its retained recipe bundle remains independently accepted and unchanged.

## Implementation checkpoint

WindowsNode22 targeted tests pass27/28 with one honest native-actor skip. They preserve the original finding-before-CycloneDX diagnostic priority, check hostile inventory shapes and license representations, and exercise actual child stdout finish/EOF. Existing Linux dependency/config scoped lint passes for all seven new/changed script/test files. These checks do not establish native collector acceptance.

A separate read-only pure check authenticates both complete original report sizes/SHA256, EOF and unchanged native identities before parsing. Its metadata-only result is PARITY_VERIFIED with50packages,46APK,4Go,52components,35origins,one virtual package and the unversioned gosu root. All descriptors close. The509-byte ignored summary SHA9d7ef124ade0eeb940bdf79ef47df9b41225df5eab5546735265c3628f1f1d49 records historical report parity only.

The fixed entry point is `scripts/postgres-image/local-source-inventory-diagnostic.mjs`, with no arguments or environment override. The collector bounds its post-close result callback by remaining operation time, abort signal and ten seconds. Independent final implementation and fixed-launcher reviews APPROVE before the collection below.

## Actual single native collection

The sole fixed launcher12a7f894fe640701ae87e71efc1379aabc28101ead55e42874577ed1c275ed20 and preflightc9ea1ccb0254be8f5828073ce9ecf953884e949ea85b1bf2c7de5eb4ac1091ec run on clean recipe776e69d5754afcc416b4699d57b85a0f4b14ae13. Default safe source inspection confirms that exact HEAD and no dirty files. Actual Node22.23.2/UID1000, empty kernel supplementary groups, zero capabilities, NNP and the closed five-field environment precede the no-argument default collector. The root launcher observes process exit0, physical stdout EOF and empty stderr.

ExecutionId is local-source-inventory-36620ba4da3788f68364ed41. Directory is `/home/autoworld/pg-declared-source-inventory-0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93-36620ba4da3788f68364ed41`.

| Original proof | Exact bytes and identity |
| --- | --- |
| Root ACK `/home/autoworld/pr126-real-source-inventory-776e69d.log` | 682 bytes/SHA5b431d8dd19505afb215cee364be7a7396160b0d1c2e39091ee45adafb2332f6;0:0/0600/single-link,dev2096/ino112627 |
| inventory.json | 47,581 bytes/SHAb59bc9b11247e420dbec46000e411ac033bd07d07cae36a6ae3bde01139bbdc1;1000:1000/0600/single-link,dev2096/ino112761 |

The private ext4 directory is0700 and contains exactly that single file. The manifest and paired ACK are closed default schemas. Neither the manifest alone nor structural report parity alone establishes acceptance.

Distinct original review APPROVE holds and authenticates the root ACK and empty-stderr originals before/after an actual1000 child. The child reopens the original manifest and all seven original sources with full independent size/SHA256/EOF/native9 checks and disjoint identities. Default manifest validation and full pure report projection match exactly; six recorded phases pass. Default Git2.43 source inspection remains clean776e69d before/after. All child/root descriptors close, and child exit0/EOF/zero stderr pass. The root-private journal `/home/autoworld/pr126-independent-source-review-qA7ZMy/result.log` is5,695 bytes/SHA1bd2f600d2a0acad4d720ada4b901b53a2aebf5dcd26f33a5d350e5c0309c21b,0:0/0600/single-link, with empty error.log. No collector, old async bundle, runtime/currentness evaluator, Docker or SQL operation is repeated.

The separately reviewed privacy helperad20d5d4f752a81fccf8c029bf1dc4d85a2aea3983246770f1afeeb0e4d6eabe checks the default closed manifest, full ACK hash/size/native-identity pair, secret signatures, exact private inventory and empty stderr. Complete original hashes and native stability during each read preserve PR123 receipt/bundle, PR124 receipt/ACK and PR125 receipt/bundle/ACK. Its404-byte root-private journal SHAb348932468e62cfcd4a8371cb0c56c87f6dd73f243787b26e6611ee3f219b403 has a distinct scoped journal/native review APPROVE. Historical flags claim unchanged bytes, without claiming an old inode, old bundle replay against this new HEAD, or another full image/Windows/Docker replay.

## Fresh gates and remaining scope

On exact776e69d, actual nonroot `TURBO_FORCE=true pnpm run check` passes: lint9/typecheck11/package tests18/build9 with zero cache hits; repository-level tests1,744/1,754 pass with ten honest actor skips; Secretlint594 files and dependency audit0 known vulnerabilities pass. Its517,635-byte log SHA9a23567a11687773e09c4916376a57ccd7da24c02f73cc6cd9e7cf9435e7e239 is retained. Supplemental root serial contracts pass125/126 with one direct1000 actor skip covered by a real root-to1000 bootstrap; its27,118-byte log SHAc19cf47473157ca1d72cd6dd92632423c0a6c9f66e47dcf05830a7f13ac8e174 is retained. Separate direct actual1000 inventory fixtures pass17/17 with zero skips;4,498-byte log SHA9fe14428e78d11bfb394c09983b3c634c6aed88a76f77c6f39d0028b5888905a. These harmless helpers remain partial evidence distinct from the actual default collection. Exact implementation CI36793766362 passes.

The earlier PR124 parallel supplemental failure remains unestablished and preserved; these serial gates do not relabel its cause. Unsupported actual Git remains a strict refusal and CI's incompatible native helper is not represented as a positive replay.

This acceptance establishes declared inventory and availability of five retained materials only. Seven missing markers, unverified lower-layer coverage, uncollected complete sources/notices, unattempted signing and null support/retention dates remain explicit. Historical integrity grants no runtime, legal-compliance or admission permission.

## Delivery checkpoint

Independent review of the final validation/task documents and PR body APPROVE; scoped secret checks pass. Final head ece8d68ddb8b8c6cc6ad5f413df24b77aa461a97 passes CI36796381344. PR126 merged4275c4f22fd95fc7390e6a3a130485c242d147e5 with unchanged reviewed tree5f77a8faa6b05f68aec0a1fd215305164f62dad2; merged-main CI36796608692 passes. The next bounded source-retention leaf does not rewrite or rerun this accepted private inventory.
