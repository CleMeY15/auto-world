import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { captureManagedGosuRuntimeTrace, commandFailureDiagnostic } from "../scripts/scanner/official-audit.mjs";

// Synthetic BuildKit syntax fixtures: these are not native build evidence.
const ROOT = path.resolve(import.meta.dirname, "..");
const hashBytes = (b) => createHash("sha256").update(b).digest("hex");
const run = { GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40), GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1" };
const args = ["buildx", "build", "--platform", "linux/amd64", "--progress", "plain", "--file",
  path.join(ROOT, "infra/managed-images/Dockerfile.postgres"), "--no-cache-filter", "gosu-offline-reconstruction",
  "--target", "runtime", "--tag", `auto-world-managed/postgres:${run.GITHUB_SHA}`, "--metadata-file",
  path.join(ROOT, "fixture-metadata.json"), "--load", ROOT];
const binding = () => ({ run: { ...run }, commandIndex: 17, args: [...args] });
const header = "#21 [gosu-offline-reconstruction 10/10] RUN --mount=type=bind,from=gosu-build,source=/out/gosu,target=/reference-gosu,readonly /usr/local/bin/gosu-offline-reconstruction";
const selected = [header,
  "#21 0.101 gosu_offline_missing_zip_refused:github.com/moby/sys/user@v0.4.1",
  "#21 0.202 gosu_offline_missing_zip_refused:golang.org/x/sys@v0.1.0",
  "#21 0.303 gosu_offline_upstream_go_test_cases=0",
  "#21 1.404 gosu_offline_reconstruction_passed", "#21 DONE 1.5s"];
const entry = { size: 3, sha256: hashBytes("abc") };
const projection = "gosu_material_input_v1:" + JSON.stringify({ schemaVersion: 1, kind: "GOSU_MATERIAL_INPUT_PROJECTION_V1",
  source: entry, goMod: entry, goSum: entry, moduleProxyTsv: entry, offlineReceipt: entry, referenceBinary: entry,
  compilerVersion: "go version go1.27.3 linux/amd64" });
const raw = (lines) => Buffer.from(lines.join("\n") + "\n");
const encode = (lines = selected) => raw(lines.flatMap((line) => line === selected[4] ? [line, "#21 1.410 " + projection] : [line]));
const empty = Buffer.alloc(0);
const failure = { message: "scanner_gosu_runtime_trace_invalid" };
const capture = (stderr = encode(), options = binding(), stdout = empty) =>
  captureManagedGosuRuntimeTrace(stdout, stderr, options);

test("first runtime trace retains exact native lines and invocation/stream identities without private output", () => {
  const stderr = encode(["#7 [other 1/1] RUN private-command", "#7 0.1 private-value", selected[0],
    "#21 0.100 private module download JSON", ...selected.slice(1)]);
  const stdout = Buffer.from("private stdout\n");
  const options = binding();
  const bytes = capture(stderr, options, stdout), proof = JSON.parse(bytes);
  assert.ok(bytes.length <= 8192);
  assert.deepEqual(proof.lines, selected);
  assert.equal(proof.kind, "GOSU_RUNTIME_BUILDKIT_TRACE_V1");
  assert.equal(proof.role, "postgres"); assert.equal(proof.target, "runtime");
  assert.equal(proof.commandIndex, 17); assert.deepEqual(proof.run, run);
  assert.equal(proof.argumentsSha256, hashBytes(Buffer.from(JSON.stringify(args))));
  assert.deepEqual(proof.stderr, { size: stderr.length, sha256: hashBytes(stderr) });
  assert.deepEqual(proof.stdout, { size: stdout.length, sha256: hashBytes(stdout) });
  assert.doesNotMatch(bytes.toString(), /private-value|private-command|private stdout|private module|fixture-metadata/u);
  assert.deepEqual(proof.materialInput, { vertex: "21", line: projection + "\n", size: projection.length + 1, sha256: hashBytes(projection + "\n"), eof: true });
  assert.equal(proof.stream, "stderr");
  options.run.GITHUB_SHA = "b".repeat(40); stderr.fill(0);
  assert.equal(JSON.parse(bytes).run.GITHUB_SHA, run.GITHUB_SHA);
});

test("plain printer interleaving preserves repeated headers and separators for one vertex", () => {
  const lines = [selected[0], selected[1], "#21 ...", "#3 [other 2/2] RUN unrelated", "#3 DONE 1.0s",
    selected[0], ...selected.slice(2)];
  const proof = JSON.parse(capture(encode(lines)));
  assert.deepEqual(proof.lines, lines.filter((line) => line.startsWith("#21 ")));
  assert.equal(JSON.parse(capture(empty, binding(), encode())).stream, "stdout");
  assert.equal(JSON.parse(capture(encode(selected.map((line) => line.replace("RUN --mount", "RUN --network=none --mount"))))).lines.length, 6);
});

test("cached, missing, duplicate, reordered and ambiguous native observations refuse", async (t) => {
  const mutations = [
    ["empty", []], ["cached", [header, "#21 CACHED"]],
    ["cached with spoofed markers", [...selected.slice(0, -1), "#21 CACHED"]],
    ["error", [...selected.slice(0, -1), "#21 ERROR: failed"]],
    ["cancelled", [...selected.slice(0, -1), "#21 CANCELED"]],
    ["no DONE", selected.slice(0, -1)], ["missing refusal", selected.filter((_, i) => i !== 1)],
    ["duplicate refusal", [...selected.slice(0, 2), selected[1], ...selected.slice(2)]],
    ["wrong order", [header, selected[2], selected[1], ...selected.slice(3)]],
    ["late success", [header, ...selected.slice(1, 4), selected[5], selected[4]]],
    ["second vertex", [...selected, ...selected.map((line) => line.replace("#21", "#22"))]],
    ["header changed", [header, selected[1], header.replace("10/10", "9/10"), ...selected.slice(2)]],
    ["wrong vertex markers", selected.map((line, i) => i > 0 && i < 5 ? line.replace("#21", "#22") : line)],
    ["foreign marker", selected.map((line) => line.replace("sys@v0.1.0", "sys@v0.1.1"))],
    ["extra marker", [...selected.slice(0, -1), "#21 1.405 gosu_offline_foreign", selected[5]]],
    ["duplicate DONE", [...selected, selected[5]]],
    ["wrong command", selected.map((line) => line.replace("RUN --mount", "RUN echo --mount"))],
  ];
  for (const [name, lines] of mutations) await t.test(name, () => assert.throws(() => capture(encode(lines)), failure));
  assert.throws(() => capture(encode(), binding(), encode()), failure, "split streams are not ordered together");
  assert.throws(() => capture(encode(), binding(), Buffer.from("#21 CACHED\n")), failure);
});

test("trace has input/output bounds, strict UTF8 and fixed first-solve context", () => {
  for (const bytes of [Buffer.alloc(8 * 1024 ** 2 + 1), Buffer.concat([encode(), Buffer.from([0xff])])])
    assert.throws(() => capture(bytes), failure);
  assert.throws(() => capture(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encode()])), failure);
  assert.throws(() => capture(encode().subarray(0, -1)), failure, "truncated final line cannot prove completion");
  assert.throws(() => capture(encode([header, ...Array(100).fill("#21 ..."), ...selected.slice(1)])), failure);
  assert.throws(() => capture(encode([header, `#21 0.01 ${"x".repeat(16384)}`, ...selected.slice(1)])), failure);
  for (const value of [null, undefined, "text", new Uint8Array(4)])
    assert.throws(() => captureManagedGosuRuntimeTrace(value, encode(), binding()), failure);
  for (const change of [
    (b) => { b.args[b.args.indexOf("runtime")] = "evidence"; },
    (b) => { b.args[b.args.indexOf("--no-cache-filter")] = "--cache-from"; },
    (b) => { b.args[7] = path.join(ROOT, "infra/managed-images/Dockerfile.seaweedfs"); },
    (b) => { b.args.push("--push"); }, (b) => { b.args[13] = "foreign:tag"; },
    (b) => { b.commandIndex = 0; }, (b) => { b.commandIndex = 1.5; },
    (b) => { b.run.GITHUB_SHA = "bad"; }, (b) => { b.run.GITHUB_WORKFLOW_SHA = "b".repeat(40); },
    (b) => { b.run.GITHUB_RUN_ATTEMPT = "0"; }, (b) => { b.run.GITHUB_REPOSITORY = "foreign/repo"; },
  ]) { const b = binding(); change(b); assert.throws(() => capture(encode(), b), failure); }
});

test("actual command wrapper publishes only a successful first-runtime selection and binds the receipt", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "aw-gosu-trace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = readFileSync(path.join(ROOT, "scripts/scanner/official-audit.mjs"), "utf8");
  const start = source.indexOf("  const command = (executable, originalArgs,");
  const end = source.indexOf("  const phase = async", start);
  assert.ok(start > 0 && end > start);
  const receipt = { run, commands: [] };
  let result = { status: 0, signal: null, stdout: empty, stderr: encode() };
  const command = runInNewContext(`(() => { ${source.slice(start, end)} return command; })()`, {
    Buffer, path, writeFileSync, output: root, DOCKER: "/fixture/docker", environment: {}, receipt,
    scope: "managed", cleanupUncertain: false, captureManagedGosuRuntimeTrace, hashBytes,
    invoke: () => result, successful: (r) => !r.error && r.status === 0 && r.signal === null,
    fail: (code) => { throw new Error(code); }, commandFailureDiagnostic,
  });
  command("/fixture/docker", args, { gosuRuntimeTrace: true });
  const bytes = readFileSync(path.join(root, "managed-gosu-runtime-trace.json"));
  assert.deepEqual(JSON.parse(JSON.stringify(receipt.commands[0].gosuRuntimeTrace)),
    { path: "managed-gosu-runtime-trace.json", size: bytes.length, sha256: hashBytes(bytes) });
  assert.equal(JSON.parse(bytes).commandIndex, 1);
  rmSync(path.join(root, "managed-gosu-runtime-trace.json"));
  result = { ...result, stderr: encode([header, "#21 CACHED"]) };
  assert.throws(() => command("/fixture/docker", args, { gosuRuntimeTrace: true }), failure);
  assert.equal(Object.hasOwn(receipt.commands[1], "gosuRuntimeTrace"), false);
  assert.equal(readdirSync(root).includes("managed-gosu-runtime-trace.json"), false);
  result = { ...result, status: 1, stderr: encode() };
  assert.throws(() => command("/fixture/docker", args, { gosuRuntimeTrace: true }), /scanner_official_command_failed/u);
  assert.equal(Object.hasOwn(receipt.commands[2], "gosuRuntimeTrace"), false);
  result = { ...result, status: 0 };
  command("/fixture/docker", args, {});
  assert.equal(Object.hasOwn(receipt.commands[3], "gosuRuntimeTrace"), false);
  assert.equal(readdirSync(root).includes("managed-gosu-runtime-trace.json"), false);
});

test("material projection must occur once, in canonical grammar in the first successful RUN interval", () => {
  const line = "#21 1.405 " + projection;
  for (const lines of [selected, [...selected, line], [line, ...selected],
    [...selected.slice(0, -1), line, line, selected.at(-1)], [...selected.slice(0, 4), line, ...selected.slice(4)]])
    assert.throws(() => capture(raw(lines)), failure);
  for (const changed of [line.replace("#21", "#22"), line.replace('{"size":3', '{"size":3,"size":3'),
    line.replace('"source"', '"extra":0,"source"'), line.replace(':3,', ':3.0,'), line + " ", line.replace("amd64", "arm64")])
    assert.throws(() => capture(raw([...selected.slice(0, -1), changed, selected.at(-1)])), failure);
  assert.throws(() => capture(raw(selected), binding(), raw([line])), failure);
});
