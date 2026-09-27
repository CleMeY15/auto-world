import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requireRemoteCandidateAuditContext, runRemoteCandidateAudit,
  validatePublicationPhases, validatePublishedCandidateBinding, validateRemoteAuditFilesystem,
  validateRemoteAuditRuntimeConfig, verifyRemoteAuditMain,
} from "../scripts/seaweed-image/candidate-remote-audit.mjs";

const publisherRun = "36324316631";
const publisherRevision = "c9aa67d4a7f1730070d44a41f398fd1ddf07627e";
const auditRevision = "a".repeat(40);
const imageId = `sha256:${"d".repeat(64)}`;
const diffId = `sha256:${"1".repeat(64)}`;
const manifestDigest = `sha256:${"9".repeat(64)}`;
const layerDigest = `sha256:${"3".repeat(64)}`;
const image = "ghcr.io/clemey15/auto-world-seaweedfs-s3";
const subject = `${image}@${manifestDigest}`;
const publishPhases = ["managed_tool_identity", "checkout_identity", "registry_login",
  "candidate_materialization_and_private_copy", "copied_archive_revalidation", "local_inventory_before",
  "local_references_absent", "load_private_archive", "exact_local_image", "bootstrap_authorized_read_before",
  "bootstrap_anonymous_read_denied", "bootstrap_authorized_read_after", "remote_tag_absent",
  "protected_main_immediately_before_write", "fixed_unique_candidate_tag", "single_registry_push",
  "remote_tag_manifest", "remote_digest_manifest", "candidate_anonymous_digest_read_denied",
  "owned_docker_cleanup", "owned_temporary_cleanup"];

function publicationReceipt() {
  return {
    schemaVersion: 1, state: "PUBLISHED_UNADMITTED", result: "PASSED",
    publication: "PUBLISHED_UNADMITTED", admission: "NOT_AUTHORIZED", execution: "NOT_ATTEMPTED",
    repository: "CleMeY15/auto-world", workflowPath: ".github/workflows/seaweed-candidate-publish.yml",
    image, platform: "linux/amd64", sourceSha: publisherRevision, sourceRef: "refs/heads/main",
    runId: publisherRun, runNumber: "1", runAttempt: "1", tag: `${image}:candidate-${publisherRun}-attempt-1`,
    subject, candidateAnonymousRead: "AUTHORIZATION_DENIED",
    candidate: { imageId, diffId, rawSize: 4096, memberCount: 3, archiveSha256: "4".repeat(64),
      archiveBytes: 8192, configSha256: imageId.slice(7), configBytes: 512,
      savedLayerSha256: diffId.slice(7), savedLayerBytes: 4096,
      originalTag: `auto-world-seaweed-s3:run-${publisherRun}-attempt-1`, serverVersion: "28.0.4" },
    remote: { manifestDigest, manifestBytes: 529,
      manifestMediaType: "application/vnd.docker.distribution.manifest.v2+json",
      configDigest: imageId, configBytes: 512,
      configMediaType: "application/vnd.docker.container.image.v1+json", layerDigest, layerBytes: 2048,
      layerMediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
      remoteLayerVerification: "PENDING_INDEPENDENT_READ" },
    sourceProof: { sourceRunId: "35884717093", sourceCodeRevision: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
      sourceBinaryDigest: `sha256:${"5".repeat(64)}`,
      baseManifestDigest: "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362",
      sourceArtifacts: "AUTHENTICATED_BY_REVIEWED_MATERIALIZER_POLICY" },
    phases: publishPhases.map((name) => ({ name, result: "PASSED", durationMs: 1 })),
  };
}

function fixture(changeReceipt) {
  const receipt = publicationReceipt(); changeReceipt?.(receipt);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const policy = {
    kind: "SEAWEED_REMOTE_CANDIDATE_POLICY_V1", authority: "REVIEWED_MAIN_POLICY",
    repository: "CleMeY15/auto-world", owner: "CleMeY15", image, platform: "linux/amd64",
    publishedTag: `candidate-${publisherRun}-attempt-1`, subject,
    manifest: { digest: manifestDigest, bytes: 529,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: { digest: imageId, size: 512, mediaType: "application/vnd.docker.container.image.v1+json" },
      layer: { digest: layerDigest, size: 2048,
        mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
        compressedSizeVerification: "RECORDED_ONLY" } },
    candidate: { imageId, diffId, rawSize: 4096, memberCount: 3 },
    publisher: { workflowPath: ".github/workflows/seaweed-candidate-publish.yml", runId: publisherRun,
      runNumber: "1", runAttempt: "1", recipeRevision: publisherRevision, result: "PASSED",
      receiptSha256: createHash("sha256").update(receiptBytes).digest("hex") },
    source: { runId: "35884717093", codeRevision: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
      binaryDigest: `sha256:${"5".repeat(64)}`,
      baseManifestDigest: "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362",
      archiveSha256: "4".repeat(64), archiveBytes: 8192, configSha256: imageId.slice(7), configBytes: 512,
      savedLayerSha256: diffId.slice(7), savedLayerBytes: 4096 },
  };
  return { receipt, receiptBytes, policy };
}

function environment(root) {
  return { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-candidate-remote-audit.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: auditRevision, GITHUB_RUN_ID: "40000000000",
    RUNNER_TEMP: root, GITHUB_WORKSPACE: root, GITHUB_TOKEN: "token", GH_TOKEN: "token", PATH: "path" };
}

test("remote publication binding accepts only the reviewed confirmed object and exact recovery disposition", () => {
  const { policy, receiptBytes } = fixture();
  assert.equal(validatePublishedCandidateBinding(policy, receiptBytes).policy.subject, subject);
  for (const mutate of [
    (value) => { value.subject = `${image}@sha256:${"0".repeat(64)}`; },
    (value) => { value.repository = "attacker/fork"; },
    (value) => { value.runId = "1"; },
    (value) => { value.sourceProof.sourceRunId = "1"; },
    (value) => { value.state = "FAILED_BEFORE_PUBLICATION"; },
    (value) => { value.result = "FAILED"; },
    (value) => { value.phases.find((phase) => phase.name === "owned_docker_cleanup").result = "FAILED"; },
    (value) => { value.phases.pop(); },
  ]) {
    const changed = fixture(mutate);
    assert.throws(() => validatePublishedCandidateBinding(changed.policy, changed.receiptBytes), /publication_invalid/u);
  }
  const changedBytes = Buffer.concat([receiptBytes, Buffer.from(" ")]);
  assert.throws(() => validatePublishedCandidateBinding(policy, changedBytes), /publication_invalid/u);
  const recovery = publicationReceipt().phases;
  recovery.at(-2).result = "FAILED";
  recovery.at(-2).reasons = ["seaweed_candidate_publish_image_cleanup_failed"];
  assert.equal(validatePublicationPhases(recovery, "FAILED"), true);
  recovery.at(-2).reasons = ["different_failure"];
  assert.throws(() => validatePublicationPhases(recovery, "FAILED"), /publication_invalid/u);
});

test("committed remote policy binds the exact retained native publisher receipt", () => {
  const policy = JSON.parse(readFileSync(
    new URL("../infra/seaweed-image/candidate-remote.json", import.meta.url), "utf8"));
  const receiptBytes = readFileSync(
    new URL("../infra/seaweed-image/candidate-publication-receipt.json", import.meta.url));
  const bound = validatePublishedCandidateBinding(policy, receiptBytes);
  assert.equal(bound.policy.publisher.receiptSha256,
    "695a063450a40b1abc477b11255ad54255c89c68bc4d1609d12f6865816ccb6f");
  assert.equal(bound.receipt.result, "FAILED");
  assert.equal(bound.receipt.subject, subject.replace(manifestDigest,
    "sha256:9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504"));
});

test("archive and runtime callbacks require weed, reject Rust helpers and preserve baseline runtime", () => {
  const { policy } = fixture();
  const entries = [{ path: "usr/bin/weed", type: "file" }, { path: "usr/bin", type: "directory" },
    { path: "entrypoint.sh", type: "file" }];
  assert.equal(validateRemoteAuditFilesystem(entries, policy), true);
  assert.throws(() => validateRemoteAuditFilesystem(entries.slice(1), policy), /filesystem_invalid/u);
  assert.throws(() => validateRemoteAuditFilesystem(entries.map((entry, index) => index === 2
    ? { path: "usr/bin/weed-worker", type: "file" } : entry), policy), /filesystem_invalid/u);
  const baseline = { Entrypoint: ["/entrypoint.sh"], Cmd: ["mini"], Env: ["PATH=/bin"], WorkingDir: "/data",
    Volumes: { "/data": {} }, ExposedPorts: { "8333/tcp": {} } };
  const actual = { ...JSON.parse(JSON.stringify(baseline)), User: "", Labels: { reviewed: "true" } };
  assert.equal(validateRemoteAuditRuntimeConfig(actual, baseline), true);
  assert.throws(() => validateRemoteAuditRuntimeConfig({ ...actual, User: "root" }, baseline), /runtime_invalid/u);
  assert.throws(() => validateRemoteAuditRuntimeConfig({ ...actual, Cmd: ["volume-rust"] }, baseline), /runtime_invalid/u);
});

test("remote audit context rejects branch, fork, rerun, other workflow and root execution", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-remote-audit-context-")));
  try {
    const env = environment(root); const host = { platform: "linux", uid: 1001, gid: 1001 };
    const context = requireRemoteCandidateAuditContext(env, host);
    assert.equal(context.root, path.join(root, "seaweed-candidate-remote-audit-work"));
    for (const change of [{ GITHUB_REF: "refs/heads/feature" }, { GITHUB_REPOSITORY: "attacker/fork" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_WORKFLOW_REF: "attacker/fork/.github/workflows/seaweed-candidate-remote-audit.yml@refs/heads/main" }]) {
      assert.throws(() => requireRemoteCandidateAuditContext({ ...env, ...change }, host), /context_invalid/u);
    }
    assert.throws(() => requireRemoteCandidateAuditContext(env, { ...host, uid: 0 }), /context_invalid/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("checkout and current protected main are verified before execution", async () => {
  const context = { workspace: "/workspace", recipeRevision: auditRevision };
  const env = { GITHUB_TOKEN: "token", GH_TOKEN: "token", PATH: "/bin" };
  const commandRunner = () => ({ status: 0, stdout: Buffer.from(`${auditRevision}\n`), stderr: Buffer.alloc(0) });
  const response = (value) => new globalThis.Response(JSON.stringify(value), { status: 200 });
  assert.equal(await verifyRemoteAuditMain(context, env, { commandRunner,
    fetchImpl: async () => response({ name: "main", protected: true, commit: { sha: auditRevision } }) }), true);
  await assert.rejects(verifyRemoteAuditMain(context, env, { commandRunner,
    fetchImpl: async () => response({ name: "main", protected: false, commit: { sha: auditRevision } }) }), /main_invalid/u);
  await assert.rejects(verifyRemoteAuditMain(context, { ...env, GH_TOKEN: "other" }, { commandRunner }),
    /environment_invalid/u);
});

test("execute selects the remote provider and rejects a local receipt", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-remote-audit-run-")));
  try {
    const env = environment(root); const { policy, receiptBytes } = fixture();
    const baselineBytes = Buffer.from(JSON.stringify({ config: { Entrypoint: ["/entrypoint.sh"], Cmd: ["mini"],
      Env: ["PATH=/bin"], WorkingDir: "/data", Volumes: { "/data": {} }, ExposedPorts: { "8333/tcp": {} } } }));
    const files = new Map([["infra/seaweed-image/candidate-remote.json", Buffer.from(JSON.stringify(policy))],
      ["infra/seaweed-image/candidate-publication-receipt.json", receiptBytes],
      ["infra/seaweed-image/base-config.json", baselineBytes]]);
    let selected = false;
    const result = await runRemoteCandidateAudit(["execute"], env, {
      context: { platform: "linux", uid: 1001, gid: 1001 }, verifyMain: async () => true,
      readCommitted: (relative) => files.get(relative),
      remoteProvider: async (input) => {
        selected = true; assert.equal(input.policy.subject, subject); assert.equal(Object.hasOwn(input, "createdAt"), false);
        return { kind: "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1", runId: input.runId,
          recipeRevision: input.recipeRevision, subject: input.policy.subject,
          publisher: { result: input.policy.publisher.result } };
      },
      remoteReceiptValidator: (receiptValue) => {
        if (receiptValue.kind !== "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1") throw new Error("remote_only");
        return receiptValue;
      },
      executeAudit: async (context, deps) => {
        assert.equal(deps.auditKind, "SEAWEED_EXACT_REMOTE_CANDIDATE_AUDIT_V1");
        const receiptValue = await deps.materialize({ parent: context.root, runId: context.runId,
          recipeRevision: context.recipeRevision, createdAt: "must-not-reach-provider",
          signal: new globalThis.AbortController().signal }, async () => {});
        assert.equal(deps.validateCandidateReceipt(receiptValue), true);
        assert.throws(() => deps.validateCandidateReceipt({ kind: "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1" }), /remote_only/u);
        return { state: "COMPLETE" };
      },
    });
    assert.equal(selected, true); assert.deepEqual(result, { state: "COMPLETE" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
