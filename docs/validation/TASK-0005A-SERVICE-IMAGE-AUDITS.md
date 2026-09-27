# TASK-0005A — current service image audits

Status: DIAGNOSTIC_ONLY, NOT_ADMITTED. Complete failing reports are evidence, not a startup authorization.

## Original inventory, 27 September 2026

[Manual run 36341060453](https://github.com/CleMeY15/auto-world/actions/runs/36341060453), number 26 attempt 1, executed on reviewed main `5a15e9d81d0b51124c64b9cb118351e863764d4a`. Both independent scanner builds succeeded. Reproducibility, baseline preparation, database freeze, self-audit, version probe and fixture controls passed. All eight image commands completed with complete reports. Image eligibility failed; the workflow remained failed after retaining the reports.

The [original receipt](service-image-audits/36341060453/audit-receipt.json) is 176,153 bytes, SHA-256 `395527097c249b308307f3277b35060d8e1a3440bb3be317ad9e7bffb24c0e72`. The [bounded origin record](service-image-audits/36341060453/origin.json) binds artifact `10939575606`, 7,091,472 bytes, SHA-256 `5149cbacdc719e1282bf7d818ff3323fb80c283a35a5d87f5bccf89a2bd9e774`. The complete original ZIP and all 24 JSON reports are retained locally. Git preserves the exact native bytes of the receipt, database evidence and four before/after registry manifests. The origin record and [byte identity index](service-image-audits/36341060453/extracted-json-identities.json) are locally generated records; the public index uses LF formatting with the same 24 identities as the private helper output. Neither derived record is a native signed receipt. A regression checks the six original files against fixed sizes/hashes, their index entries and before/after manifest equality.

An independent read-only replay verified the live GitHub run/artifact identities, all 24 ZIP/extracted JSON byte comparisons, all eight report hashes/sizes, and the original scanner lock. The unchanged report evaluator reproduced all 347 blockers exactly. These are occurrences, not unique CVE counts.

| Original role | HIGH occurrences | CRITICAL occurrences | Other blockers | Total blockers |
| --- | ---: | ---: | ---: | ---: |
| PostgreSQL 17.11 | 107 | 14 | 0 | 121 |
| OpenSearch 3.8.0 | 82 | 6 | 0 | 88 |
| Redis 8.10.1 | 55 | 3 | 0 | 58 |
| Public SeaweedFS 4.47 | 1 | 0 | 2 | 3 |
| AWS CLI 2.36.44 | 29 | 0 | 0 | 29 |
| Baseline Trivy 0.74.0 | 9 | 0 | 0 | 9 |
| PostgreSQL 17.11 Alpine | 30 | 1 | 0 | 31 |
| Redis 8.10.1 Alpine | 8 | 0 | 0 | 8 |

The 347 blockers comprise 240 vulnerability occurrences with a listed fix, 104 unfixed HIGH occurrences needing finding-specific independent dispositions, one unfixed CRITICAL occurrence that remains a hard blocker, and two missing public SeaweedFS executable inventories (`weed-volume`, `weed-worker`). No disposition is introduced. The public SeaweedFS subject is not the private source-built and attested image.

The vulnerability database was updated at `2026-09-27T13:06:25.102527619Z`, downloaded at `2026-09-27T18:47:07.682330961Z`, and passed the 48-hour limit. Java was updated at `2026-09-27T01:08:08.997214067Z`; its valid timestamp/identity were recorded without a maximum-age rejection. Registry manifests were unchanged before/after download. The archive records DB payload hashes and sizes, but does not contain the 1.4/1.5 GB payloads themselves; a local payload rehash is therefore not claimed. The build/self-audit phases are supported by original receipts and successful native jobs, not by a new local rebuild from this ZIP.

## Refreshed service candidates

[PR96](https://github.com/CleMeY15/auto-world/pull/96) merged five independently reviewed public service pins as `97e5b7e46aff369f62a19baf9cf206dc43531473`; reviewed head `d325b00120b141af1622ed2d9c888c279a126d01` has the identical tree `721e2efd6215d8fe9ba126599f09e36b7a47bf9a`. Fresh Linux full checks passed 787 tests with zero failures/skips, both independent reviews approved, and [head CI](https://github.com/CleMeY15/auto-world/actions/runs/36341643107) / [main CI](https://github.com/CleMeY15/auto-world/actions/runs/36341829349) passed.

[Manual run 36342206206](https://github.com/CleMeY15/auto-world/actions/runs/36342206206), number 27 attempt 1, now audits that exact main and lock `3c27ad6cecfe30395aa2f7f32de51b638c4684fb2e921a32a4779424b06f95ba`. Its result is pending at this checkpoint. It cannot be inferred from the original-inventory result above or from registry publication metadata.

## AWS CLI corrective candidate

The fresh original-inventory audit found 29 fixable HIGH occurrences in the previously clean AWS CLI image: 11 Expat CVEs and nine OpenSSL CVEs affecting each of two packages. The reported fixes are `expat 2.8.3-1.amzn2023.0.1` and `openssl-libs` / `openssl-fips-provider-latest 1:3.5.8-1.amzn2023.0.1`. They are published in [Amazon Linux 2023 release 2023.12.20260914](https://docs.aws.amazon.com/linux/al2023/release-notes/relnotes-2023.12.20260914.html), with [Expat](https://alas.aws.amazon.com/AL2023/ALAS2023-2026-2157.html) and [OpenSSL](https://alas.aws.amazon.com/AL2023/ALAS2023-2026-2136.html) advisories.

The smallest identified official candidate is AWS CLI `2.36.46`, whose registry configuration references that corrected Amazon Linux base and a package update. Its predecessor `2.36.45` still references the earlier base. Sources: [official image](https://hub.docker.com/v2/repositories/amazon/aws-cli/tags/2.36.46), [upstream changelog](https://raw.githubusercontent.com/aws/aws-cli/2.36.46/CHANGELOG.rst). This evidence selects a candidate; it does not prove the package inventory or a clean scan.

The focused correction updates only the AWS CLI diagnostic pin and retains the [official index/platform/config bytes and provenance](aws-cli-refresh/manifest-provenance.json). The index is `sha256:eedfdcb56e9a1b02fabcf656977ca226f40860c6672aca41d435e036bc95a075`; the unique Linux/amd64 manifest is `sha256:696ad2e7f8aac020bbbeaa511713cc844131ce593b275fdb101285ab02f6cbca`, and its configuration is `sha256:c68f011a88049fd3e173164e6651edcc8cacd7c2f98c5295d9e534dc1278139e`. Raw bytes, descriptor sizes and platform/config identities were checked before changing the pin. Preserve the five reviewed service candidates, scanner/compiler/patches/fixtures, baseline Trivy and both historical SeaweedFS subjects. The baseline Trivy findings remain recorded against its unchanged diagnostic comparison image. No new runtime helper, dependency, workflow trigger or vulnerability exception is added.

Before a further native audit: verify raw manifest/config bindings, run targeted and full fresh-Linux checks, obtain independent code/architecture review and pass exact-head/main CI. Finish the preceding manual run before dispatching another on main, because the existing concurrency setting cancels an earlier run. Every real outcome and complete report set must be retained. Runtime AWS CLI behavior and four-service lifecycle acceptance remain separate prerequisites before activation.

## Retention and rollback

Public technical receipts do not contain private image layers, application data or credentials. Full diagnostic ZIPs and reports are retained in the existing local archive; the finite Actions artifact is not the only copy. Their database payload and workstation-loss limitations are explicit above and in ADR-0007.

Rollback restores prior diagnostic pins without deleting reports, packages, archives or data. It never converts an older vulnerable image into an admitted fallback. No support date starts here; TASK-0005A/TASK-0005 remain IN_PROGRESS and TASK-0006 remains blocked.
