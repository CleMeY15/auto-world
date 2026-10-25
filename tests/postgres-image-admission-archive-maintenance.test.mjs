import assert from "node:assert/strict";
import crypto, { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

import publicAcceptance from "../infra/postgres-image/complete-private-copy-acceptance.json" with { type: "json" };

const sha = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`);
const locatorPath = "/opt/auto-world/postgres-admission/generation-1.json";
const imageSha = "2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05";
const imageSize = 305474048;
const controlIdentities = {
  p1Policy: { bytes: 731542, sha256: "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c" },
  p5Policy: publicAcceptance.completePolicy, launchPlan: publicAcceptance.launchPlan,
  rootAcknowledgement: publicAcceptance.proofs.rootAcknowledgement,
  controlManifest: publicAcceptance.proofs.controlManifest, terminalManifest: publicAcceptance.proofs.terminalManifest,
  postAckJournal: publicAcceptance.proofs.postAckJournal,
};

function virtualFilesystem() {
  const nodes = new Map(), handles = new Map(); let nextFd = 10, nextIno = 100, currentDigest = null;
  const directory = (name, mode = 0o700, identity) => {
    const value = { type: "directory", dev: identity?.dev ?? "1", ino: identity?.ino ?? String(nextIno++), uid: 0, gid: 0,
      mode, nlink: 1, size: 0, mtimeNs: "1", ctimeNs: "1", children: new Set() };
    nodes.set(name, value); const parent = name === "/" ? null : name.slice(0, name.lastIndexOf("/")) || "/";
    if (nodes.has(parent)) nodes.get(parent).children.add(name.slice(name.lastIndexOf("/") + 1)); return value;
  };
  const file = (name, content, mode, identity, logicalSize = content.length, logicalDigest = sha(content)) => {
    const value = { type: "file", dev: identity?.dev ?? "1", ino: identity?.ino ?? String(nextIno++), uid: 0, gid: 0,
      mode, nlink: 1, size: logicalSize, mtimeNs: identity?.mtimeNs ?? "1", ctimeNs: identity?.ctimeNs ?? "1",
      content, digest: logicalDigest, bytesRead: 0, reads: 0 };
    nodes.set(name, value); const parent = name.slice(0, name.lastIndexOf("/")) || "/"; nodes.get(parent)?.children.add(name.slice(name.lastIndexOf("/") + 1));
    return value;
  };
  const stats = node => ({ dev: BigInt(node.dev), ino: BigInt(node.ino), uid: BigInt(node.uid), gid: BigInt(node.gid),
    mode: BigInt(node.mode), nlink: BigInt(node.nlink), size: BigInt(node.size), mtimeNs: BigInt(node.mtimeNs), ctimeNs: BigInt(node.ctimeNs),
    isDirectory: () => node.type === "directory", isFile: () => node.type === "file", isSymbolicLink: () => false });
  const api = {
    nodes, get currentDigest() { return currentDigest; }, set currentDigest(value) { currentDigest = value; },
    directory, file,
    lstatSync(name) { const node = nodes.get(name); if (!node) throw new Error("ENOENT"); return stats(node); },
    openSync(name) { const node = nodes.get(name); if (!node) throw new Error("ENOENT"); const fd = nextFd++; handles.set(fd, node); return fd; },
    fstatSync(fd) { const node = handles.get(fd); if (!node) throw new Error("EBADF"); return stats(node); },
    closeSync(fd) { if (!handles.delete(fd)) throw new Error("EBADF"); },
    readdirSync(name) { const node = nodes.get(name); if (node?.type !== "directory") throw new Error("ENOTDIR"); return [...node.children]; },
    readSync(fd, buffer, offset, length, position) {
      const node = handles.get(fd); if (node?.type !== "file") throw new Error("EBADF"); currentDigest = node.digest; node.reads++;
      if (position >= node.size) return 0;
      const count = Math.min(length, node.size - position); node.bytesRead += count;
      if (node.content.length > position) node.content.copy(buffer, offset, position, Math.min(node.content.length, position + count));
      return count;
    },
  };
  return api;
}

function native(node) { return { dev: node.dev, ino: node.ino, uid: node.uid, gid: node.gid, mode: node.mode,
  nlink: node.nlink, size: node.size, mtimeNs: node.mtimeNs, ctimeNs: node.ctimeNs }; }
function directoryNative(node) { return Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map(key => [key, node[key]])); }
function pin(role, name, node) { return { role, path: name, size: node.size, sha256: node.digest,
  nativeIdentity: native(node), parentIdentity: directoryNative(this.nodes.get(name.slice(0, name.lastIndexOf("/")) || "/")) }; }
function pinProjection(value) { return Object.fromEntries(["path", "size", "sha256", "nativeIdentity", "parentIdentity"].map(key => [key, value[key]])); }
function fixedJson(value, size) {
  const json = Buffer.from(JSON.stringify(value)); assert.ok(json.length + 1 <= size);
  const bytes = Buffer.alloc(size, 0x20); json.copy(bytes); bytes[bytes.length - 1] = 10; return bytes;
}

function objectSet(count, bytes, withImage) {
  const entries = [];
  if (withImage) entries.push({ sha256: imageSha, size: imageSize });
  const smallCount = count - entries.length - 1;
  for (let index = 0; index < smallCount; index++) entries.push({ sha256: String(index + 1).padStart(64, "0"), size: 1 });
  const used = entries.reduce((sum, item) => sum + item.size, 0);
  entries.push({ sha256: "f".repeat(64), size: bytes - used });
  return entries.sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function fixture(vfs) {
  vfs.directory("/", 0o755); vfs.directory("/opt", 0o755); vfs.directory("/opt/auto-world", 0o700);
  vfs.directory("/opt/auto-world/postgres-admission", 0o700); vfs.directory("/opt/auto-world/controls", 0o700);
  vfs.directory("/opt/auto-world/private-archives", 0o700);
  const controlDirectory = "/opt/auto-world/controls";
  const pairs = {
    evidence: { lane: "EVIDENCE", authoritySha256: publicAcceptance.completePolicy.sha256,
      copy: { objects: 840, reservations: 0, bytes: 1023937063, references: 1094, objectDigest: "a".repeat(64), proofDigest: "b".repeat(64) },
      retrieve: { objects: 840, reservations: 0, bytes: 1023937063, references: 1094, objectDigest: "c".repeat(64), proofDigest: "d".repeat(64) } },
    control: { lane: "CONTROL", authoritySha256: publicAcceptance.proofs.controlManifest.sha256,
      copy: { objects: 43, reservations: 0, bytes: 139006319, references: 44, objectDigest: "1".repeat(64), proofDigest: "2".repeat(64) },
      retrieve: { objects: 43, reservations: 0, bytes: 139006319, references: 44, objectDigest: "3".repeat(64), proofDigest: "4".repeat(64) } },
  };
  const values = {
    p1Policy: { kind: "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1", subject: publicAcceptance.subject,
      retrieval: { references: [{ referenceId: "original-candidate.tar", size: imageSize, sha256: imageSha }] } },
    p5Policy: { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_POLICY_V1", subject: publicAcceptance.subject,
      corePolicySha256: "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c" },
    launchPlan: { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_LAUNCH_PLAN_V1" },
    controlManifest: { kind: "POSTGRES_LAUNCH_CONTROL_POLICY_V1", policySha256: null,
      launchPlanSha256: null },
    terminalManifest: { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_TERMINAL_V1", completePolicySha256: null,
      launchPlanSha256: null, evidence: pairs.evidence, control: pairs.control },
  };
  const modes = { p1Policy: 0o400, p5Policy: 0o600, launchPlan: 0o400, rootAcknowledgement: 0o600,
    controlManifest: 0o600, terminalManifest: 0o600, postAckJournal: 0o600 };
  const controls = new Map();
  const addControl = (role, value) => {
    const name = `${controlDirectory}/${role}.json`, identity = controlIdentities[role], bytes = fixedJson(value, identity.bytes),
      node = vfs.file(name, bytes, modes[role], null, identity.bytes, identity.sha256);
    const result = pin.call(vfs, role, name, node); controls.set(role, result); return result;
  };
  addControl("p1Policy", values.p1Policy); values.p5Policy.corePolicySha256 = controls.get("p1Policy").sha256;
  addControl("p5Policy", values.p5Policy); addControl("launchPlan", values.launchPlan);
  values.controlManifest.policySha256 = controls.get("p5Policy").sha256;
  values.controlManifest.launchPlanSha256 = controls.get("launchPlan").sha256; addControl("controlManifest", values.controlManifest);
  values.terminalManifest.completePolicySha256 = controls.get("p5Policy").sha256;
  values.terminalManifest.launchPlanSha256 = controls.get("launchPlan").sha256; addControl("terminalManifest", values.terminalManifest);
  values.rootAcknowledgement = { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_ROOT_ACK_V1", state: "SECOND_COMPLETE_PRIVATE_COPY_VERIFIED",
    completePolicySha256: controls.get("p5Policy").sha256, launchPlanSha256: controls.get("launchPlan").sha256,
    controlManifest: pinProjection(controls.get("controlManifest")), terminalManifest: pinProjection(controls.get("terminalManifest")), generationPairs: pairs };
  addControl("rootAcknowledgement", values.rootAcknowledgement);
  values.postAckJournal = { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_POST_ACK_JOURNAL_V1",
    completePolicySha256: controls.get("p5Policy").sha256, launchPlanSha256: controls.get("launchPlan").sha256,
    rootAck: values.rootAcknowledgement, controlManifest: values.controlManifest, terminalManifest: values.terminalManifest,
    proofs: { rootAck: pinProjection(controls.get("rootAcknowledgement")), controlManifest: pinProjection(controls.get("controlManifest")),
      terminalManifest: pinProjection(controls.get("terminalManifest")), completePolicy: pinProjection(controls.get("p5Policy")),
      launchPlan: pinProjection(controls.get("launchPlan")) } };
  addControl("postAckJournal", values.postAckJournal);
  const roots = [], rootSpecs = [["evidenceCopy", "EVIDENCE", "COPY", 1094, 840, 1023937063, true],
    ["evidenceRetrieve", "EVIDENCE", "RETRIEVE", 1094, 840, 1023937063, true],
    ["controlCopy", "CONTROL", "COPY", 44, 43, 139006319, false],
    ["controlRetrieve", "CONTROL", "RETRIEVE", 44, 43, 139006319, false]];
  for (const [role, lane, operation, references, objectCount, objectBytes, withImage] of rootSpecs) {
    const rootPath = `/opt/auto-world/private-archives/${role}`, rootNode = vfs.directory(rootPath),
      objectsPath = `${rootPath}/objects`, objectsNode = vfs.directory(objectsPath), reservationsNode = vfs.directory(`${rootPath}/identity-reservations`);
    const objects = objectSet(objectCount, objectBytes, withImage).map(object => {
      const node = vfs.file(`${objectsPath}/${object.sha256}.blob`, Buffer.alloc(0), 0o600, null, object.size, object.sha256);
      return { ...object, nativeIdentity: native(node) };
    });
    roots.push({ role, path: rootPath, lane, operation, rootIdentity: directoryNative(rootNode),
      objectsDirectoryIdentity: directoryNative(objectsNode), reservationsDirectoryIdentity: directoryNative(reservationsNode),
      counts: { references, objects: objectCount, bytes: objectBytes, reservations: 0 }, objects });
  }
  const locator = { schemaVersion: 1, kind: "POSTGRES_ADMISSION_ARCHIVE_LOCATOR_V1", admissionGeneration: 1,
    controls: [...controls.values()].sort((left, right) => ["p1Policy", "p5Policy", "launchPlan", "rootAcknowledgement",
      "controlManifest", "terminalManifest", "postAckJournal"].indexOf(left.role) - ["p1Policy", "p5Policy", "launchPlan",
      "rootAcknowledgement", "controlManifest", "terminalManifest", "postAckJournal"].indexOf(right.role)), roots,
    imageArchive: { referenceId: "original-candidate.tar", rootRole: "evidenceCopy", size: imageSize, sha256: imageSha } };
  const locatorBytes = canonical(locator), locatorNode = vfs.file(locatorPath, locatorBytes, 0o400);
  const generationRoot = { admissionGeneration: 1, state: "REVOKED", supportStartedAt: "2025-01-01",
    supportEndsAt: "2026-01-01", archiveUntil: "2027-01-01",
    archiveLocator: { schemaVersion: 1, size: locatorBytes.length, sha256: locatorNode.digest },
    evidence: { p1: { policy: { bytes: 731542, sha256: "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c" } },
      p5: { acceptance: { bytes: 4604, sha256: "9079ccb664f39d54296fcb4a4ae1287c6bfe116db7518d18ee0a4db4cb8e438b" },
        recipeRevision: publicAcceptance.recipeRevision, completePolicy: publicAcceptance.completePolicy, launchPlan: publicAcceptance.launchPlan,
        counts: { ...publicAcceptance.counts, controlReferences: 44 }, proofs: publicAcceptance.proofs } },
    executionFiles: [{ path: "scripts/postgres-image/admission-archive-maintenance.mjs", size: 1, sha256: "9".repeat(64) }] };
  return { generationRoot, locator, roots };
}

test("archive verifier keeps FAST metadata-only and FULL bounded/read-only through revoked post-support retention", async t => {
  const vfs = virtualFilesystem(), fixtureValue = fixture(vfs), realCreateHash = crypto.createHash;
  t.mock.method(crypto, "createHash", algorithm => {
    const actual = realCreateHash(algorithm);
    return { update(value) { actual.update(value); return this; }, digest(encoding) {
      const selected = vfs.currentDigest; vfs.currentDigest = null; return selected ?? actual.digest(encoding);
    } };
  });
  syncBuiltinESMExports();
  t.after(() => { crypto.createHash.mock.restore(); syncBuiltinESMExports(); });
  const module = await import(`../scripts/postgres-image/admission-archive-maintenance.mjs?fixture=${Date.now()}`);
  assert.deepEqual(Object.keys(module), ["getPostgresAdmissionImageArchiveSource", "loadPostgresAdmissionArchiveContext",
    "verifyPostgresAdmissionArchiveFast", "verifyPostgresAdmissionArchiveFull"]);
  for (const name of ["lstatSync", "openSync", "fstatSync", "closeSync", "readdirSync", "readSync"])
    t.mock.method(fs, name, vfs[name].bind(vfs));
  const wrongPublicRoot = JSON.parse(JSON.stringify(fixtureValue.generationRoot));
  wrongPublicRoot.evidence.p1.policy.sha256 = "0".repeat(64);
  assert.throws(() => module.loadPostgresAdmissionArchiveContext(wrongPublicRoot), /postgres_admission_archive_invalid/u);
  const context = module.loadPostgresAdmissionArchiveContext(fixtureValue.generationRoot);
  assert.throws(() => module.getPostgresAdmissionImageArchiveSource(context), /postgres_admission_archive_invalid/u);
  const objectNodes = [...vfs.nodes.values()].filter(node => node.type === "file" && node.content.length === 0);
  const fast = module.verifyPostgresAdmissionArchiveFast(context);
  assert.equal(fast.kind, "POSTGRES_ADMISSION_ARCHIVE_FAST_V1"); assert.equal(fast.scope, "LEASE_IDENTITY_ONLY");
  assert.equal(Object.hasOwn(fast, "validUntil"), false); assert.equal(objectNodes.reduce((sum, node) => sum + node.bytesRead, 0), 0);
  const source = module.getPostgresAdmissionImageArchiveSource(context);
  assert.equal(source.sha256, imageSha); assert.equal(source.size, imageSize); assert.equal(Object.isFrozen(source), true);
  const full = module.verifyPostgresAdmissionArchiveFull(context);
  assert.equal(full.kind, "POSTGRES_ADMISSION_ARCHIVE_FULL_V1"); assert.equal(full.roots.length, 4);
  assert.equal(Date.parse(full.validUntil) - Date.parse(full.completedAt), 24 * 60 * 60 * 1000);
  assert.equal(objectNodes.reduce((sum, node) => sum + node.bytesRead, 0), 2 * (1023937063 + 139006319));
  assert.doesNotMatch(JSON.stringify(full), /\/opt\/|"ino"|"uid"|executionId|receipt|payload/u);
  const changed = vfs.nodes.get(`${fixtureValue.roots[0].path}/objects/${fixtureValue.roots[0].objects[0].sha256}.blob`);
  const originalIno = changed.ino; changed.ino = "999999";
  assert.throws(() => module.verifyPostgresAdmissionArchiveFast(context), /postgres_admission_archive_invalid/u);
  changed.ino = originalIno;
  const p5Policy = vfs.nodes.get("/opt/auto-world/controls/p5Policy.json"); p5Policy.mode = 0o400;
  assert.throws(() => module.verifyPostgresAdmissionArchiveFast(context), /postgres_admission_archive_invalid/u);
});

test("archive maintenance source has no writer, network, Docker, child process, or test-only production export", () => {
  const source = fs.readFileSync(new URL("../scripts/postgres-image/admission-archive-maintenance.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /writeFile|createWriteStream|rename|unlink|rmSync|mkdir|chmod|chown|fsync|node:(?:net|http|https|child_process)|docker|TEST_ONLY/u);
  assert.match(source, /O_RDONLY/u); assert.match(source, /O_NOFOLLOW/u); assert.match(source, /readSync/u);
  assert.match(source, /maintenance-generation-\$\{generation\}\.json/u);
  assert.match(source, /argv\[0\] === "--generation"/u); assert.doesNotMatch(source, /process\.env/u);
});
