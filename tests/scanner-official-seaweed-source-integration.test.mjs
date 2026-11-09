import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { bindManagedGosuEvidence, evaluateManagedArchiveForRole } from "../scripts/scanner/official-audit.mjs";
import { bindManagedSeaweedSourceEvidence } from "../scripts/scanner/seaweed-source-profile.mjs";

const clone = (value) => globalThis.structuredClone(value);
const seaweedDirectory = new URL("./fixtures/scanner-official/managed-seaweed-source/", import.meta.url);
const seaweedRaw = (name) => readFileSync(new URL(name, seaweedDirectory));
const seaweedSubject = {
  kind: "LOCAL_MANAGED_IMAGE_V1", imageId: "sha256:cc1fb4c602837eeef50c4ff3ec183eb4097076da8c91423039ec4863556a1bff",
  os: "linux", architecture: "amd64", archiveSha256: "1ee7e3cb0c73207c295110c000bc8fa0710efa97e1e9986d18775dc361ae0b48",
  archiveBytes: 755001856, archiveCapBytes: 2147483648, artifactName: "/managed-image-seaweedfs.tar",
};
const seaweedTime = new Date("2026-11-09T13:24:00.000Z");
function seaweed() {
  const subject = clone(seaweedSubject);
  const captured = new Map(readdirSync(seaweedDirectory).map((name) => [name, seaweedRaw(name).toString("base64")]));
  const evidence = bindManagedSeaweedSourceEvidence(subject, {
    view: Object.freeze({
      read(name, cap) { const bytes = Buffer.from(captured.get(name), "base64"); assert.ok(bytes.length <= cap); return bytes; },
      list(name) { return [...captured.keys()].filter((file) => file.startsWith(`${name}/`)).map((file) => file.slice(name.length + 1)).sort(); },
      has(name) { return captured.has(name); },
    }),
    baseInspection: seaweedRaw("managed-seaweedfs-base-inspect.json"),
    finalInspection: seaweedRaw("managed-seaweedfs-inspect.json"),
    // Unit seam only: the historical run did not measure this final runtime path.
    finalInventory: Buffer.from("7596c85c80dfdf59177e1b51c443c5f74d82852f23cb87d3378d142c42f27179  /usr/bin/weed\n"),
  });
  return { image: { role: "seaweedfs" }, report: { json: JSON.parse(seaweedRaw("image-seaweedfs.json")),
    sbom: JSON.parse(seaweedRaw("image-seaweedfs.cdx.json")) }, local: { subject, seaweedEvidence: evidence } };
}

function gosu() {
  const directory = new URL("./fixtures/scanner-official/managed-gosu/", import.meta.url);
  const raw = (name) => readFileSync(new URL(name, directory));
  const subject = { kind: "LOCAL_MANAGED_IMAGE_V1",
    imageId: "sha256:349cb0724274474208917a3e4064a585ab6df13339fc248742c23440f7d83f8f", os: "linux", architecture: "amd64",
    archiveSha256: "2a3fe9cbe179138638d3ee2da545c076b1299dff524da4063588b254833f96fd", archiveBytes: 302056448,
    artifactName: "/managed-image-postgres.tar" };
  const evidence = bindManagedGosuEvidence(subject, { buildInfo: raw("build-info.txt"), binaryInventory: raw("binary-sha256.txt"),
    sourceInventory: raw("source-sha256.txt"), goMod: raw("go.mod"), goSum: raw("go.sum"),
    finalInventory: Buffer.from("8c12961ed59dc9c662d5b5150a8f8e7ab66ef59d5796a0abdb8778b885247b8e  /usr/local/bin/gosu\n") });
  const json = JSON.parse(raw("image-postgres.json"));
  // Same explicit historical-fixture adaptation as the existing Gosu tests.
  json.Trivy.Version = "0.76.2";
  return { image: { role: "postgres" }, report: { json, sbom: JSON.parse(raw("image-postgres.cdx.json")) }, local: { subject, gosuEvidence: evidence } };
}

test("managed Seaweed evaluation keeps the main coverage limit and original JSON/SBOM visible", () => {
  const data = seaweed(), receipt = { admission: "NOT_AUTHORIZED" };
  const original = JSON.stringify(data);
  const result = evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt, seaweedTime);
  assert.deepEqual(result.findings, []); assert.deepEqual(result.blockers, []);
  assert.equal(result.rawPackageCount, 274); assert.equal(result.versionedPackageCount, 273); assert.equal(result.sourceBoundPackageCount, 1);
  assert.equal(result.sourceComponents[0].mainVersionLookup, "UNAVAILABLE");
  assert.equal(result.sourceComponents[0].mainVulnerabilityCoverage, "UNAVAILABLE_NO_VERSION");
  assert.equal(result.sourceComponents[0].admission, "NOT_AUTHORIZED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(receipt.sourceBoundInventory[0].role, "seaweedfs");
  assert.equal(JSON.stringify(data), original);
});

for (const order of [["postgres", "seaweedfs"], ["seaweedfs", "postgres"]]) {
  test(`source-bound receipts preserve both Gosu and Seaweed in order ${order.join(", ")}`, () => {
    const receipt = {}, sources = { postgres: gosu(), seaweedfs: seaweed() };
    for (const role of order) {
      const data = sources[role];
      const result = evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt,
        role === "postgres" ? new Date("2026-10-25T14:46:00.000Z") : seaweedTime);
      assert.deepEqual(result.blockers, []);
    }
    assert.deepEqual(receipt.sourceBoundInventory.map((entry) => entry.role), order);
    const inventory = Object.fromEntries(receipt.sourceBoundInventory.map((entry) => [entry.role, entry]));
    assert.equal(inventory.postgres.rawPackageCount, 49);
    assert.equal(inventory.postgres.sourceComponents[0].name, "github.com/tianon/gosu");
    assert.equal(inventory.seaweedfs.rawPackageCount, 274);
    assert.equal(inventory.seaweedfs.sourceComponents[0].name, "github.com/seaweedfs/seaweedfs");
  });
}

test("complete raw SBOM validation precedes source projection, including OS and relation checks", () => {
  for (const mutate of [
    (sbom) => { sbom.components.find((entry) => entry.type === "operating-system").version = "foreign"; },
    (sbom) => { sbom.components.find((entry) => entry.type === "library" && entry.properties.some((item) =>
      item.name === "aquasecurity:trivy:PkgType" && item.value === "alpine")).version = "foreign"; },
    (sbom) => { sbom.dependencies.push({ ref: "foreign", dependsOn: [] }); },
  ]) {
    const data = seaweed(), receipt = {};
    mutate(data.report.sbom);
    assert.throws(() => evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt, seaweedTime), /scanner_official_sbom_/u);
    assert.equal(receipt.sourceBoundInventory, undefined);
  }
});

test("managed Seaweed requires its authenticated source evidence even with a complete report pair", () => {
  const data = seaweed(), receipt = {};
  delete data.local.seaweedEvidence;
  assert.throws(() => evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt, seaweedTime), /scanner_managed_seaweed_source_/u);
  assert.equal(receipt.sourceBoundInventory, undefined);
});

test("a Seaweed source profile cannot be selected for another managed role or archive", () => {
  for (const role of ["postgres", "opensearch", "aws-cli", "redis", "foreign"]) {
    const data = seaweed(), receipt = {};
    data.image.role = role;
    assert.throws(() => evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt, seaweedTime), /scanner_managed_archive_invalid/u);
    assert.equal(receipt.sourceBoundInventory, undefined);
  }
  for (const role of ["opensearch", "aws-cli"]) {
    const data = seaweed(), receipt = {};
    data.image.role = role;
    data.local.subject.artifactName = `/managed-image-${role}.tar`;
    data.report.json.ArtifactName = data.local.subject.artifactName;
    data.report.sbom.metadata.component.name = data.local.subject.artifactName;
    assert.throws(() => evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt, seaweedTime), /scanner_image_report_invalid/u);
    assert.equal(receipt.sourceBoundInventory, undefined);
  }
});

test("managed PostgreSQL keeps its mandatory Gosu evidence after the Seaweed adapter change", () => {
  const data = gosu(), receipt = {};
  delete data.local.gosuEvidence;
  assert.throws(() => evaluateManagedArchiveForRole(data.image, data.report, data.local, receipt,
    new Date("2026-10-25T14:46:00.000Z")), /scanner_gosu_source_evidence_invalid/u);
  assert.equal(receipt.sourceBoundInventory, undefined);
});
