import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportManagedSeaweedTextEvidence } from "../scripts/scanner/official-audit.mjs";
import { reviewManagedSeaweedNormalProfile } from "../scripts/scanner/seaweed-normal-skip-review.mjs";

const fixed = JSON.parse(readFileSync(new URL("../scripts/scanner/seaweed-normal-skip-review-data.json", import.meta.url), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (value) => Buffer.isBuffer(value) ? value : Buffer.from(value);
const commandPackage = "github.com/seaweedfs/seaweedfs/weed/command";
const storagePackage = "github.com/seaweedfs/seaweedfs/weed/storage";
const commandTest = "TestParseScanTimeHonoursTimezone";
const storageTests = ["TestValidateEcVolume_TransientStatErrorKeeps", "TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume"];
const command = "go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./command -run '^TestParseScanTimeHonoursTimezone$'";
const storage = "go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./storage -run '^(TestValidateEcVolume_TransientStatErrorKeeps|TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume)$'";

function goEvents(packageName, tests) {
  const events = [{ Action: "start", Package: packageName }];
  for (const name of tests) events.push({ Action: "run", Package: packageName, Test: name }, { Action: "pass", Package: packageName, Test: name });
  events.push({ Action: "pass", Package: packageName });
  return Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function fixture() {
  const files = new Map();
  const put = (name, value) => files.set(name, bytes(value));
  const sourceRows = fixed.sourceProofs.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}`).join("\n") + "\n";
  put("normal-skip-sources.tsv", sourceRows);
  put("source-sha256.txt", `${fixed.sourceArchive.sha256}  /tmp/seaweedfs-source.tar.gz\n`);
  put("module-inventory.json", "{\"modules\":[]}\n");
  put("module-verify.txt", "all modules verified\n");
  const candidate = "7".repeat(64);
  put("binary-pre-test-sha256.txt", `${candidate}\n`);
  put("binary-sha256.txt", `${candidate}  /out/weed\n`);
  put("supplemental/source-sha256.txt", files.get("source-sha256.txt"));
  const context = [
    ["schema", "NORMAL_LINUX_AMD64_SUPPLEMENTAL_V1"], ["uid", "10001"], ["gid", "10001"], ["go_version", "go1.27.3"],
    ["goos", "linux"], ["goarch", "amd64"], ["cgo_enabled", "0"], ["build_tags", ""],
    ["command_zoneinfo", "/usr/local/go/lib/time/zoneinfo.zip"], ["command", command], ["storage_zoneinfo", ""], ["storage", storage],
  ];
  put("supplemental/context.tsv", context.map((row) => row.join("\t")).join("\n") + "\n");
  const materials = [
    ["/usr/local/go/lib/time/zoneinfo.zip", 408467, "b2d18a7c8fa8142097a48c99609fb3c92db5ee98bc740294e57eab8ae9f94779"],
    ["/usr/local/go/src/time/zoneinfo.go", 18613, "198928e8d2573d88d8743db57b86777a26506f17ef2b0283882a9f5c884979b7"],
    ["/usr/local/go/src/time/zoneinfo_read.go", 14741, "812b0025c6e4face22e709053183d59e03e71e3c1459187350f4088587f4a134"],
    ["/src/seaweedfs/go.mod", 26652, "5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9"],
    ["/src/seaweedfs/go.sum", 232835, "abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a"],
    ...fixed.sourceProofs.map((entry) => [`/src/seaweedfs/${entry.path}`, entry.bytes, entry.sha256]),
    ["/input/weed", 123456, candidate],
    ...["source-sha256.txt", "module-inventory.json", "module-verify.txt", "binary-sha256.txt"].map((name) =>
      [`/input/evidence/${name}`, files.get(name).length, sha256(files.get(name))]),
  ];
  const materialText = materials.map((row) => row.join("\t")).join("\n") + "\n";
  put("supplemental/materials-before.tsv", materialText); put("supplemental/materials-after.tsv", materialText);
  for (const name of ["preflight", "command", "storage", "capture", "finalization"]) put(`supplemental/${name}.exit-code`, "0\n");
  put("supplemental/command.go-test.json", goEvents(commandPackage, [commandTest]));
  put("supplemental/command.stderr.txt", "");
  put("supplemental/storage.go-test.json", goEvents(storagePackage, storageTests));
  put("supplemental/storage.stderr.txt", "");
  const captureNames = ["command.go-test.json", "command.stderr.txt", "storage.go-test.json", "storage.stderr.txt"];
  put("supplemental/capture-manifest.tsv", captureNames.map((name) => {
    const value = files.get(`supplemental/${name}`); return `${name}\t${value.length}\t${sha256(value)}`;
  }).join("\n") + "\n");

  const eventRecords = [];
  for (const entry of fixed.packages) eventRecords.push(
    { event: { Action: "start", Package: entry.package } },
    { event: { Action: "output", Package: entry.package, Output: `${entry.reasonEvent.text}\n` } },
    { event: { Action: "skip", Package: entry.package } },
  );
  for (const entry of fixed.tests) eventRecords.push(
    { event: { Action: "run", Package: entry.package, Test: entry.test } },
    { event: { Action: "output", Package: entry.package, Test: entry.test, Output: `    ${entry.reasonEvent.text}\n` } },
    { event: { Action: "skip", Package: entry.package, Test: entry.test } },
  );
  const skips = [...fixed.packages.map((entry) => ({ package: entry.package, test: null })),
    ...fixed.tests.map((entry) => ({ package: entry.package, test: entry.test }))];
  const inspection = { summary: { schemaVersion: 1,
    statuses: { preparation: 0, packageList: 0, tests: 0, capture: 0, build: 0, buildValidation: 0 },
    counts: { packages: { total: 234, pass: 158, fail: 0, skip: 76 }, tests: { total: 14290, pass: 14218, fail: 0, skip: 72 } },
    skips, buildFailures: [], events: 97136, streamBytes: 24401540, streamSha256: "a".repeat(64),
    result: "passed", runtimeEligible: false, skipReview: "REQUIRED_NOT_ACCEPTED", sourceMainCoverage: "GENERIC_POLICY_UNCHANGED" }, eventRecords };
  const view = { read(name) { assert.ok(files.has(name), `missing fixture file ${name}`); return Buffer.from(files.get(name)); },
    has(name) { return files.has(name); } };
  return { files, inspection, view };
}

const review = (data) => reviewManagedSeaweedNormalProfile(data.inspection, data.view);

test("closed Seaweed review retains all exclusions and admits only the three fresh supplemental tests", () => {
  const result = review(fixture());
  assert.equal(result.runtimeEligible, true);
  assert.equal(result.normalProfileTests, "PASS");
  assert.equal(result.skipReview, "REVIEWED_WITH_LIMITATIONS");
  assert.equal(result.reviewedExclusions.total, 148);
  assert.deepEqual(result.reviewedExclusions.categories, {
    NO_DIRECT_TEST_COVERAGE: 72, OPTIONAL_PROFILE_NOT_RUN: 4, SUPPLEMENTAL_PROOF_REQUIRED: 3,
    EXTERNAL_PROFILE_NOT_RUN: 36, UPSTREAM_OBSOLETE_TEST_NOT_RUN: 6,
    UPSTREAM_NO_EXECUTABLE_COVERAGE: 25, KNOWN_UNSUPPORTED_FEATURE: 2,
  });
  assert.equal(result.supplemental.materials.count, 36);
  assert.deepEqual(result.knownUnsupportedFeatures, ["TestExtractAllRecords_CompressedBatch", "TestSQLEngine_SelectFromNonExistentTable"]);
  assert.equal(result.counts.tests.skip, 72);
});

for (const [label, mutate] of [
  ["removed skip identity", (data) => data.inspection.summary.skips.pop()],
  ["renamed skip identity", (data) => { data.inspection.summary.skips[0].package += "/renamed"; }],
  ["changed reason", (data) => { data.inspection.eventRecords[1].event.Output = "changed\n"; }],
  ["changed reason order", (data) => { [data.inspection.eventRecords[1], data.inspection.eventRecords[2]] = [data.inspection.eventRecords[2], data.inspection.eventRecords[1]]; }],
  ["changed source proof", (data) => { data.files.set("normal-skip-sources.tsv", Buffer.from("changed\n")); }],
  ["changed uid", (data) => { data.files.set("supplemental/context.tsv", Buffer.from(data.files.get("supplemental/context.tsv").toString().replace("uid\t10001", "uid\t0"))); }],
  ["changed environment", (data) => { data.files.set("supplemental/context.tsv", Buffer.from(data.files.get("supplemental/context.tsv").toString().replace("goarch\tamd64", "goarch\tarm64"))); }],
  ["changed command", (data) => { data.files.set("supplemental/context.tsv", Buffer.from(data.files.get("supplemental/context.tsv").toString().replace("-timeout=5m", "-timeout=6m"))); }],
  ["changed material hash", (data) => { data.files.set("supplemental/materials-after.tsv", Buffer.from(data.files.get("supplemental/materials-after.tsv").toString().replace(/[a-f0-9]{64}/u, "0".repeat(64)))); }],
  ["unexpected selected test", (data) => { data.files.set("supplemental/command.go-test.json", goEvents(commandPackage, ["TestForeign"])); refreshManifest(data); }],
  ["malformed capture", (data) => { data.files.set("supplemental/command.go-test.json", Buffer.from("{\n")); refreshManifest(data); }],
  ["changed capture hash", (data) => { data.files.set("supplemental/capture-manifest.tsv", Buffer.from(data.files.get("supplemental/capture-manifest.tsv").toString().replace(/[a-f0-9]{64}/u, "0".repeat(64)))); }],
]) test(`closed Seaweed review refuses ${label}`, () => {
  const data = fixture(); mutate(data);
  assert.throws(() => review(data), /scanner_managed_seaweed_skip_review_invalid/u);
});

function refreshManifest(data) {
  const names = ["command.go-test.json", "command.stderr.txt", "storage.go-test.json", "storage.stderr.txt"];
  data.files.set("supplemental/capture-manifest.tsv", Buffer.from(names.map((name) => {
    const value = data.files.get(`supplemental/${name}`); return `${name}\t${value.length}\t${sha256(value)}`;
  }).join("\n") + "\n"));
}

test("a nonzero supplemental status remains exportable evidence but cannot authorize runtime", () => {
  const data = fixture(); data.files.set("supplemental/preflight.exit-code", Buffer.from("7\n"));
  const result = review(data);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.supplemental.statuses.preflight, 7);
});

test("a captured supplemental test failure remains readable but cannot authorize runtime", () => {
  const data = fixture();
  const failed = [
    { Action: "start", Package: commandPackage },
    { Action: "run", Package: commandPackage, Test: commandTest },
    { Action: "fail", Package: commandPackage, Test: commandTest },
    { Action: "fail", Package: commandPackage },
  ];
  data.files.set("supplemental/command.go-test.json", Buffer.from(`${failed.map((event) => JSON.stringify(event)).join("\n")}\n`));
  data.files.set("supplemental/command.exit-code", Buffer.from("1\n")); refreshManifest(data);
  const result = review(data);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.supplemental.command.tests[0].result, "FAIL");
});

test("a selected supplemental skip remains readable but cannot authorize runtime", () => {
  const data = fixture();
  const skipped = [
    { Action: "start", Package: commandPackage },
    { Action: "run", Package: commandPackage, Test: commandTest },
    { Action: "skip", Package: commandPackage, Test: commandTest },
    { Action: "pass", Package: commandPackage },
  ];
  data.files.set("supplemental/command.go-test.json", Buffer.from(`${skipped.map((event) => JSON.stringify(event)).join("\n")}\n`));
  refreshManifest(data);
  const result = review(data);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.supplemental.command.tests[0].result, "SKIP");
});

test("a captured supplemental compile failure remains readable but cannot authorize runtime", () => {
  const data = fixture();
  data.files.set("supplemental/command.go-test.json", Buffer.from([
    JSON.stringify({ Action: "build-output", ImportPath: commandPackage, Output: "compile diagnostic\n" }),
    JSON.stringify({ Action: "build-fail", ImportPath: commandPackage }), "",
  ].join("\n")));
  data.files.set("supplemental/command.exit-code", Buffer.from("1\n")); refreshManifest(data);
  const result = review(data);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.supplemental.command.tests.length, 0);
});

test("a failed normal profile cannot be promoted by valid supplemental tests", () => {
  const data = fixture(); data.inspection.summary.result = "failed"; data.inspection.summary.statuses.tests = 1;
  const result = review(data);
  assert.equal(result.result, "failed"); assert.equal(result.runtimeEligible, false);
  assert.equal(result.skipReview, "REQUIRED_NOT_ACCEPTED");
});

test("the reader uses one immutable captured view and observes a post-capture source mutation only through a new view", () => {
  const data = fixture(); const captured = new Map([...data.files].map(([name, value]) => [name, Buffer.from(value)]));
  data.files.set("normal-skip-sources.tsv", Buffer.from("mutated after capture\n"));
  const frozenView = { read(name) { return Buffer.from(captured.get(name)); }, has(name) { return captured.has(name); } };
  assert.equal(reviewManagedSeaweedNormalProfile(data.inspection, frozenView).runtimeEligible, true);
  assert.throws(() => review(data), /scanner_managed_seaweed_skip_review_invalid/u);
});

test("generic zero-match Seaweed failure logs remain exportable without full test inspection", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-generic-failed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), destination = path.join(root, "public"); mkdirSync(source);
  writeFileSync(path.join(source, "ordinary.log"), "preparation failed before tests\n");
  const result = exportManagedSeaweedTextEvidence(source, destination);
  assert.equal(result.tests, undefined); assert.equal(result.profile, undefined);
  assert.equal(readFileSync(path.join(destination, "ordinary.log"), "utf8"), "preparation failed before tests\n");
});

function failedNormalEvidence(t, kind) {
  const root = mkdtempSync(path.join(os.tmpdir(), `aw-seaweed-${kind}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), destination = path.join(root, "public"); mkdirSync(source);
  const write = (name, value) => { const file = path.join(source, ...name.split("/")); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
  write("normal-skip-sources.tsv", fixed.sourceProofs.map((entry) => `${entry.path}\t${entry.bytes}\t${entry.sha256}`).join("\n") + "\n");
  const statuses = kind === "preparation" ? [1, 125, 125, 125, 125, 125] : kind === "build" ? [0, 0, 125, 125, 2, 1] : [0, 0, 1, 0, 0, 0];
  for (const [index, name] of ["preparation", "package-list", "go-test", "go-test-capture", "build", "build-validation"].entries())
    write(`${name}.exit-code`, `${statuses[index]}\n`);
  if (kind === "preparation") return { source, destination };
  const packageName = "github.com/seaweedfs/seaweedfs/weed/storage";
  write("package-list.txt", `${packageName}\n`); write("build.stdout.txt", ""); write("build.stderr.txt", "diagnostic\n"); write("go-test.stderr.txt", "");
  mkdirSync(path.join(source, "go-test-events"));
  if (kind === "build") {
    const empty = sha256(Buffer.alloc(0));
    write("go-test-manifest.tsv", ""); write("go-test-manifest-bytes.txt", "0\n"); write("go-test-manifest.sha256", `${empty}  go-test-manifest.tsv\n`);
    write("go-test-stream.tsv", `0\t${empty}\n`); write("go-test-concat.tsv", `0\t${empty}\n`);
    return { source, destination };
  }
  const events = [{ Action: "start", Package: packageName }, { Action: "run", Package: packageName, Test: "TestFailure" },
    { Action: "fail", Package: packageName, Test: "TestFailure" }, { Action: "fail", Package: packageName }];
  const chunk = Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  write("go-test-events/chunk-0000.json", chunk);
  const manifest = `chunk-0000.json\t${chunk.length}\t${sha256(chunk)}\n`;
  write("go-test-manifest.tsv", manifest); write("go-test-manifest-bytes.txt", `${Buffer.byteLength(manifest)}\n`);
  write("go-test-manifest.sha256", `${sha256(manifest)}  go-test-manifest.tsv\n`);
  write("go-test-stream.tsv", `${chunk.length}\t${sha256(chunk)}\n`); write("go-test-concat.tsv", `${chunk.length}\t${sha256(chunk)}\n`);
  const candidate = "9".repeat(64); write("binary-pre-test-sha256.txt", `${candidate}\n`); write("binary-post-test-sha256.txt", `${candidate}\n`);
  write("binary-sha256.txt", `${candidate}  /out/weed\n`);
  return { source, destination };
}

for (const kind of ["preparation", "build", "test"]) test(`actual ${kind} failure exports structured non-runtime Seaweed evidence`, (t) => {
  const data = failedNormalEvidence(t, kind);
  const exported = exportManagedSeaweedTextEvidence(data.source, data.destination);
  assert.equal(exported.tests.result, "failed"); assert.equal(exported.tests.runtimeEligible, false);
  assert.equal(exported.tests.normalProfileTests, "FAILED"); assert.equal(exported.tests.skipReview, "REQUIRED_NOT_ACCEPTED");
  assert.equal(exported.tests.statuses[kind === "test" ? "tests" : kind], kind === "preparation" ? 1 : kind === "build" ? 2 : 1);
  assert.equal(exported.profile, undefined);
});

test("actual supplemental producer early failure is exported as structured FAILED evidence", (t) => {
  const data = fixture();
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-actual-failed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), input = path.join(root, "input"), evidence = path.join(input, "evidence");
  const output = path.join(root, "output"), materials = path.join(root, "materials"), work = path.join(root, "work"), goRoot = path.join(root, "go");
  for (const directory of [source, input, evidence, output, materials, work, path.join(goRoot, "lib/time"), path.join(goRoot, "src/time")])
    mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(source, "weed"), { recursive: true });
  const putSized = (file, size) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, Buffer.alloc(size, 0x73)); };
  for (const proof of fixed.sourceProofs) putSized(path.join(source, ...proof.path.split("/")), proof.bytes);
  putSized(path.join(source, "go.mod"), 26652); putSized(path.join(source, "go.sum"), 232835);
  putSized(path.join(goRoot, "lib/time/zoneinfo.zip"), 408467);
  putSized(path.join(goRoot, "src/time/zoneinfo.go"), 18613); putSized(path.join(goRoot, "src/time/zoneinfo_read.go"), 14741);
  putSized(path.join(input, "weed"), 123456);
  for (const name of ["source-sha256.txt", "module-inventory.json", "module-verify.txt", "binary-sha256.txt", "normal-skip-sources.tsv"])
    writeFileSync(path.join(evidence, name), data.files.get(name === "normal-skip-sources.tsv" ? name : name));
  for (const [name, value] of [["preparation.exit-code", "0\n"], ["package-list.exit-code", "0\n"], ["go-test.exit-code", "0\n"],
    ["go-test-capture.exit-code", "0\n"], ["build.exit-code", "0\n"], ["build-validation.exit-code", "0\n"]]) writeFileSync(path.join(evidence, name), value);
  writeFileSync(path.join(materials, "normal-skip-sources.tsv"), data.files.get("normal-skip-sources.tsv"));

  const bin = path.join(root, "bin"); mkdirSync(bin);
  const hashShim = path.join(bin, "sha256sum");
  writeFileSync(hashShim, `#!/bin/sh
if [ "\${1-}" = '-c' ]; then cat > /dev/null; exit 0; fi
file=$1
case "$file" in
  *zoneinfo.zip) value=b2d18a7c8fa8142097a48c99609fb3c92db5ee98bc740294e57eab8ae9f94779 ;;
  *zoneinfo.go) value=198928e8d2573d88d8743db57b86777a26506f17ef2b0283882a9f5c884979b7 ;;
  *zoneinfo_read.go) value=812b0025c6e4face22e709053183d59e03e71e3c1459187350f4088587f4a134 ;;
  *go.mod) value=5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9 ;;
  *go.sum) value=abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a ;;
  *'/input/weed'|*'\\input\\weed') value=${"7".repeat(64)} ;;
  *)
    value=$(awk -F '\t' -v p="$file" 'index(p,$1)==length(p)-length($1)+1 {print $3}' "$AW_SOURCE_MANIFEST")
    if [ -z "$value" ]; then exec /usr/bin/sha256sum "$file"; fi
    ;;
esac
printf '%s  %s\n' "$value" "$file"
`);
  const goShim = path.join(bin, "go"); writeFileSync(goShim, "#!/bin/sh\nprintf '%s\\n' 'go version go1.27.3 linux/amd64'\n");
  chmodSync(hashShim, 0o755); chmodSync(goShim, 0o755);
  const shellPath = (value) => process.platform === "win32" ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):\//u,
    (_match, drive) => `/mnt/${drive.toLowerCase()}/`) : value;
  const runner = shellPath(path.resolve("infra/managed-images/seaweedfs/run-supplemental-profile.sh"));
  const environment = {
    PATH: `${shellPath(bin)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    AW_SOURCE_MANIFEST: shellPath(path.join(materials, "normal-skip-sources.tsv")), GOENV: "intentionally-wrong", GOTOOLCHAIN: "local",
    GOWORK: "off", CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64", GOPROXY: "https://proxy.golang.org", GOSUMDB: "sum.golang.org",
    GOPRIVATE: "", GONOPROXY: "", GONOSUMDB: "", GOFLAGS: "", GOMODCACHE: "/go/pkg/mod", GOCACHE: "/work/go-cache",
    GOTMPDIR: "/work/go-tmp", TMPDIR: "/work/tmp", HOME: "/work/home", WEED_BINARY: "/input/weed",
  };
  const scriptArguments = [runner, ...[source, input, output, materials, work, goRoot].map(shellPath)];
  const result = process.platform === "win32"
    ? spawnSync("C:/Windows/System32/wsl.exe", ["--distribution", "Ubuntu-24.04", "--exec", "/usr/bin/env",
      ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), "/bin/bash", ...scriptArguments], { encoding: "utf8" })
    : spawnSync("/bin/bash", scriptArguments, { encoding: "utf8", env: { ...process.env, ...environment } });
  assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stderr}`);
  for (const name of readdirSync(output)) data.files.set(`supplemental/${name}`, readFileSync(path.join(output, name)));
  assert.equal(data.files.get("supplemental/preflight.exit-code").toString(), "1\n");
  assert.equal(data.files.get("supplemental/command.exit-code").toString(), "125\n");
  assert.equal(data.files.get("supplemental/capture.exit-code").toString(), "125\n");
  assert.equal(data.files.get("supplemental/finalization.exit-code").toString(), "1\n");
  const reviewed = review(data);
  assert.equal(reviewed.result, "failed"); assert.equal(reviewed.runtimeEligible, false);
  assert.equal(reviewed.supplemental.evidenceCompleteness, "COMPLETE");
});
