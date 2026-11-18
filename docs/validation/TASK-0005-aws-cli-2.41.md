# TASK-0005/A — AWS CLI 2.41.0 diagnostic qualification

The 2.38.5 AWS CLI image accounts for 49 HIGH occurrences in 16 RPM packages and 21 CVEs on the accepted PR251 main. The complete five-image audit failed with 159 occurrences, including one CRITICAL in PostgreSQL. [Original run](https://github.com/CleMeY15/auto-world/actions/runs/44267312226)

PR252 accepted the PostgreSQL/Gosu M3 preparation documents on main `9bbf4d23ea4f62d66de3afeab4bdf87a1652a774` (tree `c15f53d57bac40450d1a5985e33f6b1374acb7e0`). Its twelve changed files are documentation. The raw comparator and managed recipe operate on the AWS diagnostic. The parent owns M3 instrumentation and the next merge is coordinated with that lane.

## Release and comparison evidence

On Linux/amd64 the official versioned 2.41.0 tag resolves to the image manifest `sha256:eb3b4742dbfd983bcb79e2df22fbcfde9ad5b3f8277ff1d4050bd7f9cdd9c090`. The [registry evidence](aws-cli-20261118/resolution.json) binds the observation time, registry, versioned tag, index and platform. The expected AWS source tag peels to `7e6f97cb7b149863b5133857b2095bca3f3cab47`. Source-to-image provenance remains unestablished.

A static read of all five verified layers found 177 RPM names, including every one of the 176 previously reported raw names. All sixteen affected packages meet the Amazon Linux advisory versions. The [49 occurrence records](aws-cli-20261118/aws49.json) retain historical ordinals, original scanner layers, fix thresholds, actual candidate RPM headers and advisory links. The layer supplying the RPM database can differ from the layer supplying individual package files. The old report also observed one Python package. Complete image scans and SBOMs on the selected subjects determine actual vulnerability coverage.

The accepted [implementation plan](../../roadmap/plans/TASK-0005-aws-cli-2.41.md) has SHA256 `53c1cb82c96f69a3986c6baf7f74cd1f715528d307135785853c1d9e3b605892`. The Architect requested changes to v1 because the raw gate could exit before persisting comparator evidence. The Architect then approved v2, followed by an independent Critic approval on identical bytes. The owner, implementers and both reviewers used Codex gpt-6.2-astra / ultra. Isolated implementation worktrees share the accepted PR252 base. Initial free space was 336 GiB with 27 GiB available memory.

The managed recipe records which DNF transaction actually ran. A successful no-op must retain package inventories and prior history, while a new transaction must account for the installed changes. The synthetic runtime uses the new version with the existing explicit S3 endpoint and signed/unsigned request controls. Each qualification run retains its own scanner, database, report, SBOM, runtime and cleanup identities.

## Validation and delivery

The DNF implementation passed 78 targeted tests in its isolated checkout using a temporary lock overlay. The integrated release, DNF and historical OpenSearch tests passed 13/13 with the repository lock. Final frozen-source quality, full raw/managed CI, independent reviews and main validation are separate gates. The PR records actual revisions and results as they become available. The first local integration command required a retry with the checkout-local Git committer identity supplied to the command.

Rollback reverts this AWS diagnostic increment, preserving original evidence and existing service data. TASK-0005/A remain IN_PROGRESS. The static package comparison supplies no additional accepted blocker reduction or admission.
