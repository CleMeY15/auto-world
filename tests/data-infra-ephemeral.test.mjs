import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discardTestProject, withRawScratch } from "../scripts/data-infra/ephemeral.mjs";
import { withCancellation } from "../scripts/data-infra/cancellation.mjs";

test("raw scratch is removed after successful readback, error and cooperative cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aw-scratch-test-"));
  const state = { dir, ownerToken: "synthetic-test-owner" };
  try {
    const value = await withRawScratch(state, async (directory) => {
      await writeFile(join(directory, "input.bin"), "synthetic raw");
      await writeFile(join(directory, "output.bin"), "synthetic raw");
      return readFile(join(directory, "output.bin"), "utf8");
    });
    assert.equal(value, "synthetic raw");
    assert.deepEqual(await readdir(join(dir, "helpers")), []);
    await assert.rejects(withRawScratch(state, async (directory) => {
      await writeFile(join(directory, "input.bin"), "synthetic raw");
      throw new Error("simulated_transport_timeout");
    }), /simulated_transport_timeout/u);
    assert.deepEqual(await readdir(join(dir, "helpers")), []);
    await withCancellation(async () => {
      await assert.rejects(withRawScratch(state, async (directory) => {
        await writeFile(join(directory, "output.bin"), "synthetic raw");
        process.emit("SIGINT");
        throw new Error("simulated_cancellation");
      }), /simulated_cancellation/u);
    });
    assert.deepEqual(await readdir(join(dir, "helpers")), []);
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), "aw-scratch-test-")));
    await rm(dir, { recursive: true });
  }
});

test("raw cleanup refuses unexpected files instead of deleting unrecognized data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aw-scratch-test-"));
  let scratch;
  try {
    await assert.rejects(withRawScratch({ dir, ownerToken: "synthetic-owner" }, async (directory) => {
      scratch = directory;
      await writeFile(join(directory, "unrecognized.txt"), "must remain");
    }), /ephemeral_unexpected_file/u);
    assert.equal(await readFile(join(scratch, "unrecognized.txt"), "utf8"), "must remain");
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), "aw-scratch-test-")));
    await rm(dir, { recursive: true });
  }
});

test("temporary project credentials are erased only after locked ownership and resource checks", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "aw-ephemeral-test-"));
  const project = `aw-test-${randomUUID()}`;
  const state = { project, checkout, dir: join(checkout, ".local-data", "projects", project), ownerToken: "synthetic-owner" };
  const checks = { load: async () => state, volumes: async () => [], states: async () => ({ postgres: { state: "absent" } }), runProcess: async () => ({ code: 0, stdout: "" }) };
  try {
    await mkdir(state.dir, { recursive: true });
    for (const filename of ["env", "state.json", "s3.json"]) await writeFile(join(state.dir, filename), "synthetic credential fixture");
    await writeFile(join(state.dir, "operation.lock"), String(process.pid));
    await assert.rejects(discardTestProject(state, { ...checks, volumes: async () => ["remaining-volume"] }), /ephemeral_resources_remain/u);
    await assert.rejects(discardTestProject(state, { ...checks, load: async () => ({ ...state, ownerToken: "different" }) }), /ephemeral_owner_mismatch/u);
    await access(join(state.dir, "env"));
    await discardTestProject(state, checks);
    await assert.rejects(access(state.dir), (error) => error.code === "ENOENT");
  } finally {
    assert.ok(checkout.startsWith(join(tmpdir(), "aw-ephemeral-test-")));
    await rm(checkout, { recursive: true });
  }
});
