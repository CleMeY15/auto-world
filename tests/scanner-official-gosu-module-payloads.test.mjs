import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { exportManagedTextEvidence, parseManagedGosuModulePayloads } from "../scripts/scanner/official-audit.mjs";

const MiB = 1024 ** 2;
const filename = "module-proxy-payloads.tsv";
const failure = /scanner_gosu_module_payloads_invalid/u;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = [
  ["github.com/moby/sys/user", "v0.4.1", "info", 13],
  ["github.com/moby/sys/user", "v0.4.1", "mod", 21],
  ["github.com/moby/sys/user", "v0.4.1", "zip", 34],
  ["golang.org/x/sys", "v0.1.0", "info", 55],
  ["golang.org/x/sys", "v0.1.0", "mod", 89],
  ["golang.org/x/sys", "v0.1.0", "zip", 144],
].map(([module, version, kind, bytes]) => ({ module, version, kind, bytes, sha256: hash(`${module}@${version}.${kind}`) }));
const encode = (rows = files) => Buffer.from(`${rows.map((row) =>
  [row.module, row.version, row.kind, row.bytes, row.sha256].join("\t")).join("\n")}\n`);
const identity = (bytes) => ({ path: filename, size: bytes.length, sha256: hash(bytes) });
const parse = (bytes = encode()) => parseManagedGosuModulePayloads(bytes, identity(bytes));

test("Gosu module observations have six fixed descriptors, derived total and captured-byte identity", () => {
  const bytes = encode();
  assert.deepEqual(parse(bytes), { files, totalBytes: 356, evidence: identity(bytes) });
  const metadata = identity(bytes);
  const result = parseManagedGosuModulePayloads(bytes, metadata);
  bytes.fill(0);
  metadata.sha256 = "a".repeat(64);
  assert.deepEqual(result, { files, totalBytes: 356, evidence: identity(encode()) });
});

test("Gosu observations refuse row-set, order, field-count and canonical text substitutions", () => {
  const text = encode().toString("utf8"), lines = text.trimEnd().split("\n");
  const variants = [
    "", `${lines.slice(0, -1).join("\n")}\n`, `${text}${lines[0]}\n`,
    `${[lines[0], lines[0], ...lines.slice(2)].join("\n")}\n`,
    `${[lines[1], lines[0], ...lines.slice(2)].join("\n")}\n`,
    text.replace("github.com/moby/sys/user", "example.invalid/user"),
    text.replace("v0.4.1", "v0.4.2"), text.replace("\tinfo\t", "\tziphash\t"),
    text.replace("\tinfo\t", "\tinfo\textra\t"), text.replace("\tinfo\t", "\t"),
    text.replaceAll("\n", "\r\n"), text.slice(0, -1), `${text}\n`, `\uFEFF${text}`,
    text.replace("v0.4.1", "v0.4.１"), text.replace("\t13\t", "\t13\0\t"),
    text.replace(files[0].sha256, files[0].sha256.toUpperCase()),
    text.replace(files[0].sha256, "a".repeat(63)), text.replace(files[0].sha256, "g".repeat(64)),
  ];
  for (const value of variants) assert.throws(() => parse(Buffer.from(value)), failure);
  assert.throws(() => parse(Buffer.alloc(1025, 65)), failure);
  assert.throws(() => parse(Buffer.concat([encode(), Buffer.from([0xff])])), failure);
});

test("Gosu payload sizes are positive canonical integers with independent file and aggregate caps", () => {
  for (const value of ["0", "-1", "+13", "013", "13.0", "1e1", " 13", "13 ", "NaN", "Infinity", "9007199254740993"])
    assert.throws(() => parse(Buffer.from(encode().toString().replace("\t13\t", `\t${value}\t`))), failure);
  const within = files.map((file, index) => ({ ...file, bytes: index === 0 ? 16 * MiB : index === 1 ? 16 * MiB - 4 : 1 }));
  assert.equal(parse(encode(within)).totalBytes, 32 * MiB);
  assert.throws(() => parse(encode(within.map((file, index) => ({ ...file, bytes: file.bytes + (index === 0 ? 1 : 0) })))), failure);
  assert.throws(() => parse(encode(within.map((file, index) => ({ ...file, bytes: file.bytes + (index === 1 ? 1 : 0) })))), failure);
});

test("Gosu parser requires the exact same public evidence bytes and closed descriptor", () => {
  const bytes = encode(), proof = identity(bytes);
  for (const supplied of [null, undefined, [], {}, { ...proof, path: `postgres/${filename}` },
    { ...proof, size: proof.size + 1 }, { ...proof, sha256: "a".repeat(64) },
    { ...proof, sha256: proof.sha256.toUpperCase() }, { ...proof, retained: true }])
    assert.throws(() => parseManagedGosuModulePayloads(bytes, supplied), failure);
  for (const value of [null, undefined, bytes.toString(), new Uint8Array(bytes)])
    assert.throws(() => parseManagedGosuModulePayloads(value, proof), failure);
  const changed = Buffer.from(bytes.toString().replace("\t13\t", "\t14\t"));
  assert.throws(() => parseManagedGosuModulePayloads(changed, proof), failure);
  // A newly authenticated observation is only a measurement record: payload possession is not inferred.
  assert.equal(parse(changed).files[0].bytes, 14);
});

function exportedFixture(t) {
  const parent = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(path.join(parent, "aw-gosu-module-payloads-")));
  const source = path.join(directory, "source"), published = path.join(directory, "public");
  const destination = path.join(published, "postgres");
  mkdirSync(source); mkdirSync(published);
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith("aw-gosu-module-payloads-"));
    for (const folder of [source, destination]) {
      const file = path.join(folder, filename);
      if (existsSync(file)) chmodSync(file, 0o600);
    }
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(path.join(source, filename), encode());
  const publicEvidence = exportManagedTextEvidence(source, destination);
  const build = { gosuSourceEvidence: { kind: "unchanged-test-sentinel" }, publicEvidence };
  return { source, published, destination, build };
}

const source = readFileSync(new URL("../scripts/scanner/official-audit.mjs", import.meta.url), "utf8");
const postgres = source.split('if (candidate.role === "postgres" && build.result === "passed") {')[1]
  .split('if (candidate.role === "opensearch" && build.result === "passed") {')[0];
const assignment = postgres.match(/let gosuModulePayloadBytes;[\s\S]*?build\.gosuModulePayloads = parseManagedGosuModulePayloads\([\s\S]*?\);\r?\n/u)?.[0];
assert.ok(assignment, "exercise the actual fixed PostgreSQL call site");
const applyActualAssignment = (fixture) => runInNewContext(assignment, {
  build: fixture.build, published: fixture.published, candidate: { role: "postgres" },
  readFileSync, path, parseManagedGosuModulePayloads, fail: (message) => { throw new Error(message); },
}, { timeout: 1000 });

test("the actual PostgreSQL call reads the captured public TSV and leaves Gosu authority separate", (t) => {
  const fixture = exportedFixture(t);
  const originalContext = fixture.build.gosuSourceEvidence;
  writeFileSync(path.join(fixture.source, filename), "changed private source after capture\n");
  applyActualAssignment(fixture);
  assert.deepEqual(fixture.build.gosuModulePayloads, { files, totalBytes: 356, evidence: identity(encode()) });
  assert.equal(fixture.build.gosuSourceEvidence, originalContext);
  assert.deepEqual(fixture.build.publicEvidence, [identity(encode())]);
  assert.deepEqual(readFileSync(path.join(fixture.destination, filename)), encode());
});

test("the actual PostgreSQL call refuses captured-byte substitution or missing public identity", (t) => {
  const fixture = exportedFixture(t), captured = path.join(fixture.destination, filename);
  chmodSync(captured, 0o600);
  writeFileSync(captured, encode().toString().replace("\t13\t", "\t14\t"));
  assert.throws(() => applyActualAssignment(fixture), failure);
  assert.equal(Object.hasOwn(fixture.build, "gosuModulePayloads"), false);
  writeFileSync(captured, encode());
  fixture.build.publicEvidence = [];
  assert.throws(() => applyActualAssignment(fixture), failure);
  assert.equal(Object.hasOwn(fixture.build, "gosuModulePayloads"), false);
});

test("a missing captured Gosu measurement fails with a fixed code and no private path", (t) => {
  const fixture = exportedFixture(t), captured = path.join(fixture.destination, filename);
  chmodSync(captured, 0o600);
  rmSync(captured);
  assert.throws(() => applyActualAssignment(fixture), { message: "scanner_gosu_module_payloads_invalid" });
  assert.equal(Object.hasOwn(fixture.build, "gosuModulePayloads"), false);
});
