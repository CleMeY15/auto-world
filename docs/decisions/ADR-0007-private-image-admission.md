# ADR-0007 — Private image admission with managed GitHub tooling

Status: Accepted for managed tooling; external fork access test waived by the user; activation gates remain pending.
Date: 2026-09-14
Scope: local development and CI data infrastructure, TASK-0005.

## Context and authority

The data foundation in draft PR7 passed real service integration but its container audit failed. PR10 corrects report identity binding; it does not resolve vulnerabilities. PR8's unmerged ADR5 prepared source-built ORAS, Cosign and Trivy while requiring absolute server-side publication isolation. It did not reach native-tool admission. Its private/unprotected repository assumptions are obsolete: the repository is now public and main protection is enabled.

On 2026-09-14 the user requested autonomous roadmap development and, after an explanation of private Docker images, public technical attestation metadata and strict consumer admission instead of absolute branch-scoped registry write isolation, delegated the choice: "Fait ce qu’il te semble le mieux". Adopt that model. This authorizes implementation of this bounded design, not vulnerability waivers, production deployment, new paid services/accounts or an expanded local token.

On 2026-09-14, in direct response to the request for a second GitHub account to test private-package access from a fork, the user instructed: "Zap le test d’accès". This supersedes the external authenticated fork/PR denied-read test requirement below. Record that test as `SKIPPED_BY_USER` and fork read isolation as `NOT_VERIFIED`; never as a successful test or a proven privacy boundary. Do not request another account or introduce a separate publisher solely to satisfy the waived proof. Actual package visibility, anonymous denial, authorized retrieval, vulnerability, integrity, review and admission controls remain applicable. This decision does not authorize new repositories, credentials, paid services or the disclosure of sensitive data.

The completed [ADR-0006 canary](ADR-0006-public-attestation-canary.md) establishes only its recorded fixed-file verification behavior. Its two-run budget is exhausted and its producer retired. It is never image admission evidence and must not be restarted. The recurring roadmap heartbeat remains paused; current development is resumed by the user's instruction.

## Decision and alternatives

Use the existing GitHub repository and managed Linux Actions runners, Docker/BuildKit, official `actions/attest` and official `gh attestation verify`. Record actual runner/tool identities and pin action commits. These components are an explicit managed trust boundary, not independently reproduced Auto World binaries. Do not carry forward PR8's ORAS/Cosign source-build prerequisites or custom signing/registry implementation. A corrected, reviewed and actually tested scanner remains required.

This explicitly supersedes the corresponding proposals in unmerged ADR5/PR8. Preserve that branch and its evidence; no mass merge or historical success claim. Accepted source/data/security contracts and vulnerability thresholds remain unchanged.

Waiting for clean upstream images remains preferable when real fresh audits pass; test them first. Continuing the full native bootstrap would add maintenance without providing GHCR branch-level write isolation. A separate publisher or immutable archive service would need another authority/cost decision and is not selected.

## Integrity, privacy and capabilities

Registry presence is not admission. Same-repository branches may technically obtain package-writing rights; this design does not claim a server-enforced prohibition. Consumers accept only an exact reviewed admitted digest and complete valid evidence, regardless of who can store another object.

There are four separate stages:

1. Scanner preparation and diagnostic audits: `contents: read` only; no private inputs, package write, OIDC or signing capability. Candidate tools can run only in this disposable diagnostic context and cannot approve themselves for later privileged use.
2. Private candidate storage: only after a separate review of the concrete publication workflow and package controls. The reviewed main build job may write unadmitted candidates to private GHCR with `packages: write`, without OIDC/attestation authority. This permits private storage before the final audits; it never permits signing, admission or general use before they pass.
3. Independent audit and runtime jobs: package read only, no registry write or signing. Bind complete results to the exact candidate digest, source/recipe and run. Never execute a failed image outside the isolated diagnostic/runtime test scope.
4. A separate signer: accepts only the exact subject whose required gates pass, runs no candidate code and grants no admission by itself. A reviewed main inventory then records admission. The signing job must not accept arbitrary branch/run/digest parameters as trusted expectations.

Private image layers and private evidence archives must never be uploaded as Actions artifacts in this public repository. Public artifacts may contain only explicitly approved technical scanner/diagnostic material. No business data, listing payloads, credentials or user data belong in image preparation or public evidence.

GHCR's documented first-publication default is private. Before candidate layers are written, the separate activation plan must establish a non-sensitive first-write/package-creation sequence, actual visibility/configuration checks and anonymous pull denial. Use only the existing namespace and deterministic package names. Authorized read-only Actions pull must succeed; anonymous retrieval must fail. These checks do not prove the waived fork-isolation boundary. No local token expansion is assumed: current local authentication lacks `read:packages`.

Observed correction on 2026-09-14: the first harmless package actually appeared PUBLIC in authenticated Settings and was then changed to Private without deletion or republication; see the [first-write evidence](../validation/TASK-0005A-PRIVATE-PACKAGE-PROOF.md). A documented default is not a privacy guarantee or permission to publish candidate layers into an uninspected package. Any later package-creation plan must use only non-sensitive bootstrap content until actual configuration and remote read controls pass. A cached local Docker image must not be mistaken for a successful remote anonymous fetch.

GitHub warns that granting a public repository access to a private package may expose it to forks. Private visibility alone does not establish fork isolation. Inventory package inheritance, repository linkage, Actions grants and every reviewed workflow/job with package-read access. Such reviewed jobs must not execute PR/fork-controlled code or inputs, including indirect checkout, artifacts and reusable workflow inputs. By the user's instruction above, do not run or require the external authenticated fork/PR denied-read probe. Its absence alone no longer blocks implementation or requires a new publisher identity. Document the unverified boundary; do not claim that static workflow checks prevent all possible fork-token access.

This waived boundary applies only to the current infrastructure preparation using already-public upstream software and non-sensitive technical evidence. Candidate contents must be reviewed before publication and contain no credentials, private application source, listing payloads, business or user data. Introducing sensitive content requires a new privacy decision; the skipped probe cannot authorize its disclosure. Candidate image layers and private evidence archives still use private storage and must not be uploaded as public Actions artifacts; explicitly approved non-sensitive technical diagnostics remain permitted as stated above.

The concrete Architect then Critic gate must examine the remaining permission controls, non-sensitive content restriction and explicit unverified fork boundary before the harmless first write. Require the applicable visibility/configuration, anonymous and authorized-read proofs before candidate writes or admission. Do not restore the waived external test or its second-account requirement indirectly as an activation gate. Continue with the existing repository selected by this ADR; a separate publisher, credential or service is not authorized by the waiver.

Before the first registry write, actual Architect then distinct Critic must approve the exact workflow and package/credential/retention plan. Plan approval for scanner preparation cannot satisfy this gate. No publication workflow or permission is introduced by this ADR-only increment.

## Scanner and vulnerability gates

Pin source commit, compiler, patches, module checksums, build recipe and actual binary hash. Review the exact upstream-derived dependency fix rather than taking mutable main. Preserve upstream test assertions, run relevant upstream suites and record coverage gaps. Require full package inventory/SBOM, scanner self-audit, known-vulnerable detection controls, and a comparison using the same captured databases against the old scanner as a diagnostic only. Unexpected detection loss or missing inventory blocks acceptance.

Record complete reports and vulnerability/Java database byte identities. Both database timestamps must be valid, ordered and non-future; the vulnerability database must be updated within 48 hours of each scan. Per the 2026-09-24 user decision, Java database age is recorded but has no maximum-age rejection. A scan using an older Java database cannot claim current Java-vulnerability coverage. Historical scans remain historical. An unaudited scanner may generate diagnostic evidence in the isolated lane; it cannot be treated as an admitted tool or be its sole independent approval.

All CRITICAL findings and all HIGH findings with fixes block. An unfixed HIGH needs a finding-specific independent review/disposition expiring within 30 days; none is pre-approved. End-of-life OS, missing reports, wrong repository/digest or missing tool inventory block. Audit every executed runtime/helper image; removing a role from a list cannot hide its use.

The exact `repository@manifestDigest` or `repository@platformDigest` binding from PR10 is required. A digest suffix, tag, unrelated green CI job or substituted report cannot establish a passed image.

## Admission and consumption

Use official verification of the exact OCI subject, repository, certificate workflow/ref, source digest, signer digest, predicate and GitHub-hosted runner. Check all verified statements/subjects. Where CLI policy flags are mutually exclusive, verify both policies separately on the same immutable bundle; do not implement cryptography or rewrite signed contents. Preserve `VERIFIED`, `REJECTED` and `ERROR` distinctions with actual positive controls.

The admitted inventory on reviewed main binds image digest, reviewed build commit and workflow, run, source/recipe, SBOM/audit/runtime evidence and attestation bundle. The inventory merge can be later than the image build: the expected source SHA is the explicitly reviewed build SHA, not an assumption that current HEAD built it. Authentic reviewed policy and revocation/currentness must be established outside candidate-controlled JSON or CLI claims.

Every documented local and CI image execution entrypoint must check authenticated inventory, complete retained evidence, current vulnerability/admission state and exact downloaded digest before running a service/helper. Missing, expired, revoked or substituted evidence fails closed. There is no tag fallback or skip-verification option. Diagnostic execution is explicitly separate from supported startup.

Actual image proof must cover successful private read and official verification, anonymous denial, wrong subject/workflow/source/ref expectations, changed bytes and missing/truncated verifier output. Use paired positive controls and the actual image bundle. No additional branch attestations or rerun of the retired fixed-file canary is required to test wrong expectations.

## Retention, observability and rollback

Retain the complete private image/evidence/source/notices/SBOM/bundle closure for supported lifetime plus 365 days, with explicit support dates and no automatic deletion. GHCR/API objects are deletable; public Sigstore immutability proves cryptographic history, not private availability. Finite Actions artifacts are not the supported-runtime archive.

Before activation, establish a second verified private copy in existing ignored local storage and demonstrate complete retrieval/restore. No new storage service is assumed. Missing access, archive capacity or restoration proof blocks activation. Track a digest-addressed inventory and archive health; loss of required evidence prevents further use until restored. Administrator deletion, workstation loss and provider outage remain disclosed availability risks; this is an operational retention commitment, not immutable storage.

Use fixed phase/result/reason/duration and public hashes/run IDs in diagnostics; never raw credentials or unfiltered private subprocess output. Retain non-secret full scan reports separately from status summaries. Resource limits and owned-path cleanup remain mandatory for builds, scans and restore tests.

Rollback reverts admission to another fully valid supported digest or stops affected services. Never fall back to a revoked/vulnerable digest and never delete data volumes, backups or source history to undo tooling. Preserve PR7's ownership and foreign-volume restore safeguards.

## Delivery and acceptance

The supporting [TASK-0005A](../../roadmap/tasks/TASK-0005A-managed-image-tooling.md) first delivers the corrected scanner and real current audit evidence without publication rights. A later focused private-image workflow/activation increment requires the additional concrete review above. Only then integrate the admitted images and verifier into PR7's data lifecycle, incorporating PR10's report correction.

TASK-0005 remains incomplete until real readiness, migrations, transactions/outbox/raw integrity, restart persistence, isolated reset and backup/restore pass for all four services on exact admitted images. Required root checks, fresh clone, independent implementation review, final-head CI and exact merged-main CI remain mandatory. TASK-0006 waits for TASK-0005; no source rights or production topology is introduced here.

## Official references

- [GHCR publication and private default](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pushing-container-images)
- [Actions package access](https://docs.github.com/en/enterprise-cloud@latest/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility#ensuring-workflow-access-to-your-package)
- [Official attestation action](https://github.com/actions/attest) and [official verification CLI](https://cli.github.com/manual/gh_attestation_verify)
- [Public attestation metadata](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [Attestation deletion](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/secure-your-work/use-artifact-attestations/manage-attestations) and [finite Actions artifact retention](https://docs.github.com/en/actions/tutorials/store-and-share-data#configuring-a-custom-artifact-retention-period)
