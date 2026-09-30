import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { pipePrivateCopyBytes, privateCopyByteGuard, publishPrivateCopyReceipt, runLocalPostgresPrivateCopy,
  validatePostgresLocalPrivateCopyReceipt, validatePrivateCopyWindowsProof } from "../scripts/postgres-image/local-private-copy-diagnostic.mjs";
import { PRIVATE_COPY_PIN as PIN } from "../scripts/postgres-image/private-copy-policy.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const chunks = [Buffer.from([0, 255, 192, 128, 10]), Buffer.from([0, 239, 191, 189, 254])];
const files = chunks.map((bytes, index) => ({ name: `fixture-${index}`, size: bytes.length, sha256: hash(bytes) }));
const all = Buffer.concat(chunks);
const spec = (source) => ({ command: process.execPath, args: ["--input-type=module", "-e", source] });
const producer = (bytes = all, extra = "") => spec(`process.stdout.write(Buffer.from('${bytes.toString("hex")}','hex'));${extra}`);
const consumer = (extra = "") => spec(`let size=0; for await (const chunk of process.stdin) size+=chunk.length;
process.stdout.write(JSON.stringify({size}));${extra}`);

test("byte guard preserves NUL/non-UTF8 across file and chunk boundaries with backpressure", async () => {
  const guard = privateCopyByteGuard(files); const actual = [];
  const sink = new Writable({ highWaterMark: 1, write(bytes, _encoding, done) {
    actual.push(Buffer.from(bytes)); setTimeout(done, 1);
  } });
  const complete = pipeline(guard, sink);
  for (let index = 0; index < all.length; index += 1) guard.write(all.subarray(index, index + 1));
  guard.end(); await complete;
  assert.deepEqual(Buffer.concat(actual), all);
});
for (const [name, bytes] of [["short", all.subarray(0, all.length - 1)], ["extra", Buffer.concat([all, Buffer.from([0])])],
  ["changed", Buffer.from([1, ...all.subarray(1)])]]) {
  test(`byte guard rejects ${name} transfer`, async () => {
    const guard = privateCopyByteGuard(files); const complete = pipeline(guard, new Writable({ write(_bytes, _encoding, done) { done(); } }));
    guard.end(bytes);
    await assert.rejects(complete, /^Error: postgres_private_copy_incomplete$/u);
  });
}
test("two-child pipe keeps binary bytes exact and metadata separate", async () => {
  const observed = await pipePrivateCopyBytes(producer(all, "process.stderr.write('{\"source\":true}');"), consumer(), files);
  assert.equal(observed.sourceMetadata.toString(), '{"source":true}');
  assert.equal(observed.destinationMetadata.toString(), '{"size":10}');
  assert.equal(observed.destinationErrors.length, 0);
});
for (const [name, source, destination, timeout] of [
  ["late source nonzero", producer(all, "process.exitCode=3;"), consumer(), 10_000],
  ["late receiver nonzero", producer(), consumer("process.exitCode=4;"), 10_000],
  ["short source", producer(all.subarray(1)), consumer(), 10_000],
  ["extra source", producer(Buffer.concat([all, Buffer.from([0])])), consumer(), 10_000],
  ["metadata overflow", producer(all, "process.stderr.write('x'.repeat(65537));"), consumer(), 10_000],
  ["receiver output overflow", producer(), consumer("process.stdout.write('x'.repeat(65537));"), 10_000],
  ["timeout", spec("setInterval(()=>{},1000);"), consumer(), 300],
  ["child ignores SIGTERM", spec("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"), consumer(), 300],
  ["early receiver closure", producer(), spec("process.stdin.destroy(); process.exit(2);"), 10_000],
  ["spawn failure", { command: `${process.execPath}.missing`, args: [] }, consumer(), 10_000],
]) {
  test(`pipe rejects ${name} without returning successful metadata`, async () => {
    await assert.rejects(pipePrivateCopyBytes(source, destination, files, timeout), /^Error: postgres_private_copy_incomplete$/u);
  });
}

function windowsProof() {
  const scope = "a".repeat(24);
  return { kind: "WINDOWS_PRIVATE_COPY_PROOF_V1", state: "SEALED", directory: `${PIN.windowsParent}\\postgres-0045bdab5483336d-copy-${scope}`,
    ownerSid: PIN.windowsSid, volumeSerial: "01234567", directoryFileId: "0123456789abcdef", protectedAcl: true, ntfs: true, reparse: false,
    files: PIN.files.map((file, index) => ({ ...file, fileId: `${index + 1}`.repeat(16), ownerSid: PIN.windowsSid, protectedAcl: true, nlink: 1 })) };
}
test("closed Windows proof binds exact scope/native IDs and reviewed file bytes", () => {
  const proof = windowsProof();
  assert.equal(validatePrivateCopyWindowsProof(proof, "a".repeat(24)), proof);
  assert.equal(validatePrivateCopyWindowsProof(globalThis.structuredClone(proof), "a".repeat(24), proof).state, "SEALED");
});
for (const [name, change] of [
  ["extra key", (proof) => { proof.extra = "arbitrary"; }],
  ["wrong owner", (proof) => { proof.ownerSid = "S-1-1-0"; }],
  ["reparse", (proof) => { proof.reparse = true; }],
  ["unprotected ACL", (proof) => { proof.protectedAcl = false; }],
  ["wrong path", (proof) => { proof.directory += "\\other"; }],
  ["foreign file hash", (proof) => { proof.files[0].sha256 = "a".repeat(64); }],
  ["short file", (proof) => { proof.files[0].size -= 1; }],
  ["hardlink", (proof) => { proof.files[0].nlink = 2; }],
  ["file inherited ACL", (proof) => { proof.files[0].protectedAcl = false; }],
  ["duplicate file ID", (proof) => { proof.files[1].fileId = proof.files[0].fileId; }],
  ["directory file ID", (proof) => { proof.files[0].fileId = proof.directoryFileId; }],
  ["reordered files", (proof) => { proof.files.reverse(); }],
  ["extra file", (proof) => { proof.files.push({}); }],
]) {
  test(`closed Windows proof rejects ${name}`, () => {
    const proof = windowsProof(); change(proof);
    assert.throws(() => validatePrivateCopyWindowsProof(proof, "a".repeat(24)), /^Error: postgres_private_copy_incomplete$/u);
  });
}
test("final Windows seal rejects a changed native file identity", () => {
  const before = windowsProof(); const after = globalThis.structuredClone(before); after.files[0].fileId = "9".repeat(16);
  assert.throws(() => validatePrivateCopyWindowsProof(after, "a".repeat(24), before), /^Error: postgres_private_copy_incomplete$/u);
});
test("input-free production entrypoint rejects caller arguments before private work", async () => {
  await assert.rejects(runLocalPostgresPrivateCopy(["--arbitrary"]), /^Error: postgres_private_copy_incomplete$/u);
});

function preparedReceipt() {
  return { kind: "WINDOWS_PRIVATE_COPY_PREPARATION_V1", state: "PREPARED", directoryFileId: windowsProof().directoryFileId,
    file: { name: "copy-receipt.json", size: 0, sha256: hash(Buffer.alloc(0)), fileId: "3".repeat(16),
      ownerSid: PIN.windowsSid, protectedAcl: true, nlink: 1 } };
}
test("publication binds an empty exclusive slot before writing receipt bytes", async () => {
  const bytes = Buffer.from('{"fixture":true}\n'); const seen = []; const prepared = preparedReceipt();
  const result = await publishPrivateCopyReceipt(bytes, "a".repeat(24), windowsProof(), async (command, input) => {
    const operation = command.args[command.args.indexOf("-Operation") + 1]; seen.push(operation);
    if (operation === "PreparePublish") { assert.equal(input, undefined); return prepared; }
    assert.equal(operation, "Publish"); assert.deepEqual(input, bytes);
    assert.equal(command.args[command.args.indexOf("-ExpectedFileId") + 1], prepared.file.fileId);
    return { kind: "WINDOWS_PRIVATE_COPY_PUBLICATION_V1", state: "PUBLISHED", directoryFileId: prepared.directoryFileId,
      file: { ...prepared.file, size: bytes.length, sha256: hash(bytes) } };
  });
  assert.equal(result.state, "PUBLISHED"); assert.deepEqual(seen, ["PreparePublish", "Publish"]);
});
for (const [name, change] of [
  ["lost acknowledgement", () => { throw new Error("untrusted private stderr must not escape"); }],
  ["wrong publication hash", (value) => ({ ...value, file: { ...value.file, sha256: "a".repeat(64) } })],
  ["wrong native file ID", (value) => ({ ...value, file: { ...value.file, fileId: "4".repeat(16) } })],
  ["unexpected JSON", () => null],
]) {
  test(`publication ${name} withdraws only the prepared native file identity`, async () => {
    const bytes = Buffer.from('{"fixture":true}\n'); const prepared = preparedReceipt(); const seen = [];
    const action = publishPrivateCopyReceipt(bytes, "a".repeat(24), windowsProof(), async (command, input, timeout) => {
      const operation = command.args[command.args.indexOf("-Operation") + 1]; seen.push(operation);
      if (operation === "PreparePublish") return prepared;
      if (operation === "Publish") return change({ kind: "WINDOWS_PRIVATE_COPY_PUBLICATION_V1", state: "PUBLISHED",
        directoryFileId: prepared.directoryFileId, file: { ...prepared.file, size: bytes.length, sha256: hash(bytes) } });
      assert.equal(operation, "AbortPublish"); assert.equal(timeout, 10_000); assert.equal(input.length, 0);
      assert.equal(command.args[command.args.indexOf("-ExpectedFileId") + 1], prepared.file.fileId);
      assert.equal(command.args[command.args.indexOf("-ExpectedDirectoryFileId") + 1], prepared.directoryFileId);
      return { kind: "WINDOWS_PRIVATE_COPY_ABORT_V1", state: "REMOVED", directoryFileId: prepared.directoryFileId, fileId: prepared.file.fileId };
    });
    await assert.rejects(action, (error) => error.message === "postgres_private_copy_incomplete" && error.receiptCleanup === "RECEIPT_REMOVED");
    assert.deepEqual(seen, ["PreparePublish", "Publish", "AbortPublish"]);
  });
}
test("uncertain publication cleanup fails closed without foreign-path fallback", async () => {
  const seen = [];
  await assert.rejects(publishPrivateCopyReceipt(Buffer.from("{}"), "a".repeat(24), windowsProof(), async (command) => {
    const operation = command.args[command.args.indexOf("-Operation") + 1]; seen.push(operation);
    if (operation === "PreparePublish") return preparedReceipt();
    throw new Error("closed failure");
  }), (error) => error.message === "postgres_private_copy_incomplete" && error.receiptCleanup === "UNCERTAIN");
  assert.deepEqual(seen, ["PreparePublish", "Publish", "AbortPublish"]);
});
test("invalid preparation never receives success receipt bytes", async () => {
  const seen = [];
  await assert.rejects(publishPrivateCopyReceipt(Buffer.from("{}"), "a".repeat(24), windowsProof(), async (command) => {
    const operation = command.args[command.args.indexOf("-Operation") + 1]; seen.push(operation);
    return { ...preparedReceipt(), directoryFileId: "f".repeat(16) };
  }), /^Error: postgres_private_copy_incomplete$/u);
  assert.deepEqual(seen, ["PreparePublish"]);
});

// Synthetic closed metadata exercises the receipt boundary; it is not a real archive proof.
function copyReceipt() {
  const policy = JSON.parse(readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url), "utf8"));
  const ids = Array.from({ length: 12 }, (_item, index) => hash(Buffer.from(`synthetic-record-${index}`)));
  const proof = { archiveSha256: PIN.files[0].sha256, archiveBytes: PIN.files[0].size, archiveMembers: 32,
    imageId: policy.candidate.imageId, tag: `aw-postgres-gosu:${hash(Buffer.from(`${PIN.originalExecutionId.slice(6)}:${PIN.originalRecipeRevision}`)).slice(0, 24)}`,
    configDigest: policy.candidate.imageId, configBytes: policy.manifest.config.size, diffIds: policy.candidate.diffIds,
    rawLayers: policy.candidate.diffIds.map((digest) => ({ digest, size: 1024, mediaType: "application/vnd.oci.image.layer.v1.tar" })),
    manifestDigest: `sha256:${hash(Buffer.from("synthetic-manifest"))}`, manifestBytes: 512,
    compatibilityRecords: ids.map((id, index) => ({ blobDigest: `sha256:${hash(Buffer.from(`synthetic-blob-${index}`))}`,
      id, parent: index ? ids[index - 1] : null, rich: index === 11 })), remoteLayerVerification: "NOT_ESTABLISHED_BY_DOCKER_SAVE" };
  const sourceFiles = PIN.files.map((file, index) => ({ ...file, identity: { dev: "2049", ino: String(index + 1), uid: 1000,
    gid: 989, mode: 0o600, nlink: 1, mtimeNs: "1700000000000000000", ctimeNs: "1700000000000000000" } }));
  const importedFiles = globalThis.structuredClone(sourceFiles).map((file, index) => ({ ...file,
    identity: { ...file.identity, gid: 1000, ino: String(index + 3) } }));
  const source = { kind: "POSTGRES_PRIVATE_COPY_LINUX_RESULT_V1", operation: "EXPORT", state: "VERIFIED", recipeRevision: "b".repeat(40),
    originalRecipeRevision: PIN.originalRecipeRevision, originalExecutionId: PIN.originalExecutionId, sourceDirectory: PIN.sourceDirectory,
    directory: PIN.sourceDirectory, sourceFiles, files: sourceFiles, archiveProof: proof, filesystem: "EXT4" };
  const imported = { ...globalThis.structuredClone(source), operation: "IMPORT", directory: "/home/autoworld/pg-private-reimport-a1B2c3", files: importedFiles };
  const receipt = { kind: "POSTGRES_LOCAL_PRIVATE_COPY_RECEIPT_V1", state: "COPIED_AND_REIMPORTED", authority: "LOCAL_DIAGNOSTIC",
    origin: "LOCAL_DIAGNOSTIC", executionId: `local-copy-${"a".repeat(24)}`, githubRunId: null, recipeRevision: source.recipeRevision,
    originalRecipeRevision: PIN.originalRecipeRevision, originalExecutionId: PIN.originalExecutionId, policySha256: PIN.policySha256,
    subject: policy.subject, imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds, originalFiles: PIN.files,
    windowsProof: windowsProof(), linuxSourceProof: source, linuxImportProof: imported, linuxFinalProof: { ...globalThis.structuredClone(imported), operation: "SEAL" },
    registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", imageRestore: "NOT_ATTEMPTED",
    sqlRestore: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    phases: ["source_export_and_windows_copy", "windows_export_and_linux_reimport", "final_seals"].map((name) => ({ name, result: "PASSED", durationMs: 0 })) };
  return { receipt, policy, proof };
}
test("closed receipt binds final Linux seal, prior source and Windows file proofs", () => {
  const { receipt, policy, proof } = copyReceipt();
  assert.equal(validatePostgresLocalPrivateCopyReceipt(receipt, policy, proof), receipt);
});
for (const [name, change] of [
  ["missing final seal", (value) => { delete value.linuxFinalProof; }],
  ["changed final inode", (value) => { value.linuxFinalProof.files[0].identity.ino = "999"; }],
  ["changed final original inode", (value) => { value.linuxFinalProof.sourceFiles[0].identity.ino = "999"; }],
  ["changed final recipe", (value) => { value.linuxFinalProof.recipeRevision = "c".repeat(40); }],
  ["wrong initial recipe", (value) => { value.linuxSourceProof.recipeRevision = "c".repeat(40); }],
  ["wrong original receipt hash", (value) => { value.originalFiles[1].sha256 = "c".repeat(64); }],
  ["missing layer", (value) => { value.linuxSourceProof.archiveProof.rawLayers.pop(); }],
  ["wrong policy identity", (value) => { value.policySha256 = "c".repeat(64); }],
  ["native run claim", (value) => { value.githubRunId = "36700865968"; }],
  ["support activation", (value) => { value.supportStartedAt = "2026-09-30T00:00:00Z"; }],
  ["image execution claim", (value) => { value.imageExecution = "PASSED"; }],
  ["incomplete phase", (value) => { value.phases[2].result = "FAILED"; }],
]) {
  test(`closed receipt rejects ${name}`, () => {
    const { receipt, policy, proof } = copyReceipt(); const changed = globalThis.structuredClone(receipt); change(changed);
    assert.throws(() => validatePostgresLocalPrivateCopyReceipt(changed, policy, proof), /postgres_(?:private_copy_incomplete|private_copy_linux_result_invalid)/u);
  });
}
