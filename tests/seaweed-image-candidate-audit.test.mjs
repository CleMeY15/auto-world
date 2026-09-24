import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateInputDockerArguments, ownedContainerRun, ownedContainerRunArguments,
  requireCandidateAuditContext, TEST_ONLY_executeCandidateAudit,
  validateAuditedCandidateReceipt } from "../scripts/seaweed-image/candidate-audit.mjs";
import { captureFiles } from "../scripts/scanner/controls.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const imageId = `sha256:${"b".repeat(64)}`;
const diffId = `sha256:${"c".repeat(64)}`;
const revision = "d".repeat(40);

async function fakeAudit(mode) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aw-candidate-audit-execute-"));
  const context = { root: path.join(temp, "work"), output: path.join(temp, "evidence"),
    builds: path.join(temp, "builds"), runId: "35999999999", recipeRevision: revision,
    uid: lstatSync(temp).uid, gid: lstatSync(temp).gid };
  const carrier = `aquasec/trivy@${digest}`;
  const manifests = [
    { repository: "ghcr.io/aquasecurity/trivy-db", digest, name: "vulnerability" },
    { repository: "ghcr.io/aquasecurity/trivy-java-db", digest, name: "java" },
  ];
  let materializeCalls = 0; let archiveFile; let databaseFiles;
  const dependencies = {
    ownedDirectory: () => {},
    scannerPair: async (_builds, work) => {
      const scanner = path.join(work, "scanner");
      writeFileSync(scanner, "scanner-binary");
      return { lock: { scanner: { version: "0.74.0-autoworld.2", sourceCommit: revision },
        baseline: { repository: "aquasec/trivy", platformDigest: digest } },
      binary: { sha256: "a".repeat(64), size: 14 }, scanner, builds: [] };
    },
    manifestEvidence: () => manifests,
    databaseEvidence: async (cache) => {
      if (mode === "stale") throw new Error("scanner_database_age_exceeded");
      if (!databaseFiles) {
        databaseFiles = ["vuln.db", "vuln.json", "java.db", "java.json"].map((name) => {
          const file = path.join(cache, name);
          writeFileSync(file, name);
          return { path: file, cap: 1024 };
        });
      }
      return { files: await captureFiles(databaseFiles), metadata: {} };
    },
    command: (args, options = {}) => {
      if (args[0] === "container") return Buffer.alloc(0);
      if (options.output) {
        writeFileSync(options.output, "{}");
        if (["mutation", "mutation_masked", "mutation_cleanup_failed"].includes(mode)
          && args.some((arg) => arg.endsWith("-scan-json"))) {
          appendFileSync(archiveFile, "changed");
        }
      }
      return Buffer.alloc(0);
    },
    inputArguments: () => ["run", "--rm", carrier],
    evaluatePolicy: () => ({ state: mode === "blocked" ? "BLOCKED" : "COMPLETE",
      findings: [], blockers: mode === "blocked" ? [{ code: "high_vulnerability" }] : [], inventory: {} }),
    materialize: async ({ parent }, inspect) => {
      materializeCalls += 1;
      archiveFile = path.join(parent, "saved.tar");
      const bytes = Buffer.from("exact-candidate-archive");
      writeFileSync(archiveFile, bytes);
      const proof = { imageId, diffId, tag: "aw-seaweed-candidate:test",
        archiveSha256: createHash("sha256").update(bytes).digest("hex"), archiveBytes: bytes.length,
        configSha256: "e".repeat(64), configBytes: 200,
        layerSha256: "f".repeat(64), layerBytes: 300 };
      let callbackFailure;
      try {
        await inspect({ file: archiveFile, archiveProof: proof,
          imageId, diffId, runId: context.runId, recipeRevision: context.recipeRevision });
      } catch (error) { callbackFailure = error; }
      finally { unlinkSync(archiveFile); }
      if (callbackFailure) {
        if (["mutation_masked", "mutation_cleanup_failed"].includes(mode)) {
          throw Object.assign(new Error("seaweed_candidate_inspection_failed"),
            { code: "seaweed_candidate_inspection_failed", state: "INCOMPLETE",
              authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
              ...(mode === "mutation_cleanup_failed" ? { secondaryFailure: {
                code: "seaweed_candidate_image_cleanup_failed", phase: "CANDIDATE_IMAGE_CLEANUP",
                reason: "IMAGE_REMOVE_FAILED" } } : {}) });
        }
        throw callbackFailure;
      }
      return { kind: "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1", state: "VERIFIED",
          authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
          imageExecution: "NOT_ATTEMPTED", publication: "NOT_ATTEMPTED",
          vulnerabilityAudit: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED",
          imageId, diffId, archiveSha256: proof.archiveSha256,
          archiveBytes: proof.archiveBytes, runId: context.runId,
          recipeRevision: context.recipeRevision };
    },
  };
  let result; let error;
  try {
    try { result = await TEST_ONLY_executeCandidateAudit(context, dependencies); }
    catch (caught) { error = caught; }
    const receipt = JSON.parse(readFileSync(path.join(context.output, "audit-receipt.json"), "utf8"));
    return { result, error, receipt, materializeCalls,
      workEmpty: readdirSync(context.root).length === 0,
      archiveGone: !archiveFile || !existsSync(archiveFile) };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

test("orchestrator refuses stale vulnerability database before candidate materialization and cleans globally", async () => {
  const audit = await fakeAudit("stale");
  assert.equal(audit.error?.message, "scanner_database_age_exceeded");
  assert.equal(audit.receipt.state, "INCOMPLETE");
  assert.equal(audit.materializeCalls, 0);
  assert.equal(audit.workEmpty, true);
});

test("orchestrator marks an exact-subject audit complete only after both reports and cleanup", async () => {
  const audit = await fakeAudit("complete");
  assert.equal(audit.error, undefined);
  assert.equal(audit.result?.state, "COMPLETE");
  assert.equal(audit.receipt.state, "COMPLETE");
  assert.equal(audit.receipt.containerCleanup.length, 4);
  assert.equal(audit.materializeCalls, 1);
  assert.equal(audit.workEmpty, true);
  assert.equal(audit.archiveGone, true);
});

test("orchestrator preserves a policy BLOCKED receipt and fails after cleanup", async () => {
  const audit = await fakeAudit("blocked");
  assert.equal(audit.error?.message, "seaweed_audit_blocked");
  assert.equal(audit.receipt.state, "BLOCKED");
  assert.equal(audit.receipt.blockerCount, 1);
  assert.equal(audit.workEmpty, true);
  assert.equal(audit.archiveGone, true);
});

test("orchestrator rejects an archive mutated by the scanner and still disposes it", async () => {
  const audit = await fakeAudit("mutation");
  assert.equal(audit.error?.message, "scanner_frozen_input_changed");
  assert.equal(audit.receipt.state, "INCOMPLETE");
  assert.equal(audit.receipt.failure.code, "scanner_frozen_input_changed");
  assert.equal(audit.workEmpty, true);
  assert.equal(audit.archiveGone, true);
});

test("orchestrator restores its fixed audit reason after materializer masks the callback", async () => {
  const audit = await fakeAudit("mutation_masked");
  assert.equal(audit.error?.message, "scanner_frozen_input_changed");
  assert.equal(audit.receipt.failure.code, "scanner_frozen_input_changed");
  assert.equal(audit.receipt.state, "INCOMPLETE");
  assert.equal(audit.workEmpty, true);
  assert.equal(audit.archiveGone, true);
});

test("materializer image cleanup failure outranks the masked inspection error", async () => {
  const audit = await fakeAudit("mutation_cleanup_failed");
  assert.equal(audit.error?.message, "seaweed_audit_candidate_cleanup_uncertain");
  assert.equal(audit.receipt.failure.code, "seaweed_audit_candidate_cleanup_uncertain");
  assert.equal(audit.receipt.state, "INCOMPLETE");
  assert.equal(audit.archiveGone, true);
  assert.equal(audit.workEmpty, true);
});

test("archive input scanner cannot reach a registry, the Docker socket or writable candidate bytes", () => {
  const args = candidateInputDockerArguments({ carrier: `aquasec/trivy@${digest}`,
    scanner: "/tmp/scanner", cache: "/tmp/cache", archive: "/tmp/private/saved.tar",
    uid: 1001, gid: 1001, format: "json" });
  assert.deepEqual(args.slice(0, 6), ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none"]);
  for (const flag of ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
    "--user", "1001:1001", "--entrypoint", "/scanner", "--input", "/candidate/saved.tar",
    "--skip-db-update", "--skip-java-db-update", "--offline-scan", "--scanners", "vuln",
    "--severity", "HIGH,CRITICAL"]) assert.ok(args.includes(flag), flag);
  assert.ok(args.includes("--mount"));
  assert.ok(args.includes("type=bind,src=/tmp/private/saved.tar,dst=/candidate/saved.tar,readonly"));
  assert.ok(args.every((entry) => !entry.includes("docker.sock") && !entry.includes("--privileged")
    && !entry.includes("--network=bridge") && !entry.includes("--image-src")));
  assert.equal(args.at(-1), "HIGH,CRITICAL");
  const sbom = candidateInputDockerArguments({ carrier: `aquasec/trivy@${digest}`,
    scanner: "/tmp/scanner", cache: "/tmp/cache", archive: "/tmp/private/saved.tar",
    uid: 1001, gid: 1001, format: "cyclonedx" });
  assert.ok(sbom.includes("cyclonedx"));
  assert.ok(!sbom.includes("--severity"));
  assert.ok(!sbom.includes("--scanners"));
});

test("archive input scanner rejects mutable paths, root, unpinned carriers and unknown formats", () => {
  const valid = { carrier: `aquasec/trivy@${digest}`, scanner: "/tmp/scanner", cache: "/tmp/cache",
    archive: "/tmp/private/saved.tar", uid: 1001, gid: 1001, format: "json" };
  for (const change of [
    { carrier: "aquasec/trivy:latest" }, { scanner: "./scanner" }, { archive: "/tmp/a,b" },
    { archive: "/tmp/file\nother" }, { uid: 0 }, { gid: 0 }, { format: "table" },
  ]) assert.throws(() => candidateInputDockerArguments({ ...valid, ...change }),
    /seaweed_audit_scan_arguments_invalid/u);
});

test("owned scanner container is identified and forcibly removed after a client timeout", () => {
  const runId = "35999999999"; const nonce = "f".repeat(32);
  const carrier = `aquasec/trivy@${digest}`;
  const name = `aw-seaweed-audit-${runId}-scan-json`;
  const id = "e".repeat(64); let present = false; let removed = false;
  const args = candidateInputDockerArguments({ carrier, scanner: "/tmp/scanner", cache: "/tmp/cache",
    archive: "/tmp/saved.tar", uid: 1001, gid: 1001, format: "json" });
  const owned = ownedContainerRunArguments(args, { name, nonce, runId });
  assert.deepEqual(owned.slice(0, 7), ["run", "--name", name, "--label",
    `org.auto-world.audit.run=${runId}`, "--label", `org.auto-world.audit.nonce=${nonce}`]);
  const cleanupDocker = (command) => {
    if (command[0] === "container" && command[1] === "ls") return Buffer.from(present ? `${id}\n` : "");
    if (command[0] === "container" && command[1] === "inspect") return Buffer.from(JSON.stringify({
      Id: id, Name: `/${name}`, Config: { Image: carrier,
        Labels: { "org.auto-world.audit.run": runId, "org.auto-world.audit.nonce": nonce } },
    }));
    if (command[0] === "container" && command[1] === "rm") { removed = true; present = false; return Buffer.from(id); }
    throw new Error("unexpected Docker operation");
  };
  const proofs = [];
  assert.throws(() => ownedContainerRun(args, { kind: "scan-json", carrier, runId,
    nonce, proofs, cleanupDocker, docker: () => { present = true; throw new Error("client timed out"); } }),
  /client timed out/u);
  assert.equal(removed, true);
  assert.deepEqual(proofs, [{ kind: "scan-json", state: "OWNED_CONTAINER_REMOVED" }]);
});

test("a colliding scanner container without the exact nonce is never removed", () => {
  const runId = "35999999999"; const nonce = "f".repeat(32);
  const carrier = `aquasec/trivy@${digest}`; const id = "e".repeat(64);
  const name = `aw-seaweed-audit-${runId}-db-java`; let removed = false; let present = false;
  const cleanupDocker = (command) => {
    if (command[1] === "ls") return Buffer.from(present ? `${id}\n` : "");
    if (command[1] === "inspect") return Buffer.from(JSON.stringify({ Id: id, Name: `/${name}`,
      Config: { Image: carrier, Labels: { "org.auto-world.audit.run": runId,
        "org.auto-world.audit.nonce": "0".repeat(32) } } }));
    if (command[1] === "rm") { removed = true; return Buffer.from(id); }
    throw new Error("unexpected Docker operation");
  };
  assert.throws(() => ownedContainerRun(["run", "--rm", carrier], { kind: "db-java", carrier,
    runId, nonce, proofs: [], cleanupDocker, docker: () => { present = true; } }),
  /seaweed_audit_container_cleanup_uncertain/u);
  assert.equal(removed, false);
});

test("dispatch context refuses forks, later attempts, different workflows and root execution", () => {
  const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-candidate-audit-context-")));
  try {
    const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "CleMeY15/auto-world",
      GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-candidate-audit.yml@refs/heads/main",
      GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: revision,
      GITHUB_RUN_ID: "35999999999", RUNNER_TEMP: temp };
    const host = { platform: "linux", uid: 1001, gid: 1001 };
    assert.equal(requireCandidateAuditContext(env, host).recipeRevision, revision);
    for (const change of [
      { GITHUB_REF: "refs/heads/feature" }, { GITHUB_REPOSITORY: "attacker/fork" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_WORKFLOW_REF: "attacker/fork/.github/workflows/seaweed-candidate-audit.yml@refs/heads/main" },
    ]) assert.throws(() => requireCandidateAuditContext({ ...env, ...change }, host),
      /seaweed_audit_context_invalid/u);
    assert.throws(() => requireCandidateAuditContext(env, { ...host, uid: 0 }),
      /seaweed_audit_context_invalid/u);
  } finally { rmSync(temp, { recursive: true }); }
});

test("candidate audit receipt binds the disposed exact archive without elevating its authority", () => {
  const proof = { imageId, diffId, archiveSha256: "e".repeat(64), archiveBytes: 4096 };
  const context = { runId: "35999999999", recipeRevision: revision };
  const receipt = { kind: "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1", state: "VERIFIED",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    imageExecution: "NOT_ATTEMPTED", publication: "NOT_ATTEMPTED",
    vulnerabilityAudit: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED",
    imageId, diffId, archiveSha256: proof.archiveSha256, archiveBytes: proof.archiveBytes,
    runId: context.runId, recipeRevision: context.recipeRevision };
  assert.equal(validateAuditedCandidateReceipt(receipt, proof, context), true);
  for (const change of [
    { imageId: digest }, { diffId: digest }, { archiveSha256: "f".repeat(64) },
    { archiveBytes: 4097 }, { runId: "1" }, { recipeRevision: "f".repeat(40) },
    { vulnerabilityAudit: "PASSED" }, { imageExecution: "VERIFIED_DIAGNOSTIC" },
    { candidateAuthorization: "AUTHORIZED" },
  ]) assert.throws(() => validateAuditedCandidateReceipt({ ...receipt, ...change }, proof, context),
    /seaweed_audit_candidate_receipt_invalid/u);
});

test("manual audit workflow is guarded, read-only and does not publish candidate layers", () => {
  const workflow = readFileSync(new URL("../.github/workflows/seaweed-candidate-audit.yml", import.meta.url), "utf8");
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/mu);
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read/mu);
  assert.equal((workflow.match(/test "\$GITHUB_RUN_NUMBER" = '1'/gu) ?? []).length, 2);
  assert.equal((workflow.match(/test "\$GITHUB_RUN_ATTEMPT" = '1'/gu) ?? []).length, 2);
  assert.match(workflow, /node scripts\/seaweed-image\/candidate-audit\.mjs execute/u);
  assert.match(workflow, /node scripts\/seaweed-image\/candidate-audit\.mjs cleanup/u);
  assert.doesNotMatch(workflow, /packages:|id-token:|secrets\.|docker push|docker login|pull_request:|workflow_run:/u);
  assert.doesNotMatch(workflow, /upload-artifact[^\n]*saved\.tar|path:[^\n]*candidate-work/u);
});
