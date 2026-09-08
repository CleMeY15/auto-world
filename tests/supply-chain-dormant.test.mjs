import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/supply-chain/dormant.mjs", import.meta.url));

test("actual dormant CLI refuses installation and activation without capabilities", () => {
  const refused = { schemaVersion: 1, state: "refused", activation: "blocked",
    code: "privileged_operation_unavailable", capabilities: [] };
  for (const args of [["installation"], ["activate"], ["installation", "--enable"], ["status", "--enable"], []]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: {}, encoding: "utf8", timeout: 5000, maxBuffer: 4096, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), refused);
  }
});
