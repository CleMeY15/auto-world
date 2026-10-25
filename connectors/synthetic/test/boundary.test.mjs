import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const cwd = new URL("../", import.meta.url);
function child(args, environment = {}) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 30000,
  });
}

test("package has neither root nor ordinary production import", () => {
  for (const specifier of ["@auto-world/synthetic-connector", "@auto-world/synthetic-connector/demo"]) {
    const result = child(["--input-type=module", "--eval", `import(${JSON.stringify(specifier)})`]);
    assert.notEqual(result.status, 0, specifier);
    assert.match(result.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/, specifier);
  }
});

test("forcing the demo condition in production fails with the fixed guard code", () => {
  const result = child(["--conditions=auto-world-demo", "--input-type=module", "--eval",
    "import('@auto-world/synthetic-connector/demo')"], { NODE_ENV: "production" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /synthetic_connector_demo_forbidden/);
});

test("SDK test-support modules reject every direct production import", () => {
  for (const file of ["fixtures.mjs", "store.mjs", "index.mjs"]) {
    const specifier = new URL(`../../_sdk/test-support/${file}`, import.meta.url).href;
    const result = child(["--input-type=module", "--eval", `import(${JSON.stringify(specifier)})`],
      { NODE_ENV: "production" });
    assert.notEqual(result.status, 0, file);
    assert.match(result.stderr, /connector_sdk_test_support_forbidden/, file);
  }
});

test("fixture composition uses no external network primitive", () => {
  const preload = new URL("./no-egress-preload.mjs", import.meta.url).href;
  const positive = child(["--import", preload, "--conditions=auto-world-demo", "test/no-egress-child.mjs"]);
  assert.equal(positive.status, 0, positive.stderr);
  assert.deepEqual(JSON.parse(positive.stdout), { status: "completed", networkAttempts: 0 });

  const negative = child(["--import", preload, "test/no-egress-negative-child.mjs"]);
  assert.equal(negative.status, 0, negative.stderr);
  const negativeResult = JSON.parse(negative.stdout);
  assert.equal(negativeResult.networkAttempts, 8);
  assert.deepEqual(negativeResult.codes, Array(8).fill("synthetic_external_egress_blocked"));
});
