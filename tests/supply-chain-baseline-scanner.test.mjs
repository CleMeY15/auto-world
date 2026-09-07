import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { baselineInventoryArguments, parseBaselineArgs, validateBaselineManifests } from "../scripts/supply-chain/baseline-scanner.mjs";

test("baseline inventory exposes only a fixed local daemon and immutable public image acquisition", () => {
  assert.deepEqual(parseBaselineArgs(["inventory"]), { mode: "inventory" });
  for (const operation of ["version", "info", "images", "pull", "inspect"]) {
    const args = baselineInventoryArguments("/owned/empty", operation);
    assert.deepEqual(args.slice(0, 4), ["--host", "unix:///var/run/docker.sock", "--config", "/owned/empty"]);
    assert.equal(args.some((entry) => ["run", "create", "build", "login", "push"].includes(entry)), false);
  }
  const pull = baselineInventoryArguments("/owned/empty", "pull");
  assert.equal(pull.at(-1), "aquasec/trivy@sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9");
  for (const argv of [["inventory", "--enable"], ["run"], ["pull", "other"], []]) assert.throws(() => parseBaselineArgs(argv));
  for (const operation of ["run", "create", "build", "login", "__proto__"]) assert.throws(() => baselineInventoryArguments("/owned/empty", operation));
});

test("baseline rejects manifest substitution and requires review before comparison", () => {
  assert.throws(() => validateBaselineManifests(Buffer.from("{}"), Buffer.from("{}")), { code: "baseline_manifest_identity_mismatch" });
  const script = fileURLToPath(new URL("../scripts/supply-chain/baseline-scanner.mjs", import.meta.url));
  for (const [mode, code] of [["inventory", "baseline_requires_secret_free_linux_ci"], ["compare", "baseline_comparison_review_required"]]) {
    const result = spawnSync(process.execPath, [script, mode], { env: {}, encoding: "utf8", timeout: 5000, maxBuffer: 4096 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), code);
  }
});
