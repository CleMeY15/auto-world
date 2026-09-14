# TASK-0005A — First private package proof

Status: REMOTE_READ_CONTROL_IMPLEMENTATION. The first-write and read-only outcomes are recorded below and in [PR18](https://github.com/CleMeY15/auto-world/pull/18) and [PR19](https://github.com/CleMeY15/auto-world/pull/19); the focused correction PR records its own dated verification evidence. No runtime image is admitted.

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

Record implementation, sequential reviews, exact-head/main quality, actual publication/read controls and post-write Settings observations separately in PR18. Required evidence is not inferred from this plan; `PUBLISHED_UNADMITTED` is never runtime admission. TASK-0005A and TASK-0005 remain incomplete until all later ADR-0007 and four-service lifecycle gates pass; TASK-0006 remains blocked.

## Actual first write and visibility correction

The exact first-write implementation received actual Architect then distinct Critic approval at `ce32b274e5cee0e53a84757ba5ef0cc05c833451`. Its fresh HTTPS checkout and quality gates passed. Protected merge `c302e812c31cdd2f8441054c8a88d3d7a5d0bec4` preserved all six reviewed blobs; merged-main [quality 34865447853](https://github.com/CleMeY15/auto-world/actions/runs/34865447853) and [local preparation 34865448082](https://github.com/CleMeY15/auto-world/actions/runs/34865448082) passed.

The single [first-write run 34865612395](https://github.com/CleMeY15/auto-world/actions/runs/34865612395), attempt 1, published the fixed scratch payload at `ghcr.io/clemey15/auto-world-infra-proof@sha256:eac8525e2bae0875846d4ee9f6fe75908b2ac4724e49b56653e4aa3fe8bd61b6`. The publisher recorded eight passing phases and `PUBLISHED_UNADMITTED`. Its receipt is 1982 bytes, SHA-256 `e320e477166c492be0eb542dc37b28b4559935c6d151bf75fd319bfe72f8a5cc`.

The overall run FAILED: the separate verifier successfully pulled that exact digest anonymously and reported `package_registry_anonymous_pull_succeeded`. Its receipt is 2428 bytes, SHA-256 `9608674ae4290f31c9478e5a470a2c7e19525b23fd03beb0aed8b25920ece857`. Authenticated package and Settings pages both explicitly showed PUBLIC. The cause of this first-publication visibility is not established; this actual result supersedes assumptions based on the documented default. The only exposed file was the reviewed 39-byte public technical payload. The failed run and package object are retained.

The authenticated Settings dialog offered Private. Changing that setting on the existing object resulted in "This package is currently private." The package was not deleted, rebuilt or republished. Source linkage is `CleMeY15/auto-world`, inherited access remains checked, and Manage Actions access lists only `auto-world` with Admin role. There are no listed Codespaces repositories or explicit members. Only visibility changed. This does not undo earlier retrieval or establish fork isolation.

## Bounded read-only continuation

Retire the publisher job from the manual workflow after its one write. The remaining workflow has one `verify` job, `contents: read` and `packages: read`, no inputs, and the exact fixed manifest digest above. Reuse the reviewed verifier, pinned actions, ten-minute budget, attempt-one restriction, owned temporary credentials/objects, exact receipt-only upload and failure enforcement. It does not build, publish, sign or start the image.

After review and protected-main quality, one fresh manual read-only run must prove authorized retrieval, anonymous denial, a second authorized positive and the exact file bytes copied from a stopped container. Its receipt's `sourceSha` identifies the verifier checkout; the image's build source remains `c302e812c31cdd2f8441054c8a88d3d7a5d0bec4` and original publication run `34865612395`. A later success does not change that first run's failure. Record actual continuation evidence in the focused PR; this plan alone does not establish a passed control.

The observed privacy mismatch blocks candidate/service publication until corrected package settings and actual read controls pass. The user-waived fork probe remains `SKIPPED_BY_USER`, fork isolation `NOT_VERIFIED`. No local token expansion, new account, publisher, registry, archive claim or runtime admission is introduced.

## Read-only result and remote-control diagnosis

The verifier-only change was accepted in [PR19](https://github.com/CleMeY15/auto-world/pull/19) after actual Architect and distinct Critic approval at `6adf5fb704d0deb6d58d97ba349b00cc0560a71c`, ten targeted tests, a full uncached fresh-checkout check (77 root tests), and head quality. Protected merge `1ae9a6693c572e7c8824bcfe20dc1c5a68e4198e` preserved the reviewed workflow, tests, documentation and unchanged verifier; [main quality 34867058650](https://github.com/CleMeY15/auto-world/actions/runs/34867058650) passed.

The one [read-only run 34867275879](https://github.com/CleMeY15/auto-world/actions/runs/34867275879), attempt 1, still FAILED with `package_registry_anonymous_pull_succeeded`. Its 2429-byte receipt has SHA-256 `899a6483bb880d8d36ba23107c048f90cd755887c797daa569cf9eb937e764ee`. No image was published. Reloaded authenticated Settings continued to show Private with the same repository linkage, inheritance and sole Actions grant.

A separate anonymous HTTP diagnostic returned 401 for the exact registry manifest URL. Following its `WWW-Authenticate` challenge to `https://ghcr.io/token`, with the exact service and repository pull scope but no credentials, returned 401/UNAUTHORIZED with no token. A same-daemon `docker pull` after an authenticated pull is therefore not sufficient evidence of remote anonymous access merely because its client configuration is empty. The first two failed receipts establish command outcomes; they must not be interpreted as proving a remote anonymous fetch. The first package's PUBLIC Settings observation remains independent evidence.

The cause is established in the exact managed Docker source. Moby's [manifest store](https://github.com/moby/moby/blob/6430e49a55babd9b8f4d08e70ecb2b68900770fe/distribution/manifest.go#L100-L153) returns a cached manifest without checking the remote registry when its repository source label matches. The [pull path](https://github.com/moby/moby/blob/6430e49a55babd9b8f4d08e70ecb2b68900770fe/distribution/pull_v2.go#L369-L377) uses that store. An empty client configuration does not isolate this daemon cache, and deleting an image reference alone would not prove complete cache eviction.

The correction uses three separate `docker buildx imagetools inspect --raw <repository@digest>` processes with authenticated, empty and authenticated Docker configurations, before the daemon pull. Buildx's [resolver](https://github.com/docker/buildx/blob/ac30b249211430b85fb8f37b6e7154b5c47ba0b6/util/imagetools/inspect.go#L57-L124) queries the registry instead of the daemon image store. Its [raw printer](https://github.com/docker/buildx/blob/ac30b249211430b85fb8f37b6e7154b5c47ba0b6/util/imagetools/printers.go#L35-L68) emits exact bytes without an added newline; each positive response must hash to the fixed expected manifest digest. Authentication comes from each process's [Docker configuration](https://github.com/docker/buildx/blob/ac30b249211430b85fb8f37b6e7154b5c47ba0b6/store/storeutil/storeutil.go#L112-L116). Only after this remote sequence does one authenticated Docker pull support the existing image inspection and stopped-container byte comparison.

Keep all permissions read-only, preserve owned cleanup and failure classification, and add regression coverage for a cached local pull returning success while the remote registry denies anonymous access. Actual corrected native evidence must be recorded before accepting the private-read proof or proceeding to candidate publication. No signing, new package, credential or waived fork test is introduced.

## Official references

- [GHCR publishing, private default and source linkage](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Package permissions and Actions access settings](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Buildx metadata file and registry digest](https://docs.docker.com/reference/cli/docker/buildx/build/#metadata-file)
