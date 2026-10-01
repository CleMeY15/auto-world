import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { collectPostgresGosuSources, TEST_ONLY_retainPostgresGosuSourceArchiveCopies, TEST_ONLY_publishPostgresGosuSourceArchiveCopies, validatePostgresGosuSourceInspection,
  validatePostgresGosuSourceInspectionMetadata, validatePostgresGosuSourceRetentionReceipt, validatePostgresGosuSourceRetentionAcknowledgement,
  postgresGosuSourceRetentionFailureDiagnostic, validatePostgresGosuSourceRetentionFailureDiagnostic } from "../scripts/postgres-image/gosu-source-retention.mjs";
import { POSTGRES_GOSU_SOURCE_PIN as PIN, POSTGRES_GOSU_SOURCE_CLAIMS as CLAIMS } from "../scripts/postgres-image/gosu-source-policy.mjs";

const rootSource = fileURLToPath(new URL("../", import.meta.url));
const clone = (v) => globalThis.structuredClone(v);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const native = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const metadata = (file) => native(fs.lstatSync(file, { bigint: true }));
const directoryMetadata = (file) => Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map((key) => [key, metadata(file)[key]]));
const identity = (ino = 1, size = 17) => ({ dev: "2096", ino: String(ino), uid: 1000, gid: 1000, mode: 0o600, nlink: 1, size, mtimeNs: "123", ctimeNs: "124" });
const context = () => { const nonce = "a".repeat(24); return { recipeRevision: "b".repeat(40), executionId: PIN.executionPrefix + nonce, directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) }; };
const ack = () => ({ kind: "POSTGRES_GOSU_SOURCE_RETENTION_ACK_V1", state: "SOURCES_RETAINED", ...context(), receipt: { name: "receipt.json", size: 17, sha256: "d".repeat(64), identity: identity() },
  sourceUnchanged: true, descriptorsClosed: true });

test("closed retention ACK validates structure and binds context; it does not establish a native success alone", () => {
  const value = validatePostgresGosuSourceRetentionAcknowledgement(ack(), context());
  assert.ok(Object.isFrozen(value.receipt.identity)); assert.deepEqual(value, ack());
  for (const mutate of [
    (v) => { v.receipt.size = [17]; }, (v) => { v.receipt.sha256 = [v.receipt.sha256]; }, (v) => { v.receipt.identity.nlink = 2; },
    (v) => { v.receipt.identity.mode = 0o644; }, (v) => { v.receipt.identity.uid = 0; }, (v) => { v.receipt.identity.ino = "01"; },
    (v) => { v.recipeRevision = "c".repeat(40); }, (v) => { v.directory += "/foreign"; }, (v) => { v.receipt.name = "../receipt.json"; },
    (v) => { v.descriptorsClosed = false; }, (v) => { v.private = "secret fixture"; }, (v) => { v.receipt.size = 128 * 1024 + 1; },
  ]) { const v = ack(); mutate(v); assert.throws(() => validatePostgresGosuSourceRetentionAcknowledgement(v, context()), { message: "postgres_gosu_source_proof_invalid" }); }
});

test("nested accessors, holes, Symbols and hidden keys are rejected without reading getters", () => {
  let reads = 0;
  for (const mutate of [
    (v) => Object.defineProperty(v.receipt.identity, "uid", { enumerable: true, get() { reads++; return 1000; } }),
    (v) => Object.defineProperty(v.receipt, "hidden", { value: "fixture" }), (v) => { v[Symbol("private")] = true; },
    (v) => { v.receipt.identity.extra = true; }, (v) => { Object.setPrototypeOf(v.receipt, null); },
  ]) { const v = ack(); mutate(v); assert.throws(() => validatePostgresGosuSourceRetentionAcknowledgement(v, context())); }
  assert.equal(reads, 0);
});

test("failure projection snapshots only data properties, masks unknown exceptions and enforces uncertainty", () => {
  let reads = 0; const unknown = new Error(); Object.defineProperty(unknown, "message", { get() { reads++; throw new Error("private"); } });
  assert.deepEqual(postgresGosuSourceRetentionFailureDiagnostic(unknown), { code: "postgres_gosu_source_operation_failed", phase: "CONTEXT", cleanup: "UNVERIFIED" }); assert.equal(reads, 0);
  const d = postgresGosuSourceRetentionFailureDiagnostic(Object.assign(new Error("postgres_gosu_source_cleanup_uncertain"), { phase: "CLEANUP", cleanup: "CONFIRMED" }));
  assert.deepEqual(d, { code: "postgres_gosu_source_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" });
  assert.deepEqual(validatePostgresGosuSourceRetentionFailureDiagnostic(d), d);
  assert.throws(() => validatePostgresGosuSourceRetentionFailureDiagnostic({ ...d, cleanup: "CONFIRMED" }));
  assert.deepEqual(postgresGosuSourceRetentionFailureDiagnostic(Object.assign(new Error("postgres_private_evidence_source_bundle_git_cleanup_uncertain"), { phase: "SOURCE", cleanup: "CONFIRMED" })),
    { code: "postgres_gosu_source_cleanup_uncertain", phase: "SOURCE", cleanup: "UNVERIFIED" });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error("private descriptor fixture"); }, getPrototypeOf() { reads++; throw new Error("private prototype fixture"); } });
  assert.equal(postgresGosuSourceRetentionFailureDiagnostic(proxy).code, "postgres_gosu_source_operation_failed"); assert.equal(reads, 0);
});

test("incomplete inspection/receipt projections cannot create historical or legal authority", () => {
  const base = { kind: "POSTGRES_GOSU_SOURCE_INSPECTION_V1", state: "VERIFIED", scope: "FIXED_GOSU_GO_DECLARED_SOURCE_ARCHIVES", archives: [] };
  for (const value of [base, { ...base, archives: [null, null, null, null] }, { ...base, raw: "notices fixture" }, { ...base, state: "SOURCES_RETAINED" }])
    assert.throws(() => validatePostgresGosuSourceInspection(value), { message: "postgres_gosu_source_proof_invalid" });
  const input = { workspace: PIN.workspace, ...context() };
  assert.throws(() => validatePostgresGosuSourceRetentionReceipt({ kind: "POSTGRES_GOSU_SOURCE_RETENTION_V1", claims: clone(CLAIMS) }, input));
  assert.equal(CLAIMS.closure, "INCOMPLETE"); assert.equal(CLAIMS.sourceClosure, "NOT_ESTABLISHED"); assert.equal(CLAIMS.currentness, "NOT_EVALUATED");
  for (const key of ["supportStartedAt", "supportEndsAt", "archiveUntil"]) assert.equal(CLAIMS[key], null);
  assert.deepEqual(PIN.python.arguments, ["-I", "-S", "-B", "/proc/self/fd/7"]);
});

test("PURE_METADATA_ONLY receipt pins every selected text reference and rejects embedded Base64 or false authority", () => {
  const inspection = { kind: "POSTGRES_GOSU_SOURCE_INSPECTION_V1", state: "VERIFIED", scope: "FIXED_GOSU_GO_DECLARED_SOURCE_ARCHIVES", archives: PIN.archives.map((a, i) => ({
    role: a.role, name: a.name, size: a.size, sha256: a.sha256, identity: identity(201 + i, a.size), entries: [27, 7, 506, 16677][i],
    uncompressedBytes: [50265, 42341, 8794105, 145142081][i], selectedFiles: clone(a.selectedFiles).sort((x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0),
    missingSelectedFiles: [...a.missingSelectedFiles].sort(), bindings: clone(a.bindings) })) };
  const input = { workspace: PIN.workspace, ...context() };
  const value = { kind: "POSTGRES_GOSU_SOURCE_RETENTION_V1", state: "SOURCES_RETAINED", authority: "LOCAL_DIAGNOSTIC", scope: "FOUR_FIXED_GOSU_GO_SOURCE_ARCHIVES",
    subject: PIN.subject, ...context(), filesystem: "EXT4", actor: { uid: 1000, gid: 1000, capabilities: "ZERO", noNewPrivs: 1 },
    sources: PIN.archives.map((a, i) => ({ role: a.role, name: a.name, sourceUrl: a.sourceUrl, size: a.size, sha256: a.sha256, sourceIdentity: identity(101 + i, a.size), identity: clone(inspection.archives[i].identity) })),
    inspection, python: { executable: PIN.python.executable, version: PIN.python.version, trust: PIN.python.trust, transitiveStdlibClosure: PIN.python.transitiveStdlibClosure,
      files: PIN.python.files.map((v, i) => ({ ...v, identity: { ...identity(301 + i, v.size), uid: 0, gid: 0, mode: v.mode } })) },
    recipe: { ...PIN.recipe, identity: { ...identity(400, PIN.recipe.size), mode: 0o644 } }, claims: clone(CLAIMS),
    requiredMissing: ["COMPLETE_APK_SOURCE_AND_NOTICES", "POSTGRESQL_SOURCE_AND_NOTICES", "RETAINED_LOWER_LAYER_COVERAGE", "OFFICIAL_ATTESTATION_BUNDLE", "SECOND_WINDOWS_EVIDENCE_COPY"],
    phases: ["SOURCE", "INPUTS", "COPY", "INSPECT", "PUBLISH", "FINAL_SEAL"].map((name) => ({ name, result: "PASSED", durationMs: 1 })), sourceUnchanged: true };
  assert.ok(Object.isFrozen(validatePostgresGosuSourceInspectionMetadata(inspection).archives[0].selectedFiles));
  assert.ok(Object.isFrozen(validatePostgresGosuSourceRetentionReceipt(value, input).claims));
  for (const mutate of [
    (v) => { v.inspection.archives[0].selectedFiles[0].base64 = "private byte duplication"; },
    (v) => { v.inspection.archives[0].selectedFiles[0].sha256 = "1".repeat(64); },
    (v) => { v.inspection.archives[1].bindings.h1 = v.inspection.archives[2].bindings.h1; },
    (v) => { v.inspection.archives[0].bindings.symlinks[0].followed = true; },
    (v) => { v.inspection.archives[0].entries = 1; }, (v) => { v.inspection.archives[0].uncompressedBytes = 1; },
    (v) => { v.sources[0].identity = clone(v.sources[0].sourceIdentity); }, (v) => { v.python.files[0].identity.uid = 1000; },
    (v) => { v.claims.sourceClosure = "COMPLETE"; }, (v) => { v.claims.supportStartedAt = "2026-10-01T00:00:00.000Z"; },
    (v) => { v.recipe.identity.mode = 0o666; }, (v) => { v.phases.reverse(); },
    (v) => Object.defineProperty(v.claims, "currentness", { enumerable: true, get() { throw new Error("must not read accessor"); } }),
  ]) { const changed = clone(value); mutate(changed); assert.throws(() => validatePostgresGosuSourceRetentionReceipt(changed, input), { message: "postgres_gosu_source_proof_invalid" }); }
});

test("malformed inputs and actual unsupported actors refuse before any native destination creation", async () => {
  await assert.rejects(collectPostgresGosuSources({}), { message: "postgres_gosu_source_arguments_invalid" });
  await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies({}), { message: "postgres_gosu_source_arguments_invalid" });
  const input = { workspace: PIN.workspace, ...context() };
  if (PIN.inputDirectoryIdentity && (process.platform !== "linux" || process.getuid() !== 1000 || process.getgid() !== 1000))
    await assert.rejects(collectPostgresGosuSources(input), { message: "postgres_gosu_source_requires_native_actor" });
  let reads = 0; const malformed = { ...input }; Object.defineProperty(malformed, "workspace", { enumerable: true, get() { reads++; return PIN.workspace; } });
  await assert.rejects(collectPostgresGosuSources(malformed)); assert.equal(reads, 0);
});

function git(directory, args) {
  const r = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, timeout: 10000, maxBuffer: 16384, encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" } });
  assert.equal(r.error, undefined); assert.equal(r.status, 0); assert.equal(r.stderr, ""); return r.stdout.trim();
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-gosu-source-fixture-"))); fs.chmodSync(root, 0o700); const own = metadata(root);
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).ino, own.ino); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-gosu-source-fixture-"))); fs.rmSync(root, { recursive: true }); });
  const workspace = path.join(root, "workspace"); const parent = path.join(root, "private"); const inputs = path.join(root, "inputs");
  for (const directory of [workspace, parent, inputs]) fs.mkdirSync(directory, { mode: directory === parent ? 0o750 : 0o700 }); fs.chmodSync(parent, 0o750);
  const bytes = PIN.archives.map((v, i) => Buffer.from(`harmless source fixture ${i}\n`));
  const archives = PIN.archives.map((a, i) => { fs.writeFileSync(path.join(inputs, a.name), bytes[i], { flag: "wx", mode: 0o600 }); return { ...clone(a), size: bytes[i].length, sha256: hash(bytes[i]) }; });
  git(workspace, ["init", "--quiet", "--template="]); fs.writeFileSync(path.join(workspace, "fixture.txt"), "public native copy fixture\n", { mode: 0o644 });
  git(workspace, ["add", "--all"]); git(workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "harmless copy fixture"]);
  const pin = { ...clone(PIN), workspace, parent, parentIdentity: directoryMetadata(parent), inputDirectory: inputs, inputDirectoryIdentity: directoryMetadata(inputs), archives };
  const recipeRevision = git(workspace, ["rev-parse", "HEAD"]); const nonce = randomBytes(12).toString("hex");
  const input = { workspace, recipeRevision, executionId: PIN.executionPrefix + nonce, directory: path.join(parent, PIN.directoryPrefix + nonce) };
  return { root, pin, input, bytes };
}
const nativeActor = process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000 &&
  JSON.stringify(process.getgroups()) === "[1000]" && /^Groups:[ \t]*$/mu.test(fs.readFileSync("/proc/self/status", "utf8")) && /^NoNewPrivs:[ \t]+1$/mu.test(fs.readFileSync("/proc/self/status", "utf8"));
const gitVersion = process.platform === "linux" ? spawnSync("/usr/bin/git", ["--version"], { encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } }).stdout.trim() : null;
if (nativeActor && gitVersion === "git version 2.43.0") {
  test("PARTIAL_NATIVE_COPY_PROOF: four harmless files retain exact bytes/private identities and close every held descriptor", async (t) => {
    const f = fixture(t); const originals = f.pin.archives.map((a) => metadata(path.join(f.pin.inputDirectory, a.name)));
    const value = await TEST_ONLY_retainPostgresGosuSourceArchiveCopies(f.input, { pin: f.pin });
    assert.equal(value.state, "PARTIAL_NATIVE_COPY_PROOF"); assert.equal(value.inspection, "NOT_ATTEMPTED"); assert.equal(value.sourceClosure, "NOT_ESTABLISHED");
    assert.deepEqual(fs.readdirSync(f.input.directory), ["archives"]); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    for (const [i, source] of value.sources.entries()) {
      const file = path.join(f.input.directory, "archives", source.name); assert.deepEqual(fs.readFileSync(file), f.bytes[i]); assert.deepEqual(metadata(file), source.identity);
      assert.deepEqual(source.sourceIdentity, originals[i]); assert.notEqual(source.identity.ino, originals[i].ino); assert.equal(source.identity.mode, 0o600);
    }
    for (const fd of fs.readdirSync("/proc/self/fd")) { let target; try { target = fs.readlinkSync("/proc/self/fd/" + fd); } catch { continue; } assert.ok(!target.startsWith(f.root)); }
    assert.throws(() => validatePostgresGosuSourceRetentionReceipt(value, f.input, f.pin));
  });
  test("native same-name collision preserves the preexisting foreign destination", async (t) => {
    const f = fixture(t); fs.mkdirSync(f.input.directory, { mode: 0o700 }); const before = metadata(f.input.directory);
    await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies(f.input, { pin: f.pin })); assert.deepEqual(metadata(f.input.directory), before);
    assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("native source hashes/modes/links/extra inputs and parent identity substitutions refuse without receipt", async (t) => {
    for (const alter of [
      (f) => fs.writeFileSync(path.join(f.pin.inputDirectory, f.pin.archives[0].name), "changed fixture\n"),
      (f) => fs.chmodSync(path.join(f.pin.inputDirectory, f.pin.archives[0].name), 0o644),
      (f) => fs.linkSync(path.join(f.pin.inputDirectory, f.pin.archives[0].name), path.join(f.root, "extra-hardlink")),
      (f) => fs.writeFileSync(path.join(f.pin.inputDirectory, "foreign.txt"), "fixture", { mode: 0o600 }),
      (f) => { f.pin.parentIdentity.ino = "1"; },
      (f) => { const file = path.join(f.pin.inputDirectory, f.pin.archives[0].name); fs.renameSync(file, file + ".original"); fs.symlinkSync(file + ".original", file); },
    ]) { const f = fixture(t); alter(f); await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies(f.input, { pin: f.pin })); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); }
  });
  test("native abort keeps all original harmless source bytes and never accepts a retention result", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies({ ...f.input, signal: controller.signal }, { pin: f.pin }));
    for (const [i, a] of f.pin.archives.entries()) assert.deepEqual(fs.readFileSync(path.join(f.pin.inputDirectory, a.name)), f.bytes[i]);
    assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("actual FIFO source slot refuses in a hard-bounded subprocess instead of blocking the native reader", async (t) => {
    const f = fixture(t); const file = path.join(f.pin.inputDirectory, f.pin.archives[0].name); fs.renameSync(file, path.join(f.root, "preserved-regular-source"));
    const made = spawnSync("/usr/bin/mkfifo", ["--mode=600", file], { timeout: 5000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    assert.equal(made.error, undefined); assert.equal(made.status, 0); assert.equal(fs.lstatSync(file).isFIFO(), true);
    const moduleUrl = new URL("../scripts/postgres-image/gosu-source-retention.mjs", import.meta.url).href;
    const code = `import {TEST_ONLY_retainPostgresGosuSourceArchiveCopies,postgresGosuSourceRetentionFailureDiagnostic} from ${JSON.stringify(moduleUrl)};try{await TEST_ONLY_retainPostgresGosuSourceArchiveCopies(JSON.parse(process.argv[1]),{pin:JSON.parse(process.argv[2])});process.exitCode=2;}catch(e){process.stdout.write(JSON.stringify(postgresGosuSourceRetentionFailureDiagnostic(e)));process.exitCode=1;}`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(f.input), JSON.stringify(f.pin)], { timeout: 5000, maxBuffer: 16384, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    assert.equal(r.error, undefined); assert.equal(r.signal, null); assert.equal(r.status, 1); assert.equal(r.stderr, "");
    assert.deepEqual(JSON.parse(r.stdout), { code: "postgres_gosu_source_file_changed", phase: "INPUTS", cleanup: "CONFIRMED" }); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("injected fsync failure is a refusal branch, preserves created private payloads, and grants no complete native proof", async (t) => {
    const f = fixture(t); let calls = 0; const original = fs.fsyncSync;
    t.mock.method(fs, "fsyncSync", (fd) => { calls++; if (calls === 1) throw new Error("injected private fixture error"); return original(fd); }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies(f.input, { pin: f.pin }), (e) => {
      assert.deepEqual(postgresGosuSourceRetentionFailureDiagnostic(e), { code: "postgres_gosu_source_operation_failed", phase: "COPY", cleanup: "CONFIRMED" }); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(metadata(path.join(f.input.directory, "archives", f.pin.archives[0].name)).mode, 0o600);
  });
  test("injected post-close error remains cleanup uncertainty; no complete receipt is published", async (t) => {
    const f = fixture(t); const original = fs.closeSync; let injected = false;
    t.mock.method(fs, "closeSync", (fd) => { const target = fs.readlinkSync(`/proc/self/fd/${fd}`); original(fd);
      if (!injected && target.startsWith(f.root)) { injected = true; throw new Error("injected close fixture"); } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies(f.input, { pin: f.pin }), (e) => {
      assert.equal(postgresGosuSourceRetentionFailureDiagnostic(e).cleanup, "UNVERIFIED"); assert.equal(e.message, "postgres_gosu_source_cleanup_uncertain"); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
  });
  test("FULL collector rejects substituted fixture workspace/pins before creating a destination", async (t) => {
    const f = fixture(t); await assert.rejects(collectPostgresGosuSources(f.input, {}, { pin: f.pin }), { message: "postgres_gosu_source_arguments_invalid" });
    assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("PARTIAL publication uses shared native seals and closes every FD before a single bounded output callback", async (t) => {
    const f = fixture(t); let callbacks = 0;
    const result = await TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result: (value) => {
      callbacks++; assert.equal(value.state, "PARTIAL_NATIVE_COPY_PROOF"); assert.equal(value.descriptorsClosed, true);
      for (const fd of fs.readdirSync("/proc/self/fd")) { let name; try { name = fs.readlinkSync("/proc/self/fd/" + fd); } catch { continue; } assert.ok(!name.startsWith(f.root)); }
    } }, { pin: f.pin });
    assert.equal(callbacks, 1); assert.equal(result.inspection, "NOT_ATTEMPTED");
    const file = path.join(f.input.directory, "receipt.json"); const bytes = fs.readFileSync(file); assert.equal(hash(bytes), result.receipt.sha256);
    assert.deepEqual(metadata(file), result.receipt.identity); assert.deepEqual(fs.readdirSync(f.input.directory).sort(), ["archives", "receipt.json"]);
    assert.throws(() => validatePostgresGosuSourceRetentionAcknowledgement(result, { recipeRevision: f.input.recipeRevision, executionId: f.input.executionId, directory: f.input.directory }));
    assert.throws(() => validatePostgresGosuSourceRetentionReceipt(JSON.parse(bytes), f.input, f.pin));
  });
  test("PARTIAL late writer exception retires own receipt and reads no unknown exception getter", async (t) => {
    const f = fixture(t); let reads = 0; const error = new Error(); Object.defineProperty(error, "message", { get() { reads++; throw new Error("private fixture"); } });
    await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result() { throw error; } }, { pin: f.pin }), (e) => {
      assert.deepEqual(postgresGosuSourceRetentionFailureDiagnostic(e), { code: "postgres_gosu_source_output_failed", phase: "OUTPUT", cleanup: "CONFIRMED" }); return true;
    });
    assert.equal(reads, 0); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL late edited owned receipt with changed size/timestamps is retired by stable native identity", async (t) => {
    const f = fixture(t);
    await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result(value) {
      const file = path.join(f.input.directory, "receipt.json"); const before = metadata(file);
      const data = JSON.parse(fs.readFileSync(file)); data.fixtureLatePublicValue = "changed length and timestamps"; fs.writeFileSync(file, JSON.stringify(data) + "\n");
      assert.equal(metadata(file).ino, before.ino); assert.notEqual(metadata(file).size, value.receipt.size); throw new Error("late output fixture");
    } }, { pin: f.pin }), (e) => { assert.equal(e.cleanup, "CONFIRMED"); return true; });
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL foreign receipt replacement is preserved with cleanup UNVERIFIED", async (t) => {
    const f = fixture(t);
    await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result() {
      const file = path.join(f.input.directory, "receipt.json"); fs.renameSync(file, path.join(f.input.directory, "owned-receipt-preserved.json"));
      fs.writeFileSync(file, "foreign harmless receipt\n", { flag: "wx", mode: 0o600 }); throw new Error("late output fixture");
    } }, { pin: f.pin }), (e) => { assert.equal(e.message, "postgres_gosu_source_cleanup_uncertain"); assert.equal(e.cleanup, "UNVERIFIED"); return true; });
    assert.equal(fs.readFileSync(path.join(f.input.directory, "receipt.json"), "utf8"), "foreign harmless receipt\n");
    assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL changed parent identity preserves the previous receipt and refuses cleanup certainty", async (t) => {
    const f = fixture(t); const previous = path.join(f.root, "moved-private-output");
    await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result() {
      fs.renameSync(f.input.directory, previous); fs.mkdirSync(f.input.directory, { mode: 0o700 }); throw new Error("late output fixture");
    } }, { pin: f.pin }), (e) => { assert.equal(e.cleanup, "UNVERIFIED"); return true; });
    assert.equal(fs.existsSync(path.join(previous, "receipt.json")), true); assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("PARTIAL nonsettling writer is bounded by the real ten-second output deadline", { timeout: 20000 }, async (t) => {
    const f = fixture(t); const started = Date.now();
    await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result: () => new Promise(() => {}) }, { pin: f.pin }), { message: "postgres_gosu_source_output_failed" });
    assert.ok(Date.now() - started >= 10000); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL abort during output retires only its owned receipt after FD closure", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController();
    await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies({ ...f.input, signal: controller.signal }, { result() {
      controller.abort(); return new Promise(() => {});
    } }, { pin: f.pin }), { message: "postgres_gosu_source_output_failed" });
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL injected post-close fault retires own receipt but keeps cleanup uncertainty and never invokes writer", async (t) => {
    const f = fixture(t); const original = fs.closeSync; let injected = false; let callbacks = 0;
    t.mock.method(fs, "closeSync", (fd) => { const target = fs.readlinkSync(`/proc/self/fd/${fd}`); original(fd);
      if (!injected && target === path.join(f.input.directory, "receipt.json")) { injected = true; throw new Error("injected post-close fixture"); } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, { result() { callbacks++; } }, { pin: f.pin }), (e) => {
      assert.equal(e.message, "postgres_gosu_source_cleanup_uncertain"); assert.equal(e.cleanup, "UNVERIFIED"); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.equal(callbacks, 0); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL injected publication hook with real Git HEAD mutation rejects the last source seal", async (t) => {
    const f = fixture(t); const original = fs.fsyncSync; let changed = false;
    t.mock.method(fs, "fsyncSync", (fd) => { original(fd); if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("/receipt.json")) {
      changed = true; fs.writeFileSync(path.join(f.input.workspace, "fixture.txt"), "changed public fixture\n"); git(f.input.workspace, ["add", "--all"]);
      git(f.input.workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "late fixture source change"]);
    } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, {}, { pin: f.pin }), { message: "postgres_gosu_source_source_invalid" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(changed, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
  test("PARTIAL injected publication hook with a real retained-payload mutation fails the postpublication reread", async (t) => {
    const f = fixture(t); const original = fs.fsyncSync; let changed = false;
    t.mock.method(fs, "fsyncSync", (fd) => { original(fd); if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("/receipt.json")) {
      changed = true; fs.writeFileSync(path.join(f.input.directory, "archives", f.pin.archives[0].name), "changed retained fixture\n");
    } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_publishPostgresGosuSourceArchiveCopies(f.input, {}, { pin: f.pin }), { message: "postgres_gosu_source_file_changed" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(changed, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 4);
  });
} else if (nativeActor) {
  test("actual unsupported Git refuses native partial/default contexts without a new destination", async (t) => {
    const f = fixture(t); await assert.rejects(TEST_ONLY_retainPostgresGosuSourceArchiveCopies(f.input, { pin: f.pin }), { message: "postgres_gosu_source_git_invalid" });
    assert.equal(fs.existsSync(f.input.directory), false);
  });
  test(`native Git2.43 copy positives require the actual version; observed ${gitVersion}`, { skip: true }, () => {});
} else {
  test("native copy proofs require the actual1000:1000/NNP/capability actor", { skip: true }, () => {});
}

test("actual root-to1000 bootstrap stages public code with explicit modes under either umask", { skip: process.platform !== "linux" || process.getuid() !== 0 }, (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-gosu-source-bootstrap-"))); fs.chmodSync(root, 0o755); const own = metadata(root);
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).ino, own.ino); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-gosu-source-bootstrap-"))); fs.rmSync(root, { recursive: true }); });
  const stage = (source, destination) => {
    assert.ok(destination === root || destination.startsWith(root + path.sep)); const s = fs.lstatSync(source); assert.equal(s.isSymbolicLink(), false);
    if (s.isDirectory()) { fs.mkdirSync(destination, { mode: 0o755 }); fs.chmodSync(destination, 0o755); for (const name of fs.readdirSync(source)) stage(path.join(source, name), path.join(destination, name)); }
    else { assert.equal(s.isFile(), true); fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o644); }
  };
  stage(path.join(rootSource, "scripts", "postgres-image"), path.join(root, "scripts"));
  // Preserve import-relative public paths; no private artifacts, credentials or node_modules are staged.
  fs.renameSync(path.join(root, "scripts"), path.join(root, "postgres-image")); fs.mkdirSync(path.join(root, "scripts"), { mode: 0o755 }); fs.chmodSync(path.join(root, "scripts"), 0o755);
  fs.renameSync(path.join(root, "postgres-image"), path.join(root, "scripts", "postgres-image"));
  fs.mkdirSync(path.join(root, "tests"), { mode: 0o755 }); fs.chmodSync(path.join(root, "tests"), 0o755);
  const target = path.join(root, "tests", "postgres-gosu-source-retention.test.mjs"); fs.copyFileSync(fileURLToPath(import.meta.url), target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o644);
  assert.equal(metadata(target).mode, 0o644); assert.equal(metadata(path.join(root, "tests")).mode, 0o755);
  const node = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
  const r = spawnSync("/usr/bin/setpriv", ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", node, "--test", target], {
    cwd: root, timeout: 180000, maxBuffer: 128 * 1024, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stdout); assert.equal(r.stderr, "");
  if (gitVersion === "git version 2.43.0") { assert.match(r.stdout, /# tests 25/u); assert.match(r.stdout, /# pass 24/u); assert.match(r.stdout, /# fail 0/u); assert.match(r.stdout, /# skipped 1/u); assert.match(r.stdout, /PARTIAL_NATIVE_COPY_PROOF/u);
    t.diagnostic("Actual UID1000 child: 24 PASS, 0 FAIL; one root-only test skipped; partial copy/publication proofs only."); }
  else assert.match(r.stdout, /actual unsupported Git refuses/u);
});
