import assert from "node:assert/strict";
import test from "node:test";
import { evaluateImageReport as evaluateHistoricalImageReport, SCANNER_VERSION } from "../scripts/scanner/audit-policy.mjs";
import { validateSelfReport as validateHistoricalSelfReport, validateVersionProbeReport as validateHistoricalVersionProbeReport } from "../scripts/scanner/controls.mjs";
import { parseOfficialGoBuildInfo } from "../scripts/scanner/official-build-info.mjs";
import { evaluateImageReport, validateSelfReport, validateVersionProbeReport } from "../scripts/scanner/official-controls.mjs";

const official = { expectedScannerVersion: "0.76.1" };
const commit = "e713f67f7d54decdcd9b3132c9751833dcced698";
const sum = `h1:${Buffer.alloc(32).toString("base64")}`;
const invalidBuild = /scanner_official_go_build_info_invalid/u;

function buildText({ mainVersion = "(devel)", directory = "/tmp/official", count = 100, settings = [] } = {}) {
  return [
    `${directory}/trivy: go1.27.3`,
    "\tpath\tgithub.com/aquasecurity/trivy/cmd/trivy",
    `\tmod\tgithub.com/aquasecurity/trivy\t${mainVersion}\t`,
    `\tdep\tgoogle.golang.org/grpc\tv1.84.0\t${sum}`,
    `\tdep\tgolang.org/x/net\tv0.60.0\t${sum}`,
    ...Array.from({ length: count }, (_, index) => `\tdep\texample.test/module-${index}\tv1.0.${index}\t${sum}`),
    "\tbuild\t-buildmode=exe",
    "\tbuild\tGOOS=linux",
    "\tbuild\tGOARCH=amd64",
    ...settings.map((setting) => `\tbuild\t${setting}`),
    "",
  ].join("\n");
}

test("official Go inventory preserves stdlib and every dependency for both upstream main versions", () => {
  for (const mainVersion of ["(devel)", "v0.76.1"]) {
    const first = parseOfficialGoBuildInfo(Buffer.from(buildText({ mainVersion })));
    const second = parseOfficialGoBuildInfo(Buffer.from(buildText({ mainVersion, directory: "/other/path" }).replaceAll("\n", "\r\n")));
    assert.deepEqual(first, second);
    assert.deepEqual(first.stdlib, { path: "stdlib", version: "v1.27.3" });
    assert.deepEqual(first.main, { path: "github.com/aquasecurity/trivy", version: mainVersion === "(devel)" ? null : mainVersion, sum: "" });
    assert.equal(first.dependencies.length, 102);
    assert.ok(first.dependencies.every((dependency) => dependency.sum === sum));
    assert.equal(first.dependencies.find((dependency) => dependency.path === "google.golang.org/grpc").version, "v1.84.0");
    assert.equal(first.dependencies.find((dependency) => dependency.path === "golang.org/x/net").version, "v0.60.0");
    assert.equal(first.settings.GOOS, "linux");
    assert.equal(first.settings.GOARCH, "amd64");
  }
});

test("available official VCS metadata must establish the expected unmodified source", () => {
  const settings = ["vcs=git", `vcs.revision=${commit}`, "vcs.modified=false", "vcs.time=2026-10-21T12:00:00Z", '-ldflags="-s -w"'];
  const parsed = parseOfficialGoBuildInfo(Buffer.from(buildText({ settings })));
  assert.equal(parsed.settings["vcs.revision"], commit);
  assert.equal(parsed.settings["-ldflags"], "-s -w");
  for (const changed of [
    settings.map((value) => value.replace(commit, "a".repeat(40))),
    settings.map((value) => value.replace("vcs=git", "vcs=unknown")),
    settings.map((value) => value.replace("vcs.modified=false", "vcs.modified=true")),
    settings.filter((value) => !value.startsWith("vcs.revision=")),
    [...settings, `vcs.revision=${commit}`],
    [...settings, "vcs.unknown=anything"],
    [...settings, "GOOS=linux"],
  ]) assert.throws(() => parseOfficialGoBuildInfo(Buffer.from(buildText({ settings: changed }))), invalidBuild);
});

test("official Go parser rejects substituted tools, roots, dependencies, replacements and duplicate records", () => {
  const original = buildText();
  for (const changed of [
    original.replace("go1.27.3", "go1.27.2"),
    original.replace("go1.27.3", "go1.27.3-X:jsonv2"),
    original.replace("/cmd/trivy", "/cmd/other"),
    original.replace("\t(devel)\t", "\tv0.76.0\t"),
    original.replace("\tv1.84.0\t", "\tv1.83.0\t"),
    original.replace("\tv0.60.0\t", "\tv0.59.0\t"),
    original.replace("\tv1.0.0\t", "\t(devel)\t"),
    original.replace("\tv1.0.0\t", "\tunknown\t"),
    original.replace("example.test/module-0", "../local"),
    original.replace("example.test/module-0", "unknown"),
    original.replace(sum, "h1:invalid"),
    `${original}\tdep\tgolang.org/x/net\tv0.60.0\t${sum}\n`,
    `${original}\tmod\tgithub.com/aquasecurity/trivy\t(devel)\t\n`,
    `${original}\tpath\tgithub.com/aquasecurity/trivy/cmd/trivy\n`,
    `${original}\t=>\t../local\t(devel)\t\n`,
    `${original}\t=>\texample.test/replacement\tv1.0.0\t${sum}\n`,
    `${original}\tunknown\tdata\n`,
    `${original}\tdep\texample.test/extra\tv1.0.0\t${sum}\textra\n`,
    buildText({ count: 97 }),
  ]) assert.throws(() => parseOfficialGoBuildInfo(Buffer.from(changed)), invalidBuild);
});

test("official Go text decoding and record count are bounded", () => {
  for (const bytes of [
    "not a buffer", Buffer.alloc(0), Buffer.alloc(4 * 1024 ** 2 + 1), Buffer.from([0xc3, 0x28]),
    Buffer.from(buildText().replace("GOOS=linux", "GOOS=linux\0")),
    Buffer.from(buildText().replace("GOOS=linux", "GOOS=li\rnux")),
    Buffer.from(`${buildText()}${"\tbuild\tkey=value\n".repeat(5000)}`),
  ]) assert.throws(() => parseOfficialGoBuildInfo(bytes), invalidBuild);
});

function selfEvidence() {
  const inventory = parseOfficialGoBuildInfo(Buffer.from(buildText()));
  const packages = [inventory.stdlib, { path: inventory.main.path, version: "v0.76.1" }, ...inventory.dependencies]
    .map(({ path, version }) => ({ Name: path, Version: version }));
  const report = { SchemaVersion: 2, ArtifactName: "subject", ArtifactType: "filesystem", Trivy: { Version: "0.76.1" },
    Results: [{ Target: "subject", Type: "gobinary", Class: "lang-pkgs", Packages: packages }] };
  const sbom = { bomFormat: "CycloneDX", metadata: { component: { type: "application", name: "subject" } }, components: [
    { type: "application", name: "subject", properties: [{ name: "aquasecurity:trivy:Type", value: "gobinary" }, { name: "aquasecurity:trivy:Class", value: "lang-pkgs" }] },
    ...packages.map(({ Name, Version }) => ({ type: "library", name: Name, version: Version, properties: [{ name: "aquasecurity:trivy:PkgType", value: "gobinary" }] })),
  ] };
  return { report, sbom, inventory };
}

test("official self audit uses a separate profile and preserves the immutable historical default", () => {
  const { report, sbom, inventory } = selfEvidence();
  assert.equal(SCANNER_VERSION, "0.74.0-autoworld.2");
  assert.throws(() => validateHistoricalSelfReport(report, sbom, inventory, "0.76.1", official), /scanner_self_report_invalid/u);
  assert.equal(validateSelfReport(report, sbom, inventory, "0.76.1").packages.length, 104);
  const accepted = validateSelfReport(report, sbom, inventory, "0.76.1", official);
  assert.equal(accepted.expectedModuleCount, 103);
  assert.equal(accepted.packages.length, 104);
  report.Trivy.Version = SCANNER_VERSION;
  assert.equal(validateHistoricalSelfReport(report, sbom, inventory, "0.76.1").packages.length, 104);
  assert.throws(() => validateSelfReport(report, sbom, inventory, "0.76.1", official), /scanner_self_report_invalid/u);
});

test("official self audit keeps complete report/SBOM and vulnerability refusals", () => {
  for (const mutation of ["missing-package", "changed-package", "missing-sbom", "finding"]) {
    const { report, sbom, inventory } = selfEvidence();
    if (mutation === "missing-package") report.Results[0].Packages.pop();
    if (mutation === "changed-package") report.Results[0].Packages[2].Version = "v9.9.9";
    if (mutation === "missing-sbom") sbom.components.pop();
    if (mutation === "finding") report.Results[0].Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0001", PkgName: "stdlib", InstalledVersion: "v1.27.3" }];
    assert.throws(() => validateSelfReport(report, sbom, inventory, "0.76.1", official), /scanner_self_(?:inventory_missing|audit_blocked)|scanner_sbom_inventory_mismatch/u);
  }
});

function versionReport() {
  return { SchemaVersion: 2, ArtifactName: "/scanner-version-probe", ArtifactType: "filesystem", Trivy: { Version: "0.76.1" }, Results: [{
    Target: "go.mod", Type: "gomod", Class: "lang-pkgs", Packages: [{ Name: "auto.world/scanner-version-probe" }, { Name: "github.com/aquasecurity/trivy", Version: "v0.76.1" }],
  }] };
}

test("official version probe keeps root identity, package coverage and vulnerability refusals", () => {
  assert.throws(() => validateHistoricalVersionProbeReport(versionReport(), "0.76.1", official), /scanner_version_probe_invalid/u);
  assert.equal(validateVersionProbeReport(versionReport(), "0.76.1").packages.length, 2);
  assert.equal(validateVersionProbeReport(versionReport(), "0.76.1", official).packages.length, 2);
  for (const mutation of ["subject", "version", "inventory", "finding"]) {
    const report = versionReport();
    if (mutation === "subject") report.ArtifactName = "/other-probe";
    if (mutation === "version") report.Results[0].Packages[1].Version = "v0.76.0";
    if (mutation === "inventory") report.Results[0].Packages.pop();
    if (mutation === "finding") report.Results[0].Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0001", PkgName: "github.com/aquasecurity/trivy", InstalledVersion: "v0.76.1" }];
    assert.throws(() => validateVersionProbeReport(report, "0.76.1", official), /scanner_version_probe_(?:invalid|blocked)/u);
  }
});

const pin = { repository: "synthetic/image", manifestDigest: `sha256:${"a".repeat(64)}`, platform: { digest: `sha256:${"b".repeat(64)}`, os: "linux", architecture: "amd64", variant: null } };
const now = new Date("2026-10-25T10:00:00Z");
function imageReport() {
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, CreatedAt: now.toISOString(), ArtifactType: "container_image", ArtifactName: `${pin.repository}@${pin.manifestDigest}`,
    Metadata: { ImageConfig: { os: "linux", architecture: "amd64" }, OS: { EOSL: false } },
    Results: [{ Target: "synthetic", Class: "os-pkgs", Type: "alpine", Packages: [{ Name: "fixture", Version: "1.0" }] }] };
}

test("official image profile preserves the historical default, image identity and vulnerability gates", () => {
  assert.throws(() => evaluateHistoricalImageReport(imageReport(), pin, [], now, official), /scanner_image_report_invalid/u);
  assert.deepEqual(evaluateImageReport(imageReport(), pin, [], now), { findings: [], blockers: [] });
  assert.deepEqual(evaluateImageReport(imageReport(), pin, [], now, official), { findings: [], blockers: [] });
  for (const finding of [
    { Severity: "CRITICAL", FixedVersion: "" }, { Severity: "HIGH", FixedVersion: "2.0" }, { Severity: "HIGH", FixedVersion: "" },
  ]) {
    const report = imageReport();
    report.Results[0].Vulnerabilities = [{ ...finding, VulnerabilityID: "CVE-2099-0001", PkgName: "fixture", InstalledVersion: "1.0" }];
    assert.equal(evaluateImageReport(report, pin, [], now, official).blockers.length, 1);
  }
  for (const mutation of ["subject", "platform", "expired", "missing-inventory"]) {
    const report = imageReport();
    if (mutation === "subject") report.ArtifactName = `other/image@${pin.manifestDigest}`;
    if (mutation === "platform") report.Metadata.ImageConfig.architecture = "arm64";
    if (mutation === "expired") report.CreatedAt = "2026-10-20T00:00:00Z";
    if (mutation === "missing-inventory") report.Results[0].Packages = [];
    assert.throws(() => evaluateImageReport(report, pin, [], now, official), /scanner_image_report_invalid/u);
  }
});

test("explicit scanner version options cannot turn missing or malformed versions into acceptance", () => {
  for (const expectedScannerVersion of [null, false, 76, "", "unknown", "0.76.1\n", "0.76.2", SCANNER_VERSION, {}]) {
    const options = { expectedScannerVersion };
    const { report, sbom, inventory } = selfEvidence();
    report.Trivy.Version = expectedScannerVersion;
    const probe = versionReport(); probe.Trivy.Version = expectedScannerVersion;
    const image = imageReport(); image.Trivy.Version = expectedScannerVersion;
    assert.throws(() => validateSelfReport(report, sbom, inventory, "0.76.1", options), /scanner_self_report_invalid/u);
    assert.throws(() => validateVersionProbeReport(probe, "0.76.1", options), /scanner_version_probe_invalid/u);
    assert.throws(() => evaluateImageReport(image, pin, [], now, options), /scanner_image_report_invalid/u);
  }
});
