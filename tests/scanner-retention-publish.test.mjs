import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TEST_ONLY_runScannerRetentionPublish,
  createScannerRetentionPublisherReceipt,
  parseScannerRetentionArguments,
  scannerRetentionPublisherChildEnvironment,
  scannerRetentionTarInvocation,
  validateScannerRetentionClosurePolicy,
  validateScannerRetentionPublishContext,
} from "../scripts/scanner/retention-publish.mjs";
import { SCANNER_RETENTION } from "../scripts/scanner/retention-policy.mjs";
import { scannerRetentionPublisherPhases, validateScannerRetentionPublisherReceiptBytes }
  from "../scripts/scanner/retention-policy.mjs";

const output = "/home/runner/work/_temp/scanner-retention-publisher-public";
const env = () => ({
  GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/scanner-retention-publish.yml@refs/heads/main",
  GITHUB_JOB: "publish", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "42",
  GITHUB_SHA: "a".repeat(40), GITHUB_WORKFLOW_SHA: "a".repeat(40), RUNNER_OS: "Linux",
  GITHUB_WORKSPACE: "/home/runner/work/auto-world/auto-world",
  RUNNER_TEMP: "/home/runner/work/_temp", GITHUB_TOKEN: "token", GH_TOKEN: "token",
  PATH: "/opt/hostedtoolcache/node/22.23.4/x64/bin:/usr/local/bin:/usr/bin:/bin",
});

test("publish mode only accepts an absolute output and keeps existing modes", () => {
  assert.deepEqual(parseScannerRetentionArguments(["publish", "--output", output]),
    { mode: "publish", output: parseScannerRetentionArguments(["bootstrap", "--output", output]).output });
  assert.equal(parseScannerRetentionArguments(["bootstrap", "--output", output]).mode, "bootstrap");
  assert.equal(parseScannerRetentionArguments(["read-proof", "--output", output]).mode, "read-proof");
  for (const argv of [["publish"], ["publish", "--output", "relative"], ["publish", "--other", output]]) {
    assert.throws(() => parseScannerRetentionArguments(argv), /scanner_retention_arguments_invalid/u);
  }
});

test("publisher context is exact, first-run main-only and token bounded", () => {
  const context = validateScannerRetentionPublishContext(env(), "linux");
  assert.equal(context.runId, "42");
  for (const [field, value] of [["GITHUB_RUN_NUMBER", "2"], ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_REF", "refs/heads/dev"], ["RUNNER_TEMP", "/tmp"], ["GH_TOKEN", "other"]]) {
    assert.throws(() => validateScannerRetentionPublishContext({ ...env(), [field]: value }, "linux"),
      /scanner_retention_publish_context_invalid/u);
  }
  assert.throws(() => validateScannerRetentionPublishContext(env(), "win32"),
    /scanner_retention_publish_context_invalid/u);
});

test("closure profile fixes all 50 physical members and exact GNU tar arguments", () => {
  assert.equal(validateScannerRetentionClosurePolicy(), SCANNER_RETENTION.closure);
  const args = scannerRetentionTarInvocation({ archive: "/tmp/closure.tar", stage: "/tmp/stage",
    memberList: "/tmp/members.nul" });
  assert.deepEqual(args, ["--create", "--file=/tmp/closure.tar", "--format=ustar", "--blocking-factor=1",
    "--no-recursion", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--no-acls", "--no-selinux", "--no-xattrs", "--directory=/tmp/stage", "--null",
    "--verbatim-files-from", "--files-from=/tmp/members.nul"]);
  const reversed = { ...SCANNER_RETENTION.closure, members: [...SCANNER_RETENTION.closure.members].reverse() };
  assert.throws(() => validateScannerRetentionClosurePolicy(reversed), /scanner_retention_publish_policy_invalid/u);
});

test("closed child environment excludes ambient proxy and package-manager secrets", () => {
  const context = validateScannerRetentionPublishContext(env(), "linux");
  const child = scannerRetentionPublisherChildEnvironment(context, "/tmp/docker", "/tmp/work");
  assert.deepEqual(Object.keys(child).sort(), ["CI", "DOCKER_CONFIG", "GH_DEBUG", "GH_PROMPT_DISABLED",
    "GITHUB_WORKSPACE", "GOTOOLCHAIN", "HOME", "LANG", "LC_ALL",
    "PATH", "RUNNER_TEMP", "TMPDIR", "TZ"].sort());
  assert.equal(child.HTTPS_PROXY, undefined);
  assert.equal(child.NODE_AUTH_TOKEN, undefined);
  assert.equal(child.GITHUB_TOKEN, undefined);
});

test("publisher sequence is fixed and receipt stays public and unadmitted", async () => {
  const names = []; let tick = 0;
  const { receipt, bytes } = await TEST_ONLY_runScannerRetentionPublish({
    validateContext: () => ({ runId: "42", headSha: "a".repeat(40) }),
    closure: SCANNER_RETENTION.closure, now: () => tick++,
    runPhase: async (name) => { names.push(name); return name === "protected_main"
      ? { values: { headTree: "b".repeat(40) } } : { values: {} }; },
  });
  assert.equal(names.length, 14);
  assert.deepEqual(names, receipt.phases.map((phase) => phase.name));
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.claims.scannerExecuted, false);
  assert.equal(receipt.claims.admitted, false);
  assert.ok(bytes.length < 262144);
  assert.equal(bytes.at(-1), 10);
});

test("receipt refuses the public cap", () => {
  assert.throws(() => createScannerRetentionPublisherReceipt({ runId: "42", headSha: "a".repeat(40) }, {
    oci: { unsafe: "x".repeat(262144) },
  }), /scanner_retention_publish_receipt_too_large/u);
});

test("successful public receipt matches the strict policy schema", () => {
  const identity = { headSha: "a".repeat(40), headTree: "b".repeat(40), runId: "42" };
  const innerTar = { bytes: 512, sha256: "c".repeat(64) };
  const manifestSha = "d".repeat(64); const configSha = "e".repeat(64); const layerSha = "f".repeat(64);
  const values = {
    headTree: identity.headTree,
    qualificationArtifact: { id: SCANNER_RETENTION.qualification.artifact.id,
      name: SCANNER_RETENTION.qualification.artifact.name, digest: SCANNER_RETENTION.qualification.artifact.digest,
      bytes: SCANNER_RETENTION.qualification.artifact.sizeInBytes,
      expiresAt: SCANNER_RETENTION.qualification.artifact.expiresAt },
    tag: `${SCANNER_RETENTION.package}:${SCANNER_RETENTION.publisher.tagPrefix}${innerTar.sha256}`,
    ghcrManifestDigest: `sha256:${manifestSha}`, innerTar,
    restoreManifest: { bytes: 1, sha256: "1".repeat(64) },
    oci: {
      manifest: { mediaType: "application/vnd.oci.image.manifest.v1+json", bytes: 100, sha256: manifestSha },
      config: { digest: `sha256:${configSha}`, mediaType: "application/vnd.oci.image.config.v1+json",
        bytes: 100, sha256: configSha },
      layer: { digest: `sha256:${layerSha}`, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        bytes: 100, sha256: layerSha },
      readback: { imageId: `sha256:${configSha}`, containerId: "2".repeat(64), innerTarBytes: 512,
        innerTarSha256: innerTar.sha256, stoppedNeverStarted: true },
    },
    phases: scannerRetentionPublisherPhases.map((name) => ({ name, result: "PASSED", durationMs: 0 })),
    cleanup: { state: "PASSED", image: "REMOVED", container: "REMOVED", buildCache: "REMOVED",
      authenticatedDockerConfig: "REMOVED", ownedPathRemoved: true },
  };
  const built = createScannerRetentionPublisherReceipt({ runId: identity.runId, headSha: identity.headSha },
    { ...values, state: "PUBLISHED_UNADMITTED", result: "PASSED" });
  assert.equal(validateScannerRetentionPublisherReceiptBytes(built.bytes, identity).result, "PASSED");
});

test("publisher has no child-process path that executes the retained scanner", () => {
  const source = readFileSync(new URL("../scripts/scanner/retention-publish.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /publishRun\([^\n]+,\s*["']trivy["']/u);
  assert.doesNotMatch(source, /spawnSync\([^\n]+trivy/u);
});

test("publisher uses an owned builder and exact inventory cleanup without global prune", () => {
  const source = readFileSync(new URL("../scripts/scanner/retention-publish.mjs", import.meta.url), "utf8");
  assert.match(source, /aw-scanner-retention-\$\{context\.runId\}/u);
  assert.match(source, /"--driver", "docker-container"/u);
  assert.match(source, /"--provenance=false", "--sbom=false"/u);
  assert.match(source, /publishDockerInventory/u);
  assert.match(source, /scanner_retention_publish_builder_cleanup_invalid/u);
  assert.doesNotMatch(source, /(?:system|builder|image|container|volume)\s+prune/u);
});
