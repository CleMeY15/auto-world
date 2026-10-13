import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  GOSU_ARCHIVE_LIMITS_V1,
  exactIdentity,
  scanRawUstar,
} from "../scripts/postgres-image/gosu-derivative-archives-v1.mjs";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_CONTROLS = path.join(REPO, "scripts/postgres-image/gosu-derivative-controls-v1.mjs");
const FIXTURES = path.join(REPO, "tests/fixtures/gosu-public-license");
const requestedControls = process.env.AW_GOSU_PUBLIC_LICENSE_SOURCE_FILE;
const CONTROLS = requestedControls
  ? path.resolve(REPO, requestedControls)
  : DEFAULT_CONTROLS;

if (!CONTROLS.startsWith(`${REPO}${path.sep}`)) throw new Error("gosu_public_license_test_source_outside_repo");
const controlsInfo = lstatSync(CONTROLS);
if (!controlsInfo.isFile() || controlsInfo.isSymbolicLink() || controlsInfo.nlink !== 1 || controlsInfo.size > 128 * 1024) {
  throw new Error("gosu_public_license_test_source_invalid");
}

const controlsSource = readFileSync(CONTROLS, "utf8");
const lock = JSON.parse(readFileSync(path.join(REPO, "infra/postgres-image/materials/gosu-derivative-lock-v1.json"), "utf8"));
const sources = JSON.parse(readFileSync(path.join(FIXTURES, "sources.json"), "utf8"));
const fixtureBodies = Object.fromEntries(sources.files.map(({ file }) => [file, readFileSync(path.join(FIXTURES, file))]));
const LICENSE_FIXTURES = Object.freeze({
  "licenses/gosu-LICENSE": "apache-2.0.txt",
  "licenses/moby-user-LICENSE": "apache-2.0.txt",
  "licenses/go-LICENSE": "go-LICENSE.txt",
  "licenses/go-PATENTS": "PATENTS.txt",
  "licenses/x-sys-LICENSE": "x-sys-LICENSE.txt",
  "licenses/x-sys-PATENTS": "PATENTS.txt",
});

function sourceSection(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || to <= from) throw new Error("gosu_public_license_test_source_shape_invalid");
  return source.slice(from, to);
}

const core = sourceSection(controlsSource, "const HEX =", "export async function fileIdentity")
  .split("\n")
  .filter((line) => !/^const (?:scriptFile|repo|lockFileDefault|buildFile|archivesFile|reviewSnapshots) =/u.test(line))
  .join("\n")
  .replaceAll("export ", "");
const semantic = sourceSection(controlsSource, "function parseCanonical", "export async function validateRetainedEntries")
  .replaceAll("export ", "");
const retained = sourceSection(controlsSource, "export async function validateRetainedEntries", "export async function validatePublicTree");
const semanticAt = retained.indexOf("await validateSemanticDocuments(byName, receipt, lock);");
const receiptAt = retained.indexOf("gosu_retained_receipt_invalid");
const controlsAt = retained.indexOf("validateControls(controls, receipt);");
const privacyAt = retained.indexOf("for (const [name, entry] of byName)");
if (!(semanticAt >= 0 && semanticAt < receiptAt && receiptAt < controlsAt && controlsAt < privacyAt)) {
  throw new Error("gosu_public_license_test_validation_order_changed");
}
const privacyReturnAt = retained.indexOf("return true;", privacyAt);
if (privacyReturnAt < 0) throw new Error("gosu_public_license_test_privacy_loop_missing");
const privacyLoop = retained.slice(privacyAt, privacyReturnAt);
const publicTree = sourceSection(controlsSource, "export async function validatePublicTree", "export async function validateTransportRoundTrip");
const inventoryStart = publicTree.indexOf("if (discovered.length > GOSU_ARCHIVE_LIMITS_V1.publicTree.members");
const inventoryEnd = publicTree.indexOf("let total = 0;", inventoryStart);
if (inventoryStart < 0 || inventoryEnd < 0) throw new Error("gosu_public_license_test_inventory_guard_missing");
const inventoryGuard = publicTree.slice(inventoryStart, inventoryEnd);

const context = vm.createContext({
  Array,
  Buffer,
  Error,
  JSON,
  Map,
  Number,
  Object,
  Promise,
  RegExp,
  Set,
  createHash,
  exactIdentity,
  GOSU_ARCHIVE_LIMITS_V1,
  scanRawUstar,
});
new vm.Script(`
${core}
${semantic}
function validateFinalPrivacyLoop(byName, lock) { ${privacyLoop} return true; }
function validatePublicInventory(discovered) { ${inventoryGuard} return true; }
globalThis.gosuPublicLicenseApi = Object.freeze({
  GOSU_PUBLIC_FILES_V1,
  canonicalJson,
  canonicalNotices,
  canonicalSbom,
  moduleClosure,
  validateFinalPrivacyLoop,
  validatePublicInventory,
  validateSemanticDocuments,
});
`, { filename: CONTROLS }).runInContext(context, { timeout: 1_000 });
const api = context.gosuPublicLicenseApi;
if (context.process !== undefined || context.require !== undefined || context.fetch !== undefined) {
  throw new Error("gosu_public_license_test_vm_capability_invalid");
}

const DEFAULT_GODEBUG = "asynctimerchan=1,containermaxprocs=0,cryptocustomrand=1,decoratemappings=0,gotestjsonbuildtext=1,gotypesalias=0,httpcookiemaxnum=0,httplaxcontentlength=1,httpmuxgo121=1,httpservecontentkeepheaders=1,httpservecontentmaxranges=1,multipathtcp=0,panicnil=1,randseednop=0,rsa1024min=0,tls10server=1,tls3des=1,tlsmlkem=0,tlsrsakex=1,tlssecpmlkem=0,tlssha1=1,tlsunsafeekm=1,updatemaxprocs=0,urlmaxqueryparams=0,urlstrictcolons=0,winreadlinkvolume=0,winsymlink=0,x509keypairleaf=0,x509negativeserial=1,x509rsacrt=0,x509sha256skid=0,x509usepolicies=0";
const SYNTHETIC_BUILD_INFO = [
  "./gosu: go1.26.9",
  "\tpath\tgithub.com/tianon/gosu",
  "\tmod\tgithub.com/tianon/gosu\t(devel)\t",
  ...lock.modules.map((item) => `\tdep\t${item.path}\t${item.version}\t${item.zip.h1}`),
  "\tbuild\t-buildmode=exe",
  "\tbuild\t-compiler=gc",
  "\tbuild\t-trimpath=true",
  `\tbuild\tDefaultGODEBUG=${DEFAULT_GODEBUG}`,
  "\tbuild\tCGO_ENABLED=0",
  "\tbuild\tGOARCH=amd64",
  "\tbuild\tGOOS=linux",
  "\tbuild\tGOAMD64=v1",
  "",
].join("\n");

function putOctal(block, offset, length, value) {
  block.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
}

function syntheticSumdbUstar() {
  const body = Buffer.from("synthetic sumdb proof for semantic validation only\n");
  const header = Buffer.alloc(512);
  header.write("sum.golang.org/lookup/synthetic", 0, "ascii");
  putOctal(header, 100, 8, 0o644);
  putOctal(header, 108, 8, 0);
  putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, body.length);
  putOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 48;
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  putOctal(header, 329, 8, 0);
  putOctal(header, 337, 8, 0);
  putOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]);
}

function semanticCase() {
  const receipt = {
    binary: { bytes: 4, sha256: "a".repeat(64) },
    tests: { count: 0, passed: 0, skipped: 0, failed: 0, packagesPassed: 1, packagesSkipped: 0, functionalValidation: "NOT_ESTABLISHED" },
    networkCutoff: {
      checks: { namespaceChanged: true, loopbackDown: true, routesEmpty: true, ordinaryIdentity: true, zeroCapabilities: true, noNewPrivileges: true },
      evidence: {
        namespaceTransition: { bytes: 40, sha256: "1".repeat(64) },
        status: { bytes: 64, sha256: "2".repeat(64) },
        routes: { bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
        loopbackFlags: { bytes: 7, sha256: "3".repeat(64) },
      },
    },
  };
  const byName = new Map([
    ["version.txt", { body: Buffer.from("1.19 (go1.26.9 on linux/amd64; gc)\n") }],
    ["build-info.txt", { body: Buffer.from(SYNTHETIC_BUILD_INFO) }],
    ["module-closure.json", { body: Buffer.from(api.canonicalJson(api.moduleClosure(lock))) }],
    ["sbom.cdx.json", { body: Buffer.from(api.canonicalJson(api.canonicalSbom(lock, receipt.binary))) }],
    ["licenses/notices.json", { body: Buffer.from(api.canonicalJson(api.canonicalNotices())) }],
    ["upstream-tests.json", { body: Buffer.from(api.canonicalJson({ kind: "GOSU_UPSTREAM_TEST_RESULTS_V1", run: 0, passed: 0, skipped: 0, failed: 0, packagesPassed: 1, packagesSkipped: 0, functionalValidation: "NOT_ESTABLISHED" })) }],
    ["network-cutoff.json", { body: Buffer.from(api.canonicalJson({ kind: "GOSU_NETWORK_CUTOFF_V1", checks: receipt.networkCutoff.checks, evidence: receipt.networkCutoff.evidence })) }],
    ["sumdb-proofs.tar", { body: syntheticSumdbUstar() }],
    ...Object.entries(LICENSE_FIXTURES).map(([name, fixture]) => [name, { body: Buffer.from(fixtureBodies[fixture]) }]),
  ]);
  return { byName, receipt };
}

test("public license fixtures are the exact six lock-authenticated bodies", () => {
  assert.equal(sources.kind, "GOSU_LOCKED_PUBLIC_LICENSE_FIXTURES_V1");
  assert.equal(sources.scope, "PUBLIC_LOCK_AUTHENTICATED_TEST_INPUTS_ONLY");
  assert.equal(sources.actualRunProvenance, "NOT_ESTABLISHED");
  assert.equal(sources.files.length, 4);
  for (const item of sources.files) {
    assert.deepEqual(exactIdentity(fixtureBodies[item.file]), item.identity);
    assert.equal(item.matchesLock, true);
  }
  for (const [name, fixture] of Object.entries(LICENSE_FIXTURES)) {
    const module = name.includes("moby-user") ? lock.modules.find((item) => item.id === "moby-user") : name.includes("x-sys") ? lock.modules.find((item) => item.id === "x-sys") : null;
    const wanted = name === "licenses/gosu-LICENSE" ? lock.source.license
      : name === "licenses/go-LICENSE" ? lock.goSource.license
        : name === "licenses/go-PATENTS" ? lock.goSource.patents
          : name === "licenses/moby-user-LICENSE" ? module.license
            : name === "licenses/x-sys-LICENSE" ? module.license
              : module.patents;
    assert.deepEqual(exactIdentity(fixtureBodies[fixture]), { bytes: wanted.bytes, sha256: wanted.sha256 }, name);
  }
});

test("real semantic validation accepts all six exact public license identities", async () => {
  const value = semanticCase();
  await assert.doesNotReject(api.validateSemanticDocuments(value.byName, value.receipt, lock));
});

test("the real final retained privacy loop accepts authenticated public licenses", () => {
  const publicLicenses = new Map(Object.entries(LICENSE_FIXTURES).map(([name, fixture]) => [name, { body: fixtureBodies[fixture] }]));
  assert.equal(api.validateFinalPrivacyLoop(publicLicenses, lock), true);
});

test("real semantic license hashing rejects every mutated and missing exact license", async () => {
  for (const name of Object.keys(LICENSE_FIXTURES)) {
    const mutated = semanticCase();
    const changed = Buffer.from(mutated.byName.get(name).body);
    changed[0] ^= 1;
    mutated.byName.set(name, { body: changed });
    await assert.rejects(api.validateSemanticDocuments(mutated.byName, mutated.receipt, lock), /gosu_license_invalid/u, `mutated ${name}`);

    const missing = semanticCase();
    missing.byName.delete(name);
    await assert.rejects(api.validateSemanticDocuments(missing.byName, missing.receipt, lock), /gosu_license_invalid/u, `missing ${name}`);
  }
});

test("the real public inventory guard rejects extra and renamed license paths", () => {
  const expected = [...api.GOSU_PUBLIC_FILES_V1];
  assert.throws(() => api.validatePublicInventory([...expected, "licenses/extra-LICENSE"]), /gosu_public_output_invalid/u);
  assert.throws(() => api.validatePublicInventory(expected.map((name) => name === "licenses/gosu-LICENSE" ? "licenses/renamed-LICENSE" : name)), /gosu_public_output_invalid/u);
});

test("generated documents and unknown license paths retain the real private-text rejection", () => {
  const documents = api.GOSU_PUBLIC_FILES_V1.filter((name) => name !== "gosu"
    && name !== "sumdb-proofs.tar" && !name.startsWith("materials/")
    && !Object.hasOwn(LICENSE_FIXTURES, name));
  const markers = ["C:\\private\\payload", "/home/private", "/Users/private", "/tmp/private",
    "/private/var/private", "RUNNER_TEMP", "GITHUB_TOKEN", "ghp_private",
    "github_pat_private", "Bearer private", "exception", "stack", "AW_GOSU_PRIVATE"];
  for (const name of [...documents, "licenses/renamed-LICENSE", "licenses/go-LICENSE-extra"]) {
    for (const marker of markers) {
      const entries = new Map([[name, { body: Buffer.from(marker) }]]);
      assert.throws(() => api.validateFinalPrivacyLoop(entries, lock), /gosu_public_private_data_invalid/u, `${name}: ${marker}`);
    }
  }
});

test("caller-reported replacement license hashes cannot replace the original lock", async () => {
  for (const name of Object.keys(LICENSE_FIXTURES)) {
    const value = semanticCase();
    const body = Buffer.from(value.byName.get(name).body);
    body[0] ^= 1;
    value.byName.set(name, { body });
    value.receipt.files = { [name]: exactIdentity(body) };
    await assert.rejects(api.validateSemanticDocuments(value.byName, value.receipt, lock), /gosu_license_invalid/u, name);
  }
});

test("private notices fail canonical semantic validation before the final privacy loop", async () => {
  const value = semanticCase();
  value.byName.set("licenses/notices.json", { body: Buffer.from(api.canonicalJson({ private: "RUNNER_TEMP" })) });
  await assert.rejects(api.validateSemanticDocuments(value.byName, value.receipt, lock), /gosu_notices_invalid/u);
});
