# TASK-0005 — current diagnostic OS inputs, 16 November 2026

Status: `PLAN_REVIEW_PENDING`. Owner: infrastructure/security.
The user resumed completion of TASK-0005; this bounded correction addresses
actual current diagnostic failures before PR241 delivery. No support activation,
publisher dispatch, installed-service migration or production use follows.

## Observed failures and choice

[Managed run43915611761](https://github.com/CleMeY15/auto-world/actions/runs/43915611761)
on83585cdd produces19 fixable HIGH occurrences in PostgreSQL's inherited
krb5-libs/libxslt and34 in AWS CLI's glibc/RPM/sqlite packages. The original
artifact14253410729 is4081162bytes, SHA256
`ef8b8f8ae79623cc5a16a5946739d86b841bb98f6a23f5426bf6fe1d2ae542f2`.
Independent inspection reproduced the policy rejections; do not relax them.
OpenSearch separately fails Git ADD with HTTP403 before compilation. Its source
commit is valid; the HTTP cause is unknown and no acquisition change is inferred.

The current official17.11-alpine3.24 tag has a different digest but still declares
the rejected package versions in its registry-bound SBOM. It is not selected.
The official17.12-alpine3.24 publication supplies krb5-libs1.22.3-r0 and
libxslt1.1.43-r4 in its bound SBOM. This stays within PostgreSQL17 and uses the
[official17.12 security/fix release](https://www.postgresql.org/docs/17/release-17-12.html).
Metadata makes it a candidate; only a fresh actual audit can establish eligibility.
Use this upstream publication instead of maintaining an additional APK derivative.

## Exact candidate inputs

PostgreSQL17.12-alpine3.24:

- Registry index: `sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7`.
- Linux/amd64 manifest: `sha256:005c5c37db96c1e6652a79ea31f9886402fba81ac95dc2db897739121dd7f8f2`.
- Configuration: `sha256:6b75136145ddabf3d9a4b69660402082de7c56b734cfe50555b0674774dd742a`.
- PostgreSQL source tag REL_17_12: `702b3dc86d35bcc08c8e23cffa3c4d9fe9d32c85`.
- Official image recipe commit: `76a70e36d51517f2ab061a9bb60b1980a6902e29`.
- Registry-bound SBOM: `sha256:c169a652c10b75cd12dea3a8f11dbbab9f77edbc8a0be1782934af48e267617a`.

Amazon Linux snapshot2023.12.20261112, shared by the existing AWS CLI and
OpenSearch OS-update stages:

- GUID: `707b7dfd96f868bd1650473d34d918a106283766d54260bc446abe9beefb6523`.
- repomd.xml SHA256: `ae00370d0a8a2e73ea7751cdf7417b07d72e6672674eb55a50f74d52ac9834fe`.
- Compressed primary metadata SHA256: `f958c01b5bd35f80c7d343a3e54969b1800b8b64d29c129084f307aeed0a23b2`.
- Fixed glibc family: `0:2.34-231.amzn2023.0.6`; RPM family:
  `0:4.16.1.3-29.amzn2023.0.10`; sqlite-libs: `0:3.40.0-1.amzn2023.0.9`.
- The coherent snapshot also advances curl/libcurl-minimal to
  `0:8.21.0-5.amzn2023.0.5` and OpenSSL libs/provider to
  `1:3.5.8-1.amzn2023.0.4`. Preserve exact checks for the other existing packages.

Original registry/config/SBOM, source-ref and repository metadata have been
retained privately with measured hashes. The [public provenance record](../../docs/validation/current-os-refresh-20261116/provenance.json)
binds13 rehashed official metadata responses and the selected package versions.
It excludes credentials, signed CDN URLs, local paths and unrelated evidence.

## Implementation boundary

Update only the active managed candidate chain: PostgreSQL entry in
infra/scanner/official-release.json, corresponding managed lock/base recipe;
the lock's Amazon snapshot and both existing RPM recipes; matching strict
official-audit validation and affected tests. Keep whole-installed-set DNF
upgrade, GPG verification, immutable repository binding, CLI byte preservation,
JDK preservation, Gosu source/compiler/functional tests, all scanner thresholds,
inventory requirements and all runtime phases.

Add exact post-upgrade assertions for the newly rejected glibc/RPM/sqlite
components where installed. Their presence comes from each actual original
inventory; do not install a new component only to satisfy an assertion.
Every existing package assertion must match the authenticated snapshot metadata.

Preserve the original scanner qualification/50-member archive, historical
scanner-lock and image receipts, admission generations and null support dates.
No new registry package, component, scanner version or builder is selected.
OpenSearch remains on the exact3.9.0 source commit and existing patches; do not
add credentials, fallback source, retry loop or suppress its transport failure.

## Verification and acceptance

1. Independently review this bounded plan and original candidate metadata.
2. Verify manifest/config/SBOM descriptor bindings and Amazon primary metadata
   checksums; check active selectors and wrong/missing/substituted pin refusals.
3. Run affected managed-image/scanner/retention and admission compatibility
   tests, lint/typecheck/build/secrets as applicable. A historical fixture must
   retain its historical identity; do not rewrite it to match current inputs.
4. Obtain independent implementation/security review and fresh full CI on the
   changed source. Retain actual raw reports/SBOMs, source/compiler test outputs,
   database identities and cleanup, including every failed attempt.
5. All five image audits and all four produced-image runtime cases must pass.
   OpenSearch must actually build and run its complete existing tests. If403
   recurs, preserve the evidence and investigate it separately; no skipped
   build or unchanged retry counts as success.
6. Only matching protected-main validation can authorize the next retention
   operation. This refresh by itself grants no image admission or support dates.

Rollback reverts the diagnostic selectors/recipes without touching active VPS
services, archives, package versions or data volumes. Older failed candidates
remain unadmitted; rollback does not make their known vulnerabilities eligible.
Use fresh disposable PostgreSQL data for this diagnostic. Any later replacement
of an installed17.11 runtime must separately apply the official17.12 upgrade
notes for existing indexes, incremental backups and extensions; do not attach
existing PGDATA or infer upgrade acceptance from these fresh-instance tests.
