import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseNativeCliArgs } from "../scripts/supply-chain/native-cli.mjs";

test("native CLI workflow wrapper accepts no executable, subject or output overrides", () => {
  assert.deepEqual(parseNativeCliArgs([]), { mode: "test" });
  for (const argv of [["--binary", "/tmp/substitute"], ["--skip-airgap"], ["--output", "/tmp/receipt"], undefined]) {
    assert.throws(() => parseNativeCliArgs(argv), { code: "native_cli_arguments_refused" });
  }
});

test("native CLI wrapper refuses execution without the Actions context on every host", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/supply-chain/native-cli.mjs", import.meta.url))], {
    env: {}, encoding: "utf8", timeout: 5000, maxBuffer: 4096,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "candidate_artifact_requires_secret_free_linux_ci");
});
