import assert from "node:assert/strict";
import {
  chmodSync, close, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { finished } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { comparisonReceiptBytes } from "../scripts/seaweed/compare.mjs";
import {
  cleanupMaterializedSeaweedSource, materializeReviewedSeaweedSource, TEST_ONLY_materializeSeaweedSource,
} from "../scripts/seaweed-image/materialize-source-zips.mjs";

const linux = process.platform === "linux";
const names = ["seaweed-build-1", "seaweed-build-2", "seaweed-artifact-gate-1", "seaweed-artifact-gate-2", "seaweed-comparison"];
const profiles = ["build", "build", "gate-1", "gate-2", "comparison"];
const comparison = { schemaVersion: 2, state: "DIAGNOSTIC_ONLY", result: "PASSED",
  compared: [{ path: "weed", sha256: "a".repeat(64), size: 4 }] };

function origin(artifacts) {
  return { repository: "CleMeY15/auto-world", workflowId: 1, sourceSha: "b".repeat(40), runId: 123, attempt: 1,
    observedAt: "2026-09-23T00:00:00.000Z", artifacts };
}

function statIdentity(file) {
  const stat = lstatSync(file, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString(), uid: Number(stat.uid), mode: Number(stat.mode & 0o777n) };
}

function fixture({ mutateGate = false, mutateComparison = false, unknown = false, validateError = false } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-source-materialization-")); chmodSync(parent, 0o700);
  const artifacts = names.map((name, index) => ({ id: 100 + index, name, size: 1, digest: `sha256:${String(index).repeat(64)}`,
    profile: profiles[index] }));
  const validate = (directory) => {
    if (validateError) throw new Error("seaweed_synthetic_validation_failed");
    assert.equal(readFileSync(path.join(directory, "weed"), "utf8"), "weed");
    return { result: "PASSED", totalBytes: path.basename(directory).endsWith("1") ? 111 : 222 };
  };
  const compare = (first, second, expected) => {
    assert.equal(path.basename(first), "seaweed-build-1"); assert.equal(path.basename(second), "seaweed-build-2");
    assert.deepEqual(expected, { repository: "CleMeY15/auto-world", ref: "refs/heads/main", codeSha: "b".repeat(40), runId: "123", attempt: "1" });
    return comparison;
  };
  const download = async ({ root }) => {
    const files = artifacts.map((artifact) => {
      const file = path.join(root, `${artifact.name}.zip`); writeFileSync(file, "x", { mode: 0o600 }); chmodSync(file, 0o600);
      return { id: artifact.id, githubName: artifact.name, name: `${artifact.name}.zip`, path: file,
        profile: artifact.profile, size: artifact.size, digest: artifact.digest, identity: statIdentity(file) };
    });
    return { ...origin(artifacts), files };
  };
  const scanOne = async ({ descriptor, openEntrySink, root }) => {
    let entry; let bytes;
    if (descriptor.profile === "build") {
      for (const [buildEntry, buildBytes] of [
        [{ path: "weed", mode: 0o100755 }, Buffer.from("weed")],
        [{ path: "materials/modules/x/file", mode: 0o100644 }, Buffer.from("nested")],
      ]) {
        const sink = openEntrySink(buildEntry, {}); sink.end(buildBytes); await finished(sink);
      }
      return { entryCount: 2, rawSize: 10 };
    }
    else if (descriptor.profile === "gate-1" || descriptor.profile === "gate-2") {
      const repeat = descriptor.profile === "gate-1" ? 1 : 2; const totalBytes = repeat === 1 ? 111 : 222;
      entry = { path: `seaweed-artifact-gate-${repeat}.json`, mode: 0o100644 };
      bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "PASSED", repeat,
        buildResult: "PASSED", totalBytes }, null, 2)}\n`);
      if (mutateGate && repeat === 2) bytes = Buffer.concat([bytes, Buffer.from(" ")]);
    } else {
      entry = { path: "seaweed-comparison.json", mode: 0o100644 };
      bytes = comparisonReceiptBytes(comparison);
      if (mutateComparison) bytes = Buffer.from(`${JSON.stringify(comparison, null, 2)}\n`);
    }
    const sink = openEntrySink(entry, {}); sink.end(bytes); await finished(sink);
    if (unknown && descriptor.profile === "comparison") writeFileSync(path.join(path.dirname(root), "unknown"), "x");
    return { entryCount: 1, rawSize: bytes.length };
  };
  return { parent, options: { parent, platform: "linux", uid: process.getuid(), expectedArtifacts: artifacts,
    download, scanOne, readOrigin: async () => origin(artifacts), requireOrigin: () => {}, validate, compare } };
}

test("production API rejects injected authority", async () => {
  await assert.rejects(materializeReviewedSeaweedSource({ parent: path.resolve(os.tmpdir()), download: async () => {} }),
    /seaweed_source_materialization_options_invalid/u);
});

test("materializes, verifies exact native receipts, retains raw ZIPs, and cleans only through live authority", { skip: !linux }, async () => {
  const scope = fixture();
  try {
    const result = await TEST_ONLY_materializeSeaweedSource(scope.options);
    assert.equal(result.authority, "PREPARATION_ONLY"); assert.equal(result.candidateAuthorization, "NOT_AUTHORIZED");
    assert.deepEqual(result.buildBytes, [111, 222]); assert.equal(result.comparedEntries, 1);
    assert.deepEqual(readFileSync(path.join(result.outputPath, "seaweed-build-1/weed")), Buffer.from("weed"));
    assert.equal(readFileSync(path.join(result.outputPath, "seaweed-build-1/materials/modules/x/file"), "utf8"), "nested");
    assert.equal(lstatSync(path.join(result.outputPath, "seaweed-build-1/weed")).mode & 0o777, 0o755);
    assert.equal(lstatSync(path.join(result.outputPath, ".raw/seaweed-build-1.zip")).mode & 0o777, 0o600);
    await assert.rejects(cleanupMaterializedSeaweedSource({ ...result }), /cleanup_unauthorized/u);
    assert.equal((await cleanupMaterializedSeaweedSource(result)).state, "CLEANED");
    assert.deepEqual(readdirSync(scope.parent), []);
    await assert.rejects(cleanupMaterializedSeaweedSource(result), /cleanup_unauthorized/u);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

for (const [label, mutation, code] of [
  ["gate bytes", { mutateGate: true }, "gate_invalid"],
  ["comparison bytes", { mutateComparison: true }, "comparison_invalid"],
]) test(`rejects changed ${label} and cleans owned staging`, { skip: !linux }, async () => {
  const scope = fixture(mutation);
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), new RegExp(code, "u"));
    assert.deepEqual(readdirSync(scope.parent), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("refuses to erase an unknown same-uid entry after failure", { skip: !linux }, async () => {
  const scope = fixture({ unknown: true, validateError: true });
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), /cleanup_failed/u);
    assert.equal(readFileSync(path.join(scope.parent, ".seaweed-source-materialization-staging/unknown"), "utf8"), "x");
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("refuses cleanup after a promoted file identity changes", { skip: !linux }, async () => {
  const scope = fixture();
  try {
    const result = await TEST_ONLY_materializeSeaweedSource(scope.options);
    writeFileSync(path.join(result.outputPath, "seaweed-build-1/weed"), "changed");
    await assert.rejects(cleanupMaterializedSeaweedSource(result), /cleanup_failed/u);
    assert.equal(readFileSync(path.join(result.outputPath, "seaweed-build-1/weed"), "utf8"), "changed");
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("rejects final authenticated origin drift and cleans only owned staging", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.readOrigin = async () => ({ ...origin(scope.options.expectedArtifacts), sourceSha: "c".repeat(40) });
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), /origin_changed/u);
    assert.deepEqual(readdirSync(scope.parent), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("preserves lower-layer cleanup uncertainty without traversing the staging tree", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.download = async ({ root }) => {
    writeFileSync(path.join(root, "foreign-sentinel"), "preserve");
    throw Object.assign(new Error("seaweed_raw_zip_cleanup_failed"), { code: "seaweed_raw_zip_cleanup_failed" });
  };
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), (error) => {
      assert.equal(error.code, "seaweed_source_materialization_cleanup_failed");
      assert.equal(error.originalCode, "seaweed_raw_zip_cleanup_failed");
      return true;
    });
    assert.equal(readFileSync(path.join(scope.parent, ".seaweed-source-materialization-staging/.raw/foreign-sentinel"), "utf8"), "preserve");
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("preserves a bounded ZIP reader message as scanCode and cleans owned staging", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.scanOne = async () => { throw new Error("seaweed_artifact_zip_owned_platform_invalid"); };
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), (error) => {
      assert.equal(error.code, "seaweed_source_materialization_zip_invalid");
      assert.equal(error.scanCode, "seaweed_artifact_zip_owned_platform_invalid");
      return true;
    });
    assert.deepEqual(readdirSync(scope.parent), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("preserves a bounded downloader message as downloadCode and cleans owned staging", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.download = async () => { throw new Error("seaweed_raw_zip_request_failed"); };
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), (error) => {
      assert.equal(error.code, "seaweed_source_materialization_download_failed");
      assert.equal(error.downloadCode, "seaweed_raw_zip_request_failed");
      return true;
    });
    assert.deepEqual(readdirSync(scope.parent), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("preserves an empty destination collision and removes only its owned staging", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.beforeRename = async ({ outputPath }) => { mkdirSync(outputPath, { mode: 0o700 }); };
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), /cleanup_failed/u);
    assert.deepEqual(readdirSync(scope.parent), ["seaweed-source-materialized"]);
    assert.deepEqual(readdirSync(path.join(scope.parent, "seaweed-source-materialized")), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("preserves post-rename mutation rather than minting success or deleting it", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.afterRename = async ({ outputPath }) => { writeFileSync(path.join(outputPath, "seaweed-build-1/weed"), "mutated"); };
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), /cleanup_failed/u);
    assert.equal(readFileSync(path.join(scope.parent, "seaweed-source-materialized/seaweed-build-1/weed"), "utf8"), "mutated");
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("rejects a post-rename root swap without traversing the replacement", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.afterRename = async ({ parent, outputPath }) => {
    const moved = path.join(parent, "moved-owned-tree"); renameSync(outputPath, moved); symlinkSync(moved, outputPath, "dir");
  };
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), /cleanup_failed/u);
    assert.equal(lstatSync(path.join(scope.parent, "seaweed-source-materialized")).isSymbolicLink(), true);
    assert.equal(readFileSync(path.join(scope.parent, "moved-owned-tree/seaweed-build-1/weed"), "utf8"), "weed");
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("sink fsync failure closes the leaf and cleans the fully tracked staging tree", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.syncFile = (_fd, callback) => callback(new Error("synthetic_fsync_failure"));
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), (error) => {
      assert.equal(error.code, "seaweed_source_materialization_sink_failed");
      assert.equal(error.originalCode, "seaweed_source_materialization_sink_sync_failed");
      return true;
    });
    assert.deepEqual(readdirSync(scope.parent), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("sink close failure is surfaced only after the descriptor closes and owned staging is cleaned", { skip: !linux }, async () => {
  const scope = fixture();
  scope.options.closeFile = (fd, callback) => close(fd, (error) => callback(error ?? new Error("synthetic_close_failure")));
  try {
    await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), (error) => {
      assert.equal(error.code, "seaweed_source_materialization_sink_failed");
      assert.equal(error.originalCode, "seaweed_source_materialization_sink_close_failed");
      return true;
    });
    assert.deepEqual(readdirSync(scope.parent), []);
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

for (const [boundary, rejectCall] of [["before rename", 2], ["before receipt", 3]]) {
  test(`revalidates private source-origin brand ${boundary}`, { skip: !linux }, async () => {
    const scope = fixture(); let calls = 0;
    scope.options.requireOrigin = () => {
      calls += 1;
      if (calls === rejectCall) throw Object.assign(new Error("seaweed_source_origin_not_authenticated"),
        { code: "seaweed_source_origin_not_authenticated" });
    };
    try {
      await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), (error) => {
        assert.equal(error.code, "seaweed_source_materialization_origin_invalid");
        assert.equal(error.originCode, "seaweed_source_origin_not_authenticated");
        return true;
      });
      assert.equal(calls, rejectCall);
      assert.deepEqual(readdirSync(scope.parent), []);
    } finally { rmSync(scope.parent, { recursive: true, force: true }); }
  });
}

test("cleanup rejects a new hardlink without removing either name", { skip: !linux }, async () => {
  const scope = fixture();
  try {
    const result = await TEST_ONLY_materializeSeaweedSource(scope.options);
    const leaf = path.join(result.outputPath, "seaweed-build-1/weed"); const hardlink = path.join(scope.parent, "external-hardlink");
    linkSync(leaf, hardlink);
    await assert.rejects(cleanupMaterializedSeaweedSource(result), /cleanup_failed/u);
    assert.equal(readFileSync(leaf, "utf8"), "weed"); assert.equal(readFileSync(hardlink, "utf8"), "weed");
  } finally { rmSync(scope.parent, { recursive: true, force: true }); }
});

test("pre-abort and expired cooperative deadline create no materialization", { skip: !linux }, async () => {
  for (const expired of [false, true]) {
    const scope = fixture(); const controller = new globalThis.AbortController();
    if (!expired) controller.abort();
    if (expired) { let calls = 0; scope.options.now = () => calls++ === 0 ? 0 : 9_999_999; }
    else scope.options.signal = controller.signal;
    try {
      await assert.rejects(TEST_ONLY_materializeSeaweedSource(scope.options), expired ? /timeout/u : /aborted/u);
      assert.deepEqual(readdirSync(scope.parent), []);
    } finally { rmSync(scope.parent, { recursive: true, force: true }); }
  }
});
