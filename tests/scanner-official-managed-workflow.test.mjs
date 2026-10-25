import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const workflow = JSON.parse(read(".github/workflows/data-foundation-managed.yml"));
const upstream = JSON.parse(read(".github/workflows/data-foundation-audit.yml"));
const steps = workflow.jobs.audit.steps;

test("managed builds retain the independently exercised official provenance boundary", () => {
  assert.deepEqual(steps.find((step) => step.id === "provenance"), upstream.jobs.audit.steps.find((step) => step.id === "provenance"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.audit["runs-on"], "ubuntu-24.04");
  assert.equal(workflow.jobs.audit["timeout-minutes"], 240);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push"]);
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.equal(steps.filter((step) => step.env?.GH_TOKEN || step.env?.GITHUB_TOKEN).length, 1);
  for (const step of steps.filter((entry) => entry.uses)) {
    assert.match(step.uses, /^actions\/(?:checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/u);
  }
  assert.equal(steps.find((step) => step.uses?.startsWith("actions/checkout@")).with["persist-credentials"], false);
});

test("managed diagnostic failures remain failures and only validated evidence is public", () => {
  const audit = steps.find((step) => step.id === "audit");
  assert.match(audit.run, /env -u GH_TOKEN -u GITHUB_TOKEN -u NODE_AUTH_TOKEN node scripts\/scanner\/official-audit\.mjs/u);
  assert.match(audit.run, /--scope managed\s*$/u);
  assert.equal(audit["timeout-minutes"], 225);
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.if, "${{ always() }}");
  assert.equal(upload.with["retention-days"], 14);
  const paths = upload.with.path.split("\n");
  assert.ok(paths.includes("${{ runner.temp }}/data-foundation-audit/managed-public-evidence/**"));
  assert.ok(paths.includes("${{ runner.temp }}/data-foundation-audit/managed-runtime-result.json"));
  for (const file of paths) {
    assert.doesNotMatch(file, /\.(?:tar|tgz|gz|zip)(?:$|\/)|\/managed-evidence\/|\/cache\/|\/bin\//u);
    assert.notEqual(file, "${{ runner.temp }}/data-foundation-audit/**");
  }
  const enforce = steps.at(-1);
  assert.match(enforce.if, /steps\.audit\.outcome != 'success'/u);
  assert.match(enforce.run, /^exit 1\s*$/u);
});

test("produced-service integration triggers diagnostics but stays outside pre-build pure tests", () => {
  const integration = "tests/managed-image-runtime.integration.mjs";
  for (const event of ["pull_request", "push"]) assert.ok(workflow.on[event].paths.includes(integration));
  const tests = steps.find((step) => step.id === "tests");
  assert.ok(!tests.run.includes(integration));
  assert.match(tests.run, /tests\/managed-image-\*\.test\.mjs/u);
  assert.ok(!integration.endsWith(".test.mjs"));
});

test("each Buildx context denies host-private data and admits only its reviewed public inputs", () => {
  const allowed = {
    postgres: ["infra/managed-images/Dockerfile.postgres", "infra/managed-images/gosu-functional-tests.sh", "infra/managed-images/postgres/", "infra/managed-images/postgres/**"],
    "aws-cli": ["infra/managed-images/Dockerfile.aws-cli"],
    "opensearch-core": ["infra/managed-images/Dockerfile.opensearch-core", "infra/managed-images/opensearch-core/", "infra/managed-images/opensearch-core/**"],
  };
  for (const [role, inputs] of Object.entries(allowed)) {
    const patterns = read(`infra/managed-images/Dockerfile.${role}.dockerignore`).trim().split("\n");
    assert.equal(patterns[0], "**");
    assert.deepEqual(patterns.slice(1), ["infra/", "infra/managed-images/", ...inputs].map((entry) => `!${entry}`));
    assert.ok(patterns.every((entry) => !entry.includes(".omx") && !entry.includes(".local-data") && !entry.includes(".git")));
  }
});
