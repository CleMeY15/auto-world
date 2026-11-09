# TASK-0005 M3B v9 — official scanner byte retention

Status: `BOUND_PLAN_REVIEW_PENDING / NOT_IMPLEMENTATION_APPROVED`  
Date: 2026-11-09  
PR237 candidate: source `52fecdb`, tree `684614`  
PR237 merged main: `ea2aba71f107c73c16abf03ecf64e35d56d4f0be`, tree `684614b0b48f96eddcb854f160798144129e8e81`; M3A measurement accepted on this exact protected main  
Accepted diagnostic M2 main: `eb720fc67f2e9ae1311497fb52824e168cf0020e`

This plan closes only the official Trivy 0.76.2 material-retention row. The retained object is one immutable inner `scanner-closure.tar`. Copy one is those bytes as a data file in a private GHCR `FROM scratch` envelope; copy two is the exact same bytes under the already authorized C: private archive. The OCI envelope is transport and its identities remain distinct from the inner tar. No Docker-save envelope is required.

This is not global closure or global restoreability. It excludes service images, vulnerability/Java database payloads, baseline carrier images, complete service/source/build closures, admission attestations, application data and the final seventeen-phase foundation. It proves local byte restoration only; it does not make the scanner qualification rerunnable offline. TASK-0005/TASK-0005A remain `IN_PROGRESS`; admission and support dates remain null.

The GHCR plus C: technical model is already selected by ADR-0007/ADR-0026. No additional user permission is required. PR237 protected-main acceptance is complete. Implementation waits for actual Architect approval followed by a distinct actual Critic approval of these same filled plan and pinned ZIP-profile bytes.

## Qualification source and exact binding

Use only the first accepted protected-main PR237 run of `.github/workflows/data-foundation-managed.yml` and artifact `data-foundation-managed-<runId>-<runAttempt>`. Do not use `data-foundation-audit.yml`: the source qualification intentionally rejected 179 upstream-image blockers and the fresh protected-main observation intentionally rejected 175 after a vulnerability-database-only delta. Both remain rejection evidence, not qualification authority, and the four absent observations are not classified here as fixed or false positives.

The qualification binding is exact. This plan and the companion ZIP profile must be reviewed together; the profile bytes and SHA-256 below are part of this plan's authority. `UNBOUND` values that remain in `PUBLISHER_FRESH` and `GENERATED_POSTCONDITION` rows are future output postconditions, not missing qualification inputs.

```json
{
  "schemaVersion": 2,
  "state": "BOUND_PLAN_REVIEW_PENDING",
  "repository": "CleMeY15/auto-world",
  "workflow": ".github/workflows/data-foundation-managed.yml",
  "runId": 42684309304,
  "runAttempt": 1,
  "jobId": 129386885975,
  "headSha": "ea2aba71f107c73c16abf03ecf64e35d56d4f0be",
  "headTree": "684614b0b48f96eddcb854f160798144129e8e81",
  "event": "push",
  "ref": "refs/heads/main",
  "artifact": {
    "id": 13706967607,
    "name": "data-foundation-managed-42684309304-1",
    "url": "https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/13706967607",
    "archiveDownloadUrl": "https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/13706967607/zip",
    "workflowRun": {
      "id": 42684309304,
      "headSha": "ea2aba71f107c73c16abf03ecf64e35d56d4f0be"
    },
    "sizeInBytes": 5119275,
    "digest": "sha256:063bcda8a6e60bbe9f419663d5c4a634f342506df66d325fe57582f4e5dc7551",
    "createdAt": "2026-11-09T20:18:18Z",
    "updatedAt": "2026-11-09T20:18:18Z",
    "expiresAt": "2026-11-23T20:18:16Z",
    "expired": false
  },
  "review": {
    "file": "managed/review/independent-actual-review.json",
    "bytes": 12137,
    "sha256": "dc1c0cfaa0b5db0d1b0eecd5c6bf582d94f542dda53ea1a8905ab5b9eda2bdf9",
    "verdict": "PASS_WITH_EXPLICIT_LIMITS",
    "runId": 42684309304,
    "jobId": 129386885975,
    "runAttempt": 1,
    "headSha": "ea2aba71f107c73c16abf03ecf64e35d56d4f0be",
    "headTree": "684614b0b48f96eddcb854f160798144129e8e81",
    "sourceCheckoutClean": true,
    "artifactId": 13706967607,
    "artifactBytes": 5119275,
    "artifactSha256": "063bcda8a6e60bbe9f419663d5c4a634f342506df66d325fe57582f4e5dc7551",
    "entryCount": 689,
    "expandedBytes": 49888165,
    "largestEntryBytes": 2408383
  },
  "mainAcceptance": {
    "bytes": 8301,
    "sha256": "57386dc20e12d49612e6bc42cdb8df7e9a3837ee1e4fe2529d50baa6ee9e8e6b",
    "inputsRehashed": 17
  },
  "apiEvidence": {
    "run": {
      "bytes": 12152,
      "sha256": "60ab4cfac3e4ae2a8ab18ad4b1f0f35ac4e033fbb6cc1315c6c6184a9f4fcc4e"
    },
    "jobs": {
      "bytes": 2972,
      "sha256": "5efce916a05fe23eee0170b1661225ff7f19dc118e94bc2e3587e7263b9a6237"
    },
    "artifacts": {
      "bytes": 736,
      "sha256": "80858a1a8780739f01f0c45bf3d89822388c1d1c27a5d1c61bd6c689d4f6149b"
    }
  },
  "zipProfile": {
    "file": "scanner-retention-qualification-zip-profile-v2.json",
    "bytes": 170198,
    "sha256": "f22ed73c4635aec579a550e1043d62feab0b57bd73a00ac343e696ec5b246513",
    "entries": 689,
    "expandedBytes": 49888165
  },
  "deterministicQualifiedProbe": {
    "bytes": 98,
    "sha256": "490c72b7ef93b9cc9484ac81728382ca546d327f8a31cb20165ddf1f77550695"
  },
  "selectedQualificationExpandedBytes": 1962104
}
```

The accepted artifact must have `event=push`, `ref=refs/heads/main`, `runAttempt=1`, `expired=false`, an expiry after intake, exact reviewed head/tree and a successful independently reviewed result.

## Binding classes

1. **Static design/qualification before exact-plan approval:** official scanner tuple, accepted qualification run/artifact/review, selected report mappings, package, 50 members, caps, tags, C: destination and schemas. All current qualification fields must be filled before Architect/Critic review.
2. **Actual implementation source before execution:** protected-main implementation commit/tree, exact workflow/source blob hashes, pinned actions and clean checkout. These values do not exist yet and are not needed to implement the harmless-first-write code, but execution is refused until bound.
3. **Bootstrap observations before candidate publication:** actual harmless digest, package ID/settings, Private visibility, repository link/inheritance/grants, anonymous denial and read-only proof. These are outcomes of the bootstrap tranche, not prerequisites for implementing it.
4. **Publisher/C: postconditions after actions:** candidate digest, OCI descriptors, inner tar identity, publisher artifact/receipt, commit-last sidecar/copy and local restore result. They cannot be invented in advance and are required only for M3B acceptance.

## Fixed scanner tuple

| Field | Exact value |
| --- | --- |
| version/repository | `0.76.2` / `aquasecurity/trivy` |
| source/ref/workflow | `3f6334d223b52188324af3b9923b4249cd206652` / `refs/tags/v0.76.2` / `aquasecurity/trivy/.github/workflows/reusable-release.yaml` |
| archive bytes/SHA-256 | `52714130` / `bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf` |
| binary bytes/SHA-256 | `176386208` / `6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3` |
| Go inventory bytes/SHA-256 | `37019` / `a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b` |
| metadata | Go `1.27.3`, main `v0.76.2`, Linux/amd64, CGO0, `vcs.modified=false` |

The policy distinguishes `candidateBuildGo="1.27.3"` from `qualificationPublisherReaderGo="1.24.13"`. The latter is confirmed by the fresh accepted managed-main artifact's bound runner-tools observation. Before inventory creation, the publisher requires the exact reader identity `go version go1.24.13 linux/amd64` with `GOTOOLCHAIN=local`; this is a managed inspection tool, not a claim that Trivy was compiled with1.24.13. A changed reader identity refuses publication until reviewed.

The publisher retrieves the public release archive and bundle itself, uses existing `gh attestation verify` for the exact positive and four existing changed-bytes/wrong-source/wrong-workflow/wrong-ref refusals, extracts only regular `trivy`, and reads it with `go version -m`. It never executes Trivy.

## Exact API and artifact intake

Reuse and narrowly parameterize the bounded patterns in `scripts/postgres-image/attestation-artifact-input.mjs`, `scripts/seaweed-image/download-artifact-zip.mjs` and the existing owned ZIP scanner. Do not add a downloader or archive parser.

Before download, query exact GitHub API endpoints for the fixed run, its jobs, Git commit/tree and artifact ID. Every request uses the fixed repository, `redirect: "error"`, bounded response bytes, fixed API version and closed child environment. Require all of:

- run repository `CleMeY15/auto-world`, workflow path `.github/workflows/data-foundation-managed.yml`, exact run ID/attempt1/head SHA, head tree from the exact Git commit API, event `push`, branch/ref `main`/`refs/heads/main`, completed success;
- the reviewed workflow contains job key `audit`; the jobs API returns exactly one matching job with the bound ID and exact human name `Audit builders, construct and audit managed subjects`; require completed success and the expected workflow step outcomes rather than treating the YAML key as the API name;
- artifact exact ID/name, `expired=false`, future `expires_at`, exact `size_in_bytes`, exact `digest` matching `sha256:<64 lowercase hex>`;
- exact artifact `url` and `archive_download_url` under `https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/<id>`;
- artifact `workflow_run.id` and `workflow_run.head_sha` equal the accepted run/head;
- no redirect, duplicate API object, alternate URL/repository/workflow/run/head/tree/attempt/event/ref/name/ID/digest or ambiguous expiry.

Download with `streamGitHubArtifactZip` into an exclusive owned file and require exact descriptor bytes and digest. ZIP intake caps are fixed at 64 MiB compressed, 64 MiB total expanded, 4 MiB per member and 4,096 entries. Reject duplicate/case-colliding paths, absolute/traversal/backslash/control paths, links, nonregular entries, unsupported flags, CRC/size mismatch, trailing ambiguity or any entry outside the exact complete safe ZIP profile bound at plan approval. Validate structure, CRC, sizes, caps and collisions for all entries, including unselected technical reports. Extract only the exact `sourceMappings` subset into the closure; the accepted artifact SHA-256 authenticates the whole ZIP. Unselected safe reports stay outside the closure and are not an intake failure. The exact observed ZIP, complete expanded ZIP and selected-expanded bytes are bound above. Capacity retains the larger conservative maxima as refusal caps and does not assume that selecting fewer members removes the complete intake allocation.

The shared ZIP reader needs one explicit additive profile, `githubArtifactZipProfiles.scannerRetention`. Its complete path/method/mode inventory comes only from the approved fixed `infra/scanner/retention.json` qualification policy, never a caller-provided allowlist. Before delivery it enforces 64MiB ZIP and aggregate expanded caps, 4MiB per member and4096 members; check the EOCD member bound before allocating or iterating the central inventory. All metadata, path collision, layout, CRC, stream identity and existing profile checks stay in force. At the shared metadata/profile boundary, the closed `scannerRetention` profile accepts only regular-file modes `100400` and `100600`; every pre-existing profile keeps its current exact mode rules and return shape. Each exact accepted member's compression method and regular-file mode are bound from the original qualification ZIP; do not assume one method/mode across the entire archive. Only the fixed11 qualification report paths get extracting sinks; the other authenticated members are verified into bounded discard sinks. Existing Seaweed/PostgreSQL profiles and public return shapes stay unchanged.

The existing downloader gains only an optional `env` data-property snapshot. When supplied, require an own-data-properties-only plain record with string values and bounded count/length, copy it before spawning, and pass that copy as the child's complete environment; reject accessors, symbols and invalid values before spawning. The M3B coordinator supplies its fixed closed whitelist and no ambient environment spread. Omission preserves existing callers. Test supplied-environment isolation and mutation resistance plus unchanged omission behavior; keep the same authenticated endpoint, size/digest checks, streaming, deadline, abort and child-close boundaries. No second downloader or ZIP parser is introduced.

The artifact expires after 14 days. `qualification-binding.json` records `createdAt`, `expiresAt`, `expired=false` and every selected source-to-closure mapping. Intake after expiry fails even if a local ZIP remains.

## Package, tags and C: location

```text
package: ghcr.io/clemey15/auto-world-scanner-closure
bootstrap tag: bootstrap-v1-run-<decimal GITHUB_RUN_ID>
candidate tag: closure-v0.76.2-sha256-<64 lowercase innerTarSha256>
private root: C:/Users/Administrator/Documents/ChatGPT/Auto-world/.omx/private-archive
scanner dir: C:/Users/Administrator/Documents/ChatGPT/Auto-world/.omx/private-archive/scanner
tar file: scanner-closure-v0.76.2-sha256-<64 lowercase hex>.tar
sidecar: scanner-closure-v0.76.2-sha256-<same hex>.sidecar.json
```

The candidate tag is descriptive; every read uses the resolved digest. Recheck owner, restrictive non-inherited ACLs, non-reparse ancestors and free capacity. The root is already selected in `scripts/postgres-image/private-copy-policy.mjs:15`; do not ask the user to choose storage again.

Read-only preparation at 2026-11-09 19:01 observed PostgreSQL package ID `15408021` and SeaweedFS package ID `15325704` as 200/Private/two versions; direct scanner target lookup returned 404. Empty list endpoints are opaque and do not prove absence. Recheck the direct target before first write.

## Exactly 50 regular tar members

The fixed NUL list contains exactly these literal paths. The producer first sorts the complete explicit list by bytewise ASCII path and writes that exact order to the NUL list; this list determines physical archive order. GNU tar's required `--sort=name` only reinforces ordering for directory traversal, and no directory is recursed.

```text
scanner-closure/upstream/trivy_0.76.2_Linux-64bit.tar.gz
scanner-closure/binary/trivy
scanner-closure/inventory/go-build-info.txt
scanner-closure/provenance/trivy.attestation.jsonl
scanner-closure/provenance/verification-workflow.json
scanner-closure/provenance/verification-identity.json
scanner-closure/provenance/verification-after-controls.json
scanner-closure/provenance/provenance-controls.tsv
scanner-closure/provenance/changed-bytes.stdout.txt
scanner-closure/provenance/changed-bytes.stderr.txt
scanner-closure/provenance/wrong-source.stdout.txt
scanner-closure/provenance/wrong-source.stderr.txt
scanner-closure/provenance/wrong-workflow.stdout.txt
scanner-closure/provenance/wrong-workflow.stderr.txt
scanner-closure/provenance/wrong-ref.stdout.txt
scanner-closure/provenance/wrong-ref.stderr.txt
scanner-closure/provenance/received-sha256.txt
scanner-closure/qualification/official-audit-receipt.json
scanner-closure/qualification/scanner-self.json
scanner-closure/qualification/scanner-self.cdx.json
scanner-closure/qualification/scanner-version-probe.go.mod
scanner-closure/qualification/scanner-version-probe.json
scanner-closure/qualification/scanner-version.txt
scanner-closure/qualification/runner-tools.txt
scanner-closure/qualification/fixture-gomod-vulnerable-official.json
scanner-closure/qualification/fixture-gomod-vulnerable-baseline.json
scanner-closure/qualification/fixture-java-war-vulnerable-official.json
scanner-closure/qualification/fixture-java-war-vulnerable-baseline.json
scanner-closure/qualification/fixture-java-jar-clean-candidate-official.json
scanner-closure/controls/manifest.json
scanner-closure/controls/gomod/go.mod
scanner-closure/controls/gomod/go.sum
scanner-closure/controls/gomod/submod/go.mod
scanner-closure/controls/gomod/submod/go.sum
scanner-closure/controls/gomod/submod2/go.mod
scanner-closure/controls/gomod/submod2/go.sum
scanner-closure/controls/java/jackson-core-2.18.11.jar
scanner-closure/controls/java/test.war
scanner-closure/source/official-release.json
scanner-closure/source/scanner-lock.json
scanner-closure/source/data-foundation-managed.yml
scanner-closure/source/official-audit.mjs
scanner-closure/source/official-build-info.mjs
scanner-closure/source/official-controls.mjs
scanner-closure/source/audit-policy.mjs
scanner-closure/source/controls.mjs
scanner-closure/source/audit.mjs
scanner-closure/source/qualification-binding.json
scanner-closure/source/publication-binding.json
scanner-closure/restore-manifest.json
```

### Closed origin table

The table below closes the origin class for all50 members. All `QUALIFICATION_ARTIFACT` rows are bound below; remaining `UNBOUND` values are publisher/generated postconditions only. Repository blobs are read from exact protected-main commit `ea2aba71f107c73c16abf03ecf64e35d56d4f0be`, tree `684614b0b48f96eddcb854f160798144129e8e81`; publisher execution may not substitute files from its later implementation checkout. `PUBLISHER_FRESH` and `GENERATED_POSTCONDITION` identities are output postconditions and are not circular approval inputs. Ordinal is the required physical USTAR member order: bytewise ascending ASCII closure path.

| # | closurePath | sourceKind | sourcePath / producer | bytes | sha256 |
| ---: | --- | --- | --- | ---: | --- |
| 01 | `scanner-closure/binary/trivy` | `PUBLISHER_FRESH` | regular `trivy` extracted from row50 after release/attestation verification | `176386208` | `6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3` |
| 02 | `scanner-closure/controls/gomod/go.mod` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/gomod/go.mod` | `1069` | `7aa955bee64bed627284bdd91365c5f53f996467364a142802f20cd8e032549f` |
| 03 | `scanner-closure/controls/gomod/go.sum` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/gomod/go.sum` | `129439` | `2ca549d11f4fb30aea32e489e8d65596f20988dc15dbc19c085449a0f8931527` |
| 04 | `scanner-closure/controls/gomod/submod/go.mod` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/gomod/submod/go.mod` | `117` | `8179a58ea1404e5aece47303b75970ada1bb7c292fc45183ad3cc0474176e954` |
| 05 | `scanner-closure/controls/gomod/submod/go.sum` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/gomod/submod/go.sum` | `1048` | `40841aa4376c744fdbe69526232cd205ffd9bb3abdf243ea6c11d9836f9c4804` |
| 06 | `scanner-closure/controls/gomod/submod2/go.mod` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/gomod/submod2/go.mod` | `101` | `8689f776807a618b0f33a8d99b2dd9033cc7120f2f635b572951046f7aff3929` |
| 07 | `scanner-closure/controls/gomod/submod2/go.sum` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/gomod/submod2/go.sum` | `1404` | `708f2019e08317d697dd0075b855ef8e1c843b33acfe56c45f5d106667800b2f` |
| 08 | `scanner-closure/controls/java/jackson-core-2.18.11.jar` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/java/jackson-core-2.18.11.jar` | `588755` | `825fa72dfb9e2f8a642322f1390dbac22c30d15ebd6dc6b3772158821ee124eb` |
| 09 | `scanner-closure/controls/java/test.war` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/java/test.war` | `2525883` | `b852f605a56a1e109bdd17aaa8d85007c4327708bf6e3b4b56a9876b4a1077ba` |
| 10 | `scanner-closure/controls/manifest.json` | `QUALIFIED_REPO_BLOB` | `infra/scanner/materials/scanner-fixtures/manifest.json` | `7632` | `bf9f3296c0753b19f2b0c5631538338cd5457ea5d07ac72357428b71e8ae7591` |
| 11 | `scanner-closure/inventory/go-build-info.txt` | `PUBLISHER_FRESH` | fixed Go tool reads row01 at exact `/home/runner/work/_temp/trivy-provenance/bin/trivy`; it does not execute Trivy | `37019` | `a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b` |
| 12 | `scanner-closure/provenance/changed-bytes.stderr.txt` | `PUBLISHER_FRESH` | changed-bytes refusal stderr | `UNBOUND` | `UNBOUND` |
| 13 | `scanner-closure/provenance/changed-bytes.stdout.txt` | `PUBLISHER_FRESH` | changed-bytes refusal stdout | `UNBOUND` | `UNBOUND` |
| 14 | `scanner-closure/provenance/provenance-controls.tsv` | `PUBLISHER_FRESH` | canonical publisher provenance controls | `UNBOUND` | `UNBOUND` |
| 15 | `scanner-closure/provenance/received-sha256.txt` | `PUBLISHER_FRESH` | canonical received archive/bundle hashes | `UNBOUND` | `UNBOUND` |
| 16 | `scanner-closure/provenance/trivy.attestation.jsonl` | `PUBLISHER_FRESH` | fixed public release attestation bundle | `UNBOUND` | `UNBOUND` |
| 17 | `scanner-closure/provenance/verification-after-controls.json` | `PUBLISHER_FRESH` | positive verification after refusal controls | `UNBOUND` | `UNBOUND` |
| 18 | `scanner-closure/provenance/verification-identity.json` | `PUBLISHER_FRESH` | positive source-identity verification | `UNBOUND` | `UNBOUND` |
| 19 | `scanner-closure/provenance/verification-workflow.json` | `PUBLISHER_FRESH` | positive workflow/ref verification | `UNBOUND` | `UNBOUND` |
| 20 | `scanner-closure/provenance/wrong-ref.stderr.txt` | `PUBLISHER_FRESH` | wrong-ref refusal stderr | `UNBOUND` | `UNBOUND` |
| 21 | `scanner-closure/provenance/wrong-ref.stdout.txt` | `PUBLISHER_FRESH` | wrong-ref refusal stdout | `UNBOUND` | `UNBOUND` |
| 22 | `scanner-closure/provenance/wrong-source.stderr.txt` | `PUBLISHER_FRESH` | wrong-source refusal stderr | `UNBOUND` | `UNBOUND` |
| 23 | `scanner-closure/provenance/wrong-source.stdout.txt` | `PUBLISHER_FRESH` | wrong-source refusal stdout | `UNBOUND` | `UNBOUND` |
| 24 | `scanner-closure/provenance/wrong-workflow.stderr.txt` | `PUBLISHER_FRESH` | wrong-workflow refusal stderr | `UNBOUND` | `UNBOUND` |
| 25 | `scanner-closure/provenance/wrong-workflow.stdout.txt` | `PUBLISHER_FRESH` | wrong-workflow refusal stdout | `UNBOUND` | `UNBOUND` |
| 26 | `scanner-closure/qualification/fixture-gomod-vulnerable-baseline.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/fixture-gomod-vulnerable-baseline.json` | `466563` | `7f3089137fe4d496312c231c6971873b0e68ea367db159c435bac75061c3c0ac` |
| 27 | `scanner-closure/qualification/fixture-gomod-vulnerable-official.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/fixture-gomod-vulnerable-official.json` | `466555` | `259cf26bddecdd86b8d6a66e3901b4a7d7c27948480b87e449057c8920369dd3` |
| 28 | `scanner-closure/qualification/fixture-java-jar-clean-candidate-official.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/fixture-java-jar-clean-candidate-official.json` | `795` | `c20aa29b4c1acdb5c21c48fdb158f3d8ec8e62eee6a35ac5133aa836ad615c16` |
| 29 | `scanner-closure/qualification/fixture-java-war-vulnerable-baseline.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/fixture-java-war-vulnerable-baseline.json` | `139025` | `e61340883e6e6ec37d3d0d5f1d4df60fdf12f9b57f774287c8c512c2767c95a4` |
| 30 | `scanner-closure/qualification/fixture-java-war-vulnerable-official.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/fixture-java-war-vulnerable-official.json` | `139011` | `4f287b243ec3584ac394a29155749fb3d6ed21576f450a956f44f316e4e4ad2c` |
| 31 | `scanner-closure/qualification/official-audit-receipt.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/official-audit-receipt.json` | `321432` | `0ac2555cabf91d110b6ff2981ff09dc22f67000753dca01170e01cad9d272213` |
| 32 | `scanner-closure/qualification/runner-tools.txt` | `QUALIFICATION_ARTIFACT` | `trivy-provenance/public/runner-tools.txt` | `1306` | `501e44964318b932c631497d97ac244fa2bc5141608d12eabab19e388896ae69` |
| 33 | `scanner-closure/qualification/scanner-self.cdx.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/scanner-self.cdx.json` | `266021` | `869b519427ccef46fabb86b2cea298d1bb9ddf7833b901e0dbd42cb507071e99` |
| 34 | `scanner-closure/qualification/scanner-self.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/scanner-self.json` | `160194` | `d06c1d0320d8fa121854dff118500cfa5422f6721161b0687a64b5fbaa532594` |
| 35 | `scanner-closure/qualification/scanner-version-probe.go.mod` | `DETERMINISTIC_QUALIFIED_PROBE` | exact `versionProbeBytes({scanner:{upstreamVersion:"0.76.2"},compiler:{version:"1.27.3"}})` from qualified row40 `audit.mjs` | `98` | `490c72b7ef93b9cc9484ac81728382ca546d327f8a31cb20165ddf1f77550695` |
| 36 | `scanner-closure/qualification/scanner-version-probe.json` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/scanner-version-probe.json` | `1186` | `935e69bbfd2045a240414c68c7555d755120c96cebab4dff0538101eba2ae403` |
| 37 | `scanner-closure/qualification/scanner-version.txt` | `QUALIFICATION_ARTIFACT` | `data-foundation-audit/scanner-version.txt` | `16` | `13b9af18ad5820c1fcfef7cf01b67ea74239fe905c0571822df31e88c16aabc9` |
| 38 | `scanner-closure/restore-manifest.json` | `GENERATED_POSTCONDITION` | canonical manifest generated from the other49 authenticated identities | `UNBOUND` | `UNBOUND` |
| 39 | `scanner-closure/source/audit-policy.mjs` | `QUALIFIED_REPO_BLOB` | `scripts/scanner/audit-policy.mjs` | `9301` | `8ee56aeee8d31f3620987186e1876731ce21d3f4763980a0bdc758511248584f` |
| 40 | `scanner-closure/source/audit.mjs` | `QUALIFIED_REPO_BLOB` | `scripts/scanner/audit.mjs` | `30463` | `15dd55ac6799b21c91c7414074901dc286d51f0d4e8cb2f2e5aefc6a57a0a281` |
| 41 | `scanner-closure/source/controls.mjs` | `QUALIFIED_REPO_BLOB` | `scripts/scanner/controls.mjs` | `15332` | `ca28b19d57e21b3b778da2ff95fa31bf273f814616ce0b190533d1eeaaa82499` |
| 42 | `scanner-closure/source/data-foundation-managed.yml` | `QUALIFIED_REPO_BLOB` | `.github/workflows/data-foundation-managed.yml` | `10787` | `7ed179183c629aeaf681172b896c471e3e1c5229dbca4f0cf6fc2869aebe922d` |
| 43 | `scanner-closure/source/official-audit.mjs` | `QUALIFIED_REPO_BLOB` | `scripts/scanner/official-audit.mjs` | `113474` | `a029a79af6e5f11b17fd367088b7fe18a7d9a0262757b4bab3f407e151c5bdb0` |
| 44 | `scanner-closure/source/official-build-info.mjs` | `QUALIFIED_REPO_BLOB` | `scripts/scanner/official-build-info.mjs` | `4194` | `7bc2fc79bfefd96f1392237d73aab7c0a49c782a1b6b7a67d373f88fc2ef9868` |
| 45 | `scanner-closure/source/official-controls.mjs` | `QUALIFIED_REPO_BLOB` | `scripts/scanner/official-controls.mjs` | `15957` | `4fd93f3e193fc8d58ed0b4ffb4800ad166baa0a07f8f81520f9186846067f037` |
| 46 | `scanner-closure/source/official-release.json` | `QUALIFIED_REPO_BLOB` | `infra/scanner/official-release.json` | `3476` | `3ee8d645bd28e21b40d5f2a62bb0db65ded3fe9752ce10527b2a3cb5c5c04776` |
| 47 | `scanner-closure/source/publication-binding.json` | `GENERATED_POSTCONDITION` | canonical publisher source/run binding | `UNBOUND` | `UNBOUND` |
| 48 | `scanner-closure/source/qualification-binding.json` | `GENERATED_POSTCONDITION` | canonical accepted-artifact binding and selected mappings | `UNBOUND` | `UNBOUND` |
| 49 | `scanner-closure/source/scanner-lock.json` | `QUALIFIED_REPO_BLOB` | `infra/scanner/scanner-lock.json` | `7208` | `a01bc85432f1a8c70ba3a0fe0642d1e5b4542df5e781c3786652c8ef8153b84a` |
| 50 | `scanner-closure/upstream/trivy_0.76.2_Linux-64bit.tar.gz` | `PUBLISHER_FRESH` | fixed release asset `aquasecurity/trivy@v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz` after exact attestation verification | `52714130` | `bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf` |

The row35 bytes are exactly:

```text
module auto.world/scanner-version-probe

go 1.27.3

require github.com/aquasecurity/trivy v0.76.2
```

with a final LF. Row11 is reproducible only when the publisher requires `RUNNER_TEMP=/home/runner/work/_temp`, stages row01 at exact `/home/runner/work/_temp/trivy-provenance/bin/trivy`, and feeds that exact path to the fixed Go `version -m` reader. Any different `RUNNER_TEMP`, first-line path, byte count or digest fails; the binary is never executed.

The selected source snapshots include `source/audit.mjs` because it owns `versionProbeBytes`; they are selected provenance snapshots, not a complete import/source closure. The implementation of `infra/scanner/retention.json` must mirror the approved plan's 50 literal paths and closed origin records; any mismatch refuses execution. No glob or directory is an archive input.

The complete GNU tar creation invocation is:

```bash
tar --create \
  --file="$archive" \
  --format=ustar \
  --blocking-factor=1 \
  --no-recursion \
  --sort=name \
  --mtime=@0 \
  --owner=0 --group=0 --numeric-owner \
  --no-acls --no-selinux --no-xattrs \
  --directory="$stage" \
  --null --verbatim-files-from \
  --files-from="$member_list"
```

`--owner=0 --group=0 --numeric-owner` supplies deterministic zero numeric owners and, under the pinned GNU tar1.35 producer, empty textual owner fields; there are no GNU tar `--uname` or `--gname` options. `member_list` is an exclusively created NUL-delimited list of exactly the 50 literal, unique, byte-sorted ASCII paths and therefore owns the physical order. Staging supplies header mode0555 only for `binary/trivy` and header mode0444 for the other49 files. These are TAR header modes; Windows restore validates NTFS ACL/handle identity and does not claim POSIX-mode equivalence.

Before any Windows listing or extraction, reuse `scanRawUstar({ input, diffId, maxRawBytes: 468374629, maxMembers: 50, signal, allowHardlinks: false, requireEmptyOwnerNames: true })` from `scripts/seaweed-image/archive.mjs`. The shared reader gains only the strict optional boolean `requireEmptyOwnerNames=false`: validate its type before consuming input; when true, reject a parsed USTAR header whose `uname` or `gname` field is nonempty. The default, returned member schema and every existing caller remain unchanged. It streams with buffers no larger than1MiB and must return the exact raw size, expected `sha256:<innerTarSha256>` diffID and exactly50 members. Require every member to be type regular file and compare `members[i].entry.path` and the existing nested `members[i].entry.*` metadata by index to the exact 50-row physical ASCII order above, with zero numeric owner/group, mtime0, exact header mode/size/member SHA-256 and no link target; the diffID supplies the whole-stream SHA-256. Only after that profile passes may fixed Windows `C:/Windows/System32/tar.exe` (`bsdtar 3.7.2`) use bounded `-t -f` and `-x -f -C`. GNU `--blocking-factor=1` applies to Linux creation and GNU validation only; no GNU-only flag is passed to bsdtar.

The shared-reader change is confined to `scripts/seaweed-image/archive.mjs` and focused `tests/seaweed-image-archive.test.mjs` cases. Tests cover default/false preserving current acceptance and return shape, true accepting blank fields, true rejecting independently recomputed-checksum/diffID archives with nonempty `uname` or `gname`, and nonboolean refusal before any input chunk is consumed. M3B tests separately enforce the exact 50-path indexed order. No existing SeaweedFS receipt/member shape changes.

A private synthetic compatibility probe already exercised the exact v6 GNU tar command with the 50-path layout: GNU tar1.35 produced a 52,224-byte USTAR archive with SHA-256 `936ca1df16144f9a4f10d1ecbc2ca636d467cd425744e83297a2e652b1a7d079`; all50 entries were regular, ordered exactly, had blank owner names, uid/gid/mtime zero, modes0444/0555 and two terminal zero blocks. Windows bsdtar3.7.2 listed the same50 paths, and the unchanged current `scanRawUstar` streamed the same diffID/member set. Evidence is under private `tar-compatibility-probe/verification.json` and `existing-reader-verification.json`. This proves tool/profile compatibility only; it is not an actual closure, copy or restore result. The retained first probe failure documents an incorrect flat-shape assertion and has no production effect.

## Manifests and canonical JSON

Every generated JSON is UTF-8 without BOM, fixed key order, compact encoding with no insignificant whitespace and exactly one LF. Unknown/missing/duplicate keys fail. Numbers are safe canonical integers; hashes and digests use fixed lowercase grammar.

Closed key order:

- `qualification-binding.json`: `schemaVersion,state,repository,workflow,runId,runAttempt,jobId,headSha,headTree,event,ref,artifact,review,sourceMappings`. `artifact`: `id,name,url,archiveDownloadUrl,workflowRun,sizeInBytes,digest,createdAt,expiresAt,expired`. `workflowRun`: `id,headSha`. Each mapping: `sourcePath,closurePath,bytes,sha256`.
- `publication-binding.json`: `schemaVersion,state,repository,workflow,sourceSha,sourceTree,runId,runAttempt,event,ref,package,bootstrap,publisherExecutedScanner,admission,supportStart,supportEnd`. It contains source/run identity only; future tar/GHCR results are not self-referential members.
- `restore-manifest.json`: `schemaVersion,state,scanner,qualification,publication,archive,files,exclusions,claims`. `archive`: `format,blockingFactor,regularMembers,expandedCapBytes,tarCapBytes`. Each of the49 file records: `path,class,bytes,sha256`. `claims`: `qualificationExecutedScanner,qualificationExecutionScope,publisherExecutedScanner,admitted,supportStart,supportEnd` with values `true,"DIAGNOSTIC_ONLY",false,false,null,null`.
- bootstrap/read receipts: `schemaVersion,state,result,repository,workflow,runId,runAttempt,headSha,headTree,package,tag,subject,payload,recipe,access,phases,cleanup,claims`.
- publisher receipt: `schemaVersion,state,result,repository,workflow,runId,runAttempt,headSha,headTree,qualificationArtifact,package,tag,ghcrManifestDigest,innerTar,restoreManifest,oci,phases,cleanup,claims`.
- C sidecar: `schemaVersion,state,repository,publisher,package,ghcrManifestDigest,innerTar,restoreManifest,copy,claims`. `publisher`: `workflow,runId,runAttempt,headSha,headTree,artifactId,artifactName,artifactDigest`. `innerTar` and `restoreManifest`: `bytes,sha256`. `copy`: `relativePath,createdAt`.
- restore receipt: `schemaVersion,state,result,sidecar,innerTar,restoreManifest,members,claims,phases,cleanup`.

Public publisher/C-sidecar/restore receipts cap at256KiB each; bootstrap/read receipts cap at64KiB; sidecar caps at64KiB. The exact publisher receipt and C sidecar hashes are later recorded on protected main.

## Fixed archive caps and publisher capacity

Per-class caps remain: archive exact52,714,130; binary exact176,386,208; Go inventory exact37,019; bundle16MiB; three positive JSON4MiB each; controls/received hashes/eight refusal streams1MiB each; receipt/self/SBOM32MiB each; probe and five fixture reports8MiB each; probe input/version/tools1MiB each; nine fixtures exact aggregate3,255,448; nine source snapshots4MiB each; two bindings1MiB each; restore manifest2MiB.

Derived expanded cap is `468322405` bytes. Fifty headers/padding plus end blocks at blocking factor1 produce tar cap `468374629` bytes.

Publisher capacity explicitly reserves:

- two expanded-tree equivalents: input/staging and validation extraction, `2 * 468322405`;
- six tar equivalents: sealed tar, envelope build context, BuildKit context/snapshot, final uncompressed layer, compressed blob and authenticated readback tar, `6 * 468374629`;
- Docker/BuildKit metadata/compression reserve: `134217728`; the compressed blob must be at most `469423205` (`tarCap + 1MiB`), and that extra1MiB is included in this128MiB reserve;
- qualification ZIP intake: `67108864`;
- qualification expanded intake: `67108864`;
- public publisher receipt: `1048576`.

Maximum projected peak is `4016376616` bytes. Require current free runner bytes at least `5020470770`, its ceiling plus25percent. At binding and immediately before the action, recheck the exact qualification ZIP/expanded observations, Docker/BuildKit identities and free bytes; retain these conservative caps even if the exact projection is smaller.

C:/WSL projection is four tar equivalents (compressed Docker blob, uncompressed Docker layer, WSL ext4 staged tar and Windows `.part` renamed in place to final), one expanded restore tree, a128MiB reserve, two64KiB sidecar copies and one256KiB receipt: `2476431865` bytes. Require physical C: free bytes at least `3095539832`, its ceiling plus25percent, before pull/copy and again before restore. Count cumulative WSL VHDX allocation on physical C: and do not assume deletion returns host space without compaction. The WSL virtual free-space report around912GB is not capacity evidence. The latest physical C: observation is `15719264256` free bytes; it is only a point-in-time observation and must be rechecked at action time without diagnosing or deleting unrelated data.

## Permission-separated workflows and registry proof reuse

Three workflows remain necessary:

1. `scanner-retention-package-bootstrap.yml`: first-run/attempt, no inputs, protected main, only `contents:read`/`packages:write`; the fixed harmless48-byte payload and227-byte `FROM scratch` recipe specified below, context cap4KiB, registry/local cap4MiB, runner projection64MiB plus25percent. No scanner bytes/OIDC/signing.
2. `scanner-retention-package-read.yml`: no inputs, only `contents:read`/`packages:read`; fixed harmless digest, authenticated/anonymous/authenticated reads and stopped-container copy.
3. `scanner-retention-publish.yml`: no inputs, only `contents:read`/`actions:read`/`packages:write`; exact qualification intake, tar construction and candidate publication.

The harmless payload is exactly `auto-world-scanner-closure-package-bootstrap-v1` followed by LF, 48 bytes, SHA-256 `720ca55e9efe30cbf58a0ef4f0ca720cf25c7e1ed09ac90c73846f11b81681fe`. The 227-byte Dockerfile, with LF endings and final LF, is:

```dockerfile
FROM scratch
COPY bootstrap.txt /bootstrap.txt
LABEL org.opencontainers.image.source="https://github.com/CleMeY15/auto-world"
LABEL org.opencontainers.image.description="Harmless scanner closure package bootstrap; not runtime"
```

Its SHA-256 is `29d8edf0d972e0504f9e787d6daca5313f806d5b335a365041d875a82c7b8aa3`. The context contains exactly those two regular files, 275 bytes total.

Reuse `scripts/package-bootstrap/registry-proof.mjs` behavior: separate owned authenticated and anonymous Docker/Buildx configurations, exact raw-manifest hashing, denial distinct from network failure, stopped never-started container copy, source-main verification and owned cleanup. The authenticated Docker configuration is an owned mode0700 ephemeral directory and may contain only the credential material created by `docker login`; the token enters on stdin from memory and never argv, logs, receipts or retained files. Every child gets a closed environment containing only required fixed locale/temp/Docker configuration and inherited fixed executable/system variables. Cleanup removes only owned configuration/material. External fork stays `SKIPPED_BY_USER/NOT_VERIFIED`.

No private tar/binary/archive/bundle/full report/layer/registry body/Docker config is uploaded publicly. Public artifacts contain only capped receipts, sidecar and approved technical evidence.

## Publisher and C: commit-last sidecar

The Linux publisher validates source/bootstrap/qualification, reconstructs fresh official provenance without executing Trivy, builds the exact tar, pushes the `FROM scratch` envelope containing only `/closure/scanner-closure.tar`, resolves its immutable digest, removes owned local state, authenticated-pulls the digest in a fresh configuration, copies the inner tar from a stopped container and requires exact source equality. OCI manifest/config/layer descriptors are recorded separately.

Copy two uses the already running `Ubuntu-24.04` WSL environment as root with existing functional `/usr/bin/docker` client/server28.0.4, GNU tar1.35 and `/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node`. It performs only authenticated read-only GHCR pull, stopped-never-started container creation and tar copy into an owned private ext4 staging path. It does not build locally, stop/start a service, modify Docker socket/group/ACL access or grant the `autoworld` user socket access.

The WSL-to-Windows boundary is one explicit binary stdout stream. In WSL, a closed root process first authenticates the pulled digest and staged inner tar, then opens that fixed tar without following links and writes exactly the already authenticated `innerTar.bytes` bytes to stdout; diagnostics use bounded stderr only. The Windows coordinator already holds the expected byte count/hash and authenticated publisher-sidecar bytes/hash in memory. It starts the fixed WSL command without a shell-built payload and performs a bounded in-memory pump from WSL stdout to stdin of a new scanner-scoped C# helper while incrementally hashing and counting; it creates no intermediate file. It enforces cap and exact byte count, clean EOF, no bytes after the expected length, bounded stderr, zero WSL exit, zero helper exit, and both processes fully reaped. Any early EOF, overrun, hash mismatch, nonzero exit, timeout or broken pipe leaves only the owned incomplete `.part` recovery state and cannot commit a sidecar.

The new helper reuses the relative-handle, restrictive non-inherited ACL, non-reparse ancestor, exclusive-create, flush, handle-identity and reread patterns of `scripts/postgres-image/private-copy-windows.cs`, but it accepts the tar only on stdin and has scanner-specific fixed names/schema. It writes stdin directly to the final-directory tar `.part`; there is no UNC path, `\\wsl$` read, caller-selected source path or second NTFS staging file. After streaming, it flushes, closes, reopens by validated relative handle and independently rereads the exact count/hash before returning success to the coordinator. The coordinator then exclusively writes and verifies the sidecar `.part`, promotes the tar first and sidecar last. This preserves the four-tar C:/WSL budget: compressed registry blob, uncompressed Docker layer, WSL ext4 staged tar, and one Windows tar allocation whose `.part` becomes final by rename. No Windows Docker installation is assumed.

After publication, retrieve the exact public publisher artifact by fixed API identity and create the C sidecar from its authenticated receipt. The sidecar must bind exact publisher workflow/run/attempt/head/tree/artifact ID/name/digest, GHCR manifest digest, innerTarBytes/Sha256 and restoreManifestBytes/Sha256. Write tar `.part` and sidecar `.part` exclusively, flush both, verify both again, then promote the tar first and the sidecar last as the commit marker. These are two renames, not an atomic multi-file transaction. Flush directory metadata where the platform supports it. An absent final sidecar means incomplete state and no accepted pair; retain that state for scoped recovery and never overwrite an existing target. Require the final sidecar identity to match an external authenticated expectation, then require its tar identity to match the promoted tar.

For the initial restore, retain the sidecar bytes/hash expectation in the same closed process from authenticated publisher-artifact intake through copy and restore; do not reconstruct that expectation from the C: sidecar or accept a caller-selected hash. This in-memory public identity grants no network or payload fallback to the restore function. Before any later fresh-process restore, the sidecar bytes/hash and publisher receipt identity must be delivered on reviewed protected main; its fixed reviewed policy supplies the external expectation. No restore is accepted with only a self-declared sidecar hash.

## Local byte-only restore with no network I/O

The Windows Node executable is fixed by absolute path to `C:/Users/Administrator/.codex/toolchains/auto-world/node-v22.23.2-win-x64/node-v22.23.2-win-x64/node.exe`, version `v22.23.2`, size86997320 and SHA-256 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`. Require these identities before execution and refuse PATH lookup; the current system PATH Node24.18.0 is not selected. The fixed `C:/Windows/System32/tar.exe` observation is77824 bytes, SHA-256 `2ca7db442feafa8e6d7a88c7dddf3113128f85701a4eb1182c71cfbf3d479a56`, version `bsdtar 3.7.2 - libarchive 3.7.2 zlib/1.2.5.f-ipp liblzma/5.4.3 bz2lib/1.0.8 libzstd/1.5.4`; recheck before use and require review after any OS tool replacement. Read-only preparation is recorded in `scanner-retention-local-tools.json`, not treated as restore acceptance.

The restore function's only data-file inputs are the fixed sidecar and matching tar; it derives a new empty output path under the authorized C: root. The external public-identity expectation is retained internally by authenticated intake in that same coordinator or fixed by reviewed protected-main policy, never accepted as an arbitrary CLI/file input. It uses only the pinned Windows Node executable and fixed `C:/Windows/System32/tar.exe` bsdtar3.7.2 after the existing USTAR profile has passed. Its closed child environment contains no GitHub/GHCR token, Docker configuration, registry credential, URL, proxy setting, network client or fallback path. The implementation has no fetch/socket/registry/Docker/gh/curl code path.

This is a **local no-network-I/O workflow claim**, not an OS network-isolation claim. Do not change the firewall, stop WSL, stop Docker globally or claim the operating system could not access a network.

Restore sequence:

1. require a final sidecar commit marker, match its bytes/hash to the external authenticated expectation, then validate its exact schema and publisher binding;
2. hash the tar and require sidecar `innerTar.bytes/sha256`;
3. stream the existing USTAR profile with cap468374629/maxMembers50/no hardlinks, then use bounded bsdtar `-t -f` to list exactly50 regular members;
4. extract only `scanner-closure/restore-manifest.json` into a new owned temporary directory;
5. require its exact sidecar `restoreManifest.bytes/sha256`, canonical schema and49 records;
6. only then use bounded bsdtar `-x -f -C` to extract the other49 fixed members and compare every record/type/header-mode/size/hash, while validating Windows files through handle identity and ACL rather than claiming POSIX permission equivalence;
7. independently check fixed official archive/binary/inventory identities, seal capped receipt and clean only owned temporary extraction.

No source copy, GHCR, qualification ZIP, Docker cache, database or other archive fallback exists. Trivy is never run. This proves C-side bytes can be locally restored, not that the scanner or databases can operate offline.

## Small implementation surface

- `infra/scanner/retention.json`: closed tuple, API binding,50 paths, schemas, caps/tags/C path.
- `scripts/scanner/retention-policy.mjs`: pure validators and command builders only.
- `scripts/scanner/retention-publish.mjs`: small Linux `bootstrap|read-proof|publish` entrypoint reusing existing artifact/registry primitives.
- `scripts/scanner/retention-restore.mjs`: small Windows/C commit-last copy/sidecar/local restore entrypoint.
- `scripts/scanner/retention-private-copy-windows.cs`: scanner-scoped stdin-to-relative-handle writer reusing the patterns of `scripts/postgres-image/private-copy-windows.cs` without changing that historical helper or its contracts.
- `scripts/seaweed-image/archive.mjs` plus focused `tests/seaweed-image-archive.test.mjs`: only the optional strict `requireEmptyOwnerNames=false` boundary described above; default results and existing callers remain unchanged.
- `scripts/seaweed-image/read-artifact-zip.mjs` plus `tests/seaweed-image-read-artifact-zip.test.mjs`: only the closed `scannerRetention` profile, fixed inventory/caps and existing-profile regression coverage above.
- `scripts/seaweed-image/download-artifact-zip.mjs` plus `tests/seaweed-image-download-artifact-zip.test.mjs`: only the optional immutable closed child-environment snapshot; existing omitted-environment callers unchanged.
- three permission-separated workflows; four focused test files; one validation document and narrow M3 link.

No large controller, dependency, service, account, custom crypto/archive/OCI parser, signer, supervisor or admission consumer.

## Verification, acceptance and stop rules

Future implementation tests must cover exact API fields/redirect refusals, ZIP duplicate/traversal/link/caps, all50 closed origin records and qualification expiry, canonical JSON/key order, exact byte-sorted physical USTAR order, full GNU creation invocation, optional empty-owner-name validation before input consumption, bsdtar-only post-profile extraction, bounded WSL-stdout-to-helper-stdin count/hash/EOF/exit handling with no extra NTFS staging, six-copy publisher/four-copy C budget arithmetic, receipt/sidecar caps, isolated Docker configs/closed envs, no Trivy execution, no private artifact upload, publisher readback identity, commit-last tar+sidecar, manifest-first restore and absence of every network/fallback code path. Negative owner-name fixtures recompute both TAR header checksum and whole-archive diffID so failure proves the owner-name boundary. This filled review candidate introduces no tests or production code; implementation remains gated on ordered actual approvals. Later delivery runs affected official/managed suites, lint, typecheck, root/workspace tests, build, secrets and dependency audit, clean checkout, independent implementation/security review, exact-head and protected-main managed/quality evidence.

Stop on any unbound/expired/redirected/mismatched API identity, unsafe ZIP, plan-review mismatch, package/access ambiguity, changed byte, insufficient capacity, tar/sidecar mismatch, private public-artifact byte, cleanup ambiguity or restore fallback. Preserve failures and consumed attempts.

M3B acceptance requires accepted PR237 main, filled identical-plan Architect/Critic approvals, protected-main implementation source, passed harmless package controls, exact publisher/readback, committed C pair and manifest-first local byte restore, followed by protected-main evidence and independent actual review. It closes only the scanner material row.

Rollback disables the owned writer and revokes unadmitted inventory; it preserves package, tar/sidecar, receipts, source history and unrelated archives/data. No deletion is authorized.

GNU tar semantics used by this plan are fixed against the official [GNU tar manual](https://www.gnu.org/software/tar/manual/tar.html) and its [reproducible archives guidance](https://www.gnu.org/software/tar/manual/html_node/Reproducibility.html).

