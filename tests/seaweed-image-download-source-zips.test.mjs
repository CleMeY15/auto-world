import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { downloadReviewedSeaweedZips, TEST_ONLY_downloadSeaweedZips } from "../scripts/seaweed-image/download-source-zips.mjs";
import { reviewedSeaweedSourcePolicy } from "../scripts/seaweed-image/source-records.mjs";

const linux = process.platform === "linux";
const names = ["seaweed-build-1.zip", "seaweed-build-2.zip", "seaweed-artifact-gate-1.zip",
  "seaweed-artifact-gate-2.zip", "seaweed-comparison.zip"];
const contents = names.map((name) => Buffer.from(`tiny synthetic ${name}`));
const descriptors = Object.freeze(reviewedSeaweedSourcePolicy.artifacts.map((item, index) => Object.freeze({
  id: item.id, name: item.name, profile: item.profile, size: contents[index].length,
  digest: `sha256:${createHash("sha256").update(contents[index]).digest("hex")}`,
})));

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "seaweed-zips-test-"));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function fakeOrigin(changeFinal) {
  let reads = 0;
  return async () => {
    reads += 1;
    if (changeFinal && reads === 2) return changeFinal;
    return { runId: reviewedSeaweedSourcePolicy.runId, observedAt: `2026-09-23T19:00:0${reads}.000Z`, artifacts: descriptors };
  };
}

test("production entrypoint refuses source and transport injection", async () => {
  await assert.rejects(downloadReviewedSeaweedZips({ root: path.resolve(os.tmpdir()), readOrigin: fakeOrigin() }),
    { code: "seaweed_raw_zip_options_invalid" });
  await assert.rejects(downloadReviewedSeaweedZips({ root: path.resolve(os.tmpdir()), streamOne: async () => {} }),
    { code: "seaweed_raw_zip_options_invalid" });
});

test("Linux-only five-file transaction verifies saved bytes and returns no candidate authority", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const calls = [];
    let originReads = 0;
    const result = await TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: async () => { originReads += 1; return fakeOrigin()(); },
      streamOne: async ({ artifact, handle }) => {
        calls.push(artifact.id);
        await handle.writeFile(contents[calls.length - 1]);
      },
    });
    assert.equal(originReads, 2);
    assert.deepEqual(calls, descriptors.map((entry) => entry.id));
    assert.deepEqual((await readdir(root)).sort(), [...names].sort());
    assert.equal(result.state, "RAW_ZIPS_ONLY");
    assert.equal(result.authority, "PREPARATION_ONLY");
    assert.equal(result.zipValidation, "NOT_RUN");
    assert.equal(result.extraction, "NOT_RUN");
    assert.equal(result.candidateAuthorization, "NOT_AUTHORIZED");
    for (let index = 0; index < names.length; index += 1) {
      assert.deepEqual(await readFile(path.join(root, names[index])), contents[index]);
      const file = await stat(path.join(root, names[index]));
      assert.equal(file.mode & 0o777, 0o600);
      assert.equal(file.nlink, 1);
    }
  });
});

test("a failed third transfer cleans all created files and never starts later children", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const calls = [];
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(),
      streamOne: async ({ artifact, handle }) => {
        calls.push(artifact.id);
        if (calls.length === 3) throw new Error("synthetic third transfer failed");
        await handle.writeFile(contents[calls.length - 1]);
      },
    }), { code: "seaweed_raw_zip_failed" });
    assert.deepEqual(calls, descriptors.slice(0, 3).map((entry) => entry.id));
    assert.deepEqual(await readdir(root), []);
  });
});

test("final origin drift refuses all five downloaded files", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    const final = { runId: reviewedSeaweedSourcePolicy.runId,
      observedAt: "2026-09-23T19:00:03.000Z", artifacts: descriptors.map((item, index) => index === 4
        ? { ...item, digest: `sha256:${"0".repeat(64)}` } : item) };
    let index = 0;
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(final),
      streamOne: async ({ handle }) => { await handle.writeFile(contents[index]); index += 1; },
    }), { code: "seaweed_raw_zip_source_changed" });
    assert.equal(index, 5);
    assert.deepEqual(await readdir(root), []);
  });
});

test("bad root mode and pre-existing path fail without overwriting", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    await chmod(root, 0o777);
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(), streamOne: async () => { throw new Error("not reached"); },
    }), { code: "seaweed_raw_zip_root_invalid" });
    await chmod(root, 0o700);
    await writeFile(path.join(root, names[0]), "owned by someone else");
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(), streamOne: async () => { throw new Error("not reached"); },
    }), { code: "seaweed_raw_zip_root_not_empty" });
    assert.equal(await readFile(path.join(root, names[0]), "utf8"), "owned by someone else");
  });
});

test("abort and deadline during saved-file reread fail and clean owned names", { skip: !linux }, async () => {
  for (const mode of ["abort", "timeout"]) {
    await withRoot(async (root) => {
      const controller = new globalThis.AbortController();
      let clock = 0;
      const calls = [];
      await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
        readOrigin: fakeOrigin(), signal: controller.signal, timeoutMs: 130_000, now: () => clock,
        streamOne: async ({ artifact, handle }) => {
          calls.push(artifact.id);
          await handle.writeFile(contents[0]);
          const originalRead = handle.read.bind(handle);
          handle.read = async (...args) => {
            const result = await originalRead(...args);
            if (mode === "abort") controller.abort(); else clock = 10_001;
            return result;
          };
        },
      }), { code: mode === "abort" ? "seaweed_raw_zip_aborted" : "seaweed_raw_zip_timeout" });
      assert.equal(calls.length, 1);
      assert.deepEqual(await readdir(root), []);
    });
  }
});

test("replacing the root path cannot redirect held-fd downloads", { skip: !linux }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "seaweed-root-swap-test-"));
  const root = path.join(parent, "owned");
  const moved = path.join(parent, "moved");
  try {
    await mkdir(root, { mode: 0o700 });
    let index = 0;
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(),
      streamOne: async ({ handle }) => {
        await handle.writeFile(contents[index]);
        if (index === 0) { await rename(root, moved); await mkdir(root, { mode: 0o700 }); }
        index += 1;
      },
    }), { code: "seaweed_raw_zip_root_changed" });
    assert.deepEqual(await readdir(root), []);
    assert.deepEqual(await readdir(moved), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("replaced leaf is preserved and reported as cleanup uncertainty", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    let calls = 0;
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(),
      streamOne: async ({ handle }) => {
        calls += 1;
        await handle.writeFile(contents[0]);
        await rename(path.join(root, names[0]), path.join(root, "moved-original"));
        await symlink("moved-original", path.join(root, names[0]));
      },
    }), { code: "seaweed_raw_zip_cleanup_failed", originalCode: "seaweed_raw_zip_file_invalid" });
    assert.equal(calls, 1);
    assert.deepEqual((await readdir(root)).sort(), ["moved-original", names[0]].sort());
  });
});

test("a close failure rejects the transaction and cleans fixed files", { skip: !linux }, async () => {
  await withRoot(async (root) => {
    let index = 0;
    await assert.rejects(TEST_ONLY_downloadSeaweedZips({ root, expectedArtifacts: descriptors,
      readOrigin: fakeOrigin(),
      streamOne: async ({ handle }) => {
        await handle.writeFile(contents[index]);
        if (index === 0) {
          const originalClose = handle.close.bind(handle);
          handle.close = async () => { await originalClose(); throw new Error("synthetic close failure"); };
        }
        index += 1;
      },
    }), { code: "seaweed_raw_zip_close_failed" });
    assert.deepEqual(await readdir(root), []);
  });
});
