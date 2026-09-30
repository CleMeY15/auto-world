import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPostgresPrivateRuntimeEvidenceCopySession, intakePostgresPrivateRuntimeEvidence } from "../scripts/postgres-image/private-runtime-evidence.mjs";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN } from "../scripts/postgres-image/private-runtime-evidence-policy.mjs";
import { postgresPrivateRuntimeEvidenceIdentity as identity } from "../scripts/postgres-image/private-runtime-evidence-protocol.mjs";
import { requirePostgresPrivateRuntimeEvidenceWorkerContext } from "../scripts/postgres-image/private-runtime-evidence-worker.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const metadata = (file) => identity(fs.lstatSync(file, { bigint: true }));
function ownTemporary(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-runtime-copy-test-"))); fs.chmodSync(root, 0o700);
  const before = metadata(root);
  t.after(() => {
    const actual = metadata(root); assert.equal(fs.realpathSync(root), root);
    assert.equal(actual.dev, before.dev); assert.equal(actual.ino, before.ino); assert.equal(actual.uid, 1000);
    assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-runtime-copy-test-"))); fs.rmSync(root, { recursive: true });
  }); return root;
}
function fixture(t, mutate = () => {}) {
  const root = ownTemporary(t); const parent = path.join(root, "output"); const source = path.join(root, "sources");
  fs.mkdirSync(parent, { mode: 0o700 }); fs.mkdirSync(source, { mode: 0o700 });
  const contents = [Buffer.from('{"fixture":"cold","scope":"partial"}'), Buffer.from('{"fixture":"sql","scope":"partial"}'), Buffer.from("PGDMP harmless synthetic dump bytes")];
  const specs = PIN.sources.map((entry, index) => {
    const file = path.join(source, "source-" + index); fs.writeFileSync(file, contents[index], { mode: 0o600, flag: "wx" });
    return { ...entry, source: file, size: contents[index].length, sha256: hash(contents[index]), uid: 1000, gid: 1000,
      fd: fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW) };
  });
  const sources = specs.map((entry) => ({ role: entry.role, fd: entry.fd, source: entry.source,
    size: entry.size, sha256: entry.sha256, identity: metadata(entry.source) }));
  const controller = new globalThis.AbortController(); const input = { parent, directory: path.join(parent, "addendum-" + randomBytes(12).toString("hex")),
    sources, specs, deadline: Date.now() + 60000, signal: controller.signal };
  let held;
  t.after(() => {
    if (held) { try { held.close(); } catch { /* Fault fixtures already asserted uncertainty. */ } }
    for (const entry of specs) {
      try {
        const actual = identity(fs.fstatSync(entry.fd, { bigint: true }));
        if (actual.dev === sources.find((s) => s.fd === entry.fd)?.identity.dev && actual.ino === sources.find((s) => s.fd === entry.fd)?.identity.ino) fs.closeSync(entry.fd);
      } catch { /* Sources may already be closed by the session. */ }
    }
  });
  mutate({ root, input, contents, controller });
  return { root, input, contents, controller, start: () => { held = createPostgresPrivateRuntimeEvidenceCopySession(input); return held; } };
}
const closed = (suffix) => ({ message: "postgres_private_runtime_evidence_" + suffix });

test("copy library rejects unsupported actual actors and malformed full intake", async () => {
  await assert.rejects(intakePostgresPrivateRuntimeEvidence({}), (error) =>
    /^postgres_private_runtime_evidence_(?:context_invalid|control_invalid)$/u.test(error.message) && error.cleanup === "UNVERIFIED");
  if (process.platform !== "linux" || process.getuid() !== 1000 || process.getgid() !== 1000) {
    assert.throws(() => createPostgresPrivateRuntimeEvidenceCopySession({}), closed("context_invalid"));
  }
});

test("input-free worker rejects arguments with a closed diagnostic and no raw context", () => {
  const secret = "fixture-private-argument";
  assert.throws(() => requirePostgresPrivateRuntimeEvidenceWorkerContext([secret], {}), closed("context_invalid"));
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/postgres-image/private-runtime-evidence-worker.mjs"), secret],
    { env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
      encoding: "utf8", timeout: 10000, maxBuffer: 16384 });
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { state: "INCOMPLETE",
    failure: { code: "postgres_private_runtime_evidence_context_invalid", phase: "CONTEXT", cleanup: "UNVERIFIED" } });
  assert.equal(result.stderr.includes(secret), false);
});

if (process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000) {
  test("native copies are an explicit partial helper proof with 3 payloads, 2 directories and 4 files after publication", (t) => {
    const f = fixture(t); const original = f.input.sources.map((source) => ({ ...metadata(source.source), sha256: hash(fs.readFileSync(source.source)) }));
    const held = f.start(); const proof = held.copy(); const receipt = held.publish(proof); held.seal(); held.close();
    assert.equal(proof.state, "PARTIAL_HELPER_PROOF"); assert.equal(proof.scope, "NATIVE_COPY_ONLY");
    assert.equal(proof.payloads.length, 3); assert.equal(proof.directories.length, 2);
    assert.deepEqual(fs.readdirSync(f.input.directory).sort(), ["backup", "cold-receipt.json", "receipt.json", "sql-receipt.json"]);
    for (const file of proof.payloads) {
      const copied = path.join(f.input.directory, file.name); assert.deepEqual(metadata(copied), file.identity);
      assert.equal(hash(fs.readFileSync(copied)), file.sha256); assert.equal(file.identity.uid, 1000); assert.equal(file.identity.mode, 0o600);
      assert.notEqual(file.identity.ino, file.sourceIdentity.ino);
    }
    assert.deepEqual(metadata(path.join(f.input.directory, receipt.name)), receipt.identity);
    assert.equal(hash(fs.readFileSync(path.join(f.input.directory, receipt.name))), receipt.sha256);
    assert.deepEqual(f.input.sources.map((source) => ({ ...metadata(source.source), sha256: hash(fs.readFileSync(source.source)) })), original);
    for (const source of f.input.sources) assert.throws(() => fs.fstatSync(source.fd), { code: "EBADF" });
  });
  test("positioned source validation and copying leave the shared source offset at zero", (t) => {
    const f = fixture(t); const held = f.start(); held.copy(); held.seal();
    const byte = Buffer.alloc(1); assert.equal(fs.readSync(f.input.sources[0].fd, byte, 0, 1, null), 1);
    assert.equal(byte[0], f.contents[0][0]); held.close();
  });
  test("writable inherited descriptor is refused before creating a destination", (t) => {
    const f = fixture(t, ({ input }) => {
      fs.closeSync(input.specs[0].fd); input.specs[0].fd = fs.openSync(input.specs[0].source, fs.constants.O_RDWR);
      input.sources[0].fd = input.specs[0].fd;
    });
    assert.throws(() => f.start(), closed("source_invalid")); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("actual O_PATH descriptor is refused even when fstat shows a regular file", (t) => {
    const f = fixture(t, ({ input }) => {
      fs.closeSync(input.specs[0].fd); input.specs[0].fd = fs.openSync(input.specs[0].source, 0o10000000 | fs.constants.O_NOFOLLOW);
      input.sources[0].fd = input.specs[0].fd;
    });
    assert.throws(() => f.start(), closed("source_invalid")); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("wrong native source mode is refused before destination creation", (t) => {
    const f = fixture(t); fs.chmodSync(f.input.sources[0].source, 0o644);
    assert.throws(() => f.start(), closed("source_invalid")); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("same-inode source mutation is refused before copying", (t) => {
    const f = fixture(t); const held = f.start(); fs.writeFileSync(f.input.sources[0].source, Buffer.alloc(f.contents[0].length, 65));
    assert.throws(() => held.copy(), closed("source_invalid")); assert.equal(fs.existsSync(path.join(f.input.directory, "cold-receipt.json")), false);
  });
  test("source path substitution is refused through the inherited descriptor name", (t) => {
    const f = fixture(t); const held = f.start(); const file = f.input.sources[0].source;
    fs.renameSync(file, file + ".old"); fs.writeFileSync(file, f.contents[0], { flag: "wx", mode: 0o600 });
    assert.throws(() => held.copy(), closed("source_invalid"));
  });
  test("full hash rejects same-size changed bytes", (t) => {
    const f = fixture(t, ({ input }) => { input.specs[0].sha256 = "1".repeat(64); input.sources[0].sha256 = input.specs[0].sha256; });
    assert.throws(() => f.start(), closed("source_invalid")); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("short EOF rejects a descriptor whose sealed size was forged", (t) => {
    const f = fixture(t, ({ input }) => { input.specs[0].size++; input.sources[0].size++; input.sources[0].identity.size++; });
    assert.throws(() => f.start(), closed("source_invalid"));
  });
  test("additional source bytes reject the original seal", (t) => {
    const f = fixture(t); const held = f.start(); fs.appendFileSync(f.input.sources[0].source, "x");
    assert.throws(() => held.copy(), closed("source_invalid"));
  });
  test("two source aliases are refused without creating output", (t) => {
    const f = fixture(t, ({ input }) => {
      input.sources[1].identity = { ...input.sources[0].identity, size: input.sources[1].size };
    });
    assert.throws(() => f.start(), /postgres_private_runtime_evidence_control_invalid/u); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("exclusive destination collision preserves the existing directory and content", (t) => {
    const f = fixture(t); fs.mkdirSync(f.input.directory, { mode: 0o700 }); const file = path.join(f.input.directory, "foreign");
    fs.writeFileSync(file, "keep", { mode: 0o600 }); const before = metadata(file);
    const held = f.start(); assert.throws(() => held.copy(), /postgres_private_runtime_evidence_operation_failed/u);
    assert.deepEqual(metadata(file), before); assert.equal(fs.readFileSync(file, "utf8"), "keep");
  });
  test("unexpected target entry prevents publication", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy(); fs.writeFileSync(path.join(f.input.directory, "extra"), "x", { mode: 0o600 });
    assert.throws(() => held.publish(proof), closed("copy_failed")); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
  });
  test("target bytes changed before publication prevent publication", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy();
    fs.writeFileSync(path.join(f.input.directory, proof.payloads[0].name), Buffer.alloc(proof.payloads[0].size, 66));
    assert.throws(() => held.seal(), closed("copy_failed"));
  });
  test("foreign target inode substitution is refused", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy(); const file = path.join(f.input.directory, proof.payloads[0].name);
    fs.renameSync(file, file + ".old"); fs.writeFileSync(file, f.contents[0], { flag: "wx", mode: 0o600 });
    assert.throws(() => held.seal(), closed("copy_failed"));
  });
  test("target mode change is refused", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy(); fs.chmodSync(path.join(f.input.directory, proof.payloads[0].name), 0o644);
    assert.throws(() => held.seal(), closed("copy_failed"));
  });
  test("directory mode mutation is refused", (t) => {
    const f = fixture(t); const held = f.start(); held.copy(); fs.chmodSync(path.join(f.input.directory, "backup"), 0o755);
    assert.throws(() => held.seal(), closed("copy_failed"));
  });
  test("an aborted copy preserves originals and emits no receipt", (t) => {
    const f = fixture(t); const held = f.start(); f.controller.abort();
    assert.throws(() => held.copy(), closed("operation_failed")); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("expired real deadline refuses before filesystem writes", (t) => {
    const f = fixture(t); f.input.deadline = Date.now() - 1;
    assert.throws(() => f.start(), closed("context_invalid")); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("injected fsync failure retains private payload and no provisional receipt", (t) => {
    const f = fixture(t); const held = f.start(); const original = fs.fsyncSync;
    t.mock.method(fs, "fsyncSync", () => { throw new Error("private fsync error"); });
    assert.throws(() => held.copy(), closed("operation_failed")); t.mock.restoreAll();
    assert.equal(typeof original, "function"); assert.equal(fs.existsSync(f.input.directory), true);
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
  });
  test("late same-inode receipt mutation is rejected and the proven owned receipt is retired", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy(); held.publish(proof); const file = path.join(f.input.directory, "receipt.json");
    fs.writeFileSync(file, JSON.stringify({ ...proof, note: "changed" }), { mode: 0o600 });
    assert.throws(() => held.seal(), closed("copy_failed")); held.retire();
    assert.equal(fs.existsSync(file), false); assert.equal(fs.readdirSync(f.input.directory).length, 3);
  });
  test("foreign replacement receipt remains untouched and retirement is uncertain", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy(); held.publish(proof); const file = path.join(f.input.directory, "receipt.json");
    fs.renameSync(file, file + ".old"); fs.writeFileSync(file, "foreign", { mode: 0o600, flag: "wx" }); const foreign = metadata(file);
    assert.throws(() => held.retire(), closed("cleanup_uncertain")); assert.deepEqual(metadata(file), foreign);
    assert.equal(fs.readFileSync(file, "utf8"), "foreign");
  });
  test("owned receipt remains retireable after all descriptors close on a late output fault", (t) => {
    const f = fixture(t); const held = f.start(); const proof = held.copy(); held.publish(proof); held.seal(); held.close(); held.retire();
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    assert.equal(proof.payloads.every((file) => fs.existsSync(path.join(f.input.directory, file.name))), true);
  });
  test("injected post-close failure is reported as uncertain; payloads and originals remain private", (t) => {
    const f = fixture(t); const held = f.start(); held.copy(); const original = fs.closeSync; let count = 0;
    t.mock.method(fs, "closeSync", (fd) => { original(fd); if (count++ === 0) throw new Error("private close error"); });
    assert.throws(() => held.close(), closed("cleanup_uncertain")); t.mock.restoreAll();
    assert.equal(f.input.sources.every((source) => fs.existsSync(source.source)), true);
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
  });
} else {
  test("native fixture suite runs as actual UID1000; root also proves inherited root descriptors through setpriv", { skip: process.platform !== "linux" }, () => {
    if (process.getuid() !== 0) {
      const result = spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC",
        process.execPath, "--test", fileURLToPath(import.meta.url)], { encoding: "utf8", timeout: 120000, maxBuffer: 1024 ** 2 });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /# skipped 0/u); return;
    }
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-runtime-bootstrap-"))); fs.chmodSync(root, 0o711);
    const own = metadata(root); const handles = [];
    try {
      fs.cpSync(path.join(repo, "scripts"), path.join(root, "scripts"), { recursive: true });
      fs.cpSync(path.join(repo, "infra"), path.join(root, "infra"), { recursive: true });
      fs.mkdirSync(path.join(root, "tests"), { mode: 0o755 });
      fs.cpSync(path.join(repo, "tests/fixtures"), path.join(root, "tests/fixtures"), { recursive: true });
      fs.copyFileSync(fileURLToPath(import.meta.url), path.join(root, "tests", path.basename(fileURLToPath(import.meta.url))));
      const env = { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
      const drop = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
      const inner = spawnSync("/usr/bin/setpriv", [...drop, process.execPath, "--test", path.join(root, "tests", path.basename(fileURLToPath(import.meta.url)))],
        { cwd: root, env, encoding: "utf8", timeout: 120000, maxBuffer: 1024 ** 2 });
      assert.equal(inner.status, 0, inner.stdout + inner.stderr); assert.match(inner.stdout, /# fail 0/u); assert.match(inner.stdout, /# skipped 0/u);
      const source = path.join(root, "root-sources"); fs.mkdirSync(source, { mode: 0o700 });
      const parent = path.join(root, "output"); fs.mkdirSync(parent, { mode: 0o700 }); fs.chownSync(parent, 1000, 1000);
      const contents = [Buffer.from("root cold fixture"), Buffer.from("root SQL fixture"), Buffer.from("PGDMP fixture")];
      const specs = PIN.sources.map((entry, index) => {
        const file = path.join(source, String(index)); fs.writeFileSync(file, contents[index], { flag: "wx", mode: 0o600 });
        if (index === 2) fs.chownSync(file, 1000, 1000);
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); handles.push(fd);
        return { ...entry, source: file, size: contents[index].length, sha256: hash(contents[index]), uid: index === 2 ? 1000 : 0, gid: index === 2 ? 1000 : 0 };
      });
      const sources = specs.map((entry) => ({ role: entry.role, fd: entry.fd, source: entry.source, size: entry.size, sha256: entry.sha256, identity: metadata(entry.source) }));
      const code = [
        'import fs from "node:fs";',
        'import { createPostgresPrivateRuntimeEvidenceCopySession } from ' + JSON.stringify(path.join(root, "scripts/postgres-image/private-runtime-evidence.mjs")) + ';',
        'const specs = ' + JSON.stringify(specs) + '; const sources = ' + JSON.stringify(sources) + ';',
        'const input = { parent:' + JSON.stringify(parent) + ', directory:' + JSON.stringify(path.join(parent, "root-readonly-copy")) + ', specs, sources, deadline:Date.now()+60000, signal:new AbortController().signal };',
        'try { const held=createPostgresPrivateRuntimeEvidenceCopySession(input); const proof=held.copy(); held.publish(proof); held.seal(); held.close(); console.log(JSON.stringify({state:proof.state,actors:proof.payloads.map(v=>[v.sourceIdentity.uid,v.identity.uid])})); }',
        'catch(e) { console.log(JSON.stringify({code:e.message,cleanup:e.cleanup})); process.exitCode=1; }',
      ].join("\n");
      const result = spawnSync("/usr/bin/setpriv", [...drop, process.execPath, "--input-type=module", "-e", code],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe", ...handles], encoding: "utf8", timeout: 30000, maxBuffer: 65536 });
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), { state: "PARTIAL_HELPER_PROOF", actors: [[0, 1000], [0, 1000], [1000, 1000]] });
      const writable = fs.openSync(specs[0].source, fs.constants.O_RDWR); handles.push(writable);
      const rejected = spawnSync("/usr/bin/setpriv", [...drop, process.execPath, "--input-type=module", "-e", code],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe", writable, handles[1], handles[2]], encoding: "utf8", timeout: 30000, maxBuffer: 65536 });
      assert.equal(rejected.status, 1); assert.equal(rejected.stderr, "");
      assert.deepEqual(JSON.parse(rejected.stdout), { code: "postgres_private_runtime_evidence_source_invalid", cleanup: "CONFIRMED" });
      for (let index = 0; index < specs.length; index++) assert.equal(hash(fs.readFileSync(specs[index].source)), specs[index].sha256);
    } finally {
      for (const fd of handles) fs.closeSync(fd);
      assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).dev, own.dev); assert.equal(metadata(root).ino, own.ino);
      assert.equal(metadata(root).uid, 0); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-runtime-bootstrap-")));
      fs.rmSync(root, { recursive: true });
    }
  });
}
