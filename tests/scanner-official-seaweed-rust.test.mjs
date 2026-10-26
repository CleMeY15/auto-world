import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync,
  writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  combineSeaweedRustGate,
  helperContainerCreateArguments,
  helperCopyCommand,
  helperSoftLimitControlCommand,
  prepareSeaweedRustLockViews,
  seaweedRustScanArguments,
  seaweedRustSourceFetchArguments,
  seaweedRustPublicSourcePath,
  validateSeaweedRustControlReport,
  validateSeaweedRustHelperAbsence,
  validateSeaweedRustHelperContainer,
  validateSeaweedRustHelperMeasurement,
  validateSeaweedRustLockUniverse,
  validateSeaweedRustPublicEvidence,
  validateSeaweedRustPublicSourceMapping,
  validateSeaweedRustSourceLock,
} from "../scripts/scanner/seaweed-rust-source.mjs";
import { auditAndPublishSeaweedRustControlReport, auditAndPublishSeaweedRustSourceReports,
  classifySeaweedRustHelperCommandFailure, classifySeaweedRustSubjectFailure, collectSeaweedRustHelperIdentity,
  deferManagedImageAuditFailure, exportSeaweedRustAuditReportPair, measureSeaweedRustHelperFile,
  runManagedSeaweedRustPostImageLifecycle } from "../scripts/scanner/official-audit.mjs";

const fixture = (name) => readFileSync(new URL(`fixtures/scanner-official/${name}`, import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const metadata = JSON.parse(readFileSync(new URL("../infra/managed-images/seaweed-rust-source.json", import.meta.url), "utf8"));
const official = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url), "utf8"));
const now = new Date("2026-10-26T20:00:00Z");
const imageId = metadata.image.configDigest;
const owner = "12345678-1234-4234-8234-123456789abc";
const containerName = `aw-seaweed-rust-${owner}`;
const error = /scanner_seaweed_rust_/u;

test("only managed scope defers the named image rejection for further diagnostic collection", () => {
  const rejection = new Error("scanner_official_images_blocked");
  assert.equal(deferManagedImageAuditFailure({ scope: "managed", error: rejection, cleanupUncertain: false }), rejection);
});

for (const [label, scope, cleanupUncertain, reason] of [
  ["upstream image rejection", "upstream", false, "scanner_official_images_blocked"],
  ["unknown scope", "unknown", false, "scanner_official_images_blocked"],
  ["uncertain managed cleanup", "managed", true, "scanner_official_images_blocked"],
  ["unconfirmed managed cleanup", "managed", undefined, "scanner_official_images_blocked"],
  ["managed integrity failure", "managed", false, "scanner_frozen_input_changed"],
]) {
  test(`${label} aborts instead of promoting rejected images to a successful audit`, () => {
    const rejection = new Error(reason);
    assert.throws(() => deferManagedImageAuditFailure({ scope, error: rejection, cleanupUncertain }), (actual) => actual === rejection);
  });
}

const canonicalFixtures = Object.freeze([
  Object.freeze({ name: "seaweed-volume.pairs.json", bytes: 12_234, count: 498,
    sha256: "2cc9985b29f8de9fb6ee0228b3d6acafa7de38a8d8eb163d9ec9c3356c0f4a79" }),
  Object.freeze({ name: "seaweed-worker.pairs.json", bytes: 14_985, count: 590,
    sha256: "750e245f91a9f8d26bd4958b1a06e1d72c7028545ed697e71befc7243f0d9343" }),
  Object.freeze({ name: "cargo-lock-vulnerable.pairs.json", bytes: 1_696, count: 74,
    sha256: "11fb06dd4a7db051a69b07a5d9d24eeff35e2e9d47398c7d662b101a8307f316" }),
  Object.freeze({ name: "cargo-lock-clean.pairs.json", bytes: 244, count: 10,
    sha256: "8077301894e5afb55bb49240f515989fd600588a0fd4f093b5182ba645aa8ea5" }),
]);

for (const expected of canonicalFixtures) {
  test(`${expected.name} retains its independently measured bytes, hash and tuple count`, () => {
    const bytes = fixture(expected.name);
    assert.equal(bytes.length, expected.bytes, expected.name);
    assert.equal(hash(bytes), expected.sha256, expected.name);
    assert.equal(bytes.at(-1), 0x0a, expected.name);
    assert.notEqual(bytes.at(-2), 0x0a, expected.name);
    const pairs = JSON.parse(bytes.toString("utf8"));
    assert.equal(pairs.length, expected.count, expected.name);
    assert.equal(new Set(pairs.map((pair) => JSON.stringify(pair))).size, expected.count, expected.name);
  });
}

test("Seaweed Rust source audit exposes the complete reviewed behavior surface", () => {
  for (const value of [validateSeaweedRustSourceLock, seaweedRustSourceFetchArguments, prepareSeaweedRustLockViews,
    seaweedRustScanArguments, validateSeaweedRustControlReport, validateSeaweedRustLockUniverse,
    helperContainerCreateArguments, helperCopyCommand, validateSeaweedRustHelperContainer,
    validateSeaweedRustHelperAbsence, validateSeaweedRustHelperMeasurement, combineSeaweedRustGate,
    validateSeaweedRustPublicEvidence, validateSeaweedRustPublicSourceMapping, auditAndPublishSeaweedRustControlReport,
    auditAndPublishSeaweedRustSourceReports, classifySeaweedRustHelperCommandFailure, classifySeaweedRustSubjectFailure,
    exportSeaweedRustAuditReportPair, measureSeaweedRustHelperFile, runManagedSeaweedRustPostImageLifecycle]) {
    assert.equal(typeof value, "function");
  }
});

function pairsFor(role) {
  const names = { volume: "seaweed-volume.pairs.json", worker: "seaweed-worker.pairs.json",
    "cargo-lock-vulnerable": "cargo-lock-vulnerable.pairs.json", "cargo-lock-clean": "cargo-lock-clean.pairs.json" };
  return JSON.parse(fixture(names[role]).toString("utf8"));
}

function reportFor(role, pairs = pairsFor(role), vulnerabilities) {
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, CreatedAt: now.toISOString(),
    ArtifactName: `/${role}`, ArtifactType: "filesystem", Results: [{ Target: "Cargo.lock", Class: "lang-pkgs", Type: "cargo",
      Packages: pairs.map(([Name, Version]) => ({ Name, Version })), ...(vulnerabilities ? { Vulnerabilities: vulnerabilities } : {}) }] };
}

function sbomFor(role, pairs = pairsFor(role)) {
  const prop = (name, value) => ({ name: `aquasecurity:trivy:${name}`, value });
  const libraries = pairs.map(([name, version], index) => ({ type: "library", name, version, "bom-ref": `pkg-${index}`,
    properties: [prop("PkgType", "cargo")] }));
  return { bomFormat: "CycloneDX", specVersion: "1.7", metadata: { component: { type: "application", name: `/${role}`, "bom-ref": "root" } },
    components: [{ type: "application", name: "Cargo.lock", "bom-ref": "lock", properties: [prop("Class", "lang-pkgs"), prop("Type", "cargo")] }, ...libraries],
    dependencies: [{ ref: "root", dependsOn: ["lock"] }, { ref: "lock", dependsOn: libraries.map((entry) => entry["bom-ref"]) },
      ...libraries.map((entry) => ({ ref: entry["bom-ref"] }))] };
}

test("source metadata accepts the exact reviewed lock without mutating it", () => {
  const value = clone(metadata), before = JSON.stringify(value);
  assert.equal(validateSeaweedRustSourceLock(value, official), value);
  assert.equal(JSON.stringify(value), before);
});

for (const [label, mutate] of [
  ["source hash", (value) => { value.files[0].sha256 = "a".repeat(64); }],
  ["source path", (value) => { value.files[0].path = "docker/Foreignfile"; }],
  ["canonical inventory hash", (value) => { value.roles[0].canonicalInventorySha256 = "a".repeat(64); }],
  ["canonical package count", (value) => { value.roles[0].packageCount -= 1; }],
  ["helper hash", (value) => { value.roles[0].helper.sha256 = "a".repeat(64); }],
  ["control fixed version", (value) => { value.controls[0].expectedFinding.fixedVersion = "2.1.1"; }],
  ["evidence limitation", (value) => { value.limitations.lockUniverseInventory = "COMPLETE"; }],
]) {
  test(`source metadata rejects a valid-looking ${label} substitution`, () => {
    const changed = clone(metadata); mutate(changed);
    assert.throws(() => validateSeaweedRustSourceLock(changed, official), /scanner_seaweed_rust_metadata_invalid/u);
  });
}

test("source fetch is fixed to one authenticated-free HTTPS raw path with finite limits", () => {
  const entry = metadata.files[0], destination = path.resolve("synthetic-rust-source", path.basename(entry.path));
  const value = seaweedRustSourceFetchArguments(entry, destination);
  assert.equal(value.command, "/usr/bin/curl");
  assert.equal(value.timeoutMs, 90_000);
  assert.equal(value.args[value.args.indexOf("--output") + 1], destination);
  assert.equal(value.args.at(-1), `https://raw.githubusercontent.com/seaweedfs/seaweedfs/${metadata.source.commit}/${entry.path}`);
  for (const pair of [["--max-redirs", "0"], ["--max-filesize", String(1024 ** 2)], ["--max-time", "60"]]) {
    assert.equal(value.args[value.args.indexOf(pair[0]) + 1], pair[1]);
  }
  assert.equal(value.args.some((item) => /authorization|token|cookie|location/iu.test(item)), false);
});

test("source fetch refuses a destination basename substitution", () => {
  assert.throws(() => seaweedRustSourceFetchArguments(metadata.files[0], path.resolve("synthetic-rust-source", "foreign")),
    /scanner_seaweed_rust_arguments_invalid/u);
});

test("lock views refuse a pre-existing destination before reading source material", () => {
  const root = path.resolve("synthetic-rust-source"), views = path.resolve("tests");
  assert.throws(() => prepareSeaweedRustLockViews({ metadata, sourceRoot: root, viewsRoot: views }),
    /scanner_seaweed_rust_view_invalid/u);
});

for (const format of ["json", "cyclonedx"]) {
  test(`${format} Rust scan retains the restricted scanner profile and exact singleton Cargo flags`, () => {
    const base = { carrier: `aquasec/trivy@sha256:${"a".repeat(64)}`, scanner: path.resolve("synthetic-rust", "trivy"),
      cache: path.resolve("synthetic-rust", "cache"), view: path.resolve("synthetic-rust", "volume") };
    const args = seaweedRustScanArguments({ ...base, format });
    for (const flag of ["--network=none", "--read-only", "--cap-drop=ALL", "--skip-db-update", "--skip-java-db-update",
      "--skip-version-check", "--list-all-pkgs", "--offline-scan", "--pkg-types", "--pkg-relationships", "--scanners"]) {
      assert.equal(args.filter((entry) => entry === flag).length, 1, `${format}:${flag}`);
    }
    assert.equal(args[args.indexOf("--pkg-types") + 1], "library");
    assert.equal(args[args.indexOf("--pkg-relationships") + 1], "unknown,root,workspace,direct,indirect");
    assert.equal(args[args.indexOf("--scanners") + 1], "vuln");
    assert.equal(args.includes("--severity"), format === "json");
    for (const forbidden of ["--skip-files", "--skip-dirs", "--ignorefile", "--ignore-unfixed", "--include-dev-deps"]) {
      assert.equal(args.includes(forbidden), false, forbidden);
    }
  });
}

test("the vulnerable Rust control requires the exact ammonia advisory contract", () => {
  const finding = { VulnerabilityID: "RUSTSEC-2019-0001", PkgName: "ammonia", InstalledVersion: "1.9.0",
    Severity: "HIGH", FixedVersion: "2.1.0" };
  const result = validateSeaweedRustControlReport({ control: "cargo-lock-vulnerable",
    report: reportFor("cargo-lock-vulnerable", undefined, [finding]), metadata, artifactName: "/cargo-lock-vulnerable", now });
  assert.equal(result.result, "passed");
  assert.equal(result.evidenceClass, "RUST_ADVISORY_CONTROL");
});

test("the vulnerable Rust control retains additional valid blockers without weakening the exact ammonia match", () => {
  const findings = [
    { VulnerabilityID: "RUSTSEC-2019-0001", PkgName: "ammonia", InstalledVersion: "1.9.0", Severity: "HIGH", FixedVersion: "2.1.0" },
    { VulnerabilityID: "CVE-2099-0001", PkgName: "autocfg", InstalledVersion: "0.1.2", Severity: "HIGH", FixedVersion: "0.1.3" },
  ];
  const result = validateSeaweedRustControlReport({ control: "cargo-lock-vulnerable",
    report: reportFor("cargo-lock-vulnerable", undefined, findings), metadata, artifactName: "/cargo-lock-vulnerable", now });
  assert.equal(result.result, "passed");
  assert.deepEqual([result.findingCount, result.blockerCount], [2, 2]);
});

for (const [label, change] of [["fixed version", { FixedVersion: "2.1.1" }], ["severity", { Severity: "CRITICAL" }],
  ["advisory ID", { VulnerabilityID: "CVE-0000-0000" }]]) {
  test(`the vulnerable Rust control rejects a changed ${label}`, () => {
    const finding = { VulnerabilityID: "RUSTSEC-2019-0001", PkgName: "ammonia", InstalledVersion: "1.9.0",
      Severity: "HIGH", FixedVersion: "2.1.0" };
    assert.throws(() => validateSeaweedRustControlReport({ control: "cargo-lock-vulnerable",
      report: reportFor("cargo-lock-vulnerable", undefined, [{ ...finding, ...change }]), metadata,
      artifactName: "/cargo-lock-vulnerable", now }), /scanner_seaweed_rust_control_blocked/u);
  });
}

test("the clean Rust control rejects every high or critical finding", () => {
  const clean = validateSeaweedRustControlReport({ control: "cargo-lock-clean", report: reportFor("cargo-lock-clean"), metadata,
    artifactName: "/cargo-lock-clean", now });
  assert.equal(clean.findingCount, 0);
  const [Name, Version] = pairsFor("cargo-lock-clean")[0];
  assert.throws(() => validateSeaweedRustControlReport({ control: "cargo-lock-clean",
    report: reportFor("cargo-lock-clean", undefined, [{ VulnerabilityID: "CVE-TEST", PkgName: Name, InstalledVersion: Version,
      Severity: "HIGH", FixedVersion: "9.9.9" }]), metadata, artifactName: "/cargo-lock-clean", now }),
  /scanner_seaweed_rust_control_blocked/u);
});

test("source audit accepts the exact independently pinned JSON and CycloneDX inventories", () => {
  for (const role of ["volume", "worker"]) {
    const result = validateSeaweedRustLockUniverse({ role, report: reportFor(role), sbom: sbomFor(role), metadata,
      artifactName: `/${role}`, now });
    assert.equal(result.result, "passed");
    assert.equal(result.evidenceClass, "SOURCE_LOCK_AUDIT");
    assert.equal(result.scope, "LOCK_UNIVERSE");
    assert.equal(result.inventorySha256, metadata.roles.find((entry) => entry.role === role).canonicalInventorySha256);
    assert.equal(result.limitations.intrinsicBinaryInventory, "NOT_ESTABLISHED");
    assert.equal(result.limitations.sourceToBinaryEquivalence, "NOT_ESTABLISHED");
    assert.equal(result.limitations.admission, "NOT_AUTHORIZED");
  }
});

test("source pin rejects the same package substitution in both report formats", () => {
  const changed = pairsFor("volume"); changed[0] = ["substituted", changed[0][1]];
  assert.throws(() => validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume", changed),
    sbom: sbomFor("volume", changed), metadata, artifactName: "/volume", now }),
  /scanner_seaweed_rust_inventory_mismatch/u);
});

for (const [label, transformReport, transformSbom] of [
  ["JSON omission", (pairs) => pairs.slice(1), (pairs) => pairs],
  ["CycloneDX omission", (pairs) => pairs, (pairs) => pairs.slice(1)],
  ["JSON duplication", (pairs) => [...pairs.slice(0, -1), pairs[0]], (pairs) => pairs],
  ["CycloneDX duplication", (pairs) => pairs, (pairs) => [...pairs.slice(0, -1), pairs[0]]],
]) {
  test(`source inventory rejects ${label}`, () => {
    const original = pairsFor("volume"), reportPairs = transformReport(original), sbomPairs = transformSbom(original);
    assert.throws(() => validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume", reportPairs),
      sbom: sbomFor("volume", sbomPairs), metadata, artifactName: "/volume", now }), error);
  });
}

test("source SBOM refuses a library with no retained dependency relation", () => {
  const sbom = sbomFor("volume");
  const lost = sbom.components.find((entry) => entry.type === "library")["bom-ref"];
  sbom.dependencies = sbom.dependencies.filter((entry) => entry.ref !== lost);
  assert.throws(() => validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume"), sbom, metadata,
    artifactName: "/volume", now }), /scanner_seaweed_rust_sbom_invalid/u);
});

test("pinned Trivy filesystem SBOM accepts application root and omitted empty leaf dependencies", () => {
  const sbom = sbomFor("volume");
  assert.equal(sbom.metadata.component.type, "application");
  assert.equal(Object.hasOwn(sbom.dependencies.at(-1), "dependsOn"), false);
  const result = validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume"), sbom, metadata,
    artifactName: "/volume", now });
  assert.equal(result.result, "passed");
  sbom.dependencies.at(-1).dependsOn = [];
  assert.equal(validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume"), sbom, metadata,
    artifactName: "/volume", now }).result, "passed");
});

for (const type of ["filesystem", "container"]) {
  test(`filesystem SBOM refuses a substituted ${type} metadata root`, () => {
    const sbom = sbomFor("volume"); sbom.metadata.component.type = type;
    assert.throws(() => validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume"), sbom, metadata,
      artifactName: "/volume", now }), /scanner_seaweed_rust_sbom_invalid/u);
  });
}

for (const dependsOn of [null, {}, "foreign"]) {
  test(`filesystem SBOM refuses malformed dependency targets ${JSON.stringify(dependsOn)}`, () => {
    const sbom = sbomFor("volume"); sbom.dependencies.at(-1).dependsOn = dependsOn;
    assert.throws(() => validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume"), sbom, metadata,
      artifactName: "/volume", now }), /scanner_seaweed_rust_sbom_invalid/u);
  });
}

test("source SBOM rejects object-shaped component properties with the typed SBOM error", () => {
  const sbom = sbomFor("volume");
  sbom.components[0].properties = { name: "aquasecurity:trivy:Class", value: "lang-pkgs" };
  assert.throws(() => validateSeaweedRustLockUniverse({ role: "volume", report: reportFor("volume"), sbom, metadata,
    artifactName: "/volume", now }), /scanner_seaweed_rust_sbom_invalid/u);
});

test("source findings retain the existing blocking policy codes", () => {
  const [Name, Version] = pairsFor("volume")[0];
  const report = reportFor("volume", undefined, [{ VulnerabilityID: "CVE-TEST", PkgName: Name, InstalledVersion: Version,
    Severity: "HIGH", FixedVersion: "9.9.9" }]);
  const result = validateSeaweedRustLockUniverse({ role: "volume", report, sbom: sbomFor("volume"), metadata,
    artifactName: "/volume", now });
  assert.equal(result.result, "rejected");
  assert.deepEqual(result.blockers.map((entry) => entry.code), ["image_vulnerability_blocked"]);
});

test("helper container creation is stopped, resource bounded and grants no execution path", () => {
  const args = helperContainerCreateArguments({ name: containerName, owner, imageId });
  assert.deepEqual(args.slice(0, 2), ["container", "create"]);
  for (const required of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
    "--user", "--pids-limit", "--memory", "--memory-swap", "--cpus", imageId]) assert.ok(args.includes(required), required);
  for (const forbidden of ["run", "start", "exec", "--privileged", "--network=host"]) assert.equal(args.includes(forbidden), false, forbidden);
});

test("helper copy uses only Bash soft limits and exact docker container cp arguments", () => {
  const role = metadata.roles[0], destination = path.resolve("synthetic-rust", "weed-volume");
  const value = helperCopyCommand({ containerName, sourcePath: role.helper.path, destination, expectedBytes: role.helper.bytes,
    home: path.resolve("synthetic-rust", "home"), temporary: path.resolve("synthetic-rust", "tmp") });
  assert.equal(value.command, "/usr/bin/bash");
  assert.equal(value.timeoutMs, 90_000);
  assert.equal(value.expectedStdout, "");
  assert.deepEqual(Object.keys(value.environment).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ"]);
  const script = value.args[value.args.indexOf("-c") + 1];
  assert.match(script, /ulimit -Sf/u);
  assert.match(script, /exec \/usr\/bin\/docker container cp -q/u);
  assert.doesNotMatch(script, /docker (?:run|start|exec)|sha256sum|\/usr\/bin\/stat/u);
  assert.equal(value.args.includes(containerName), true);
  assert.equal(value.args.includes(role.helper.path), true);
  assert.equal(value.args.includes(destination), true);
});

test("helper copy refuses every non-reviewed candidate path", () => {
  assert.throws(() => helperCopyCommand({ containerName, sourcePath: "/bin/sh", destination: path.resolve("synthetic-rust", "sh"),
    expectedBytes: 1, home: path.resolve("synthetic-rust"), temporary: path.resolve("synthetic-rust") }),
  /scanner_seaweed_rust_helper_arguments_invalid/u);
});

test("helper container validator accepts only the exact never-started owned container", () => {
  const inspected = [{ Id: "a".repeat(64), Name: `/${containerName}`, Image: imageId,
    Config: { Labels: { "io.auto-world.seaweed-rust": owner } },
    State: { Status: "created", Running: false, Pid: 0, Restarting: false, Dead: false, StartedAt: "0001-01-01T00:00:00Z" }, Mounts: [] }];
  assert.deepEqual(validateSeaweedRustHelperContainer({ inspected, name: containerName, owner, imageId }),
    { containerId: "a".repeat(64), anonymousVolumes: [] });
});

for (const [label, mutate] of [
  ["started state", (value) => { value[0].State.Status = "running"; value[0].State.Running = true; }],
  ["substituted image", (value) => { value[0].Image = metadata.image.platformDigest; }],
  ["masked helper path", (value) => { value[0].Mounts = [{ Type: "volume", Name: "b".repeat(64), Destination: "/usr/bin" }]; }],
]) {
  test(`helper container validator rejects ${label}`, () => {
    const inspected = [{ Id: "a".repeat(64), Name: `/${containerName}`, Image: imageId,
      Config: { Labels: { "io.auto-world.seaweed-rust": owner } },
      State: { Status: "created", Running: false, Pid: 0, Restarting: false, Dead: false, StartedAt: "0001-01-01T00:00:00Z" }, Mounts: [] }];
    const changed = clone(inspected); mutate(changed);
    assert.throws(() => validateSeaweedRustHelperContainer({ inspected: changed, name: containerName, owner, imageId }),
      /scanner_seaweed_rust_helper_container_invalid/u);
  });
}

test("helper measurement binds exact host-copy type, mode, link count, size and hash", () => {
  const role = metadata.roles[0], file = path.resolve("synthetic-rust", "weed-volume");
  const input = { role: role.role, file, info: { isFile: true, isSymbolicLink: false, nlink: 1, mode: 0o755 },
    identity: { size: role.helper.bytes, sha256: role.helper.sha256 }, metadata };
  const result = validateSeaweedRustHelperMeasurement(input);
  assert.equal(result.result, "passed");
  assert.equal(result.intrinsicBinaryInventory, "NOT_ESTABLISHED");
});

for (const [label, mutate] of [
  ["symbolic link", (value) => { value.info.isSymbolicLink = true; }], ["multiple hard links", (value) => { value.info.nlink = 2; }],
  ["writable mode", (value) => { value.info.mode = 0o777; }], ["wrong size", (value) => { value.identity.size -= 1; }],
  ["wrong hash", (value) => { value.identity.sha256 = "a".repeat(64); }],
]) {
  test(`helper measurement rejects ${label}`, () => {
    const role = metadata.roles[0], file = path.resolve("synthetic-rust", "weed-volume");
    const input = { role: role.role, file, info: { isFile: true, isSymbolicLink: false, nlink: 1, mode: 0o755 },
      identity: { size: role.helper.bytes, sha256: role.helper.sha256 }, metadata };
    const changed = clone(input); mutate(changed);
    assert.throws(() => validateSeaweedRustHelperMeasurement(changed), /scanner_seaweed_rust_helper_measurement_invalid/u);
  });
}

test("production helper measurement converts a real hardlink into the typed measurement refusal", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-hardlink-"));
  try {
    const source = path.join(root, "source.bin");
    const linked = path.join(root, "linked.bin");
    writeFileSync(source, Buffer.from("inert-helper"), { flag: "wx" });
    linkSync(source, linked);
    assert.equal(statSync(linked).nlink, 2);
    await assert.rejects(measureSeaweedRustHelperFile(linked), /scanner_seaweed_rust_helper_measurement_invalid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production helper measurement converts a real directory into the typed measurement refusal", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-directory-"));
  try {
    const directory = path.join(root, "helper-directory");
    mkdirSync(directory);
    await assert.rejects(measureSeaweedRustHelperFile(directory), /scanner_seaweed_rust_helper_measurement_invalid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production helper measurement preserves native ENOENT without scanner normalization", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-missing-"));
  try {
    const missing = path.join(root, "missing-helper");
    await assert.rejects(measureSeaweedRustHelperFile(missing),
      (failure) => failure?.code === "ENOENT" && !String(failure.message).includes("scanner_"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production helper measurement preserves a native argument TypeError", async () => {
  await assert.rejects(measureSeaweedRustHelperFile(42),
    (failure) => failure instanceof TypeError && failure.code === "ERR_INVALID_ARG_TYPE");
});

test("production helper measurement rejects a real broken symlink without reading its target",
  { skip: process.platform === "win32" }, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-symlink-"));
    try {
      const linked = path.join(root, "linked-helper");
      symlinkSync("missing-target", linked);
      await assert.rejects(measureSeaweedRustHelperFile(linked), /scanner_seaweed_rust_helper_measurement_invalid/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

function helperCollectorFixture(overrides = {}) {
  const containerId = "a".repeat(64);
  const inspected = [{ Id: containerId, Name: `/${containerName}`, Image: imageId,
    Config: { Labels: { "io.auto-world.seaweed-rust": owner } },
    State: { Status: "created", Running: false, Pid: 0, Restarting: false, Dead: false, StartedAt: "0001-01-01T00:00:00Z" }, Mounts: [] }];
  const events = [];
  const operations = {
    softLimitControl: async (command) => { events.push(["soft", command]); },
    create: async (args) => { events.push(["create", args]); return `${containerId}\n`; },
    inspect: async (name) => { events.push(["inspect", name]); return clone(inspected); },
    copy: async (command) => { events.push(["copy", command]); },
    measure: async ({ role, file }) => {
      events.push(["measure", role, file]); const entry = metadata.roles.find((value) => value.role === role);
      return { info: { isFile: true, isSymbolicLink: false, nlink: 1, mode: 0o755 },
        identity: { size: entry.helper.bytes, sha256: entry.helper.sha256 } };
    },
    listHostFiles: async (directory) => { events.push(["list", directory]); return ["weed-worker", "weed-volume"]; },
    remove: async (args) => { events.push(["remove", args]); },
    proveAbsent: async (name) => { events.push(["absent", name]); return { status: 1, signal: null,
      stderr: Buffer.from(`Error response from daemon: No such container: ${name}`) }; },
    ...overrides,
  };
  const input = { metadata, imageId, imageReport: { Metadata: { ImageID: imageId } }, directory: path.resolve("synthetic-rust", "helpers"),
    limitDirectory: path.resolve("synthetic-rust", "limit-control"), name: containerName, owner, freeBytes: 1024 ** 3 };
  return { containerId, events, input, inspected, operations };
}

test("helper collector performs the finite stopped-container sequence and proves cleanup", async () => {
  const item = helperCollectorFixture();
  const result = await collectSeaweedRustHelperIdentity(item.input, item.operations);
  assert.equal(result.result, "passed");
  assert.equal(result.measurements.length, 2);
  assert.deepEqual(result.journal.map((entry) => entry.operation), ["soft_limit_control", "create", "inspect_created", "copy_volume",
    "inspect_volume", "measure_volume", "copy_worker", "inspect_worker", "measure_worker", "revalidate_volume", "revalidate_worker",
    "remove_owned", "prove_absent"]);
  assert.deepEqual(item.events.map((entry) => entry[0]), ["soft", "create", "inspect", "copy", "inspect", "measure", "copy", "inspect",
    "measure", "list", "measure", "measure", "remove", "absent"]);
  const remove = item.events.find((entry) => entry[0] === "remove")[1];
  assert.deepEqual(remove, ["container", "rm", "--volumes", item.containerId]);
});

test("helper collector isolates soft-limit control files from the helper copy directory", async () => {
  const item = helperCollectorFixture();
  await collectSeaweedRustHelperIdentity(item.input, item.operations);
  const softLimitArguments = item.events.find((entry) => entry[0] === "soft")[1].args;
  assert.deepEqual(softLimitArguments.slice(-2), [
    path.join(item.input.limitDirectory, "soft-limit-within.bin"),
    path.join(item.input.limitDirectory, "soft-limit-overflow.bin"),
  ]);
});

test("helper collector rejects the platform manifest digest as Docker image identity", async () => {
  const item = helperCollectorFixture();
  item.input.imageId = metadata.image.platformDigest;
  item.input.imageReport.Metadata.ImageID = metadata.image.platformDigest;
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_arguments_invalid/u);
});

test("helper collector uses recovered exact ownership only for cleanup and preserves a lost create failure", async () => {
  const item = helperCollectorFixture({ create: async () => { item.events.push(["create-lost"]); throw new Error("transport_response_lost"); } });
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations), /transport_response_lost/u);
  assert.equal(item.events.filter((entry) => entry[0] === "create-lost").length, 1);
  assert.equal(item.events.some((entry) => entry[0] === "copy" || entry[0] === "measure"), false);
  assert.equal(item.events.some((entry) => entry[0] === "remove"), true);
  assert.equal(item.events.some((entry) => entry[0] === "absent"), true);
});

test("helper collector retains a worker success after a known volume copy refusal and cleans up once", async () => {
  const copyFailure = new Error("scanner_seaweed_rust_helper_copy_failed");
  const item = helperCollectorFixture({
    copy: async (command) => {
      if (command.args.includes(metadata.roles[0].helper.path)) { item.events.push(["copy-volume-failed"]); throw copyFailure; }
      item.events.push(["copy", command]);
    },
    listHostFiles: async () => ["weed-volume", "weed-worker"],
  });
  const result = await collectSeaweedRustHelperIdentity(item.input, item.operations);
  assert.equal(result.result, "rejected");
  assert.deepEqual(result.measurements.map(({ role, result: status }) => [role, status]), [["volume", "rejected"], ["worker", "passed"]]);
  assert.equal(item.events.filter((entry) => entry[0] === "measure" && entry[1] === "worker").length, 2);
  assert.equal(item.events.filter((entry) => entry[0] === "remove").length, 1);
  assert.equal(item.events.filter((entry) => entry[0] === "absent").length, 1);
  const receipt = postImageReceipt();
  populateRustEvidence(receipt);
  receipt.seaweedRustHelpers = result.measurements;
  const runtimeEvents = [];
  const subjectFailure = new Error(result.measurements[0].reason);
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => ({ failure: subjectFailure }),
    producedImageRuntime: async () => { runtimeEvents.push("runtime"); },
  }), (failure) => failure === subjectFailure);
  assert.deepEqual(runtimeEvents, []);
  assert.deepEqual(receipt.phases.at(-1).result, "failed");
});

test("helper collector preserves and revalidates volume after a known worker copy refusal", async () => {
  const copyFailure = new Error("scanner_seaweed_rust_helper_copy_failed");
  const item = helperCollectorFixture({
    copy: async (command) => {
      if (command.args.includes(metadata.roles[1].helper.path)) { item.events.push(["copy-worker-failed"]); throw copyFailure; }
      item.events.push(["copy", command]);
    },
    listHostFiles: async () => ["weed-volume"],
  });
  const result = await collectSeaweedRustHelperIdentity(item.input, item.operations);
  assert.equal(result.result, "rejected");
  assert.deepEqual(result.measurements.map(({ role, result: status }) => [role, status]), [["volume", "passed"], ["worker", "rejected"]]);
  assert.equal(item.events.filter((entry) => entry[0] === "measure" && entry[1] === "volume").length, 2);
  assert.equal(item.events.filter((entry) => entry[0] === "remove").length, 1);
  assert.equal(item.events.filter((entry) => entry[0] === "absent").length, 1);
});

test("helper collector uses real hardlink measurement to reject volume while preserving and revalidating worker", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-collector-hardlink-"));
  try {
    const helpers = path.join(root, "helpers");
    mkdirSync(helpers);
    const volumeSource = path.join(root, "volume-source.bin");
    writeFileSync(volumeSource, Buffer.from("inert-volume-helper"), { flag: "wx" });
    const item = helperCollectorFixture();
    item.input.directory = helpers;
    item.input.limitDirectory = path.join(root, "limit-control");
    item.operations.copy = async (command) => {
      item.events.push(["copy", command]);
      const destination = command.args.at(-1);
      if (command.args.includes(metadata.roles[0].helper.path)) linkSync(volumeSource, destination);
      else writeFileSync(destination, Buffer.from("inert-worker-helper"), { flag: "wx" });
    };
    item.operations.measure = async ({ role, file }) => {
      item.events.push(["measure", role, file]);
      if (role === "volume") return measureSeaweedRustHelperFile(file);
      const expected = metadata.roles.find((entry) => entry.role === role);
      return { info: { isFile: true, isSymbolicLink: false, nlink: 1, mode: 0o755 },
        identity: { size: expected.helper.bytes, sha256: expected.helper.sha256 } };
    };
    item.operations.listHostFiles = async () => readdirSync(helpers);
    const result = await collectSeaweedRustHelperIdentity(item.input, item.operations);
    assert.deepEqual(result.measurements.map(({ role, result: status }) => [role, status]),
      [["volume", "rejected"], ["worker", "passed"]]);
    assert.equal(item.events.filter((entry) => entry[0] === "copy").length, 2);
    assert.equal(item.events.filter((entry) => entry[0] === "measure" && entry[1] === "worker").length, 2);
    assert.equal(item.events.filter((entry) => entry[0] === "remove").length, 1);
    assert.equal(item.events.filter((entry) => entry[0] === "absent").length, 1);
    const receipt = postImageReceipt();
    populateRustEvidence(receipt);
    receipt.seaweedRustHelpers = result.measurements;
    const runtimeEvents = [];
    const subjectFailure = new Error(result.measurements[0].reason);
    await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
      sourceAndHelperAudits: async () => ({ failure: subjectFailure }),
      producedImageRuntime: async () => { runtimeEvents.push("runtime"); },
    }), (failure) => failure === subjectFailure);
    assert.deepEqual(runtimeEvents, []);
    assert.equal(receipt.phases.at(-1).result, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("helper collector reports cleanup uncertainty when owned removal cannot be proven", async () => {
  const item = helperCollectorFixture({ remove: async () => { item.events.push(["remove-failed"]); throw new Error("private failure"); } });
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_cleanup_uncertain/u);
  assert.equal(item.events.some((entry) => entry[0] === "absent"), false);
});

test("helper collector never removes a foreign container after a lost create response", async () => {
  const item = helperCollectorFixture();
  item.operations.create = async () => { item.events.push(["create-lost"]); throw new Error("transport_response_lost"); };
  item.operations.inspect = async () => {
    item.events.push(["inspect-foreign"]);
    return [{ Id: item.containerId, Name: `/${containerName}`, Image: imageId,
      Config: { Labels: { "io.auto-world.seaweed-rust": "foreign-owner" } },
      State: { Status: "created", Running: false, Pid: 0, Restarting: false, Dead: false, StartedAt: "0001-01-01T00:00:00Z" }, Mounts: [] }];
  };
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_cleanup_uncertain/u);
  assert.equal(item.events.some((entry) => entry[0] === "remove"), false);
});

for (const [label, inspect] of [
  ["inspect transport throw", async (item) => { item.events.push(["inspect-throw"]); throw new Error("transport_lost"); }],
  ["non-array inspect response", async (item) => { item.events.push(["inspect-malformed"]); return { Id: item.containerId }; }],
  ["mismatched inspect identity", async (item) => {
    item.events.push(["inspect-mismatch"]);
    const changed = clone(item.inspected);
    changed[0].Config.Labels["io.auto-world.seaweed-rust"] = "foreign-owner";
    return changed;
  }],
]) {
  test(`post-image lifecycle aborts after successful create and ${label} without removing unproven ownership`, async () => {
    const item = helperCollectorFixture();
    item.operations.inspect = () => inspect(item);
    const receipt = postImageReceipt();
    const events = [];
    await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
      sourceAndHelperAudits: async () => {
        events.push("helper-collection");
        await collectSeaweedRustHelperIdentity(item.input, item.operations);
      },
      producedImageRuntime: async () => { events.push("runtime"); },
    }), /scanner_seaweed_rust_helper_cleanup_uncertain/u);
    assert.deepEqual(events, ["helper-collection"]);
    assert.equal(item.events.some((entry) => ["copy", "measure", "remove"].includes(entry[0])), false);
  });
}

test("helper collector treats an absence-proof mismatch as cleanup uncertainty", async () => {
  const item = helperCollectorFixture({ proveAbsent: async () => ({ status: 0, signal: null, stderr: Buffer.alloc(0) }) });
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_cleanup_uncertain/u);
});

test("helper collector proves every owned anonymous volume absent after removal", async () => {
  const item = helperCollectorFixture();
  const volume = "b".repeat(64);
  item.inspected[0].Mounts = [{ Type: "volume", Name: volume, Destination: "/data" }];
  item.operations.proveAbsent = async (name, volumes) => {
    item.events.push(["absent-with-volumes", name, volumes]);
    return {
      container: { status: 1, signal: null, stderr: Buffer.from(`Error response from daemon: No such container: ${name}`) },
      volumes: [{ status: 1, signal: null, stderr: Buffer.from(`Error response from daemon: get ${volume}: no such volume`) }],
    };
  };
  const result = await collectSeaweedRustHelperIdentity(item.input, item.operations);
  assert.equal(result.result, "passed");
  assert.deepEqual(item.events.find((entry) => entry[0] === "absent-with-volumes").slice(2), [[volume]]);
});

test("helper collector rejects cleanup when an owned anonymous volume still exists", async () => {
  const item = helperCollectorFixture();
  const volume = "b".repeat(64);
  item.inspected[0].Mounts = [{ Type: "volume", Name: volume, Destination: "/data" }];
  item.operations.proveAbsent = async (name) => ({
    container: { status: 1, signal: null, stderr: Buffer.from(`Error response from daemon: No such container: ${name}`) },
    volumes: [{ status: 0, signal: null, stderr: Buffer.alloc(0) }],
  });
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_cleanup_uncertain/u);
});

test("helper collector treats a missing container after a lost create response as cleanup uncertainty", async () => {
  const item = helperCollectorFixture({
    create: async () => { throw new Error("transport_response_lost"); },
    inspect: async () => [],
  });
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_cleanup_uncertain/u);
});

test("helper collector rejects an incomplete host materialization before cleanup", async () => {
  const item = helperCollectorFixture({ listHostFiles: async () => ["weed-volume"] });
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_inventory_invalid/u);
  assert.equal(item.events.some((entry) => entry[0] === "remove"), true);
});

test("helper collector rejects only the helper changed at final revalidation and preserves its sibling", async () => {
  const calls = new Map();
  const item = helperCollectorFixture({
    measure: async ({ role, file }) => {
      item.events.push(["measure", role, file]);
      const count = (calls.get(role) ?? 0) + 1;
      calls.set(role, count);
      const entry = metadata.roles.find((value) => value.role === role);
      return { info: { isFile: true, isSymbolicLink: false, nlink: 1, mode: 0o755 },
        identity: { size: entry.helper.bytes, sha256: role === "volume" && count === 2 ? "a".repeat(64) : entry.helper.sha256 } };
    },
  });
  const result = await collectSeaweedRustHelperIdentity(item.input, item.operations);
  assert.equal(result.result, "rejected");
  assert.deepEqual(result.measurements.map(({ role, result: status }) => [role, status]), [["volume", "rejected"], ["worker", "passed"]]);
  assert.deepEqual([...calls.entries()], [["volume", 2], ["worker", 2]]);
  assert.equal(item.events.some((entry) => entry[0] === "remove"), true);
  assert.equal(item.events.some((entry) => entry[0] === "absent"), true);
  const receipt = postImageReceipt();
  populateRustEvidence(receipt);
  receipt.seaweedRustHelpers = result.measurements;
  const runtimeEvents = [];
  const subjectFailure = new Error(result.measurements[0].reason);
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => ({ failure: subjectFailure }),
    producedImageRuntime: async () => { runtimeEvents.push("runtime"); },
  }), (failure) => failure === subjectFailure);
  assert.deepEqual(runtimeEvents, []);
});

test("post-image lifecycle preserves a post-copy inspect signal through cleanup and stops the helper sibling", async () => {
  const item = helperCollectorFixture();
  let inspectCount = 0;
  const signalled = new Error("scanner_official_command_failed");
  item.operations.inspect = async () => {
    inspectCount += 1;
    if (inspectCount === 1) return clone(item.inspected);
    throw classifySeaweedRustHelperCommandFailure({ error: signalled,
      record: { error: null, signal: "SIGKILL", exitCode: null }, operation: "inspect" });
  };
  const receipt = postImageReceipt();
  const events = [];
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => {
      events.push("helper-collection");
      await collectSeaweedRustHelperIdentity(item.input, item.operations);
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === signalled);
  assert.deepEqual(events, ["helper-collection"]);
  assert.equal(item.events.filter((entry) => entry[0] === "copy").length, 1);
  assert.equal(item.events.filter((entry) => entry[0] === "remove").length, 1);
  assert.equal(item.events.filter((entry) => entry[0] === "absent").length, 1);
});

test("helper collector refuses an arbitrary command callback in its authority surface", async () => {
  const item = helperCollectorFixture();
  item.operations.command = async () => {};
  await assert.rejects(collectSeaweedRustHelperIdentity(item.input, item.operations),
    /scanner_seaweed_rust_helper_arguments_invalid/u);
});

test("Linux inert control proves the soft file limit rejects overflow", { skip: process.platform !== "linux" }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-rust-soft-limit-"));
  try {
    const value = helperSoftLimitControlCommand({ directory });
    const result = spawnSync(value.command, value.args, { env: value.environment, encoding: "utf8", timeout: value.timeoutMs });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, value.expectedStdout);
    assert.equal(statSync(path.join(directory, "soft-limit-within.bin")).size, 2048);
    assert.ok(statSync(path.join(directory, "soft-limit-overflow.bin")).size <= 2048);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("subject failure classifier retains the exact known business refusal", () => {
  const failure = new Error("scanner_seaweed_rust_inventory_mismatch");
  assert.equal(classifySeaweedRustSubjectFailure(failure, "source"), failure);
});

test("helper command classifier converts only an ordinary nonzero copy exit into a collectable helper refusal", () => {
  const commandFailure = new Error("scanner_official_command_failed");
  const classified = classifySeaweedRustHelperCommandFailure({ error: commandFailure,
    record: { error: null, signal: null, exitCode: 1 }, operation: "copy" });
  assert.equal(classified.message, "scanner_seaweed_rust_helper_copy_failed");
  assert.equal(classified.cause, commandFailure);
  assert.equal(classifySeaweedRustSubjectFailure(classified, "helper"), classified);
});

for (const [label, failure] of [
  ["unknown scanner code", new Error("scanner_seaweed_rust_unknown_failure")],
  ["filesystem ENOSPC", Object.assign(new Error("disk full"), { code: "ENOSPC" })],
  ["programming TypeError", new TypeError("unexpected shape")],
]) {
  test(`subject failure classifier rethrows the identical ${label}`, () => {
    assert.throws(() => classifySeaweedRustSubjectFailure(failure, "source"), (error) => error === failure);
  });
}

function completeGate() {
  return { originalReports: Array.from({ length: 5 }, (_, index) => ({ role: `role-${index}`, result: "passed", findingCount: 0, blockerCount: 0 })),
    controls: ["cargo-lock-vulnerable", "cargo-lock-clean"].map((role) => ({ role, result: "passed" })),
    sourceAudits: ["volume", "worker"].map((role) => ({ role, result: "passed", blockers: [] })),
    helpers: ["volume", "worker"].map((role) => ({ role, result: "passed" })),
    managedBuilds: ["postgres", "opensearch", "aws-cli"].map((role) => ({ role, result: "passed", evidenceExport: "passed" })) };
}

function postImageReceipt({ originalBlocked = false } = {}) {
  const gate = completeGate();
  return {
    reports: gate.originalReports.map((report, index) => originalBlocked && index === 0 ? { ...report, result: "rejected" } : report),
    rejections: originalBlocked ? [{ role: "role-0", reason: "scanner_official_images_blocked" }] : [],
    builds: gate.managedBuilds,
    phases: originalBlocked ? [{ name: "five_image_audits", result: "failed", reason: "scanner_official_images_blocked" }] : [],
  };
}

function populateRustEvidence(receipt) {
  const gate = completeGate();
  receipt.seaweedRustControls = gate.controls;
  receipt.seaweedRustSourceAudits = gate.sourceAudits;
  receipt.seaweedRustHelpers = gate.helpers;
}

test("post-image lifecycle invokes runtime once after every original and Rust gate passes", async () => {
  const receipt = postImageReceipt();
  const events = [];
  const result = await runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => { events.push("rust-evidence"); populateRustEvidence(receipt); return { failure: null }; },
    producedImageRuntime: async () => { events.push("runtime"); return "runtime-complete"; },
  });
  assert.equal(result, "runtime-complete");
  assert.deepEqual(events, ["rust-evidence", "runtime"]);
  assert.equal(receipt.seaweedRustGate.runtimeEligibleDiagnosticOnly, true);
});

test("post-image lifecycle collects Rust sibling evidence before preserving the named original-image failure", async () => {
  const receipt = postImageReceipt({ originalBlocked: true });
  const events = [];
  const original = deferManagedImageAuditFailure({ scope: "managed", cleanupUncertain: false,
    error: new Error("scanner_official_images_blocked") });
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: original }, {
    sourceAndHelperAudits: async () => {
      events.push("rust-evidence");
      populateRustEvidence(receipt);
      return { failure: null };
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === original);
  assert.deepEqual(events, ["rust-evidence"]);
  assert.deepEqual([receipt.seaweedRustControls.length, receipt.seaweedRustSourceAudits.length,
    receipt.seaweedRustHelpers.length], [2, 2, 2]);
  assert.deepEqual(receipt.phases[0], { name: "five_image_audits", result: "failed", reason: "scanner_official_images_blocked" });
});

test("post-image lifecycle preserves the original-image failure ahead of a collected Rust subject failure", async () => {
  const receipt = postImageReceipt({ originalBlocked: true });
  const events = [];
  const original = new Error("scanner_official_images_blocked");
  const subject = new Error("scanner_seaweed_rust_policy_blocked");
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: original }, {
    sourceAndHelperAudits: async () => {
      events.push("rust-evidence");
      populateRustEvidence(receipt);
      receipt.seaweedRustSourceAudits[0] = { ...receipt.seaweedRustSourceAudits[0], result: "rejected" };
      return { failure: subject };
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === original);
  assert.deepEqual(events, ["rust-evidence"]);
  assert.deepEqual([receipt.seaweedRustControls.length, receipt.seaweedRustSourceAudits.length,
    receipt.seaweedRustHelpers.length], [2, 2, 2]);
});

test("post-image lifecycle records a collected Rust subject failure as a failed phase after retaining sibling evidence", async () => {
  const receipt = postImageReceipt({ originalBlocked: true });
  const events = [];
  const original = new Error("scanner_official_images_blocked");
  const subject = new Error("scanner_seaweed_rust_policy_blocked");
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: original }, {
    sourceAndHelperAudits: async () => {
      events.push("rust-evidence");
      populateRustEvidence(receipt);
      receipt.seaweedRustSourceAudits[0] = { ...receipt.seaweedRustSourceAudits[0], result: "rejected" };
      return { failure: subject };
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === original);
  assert.deepEqual(events, ["rust-evidence"]);
  assert.deepEqual([receipt.seaweedRustControls.length, receipt.seaweedRustSourceAudits.length,
    receipt.seaweedRustHelpers.length], [2, 2, 2]);
  assert.deepEqual(receipt.phases.slice(0, 2).map(({ name, result, reason }) => ({ name, result, reason })), [
    { name: "five_image_audits", result: "failed", reason: "scanner_official_images_blocked" },
    { name: "seaweed_rust_source_and_helper_audits", result: "failed", reason: "scanner_seaweed_rust_policy_blocked" },
  ]);
  assert.equal(Number.isSafeInteger(receipt.phases[1].durationMs) && receipt.phases[1].durationMs >= 0, true);
});

test("post-image lifecycle preserves a collected Rust subject failure when original images passed", async () => {
  const receipt = postImageReceipt();
  const events = [];
  const subject = new Error("scanner_seaweed_rust_policy_blocked");
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => {
      events.push("rust-evidence");
      populateRustEvidence(receipt);
      receipt.seaweedRustSourceAudits[0] = { ...receipt.seaweedRustSourceAudits[0], result: "rejected" };
      return { failure: subject };
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === subject);
  assert.deepEqual(events, ["rust-evidence"]);
});

test("post-image lifecycle aborts a global Rust-audit integrity failure without invoking runtime", async () => {
  const receipt = postImageReceipt();
  const events = [];
  const globalFailure = new Error("scanner_official_database_changed");
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => { events.push("rust-evidence"); throw globalFailure; },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === globalFailure);
  assert.deepEqual(events, ["rust-evidence"]);
});

test("post-image lifecycle preserves an immediate global integrity failure ahead of a deferred original-image failure", async () => {
  const receipt = postImageReceipt({ originalBlocked: true });
  const events = [];
  const original = new Error("scanner_official_images_blocked");
  const globalFailure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: original }, {
    sourceAndHelperAudits: async () => {
      events.push("rust-evidence");
      classifySeaweedRustSubjectFailure(globalFailure, "source");
      events.push("source-sibling");
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === globalFailure);
  assert.deepEqual(events, ["rust-evidence"]);
});

test("post-image lifecycle preserves a copy transport error after cleanup and ahead of a deferred original failure", async () => {
  const receipt = postImageReceipt({ originalBlocked: true });
  const events = [];
  const original = new Error("scanner_official_images_blocked");
  const transport = Object.assign(new Error("scanner_official_command_failed"), { code: "ENOSPC" });
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: original }, {
    sourceAndHelperAudits: async () => {
      events.push("copy-failed");
      const classified = classifySeaweedRustHelperCommandFailure({ error: transport,
        record: { error: "ENOSPC", signal: null, exitCode: null }, operation: "copy" });
      events.push("cleanup-succeeded");
      classifySeaweedRustSubjectFailure(classified, "helper");
      events.push("helper-sibling");
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === transport);
  assert.deepEqual(events, ["copy-failed", "cleanup-succeeded"]);
});

test("post-image lifecycle preserves a create signal after cleanup and stops helper siblings and runtime", async () => {
  const receipt = postImageReceipt();
  const events = [];
  const signalled = new Error("scanner_official_command_failed");
  await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
    sourceAndHelperAudits: async () => {
      events.push("create-failed");
      const classified = classifySeaweedRustHelperCommandFailure({ error: signalled,
        record: { error: null, signal: "SIGKILL", exitCode: null }, operation: "create" });
      events.push("cleanup-succeeded");
      classifySeaweedRustSubjectFailure(classified, "helper");
      events.push("helper-sibling");
    },
    producedImageRuntime: async () => { events.push("runtime"); },
  }), (failure) => failure === signalled);
  assert.deepEqual(events, ["create-failed", "cleanup-succeeded"]);
});

test("production Rust audit publisher writes both role report pairs into one owned audits directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-report-pairs-"));
  try {
    const directory = path.join(root, "audits");
    const sources = new Map();
    for (const role of ["volume", "worker"]) {
      for (const format of ["json", "cdx.json"]) {
        const file = path.join(root, `${role}-source.${format}`);
        const bytes = Buffer.from(`${role}:${format}\n`);
        writeFileSync(file, bytes, { flag: "wx" });
        sources.set(`${role}.${format}`, { file, bytes });
      }
    }
    const receipts = ["volume", "worker"].map((role) => exportSeaweedRustAuditReportPair({ directory, role,
      jsonFile: sources.get(`${role}.json`).file, cyclonedxFile: sources.get(`${role}.cdx.json`).file }));
    assert.deepEqual(readdirSync(directory).sort(), ["volume.cdx.json", "volume.json", "worker.cdx.json", "worker.json"]);
    assert.deepEqual(receipts, ["volume", "worker"].map((role) => ({ role, jsonFile: path.join(directory, `${role}.json`),
      cyclonedxFile: path.join(directory, `${role}.cdx.json`) })));
    for (const receipt of receipts) {
      assert.deepEqual(readFileSync(receipt.jsonFile), sources.get(`${receipt.role}.json`).bytes);
      assert.deepEqual(readFileSync(receipt.cyclonedxFile), sources.get(`${receipt.role}.cdx.json`).bytes);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production clean-control audit preserves valid JSON bytes when a new HIGH finding closes the gate", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-clean-refusal-"));
  try {
    const [name, version] = pairsFor("cargo-lock-clean")[0];
    const report = reportFor("cargo-lock-clean", undefined, [{ VulnerabilityID: "CVE-2099-0002", PkgName: name,
      InstalledVersion: version, Severity: "HIGH", FixedVersion: "9.9.9" }]);
    const bytes = Buffer.from(JSON.stringify(report));
    const file = path.join(root, "clean-source.json");
    const directory = path.join(root, "audits");
    writeFileSync(file, bytes, { flag: "wx" });
    const receipt = postImageReceipt();
    const events = [];
    let collectedFailure;
    await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
      sourceAndHelperAudits: async () => {
        const outcome = await auditAndPublishSeaweedRustControlReport({ control: "cargo-lock-clean", file, directory,
          metadata, artifactName: "/cargo-lock-clean", now });
        collectedFailure = outcome.failure;
        events.push("clean-collected");
        populateRustEvidence(receipt);
        receipt.seaweedRustControls[1] = { role: "cargo-lock-clean", result: "rejected", reason: outcome.failure.message };
        return { failure: outcome.failure };
      },
      producedImageRuntime: async () => { events.push("runtime"); },
    }), (failure) => failure === collectedFailure);
    assert.equal(collectedFailure.message, "scanner_seaweed_rust_control_blocked");
    assert.deepEqual(events, ["clean-collected"]);
    assert.deepEqual(readFileSync(path.join(directory, "cargo-lock-clean.json")), bytes);
    assert.equal(receipt.seaweedRustGate, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production source audit preserves both report bytes when inventory mismatch closes the gate", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-source-refusal-"));
  try {
    const changed = pairsFor("volume");
    changed[0] = ["substituted", changed[0][1]];
    const jsonBytes = Buffer.from(JSON.stringify(reportFor("volume", changed)));
    const sbomBytes = Buffer.from(JSON.stringify(sbomFor("volume", changed)));
    const files = { json: path.join(root, "volume-source.json"), sbom: path.join(root, "volume-source.cdx.json") };
    writeFileSync(files.json, jsonBytes, { flag: "wx" });
    writeFileSync(files.sbom, sbomBytes, { flag: "wx" });
    const directory = path.join(root, "audits");
    const receipt = postImageReceipt();
    const events = [];
    let collectedFailure;
    await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
      sourceAndHelperAudits: async () => {
        const outcome = await auditAndPublishSeaweedRustSourceReports({ role: "volume", files, directory,
          metadata, artifactName: "/volume", now });
        collectedFailure = outcome.failure;
        events.push("source-collected");
        populateRustEvidence(receipt);
        receipt.seaweedRustSourceAudits[0] = { role: "volume", result: "rejected", blockers: [], reason: outcome.failure.message };
        return { failure: outcome.failure };
      },
      producedImageRuntime: async () => { events.push("runtime"); },
    }), (failure) => failure === collectedFailure);
    assert.equal(collectedFailure.message, "scanner_seaweed_rust_inventory_mismatch");
    assert.deepEqual(events, ["source-collected"]);
    assert.deepEqual(readFileSync(path.join(directory, "volume.json")), jsonBytes);
    assert.deepEqual(readFileSync(path.join(directory, "volume.cdx.json")), sbomBytes);
    assert.equal(receipt.seaweedRustGate, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production control audit skips malformed JSON publication and continues the sibling control", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-invalid-json-"));
  try {
    const invalid = path.join(root, "invalid.json");
    const clean = path.join(root, "clean.json");
    const directory = path.join(root, "audits");
    const cleanBytes = Buffer.from(JSON.stringify(reportFor("cargo-lock-clean")));
    writeFileSync(invalid, Buffer.from("{invalid"), { flag: "wx" });
    writeFileSync(clean, cleanBytes, { flag: "wx" });
    const receipt = postImageReceipt();
    const events = [];
    let invalidFailure;
    await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
      sourceAndHelperAudits: async () => {
        const invalidOutcome = await auditAndPublishSeaweedRustControlReport({ control: "cargo-lock-vulnerable", file: invalid,
          directory, metadata, artifactName: "/cargo-lock-vulnerable", now });
        invalidFailure = invalidOutcome.failure;
        events.push("invalid-control-collected");
        const cleanOutcome = await auditAndPublishSeaweedRustControlReport({ control: "cargo-lock-clean", file: clean,
          directory, metadata, artifactName: "/cargo-lock-clean", now });
        events.push("clean-control-collected");
        populateRustEvidence(receipt);
        receipt.seaweedRustControls = [
          { role: "cargo-lock-vulnerable", result: "rejected", reason: invalidOutcome.failure.message }, cleanOutcome.result,
        ];
        return { failure: invalidOutcome.failure };
      },
      producedImageRuntime: async () => { events.push("runtime"); },
    }), (failure) => failure === invalidFailure);
    assert.equal(invalidFailure.message, "scanner_json_file_invalid");
    assert.deepEqual(events, ["invalid-control-collected", "clean-control-collected"]);
    assert.equal(existsSync(path.join(directory, "cargo-lock-vulnerable.json")), false);
    assert.deepEqual(readFileSync(path.join(directory, "cargo-lock-clean.json")), cleanBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production source audit skips a malformed pair and still publishes the sibling role before closing runtime", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-rust-invalid-source-"));
  try {
    const volumeFiles = { json: path.join(root, "volume.json"), sbom: path.join(root, "volume.cdx.json") };
    const workerFiles = { json: path.join(root, "worker.json"), sbom: path.join(root, "worker.cdx.json") };
    const workerJsonBytes = Buffer.from(JSON.stringify(reportFor("worker")));
    const workerSbomBytes = Buffer.from(JSON.stringify(sbomFor("worker")));
    writeFileSync(volumeFiles.json, Buffer.from("{invalid"), { flag: "wx" });
    writeFileSync(volumeFiles.sbom, Buffer.from(JSON.stringify(sbomFor("volume"))), { flag: "wx" });
    writeFileSync(workerFiles.json, workerJsonBytes, { flag: "wx" });
    writeFileSync(workerFiles.sbom, workerSbomBytes, { flag: "wx" });
    const directory = path.join(root, "audits");
    const receipt = postImageReceipt();
    const events = [];
    let invalidFailure;
    await assert.rejects(runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure: null }, {
      sourceAndHelperAudits: async () => {
        const volume = await auditAndPublishSeaweedRustSourceReports({ role: "volume", files: volumeFiles, directory,
          metadata, artifactName: "/volume", now });
        invalidFailure = volume.failure;
        events.push("invalid-volume-collected");
        const worker = await auditAndPublishSeaweedRustSourceReports({ role: "worker", files: workerFiles, directory,
          metadata, artifactName: "/worker", now });
        events.push("worker-collected");
        populateRustEvidence(receipt);
        receipt.seaweedRustSourceAudits = [
          { role: "volume", result: "rejected", blockers: [], reason: volume.failure.message }, worker.result,
        ];
        return { failure: volume.failure };
      },
      producedImageRuntime: async () => { events.push("runtime"); },
    }), (failure) => failure === invalidFailure);
    assert.equal(invalidFailure.message, "scanner_json_file_invalid");
    assert.deepEqual(events, ["invalid-volume-collected", "worker-collected"]);
    assert.equal(existsSync(path.join(directory, "volume.json")), false);
    assert.equal(existsSync(path.join(directory, "volume.cdx.json")), false);
    assert.deepEqual(readFileSync(path.join(directory, "worker.json")), workerJsonBytes);
    assert.deepEqual(readFileSync(path.join(directory, "worker.cdx.json")), workerSbomBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("combined gate authorizes diagnostic runtime only after every reviewed prerequisite passes", () => {
  assert.deepEqual(combineSeaweedRustGate(completeGate()), { result: "passed", runtimeEligibleDiagnosticOnly: true,
    admission: "NOT_AUTHORIZED", milestone2: "NOT_ESTABLISHED" });
});

for (const [label, mutate] of [
  ["original image rejection", (value) => { value.originalReports[0].result = "rejected"; }],
  ["control failure", (value) => { value.controls[0].result = "failed"; }],
  ["source finding", (value) => { value.sourceAudits[0].result = "rejected"; value.sourceAudits[0].blockers = [{ code: "image_vulnerability_blocked" }]; }],
  ["helper failure", (value) => { value.helpers[0].result = "failed"; }],
  ["evidence export failure", (value) => { value.managedBuilds[0].evidenceExport = "failed"; }],
]) {
  test(`combined gate blocks runtime after ${label}`, () => {
    const changed = completeGate(); mutate(changed);
    assert.throws(() => combineSeaweedRustGate(changed), /scanner_seaweed_rust_gate_incomplete/u);
  });
}

function validPublicEvidence() {
  const control = (role, findingCount) => {
    const expected = metadata.controls.find((entry) => entry.role === role);
    return { role, result: "passed", evidenceClass: "RUST_ADVISORY_CONTROL", packageCount: expected.packageCount,
      inventorySha256: expected.canonicalInventorySha256, findingCount, blockerCount: findingCount };
  };
  const sourceAudit = (role) => {
    const expected = metadata.roles.find((entry) => entry.role === role);
    return { role, result: "passed", evidenceClass: "SOURCE_LOCK_AUDIT", scope: "LOCK_UNIVERSE",
      lockSha256: metadata.files.find((entry) => entry.path === expected.lockPath).sha256,
      contextImageDigest: metadata.image.platformDigest, packageCount: expected.packageCount,
      inventorySha256: expected.canonicalInventorySha256, findingCount: 0, blockerCount: 0 };
  };
  return { schemaVersion: 1, state: "diagnostic_only", admission: "NOT_AUTHORIZED", milestone2: "NOT_ESTABLISHED",
    controls: [control("cargo-lock-vulnerable", 1), control("cargo-lock-clean", 0)],
    sourceAudits: [sourceAudit("volume"), sourceAudit("worker")],
    helpers: metadata.roles.map((role) => ({ role: role.role, result: "passed", evidenceClass: "ARTIFACT_TO_IMAGE_IDENTITY",
      imageDigest: metadata.image.platformDigest, bytes: role.helper.bytes, sha256: role.helper.sha256,
      hostCopyMode: role.helper.mode, hostCopyNlink: 1, intrinsicBinaryInventory: "NOT_ESTABLISHED",
      sourceToBinaryEquivalence: "NOT_ESTABLISHED" })), limitations: clone(metadata.limitations) };
}

test("public evidence keeps only diagnostic claims and exact aggregate helper bytes", () => {
  const value = validPublicEvidence();
  assert.equal(validateSeaweedRustPublicEvidence(value, metadata), value);
  const additionalFinding = clone(value);
  additionalFinding.controls[0].findingCount = 2;
  additionalFinding.controls[0].blockerCount = 2;
  assert.equal(validateSeaweedRustPublicEvidence(additionalFinding, metadata), additionalFinding);
  assert.throws(() => validateSeaweedRustPublicEvidence({ ...value, privateBinary: "base64" }, metadata),
    /scanner_seaweed_rust_public_evidence_invalid/u);
});

test("public evidence preserves one passed helper beside one bounded rejection while the runtime gate stays closed", () => {
  const value = validPublicEvidence();
  value.helpers[0] = { role: "volume", result: "rejected", reason: "scanner_seaweed_rust_helper_copy_failed" };
  assert.equal(validateSeaweedRustPublicEvidence(value, metadata), value);
  const gate = completeGate();
  gate.helpers = value.helpers;
  assert.throws(() => combineSeaweedRustGate(gate), /scanner_seaweed_rust_gate_incomplete/u);
});

function publicSourceSnapshots() {
  const originals = metadata.files.map((entry) => ({ path: entry.path, size: entry.bytes, sha256: entry.sha256 }));
  const copies = metadata.files.map((entry) => ({
    path: entry.path === ".github/workflows/container_release_unified.yml" ? "github/workflows/container_release_unified.yml.txt"
      : entry.path.endsWith("Cargo.lock") || entry.path === "docker/Dockerfile.go_build" ||
      entry.path.endsWith("container_release_unified.yml") ? `${entry.path}.txt` : entry.path,
    size: entry.bytes,
    sha256: entry.sha256,
  }));
  return { originals, copies };
}

test("public source mapping binds all thirteen originals to exact public bytes and hashes", () => {
  const snapshots = publicSourceSnapshots();
  const result = validateSeaweedRustPublicSourceMapping({ metadata, ...snapshots });
  assert.equal(result.length, 13);
  assert.deepEqual(result.find((entry) => entry.originalPath === "seaweed-volume/Cargo.lock"), {
    originalPath: "seaweed-volume/Cargo.lock", publicPath: "seaweed-volume/Cargo.lock.txt",
    bytes: metadata.files.find((entry) => entry.path === "seaweed-volume/Cargo.lock").bytes,
    sha256: metadata.files.find((entry) => entry.path === "seaweed-volume/Cargo.lock").sha256,
  });
});

test("public source mapping rejects a changed public copy hash", () => {
  const snapshots = publicSourceSnapshots();
  snapshots.copies[0].sha256 = "a".repeat(64);
  assert.throws(() => validateSeaweedRustPublicSourceMapping({ metadata, ...snapshots }),
    /scanner_seaweed_rust_public_source_invalid/u);
});

test("all thirteen source representations survive the uploader's default hidden-file exclusion", () => {
  const publicPaths = metadata.files.map((entry) => seaweedRustPublicSourcePath(entry.path));
  assert.equal(publicPaths.length, 13);
  assert.equal(new Set(publicPaths).size, 13);
  assert.equal(publicPaths.some((relative) => relative.split("/").some((segment) => segment.startsWith("."))), false);
  assert.deepEqual(publicPaths, publicSourceSnapshots().copies.map((entry) => entry.path));
  const mapping = validateSeaweedRustPublicSourceMapping({ metadata, ...publicSourceSnapshots() });
  const workflow = mapping.find((entry) => entry.originalPath === ".github/workflows/container_release_unified.yml");
  assert.deepEqual(workflow, { originalPath: ".github/workflows/container_release_unified.yml",
    publicPath: "github/workflows/container_release_unified.yml.txt", bytes: 31251,
    sha256: "4815d65b10e37e466e139d3cd367e409253a23fd1fd892f60735e2b5a0832cb0" });
});

test("public mapping refuses the hidden workflow representation lost by the original upload", () => {
  const snapshots = publicSourceSnapshots();
  const index = metadata.files.findIndex((entry) => entry.path === ".github/workflows/container_release_unified.yml");
  snapshots.copies[index].path = ".github/workflows/container_release_unified.yml.txt";
  assert.throws(() => validateSeaweedRustPublicSourceMapping({ metadata, ...snapshots }),
    /scanner_seaweed_rust_public_source_invalid/u);
});

test("public source projection refuses unlisted, absolute and traversing paths", () => {
  for (const relative of [".github/private.env", "/seaweed-volume/Cargo.lock", "../Cargo.lock"]) {
    assert.throws(() => seaweedRustPublicSourcePath(relative), /scanner_seaweed_rust_public_source_invalid/u);
  }
});
