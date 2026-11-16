import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import {
  SCANNER_RETENTION as P, canonicalJsonBytes, createScannerRetentionPublicationBinding,
  createScannerRetentionRestoreManifest, createScannerRetentionSidecar, scannerRetentionPublisherPhases, sha256,
} from "../scripts/scanner/retention-policy.mjs";
import {
  pipeScannerRetentionLocalCommands, restoreScannerRetentionCopy, runScannerRetentionLocalCommand,
  scannerRetentionByteGuard, scannerRetentionHelperCommand, scannerRetentionLocalEnvironment,
  validateScannerRetentionPairProof, validateScannerRetentionRawArchive,
} from "../scripts/scanner/retention-restore.mjs";

const spec = (script) => ({ command: process.execPath, args: ["--input-type=module", "-e", script] });
const exact = (bytes) => ({ bytes: bytes.length, sha256: sha256(bytes) });
const encode = (value) => canonicalJsonBytes(value, 2 * 1024 ** 2);
const sid = "S-1-5-21-3270712108-3124063012-814912821-500";
const manifestPath = "scanner-closure/restore-manifest.json";
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const identity = { headSha: "1".repeat(40), headTree: "2".repeat(40), runId: "123456" };
  const publication = createScannerRetentionPublicationBinding(identity);
  const files = P.closure.members.filter((entry) => entry.path !== manifestPath).map((entry) => ({
    path: entry.path, class: entry.origin, bytes: entry.bytes ?? 1, sha256: entry.sha256 ?? "3".repeat(64),
  }));
  const manifest = createScannerRetentionRestoreManifest({ publication, files }); const manifestBytes = encode(manifest);
  let offset = 0;
  const members = P.closure.members.map((entry, index) => {
    const value = entry.path === manifestPath ? exact(manifestBytes) : files.find((file) => file.path === entry.path);
    const member = { memberOrdinal: index, uncompressedHeaderOffset: offset, uncompressedDataOffset: offset + 512,
      entry: { path: entry.path, type: "file", mode: entry.headerMode, uid: 0, gid: 0, mtime: 0,
        size: value.bytes, sha256: value.sha256 } };
    offset += 512 + Math.ceil(value.bytes / 512) * 512; return member;
  });
  const innerTar = { bytes: offset + 1024, sha256: "4".repeat(64) };
  const raw = { rawSize: innerTar.bytes, diffId: `sha256:${innerTar.sha256}`, members };
  const artifact = { id: 123, name: `${P.publisher.artifactNamePrefix}${identity.runId}-1`, digest: `sha256:${"5".repeat(64)}` };
  const q = P.qualification.artifact;
  const receipt = { schemaVersion: 1, state: "PUBLISHED_UNADMITTED", result: "PASSED", repository: P.repository,
    workflow: P.publisher.workflow, runId: identity.runId, runAttempt: 1, headSha: identity.headSha, headTree: identity.headTree,
    qualificationArtifact: { id: q.id, name: q.name, digest: q.digest, bytes: q.sizeInBytes, expiresAt: q.expiresAt },
    package: P.package, tag: `${P.package}:${P.publisher.tagPrefix}${innerTar.sha256}`, ghcrManifestDigest: `sha256:${"6".repeat(64)}`,
    innerTar, restoreManifest: exact(manifestBytes), oci: {
      manifest: { mediaType: "application/vnd.oci.image.manifest.v1+json", bytes: 500, sha256: "6".repeat(64) },
      config: { digest: `sha256:${"7".repeat(64)}`, mediaType: "application/vnd.oci.image.config.v1+json", bytes: 800, sha256: "7".repeat(64) },
      layer: { digest: `sha256:${"8".repeat(64)}`, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", bytes: 4000, sha256: "8".repeat(64) },
      readback: { imageId: `sha256:${"7".repeat(64)}`, containerId: "9".repeat(64),
        innerTarBytes: innerTar.bytes, innerTarSha256: innerTar.sha256, stoppedNeverStarted: true },
    }, phases: scannerRetentionPublisherPhases.map((name) => ({ name, result: "PASSED", durationMs: 1 })),
    cleanup: { state: "PASSED", image: "REMOVED", container: "REMOVED", buildCache: "REMOVED",
      authenticatedDockerConfig: "REMOVED", ownedPathRemoved: true },
    claims: { forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED", scannerExecuted: false,
      retained: false, restored: false, admitted: false, supportStart: null, supportEnd: null } };
  const receiptBytes = encode(receipt);
  const authenticatedOptions = { identity, artifact, createdAt: "2026-11-10T00:00:00.000Z" };
  const sidecar = createScannerRetentionSidecar(receiptBytes, authenticatedOptions); const sidecarBytes = encode(sidecar);
  const directory = { volumeSerial: "12345678", fileId: "1".repeat(16), ownerSid: sid,
    protectedAcl: true, ntfs: true, reparse: false, flush: "SUPPORTED_SUCCEEDED" };
  const proofFile = (name, value, id) => ({ name, ...value, fileId: id.repeat(16), ownerSid: sid, protectedAcl: true, nlink: 1 });
  const pairProof = { kind: "SCANNER_RETENTION_PRIVATE_COPY_V1", state: "COMMITTED", directory,
    tar: proofFile(sidecar.copy.relativePath, innerTar, "2"),
    sidecar: proofFile(sidecar.copy.relativePath.replace(/\.tar$/u, ".sidecar.json"), exact(sidecarBytes), "3") };
  return { receiptBytes, authenticatedOptions, manifest, manifestBytes, sidecar, sidecarBytes, raw, pairProof };
}

test("binary guard preserves bytes and rejects overflow, truncation and changed content", async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 0, 1]);
  for (const value of [bytes, bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from([1])]), Buffer.alloc(bytes.length)]) {
    const output = new PassThrough(); const consuming = (async () => { for await (const chunk of output) assert.equal(Buffer.isBuffer(chunk), true); })();
    consuming.catch(() => {});
    const work = pipeline(Readable.from([value]), scannerRetentionByteGuard(exact(bytes), bytes.length), output);
    if (value === bytes) await work; else await assert.rejects(work, /scanner_retention_local_/u);
    await Promise.allSettled([consuming]);
  }
});

test("local command waits for clean EOF, exact hash, empty stderr and child close", async () => {
  const bytes = Buffer.from("binary\0payload");
  const result = await runScannerRetentionLocalCommand(spec("process.stdin.pipe(process.stdout)"), { input: bytes, expected: exact(bytes), stdoutCap: bytes.length });
  assert.deepEqual(result, bytes);
  for (const script of ["process.stdout.write('ok'); process.exitCode = 1;",
    "process.stderr.write('unexpected');", "process.stdout.write('too long');"]) {
    await assert.rejects(runScannerRetentionLocalCommand(spec(script), { stdoutCap: 3 }), (error) => error.cleanup === "CHILDREN_CLOSED");
  }
});

test("fresh child suspension at startup, midstream and after N bytes before close always refuses", async () => {
  const bytes = Buffer.from("complete");
  for (const script of ["setTimeout(() => {}, 10000);",
    "process.stdout.write('comp'); setTimeout(() => {}, 10000);",
    "process.stdout.write('complete'); setTimeout(() => {}, 10000);"]) {
    await assert.rejects(runScannerRetentionLocalCommand(spec(script), { expected: exact(bytes), stdoutCap: bytes.length,
      timeoutMs: 250, cleanupMs: 1000 }), (error) => error.cleanup === "CHILDREN_CLOSED");
  }
});

test("bounded stderr and early consumers terminate only the owned child", async () => {
  await assert.rejects(runScannerRetentionLocalCommand(spec("process.stderr.write(Buffer.alloc(65537)); setTimeout(() => {}, 10000);")),
    (error) => error.cleanup === "CHILDREN_CLOSED");
  await assert.rejects(runScannerRetentionLocalCommand(spec("process.stdout.write('x'); setTimeout(() => {}, 10000);"),
    { consume: async (stream) => { stream.resume(); return "early"; } }), (error) => error.cleanup === "CHILDREN_CLOSED");
});

test("unobserved close is explicit UNKNOWN cleanup even when kill returns", async () => {
  let kills = 0;
  const fake = new EventEmitter(); Object.assign(fake, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { kills += 1; return true; } });
  await assert.rejects(runScannerRetentionLocalCommand(spec(""), { spawnImpl: () => fake, timeoutMs: 20, cleanupMs: 20 }),
    (error) => error.cleanup === "UNKNOWN" && /cleanup_uncertain/u.test(error.message));
  assert.equal(kills, 1);
});

test("two-child pipeline retains binary bytes and refuses an early destination", async () => {
  const bytes = Buffer.alloc(256 * 1024, 173);
  const source = spec("process.stdin.pipe(process.stdout)");
  const destination = spec("import {createHash} from 'node:crypto'; const h=createHash('sha256'); for await(const c of process.stdin) h.update(c); process.stdout.write(h.digest('hex'));");
  const value = await pipeScannerRetentionLocalCommands(source, destination, exact(bytes), { sourceInput: bytes });
  assert.equal(value.toString(), sha256(bytes));
  await assert.rejects(pipeScannerRetentionLocalCommands(source, spec("process.exit(0)"), exact(bytes), { sourceInput: bytes }),
    (error) => error.cleanup === "CHILDREN_CLOSED");
});

test("offline tool environment has fixed values and no ambient credentials or proxy", () => {
  const before = process.env.GH_TOKEN; const proxy = process.env.HTTPS_PROXY;
  try {
    process.env.GH_TOKEN = "sentinel"; process.env.HTTPS_PROXY = "sentinel";
    const env = scannerRetentionLocalEnvironment();
    assert.equal(env.GH_TOKEN, undefined); assert.equal(env.HTTPS_PROXY, undefined);
    assert.equal(env.DOCKER_CONFIG, undefined); assert.equal(env.PSModulePath, undefined);
    assert.equal(env.TEMP, "C:\\Users\\Administrator\\AppData\\Local\\Temp");
    assert.equal(Object.isFrozen(env), true);
  } finally {
    if (before === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = before;
    if (proxy === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = proxy;
  }
});

test("pair proofs bind independent sidecar bytes, stable IDs, protected ACL and commit ordering", () => {
  const f = fixture();
  assert.deepEqual(validateScannerRetentionPairProof(encode(f.pairProof), "COMMITTED", f.sidecar, f.sidecarBytes), f.pairProof);
  for (const mutate of [(v) => { v.sidecar.sha256 = "a".repeat(64); }, (v) => { v.tar.fileId = v.sidecar.fileId; },
    (v) => { v.directory.flush = "NOT_ATTEMPTED"; }, (v) => { v.tar.nlink = 2; }, (v) => { v.directory.reparse = true; },
    (v) => { v.sidecar.protectedAcl = false; }, (v) => { v.tar.name += ".part"; }]) {
    const changed = clone(f.pairProof); mutate(changed);
    assert.throws(() => validateScannerRetentionPairProof(encode(changed), "COMMITTED", f.sidecar, f.sidecarBytes), /scanner_retention_local_/u);
  }
  const args = scannerRetentionHelperCommand("ExportTar", f.sidecar, f.pairProof, f.sidecarBytes).args;
  assert.deepEqual(args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"]);
  assert.equal(args.includes("-SidecarFileId"), true);
  assert.throws(() => scannerRetentionHelperCommand("Arbitrary", f.sidecar), /operation_invalid/u);
});

test("closed50 raw profile binds physical order, offsets, modes, two EOF blocks and every manifest hash", () => {
  const f = fixture(); assert.ok(validateScannerRetentionRawArchive(f.raw, f.sidecar, f.manifest) > 0);
  for (const mutate of [(v) => { v.members.reverse(); }, (v) => { v.rawSize += 512; },
    (v) => { v.members[0].entry.mode = 511; }, (v) => { v.members[0].entry.type = "hardlink"; },
    (v) => { v.members[0].entry.sha256 = "f".repeat(64); }, (v) => { v.members[0].uncompressedDataOffset = 0; },
    (v) => { v.members.pop(); }, (v) => { v.members[0].entry.uid = 1; }]) {
    const changed = clone(f.raw); mutate(changed);
    assert.throws(() => validateScannerRetentionRawArchive(changed, f.sidecar, f.manifest), /archive_profile/u);
  }
});

function mockRestore(f, failure) {
  const calls = []; const directory = { ...f.pairProof.directory, fileId: "4".repeat(16), flush: "NOT_ATTEMPTED" };
  const total = validateScannerRetentionRawArchive(f.raw, f.sidecar, f.manifest);
  const dependencies = { tools() {}, capacity() {}, readManifest: () => failure === "manifest" ? Buffer.from("wrong") : f.manifestBytes,
    async run(command, options = {}) {
      const operation = command.args[command.args.indexOf("-Operation") + 1]; calls.push(operation);
      if (operation === "InspectPair") return encode({ ...f.pairProof, state: "INSPECTED" });
      if (operation === "ExportTar") { assert.equal(typeof options.consume, "function"); return f.raw; }
      if (operation === "CleanupRestore") return encode({ kind: "SCANNER_RETENTION_RESTORE_INSPECTION_V1", phase: "CLEANED",
        directory: { volumeSerial: directory.volumeSerial, fileId: directory.fileId }, files: 50,
        state: failure === "cleanup" ? "UNKNOWN" : "REMOVED" });
      const phase = command.args[command.args.indexOf("-Phase") + 1]; calls.push(phase);
      if (phase === "EMPTY") { assert.equal(options.input, undefined); return encode({ kind: "SCANNER_RETENTION_RESTORE_INSPECTION_V1", phase, directory, files: 0, bytes: 0 }); }
      assert.deepEqual(options.input, f.manifestBytes);
      return encode({ kind: "SCANNER_RETENTION_RESTORE_INSPECTION_V1", phase, directory,
        manifest: { path: manifestPath, ...exact(f.manifestBytes) }, files: 50, bytes: total });
    },
    async pipe(source, destination, expected) {
      assert.equal(source.args.includes("ExportTar"), true); assert.deepEqual(expected, f.sidecar.innerTar);
      calls.push(destination.args);
      if (destination.args[0] === "-t") return Buffer.from(P.closure.members.map((entry) => entry.path).join("\n") + "\n");
      return Buffer.alloc(0);
    },
  };
  return { calls, dependencies };
}

test("offline restore validates manifest first, extracts49 next, seals native files and cleans exact owned tree", async () => {
  const f = fixture(); const mock = mockRestore(f);
  const receipt = JSON.parse((await restoreScannerRetentionCopy(f, mock.dependencies)).toString());
  assert.equal(receipt.result, "PASSED"); assert.equal(receipt.members, 50);
  assert.equal(receipt.claims.networkIo, false); assert.equal(receipt.claims.scannerExecuted, false);
  const extracts = mock.calls.filter((call) => Array.isArray(call) && call[0] === "-x");
  assert.deepEqual(extracts[0].slice(extracts[0].indexOf("--") + 1), [manifestPath]);
  assert.deepEqual(extracts[1].slice(extracts[1].indexOf("--") + 1), f.manifest.files.map((file) => file.path));
  assert.equal(mock.calls.at(-1), "CleanupRestore");
});

test("manifest mismatch stops before49 extraction and cleanup ambiguity never returns a successful receipt", async () => {
  for (const failure of ["manifest", "cleanup"]) {
    const f = fixture(); const mock = mockRestore(f, failure);
    await assert.rejects(restoreScannerRetentionCopy(f, mock.dependencies), /scanner_retention_local_/u);
    if (failure === "manifest") {
      assert.equal(mock.calls.filter((call) => Array.isArray(call) && call[0] === "-x").length, 1);
      assert.equal(mock.calls.includes("CleanupRestore"), false);
    }
  }
});

test("offline restore module has no network, registry, shell, fallback or scanner execution dependency", () => {
  const source = readFileSync(new URL("../scripts/scanner/retention-restore.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:import\s.*["']node:(?:https?|net|tls|dgram)|\bfetch\s*\(|spawnSync\s*\(|shell:\s*true|execSync\s*\()/u);
  assert.doesNotMatch(source, /command:\s*["'](?:docker|gh|curl|trivy)["']/u);
});
