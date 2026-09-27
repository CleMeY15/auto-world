import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLocalPostgresGosuAudit } from "../scripts/postgres-image/audit-policy.mjs";
import { validatePostgresGosuFilesystemDelta } from "../scripts/postgres-image/evidence.mjs";

const now = new Date("2026-09-27T20:00:00Z");
const file = (path, sha256, { mode = 0o644, size = 10, mtime = 1 } = {}) =>
  ({ path, type: "file", mode, uid: 0, gid: 0, mtime, size, sha256 });
const directory = (path, mtime = 1) => ({ path, type: "directory", mode: 0o755, uid: 0, gid: 0, mtime, size: 0 });
const clone = (value) => JSON.parse(JSON.stringify(value));

function filesystemFixture() {
  const base = [
    directory("usr"), directory("usr/local"), directory("usr/local/bin"), directory("usr/bin"),
    directory("lib"), directory("lib/apk"), directory("lib/apk/db"),
    file("usr/local/bin/gosu", "a".repeat(64), { mode: 0o755, size: 2_000_000 }),
    file("lib/apk/db/installed", "b".repeat(64), { size: 100 }),
    file("usr/local/bin/docker-entrypoint.sh", "c".repeat(64), { mode: 0o755, size: 500 }),
  ];
  const candidate = base.filter((entry) => entry.path !== "usr/local/bin/gosu").map((entry) => ({ ...entry }));
  for (const path of ["usr", "usr/bin", "lib", "lib/apk", "lib/apk/db"]) {
    candidate.find((entry) => entry.path === path).mtime = 2;
  }
  candidate.find((entry) => entry.path === "lib/apk/db/installed").sha256 = "d".repeat(64);
  candidate.find((entry) => entry.path === "lib/apk/db/installed").size = 120;
  candidate.push(file("usr/bin/gosu", "6d3214ab9d2f1e9ffda75ea2f6bb1f454a13a78dd70318e09eee814ce32cce03",
    { mode: 0o755, size: 1_977_120, mtime: 2 }));
  const before = base.find((entry) => entry.path === "lib/apk/db/installed");
  const after = candidate.find((entry) => entry.path === "lib/apk/db/installed");
  return { base, candidate, expectedApkChanges: [{ path: before.path, before, after }], config: {
    Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], Env: ["PG_MAJOR=17"], User: "",
  } };
}

test("the flattened delta permits only the exact gosu replacement, locked APK records, and ancestor mtimes", () => {
  const fixture = filesystemFixture();
  const result = validatePostgresGosuFilesystemDelta({ baseEntries: fixture.base, candidateEntries: fixture.candidate,
    baseConfig: fixture.config, candidateConfig: { ...clone(fixture.config), Labels: { "org.auto-world.diagnostic": "run-1" } },
    expectedAdditionalLabels: { "org.auto-world.diagnostic": "run-1" }, expectedApkChanges: fixture.expectedApkChanges });
  assert.equal(result.state, "VERIFIED_DIAGNOSTIC_DELTA");
  assert.deepEqual(result.deleted, ["usr/local/bin/gosu"]);
  assert.deepEqual(result.added, ["usr/bin/gosu"]);
  assert.deepEqual(result.apkChanged, ["lib/apk/db/installed"]);
});

test("the filesystem validator fails closed on unlisted, executable, config, gosu, and APK changes", () => {
  const mutations = [
    (fixture) => { fixture.candidate.push(file("etc/unexpected", "e".repeat(64))); },
    (fixture) => { fixture.candidate.find((entry) => entry.path === "usr/local/bin/docker-entrypoint.sh").sha256 = "e".repeat(64); },
    (fixture) => { fixture.candidate.find((entry) => entry.path === "usr/bin/gosu").sha256 = "e".repeat(64); },
    (fixture) => { fixture.candidateConfig.Cmd = ["postgres", "-c", "fsync=off"]; },
    (fixture) => { fixture.candidateConfig.Labels.foreign = "unexpected"; },
    (fixture) => { fixture.expectedApkChanges = []; },
    (fixture) => { fixture.expectedApkChanges[0].after = { ...fixture.expectedApkChanges[0].after, sha256: "e".repeat(64) }; },
  ];
  for (const mutate of mutations) {
    const fixture = filesystemFixture();
    fixture.candidateConfig = { ...clone(fixture.config), Labels: { "org.auto-world.diagnostic": "run-1" } };
    mutate(fixture);
    assert.throws(() => validatePostgresGosuFilesystemDelta({ baseEntries: fixture.base, candidateEntries: fixture.candidate,
      baseConfig: fixture.config, candidateConfig: fixture.candidateConfig,
      expectedAdditionalLabels: { "org.auto-world.diagnostic": "run-1" }, expectedApkChanges: fixture.expectedApkChanges }),
    /postgres_gosu_filesystem_delta_invalid/u);
  }
  const fixture = filesystemFixture();
  assert.throws(() => validatePostgresGosuFilesystemDelta({ baseEntries: fixture.base, candidateEntries: fixture.candidate,
    baseConfig: fixture.config,
    candidateConfig: { ...clone(fixture.config), Labels: { "org.auto-world.diagnostic": "run-1" } },
    expectedAdditionalLabels: { "org.auto-world.diagnostic": "wrong" }, expectedApkChanges: fixture.expectedApkChanges }),
  /postgres_gosu_filesystem_delta_invalid/u);
});

const auditSubject = {
  artifactName: "/candidate/postgres-gosu.tar", imageId: `sha256:${"1".repeat(64)}`,
  archiveSha256: "2".repeat(64), tag: "auto-world/postgres-gosu:run-1",
  configDigest: `sha256:${"1".repeat(64)}`,
  diffIds: [`sha256:${"5".repeat(64)}`, `sha256:${"6".repeat(64)}`],
};

function vulnerabilityReport() {
  return {
    SchemaVersion: 2, Trivy: { Version: "0.74.0-autoworld.2" }, CreatedAt: "2026-09-27T19:30:00Z",
    ArtifactType: "container_image", ArtifactName: auditSubject.artifactName,
    Metadata: { ImageID: auditSubject.imageId, RepoTags: [auditSubject.tag], DiffIDs: clone(auditSubject.diffIds),
      ImageConfig: { os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: clone(auditSubject.diffIds) } },
      OS: { Family: "alpine", Name: "3.24.1" } },
    Results: [
      { Target: `${auditSubject.artifactName} (alpine 3.24.1)`, Class: "os-pkgs", Type: "alpine",
        Packages: [{ Name: "alpine-baselayout", Version: "3.7.0", Release: "r0" },
          { Name: "gosu", Version: "1.19-r5" }], Vulnerabilities: [] },
      { Target: "usr/bin/gosu", Class: "lang-pkgs", Type: "gobinary", Packages: [
        { Name: "github.com/moby/sys/user", Version: "v0.1.0" }, { Name: "stdlib", Version: "v1.26.8" },
        { Name: "golang.org/x/sys", Version: "v0.1.0" },
      ], Vulnerabilities: [] },
    ],
  };
}

function cyclonedxReport() {
  const pkg = (name, version, type) => ({ type: "library", name, version,
    properties: [{ name: "aquasecurity:trivy:PkgType", value: type }] });
  return {
    bomFormat: "CycloneDX", specVersion: "1.7", version: 1,
    metadata: { component: { type: "container", name: auditSubject.artifactName } },
    components: [
      { type: "application", name: "usr/bin/gosu", properties: [
        { name: "aquasecurity:trivy:Type", value: "gobinary" },
        { name: "aquasecurity:trivy:Class", value: "lang-pkgs" },
      ] },
      pkg("alpine-baselayout", "3.7.0-r0", "alpine"),
      pkg("gosu", "1.19-r5", "alpine"), pkg("github.com/moby/sys/user", "v0.1.0", "gobinary"),
      pkg("golang.org/x/sys", "v0.1.0", "gobinary"), pkg("stdlib", "v1.26.8", "gobinary"),
      { type: "operating-system", name: "alpine", version: "3.24.1", properties: [
        { name: "aquasecurity:trivy:Class", value: "os-pkgs" },
        { name: "aquasecurity:trivy:Type", value: "alpine" },
      ] },
    ],
  };
}

function databaseEvidence() {
  return {
    vulnerability: { Version: 2, UpdatedAt: "2026-09-27T18:00:00Z", DownloadedAt: "2026-09-27T18:30:00Z" },
    java: { Version: 1, UpdatedAt: "2025-01-01T00:00:00Z", DownloadedAt: "2026-09-27T18:30:00Z" },
  };
}

function evaluate(changes = {}) {
  return evaluateLocalPostgresGosuAudit({ vulnerabilityReport: changes.vulnerabilityReport ?? vulnerabilityReport(),
    cyclonedxReport: changes.cyclonedxReport ?? cyclonedxReport(), subject: changes.subject ?? auditSubject,
    archiveEvidence: changes.archiveEvidence ?? clone(auditSubject), databaseEvidence: changes.databaseEvidence ?? databaseEvidence(),
    now: changes.now ?? now });
}

test("a clean exact saved-archive audit is complete and remains diagnostic-only", () => {
  const result = evaluate();
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.databases.vulnerability.freshAt48Hours, true);
  assert.equal(result.databases.java.maxAgeMs, null);
  assert.equal(result.databases.java.freshAt48Hours, false);
  assert.deepEqual(result.blockers, []);
});

test("archive, image, config, and DiffID bindings reject substitution", () => {
  const cases = [
    { archiveSha256: "9".repeat(64) }, { imageId: `sha256:${"9".repeat(64)}` },
    { configDigest: `sha256:${"9".repeat(64)}` },
    { diffIds: [`sha256:${"9".repeat(64)}`] },
  ];
  for (const change of cases) assert.throws(() => evaluate({ archiveEvidence: { ...clone(auditSubject), ...change } }),
    /postgres_gosu_audit_invalid/u);
  const report = vulnerabilityReport(); report.ArtifactName += ".swapped";
  assert.throws(() => evaluate({ vulnerabilityReport: report }), /postgres_gosu_audit_invalid/u);
  const swappedDiffIds = vulnerabilityReport(); swappedDiffIds.Metadata.ImageConfig.rootfs.diff_ids.reverse();
  assert.throws(() => evaluate({ vulnerabilityReport: swappedDiffIds }), /postgres_gosu_audit_invalid/u);
  const swappedMetadata = vulnerabilityReport(); swappedMetadata.Metadata.DiffIDs.reverse();
  assert.throws(() => evaluate({ vulnerabilityReport: swappedMetadata }), /postgres_gosu_audit_invalid/u);
});

test("missing, wrong, or lingering gosu inventories are rejected", () => {
  for (const mutate of [
    (report) => { report.Results.pop(); },
    (report) => { report.Results[1].Target = "usr/local/bin/gosu"; },
    (report) => { report.Results[1].Packages[1].Version = "v1.26.7"; },
    (report) => { report.Results[1].Packages.shift(); },
    (report) => { report.Results[1].Packages[0].Version = "v0.2.0"; },
    (report) => { report.Results[1].Packages.push(clone(report.Results[1].Packages[0])); },
    (report) => { report.Results[0].Packages.pop(); },
    (report) => { report.Results.push({ ...clone(report.Results[1]), Target: "usr/local/bin/gosu" }); },
  ]) {
    const report = vulnerabilityReport(); mutate(report);
    assert.throws(() => evaluate({ vulnerabilityReport: report }), /postgres_gosu_audit_invalid/u);
  }
});

test("matching OS-only JSON and SBOM cannot hide the APK-owned gosu Go inventory", () => {
  const report = vulnerabilityReport();
  report.Results = report.Results.filter((entry) => entry.Class === "os-pkgs");
  const sbom = cyclonedxReport();
  sbom.components = sbom.components.filter((entry) => entry.type !== "application" &&
    !entry.properties.some((property) => property.value === "gobinary"));
  assert.throws(() => evaluate({ vulnerabilityReport: report, cyclonedxReport: sbom }), (error) => {
    assert.equal(error.message, "postgres_gosu_audit_invalid");
    assert.equal(error.diagnostic?.check, "inventory_targets");
    return true;
  });
});

test("complete one-to-one JSON and CycloneDX package inventories are required", () => {
  const report = vulnerabilityReport(); report.Results[0].Packages = [];
  assert.throws(() => evaluate({ vulnerabilityReport: report }), /postgres_gosu_audit_invalid/u);
  const missing = cyclonedxReport(); missing.components.splice(2, 1);
  assert.throws(() => evaluate({ cyclonedxReport: missing }), /postgres_gosu_audit_invalid/u);
  const old = cyclonedxReport(); old.components[2].name = "usr/local/bin/gosu";
  assert.throws(() => evaluate({ cyclonedxReport: old }), /postgres_gosu_audit_invalid/u);
});

test("report and database clocks are current, ordered, and non-future while Java age is informational", () => {
  const staleReport = vulnerabilityReport(); staleReport.CreatedAt = "2026-09-25T19:59:59Z";
  assert.throws(() => evaluate({ vulnerabilityReport: staleReport }), /postgres_gosu_audit_invalid/u);
  const futureReport = vulnerabilityReport(); futureReport.CreatedAt = "2026-09-27T20:00:01Z";
  assert.throws(() => evaluate({ vulnerabilityReport: futureReport }), /postgres_gosu_audit_invalid/u);
  for (const name of ["vulnerability", "java"]) {
    const db = databaseEvidence(); db[name].DownloadedAt = "2026-09-27T19:30:01Z";
    assert.throws(() => evaluate({ databaseEvidence: db }), (error) => {
      assert.equal(error.diagnostic?.check, "report_precedes_database_download");
      return true;
    });
    db[name].DownloadedAt = "2026-09-27T19:30:00Z";
    assert.equal(evaluate({ databaseEvidence: db }).state, "COMPLETE");
  }
  for (const mutate of [
    (db) => { db.vulnerability.UpdatedAt = "2026-09-25T19:59:59Z"; },
    (db) => { db.vulnerability.DownloadedAt = "2026-09-27T20:00:01Z"; },
    (db) => { db.java.UpdatedAt = "2026-09-27T19:00:00Z"; db.java.DownloadedAt = "2026-09-27T18:00:00Z"; },
  ]) {
    const db = databaseEvidence(); mutate(db);
    assert.throws(() => evaluate({ databaseEvidence: db }), /postgres_gosu_audit_invalid/u);
  }
});

test("every HIGH or CRITICAL finding blocks with no diagnostic disposition path", () => {
  for (const severity of ["HIGH", "CRITICAL"]) {
    const report = vulnerabilityReport();
    report.Results[1].Vulnerabilities = [{ Severity: severity, VulnerabilityID: "CVE-2099-0001",
      PkgName: "stdlib", InstalledVersion: "v1.26.8", FixedVersion: "v1.26.9" }];
    const result = evaluate({ vulnerabilityReport: report });
    assert.equal(result.state, "BLOCKED");
    assert.equal(result.findings.length, 1);
    assert.equal(result.blockers.length, 1);
  }
});
