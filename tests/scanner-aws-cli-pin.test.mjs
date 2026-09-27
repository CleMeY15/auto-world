import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("infra/scanner/scanner-lock.json", root), "utf8"));
const provenance = JSON.parse(readFileSync(new URL("docs/validation/aws-cli-refresh/manifest-provenance.json", root), "utf8"));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("AWS CLI 2.36.46 is bound from its tag index through the linux/amd64 config", () => {
  assert.equal(provenance.state, "REGISTRY_PROVENANCE_ONLY_NOT_SCANNED_NOT_ADMITTED");
  assert.equal(provenance.maximumResponseBytes, 1024 * 1024);
  assert.deepEqual(provenance.subject, {
    role: "aws-cli",
    repository: "amazon/aws-cli",
    tag: "2.36.46",
    requestedPlatform: { os: "linux", architecture: "amd64", variant: null },
  });

  const image = lock.images.find(({ role }) => role === provenance.subject.role);
  assert.deepEqual(image, {
    role: "aws-cli",
    repository: provenance.subject.repository,
    version: provenance.subject.tag,
    manifestDigest: provenance.index.digest,
    platform: { ...provenance.subject.requestedPlatform, digest: provenance.platform.digest },
  });

  const indexBytes = readFileSync(new URL(provenance.index.rawFile, root));
  assert.equal(indexBytes.length, provenance.index.rawSize);
  assert.equal(sha256(indexBytes), provenance.index.rawSha256);
  assert.equal(provenance.index.rawSha256, provenance.index.digest);
  const index = JSON.parse(indexBytes);
  assert.equal(index.mediaType, provenance.index.mediaType);
  const descriptors = index.manifests.filter(({ platform }) =>
    platform?.os === "linux" && platform?.architecture === "amd64" && platform?.variant == null);
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].digest, provenance.platform.digest);
  assert.equal(descriptors[0].size, provenance.platform.descriptorSize);

  const platformBytes = readFileSync(new URL(provenance.platform.rawFile, root));
  assert.equal(platformBytes.length, provenance.platform.rawSize);
  assert.equal(platformBytes.length, descriptors[0].size);
  assert.equal(sha256(platformBytes), provenance.platform.rawSha256);
  assert.equal(provenance.platform.rawSha256, provenance.platform.digest);
  const platform = JSON.parse(platformBytes);
  assert.equal(platform.mediaType, provenance.platform.mediaType);
  assert.equal(platform.config.digest, provenance.config.digest);
  assert.equal(platform.config.size, provenance.config.descriptorSize);
  assert.equal(platform.config.mediaType, provenance.config.mediaType);

  const configBytes = readFileSync(new URL(provenance.config.rawFile, root));
  assert.equal(configBytes.length, provenance.config.rawSize);
  assert.equal(configBytes.length, platform.config.size);
  assert.equal(sha256(configBytes), provenance.config.rawSha256);
  assert.equal(provenance.config.rawSha256, provenance.config.digest);
  const config = JSON.parse(configBytes);
  assert.deepEqual({ os: config.os, architecture: config.architecture }, { os: "linux", architecture: "amd64" });
  const commands = config.history.map(({ created_by: command }) => command).filter(Boolean);
  assert.ok(commands.includes(provenance.config.candidateEvidence.baseHistoryCommand));
  assert.ok(commands.includes(provenance.config.candidateEvidence.updateHistoryCommand));
  assert.equal(provenance.config.candidateEvidence.baseRelease, "2023.12.20260914");
  assert.match(provenance.config.candidateEvidence.baseHistoryCommand, /ADD al2023-container-raw-2023\.12\.20260914\.0-amd64/u);
  assert.match(provenance.config.candidateEvidence.updateHistoryCommand, /dnf update -y/u);
});

test("AWS registry provenance is bounded and contains no credentials or private paths", () => {
  assert.ok(Number.isFinite(Date.parse(provenance.fetchedAt)));
  assert.deepEqual(Object.keys(provenance).sort(),
    ["config", "fetchedAt", "index", "maximumResponseBytes", "platform", "registry", "schemaVersion", "state", "subject"]);
  assert.doesNotMatch(JSON.stringify(provenance), /authorization|bearer|credential|token|\\\\|[A-Z]:\\/iu);
  for (const sourceUrl of [provenance.index.tagSourceUrl, provenance.index.immutableSourceUrl,
    provenance.platform.sourceUrl, provenance.config.sourceUrl]) {
    assert.equal(new URL(sourceUrl).hostname, "registry-1.docker.io");
  }
});
