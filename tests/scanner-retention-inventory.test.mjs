import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TEST_ONLY_stageScannerRetentionBytes } from "../scripts/scanner/retention-publish.mjs";
import { sha256 } from "../scripts/scanner/retention-policy.mjs";

test("production inventory staging retains exact runner-path bytes and rejects path/content drift before writing", (t) => {
  const original = readFileSync(new URL("./fixtures/scanner-official/trivy-0.76.2-go-build-info.txt", import.meta.url));
  assert.equal(original.length, 37019);
  assert.equal(sha256(original), "a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b");
  const suffix = original.subarray(original.indexOf(10) + 1);
  // This conversion constructs a fixture. Production never normalizes the raw inventory.
  const expected = Buffer.concat([Buffer.from("/home/runner/work/_temp/trivy-provenance/bin/trivy: go1.27.3\n"), suffix]);
  assert.equal(expected.length, 37057);
  assert.equal(sha256(expected), "d11460976d702309229ce77f78631eff0ad7a20d52ac4ae0d046ab738ad8d2c9");
  const closurePath = "scanner-closure/inventory/go-build-info.txt";
  const changedSuffix = Buffer.from(expected); changedSuffix[changedSuffix.length - 5] ^= 1;
  for (const bytes of [original, changedSuffix, expected.subarray(0, -1), Buffer.concat([expected, Buffer.from("\n")])]) {
    const stage = mkdtempSync(path.join(tmpdir(), "scanner-inventory-refusal-"));
    t.after(() => rmSync(stage, { recursive: true, force: true }));
    assert.throws(() => TEST_ONLY_stageScannerRetentionBytes({ stage }, closurePath, bytes), /staged_member_invalid/u);
    assert.equal(existsSync(path.join(stage, closurePath)), false);
  }
  const stage = mkdtempSync(path.join(tmpdir(), "scanner-inventory-exact-"));
  t.after(() => rmSync(stage, { recursive: true, force: true }));
  TEST_ONLY_stageScannerRetentionBytes({ stage }, closurePath, expected);
  assert.deepEqual(readFileSync(path.join(stage, closurePath)), expected);
});
