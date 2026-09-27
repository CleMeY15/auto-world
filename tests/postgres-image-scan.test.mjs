import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateInputDockerArguments } from "../scripts/seaweed-image/candidate-audit.mjs";
import { executePostgresScan, parsePostgresScanArguments, postgresOwnedContainerArguments,
  TEST_ONLY_runOwnedContainer, validatePostgresDiagnosticEvidence,
  writePostgresCommandFailureEvidence } from "../scripts/postgres-image/scan.mjs";

const imageId = `sha256:${"1".repeat(64)}`;
const diffIds = [`sha256:${"2".repeat(64)}`, `sha256:${"3".repeat(64)}`];
const archiveSha256 = "4".repeat(64);
const nonce = "a".repeat(24);
const labels = {
  "com.auto-world.postgres-diagnostic": nonce,
  "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime",
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function evidenceFixture() {
  const baseConfig = { User: "", Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"],
    Env: ["PG_MAJOR=17"], Labels: { "org.opencontainers.image.source": "postgres" } };
  const candidateConfig = { Cmd: ["postgres"], Entrypoint: ["docker-entrypoint.sh"], User: "",
    Env: ["PG_MAJOR=17"], Labels: { ...baseConfig.Labels, ...labels } };
  const archiveEvidence = { artifactName: "/candidate/saved.tar", imageId, archiveSha256,
    tag: `aw-postgres-gosu:${nonce}`, configDigest: imageId, diffIds };
  return {
    receipt: {
      kind: "POSTGRES_GOSU_DIAGNOSTIC_RECEIPT_V1", state: "VERIFIED", authority: "LOCAL_DIAGNOSTIC",
      admission: "NOT_AUTHORIZED", supportStartedAt: null, vulnerabilityAudit: "NOT_ATTEMPTED",
      registryWrite: "NOT_ATTEMPTED",
      candidate: { imageId, configDigest: imageId, diffIds, tag: archiveEvidence.tag,
        archive: { sha256: archiveSha256, bytes: 1234 }, additionalLabels: labels },
      archiveEvidence, baseExport: { imageId: `sha256:${"5".repeat(64)}`,
        diffIds: [`sha256:${"6".repeat(64)}`] },
    },
    baseInspect: [{ Id: `sha256:${"5".repeat(64)}`, RootFS: { Layers: [`sha256:${"6".repeat(64)}`] },
      Config: baseConfig }],
    candidateInspect: [{ Id: imageId, RootFS: { Layers: diffIds }, Config: candidateConfig }],
    archiveIdentity: { path: "/private/candidate-image.tar", sha256: archiveSha256, size: 1234, cap: 1024 ** 3 },
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

test("diagnostic evidence binds exact archive, config ID, DiffIDs, labels, and unchanged runtime config", () => {
  const fixture = evidenceFixture();
  const result = validatePostgresDiagnosticEvidence(fixture);
  assert.deepEqual(result.subject, fixture.receipt.archiveEvidence);
  for (const mutate of [
    (value) => { value.archiveIdentity.sha256 = "9".repeat(64); },
    (value) => { value.candidateInspect[0].Id = `sha256:${"9".repeat(64)}`; },
    (value) => { value.candidateInspect[0].RootFS.Layers.reverse(); },
    (value) => { value.candidateInspect[0].Config.Cmd = ["postgres", "-c", "fsync=off"]; },
    (value) => { value.candidateInspect[0].Config.Labels.foreign = "unexpected"; },
    (value) => { value.receipt.vulnerabilityAudit = "PASSED"; },
  ]) {
    const changed = clone(fixture); mutate(changed);
    assert.throws(() => validatePostgresDiagnosticEvidence(changed), /postgres_scan_diagnostic_invalid/u);
  }
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
