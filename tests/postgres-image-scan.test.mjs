import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFixtureTar } from "../scripts/image-import-fixture/archive.mjs";

import { candidateInputDockerArguments } from "../scripts/seaweed-image/candidate-audit.mjs";
import { authenticatePostgresCodeBundle, executePostgresScan, parsePostgresScanArguments, postgresOwnedContainerArguments,
  TEST_ONLY_copyAuthenticatedFile, TEST_ONLY_recordOperationFailure, TEST_ONLY_runOwnedContainer,
  validatePostgresDiagnosticEvidence,
  writePostgresCommandFailureEvidence } from "../scripts/postgres-image/scan.mjs";

const lockBytes = readFileSync(new URL("../infra/postgres-image/lock.json", import.meta.url));
const lock = JSON.parse(lockBytes);
const dockerfileBytes = readFileSync(new URL("../infra/postgres-image/Dockerfile", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const imageId = `sha256:${"1".repeat(64)}`;
const parentImage = `sha256:${"0".repeat(64)}`;
const baseDiffIds = [`sha256:${"2".repeat(64)}`];
const diffIds = [...baseDiffIds, `sha256:${"3".repeat(64)}`];
const archiveSha256 = "4".repeat(64);
const baseRootfsSha256 = "5".repeat(64);
const candidateRootfsSha256 = "6".repeat(64);
const nonce = "a".repeat(24);
const labels = {
  "com.auto-world.postgres-diagnostic": nonce,
  "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime",
};
const phaseNames = ["DOCKER_PREFLIGHT", "BASE_IDENTITY", "CANDIDATE_BUILD", "CANDIDATE_IDENTITY",
  "GOSU_PROBE_CREATE", "GOSU_PROBE_PROFILE", "GOSU_PROBE_RUN", "VOLUME_CREATE", "RUNTIME_ONE", "RUNTIME_TWO"];
const clone = (value) => JSON.parse(JSON.stringify(value));

function evidenceFixture() {
  const baseConfig = { Image: "", User: "", Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"],
    Env: ["PG_MAJOR=17"], Labels: { "org.opencontainers.image.source": "postgres" } };
  const candidateConfig = { Image: parentImage, Cmd: ["postgres"], Entrypoint: ["docker-entrypoint.sh"], User: "",
    Env: ["PG_MAJOR=17"], Labels: { ...baseConfig.Labels, ...labels } };
  const archiveEvidence = { artifactName: "/candidate/saved.tar", imageId, archiveSha256,
    tag: `aw-postgres-gosu:${nonce}`, configDigest: imageId, diffIds };
  return {
    receipt: {
      kind: "POSTGRES_GOSU_DIAGNOSTIC_RECEIPT_V1", state: "VERIFIED", authority: "LOCAL_DIAGNOSTIC",
      admission: "NOT_AUTHORIZED", supportStartedAt: null, vulnerabilityAudit: "NOT_ATTEMPTED",
      registryWrite: "NOT_ATTEMPTED", startedAt: "2026-09-27T10:00:00.000Z", completedAt: "2026-09-27T10:01:00.000Z",
      recipe: { revision: "8".repeat(40), lockSha256: sha256(lockBytes), dockerfileSha256: sha256(dockerfileBytes) },
      docker: clone(lock.docker), base: clone(lock.base),
      apk: { package: lock.apk.package, version: lock.apk.version, sha256: lock.apk.sha256, bytes: lock.apk.size,
        indexSha256: lock.apk.index.sha256, indexBytes: lock.apk.index.size, expectedKeys: clone(lock.apk.expectedKeys),
        versionOutput: lock.apk.versionOutput,
        verification: { index: "PASSED_DURING_OFFLINE_BUILD", package: "PASSED_DURING_OFFLINE_BUILD" } },
      candidate: { imageId, configDigest: imageId, diffIds, tag: archiveEvidence.tag,
        archive: { sha256: archiveSha256, bytes: 1234 },
        rootfs: { sha256: candidateRootfsSha256, bytes: 3456 }, additionalLabels: labels },
      archiveEvidence,
      baseExport: { imageId: lock.base.configId, diffIds: baseDiffIds,
        rootfs: { sha256: baseRootfsSha256, bytes: 2345 } },
      runtime: {
        gosu: { version: lock.apk.versionOutput, uid: lock.runtime.postgresUid, gid: lock.runtime.postgresGid,
          path: lock.runtime.gosuPath, removedPath: lock.runtime.removedPath },
        firstProcess: { uid: lock.runtime.postgresUid, gid: lock.runtime.postgresGid, executable: "/usr/local/bin/postgres" },
        secondProcess: { uid: lock.runtime.postgresUid, gid: lock.runtime.postgresGid, executable: "/usr/local/bin/postgres" },
        payloadSha256: lock.runtime.payloadSha256, profiles: 2, cleanup: "COMPLETE",
      },
      phases: phaseNames.map((name, durationMs) => ({ name, result: "PASSED", durationMs })),
    },
    baseInspect: [{ Id: lock.base.configId, Parent: "", Os: lock.base.os, Architecture: lock.base.architecture,
      RepoDigests: [`${lock.base.repository}@${lock.base.platformDigest}`], RootFS: { Layers: baseDiffIds },
      Config: baseConfig }],
    candidateInspect: [{ Id: imageId, Parent: parentImage, DockerVersion: lock.docker.serverVersion,
      Os: lock.base.os, Architecture: lock.base.architecture,
      RootFS: { Layers: diffIds }, Config: candidateConfig }],
    archiveIdentity: { path: "/private/candidate-image.tar", sha256: archiveSha256, size: 1234, cap: 1024 ** 3 },
    baseRootfsIdentity: { path: "/private/base-rootfs.tar", sha256: baseRootfsSha256, size: 2345, cap: 1024 ** 3 },
    candidateRootfsIdentity: { path: "/private/candidate-rootfs.tar", sha256: candidateRootfsSha256, size: 3456,
      cap: 1024 ** 3 },
    now: "2026-09-27T12:00:00.000Z",
  };
}

test("local scan arguments require four distinct absolute non-overlapping paths", () => {
  const parent = path.resolve(path.parse(process.cwd()).root, "aw-postgres-scan-test");
  const [diagnostic, scannerInputs, work, output] = ["diagnostic", "scanner", "work", "output"]
    .map((name) => path.join(parent, name));
  assert.deepEqual(parsePostgresScanArguments(["--diagnostic", diagnostic, "--scanner-inputs", scannerInputs,
    "--work", work, "--output", output]), {
    diagnostic, scannerInputs, work, output,
  });
  for (const argv of [
    ["--diagnostic", diagnostic, "--work", work, "--output", output],
    ["--diagnostic", "relative", "--scanner-inputs", scannerInputs, "--work", work, "--output", output],
    ["--diagnostic", parent, "--scanner-inputs", scannerInputs, "--work", work, "--output", output],
  ]) assert.throws(() => parsePostgresScanArguments(argv), /postgres_scan_arguments_invalid/u);
});

test("diagnostic evidence binds the complete builder receipt and committed PostgreSQL contract", () => {
  const fixture = evidenceFixture();
  const result = validatePostgresDiagnosticEvidence(fixture);
  assert.deepEqual(result.subject, fixture.receipt.archiveEvidence);
  for (const mutate of [
    (value) => { value.archiveIdentity.sha256 = "9".repeat(64); },
    (value) => { delete value.receipt.recipe; },
    (value) => { value.receipt.recipe.lockSha256 = "9".repeat(64); },
    (value) => { value.receipt.docker.builder = "buildkit"; },
    (value) => { value.receipt.base.platformDigest = `sha256:${"9".repeat(64)}`; },
    (value) => { value.receipt.apk.version = "1.19-r4"; },
    (value) => { value.receipt.apk.verification.package = "SKIPPED"; },
    (value) => { value.baseInspect[0].RepoDigests = [`${lock.base.repository}@${lock.base.indexDigest}`]; },
    (value) => { value.candidateInspect[0].Id = `sha256:${"9".repeat(64)}`; },
    (value) => { value.candidateInspect[0].RootFS.Layers.reverse(); },
    (value) => { value.candidateInspect[0].Config.Cmd = ["postgres", "-c", "fsync=off"]; },
    (value) => { value.candidateInspect[0].Config.Image = imageId; },
    (value) => { delete value.candidateInspect[0].Parent; },
    (value) => { value.candidateInspect[0].DockerVersion = "28.0.5"; },
    (value) => { value.candidateInspect[0].Config.Labels.foreign = "unexpected"; },
    (value) => { value.receipt.runtime.secondProcess.uid = 0; },
    (value) => { value.receipt.runtime.cleanup = "INCOMPLETE"; },
    (value) => { value.receipt.completedAt = "2026-09-27T09:59:00.000Z"; },
    (value) => { value.receipt.phases.pop(); },
    (value) => { value.receipt.phases[0].durationMs = -1; },
    (value) => { value.baseRootfsIdentity.sha256 = "9".repeat(64); },
    (value) => { value.candidateRootfsIdentity.size += 1; },
    (value) => { value.receipt.vulnerabilityAudit = "PASSED"; },
  ]) {
    const changed = clone(fixture); mutate(changed);
    assert.throws(() => validatePostgresDiagnosticEvidence(changed), /postgres_scan_diagnostic_invalid/u);
  }
});

test("diagnostic evidence rejects future and stale builder timestamps", () => {
  const future = evidenceFixture();
  future.receipt.startedAt = "2026-09-27T12:01:00.000Z";
  future.receipt.completedAt = "2026-09-27T12:02:00.000Z";
  assert.throws(() => validatePostgresDiagnosticEvidence(future), /postgres_scan_diagnostic_invalid/u);

  const stale = evidenceFixture();
  stale.receipt.startedAt = "2026-09-24T11:59:00.000Z";
  stale.receipt.completedAt = "2026-09-24T12:00:00.000Z";
  assert.throws(() => validatePostgresDiagnosticEvidence(stale), /postgres_scan_diagnostic_invalid/u);
});

test("diagnostic evidence rejects a self-consistent alternate base", () => {
  const fixture = evidenceFixture();
  const forged = `sha256:${"9".repeat(64)}`;
  fixture.receipt.base.configId = forged;
  fixture.receipt.base.platformDigest = forged;
  fixture.receipt.baseExport.imageId = forged;
  fixture.baseInspect[0].Id = forged;
  fixture.baseInspect[0].RepoDigests = [`${lock.base.repository}@${forged}`];
  assert.throws(() => validatePostgresDiagnosticEvidence(fixture), /postgres_scan_diagnostic_invalid/u);
});

test("code bundle requires a clean HEAD and exact committed import closure", () => {
  const revision = "7".repeat(40);
  const runGit = (args) => {
    if (args[0] === "rev-parse") return Buffer.from(`${revision}\n`);
    if (args[0] === "status") return Buffer.alloc(0);
    if (args[0] === "show") return readFileSync(new URL(`../${args[1].slice(41)}`, import.meta.url));
    throw new Error("unexpected_git_command");
  };
  const bundle = authenticatePostgresCodeBundle(runGit);
  assert.equal(bundle.revision, revision);
  for (const required of ["infra/postgres-image/lock.json", "infra/postgres-image/Dockerfile",
    "scripts/postgres-image/scan.mjs", "scripts/postgres-image/audit-policy.mjs",
    "scripts/scanner/audit.mjs", "scripts/scanner/audit-policy.mjs", "scripts/scanner/controls.mjs",
    "scripts/seaweed-image/candidate-audit.mjs"]) assert.ok(bundle.files.some((entry) => entry.path === required));
  assert.throws(() => authenticatePostgresCodeBundle((args) =>
    args[0] === "status" ? Buffer.from(" M scripts/postgres-image/scan.mjs\n") : runGit(args)),
  /postgres_scan_code_bundle_invalid/u);
  assert.throws(() => authenticatePostgresCodeBundle((args) =>
    args[0] === "show" && args[1].endsWith(":scripts/postgres-image/audit-policy.mjs")
      ? Buffer.from("altered") : runGit(args)), /postgres_scan_code_bundle_invalid/u);
});

test("authenticated copies are rehashed before use", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-copy-"));
  try {
    const source = path.join(directory, "source"); const destination = path.join(directory, "destination");
    const subject = path.join(directory, "scanner-subject");
    const bytes = Buffer.from("authenticated scanner bytes"); writeFileSync(source, bytes);
    const sourceIdentity = { path: source, sha256: sha256(bytes), size: bytes.length, cap: 1024 };
    const firstCopy = TEST_ONLY_copyAuthenticatedFile(source, destination, sourceIdentity, 1024, 0o444);
    assert.equal(firstCopy.sha256, sourceIdentity.sha256);
    assert.equal(TEST_ONLY_copyAuthenticatedFile(destination, subject, firstCopy, 1024, 0o555).sha256, sourceIdentity.sha256);
    rmSync(subject);
    rmSync(destination);
    assert.throws(() => TEST_ONLY_copyAuthenticatedFile(source, destination, sourceIdentity, 1024, 0o444,
      (_source, target) => writeFileSync(target, "substituted")), /postgres_scan_authenticated_copy_changed/u);
  } finally { rmSync(directory, { recursive: true }); }
});

test("a completed policy evaluation retains BLOCKED while operational failures become INCOMPLETE", () => {
  const blocked = { state: "BLOCKED" }; const policyError = new Error("postgres_scan_policy_blocked");
  policyError.policyBlocked = true;
  TEST_ONLY_recordOperationFailure(blocked, policyError);
  assert.deepEqual(blocked, { state: "BLOCKED", failure: { code: "postgres_scan_policy_blocked" } });
  const incomplete = { state: "BLOCKED" };
  TEST_ONLY_recordOperationFailure(incomplete, new Error("postgres_scan_command_failed"));
  assert.deepEqual(incomplete, { state: "INCOMPLETE", failure: { code: "postgres_scan_command_failed" } });
});

test("candidate archive scans retain the reviewed offline container profile and add owned identity", () => {
  const args = candidateInputDockerArguments({
    carrier: `aquasec/trivy@sha256:${"7".repeat(64)}`, scanner: "/private/scanner", cache: "/private/cache",
    archive: "/private/candidate-image.tar", uid: 1000, gid: 1000, format: "json",
  });
  const owned = postgresOwnedContainerArguments(args, { kind: "candidate-json", nonce: "8".repeat(32) });
  assert.deepEqual(owned.slice(0, 7), ["run", "--name", `aw-pg-scan-${"8".repeat(32)}-candidate-json`,
    "--label", `com.auto-world.postgres-scan=${"8".repeat(32)}`, "--rm", "--pull=never"]);
  for (const required of ["--network=none", "--read-only", "--cap-drop=ALL", "--skip-db-update",
    "--skip-java-db-update", "--skip-version-check", "--offline-scan", "/candidate/saved.tar"]) {
    assert.ok(owned.includes(required));
  }
  assert.equal(owned.includes("--image-src"), false);
  assert.throws(() => postgresOwnedContainerArguments(args, { kind: "foreign", nonce: "8".repeat(32) }),
    /postgres_scan_container_arguments_invalid/u);
});

test("a failed owned scan removes the exact still-running container and records the cleanup", () => {
  const id = "9".repeat(64); let active = false; let name; let owner;
  const cleanupRecords = [];
  const cleanupDocker = (args) => {
    if (args[0] === "container" && args[1] === "ls") return Buffer.from(active ? `${id}\n` : "");
    if (args[0] === "container" && args[1] === "inspect") return Buffer.from(JSON.stringify({
      Id: id, Name: `/${name}`, Config: { Labels: { "com.auto-world.postgres-scan": owner } },
    }));
    if (args[0] === "container" && args[1] === "rm") { active = false; return Buffer.from(id); }
    throw new Error("unexpected_cleanup_command");
  };
  const docker = (args) => {
    name = args[2]; owner = args[4].split("=")[1]; active = true;
    throw new Error("synthetic_scan_failure");
  };
  const args = candidateInputDockerArguments({ carrier: `aquasec/trivy@sha256:${"7".repeat(64)}`,
    scanner: "/private/scanner", cache: "/private/cache", archive: "/private/candidate-image.tar",
    uid: 1000, gid: 1000, format: "json" });
  assert.throws(() => TEST_ONLY_runOwnedContainer(args, { kind: "candidate-json", docker, cleanupDocker, cleanupRecords }),
    /synthetic_scan_failure/u);
  assert.equal(active, false);
  assert.deepEqual(cleanupRecords, [{ kind: "candidate-json", state: "OWNED_CONTAINER_REMOVED" }]);
});

test("an uncertain owned-container cleanup is a hard failure", () => {
  const id = "9".repeat(64); let name; let owner; let started = false; const cleanupRecords = [];
  const cleanupDocker = (args) => {
    if (args[0] === "container" && args[1] === "ls") return Buffer.from(started ? `${id}\n` : "");
    if (args[0] === "container" && args[1] === "inspect") return Buffer.from(JSON.stringify({
      Id: id, Name: `/${name}`, Config: { Labels: { "com.auto-world.postgres-scan": owner } },
    }));
    if (args[0] === "container" && args[1] === "rm") throw new Error("synthetic_cleanup_failure");
    throw new Error("unexpected_cleanup_command");
  };
  const docker = (args) => { name = args[2]; owner = args[4].split("=")[1]; started = true; return Buffer.alloc(0); };
  const args = candidateInputDockerArguments({ carrier: `aquasec/trivy@sha256:${"7".repeat(64)}`,
    scanner: "/private/scanner", cache: "/private/cache", archive: "/private/candidate-image.tar",
    uid: 1000, gid: 1000, format: "json" });
  assert.throws(() => TEST_ONLY_runOwnedContainer(args, { kind: "candidate-json", docker, cleanupDocker, cleanupRecords }),
    /synthetic_cleanup_failure/u);
  assert.deepEqual(cleanupRecords, [{ kind: "candidate-json", state: "CLEANUP_UNCERTAIN" }]);
});

test("failed command evidence preserves bounded stdout and stderr without command or environment context", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-command-failure-"));
  try {
    const record = writePostgresCommandFailureEvidence(directory, 1, { phase: "container-candidate-json", status: 17,
      signal: null, errorCode: null, stdout: Buffer.from("partial report"), stderr: Buffer.from("bounded failure") });
    assert.equal(readFileSync(path.join(directory, path.basename(record.stdout.file)), "utf8"), "partial report");
    assert.equal(readFileSync(path.join(directory, path.basename(record.stderr.file)), "utf8"), "bounded failure");
    assert.deepEqual(Object.keys(record).sort(), ["errorCode", "phase", "signal", "status", "stderr", "stdout"]);
    assert.equal(JSON.stringify(record).includes("GITHUB_TOKEN"), false);
  } finally { rmSync(directory, { recursive: true }); }
});

test("execution refuses non-root, non-Linux, and credential-bearing environments before filesystem access", async () => {
  const context = { diagnostic: path.resolve("diagnostic-a"), scannerInputs: path.resolve("scanner-a"),
    work: path.resolve("work-a"), output: path.resolve("output-a") };
  await assert.rejects(executePostgresScan(context, { runtime: { platform: "linux", uid: 1000, gid: 1000 }, environment: {} }),
    /postgres_scan_requires_linux_root/u);
  await assert.rejects(executePostgresScan(context, { runtime: { platform: "linux", uid: 0, gid: 0 },
    environment: { GITHUB_TOKEN: "not-recorded" } }), /postgres_scan_auth_environment_refused/u);
});

test("the native filesystem gate rejects unrelated rootfs content before scanner authentication or Docker", {
  skip: process.platform !== "linux" ? "private directory ownership gate requires Linux" : false,
}, async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-pg-filesystem-gate-")));
  const context = Object.fromEntries(["diagnostic", "scannerInputs", "work", "output"].map((name) => [name, path.join(root, name)]));
  try {
    for (const directory of [context.diagnostic, context.scannerInputs]) {
      mkdirSync(directory, { mode: 0o700 }); chmodSync(directory, 0o700);
    }
    const value = evidenceFixture(); const tar = buildFixtureTar(); const digest = sha256(tar);
    const identity = { sha256: digest, bytes: tar.length };
    value.receipt.candidate.archive = clone(identity); value.receipt.candidate.rootfs = clone(identity);
    value.receipt.baseExport.rootfs = clone(identity); value.receipt.archiveEvidence.archiveSha256 = digest;
    value.receipt.startedAt = new Date(Date.now() - 60_000).toISOString();
    value.receipt.completedAt = new Date(Date.now() - 30_000).toISOString();
    for (const name of ["candidate-image.tar", "base-rootfs.tar", "candidate-rootfs.tar"]) {
      writeFileSync(path.join(context.diagnostic, name), tar, { mode: 0o600 });
    }
    for (const [name, data] of [["receipt.json", value.receipt], ["base-inspect.json", value.baseInspect],
      ["candidate-inspect.json", value.candidateInspect]]) {
      writeFileSync(path.join(context.diagnostic, name), JSON.stringify(data), { mode: 0o600 });
    }
    let scannerCalls = 0; let dockerCalls = 0;
    const codeFile = path.join(context.diagnostic, "receipt.json"); const codeBytes = readFileSync(codeFile);
    const codeSnapshot = { path: codeFile, sha256: sha256(codeBytes), size: codeBytes.length, cap: 4 * 1024 ** 2 };
    await assert.rejects(executePostgresScan(context, { runtime: { platform: "linux", uid: 0, gid: 0 }, environment: {},
      codeBundle: () => ({ revision: "8".repeat(40), files: [codeSnapshot], snapshots: [codeSnapshot] }),
      scannerPair: () => { scannerCalls += 1; throw new Error("scanner_reached"); },
      command: () => { dockerCalls += 1; throw new Error("docker_reached"); },
    }), /postgres_gosu_filesystem_policy_invalid/u);
    assert.equal(scannerCalls, 0); assert.equal(dockerCalls, 0);
    const receipt = JSON.parse(readFileSync(path.join(context.output, "audit-receipt.json")));
    assert.equal(receipt.phase, "FILESYSTEM_DELTA"); assert.equal(receipt.state, "INCOMPLETE");
    assert.equal(receipt.workCleanup, "COMPLETE"); assert.equal(existsSync(context.work), false);
  } finally { rmSync(root, { recursive: true }); }
});
