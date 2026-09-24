import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanReviewedSeaweedSourceZips, TEST_ONLY_scanReviewedSeaweedSourceZips } from "../scripts/seaweed-image/scan-source-zips.mjs";
import { reviewedSeaweedSourcePolicy } from "../scripts/seaweed-image/source-records.mjs";

const linux = process.platform === "linux";
const names = ["seaweed-build-1.zip", "seaweed-build-2.zip", "seaweed-artifact-gate-1.zip",
  "seaweed-artifact-gate-2.zip", "seaweed-comparison.zip"];
const bytes = names.map((name) => Buffer.from(`synthetic structural ${name}`));
const artifacts = reviewedSeaweedSourcePolicy.artifacts.map((item, index) => Object.freeze({ ...item,
  size: bytes[index].length, digest: `sha256:${createHash("sha256").update(bytes[index]).digest("hex")}` }));

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "seaweed-structural-test-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function origin(artifactsOverride = artifacts) {
  return { repository: reviewedSeaweedSourcePolicy.repository, workflowId: reviewedSeaweedSourcePolicy.workflowId,
    sourceSha: reviewedSeaweedSourcePolicy.sourceSha, runId: reviewedSeaweedSourcePolicy.runId,
    attempt: 1, observedAt: "2026-09-23T20:00:00.000Z", artifacts: artifactsOverride };
}

function fixture(overrides = {}) {
  const calls = [];
  const download = async ({ root }) => {
    const files = [];
    for (let index = 0; index < names.length; index += 1) {
      const file = path.join(root, names[index]);
      await writeFile(file, bytes[index], { flag: "wx", mode: 0o600 });
      const item = await stat(file, { bigint: true });
      files.push({ id: artifacts[index].id, githubName: artifacts[index].name, name: names[index],
        path: file, profile: artifacts[index].profile, size: artifacts[index].size,
        digest: artifacts[index].digest, identity: { dev: item.dev.toString(), ino: item.ino.toString(),
          uid: Number(item.uid), mode: Number(item.mode & 0o777n) } });
    }
    return { originBefore: "2026-09-23T19:59:00.000Z", files };
  };
  const scanOne = async ({ descriptor, profile }) => {
    calls.push(profile);
    const entry = { ordinal: 0, path: profile === "build" ? "weed" : `${profile}.json`,
      mode: profile === "build" ? 0o100755 : 0o100644, method: profile === "build" ? 0 : 8,
      crc32: 0, compressedSize: 1, rawSize: 1, sha256: "0".repeat(64) };
    return { profile, zipSize: descriptor.size, zipDigest: descriptor.digest,
      entryCount: 1, rawSize: 1, entries: [entry] };
  };
  return { calls, options: { expectedArtifacts: artifacts, download, scanOne,
    readOrigin: async () => origin(), ...overrides } };
}

test("production structural scan refuses dependency injection before network access", async () => {
  await assert.rejects(scanReviewedSeaweedSourceZips({ root: path.resolve(os.tmpdir()),
    readOrigin: async () => origin() }), { code: "seaweed_source_zip_scan_options_invalid" });
});

test("five fixed ZIP profiles scan and clean with bounded non-authoritative result", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const { calls, options } = fixture();
    const result = await TEST_ONLY_scanReviewedSeaweedSourceZips({ root, ...options });
    assert.deepEqual(calls, ["build", "build", "gate-1", "gate-2", "comparison"]);
    assert.deepEqual(await readdir(root), []);
    assert.equal(result.state, "ZIP_STRUCTURAL_ONLY");
    assert.equal(result.authority, "PREPARATION_ONLY");
    assert.equal(result.materialValidation, "NOT_RUN");
    assert.equal(result.candidateAuthorization, "NOT_AUTHORIZED");
    assert.equal(result.artifacts.length, 5);
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(JSON.stringify(result).includes("entries"), false);
  });
});

test("scanner failure stops later artifacts and removes only owned raw files", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const { calls, options } = fixture();
    const scanOne = async (input) => {
      if (calls.length === 2) throw new Error("bad zip");
      return options.scanOne(input);
    };
    await assert.rejects(TEST_ONLY_scanReviewedSeaweedSourceZips({ root, ...options, scanOne }));
    assert.equal(calls.length, 2);
    assert.deepEqual(await readdir(root), []);
  });
});

test("final GitHub origin drift rejects the completed scan and cleans files", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const { options } = fixture({ readOrigin: async () => origin(artifacts.map((item, index) => index === 4
      ? { ...item, digest: `sha256:${"0".repeat(64)}` } : item)) });
    await assert.rejects(TEST_ONLY_scanReviewedSeaweedSourceZips({ root, ...options }));
    assert.deepEqual(await readdir(root), []);
  });
});

test("abort and aggregate deadline stop further scans and clean owned files", { skip: !linux }, async () => {
  for (const mode of ["abort", "timeout"]) {
    await withRoot(async (root) => {
      const controller = new globalThis.AbortController();
      const { calls, options } = fixture();
      let clock = 0;
      const scanOne = async (input) => {
        const result = await options.scanOne(input);
        if (mode === "abort") controller.abort(); else clock = 11_000;
        return result;
      };
      await assert.rejects(TEST_ONLY_scanReviewedSeaweedSourceZips({ root, ...options, scanOne,
        signal: controller.signal, timeoutMs: 130_000, now: () => clock }),
      { code: mode === "abort" ? "seaweed_source_zip_scan_aborted" : "seaweed_source_zip_scan_timeout" });
      assert.equal(calls.length, 1);
      assert.deepEqual(await readdir(root), []);
    });
  }
});

test("root-path swap is detected while cleanup stays on the held original directory", { skip: !linux }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "seaweed-structural-root-swap-"));
  const root = path.join(parent, "owned");
  const moved = path.join(parent, "moved");
  try {
    await mkdir(root, { mode: 0o700 });
    const { options } = fixture();
    let scans = 0;
    const scanOne = async (input) => {
      scans += 1;
      if (scans === 1) {
        await rename(root, moved);
        await mkdir(root, { mode: 0o700 });
      }
      return options.scanOne(input);
    };
    await assert.rejects(TEST_ONLY_scanReviewedSeaweedSourceZips({ root, ...options, scanOne }));
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await readdir(moved), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("unexpected leaf replacement suppresses receipt and preserves the replacement", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const { options } = fixture();
    let calls = 0;
    const scanOne = async (input) => {
      calls += 1;
      if (calls === 1) {
        const target = path.join(root, names[0]);
        await rm(target);
        await symlink("not-owned", target);
      }
      return options.scanOne(input);
    };
    await assert.rejects(TEST_ONLY_scanReviewedSeaweedSourceZips({ root, ...options, scanOne }),
      { code: "seaweed_source_zip_scan_cleanup_failed" });
    assert.ok((await readdir(root)).includes(names[0]));
  });
});
