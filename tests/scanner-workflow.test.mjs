import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workflow = (await readFile(path.resolve(import.meta.dirname, "../.github/workflows/scanner-audit.yml"), "utf8")).replace(/\r\n/gu, "\n");
const qualityWorkflow = (await readFile(path.resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8")).replace(/\r\n/gu, "\n");

function assertReadOnlyPermissions(source) {
  assert.equal([...source.matchAll(/^\s*permissions\s*:/gmu)].length, 1);
  assert.match(source, /^permissions:\n {2}contents: read\n\n/mu);
  assert.doesNotMatch(source, /:\s*write(?:-all)?\s*$/mu);
}

test("scanner workflow has only read permission, two independent builders, and a separate auditor", () => {
  assertReadOnlyPermissions(workflow);
  assert.doesNotMatch(workflow, /packages:|id-token:|attest|cosign|oras|docker push|ghcr\\.io/u);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 90/u);
  assert.match(workflow, /repeat: \[1, 2\]/u);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.match(workflow, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/u);
  assert.match(workflow, /node-version: 22\.23\.2/u);
  assert.match(workflow, /audit:\n {4}name: Frozen scanner and image audits\n {4}needs: build/u);
  assert.match(workflow, /scripts\/scanner\/audit\.mjs --build-root/u);
});

test("full scanner image audit is manual while quality and scanner tests stay automatic", () => {
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n\npermissions:/mu);
  assert.doesNotMatch(workflow, /^\s*(?:pull_request|push|schedule|workflow_call|workflow_run|repository_dispatch):/mu);
  assert.match(qualityWorkflow, /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]/mu);
  assert.match(qualityWorkflow, /run: pnpm test/u);
});

test("scanner permission check rejects job-level and global write escalation", () => {
  for (const replacement of ["permissions: write-all", "permissions:\n      contents: write", "permissions: { contents: write }"]) {
    assert.throws(() => assertReadOnlyPermissions(workflow.replace("  audit:\n", `  audit:\n    ${replacement}\n`)));
  }
  assert.throws(() => assertReadOnlyPermissions(workflow.replace("contents: read", "contents: write")));
});
