import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workflow = await readFile(path.resolve(import.meta.dirname, "../.github/workflows/scanner-audit.yml"), "utf8");

test("scanner workflow has only read permission and two independent bounded builders", () => {
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.doesNotMatch(workflow, /packages:|id-token:|attest|cosign|oras|docker push|ghcr\\.io/u);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 90/u);
  assert.match(workflow, /repeat: \[1, 2\]/u);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.match(workflow, /node-version: 22\.23\.2/u);
});
