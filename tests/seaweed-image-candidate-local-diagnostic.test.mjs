import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLocalEvidence, requirePrivateLocalDirectory, runLocalDiagnostic }
  from "../scripts/seaweed-image/candidate-local-diagnostic.mjs";

const linux = process.platform === "linux";
test("local diagnostic rejects unrecognized commands before reading inputs", async () => {
  for (const argv of [[], ["pull"], ["restore"], ["retain", "/tmp", "unexpected"],
    ["restore", "/tmp", "/tmp", "unexpected"]]) {
    await assert.rejects(runLocalDiagnostic(argv), /seaweed_local_diagnostic_input_invalid/u);
  }
});

test("private local evidence reads exact bytes and refuses foreign node types or permissions", { skip: !linux }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-local-evidence-"));
  chmodSync(directory, 0o700);
  try {
    assert.equal(requirePrivateLocalDirectory(directory), directory);
    const file = path.join(directory, "receipt.json");
    const bytes = Buffer.from('{"fixed":"evidence"}\n');
    writeFileSync(file, bytes, { mode: 0o600 });
    assert.deepEqual(readLocalEvidence(file, 1024), bytes);
    assert.throws(() => readLocalEvidence(file, 2), /input_invalid/u);
    const alias = path.join(directory, "alias");
    symlinkSync(file, alias);
    assert.throws(() => readLocalEvidence(alias, 1024), /input_invalid/u);
    rmSync(alias);
    linkSync(file, alias);
    assert.throws(() => readLocalEvidence(file, 1024), /input_invalid/u);
    rmSync(alias);
    chmodSync(file, 0o644);
    assert.throws(() => readLocalEvidence(file, 1024), /input_invalid/u);
    chmodSync(file, 0o600);
    chmodSync(directory, 0o755);
    assert.throws(() => readLocalEvidence(file, 1024), /input_invalid/u);
    assert.deepEqual(readFileSync(file), bytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("local diagnostic cannot execute inside a GitHub workflow", async () => {
  const previous = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "true";
  try {
    await assert.rejects(runLocalDiagnostic(["retain", "/tmp"]), /seaweed_local_diagnostic_input_invalid/u);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
  }
});

test("CLI wires committed policy and in-memory retention credential, then offline evidence and durable receipt", { skip: !linux }, async () => {
  const environment = Object.fromEntries(["GITHUB_ACTIONS", "GH_TOKEN", "GITHUB_TOKEN"].map((key) => [key, process.env[key]]));
  for (const key of Object.keys(environment)) delete process.env[key];
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-local-cli-"));
  const policy = JSON.parse(readFileSync(new URL("../infra/seaweed-image/candidate-remote.json", import.meta.url)));
  const name = `seaweed-candidate-${policy.manifest.digest.replace(":", "-")}`;
  const directory = path.join(root, name); mkdirSync(directory, { mode: 0o700 });
  const revision = "a".repeat(40); const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === "status") return "";
    if (args[0] === "rev-parse") return revision;
    assert.equal(args[0], "show");
    assert.ok(args[1].startsWith("HEAD:infra/seaweed-image/"));
    return readFileSync(new URL(`../${args[1].slice(5)}`, import.meta.url));
  };
  try {
    const expected = { origin: "LOCAL_DIAGNOSTIC", state: "RETAINED" };
    assert.deepEqual(await runLocalDiagnostic(["retain", directory], { git,
      readToken: async () => "local-test-credential",
      retain: async (input, dependencies) => {
        assert.deepEqual(input.policy, policy);
        assert.equal(input.recipeRevision, revision);
        assert.equal(dependencies.providerDependencies.env.GITHUB_TOKEN, "local-test-credential");
        assert.equal(dependencies.providerDependencies.env.DOCKER_HOST, "unix:///var/run/docker.sock");
        assert.doesNotMatch(JSON.stringify(input), /local-test-credential/u);
        return { receipt: expected };
      } }), expected);
    const material = JSON.parse(readFileSync(new URL("../infra/seaweed-image/candidate-remote-audit-receipt.json", import.meta.url))).candidate;
    const retained = { kind: "SEAWEED_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1", state: "RETAINED",
      authority: "LOCAL_DIAGNOSTIC", origin: "LOCAL_DIAGNOSTIC", executionId: `local-${material.runId}`,
      githubRunId: null, candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
      signing: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", runId: material.runId,
      recipeRevision: material.recipeRevision, subject: policy.subject, imageId: policy.candidate.imageId,
      diffId: policy.candidate.diffId, remoteMaterialReceipt: material,
      phases: ["private_archive_copy", "retained_archive_validation", "remote_cleanup"].map((name) =>
        ({ name, result: "PASSED", durationMs: 0 })),
      archiveProof: { kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", authority: "PREPARATION_ONLY",
        candidateAuthorization: "NOT_AUTHORIZED", imageId: policy.candidate.imageId, identityType: "CLASSIC_CONFIG_ID",
        tag: material.alias, serverVersion: "28.0.4", archiveSha256: material.archive.archiveSha256,
        archiveBytes: material.archive.archiveBytes, archiveMembers: 10, configSha256: policy.source.configSha256,
        configBytes: policy.source.configBytes, layerSha256: policy.source.savedLayerSha256,
        layerBytes: policy.source.savedLayerBytes, diffId: policy.candidate.diffId,
        rawSize: policy.candidate.rawSize, memberCount: policy.candidate.memberCount } };
    writeFileSync(path.join(directory, "image", "retention-receipt.json"), JSON.stringify(retained), { mode: 0o600 });
    const audit = path.join(root, "audit"); mkdirSync(audit, { mode: 0o700 });
    for (const name of ["audit-receipt.json", "candidate-vulnerabilities.json", "candidate-sbom.cdx.json",
      "database-evidence.json", ...["vulnerability", "java"].flatMap((db) => ["before", "after"].map((at) =>
        `database-${db}-${at}-manifest.json`))]) writeFileSync(path.join(audit, name), "{}", { mode: 0o600 });
    const complete = { state: "VERIFIED", origin: "LOCAL_DIAGNOSTIC" };
    const restore = async (input) => {
      assert.equal(input.archiveSha256, material.archive.archiveSha256);
      assert.equal(input.runtimeReceipt.runId, "36331678311");
      assert.equal(input.auditEvidence.receiptBytes.toString(), "{}");
      assert.equal(input.recipeRevision, revision);
      assert.doesNotMatch(JSON.stringify(input), /local-test-credential/u);
      return complete;
    };
    assert.deepEqual(await runLocalDiagnostic(["restore", directory, audit], { git, restore }), complete);
    assert.deepEqual(JSON.parse(readLocalEvidence(path.join(directory, "restore-receipt.json"), 1024)), complete);
    await assert.rejects(runLocalDiagnostic(["restore", directory, audit], { git,
      restore: async () => assert.fail("must not overwrite or execute twice") }));
    assert.ok(calls.some((args) => args[1] === "HEAD:infra/seaweed-image/candidate-publication-receipt.json"));
    await assert.rejects(runLocalDiagnostic(["retain", directory], { git: () => "dirty", readToken: async () => {
      assert.fail("dirty checkout must fail before reading credentials");
    } }));
  } finally {
    rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
