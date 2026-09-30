import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import test from "node:test";
import { validatePostgresSourceInventoryEnvironment, requirePostgresSourceInventoryDiagnosticContext,
  finishPostgresSourceInventoryOutput } from "../scripts/postgres-image/local-source-inventory-diagnostic.mjs";
import { postgresPrivateRuntimeEvidenceEnvironment as ENV } from "../scripts/postgres-image/private-runtime-evidence-policy.mjs";

const contextError = { message: "postgres_source_inventory_diagnostic_context_invalid" };
const outputError = { message: "postgres_source_inventory_diagnostic_output_invalid" };

test("source inventory environment is a detached closed five-field snapshot", () => {
  const result = validatePostgresSourceInventoryEnvironment({ ...ENV });
  assert.deepEqual(result, ENV); assert.ok(Object.isFrozen(result)); assert.notEqual(result, ENV);
  let reads = 0;
  const accessor = { ...ENV }; Object.defineProperty(accessor, "HOME", { enumerable: true, get() { reads++; return ENV.HOME; } });
  const hidden = { ...ENV }; Object.defineProperty(hidden, "HOME", { value: ENV.HOME, enumerable: false });
  const impostor = Object.assign(Object.create(Object.getPrototypeOf(process.env)), ENV);
  const invalid = [null, [], Object.assign(Object.create(null), ENV), accessor, hidden,
    { ...ENV, [Symbol("fixture")]: true }, { ...ENV, NODE_OPTIONS: "--fixture" }, { ...ENV, HOME: [ENV.HOME] }];
  if (Object.getPrototypeOf(process.env) !== Object.prototype) invalid.push(impostor);
  for (const value of invalid) assert.throws(() => validatePostgresSourceInventoryEnvironment(value), contextError);
  assert.equal(reads, 0);
});

test("fixed source inventory context rejects arguments and decorated empty arrays before collection", () => {
  const decorated = []; decorated.extra = true;
  const symbol = []; symbol[Symbol("fixture")] = true;
  let reads = 0; const getter = []; Object.defineProperty(getter, "extra", { get() { reads++; return true; } });
  for (const argv of [null, {}, ["--directory=/fixture"], decorated, symbol, getter]) {
    assert.throws(() => requirePostgresSourceInventoryDiagnosticContext(argv, { ...ENV }), contextError);
  }
  assert.equal(reads, 0);
  if (process.platform !== "linux" || process.getuid?.() !== 1000 || process.execArgv.length) {
    assert.throws(() => requirePostgresSourceInventoryDiagnosticContext([], { ...ENV }), contextError);
  }
});

test("ACK output observes real public finish and writes exactly one bounded JSON line", async () => {
  const chunks = [];
  const output = new Writable({ write(bytes, encoding, callback) { chunks.push(Buffer.from(bytes)); callback(); } });
  await finishPostgresSourceInventoryOutput(output, { state: "PARTIAL_OUTPUT_FIXTURE" });
  assert.equal(Buffer.concat(chunks).toString("utf8"), '{"state":"PARTIAL_OUTPUT_FIXTURE"}\n');
  assert.equal(output.writableFinished, true); assert.equal(output.writableEnded, true);
  await assert.rejects(finishPostgresSourceInventoryOutput(output, { state: "PARTIAL_OUTPUT_FIXTURE" }), outputError);
});

test("ACK output rejects write failure, invalid finish and oversized output", async () => {
  const failure = new Writable({ write(bytes, encoding, callback) { callback(new Error("private fixture text")); } });
  await assert.rejects(finishPostgresSourceInventoryOutput(failure, { state: "PARTIAL_OUTPUT_FIXTURE" }), outputError);
  const incomplete = new Writable({ write(bytes, encoding, callback) { callback(); } });
  incomplete.end = (bytes, callback) => { callback(); };
  await assert.rejects(finishPostgresSourceInventoryOutput(incomplete, { state: "PARTIAL_OUTPUT_FIXTURE" }), outputError);
  const unused = new Writable({ write(bytes, encoding, callback) { callback(); } });
  await assert.rejects(finishPostgresSourceInventoryOutput(unused, { fixture: "x".repeat(16 * 1024) }), outputError);
  assert.equal(unused.writableEnded, false);
});

test("ACK output retains the callback finish observation when a stream resets its flags", async () => {
  const output = new Writable({ write(bytes, encoding, callback) { callback(); } });
  output.end = (bytes, callback) => {
    Object.defineProperties(output, { writableFinished: { value: true, configurable: true }, writableEnded: { value: true, configurable: true } });
    callback();
    Object.defineProperties(output, { writableFinished: { value: false }, writableEnded: { value: false } });
  };
  await finishPostgresSourceInventoryOutput(output, { state: "PARTIAL_OUTPUT_FIXTURE" });
  assert.equal(output.writableFinished, false);
});

test("ACK output refuses a late error following a successful finish callback", async () => {
  const output = new Writable({ write(bytes, encoding, callback) { callback(); } });
  output.end = (bytes, callback) => {
    Object.defineProperties(output, { writableFinished: { value: true }, writableEnded: { value: true } });
    callback(); output.emit("error", new Error("private late fixture text"));
  };
  await assert.rejects(finishPostgresSourceInventoryOutput(output, { state: "PARTIAL_OUTPUT_FIXTURE" }), outputError);
});

test("actual Node22 child stdout reaches finish and EOF after the awaited ACK writer", () => {
  const moduleUrl = new URL("../scripts/postgres-image/local-source-inventory-diagnostic.mjs", import.meta.url).href;
  const code = `import { finishPostgresSourceInventoryOutput } from ${JSON.stringify(moduleUrl)};
let observed = false;
process.stdout.once('finish', () => { observed = process.stdout.writableFinished === true && process.stdout.writableEnded === true; });
await finishPostgresSourceInventoryOutput(process.stdout, {state:'PARTIAL_NATIVE_OUTPUT_FIXTURE'});
process.stderr.write(JSON.stringify({state:'PARTIAL_NATIVE_FINISH_PROOF',node:process.version,observed})+'\\n');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 4096,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null);
  assert.equal(result.stdout, '{"state":"PARTIAL_NATIVE_OUTPUT_FIXTURE"}\n');
  assert.deepEqual(JSON.parse(result.stderr), { state: "PARTIAL_NATIVE_FINISH_PROOF", node: "v22.23.2", observed: true });
});
