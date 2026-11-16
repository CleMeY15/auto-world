import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(new URL("../.github/workflows/scanner-retention-publish.yml", import.meta.url), "utf8"));

test("publisher workflow is no-input, first-party scoped and has no OIDC authority", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read", packages: "write" });
  assert.equal(workflow.permissions["id-token"], undefined);
  assert.deepEqual(Object.keys(workflow.jobs), ["publish"]);
  assert.equal(workflow.jobs.publish["runs-on"], "ubuntu-24.04");
  assert.equal(workflow.jobs.publish["timeout-minutes"], 45);
  assert.equal(workflow.jobs.publish.if, "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}");
});

test("publisher workflow uploads only the capped public receipt", () => {
  const steps = workflow.jobs.publish.steps;
  const upload = steps.find((step) => step.name === "Preserve public publisher receipt only");
  assert.equal(upload.uses, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
  assert.equal(upload.with.path, "${{ runner.temp }}/scanner-retention-publisher-public/publisher-receipt.json");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.ok(!upload.with.path.includes("*.tar"));
  assert.ok(!upload.with.path.includes("trivy"));
});

test("publisher workflow pins checkout and Node and invokes only publish mode", () => {
  const steps = workflow.jobs.publish.steps;
  assert.equal(steps[0].uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  assert.equal(steps[0].with["persist-credentials"], false);
  assert.equal(steps[1].uses, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
  assert.equal(steps[1].with["node-version"], "22.23.4");
  const publish = steps.find((step) => step.id === "publish");
  assert.match(publish.run, /retention-publish\.mjs publish --output/u);
  assert.doesNotMatch(publish.run, /bootstrap|read-proof|trivy\s/u);
  assert.deepEqual(Object.keys(publish.env).sort(), ["GH_TOKEN", "GITHUB_TOKEN"]);
});

test("publisher reconstructs exact provenance with four refusals and never executes Trivy", () => {
  const provenance = workflow.jobs.publish.steps.find((step) => step.id === "provenance");
  assert.match(provenance.run, /gh release download v0\.76\.2/u);
  assert.match(provenance.run, /bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf/u);
  for (const control of ["changed-bytes", "wrong-source", "wrong-workflow", "wrong-ref"]) {
    assert.match(provenance.run, new RegExp(`expect_refusal ${control}`, "u"));
  }
  assert.match(provenance.run, /env GOTOOLCHAIN=local go version -m/u);
  const identityCheck = provenance.run.indexOf('test "$(env GOTOOLCHAIN=local go version)" = "go version go1.24.13 linux/amd64"');
  assert.ok(identityCheck >= 0 && identityCheck < provenance.run.indexOf("env GOTOOLCHAIN=local go version -m"));
  assert.doesNotMatch(provenance.run, /(?:^|[;&|]\s*)["']?\$root\/bin\/trivy(?:\s|$)/mu);
});
