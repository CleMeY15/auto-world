import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as audit from "../scripts/scanner/official-audit.mjs";
import { evaluateArchiveImageReport } from "../scripts/scanner/official-controls.mjs";
import { evaluateImageResults } from "../scripts/scanner/audit-policy.mjs";

const directory = new URL("./fixtures/scanner-official/managed-gosu/", import.meta.url);
const raw = (name) => readFileSync(new URL(name, directory));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const originalReport = raw("image-postgres.json");
const originalSbom = raw("image-postgres.cdx.json");
const reportFixture = JSON.parse(originalReport);
const sbomFixture = JSON.parse(originalSbom);
const binarySha256 = "8c12961ed59dc9c662d5b5150a8f8e7ab66ef59d5796a0abdb8778b885247b8e";
const now = new Date("2026-10-25T14:46:00.000Z");
const subjectFixture = {
  kind: "LOCAL_MANAGED_IMAGE_V1",
  imageId: "sha256:349cb0724274474208917a3e4064a585ab6df13339fc248742c23440f7d83f8f",
  os: "linux", architecture: "amd64",
  archiveSha256: "2a3fe9cbe179138638d3ee2da545c076b1299dff524da4063588b254833f96fd",
  archiveBytes: 302056448,
  artifactName: "/managed-image-postgres.tar",
};
const evidence = () => ({
  buildInfo: raw("build-info.txt"),
  binaryInventory: raw("binary-sha256.txt"),
  finalInventory: Buffer.from(`${binarySha256}  /usr/local/bin/gosu\n`),
  sourceInventory: raw("source-sha256.txt"),
  goMod: raw("go.mod"),
  goSum: raw("go.sum"),
});
const context = (subject = clone(subjectFixture), proofs = evidence()) => audit.bindManagedGosuEvidence(subject, proofs);
const goResult = (report) => report.Results.find((entry) => entry.Type === "gobinary");
const mainPackage = (report) => goResult(report).Packages.find((entry) => entry.Name === "github.com/tianon/gosu");
const controlledRejection = (operation) => assert.throws(operation, (failure) =>
  failure instanceof Error && /^scanner_[a-z0-9_]+$/u.test(failure.message));
const evaluate = (report, bound = context(), subject = clone(subjectFixture), at = now) => evaluateArchiveImageReport(report, subject, at, bound);

function finding(pkg, overrides = {}) {
  return { VulnerabilityID: "CVE-2099-900001", PkgName: pkg.Name, InstalledVersion: pkg.Version,
    Severity: "HIGH", FixedVersion: "synthetic-fixed-version", ...overrides };
}

test("managed gosu fixtures retain the exact failed-run originals and frozen evaluator bytes", () => {
  const expected = {
    "image-postgres.json": [103037, "7a229664f4782cf088951c6eaecfce1b49c701c83f3147359b10e3cc1276885b"],
    "image-postgres.cdx.json": [76007, "b243994648ce8e95df9d4a86c5680524fa1074b1294772e53af8da70dcf6d29f"],
    "build-info.txt": [900, "cfcd70393ff2134469c019ff50de1396dfb7e5aca4290ef0baa3217869b723f5"],
    "binary-sha256.txt": [76, "009cc300f62f7e9e20c27b9a1c986de65447d394e4c74b5ce6b9999cef8ae2a8"],
    "source-sha256.txt": [90, "c7b0f4c452c4c26e8fc23c40a2150ddce1a1406a9e80c364f468021943e61c98"],
    "go.mod": [110, "216dbdc31af7371e368b90a85837c6dcf8aa7139cb449ecceaa0526d91900c3a"],
    "go.sum": [318, "3f4d244f09dc5009ad68d99b2d99815f48fddf693fad8e734bbe820b315f43e7"],
  };
  for (const [name, [size, hash]] of Object.entries(expected)) {
    const bytes = raw(name);
    assert.equal(bytes.length, size, name);
    assert.equal(sha256(bytes), hash, name);
  }
  assert.equal(sha256(readFileSync(new URL("../scripts/scanner/audit-policy.mjs", import.meta.url))),
    "8ee56aeee8d31f3620987186e1876731ce21d3f4763980a0bdc758511248584f");
});

test("the raw devel main remains rejected by the frozen policy and the generic archive API without context", () => {
  assert.equal(Object.hasOwn(mainPackage(reportFixture), "Version"), false);
  assert.throws(() => evaluateImageResults(reportFixture.Results, { imageDigest: subjectFixture.imageId, now }),
    /scanner_image_report_invalid/u);
  assert.throws(() => evaluateArchiveImageReport(reportFixture, subjectFixture, now), /scanner_image_report_invalid/u);
});

test("the bound measured main is accounted as 49 raw packages = 48 versioned + one source component without rewriting originals", () => {
  const report = clone(reportFixture), sbom = clone(sbomFixture);
  const beforeReport = JSON.stringify(report), beforeSbom = JSON.stringify(sbom);
  const proofs = evidence();
  const beforeProofs = Object.fromEntries(Object.entries(proofs).map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const bound = context(clone(subjectFixture), proofs);
  const boundBefore = JSON.stringify(bound);
  audit.validateOfficialArchiveSbom(report, sbom, subjectFixture);
  const evaluated = evaluate(report, bound);
  assert.deepEqual(evaluated.findings, []);
  assert.deepEqual(evaluated.blockers, []);
  assert.equal(evaluated.rawPackageCount, 49);
  assert.equal(evaluated.versionedPackageCount, 48);
  assert.equal(evaluated.sourceBoundPackageCount, 1);
  assert.equal(evaluated.sourceComponents.length, 1);
  assert.equal(evaluated.sourceComponents[0].name, "github.com/tianon/gosu");
  assert.equal(evaluated.sourceComponents[0].target, "usr/local/bin/gosu");
  assert.equal(evaluated.sourceComponents[0].version, null);
  assert.match(JSON.stringify(evaluated.sourceComponents), /"mainVersionLookup":"UNAVAILABLE"/u);
  assert.match(JSON.stringify(evaluated.sourceComponents), /29b939aa5bd4dc588af765b8248f6e39150d2565/u);
  assert.match(JSON.stringify(evaluated.sourceComponents), new RegExp(binarySha256, "u"));
  assert.equal(JSON.stringify(report), beforeReport);
  assert.equal(JSON.stringify(sbom), beforeSbom);
  assert.equal(JSON.stringify(bound), boundBefore);
  for (const [name, bytes] of Object.entries(proofs)) assert.deepEqual(bytes, beforeProofs[name], name);
  assert.equal(Object.hasOwn(mainPackage(report), "Version"), false);
  assert.notEqual(mainPackage(report).Layer.DiffID, goResult(report).Packages.find((entry) => entry.Name === "golang.org/x/sys").Layer.DiffID,
    "the measured x/sys layer identity is legitimately inherited and must not be forced to the main's layer");
});

test("binding refuses mutated or missing original proof buffers and invented binary identities", async (t) => {
  for (const name of Object.keys(evidence())) {
    await t.test(`changed ${name}`, () => {
      const proofs = evidence();
      proofs[name][0] ^= 1;
      controlledRejection(() => context(clone(subjectFixture), proofs));
    });
    await t.test(`missing ${name}`, () => {
      const proofs = evidence();
      delete proofs[name];
      controlledRejection(() => context(clone(subjectFixture), proofs));
    });
    await t.test(`non-Buffer ${name}`, () => {
      const proofs = evidence();
      proofs[name] = proofs[name].toString("utf8");
      controlledRejection(() => context(clone(subjectFixture), proofs));
    });
  }
  const both = evidence();
  both.binaryInventory = Buffer.from(`${"a".repeat(64)}  /out/gosu\n`);
  both.finalInventory = Buffer.from(`${"a".repeat(64)}  /usr/local/bin/gosu\n`);
  controlledRejection(() => context(clone(subjectFixture), both));
  const compiler = evidence();
  compiler.buildInfo = Buffer.from(compiler.buildInfo.toString("utf8").replace("go1.27.3", "go1.27.2"));
  controlledRejection(() => context(clone(subjectFixture), compiler));
  const source = evidence();
  source.sourceInventory = Buffer.from(`${"b".repeat(64)}  /tmp/gosu-source.tar.gz\n`);
  controlledRejection(() => context(clone(subjectFixture), source));
});

test("binding refuses noncanonical final-byte evidence rather than normalizing paths, case or line endings", () => {
  context();
  for (const value of [
    `${binarySha256}  /out/gosu\n`,
    `${binarySha256} /usr/local/bin/gosu\n`,
    `${binarySha256.toUpperCase()}  /usr/local/bin/gosu\n`,
    `${binarySha256}  /usr/local/bin/gosu\r\n`,
    `${binarySha256}  /usr/local/bin/gosu`,
    `${binarySha256}  /usr/local/bin/gosu\nextra\n`,
  ]) {
    const proofs = evidence(); proofs.finalInventory = Buffer.from(value);
    controlledRejection(() => context(clone(subjectFixture), proofs));
  }
});

test("a bound source component cannot transfer to another image, archive, role or platform", async (t) => {
  const bound = context();
  const variants = [
    { imageId: `sha256:${"a".repeat(64)}` },
    { archiveSha256: "b".repeat(64) },
    { archiveBytes: subjectFixture.archiveBytes + 1 },
    { artifactName: "/managed-image-aws-cli.tar" },
    { artifactName: "/managed-image-opensearch.tar" },
    { os: "windows" },
    { architecture: "arm64" },
  ];
  for (const fields of variants) {
    await t.test(JSON.stringify(fields), () => controlledRejection(() => evaluate(reportFixture, bound, { ...subjectFixture, ...fields })));
  }
});

test("every authenticated context field is mandatory, exact and immune to injected extra authority", async (t) => {
  const bound = context();
  evaluate(reportFixture, bound);
  assert.equal(bound.kind, "SOURCE_BOUND_GOSU_V1");
  assert.equal(bound.compilerVersion, "go1.27.3");
  assert.equal(bound.buildInfoBytes, 900);
  for (const [key, value] of Object.entries(bound)) {
    await t.test(`substitute ${key}`, () => {
      const changed = clone(bound);
      changed[key] = typeof value === "number" ? value + 1 : `${value}x`;
      controlledRejection(() => evaluate(reportFixture, changed));
    });
    await t.test(`omit ${key}`, () => {
      const changed = clone(bound); delete changed[key];
      controlledRejection(() => evaluate(reportFixture, changed));
    });
  }
  controlledRejection(() => evaluate(reportFixture, { ...bound, admission: "AUTHORIZED" }));
  controlledRejection(() => evaluate(reportFixture, null));
});

test("binding detaches proof bytes and subject references after their actual authentication", () => {
  const subject = clone(subjectFixture), proofs = evidence();
  const bound = context(subject, proofs);
  const before = JSON.stringify(bound);
  for (const bytes of Object.values(proofs)) bytes.fill(0);
  subject.imageId = `sha256:${"f".repeat(64)}`;
  subject.archiveSha256 = "f".repeat(64);
  assert.equal(JSON.stringify(bound), before);
  assert.equal(evaluate(reportFixture, bound).sourceBoundPackageCount, 1);
});

test("final hash inspection uses the exact configID with bounded nonroot readonly networkless arguments", () => {
  const args = audit.managedGosuHashArguments(subjectFixture);
  assert.deepEqual(args, [
    "run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--user", "70:70", "--pids-limit", "16", "--memory", "64m", "--memory-swap", "64m", "--cpus", "1",
    "--entrypoint", "sha256sum", subjectFixture.imageId, "/usr/local/bin/gosu",
  ]);
  assert.equal(args.some((entry) => entry.includes("docker.sock") || entry === "--privileged" || entry.includes("type=bind")), false);
  for (const changed of [
    { ...subjectFixture, imageId: "auto-world-managed/postgres:latest" },
    { ...subjectFixture, kind: "UPSTREAM_REGISTRY_SUBJECT" },
    { ...subjectFixture, artifactName: "/managed-image-aws-cli.tar" },
  ]) controlledRejection(() => audit.managedGosuHashArguments(changed));
});

test("the exact four-package Go inventory rejects supplied main versions and missing, extra or duplicate members", () => {
  const mutations = [
    (report) => { mainPackage(report).Version = "v1.20.0"; },
    (report) => { mainPackage(report).Version = "(devel)"; },
    (report) => { mainPackage(report).Version = ""; },
    (report) => { mainPackage(report).Version = null; },
    (report) => { mainPackage(report).Version = undefined; },
    (report) => { goResult(report).Packages.pop(); },
    (report) => { goResult(report).Packages.push(clone(mainPackage(report))); },
    (report) => { goResult(report).Packages.push({ ID: "extra@v1.0.0", Name: "extra", Version: "v1.0.0" }); },
    (report) => { goResult(report).Packages.push({ ID: "foreign", Name: "foreign" }); },
    (report) => { delete goResult(report).Packages.find((entry) => entry.Name === "stdlib").Version; },
    (report) => { delete report.Results.find((entry) => entry.Class === "os-pkgs").Packages[0].Version; },
    (report) => { goResult(report).Packages.find((entry) => entry.Name === "github.com/moby/sys/user").Version = "v0.4.0"; },
    (report) => { goResult(report).Packages.find((entry) => entry.Name === "stdlib").Version = "v1.24.6"; },
    (report) => { mainPackage(report).DependsOn.pop(); },
    (report) => { mainPackage(report).Identifier.UID = goResult(report).Packages.find((entry) => entry.Name === "stdlib").Identifier.UID; },
    (report) => { mainPackage(report).Identifier.PURL = "pkg:golang/foreign/main"; },
    (report) => { goResult(report).Target = "usr/local/bin/other"; },
    (report) => { report.Results.push(clone(goResult(report))); },
  ];
  for (const mutate of mutations) {
    const report = clone(reportFixture); mutate(report);
    controlledRejection(() => evaluate(report));
  }
});

test("Go package UIDs must be strings: numeric and array values are refused for main and dependency", async (t) => {
  evaluate(reportFixture);
  for (const name of ["github.com/tianon/gosu", "github.com/moby/sys/user"]) {
    for (const value of [1234567890123456, ["abcdef0123456789"]]) {
      await t.test(`${name}: ${Array.isArray(value) ? "array" : "number"} UID`, () => {
        const report = clone(reportFixture);
        goResult(report).Packages.find((entry) => entry.Name === name).Identifier.UID = value;
        controlledRejection(() => evaluate(report));
      });
    }
  }
});

test("array digests are refused by binding, hash arguments and the source profile even with shared references", async (t) => {
  for (const key of ["imageId", "archiveSha256"]) {
    await t.test(key, () => {
      const value = [subjectFixture[key]];
      const subject = { ...subjectFixture, [key]: value };
      controlledRejection(() => context(subject));
      controlledRejection(() => audit.managedGosuHashArguments(subject));
      const report = clone(reportFixture);
      const bound = { ...context(), [key]: value };
      if (key === "imageId") report.Metadata.ImageID = value;
      // Sharing the same array defeats equality-only checks. The profile must
      // reject its type instead of allowing RegExp.test to coerce it to text.
      controlledRejection(() => evaluate(report, bound, subject));
    });
  }
});

test("every main finding reference is rejected before projection, including empty versions and contradictory identifiers", () => {
  const main = mainPackage(reportFixture);
  const dep = goResult(reportFixture).Packages.find((entry) => entry.Name === "github.com/moby/sys/user");
  const references = [
    finding(main, { InstalledVersion: "" }),
    finding(main, { InstalledVersion: "v1.20.0" }),
    finding(main, { InstalledVersion: undefined, Severity: "CRITICAL" }),
    finding(dep, { PkgID: main.ID }),
    finding(dep, { PkgIdentifier: { PURL: main.Identifier.PURL, UID: main.Identifier.UID } }),
    finding(dep, { PkgIdentifier: { PURL: dep.Identifier.PURL, UID: main.Identifier.UID } }),
    finding(dep, { PkgID: dep.ID, PkgIdentifier: { PURL: main.Identifier.PURL, UID: dep.Identifier.UID } }),
    finding(dep, { PkgID: { invalid: true } }),
    finding(dep, { PkgIdentifier: [] }),
    finding(dep, { PkgIdentifier: { PURL: 42 } }),
  ];
  for (const candidate of references) {
    const report = clone(reportFixture); goResult(report).Vulnerabilities = [candidate];
    controlledRejection(() => evaluate(report));
  }
  const outside = clone(reportFixture);
  const os = outside.Results.find((entry) => entry.Class === "os-pkgs");
  const osPackage = os.Packages.find((entry) => entry.Name === "libcrypto3");
  os.Vulnerabilities = [finding(osPackage, { PkgID: main.ID })];
  controlledRejection(() => evaluate(outside));
});

test("versioned dependency and OS findings keep the exact unchanged severity/disposition policy", () => {
  for (const kind of ["dependency", "os"]) {
    for (const rule of [
      { Severity: "HIGH", FixedVersion: "synthetic-fixed", code: "image_vulnerability_blocked" },
      { Severity: "CRITICAL", FixedVersion: "", code: "image_vulnerability_blocked" },
      { Severity: "HIGH", FixedVersion: "", code: "unfixed_high_needs_independent_disposition" },
    ]) {
      const report = clone(reportFixture);
      const target = kind === "dependency" ? goResult(report) : report.Results.find((entry) => entry.Class === "os-pkgs");
      const pkg = target.Packages.find((entry) => entry.Name === (kind === "dependency" ? "github.com/moby/sys/user" : "libcrypto3"));
      target.Vulnerabilities = [finding(pkg, { Severity: rule.Severity, FixedVersion: rule.FixedVersion })];
      const versioned = report.Results.map((entry) => entry === goResult(report)
        ? { ...entry, Packages: entry.Packages.filter((item) => item.Name !== "github.com/tianon/gosu") } : entry);
      const expected = evaluateImageResults(versioned, { imageDigest: subjectFixture.imageId, dispositions: [], now });
      const observed = evaluate(report);
      assert.deepEqual(observed.findings, expected.findings);
      assert.deepEqual(observed.blockers, expected.blockers);
      assert.equal(observed.blockers[0].code, rule.code);
      assert.equal(observed.sourceBoundPackageCount, 1);
    }
  }
});

test("the existing full raw SBOM checker remains mandatory and refuses a divergent unversioned main", () => {
  audit.validateOfficialArchiveSbom(reportFixture, sbomFixture, subjectFixture);
  for (const mutate of [
    (sbom) => { sbom.components = sbom.components.filter((entry) => entry.name !== "github.com/tianon/gosu"); },
    (sbom) => { sbom.components.find((entry) => entry.name === "github.com/tianon/gosu").version = "v1.20.0"; },
    (sbom) => { sbom.components.find((entry) => entry.name === "github.com/tianon/gosu").name = "foreign"; },
    (sbom) => { sbom.metadata.component.name = "/managed-image-aws-cli.tar"; },
  ]) {
    const sbom = clone(sbomFixture); mutate(sbom);
    controlledRejection(() => audit.validateOfficialArchiveSbom(reportFixture, sbom, subjectFixture));
  }
});

test("the source-bound case does not waive report currentness, scanner version, OS end-of-life or malformed findings", () => {
  const bound = context();
  const stale = new Date("2026-10-28T14:46:00.000Z");
  controlledRejection(() => evaluate(reportFixture, bound, subjectFixture, stale));
  for (const mutate of [
    (report) => { report.CreatedAt = "2026-10-26T00:00:00.000Z"; },
    (report) => { report.Trivy.Version = "0.74.0-autoworld.2"; },
    (report) => { report.Metadata.OS.EOSL = "false"; },
    (report) => { goResult(report).Vulnerabilities = [null]; },
    (report) => { goResult(report).Vulnerabilities = {}; },
  ]) {
    const report = clone(reportFixture); mutate(report);
    controlledRejection(() => evaluate(report, bound));
  }
  const eol = clone(reportFixture); eol.Metadata.OS.EOSL = true;
  assert.ok(evaluate(eol, bound).blockers.some((entry) => entry.code === "image_os_end_of_life"));
});
