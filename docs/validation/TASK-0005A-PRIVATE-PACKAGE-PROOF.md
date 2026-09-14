# TASK-0005A — First private package proof

Status: PREPARATION. No registry write has been performed by this increment.

## Concrete first-write plan

The user confirmed ordinary GitHub sign-in on 2026-09-14. The authenticated `CleMeY15` Packages page showed the initial "Get started with GitHub Packages" screen and no existing packages. This is a namespace preflight, not a visibility or access-grant proof for a package that does not yet exist.

The authenticated repository Actions Settings page showed default token permissions limited to repository contents/packages read, approval required for all external contributors, and Actions-created/approved PRs disabled. Main protection requires the `quality` check on an up-to-date branch and applies to administrators. No settings were changed. The existing CI, scanner diagnostic and local preparation workflows explicitly grant `contents: read` only; this new manual proof is the only reviewed workflow requesting package access. These settings do not prove fork isolation or prohibit another same-repository branch from requesting package permissions.

Use the existing `CleMeY15/auto-world` repository and fixed package `ghcr.io/clemey15/auto-world-infra-proof`. Publish only the already-tested scratch image containing `proof.txt` with `auto-world-private-package-boundary-v1` followed by LF (39 bytes total), and the source label. Its exact payload SHA-256 is `d5e5e59eda3174b385ac04154621244178be55d1a7f69f6cc6f6dd1fda43355d`; Dockerfile SHA-256 is `26482c5b8cf345a38591136e89f097b2932e98c1ff2065ff8ea8f023f56f4117`. No application source, listing, business data, personal data or credentials belong in this image.

The first-write workflow is manual, main-only and has no dispatch inputs. Protected-main source and current source SHA must agree before writing. Its producer has `contents: read` and `packages: write`; a separate verifier has `contents: read` and `packages: read`. Both use the ephemeral repository `GITHUB_TOKEN`, not a new account, local PAT, expanded credential or paid service. There is no OIDC or attestation capability. The fixed source label associates the package with the existing repository. First-publication privacy follows GHCR's documented private default, then requires actual inspection; it is not assumed proven.

1. Obtain actual Architect then distinct Critic approval of the exact committed workflow, script, public payload and this package/credential/retention plan before any registry write. Ordinary CI tests do not execute the publisher.
2. Merge only after applicable quality, fresh-checkout and independent-review gates pass. Record the exact protected-main merge and dispatch the workflow once, with no inputs. A retry after a partial write requires inspection of the existing outcome; never erase it or declare the failed run successful.
3. Build the fixed scratch payload with no build networking and publish tag `proof-<run-id>`. Capture `containerimage.digest` from Buildx metadata. This tag is diagnostic bookkeeping; every verifier consumes the fixed repository plus immutable manifest digest. The image is unadmitted and must never be started.
4. On a separate read-only job, retrieve that exact digest with authorized credentials, require anonymous denial from a fresh empty Docker configuration, and repeat the authorized positive control. Generic network errors do not establish access denial. Inspect image metadata and verify the exact file bytes copied from a stopped container without running it.
5. Inspect the new package's authenticated Settings UI: private visibility, source repository linkage, inherited permissions and Manage Actions access. Record actual observations. If unexpected, stop before any service/helper candidate write; do not claim that receipt fields or repository linkage alone establish these settings.

The user-waived external authenticated fork/PR probe remains `SKIPPED_BY_USER`; fork isolation remains `NOT_VERIFIED`. Same-repository branches may have technical package-writing capability. These limitations are explicitly accepted only for already-public software and non-sensitive technical evidence under [ADR-0007](../decisions/ADR-0007-private-image-admission.md). No second account or separate publisher is introduced.

## Credentials, retention and cleanup

Each job uses a fresh owned Docker configuration under the runner temporary directory. The token is supplied through process stdin for login, never command arguments or public logs. Subprocess diagnostics are bounded and sanitized. Temporary credentials and owned local Docker objects are cleaned up; no other package, tag, container, image or volume is removed. Jobs have ten-minute timeouts and bounded command/output sizes.

Only bounded public JSON receipts are uploaded for 14 days, with local copies retained under ignored `.omx/validation/`. Image layers and private evidence archives are not Actions artifacts. The harmless proof package remains private with no automatic deletion; it is not a supported runtime image, so its existence creates no service support or admission claim. Supported-image retention, private secondary-copy restoration and support dates remain separate activation gates before any runtime admission.

Rollback disables or reverts this workflow. Preserve an already-written proof and its failure/success evidence; do not delete packages or data to roll back code. A privacy mismatch blocks further writes pending a concrete correction. The retired ADR-0006 fixed-file attestation canary remains retired and its exhausted budget is not reused.

## Acceptance evidence

Implementation, sequential reviews, exact-head/main quality, actual publication/read controls and post-write Settings observations are pending. Record each separately; `PUBLISHED_UNADMITTED` is never runtime admission. TASK-0005A and TASK-0005 remain incomplete until all later ADR-0007 and four-service lifecycle gates pass; TASK-0006 remains blocked.

## Official references

- [GHCR publishing, private default and source linkage](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Package permissions and Actions access settings](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Buildx metadata file and registry digest](https://docs.docker.com/reference/cli/docker/buildx/build/#metadata-file)
