import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateManagedImageLock, validateOfficialReleaseConfig } from "../scripts/scanner/official-audit.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root));
const json = (name) => JSON.parse(read(name));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directory = "docs/validation/upstream-20261118/";
const provenance = json(`${directory}provenance.json`);
const config = json("infra/scanner/official-release.json");
const managed = json("infra/managed-images/lock.json");
const platformDigest = "sha256:84871c53f4d8ec5ecc9019d234951ef0c37ca60ced365c9db2ba96e4662daef2";
const configDigest = "sha256:d7fb1e7bde3bdfe89c1066d8297621fe75af28d2c7e9dc9f3b8c7f2106537fba";

function validateBindings(release, lock, bytes) {
  validateOfficialReleaseConfig(release);
  validateManagedImageLock(lock, release);
  const candidate = release.images.find(({ role }) => role === "opensearch");
  assert.equal(candidate.repository, "opensearchproject/opensearch");
  assert.equal(candidate.version, "3.9.0");
  assert.equal(candidate.platform.digest, platformDigest);
  for (const kind of ["index", "platform", "config"]) {
    assert.equal(bytes[kind].length, provenance[kind].bytes);
    assert.equal(`sha256:${sha(bytes[kind])}`, provenance[kind].sha256);
  }
  const index = JSON.parse(bytes.index), platform = JSON.parse(bytes.platform), imageConfig = JSON.parse(bytes.config);
  assert.equal(candidate.manifestDigest, provenance.index.sha256);
  const descriptors = index.manifests.filter(({ platform: value }) => value?.os === "linux" && value.architecture === "amd64" && value.variant == null);
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].digest, candidate.platform.digest);
  assert.equal(descriptors[0].size, bytes.platform.length);
  assert.equal(platform.config.digest, configDigest);
  assert.equal(platform.config.size, bytes.config.length);
  assert.equal(imageConfig.os, "linux");
  assert.equal(imageConfig.architecture, "amd64");
  assert.equal(imageConfig.config.Labels["org.label-schema.version"], "3.9.0");
  assert.equal(lock.candidates.find(({ role }) => role === "opensearch").baseDigest, platformDigest);
  assert.ok(read("infra/managed-images/Dockerfile.opensearch-core").toString().includes(`FROM opensearchproject/opensearch@${platformDigest} AS prepared-base\n`));
}

const bytes = Object.fromEntries(["index", "platform", "config"].map((kind) => [kind, read(`${directory}${provenance[kind].file}`)]));
test("OpenSearch candidate pins bind the actual registry index, platform and config bytes", () => {
  validateBindings(config, managed, bytes);
  for (const kind of ["index", "platform", "config"]) {
    const substituted = { ...bytes, [kind]: Buffer.from(bytes[kind]) };
    substituted[kind][substituted[kind].length - 1] ^= 1;
    assert.throws(() => validateBindings(config, managed, substituted));
  }
  for (const field of ["manifestDigest", "platform"]) {
    const changed = JSON.parse(JSON.stringify(config)), image = changed.images.find(({ role }) => role === "opensearch");
    if (field === "platform") image.platform.digest = `sha256:${"a".repeat(64)}`;
    else image.manifestDigest = `sha256:${"a".repeat(64)}`;
    assert.throws(() => validateBindings(changed, managed, bytes));
  }
  const changed = JSON.parse(JSON.stringify(managed));
  changed.candidates.find(({ role }) => role === "opensearch").baseDigest = `sha256:${"a".repeat(64)}`;
  assert.throws(() => validateBindings(config, changed, bytes));
});

test("PR251 preserved the scanner, source references and all other roles in its historical release", () => {
  const unchanged = json("docs/validation/aws-cli-20261118/pr251-official-release.json"), selected = unchanged.images.find(({ role }) => role === "opensearch");
  assert.equal(unchanged.resolvedAt, provenance.observedAt);
  unchanged.resolvedAt = "2026-11-09T07:21:40.3686192Z";
  delete selected.manifestDigest;
  delete selected.platform.digest;
  assert.equal(sha(JSON.stringify(unchanged)), "b699fc01993b74015c3dbecd12f12f669199576a3a810032a8a4f652e0d52206");
});

test("the complete original failed matrix preserves all blocker objects in original order", () => {
  const matrix = json(`${directory}original-findings.json`);
  assert.equal(matrix.state, "HISTORICAL_FAILED_UNWAIVED");
  assert.equal(matrix.findings.length, 243);
  assert.equal(sha(JSON.stringify(matrix.findings.map(({ originalBlocker }) => originalBlocker))), "9b6634d8d7948701e67dc4d6c6aeb5c93371ec40a74c2b7366b4d4a0a623ef09");
  assert.equal(matrix.artifact.sha256, "3bee04df78d9346f442fb9df17661f74ec8a1e79e3188f9c63b536881b30e8cb");
  assert.equal(matrix.receipt.sha256, "f6c77cce113eed5dba9e870b202dfce3d8f12c3a8467608ebefa4877a2804682");
  for (const [index, finding] of matrix.findings.entries()) {
    assert.equal(finding.ordinal, index + 1);
    assert.equal(finding.status, "HISTORICAL_FAILED_UNWAIVED");
    assert.equal(finding.currentCandidateCoverage, "NOT_ESTABLISHED");
    assert.ok(finding.officialFixSources.length > 0);
  }
});

test("the stopped-image prerequisite retains byte-identical full JDK and release inventories", () => {
  const comparison = json(`${directory}jdk-comparison.json`);
  assert.equal(comparison.image, `opensearchproject/opensearch@${platformDigest}`);
  assert.equal(comparison.registryConfigDigest, configDigest);
  assert.equal(comparison.started, false);
  assert.equal(comparison.cleanup, "OWNED_STOPPED_CONTAINER_REMOVED");
  for (const [file, identity] of Object.entries(comparison.files)) {
    const data = read(`${directory}${file}`);
    assert.equal(data.length, identity.bytes);
    assert.equal(sha(data), identity.sha256);
  }
  assert.equal(sha(read(`${directory}old-jdk-before.txt`)), "ea4643fecd38b7210ae4e1846591bb212af6554475a488e464d7078afe62ffa0");
  assert.equal(sha(read(`${directory}old-jdk-release.txt`)), "44be64b383baa18668afefbe9a780ae3a9d730a066eaaa92500f77bd1e4b934c");
  assert.deepEqual(read(`${directory}jdk-inventory.stdout`), read(`${directory}old-jdk-before.txt`));
  assert.deepEqual(read(`${directory}new-jdk-release.txt`), read(`${directory}old-jdk-release.txt`));
});
