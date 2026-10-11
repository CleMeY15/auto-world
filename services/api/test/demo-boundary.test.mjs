import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("demo composition refuses production even when the demo condition is forced", () => {
  const child = spawnSync(process.execPath, ["--conditions=auto-world-demo", "--input-type=module", "-e",
    "import('./demo/createSyntheticDemoReadPort.mjs')"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  assert.notEqual(child.status, 0);
  assert.equal(`${child.stdout}${child.stderr}`.includes("demo_api_unavailable_in_production"), true);
});

test("production package exports and dist contain no demo composition", async () => {
  const packageJson = (await import("../package.json", { with: { type: "json" } })).default;
  assert.deepEqual(Object.keys(packageJson.exports), ["."]);
  assert.deepEqual(packageJson.files, ["dist"]);
  assert.equal(JSON.stringify(packageJson.exports).includes("demo"), false);
});

test("demo read composition succeeds while network primitives are blocked", () => {
  const child = spawnSync(process.execPath, ["--conditions=auto-world-demo", "test/demo-boundary-no-egress-child.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(child.status, 0, `${child.stdout}${child.stderr}`);
  assert.equal(child.stdout.trim(), "NO_EGRESS_OK");
});
