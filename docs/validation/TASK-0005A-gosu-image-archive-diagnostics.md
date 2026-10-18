# TASK-0005A â€” archive diagnostic source validation

Status: IMPLEMENTATION_VALIDATED; independent final code and architecture reviews and all six local gates pass. Final-head and merged-main source delivery are pending. Source delivery and actual evidence are separate gates. TASK-0005A/0005 remain IN_PROGRESS.

## Established problem and scope

The immutable B1a generation2 index is 99065 bytes/SHA256 e766db482ed0b94e5a1c0003031f9c60953ca045112aaf5d0fd73c49cbc5ed34. Two independent reviews accept failure metadata only. UID failed with `gosu_derivative_image_observation_archive_invalid / OBSERVE / MAY_HAVE_BEEN_BUILT`; operation, recording and subjects are null. Root later failed inventory and stop checks. Cleanup remains uncertain, and image format, original profiles, functionality, vulnerabilities and admission are unestablished.

A new stat-only current-state capture, 13739 bytes/SHA256 2515efb5e1444a4f53fdc1451148c46a07fb9750f07b391e1b0c070e4cad9779, completed normally in3.563s. Its raw JSON equals the indexed report; all17 observed paths are stable, findings are empty, and Root-index/native-claim physical identities match the captured tuples. Base/candidate final files are300058112/302052864 bytes; partials, observation files, PID and socket paths are absent. No native body was read or hashed. Filesystem absence does not prove processGone or historical cleanup.

The [approved source plan](../../roadmap/plans/TASK-0005A-gosu-image-archive-diagnostics.md) adds one opt-in finite detail getter. It does not recover a historical branch, loosen an archive predicate, change a successful result or authorize another operation. [ADR-0015](../decisions/ADR-0015-gosu-compiler-derivative.md) records compatibility and rollback.

## Delivery gates

Meaningful missing-API and compatibility/expansion RED records, synthetic/hostile GREEN coverage, unchanged accepted and OPAQUE behavior, targeted strict lint and syntax, complete repository gates and independent code/architecture reviews are retained below. The final committed closure must preserve 1000 protected files and four append-only prefixes. Final-head CI, identical reviewed merge tree and successful merged-main CI are mandatory before claiming source delivery.

No UI, dependency, migration, schema consumer or operational caller change is included. Rollback reverts the opt-in source increment; previous consumed claims and failed evidence remain untouched. Support dates remain null and currentEvidence is unchanged.

## Targeted source regressions

Pinned Node22.23.2 retains three meaningful RED records: the absent opt-in export; four old-code propagation regressions (51 tests/47 pass/4 fail); and the real native expansion sentinel (52/51/1). Earlier source revisions passed their general checks but were rejected by independent review; their source/test snapshots and proofs remain retained and are excluded from delivery acceptance.

Final targeted source62191/SHA2566a1de0e3f71e3e1626afa5564a3a98faff8e47b79b389adfce2b0342dc694b70 and test77920/7c33b67a69e7f9443574732b0d71a32e58234608cdd13ab872c5ddb092b6f262 pass53 VM cases and14 standard wrappers. Windows syntax and strict ESLint pass. The final Linux target also passes14/14 with empty stderr; index1899/0035a08bf692cac26f102309127f59a2c43b2a97dffc4f551c91dec8ac738856 binds unchanged pre/post source hashes. All inputs are synthetic and no Docker, private archive, context or provider operation is part of these tests.

Legacy code recognition and new reason selection are distinct. The former preserves the old guarded code flow for ordinary, inherited and accessor values; the latter uses only native Error own data. Both real expansion-control signals now retain the old archive-invalid code and receive LAYER/EXPANSION_LIMIT, while forged/plain known codes remain unbranded. The old public diagnostic still has exactly three fields; accepted and OPAQUE results remain unchanged.

## Final independent reviews and complete local gates

Independent code review APPROVE and architecture review CLEAR apply to the exact final source/test above. Review proof2827/SHA2562e08283da633956ec00ebbbad59a7e4188831a4df4d12d86e64d178faec63dd1 records no remaining findings. The pinned independent code run passes53/53; a supplemental architecture run on Node24 is explicitly excluded from pinned delivery evidence. Both review findings were repaired before these final verdicts: legacy known-code propagation and real native expansion-control branding. Rejected revisions and their earlier green checks remain retained, not accepted.

Fresh final complete local gates on Node22.23.2/pnpm10.15.0 pass lint, typecheck, tests, build, secret scan and dependency audit. Turbo executes14/21/28/14 tasks respectively; Windows root reports2002 tests,1559 passes,443 explicit platform exclusions and zero failures, cancellations or todos. Secretlint scans1008 files and the dependency audit reports no known vulnerabilities. Gate index6182/SHA256755f4bf3e38b6d94f4ed2638e5c71469f9a269f67a74738f9b46f5d11f508634 binds all six retained logs, unchanged source/test,1000 protected files and four original document prefixes. Subsequent edits only record these results in the three owned status documents; final diff, link and secret checks follow before commit.

The PR must still pass final-head CI, preserve the reviewed source tree through the protected merge, and pass merged-main CI. Because the pull-request workflow uses the default checkout, its tested merge-ref tree must equal the reviewed source tree. These are source delivery conditions only. No image format, functional/CVE, cleanup, admission, activation or support-date claim is added.
