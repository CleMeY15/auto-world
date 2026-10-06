import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(readFileSync(new URL("infra/scanner/scanner-lock.json", root), "utf8"));
const provenance = JSON.parse(readFileSync(new URL("docs/validation/service-image-refresh/manifest-provenance.json", root), "utf8"));

const refreshedRoles = new Set(["postgres", "postgres-alpine", "opensearch", "redis", "redis-alpine"]);
const lockedByRole = new Map([...lock.images, ...lock.alternatives].map((entry) => [entry.role, entry]));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("refreshed service pins are bound to retained registry index and linux/amd64 manifest bytes", () => {
  assert.equal(provenance.state, "REGISTRY_PROVENANCE_ONLY_NOT_SCANNED_NOT_ADMITTED");
  assert.equal(provenance.records.length, refreshedRoles.size);
  assert.deepEqual(new Set(provenance.records.map(({ role }) => role)), refreshedRoles);

  for (const record of provenance.records) {
    const image = lockedByRole.get(record.role);
    assert.ok(image, `missing lock role ${record.role}`);
    assert.equal(image.repository, record.repository);
    assert.equal(image.version, record.tag);
    assert.equal(image.manifestDigest, record.index.digest);
    assert.deepEqual(image.platform, { ...record.requestedPlatform, digest: record.platform.digest });

    const indexBytes = readFileSync(new URL(record.index.rawFile, root));
    assert.equal(indexBytes.length, record.index.rawSize);
    assert.equal(sha256(indexBytes), record.index.rawSha256);
    assert.equal(record.index.rawSha256, record.index.digest);
    const index = JSON.parse(indexBytes);
    const descriptors = index.manifests.filter(({ platform }) =>
      platform?.os === "linux" && platform?.architecture === "amd64" && platform?.variant == null);
    assert.equal(descriptors.length, 1, `${record.role} must have one unvaried linux/amd64 descriptor`);
    assert.equal(descriptors[0].digest, record.platform.digest);
    assert.equal(descriptors[0].size, record.platform.descriptorSize);

    const platformBytes = readFileSync(new URL(record.platform.rawFile, root));
    assert.equal(platformBytes.length, record.platform.rawSize);
    assert.equal(platformBytes.length, record.platform.descriptorSize);
    assert.equal(sha256(platformBytes), record.platform.rawSha256);
    assert.equal(record.platform.rawSha256, record.platform.digest);
    assert.equal(JSON.parse(platformBytes).mediaType, record.platform.mediaType);
  }
});

test("the refresh record is bounded technical provenance without credentials or private paths", () => {
  assert.equal(provenance.maximumResponseBytes, 1024 * 1024);
  assert.ok(Number.isFinite(Date.parse(provenance.fetchedAt)));
  assert.deepEqual(Object.keys(provenance).sort(), ["fetchedAt", "maximumResponseBytes", "records", "registry", "schemaVersion", "state"]);
  assert.doesNotMatch(JSON.stringify(provenance), /authorization|bearer|credential|token|\\\\|[A-Z]:\\/iu);
  for (const record of provenance.records) {
    if (record.fetchedAt !== undefined) {
      assert.ok(Number.isFinite(Date.parse(record.fetchedAt)));
    }
    assert.equal(new URL(record.index.sourceUrl).hostname, "registry-1.docker.io");
    assert.equal(new URL(record.index.immutableSourceUrl).hostname, "registry-1.docker.io");
    assert.equal(new URL(record.platform.sourceUrl).hostname, "registry-1.docker.io");
  }
});

test("OpenSearch 3.9.0 is the sole updated diagnostic pin while retained 3.8.0 bytes remain immutable", () => {
  const image = lockedByRole.get("opensearch");
  const record = provenance.records.find(({ role }) => role === "opensearch");
  assert.deepEqual(image, {
    role: "opensearch",
    repository: "opensearchproject/opensearch",
    version: "3.9.0",
    manifestDigest: "sha256:adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c",
    platform: {
      os: "linux",
      architecture: "amd64",
      variant: null,
      digest: "sha256:13487e0953520edf6cc866dfc672fd67a70ab122aa7d84d4a6c97106f84d3f84",
    },
  });
  assert.equal(record?.fetchedAt, "2026-10-06T21:56:37.8669999Z");
  assert.equal(record?.index.rawFile, "docs/validation/service-image-refresh/opensearch-3.9.0-index.json");
  assert.equal(record?.platform.rawFile, "docs/validation/service-image-refresh/opensearch-3.9.0-platform.json");

  const priorIndex = readFileSync(new URL("docs/validation/service-image-refresh/opensearch-index.json", root));
  const priorPlatform = readFileSync(new URL("docs/validation/service-image-refresh/opensearch-platform.json", root));
  assert.equal(sha256(priorIndex), "sha256:fafe3fc3587088674669235575aa166228c48bdb940294a8cdbbc1da75236a40");
  assert.equal(sha256(priorPlatform), "sha256:68a688de28fb9bb66601552650b91a52a9fd5e7eac5481dd2b225ecb66fd09b0");
});

test("reviewed scanner fixture and service trust inputs remain pinned", () => {
  const retained = {
    schemaVersion: lock.schemaVersion,
    state: lock.state,
    scanner: lock.scanner,
    compiler: lock.compiler,
    patches: lock.patches,
    fixtures: lock.fixtures,
    upstreamTestMaterials: lock.upstreamTestMaterials,
    baseline: lock.baseline,
    images: lock.images.filter(({ role }) => ["seaweedfs", "aws-cli", "baseline-trivy"].includes(role)),
  };
  assert.equal(createHash("sha256").update(JSON.stringify(retained)).digest("hex"),
    "fb6fcd43875a5adb8940b385cf9e5e0b8f859d747cf3459547f8098f92f7895a");
});
