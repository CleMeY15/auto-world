import assert from "node:assert/strict";
import { test } from "node:test";
import { conditionalRawWrite, rawKey } from "../scripts/data-infra/raw-protocol.mjs";

const bytes = Buffer.from("synthetic");
const write = (put, get = async () => bytes) => conditionalRawWrite({ bytes, put, get });

test("raw paths contain only validated domain IDs", () => {
  assert.equal(rawKey("src_a", "run_b", "raw_c"), "v1/raw/src_a/run_b/raw_c");
  for (const id of ["src_../other", "src_/", "src_", "src_a\n", "src_é", `src_${"a".repeat(65)}`]) {
    assert.throws(() => rawKey(id, "run_b", "raw_c"), /invalid_raw_address/u);
  }
});

test("raw success requires verified readback; replay differs from conflict", async () => {
  assert.equal((await write(async () => "created")).status, "created");
  assert.equal((await write(async () => "precondition412")).status, "replay");
  assert.equal((await write(async () => "precondition412", async () => Buffer.from("changed"))).status, "conflict");
  assert.equal((await write(async () => "created", async () => Buffer.from("changed"))).status, "indeterminate");
});

test("raw 409 retries are bounded; unknown or failed reads never imply persistence", async () => {
  let attempts = 0;
  assert.equal((await write(async () => { attempts += 1; return "conflict409"; })).status, "indeterminate");
  assert.equal(attempts, 3);
  assert.deepEqual(await write(async () => "unknown"), { status: "indeterminate" });
  assert.deepEqual(await write(async () => { throw new Error("private transport detail"); }), { status: "indeterminate" });
  assert.deepEqual(await write(async () => "created", async () => { throw new Error("read failure"); }), { status: "indeterminate" });
});
