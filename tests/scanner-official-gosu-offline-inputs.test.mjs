import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { bindManagedGosuEvidence, evaluateManagedArchiveForRole, exportManagedTextEvidence,
  managedEvidenceDiagnostic, managedGosuHashArguments, parseManagedGosuModulePayloads,
  parseManagedGosuOfflineReconstruction } from "../scripts/scanner/official-audit.mjs";
import { MANAGED_GOSU_SOURCE as pin } from "../scripts/scanner/official-controls.mjs";

const filename = "offline-reconstruction.json";
const moduleFilename = "module-proxy-payloads.tsv";
const failure = /scanner_gosu_offline_reconstruction_invalid/u;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (name, bytes) => ({ path: name, size: bytes.length, sha256: hash(bytes) });
const source = readFileSync(new URL("../scripts/scanner/official-audit.mjs", import.meta.url), "utf8");
const originalDirectory = new URL("./fixtures/scanner-official/managed-gosu/", import.meta.url);
const original = (name) => readFileSync(new URL(name, originalDirectory));
const subject = () => ({ kind: "LOCAL_MANAGED_IMAGE_V1",
  imageId: "sha256:349cb0724274474208917a3e4064a585ab6df13339fc248742c23440f7d83f8f", os: "linux", architecture: "amd64",
  archiveSha256: "2a3fe9cbe179138638d3ee2da545c076b1299dff524da4063588b254833f96fd", archiveBytes: 302056448,
  artifactName: "/managed-image-postgres.tar" });
const moduleBytes = (suffix = "") => Buffer.from([
  ["github.com/moby/sys/user", "v0.4.1"], ["golang.org/x/sys", "v0.1.0"],
].flatMap(([module, version]) => ["info", "mod", "zip"].map((kind) =>
  `${module}\t${version}\t${kind}\t13\t${hash(`${module}@${version}.${kind}${suffix}`)}\n`)).join(""));
const moduleIdentity = (bytes = moduleBytes()) => identity(moduleFilename, bytes);
const record = (modules = moduleIdentity()) => ({
  schemaVersion: 1, kind: "GOSU_OFFLINE_INPUTS_SAME_TOOLCHAIN_V1",
  sourceArchiveSha256: pin.sourceArchiveSha256, modulePayloadsSha256: modules.sha256,
  goModSha256: pin.goModSha256, goSumSha256: pin.goSumSha256, compilerVersion: pin.compilerVersion,
  referenceBinarySha256: pin.binarySha256, reconstructedBinarySha256: pin.binarySha256,
  freshSourceAndCaches: true, network: "none",
  missingZipRefusals: ["github.com/moby/sys/user@v0.4.1", "golang.org/x/sys@v0.1.0"],
});
const encode = (value = record()) => Buffer.from(`${JSON.stringify(value)}\n`);
const parse = (bytes = encode(), modules = moduleIdentity(), image = subject()) =>
  parseManagedGosuOfflineReconstruction(bytes, identity(filename, bytes), modules, image);

test("Gosu offline observation binds canonical captured bytes, same-producer TSV and local image identity", () => {
  const bytes = encode(), captured = identity(filename, bytes), modules = moduleIdentity(), image = subject();
  const parsed = parseManagedGosuOfflineReconstruction(bytes, captured, modules, image);
  assert.deepEqual(parsed, { ...record(), imageId: image.imageId, archiveSha256: image.archiveSha256,
    archiveBytes: image.archiveBytes, os: "linux", architecture: "amd64", evidence: captured });
  const frozen = JSON.stringify(parsed);
  bytes.fill(0); captured.size = 1; modules.sha256 = "0".repeat(64); image.imageId = `sha256:${"1".repeat(64)}`;
  assert.equal(JSON.stringify(parsed), frozen, "returned observation does not retain mutable input aliases");
  assert.equal(Object.hasOwn(parsed, "admission"), false);
  assert.notEqual(parsed.kind, "SOURCE_BOUND_GOSU_V1");
});

test("same-build proxy metadata can change without promoting historical measurement hashes to pins", () => {
  const updatedBytes = moduleBytes("updated producer"), updated = moduleIdentity(updatedBytes);
  const observed = parseManagedGosuModulePayloads(updatedBytes, updated);
  const bytes = encode(record(observed.evidence));
  assert.throws(() => parse(bytes), failure, "a receipt from another producer's TSV cannot be substituted");
  assert.equal(parse(bytes, observed.evidence).modulePayloadsSha256, updated.sha256);
  const otherSubject = { ...subject(), imageId: `sha256:${"e".repeat(64)}`, archiveSha256: "f".repeat(64), archiveBytes: 300000000 };
  const bound = parse(bytes, observed.evidence, otherSubject);
  assert.equal(bound.imageId, otherSubject.imageId);
  assert.equal(bound.archiveSha256, otherSubject.archiveSha256);
  assert.equal(bound.archiveBytes, otherSubject.archiveBytes);
});

test("offline receipt rejects altered pins, success assertions, missing refusals and extra authority", () => {
  for (const [key, replacement] of [
    ["schemaVersion", 2], ["kind", "SOURCE_BOUND_GOSU_V1"], ["sourceArchiveSha256", "a".repeat(64)],
    ["modulePayloadsSha256", "b".repeat(64)], ["goModSha256", "c".repeat(64)], ["goSumSha256", "d".repeat(64)],
    ["compilerVersion", "go1.27.4"], ["referenceBinarySha256", "e".repeat(64)],
    ["reconstructedBinarySha256", "f".repeat(64)], ["freshSourceAndCaches", false], ["freshSourceAndCaches", "true"],
    ["network", "default"], ["missingZipRefusals", []], ["missingZipRefusals", record().missingZipRefusals.toReversed()],
    ["missingZipRefusals", [...record().missingZipRefusals, "example.invalid/extra@v1.0.0"]], ["admission", "ADMITTED"],
  ]) assert.throws(() => parse(encode({ ...record(), [key]: replacement })), failure, key);
  for (const key of Object.keys(record())) {
    const value = record(); delete value[key];
    assert.throws(() => parse(encode(value)), failure, `missing ${key}`);
  }
});

test("canonical comparison rejects duplicate keys, encoding ambiguity and unbounded JSON", () => {
  const text = encode().toString("utf8");
  for (const bytes of [
    Buffer.alloc(0), Buffer.alloc(4097, 32), Buffer.from("null\n"), Buffer.from("[]\n"), Buffer.from("{\n"),
    Buffer.from(text.trimEnd()), Buffer.from(`${text}\n`), Buffer.from(text.replaceAll("\n", "\r\n")),
    Buffer.from(`\uFEFF${text}`), Buffer.from(` ${text}`), Buffer.from(`${JSON.stringify(record(), null, 2)}\n`),
    encode(Object.fromEntries(Object.entries(record()).toReversed())),
    Buffer.from(text.replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,')),
    Buffer.from(text.replace('"schemaVersion":1,', '"schemaVersion":2,"schemaVersion":1,')),
    Buffer.from(text.replace('"network":"none"', '"network":"no\\u006ee"')),
    Buffer.from(text.replace('"schemaVersion":1,', '"schemaVersion":1.0,')),
    Buffer.concat([encode(), Buffer.from([0xff])]),
  ]) assert.throws(() => parse(bytes), failure);
  for (const value of [null, undefined, text, new Uint8Array(encode())])
    assert.throws(() => parseManagedGosuOfflineReconstruction(value, identity(filename, encode()), moduleIdentity(), subject()), failure);
});

test("offline observation requires closed public identities and a PostgreSQL Linux/amd64 subject", () => {
  const bytes = encode(), captured = identity(filename, bytes), modules = moduleIdentity();
  for (const supplied of [null, undefined, [], {}, { ...captured, path: "postgres/offline-reconstruction.json" },
    { ...captured, size: captured.size + 1 }, { ...captured, size: 0 }, { ...captured, size: "100" },
    { ...captured, sha256: "0".repeat(64) }, { ...captured, sha256: captured.sha256.toUpperCase() }, { ...captured, retained: true }])
    assert.throws(() => parseManagedGosuOfflineReconstruction(bytes, supplied, modules, subject()), failure);
  for (const supplied of [null, undefined, [], {}, { ...modules, path: "foreign.tsv" }, { ...modules, size: 0 },
    { ...modules, size: 1025 }, { ...modules, size: 1.5 }, { ...modules, sha256: "g".repeat(64) },
    { ...modules, sha256: modules.sha256.toUpperCase() }, { ...modules, extra: true }])
    assert.throws(() => parseManagedGosuOfflineReconstruction(bytes, captured, supplied, subject()), failure);
  for (const supplied of [null, undefined, {}, { ...subject(), kind: "UPSTREAM_REGISTRY_SUBJECT" },
    { ...subject(), artifactName: "/managed-image-seaweedfs.tar" }, { ...subject(), imageId: "a".repeat(64) },
    { ...subject(), archiveSha256: `sha256:${"a".repeat(64)}` }, { ...subject(), archiveBytes: 0 },
    { ...subject(), archiveBytes: Number.MAX_SAFE_INTEGER + 1 }, { ...subject(), os: "windows" },
    { ...subject(), architecture: "arm64" }])
    assert.throws(() => parseManagedGosuOfflineReconstruction(bytes, captured, modules, supplied), failure);
});

const postgresStart = source.indexOf('if (candidate.role === "postgres" && build.result === "passed") {');
const catchStart = source.indexOf('} catch (error) {\n            build.evidenceExport = "failed";', postgresStart);
const nextAssert = source.indexOf("await assertFilesUnchanged(inputs);", catchStart);
assert.ok(postgresStart > 0 && catchStart > postgresStart && nextAssert > catchStart);
// Execute the actual PostgreSQL branch and its actual shared export catch.
// The only command seam writes a retained fixture hash; it never invokes Docker.
const applyBlock = `try { ${source.slice(postgresStart, nextAssert)}`;

function fixture(t) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(path.join(parent, "aw-gosu-offline-audit-")));
  const evidence = path.join(root, "source"), artifacts = path.join(root, "artifacts"), published = path.join(root, "public");
  const destination = path.join(published, "postgres");
  for (const directory of [evidence, artifacts, published]) mkdirSync(directory);
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("aw-gosu-offline-audit-"));
    rmSync(root, { recursive: true, force: true });
  });
  for (const name of ["build-info.txt", "binary-sha256.txt", "source-sha256.txt", "go.mod", "go.sum"])
    writeFileSync(path.join(evidence, name), original(name));
  writeFileSync(path.join(evidence, moduleFilename), moduleBytes());
  writeFileSync(path.join(evidence, filename), encode());
  const image = subject(), localImages = new Map([["postgres", { subject: image }]]);
  const build = { role: "postgres", result: "passed", subject: image,
    publicEvidence: exportManagedTextEvidence(evidence, destination) };
  const context = {
    build, candidate: { role: "postgres" }, evidence, artifacts, published, localImages,
    DOCKER: "test-only-docker-not-executed", path, mkdirSync, readFileSync, bindManagedGosuEvidence,
    managedGosuHashArguments, parseManagedGosuModulePayloads, parseManagedGosuOfflineReconstruction,
    exportManagedTextEvidence, managedEvidenceDiagnostic, receipt: { commands: [] }, cleanupUncertain: false,
    fail: (code) => { throw new Error(code); },
    command: (executable, args, options) => {
      assert.equal(executable, "test-only-docker-not-executed");
      assert.deepEqual(args, managedGosuHashArguments(image));
      const bytes = Buffer.from(`${pin.binarySha256}  /usr/local/bin/gosu\n`);
      writeFileSync(options.file, bytes); return bytes;
    },
  };
  const report = { json: JSON.parse(original("image-postgres.json")), sbom: JSON.parse(original("image-postgres.cdx.json")) };
  // Explicit historical fixture adaptation, matching existing evaluator tests.
  // This is a local boundary test, not a new scanner or reconstruction result.
  report.json.Trivy.Version = "0.76.2";
  return { build, evidence, destination, local: localImages.get("postgres"), context,
    apply: () => runInNewContext(applyBlock, context, { timeout: 1000 }),
    evaluate: () => evaluateManagedArchiveForRole({ role: "postgres" }, report, localImages.get("postgres"), {},
      new Date("2026-10-25T14:46:00.000Z")) };
}

test("actual audit branch uses captured bytes and keeps new observation separate from old source authority", (t) => {
  const data = fixture(t);
  writeFileSync(path.join(data.evidence, filename), "private copy changed after capture\n");
  data.apply();
  assert.equal(data.build.evidenceExport, "passed");
  assert.equal(data.build.gosuOfflineReconstruction.modulePayloadsSha256, data.build.gosuModulePayloads.evidence.sha256);
  assert.deepEqual(data.build.gosuOfflineReconstruction.evidence, identity(filename, encode()));
  assert.equal(data.local.gosuEvidence, data.build.gosuSourceEvidence);
  assert.equal(data.local.gosuEvidence.kind, "SOURCE_BOUND_GOSU_V1");
  assert.equal(Object.hasOwn(data.local.gosuEvidence, "freshSourceAndCaches"), false);
  assert.deepEqual(data.evaluate().blockers, []);
  data.local.gosuEvidence = data.build.gosuOfflineReconstruction;
  assert.throws(() => data.evaluate(), /scanner_gosu_source_evidence_invalid/u);
});

test("actual export catch cannot turn missing, substituted or foreign-producer proof into accepted Gosu evidence", async (t) => {
  const mutations = [
    ["missing captured file", (data) => rmSync(path.join(data.destination, filename))],
    ["changed bytes", (data) => writeFileSync(path.join(data.destination, filename), encode({ ...record(), network: "default" }))],
    ["missing identity", (data) => { data.build.publicEvidence = data.build.publicEvidence.filter((item) => item.path !== filename); }],
    ["foreign producer", (data) => {
      const bytes = encode(record(moduleIdentity(moduleBytes("foreign producer"))));
      writeFileSync(path.join(data.destination, filename), bytes);
      data.build.publicEvidence = data.build.publicEvidence.map((item) => item.path === filename ? identity(filename, bytes) : item);
    }],
    ["authenticated but false receipt", (data) => {
      const bytes = encode({ ...record(), missingZipRefusals: [] });
      writeFileSync(path.join(data.destination, filename), bytes);
      data.build.publicEvidence = data.build.publicEvidence.map((item) => item.path === filename ? identity(filename, bytes) : item);
    }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, (child) => {
    const data = fixture(child); chmodSync(path.join(data.destination, filename), 0o600); mutate(data);
    data.apply();
    assert.equal(data.build.evidenceExport, "failed");
    assert.equal(data.build.evidenceReason, "scanner_gosu_offline_reconstruction_invalid");
    assert.equal(Object.hasOwn(data.build, "gosuOfflineReconstruction"), false);
    assert.equal(Object.hasOwn(data.local, "gosuEvidence"), false);
    assert.throws(() => data.evaluate(), /scanner_gosu_source_evidence_invalid/u);
  });
});

test("actual Buildx calls invalidate only the PostgreSQL reconstruction stage in the existing runtime solve", () => {
  const calls = [...source.matchAll(/command\(DOCKER, \["buildx", "build",[\s\S]*?\], \{ timeout: 90 \* 60_000 \}\);/gu)].map(([call]) => call);
  assert.equal(calls.length, 2, "runtime plus evidence, with no additional solve");
  for (const role of ["postgres", "opensearch", "seaweedfs", "aws-cli"]) {
    const observed = [];
    const context = { DOCKER: "fixture", ROOT: "/fixture", candidate: { role, dockerfile: `Dockerfile.${role}` },
      path, tag: "fixture:only", metadataFile: "/fixture/metadata.json", evidence: "/fixture/evidence",
      command: (_executable, args, options) => observed.push({ args: Array.from(args), options }) };
    for (const call of calls) runInNewContext(call, context, { timeout: 1000 });
    assert.deepEqual(observed.map(({ args }) => args[args.indexOf("--target") + 1]), ["runtime", "evidence"]);
    for (const [index, { args, options }] of observed.entries()) {
      const filters = args.flatMap((arg, position) => arg === "--no-cache-filter" ? [args[position + 1]] : []);
      assert.deepEqual(filters, role === "postgres" && index === 0 ? ["gosu-offline-reconstruction"] : []);
      assert.equal(args.includes("--no-cache"), false);
      assert.equal(args.includes("--push"), false);
      assert.equal(options.timeout, 90 * 60_000);
    }
  }
});
