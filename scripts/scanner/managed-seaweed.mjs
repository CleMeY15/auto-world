import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";

const MiB = 1024 ** 2;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = () => { throw new Error("scanner_managed_seaweed_evidence_invalid"); };
const requireValue = (condition) => { if (!condition) fail(); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export const MANAGED_SEAWEED_MATERIAL = Object.freeze({
  version: "4.51", sourceCommit: "ffa87c25fdf587178b1521ad87f2a4a72a02e584", archiveBytes: 81881370,
  archiveSha256: "d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9",
  originalGoModSha256: "4980945b680fa12c0457f0aa909926401860d66e816eccc6f8508c71a5290ee8",
  originalGoSumSha256: "78c8b44110c4633c5721e0f7dad0fe99308116ebb7bdd5dafb160dc378f31d89",
  goModSha256: "5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9",
  goSumSha256: "abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a",
  licenseSha256: "d789d433cc11da163273d1e39be2e8fa67642f9a58ef220d3f258fa9c14ef613",
  goJose: "v4.1.6", xNet: "v0.62.0", displayCommit: "ffa87c2-aw-go-5b789254",
});

export function validateManagedSeaweedConfig(base, candidate) {
  requireValue(Array.isArray(base) && base.length === 1 && Array.isArray(candidate) && candidate.length === 1);
  const original = base[0], final = candidate[0];
  requireValue(original?.Id === "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6" &&
    digest(final?.Id) && original.Id !== final.Id && object(original.Config) && object(final.Config));
  for (const image of [original, final]) requireValue(image.Os === "linux" && image.Architecture === "amd64");
  const fields = ["Env", "Entrypoint", "Cmd", "WorkingDir", "Volumes", "ExposedPorts", "User", "StopSignal", "Healthcheck", "Shell", "OnBuild"];
  for (const field of fields) requireValue(Object.hasOwn(original.Config, field) === Object.hasOwn(final.Config, field) &&
    isDeepStrictEqual(original.Config[field], final.Config[field]));
  return { baseImageId: original.Id, imageId: final.Id, identicalFields: fields };
}

export function validateManagedSeaweedGoInventory(report) {
  requireValue(Array.isArray(report?.Results));
  const targets = report.Results.filter((entry) => entry.Target === "usr/bin/weed");
  requireValue(targets.length === 1 && targets[0].Class === "lang-pkgs" && targets[0].Type === "gobinary" && Array.isArray(targets[0].Packages));
  const packages = targets[0].Packages;
  for (const [name, version] of [["github.com/go-jose/go-jose/v4", "v4.1.6"], ["golang.org/x/net", "v0.62.0"], ["stdlib", "v1.27.3"]]) {
    const matches = packages.filter((entry) => entry.Name === name);
    requireValue(matches.length === 1 && matches[0].Version === version);
  }
  // Deliberately preserve the actual main version, including absent/(devel).
  // The unchanged generic evaluator decides coverage; there is no exemption.
  requireValue(packages.filter((entry) => entry.Name === "github.com/seaweedfs/seaweedfs").length === 1);
  return { target: "usr/bin/weed", packageCount: packages.length };
}

const SEAWEED_STATUS_FILES = Object.freeze({
  preparation: "preparation.exit-code",
  packageList: "package-list.exit-code",
  tests: "go-test.exit-code",
  capture: "go-test-capture.exit-code",
  build: "build.exit-code",
  buildValidation: "build-validation.exit-code",
});

// Read only the fixed numeric status surface from a canonical private evidence
// root. This diagnostic does not inspect logs or imply runtime eligibility.
export function readManagedSeaweedStatuses(directory) {
  try {
    requireValue(typeof directory === "string" && path.isAbsolute(directory) && !/[\0,\r\n]/u.test(directory) && path.resolve(directory) === directory);
    const rootInfo = lstatSync(directory);
    requireValue(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && realpathSync(directory) === directory);
    const statuses = {};
    for (const [key, name] of Object.entries(SEAWEED_STATUS_FILES)) {
      const file = path.join(directory, name);
      requireValue(path.dirname(file) === directory && path.relative(directory, file) === name && realpathSync(file) === file);
      const info = lstatSync(file);
      requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size >= 2 && info.size <= 4);
      const bytes = readFileSync(file);
      requireValue(bytes.length === info.size);
      const text = utf8(bytes);
      requireValue(/^(?:0|[1-9][0-9]{0,2})\n$/u.test(text));
      const value = Number(text.slice(0, -1));
      requireValue(value <= 255);
      statuses[key] = value;
    }
    return Object.freeze(statuses);
  } catch {
    fail();
  }
}

// Read only an already bounded, exported text evidence tree. No command is run.
export function readManagedSeaweedTests(directory) {
  const read = (name) => {
    const file = path.join(directory, name), info = lstatSync(file);
    requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 4 * MiB);
    const bytes = readFileSync(file); requireValue(bytes.length === info.size);
    return bytes;
  };
  const lines = (bytes) => {
    const text = utf8(bytes); requireValue(text.endsWith("\n") && !text.includes("\r") && !text.includes("\0"));
    return text.slice(0, -1).split("\n");
  };
  const statuses = readManagedSeaweedStatuses(directory);
  requireValue(statuses.preparation === 0);
  const packageNames = lines(read("package-list.txt"));
  requireValue(statuses.packageList === 0 && packageNames.length <= 4096 && new Set(packageNames).size === packageNames.length &&
    packageNames.every((name) => /^github\.com\/seaweedfs\/seaweedfs\/weed(?:\/[A-Za-z0-9_.-]+)*$/u.test(name)));
  const packages = new Map(packageNames.map((name) => [name, { started: false, status: null, tests: new Map() }]));
  const manifestBytes = read("go-test-manifest.tsv");
  requireValue(utf8(read("go-test-manifest-bytes.txt")) === `${manifestBytes.length}\n` &&
    utf8(read("go-test-manifest.sha256")) === `${hash(manifestBytes)}  go-test-manifest.tsv\n`);
  const manifest = lines(manifestBytes);
  requireValue(manifest.length > 0 && manifest.length <= 4096);
  const streamLine = utf8(read("go-test-stream.tsv"));
  requireValue(/^[1-9][0-9]*\t[a-f0-9]{64}\n$/u.test(streamLine));
  requireValue(utf8(read("go-test-concat.tsv")) === streamLine);
  const [expectedBytes, expectedHash] = streamLine.trimEnd().split("\t");
  const streamHash = createHash("sha256");
  let streamBytes = 0, events = 0;
  const names = [], skips = [], buildFailures = [];
  for (const [index, row] of manifest.entries()) {
    const parts = row.split("\t"), expectedName = `chunk-${String(index).padStart(4, "0")}.json`;
    requireValue(parts.length === 3 && parts[0] === expectedName && /^[1-9][0-9]*$/u.test(parts[1]) && /^[a-f0-9]{64}$/u.test(parts[2]));
    const bytes = read(path.join("go-test-events", expectedName));
    requireValue(bytes.length === Number(parts[1]) && hash(bytes) === parts[2]);
    names.push(expectedName); streamHash.update(bytes); streamBytes += bytes.length;
    requireValue(streamBytes <= 64 * MiB);
    for (const line of lines(bytes)) {
      const event = JSON.parse(line); events++;
      requireValue(object(event) && typeof event.Action === "string");
      if (["build-output", "build-fail"].includes(event.Action)) {
        requireValue(typeof event.ImportPath === "string" && event.ImportPath.length > 0);
        if (event.Action === "build-fail") buildFailures.push(event.ImportPath);
        continue;
      }
      requireValue(typeof event.Package === "string" && packages.has(event.Package) &&
        ["start", "run", "pause", "cont", "pass", "fail", "skip", "output"].includes(event.Action) &&
        (event.Test === undefined || typeof event.Test === "string" && event.Test.length > 0) &&
        (event.Output === undefined || typeof event.Output === "string"));
      const entry = packages.get(event.Package);
      if (event.Action === "start") {
        requireValue(event.Test === undefined && !entry.started && entry.status === null); entry.started = true; continue;
      }
      requireValue(entry.started && entry.status === null);
      if (event.Action === "output") continue;
      if (event.Test !== undefined) {
        if (event.Action === "run") {
          requireValue(!entry.tests.has(event.Test)); entry.tests.set(event.Test, { state: "running", status: null }); continue;
        }
        const item = entry.tests.get(event.Test); requireValue(item && item.status === null);
        if (event.Action === "pause") { requireValue(item.state === "running"); item.state = "paused"; continue; }
        if (event.Action === "cont") { requireValue(item.state === "paused"); item.state = "running"; continue; }
        requireValue(["pass", "fail", "skip"].includes(event.Action)); item.status = event.Action;
      } else {
        requireValue(["pass", "fail", "skip"].includes(event.Action)); entry.status = event.Action;
      }
      if (event.Action === "skip") skips.push({ package: event.Package, test: event.Test ?? null });
    }
  }
  requireValue(isDeepStrictEqual(readdirSync(path.join(directory, "go-test-events")).sort(), names));
  requireValue(streamBytes === Number(expectedBytes) && streamHash.digest("hex") === expectedHash);
  const counts = { packages: { total: packages.size, pass: 0, fail: 0, skip: 0 }, tests: { total: 0, pass: 0, fail: 0, skip: 0 } };
  for (const entry of packages.values()) {
    requireValue(entry.started && ["pass", "fail", "skip"].includes(entry.status)); counts.packages[entry.status]++;
    for (const item of entry.tests.values()) {
      requireValue(["pass", "fail", "skip"].includes(item.status)); counts.tests.total++; counts.tests[item.status]++;
    }
  }
  requireValue(counts.tests.total > 0 && (statuses.tests === 0) ===
    (counts.tests.fail === 0 && counts.packages.fail === 0 && buildFailures.length === 0));
  return { schemaVersion: 1, statuses, counts, skips, buildFailures, events, streamBytes, streamSha256: expectedHash,
    result: Object.values(statuses).every((value) => value === 0) ? "passed" : "failed",
    // Actual skip identities need independent review; none are guessed here.
    runtimeEligible: Object.values(statuses).every((value) => value === 0) && skips.length === 0,
    skipReview: skips.length ? "REQUIRED_NOT_ACCEPTED" : "NO_SKIPS", sourceMainCoverage: "GENERIC_POLICY_UNCHANGED" };
}
