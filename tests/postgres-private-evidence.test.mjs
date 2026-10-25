import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { intakePostgresPrivateEvidence, validatePostgresPrivateEvidenceReceipt, postgresPrivateEvidenceFailureDiagnostic,
  validatePostgresPrivateEvidenceFailureDiagnostic, postgresPrivateEvidencePhases } from "../scripts/postgres-image/private-evidence.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN as PIN } from "../scripts/postgres-image/private-evidence-policy.mjs";
import { validatePostgresCandidateArchive } from "../scripts/postgres-image/candidate-proof.mjs";
import { sealPostgresPrivateCopy } from "../scripts/postgres-image/private-copy-linux.mjs";
import { retainedFixture } from "./fixtures/postgres-private-retention.mjs";

const rootSource = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (v) => globalThis.structuredClone(v);
const encode = (v) => Buffer.from(JSON.stringify(v));
const metadata = (file) => { const s = fs.lstatSync(file, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid),
  mode: Number(s.mode & 0o7777n), nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; };
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); };
function git(directory, args) {
  const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" },
    encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
const commit = (directory, message) => { git(directory, ["add", "--all"]); git(directory, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "--quiet", "-m", message]); return git(directory, ["rev-parse", "HEAD"]); };
function ownTemporary(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-evidence-test-"))); fs.chmodSync(directory, 0o700);
  const own = metadata(directory);
  t.after(() => {
    assert.equal(fs.realpathSync(directory), directory); const current = metadata(directory);
    assert.equal(current.dev, own.dev); assert.equal(current.ino, own.ino); assert.equal(current.uid, 1000);
    assert.ok(directory.startsWith(path.join(os.tmpdir(), "aw-pg-evidence-test-")));
    fs.rmSync(directory, { recursive: true });
  }); return directory;
}
function fixture(t) {
  const root = ownTemporary(t); const workspace = path.join(root, "workspace"); const parent = path.join(root, "evidence"); const source = path.join(root, "original"); const audit = path.join(root, "historical-audit");
  for (const file of [workspace, parent, source, audit]) fs.mkdirSync(file, { mode: 0o700 });
  git(workspace, ["init", "--quiet", "--template="]);
  const dockerfile = fs.readFileSync(path.join(rootSource, "infra/postgres-image/Dockerfile")); write(path.join(workspace, "infra/postgres-image/Dockerfile"), dockerfile);
  const originalRecipe = commit(workspace, "original recipe"); const legacy = retainedFixture();
  const newTag = `aw-postgres-gosu:${hash(Buffer.from(`${legacy.runId}:${originalRecipe}`)).slice(0, 24)}`;
  let archive = Buffer.from(legacy.archive); const old = Buffer.from(legacy.proof.tag); const replacement = Buffer.from(newTag);
  let at = archive.indexOf(old); while (at !== -1) { replacement.copy(archive, at); at = archive.indexOf(old, at + old.length); }
  // OCI's ref-name and legacy repositories store only the suffix.
  const suffix = Buffer.from(legacy.proof.tag.split(":")[1]); const nextSuffix = Buffer.from(newTag.split(":")[1]);
  at = archive.indexOf(suffix); while (at !== -1) { nextSuffix.copy(archive, at); at = archive.indexOf(suffix, at + suffix.length); }
  const proof = validatePostgresCandidateArchive(archive, { imageId: legacy.policy.candidate.imageId, tag: newTag, expectedDiffIds: legacy.policy.candidate.diffIds, expectedLayers: 12 });
  const retained = clone(legacy.retention); retained.recipeRevision = originalRecipe; retained.archiveProof = proof;
  retained.remoteMaterialReceipt.recipeRevision = originalRecipe; retained.remoteMaterialReceipt.alias = newTag;
  retained.remoteMaterialReceipt.archive.archiveSha256 = proof.archiveSha256;
  const receiptBytes = encode(retained); const policyBytes = encode(legacy.policy);
  const importPrefix = path.join(root, "reimport-"); const imported = fs.mkdtempSync(importPrefix); fs.chmodSync(imported, 0o700);
  for (const directory of [source, imported]) { write(path.join(directory, "candidate.tar"), archive); write(path.join(directory, "retention-receipt.json"), receiptBytes); }
  const original = { sourceDirectory: source, sourceGid: 1000, ownerUid: 1000, importGid: 1000, importPrefix,
    originalRecipeRevision: originalRecipe, originalExecutionId: retained.executionId, policySha256: hash(policyBytes),
    files: [{ name: "candidate.tar", size: archive.length, sha256: hash(archive) }, { name: "retention-receipt.json", size: receiptBytes.length, sha256: hash(receiptBytes) }], totalBytes: archive.length + receiptBytes.length };
  const runtime = JSON.parse(fs.readFileSync(path.join(rootSource, PIN.policyFiles.runtime))); runtime.subject = legacy.policy.subject;
  const auditBytes = new Map(runtime.audit.files.map((f) => [f.name, encode({ historicalAt: "2000-01-01T00:00:00Z", role: f.name, fixture: true })]));
  for (const [name, bytes] of auditBytes) write(path.join(audit, name), bytes);
  runtime.audit.files = runtime.audit.files.map((f) => ({ name: f.name, size: auditBytes.get(f.name).length, sha256: hash(auditBytes.get(f.name)) }));
  const entry = runtime.audit.files.find((f) => f.name === "audit-receipt.json"); runtime.audit.receipt = { size: entry.size, sha256: entry.sha256 };
  const publicFiles = PIN.publicFiles.map((expected) => {
    const bytes = expected.name === PIN.policyFiles.candidate ? policyBytes : expected.name === PIN.policyFiles.runtime ? encode(runtime)
      : expected.name === "infra/postgres-image/Dockerfile" ? dockerfile : fs.readFileSync(path.join(rootSource, expected.source));
    if (expected.name !== "infra/postgres-image/Dockerfile") write(path.join(workspace, expected.name), bytes);
    return { name: expected.name, source: expected.source, size: bytes.length, sha256: hash(bytes) };
  });
  const revisions = [originalRecipe]; for (let i = 0; i < 7; i++) revisions.push(commit(workspace, `historical recipe ${i}`));
  const recipes = Object.fromEntries(Object.keys(PIN.recipes).map((name, i) => [name, revisions[i]]));
  const copiedReceipt = encode({ harmlessCopyReference: true, historicalAt: "2000-01-01T00:00:00Z" }); const copyReceiptFile = path.join(root, "copy-reference.json"); write(copyReceiptFile, copiedReceipt);
  const pin = { ...clone(PIN), workspace, parent, directoryPrefix: "pg-private-evidence-fixture-", original, importDirectory: imported, subject: legacy.policy.subject,
    candidate: { imageId: legacy.policy.candidate.imageId, tag: newTag }, copyReceiptFile, copyReceipt: { size: copiedReceipt.length, sha256: hash(copiedReceipt) }, auditDirectory: audit, publicFiles, recipes };
  const nonce = randomBytes(12).toString("hex"); const input = { workspace, recipeRevision: revisions.at(-1), executionId: "local-evidence-intake-" + nonce, directory: path.join(parent, pin.directoryPrefix + nonce), pin };
  const counts = { stage: 0, seal: 0, health: 0 };
  const dependencies = {
    auditStage: ({ source: from, target, policy }) => {
      counts.stage++; fs.mkdirSync(target, { mode: 0o700 });
      const files = policy.audit.files.map((f) => { const bytes = fs.readFileSync(path.join(from, f.name)); assert.equal(hash(bytes), f.sha256); write(path.join(target, f.name), bytes);
        return { ...f, source: metadata(path.join(from, f.name)), target: metadata(path.join(target, f.name)) }; });
      const sourceIdentities = Object.fromEntries([["policy", pin.policyFiles.runtime], ["candidate", pin.policyFiles.candidate], ["lock", pin.policyFiles.lock],
        ["dockerfile", "infra/postgres-image/Dockerfile"], ["publication", "infra/postgres-image/candidate-publication-receipt.json"]].map(([key, name]) => {
          const expected = pin.publicFiles.find((f) => f.name === name); return [key, { size: expected.size, sha256: expected.sha256 }]; }));
      return { kind: "POSTGRES_RUNTIME_RESTORE_AUDIT_STAGE_V1", state: "STAGED", source: from, target, sourceDirectory: metadata(from), directory: metadata(target), files, sourceIdentities };
    },
    auditSeal: (options, expected) => {
      counts.seal++; assert.equal(options.directory, expected.target);
      for (const f of expected.files) for (const [directory, field] of [[expected.source, "source"], [expected.target, "target"]]) {
        assert.deepEqual(metadata(path.join(directory, f.name)), f[field]); assert.equal(hash(fs.readFileSync(path.join(directory, f.name))), f.sha256);
      } return expected;
    },
    archiveHealth: async (value) => { counts.health++; return await sealPostgresPrivateCopy({ pin: value.pin.original, policy: legacy.policy, recipeRevision: value.recipeRevision, signal: value.signal }, value.pin.importDirectory); },
  };
  return { root, input, dependencies, counts, runtime, archive, source, imported, copyReceiptFile };
}
const closed = (error, suffix, phase, cleanup = "CONFIRMED") => {
  const diagnostic = postgresPrivateEvidenceFailureDiagnostic(error);
  assert.deepEqual(diagnostic, { code: "postgres_private_evidence_" + suffix, phase, cleanup });
  assert.deepEqual(Object.keys(error).sort(), ["cleanup", "phase"]); assert.equal(error.cause, undefined); return true;
};
const patch = (t, key, fn) => { const old = fs[key]; t.mock.method(fs, key, (...args) => fn(old, ...args)); syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); }); };
function nativeGitVersion() {
  const value = spawnSync("/usr/bin/git", ["--version"], { encoding: "utf8", timeout: 10000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  assert.equal(value.error, undefined); assert.equal(value.status, 0); assert.equal(value.signal, null); assert.equal(value.stderr, "");
  assert.match(value.stdout, /^git version [0-9]+\.[0-9]+\.[0-9]+\n$/u); return value.stdout.trim();
}
const actualGitVersion = process.platform === "linux" ? nativeGitVersion() : null;
const supportedGit = actualGitVersion === "git version 2.43.0";

test("diagnostics are closed and never leak throwing or changing error getters", () => {
  for (const value of [new Error("github_pat_private"), { get message() { throw new Error("private"); } }, null])
    assert.deepEqual(postgresPrivateEvidenceFailureDiagnostic(value), { code: "postgres_private_evidence_operation_failed", phase: "CONTEXT", cleanup: "UNVERIFIED" });
  let reads = 0; const value = { get message() { reads++; return reads === 1 ? "postgres_private_evidence_file_changed" : "private"; }, phase: "COPY", cleanup: "CONFIRMED" };
  assert.deepEqual(postgresPrivateEvidenceFailureDiagnostic(value), { code: "postgres_private_evidence_file_changed", phase: "COPY", cleanup: "CONFIRMED" }); assert.equal(reads, 1);
  assert.deepEqual(postgresPrivateEvidenceFailureDiagnostic({ message: "postgres_private_evidence_source_bundle_git_invalid", phase: "SOURCE", cleanup: "CONFIRMED" }),
    { code: "postgres_private_evidence_git_invalid", phase: "SOURCE", cleanup: "CONFIRMED" });
  assert.deepEqual(postgresPrivateEvidenceFailureDiagnostic({ message: "postgres_private_evidence_cleanup_uncertain", phase: "CLEANUP", cleanup: "CONFIRMED" }),
    { code: "postgres_private_evidence_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" });
  for (const bad of [{ code: "private", phase: "COPY", cleanup: "CONFIRMED" }, { code: ["postgres_private_evidence_file_changed"], phase: "COPY", cleanup: "CONFIRMED" },
    { code: "postgres_private_evidence_file_changed", phase: "PRIVATE", cleanup: "CONFIRMED" }, { code: "postgres_private_evidence_file_changed", phase: "COPY", cleanup: "CONFIRMED", raw: "private" },
    { code: "postgres_private_evidence_cleanup_uncertain", phase: "CLEANUP", cleanup: "CONFIRMED" }])
    assert.throws(() => validatePostgresPrivateEvidenceFailureDiagnostic(bad), /postgres_private_evidence_receipt_invalid/u);
});
test("malformed inputs and actual unsupported actors refuse before filesystem access", async () => {
  await assert.rejects(intakePostgresPrivateEvidence({}), (e) => closed(e, "arguments_invalid", "CONTEXT"));
  if (process.platform !== "linux" || process.getuid() !== 1000 || process.getgid() !== 1000) {
    const input = { workspace: PIN.workspace, recipeRevision: "a".repeat(40), executionId: "local-evidence-intake-" + "1".repeat(24),
      directory: PIN.parent + "/" + PIN.directoryPrefix + "1".repeat(24), pin: PIN };
    await assert.rejects(intakePostgresPrivateEvidence(input), (e) => closed(e, "requires_native_actor", "CONTEXT"));
  }
});

if (process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000 && supportedGit) {
  test("real native intake publishes 29 sealed payloads and a closed historical receipt without execution permission", async (t) => {
    const f = fixture(t); const before = [f.source, f.imported].map((dir) => fs.readdirSync(dir).map((name) => ({ name, identity: metadata(path.join(dir, name)), hash: hash(fs.readFileSync(path.join(dir, name))) })));
    const result = await intakePostgresPrivateEvidence(f.input, f.dependencies); const bytes = fs.readFileSync(path.join(result.directory, result.receipt.name));
    assert.equal(bytes.length, result.receipt.size); assert.equal(hash(bytes), result.receipt.sha256); assert.deepEqual(metadata(path.join(result.directory, result.receipt.name)), result.receipt.identity);
    const receipt = validatePostgresPrivateEvidenceReceipt(JSON.parse(bytes), f.input);
    assert.equal(receipt.payloads.length, 29); assert.deepEqual(receipt.phases.map((p) => p.name), postgresPrivateEvidencePhases); assert.deepEqual(f.counts, { stage: 1, seal: 1, health: 3 });
    assert.equal(receipt.currentness, "NOT_EVALUATED"); assert.equal(receipt.runtimePermission, "NOT_GRANTED"); assert.equal(receipt.closure, "INCOMPLETE"); assert.equal(receipt.admission, "NOT_AUTHORIZED");
    assert.equal(receipt.bundle.refs.length, 8); assert.equal(receipt.bundle.zeroPrerequisites, true); assert.equal(receipt.bundle.packVerification, "OFFLINE_FULL_FSCK");
    assert.ok(Object.isFrozen(receipt)); assert.equal(bytes.includes(Buffer.from("historicalAt")), false);
    assert.deepEqual([f.source, f.imported].map((dir) => fs.readdirSync(dir).map((name) => ({ name, identity: metadata(path.join(dir, name)), hash: hash(fs.readFileSync(path.join(dir, name))) }))), before);
    assert.equal(fs.readdirSync(path.join(f.input.directory, "source")).length, 1); assert.equal(fs.readdirSync(f.input.pin.parent).filter((name) => name.startsWith(".postgres-source-bundle-work-")).length, 0);
    for (const mutate of [(v) => { v.payloads.pop(); }, (v) => { v.payloads[0].identity.ino = [v.payloads[0].identity.ino]; },
      (v) => { v.payloads[0].identity.ino = "01"; }, (v) => { v.payloads[0].identity.mode = 0o644; }, (v) => { v.payloads[0].sourceIdentity.ino = "999"; },
      (v) => { v.currentness = "VERIFIED"; }, (v) => { v.runtimePermission = "GRANTED"; }, (v) => { v.health.after.archiveProof.rawLayers.pop(); },
      (v) => { v.bundle.file.identity.ino = "999"; }, (v) => { v.bundle.blobs[0].sha256 = "a".repeat(64); }, (v) => { v.policyBytesBase64 += "\n"; },
      (v) => { v.runtimePolicyBytesBase64 = Buffer.from("{}").toString("base64"); }, (v) => { v.audit.files[0].target.ino = "999"; },
      (v) => { v.audit.sourceIdentities.lock.sha256 = "a".repeat(64); }, (v) => { v.requiredMissing.pop(); }, (v) => { v.private = "raw"; },
      (v) => { v.supportStartedAt = v.startedAt; }, (v) => { v.phases[0].durationMs = 900001; }]) {
      const changed = clone(receipt); mutate(changed); assert.throws(() => validatePostgresPrivateEvidenceReceipt(changed, f.input), /postgres_private_evidence_receipt_invalid/u);
    }
  });
  test("source byte-pin mismatch and inherited hard link fail before publication", async (t) => {
    for (const kind of ["bytes", "link", "symlink", "mode"]) await t.test(kind, async (child) => {
      const f = fixture(child); const file = path.join(f.input.workspace, f.input.pin.publicFiles[0].source);
      if (kind === "bytes") fs.appendFileSync(f.copyReceiptFile, "x");
      if (kind === "link") fs.linkSync(file, path.join(f.root, "alias"));
      if (kind === "symlink") { fs.renameSync(file, path.join(f.root, "saved")); fs.symlinkSync(path.join(f.root, "saved"), file); }
      if (kind === "mode") fs.chmodSync(file, 0o666);
      await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies)); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    });
  });
  test("archive/parser failure and malformed audit seam cannot produce a success receipt", async (t) => {
    const f = fixture(t); fs.appendFileSync(path.join(f.imported, "candidate.tar"), "x");
    await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies), (e) => closed(e, "operation_failed", "HEALTH_BEFORE"));
    assert.equal(fs.existsSync(f.input.directory), true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    const g = fixture(t); g.dependencies.auditStage = () => ({ state: "STAGED", private: "private" });
    await assert.rejects(intakePostgresPrivateEvidence(g.input, g.dependencies), (e) => closed(e, "operation_failed", "AUDIT_STAGE"));
  });
  test("changed original, same-byte inode substitution, target extras and malformed audit seal retain failures", async (t) => {
    for (const kind of ["source", "inode", "extra", "seal"]) await t.test(kind, async (child) => {
      const f = fixture(child); const seal = f.dependencies.auditSeal;
      f.dependencies.auditSeal = (options, proof) => {
        const result = seal(options, proof); const file = path.join(f.input.directory, "references/copy-receipt.json");
        if (kind === "source") fs.appendFileSync(f.copyReceiptFile, "x");
        if (kind === "inode") { const bytes = fs.readFileSync(file); fs.renameSync(file, path.join(f.root, "retained")); write(file, bytes); }
        if (kind === "extra") write(path.join(f.input.directory, "private-extra"), Buffer.from("harmless"));
        return kind === "seal" ? { ...result, extra: "private" } : result;
      };
      await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies)); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
      assert.equal(fs.existsSync(path.join(f.input.directory, "references/copy-receipt.json")), true);
    });
  });
  test("post-publication replacement is detected and removes only the new owned receipt", async (t) => {
    const f = fixture(t); let changed = false;
    patch(t, "fsyncSync", (old, fd) => {
      const result = old(fd); const name = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (!changed && name === path.join(f.input.directory, "receipt.json")) {
        changed = true; const target = path.join(f.input.directory, "references/copy-receipt.json"); const bytes = fs.readFileSync(target);
        fs.renameSync(target, path.join(f.root, "old-copy")); write(target, bytes);
      } return result;
    });
    await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies), (e) => closed(e, "file_changed", "PUBLISH"));
    assert.equal(changed, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.existsSync(path.join(f.input.directory, "references/copy-receipt.json")), true);
  });
  test("HEAD change during the final real archive seal fails after publication even with unchanged public bytes", async (t) => {
    const f = fixture(t); const health = f.dependencies.archiveHealth;
    f.dependencies.archiveHealth = async (...args) => {
      const proof = await health(...args);
      if (f.counts.health === 3) git(f.input.workspace, ["update-ref", "HEAD", f.input.pin.recipes.sql]);
      return proof;
    };
    await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies), (e) => closed(e, "source_invalid", "PUBLISH"));
    assert.equal(f.counts.health, 3); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    for (const expected of f.input.pin.publicFiles) assert.equal(hash(fs.readFileSync(path.join(f.input.workspace, expected.source))), expected.sha256);
  });
  test("late held source FD close failure removes the published receipt and prioritizes cleanup uncertainty", async (t) => {
    const f = fixture(t); let changed = false;
    patch(t, "closeSync", (old, fd) => {
      const name = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (!changed && name === f.copyReceiptFile && fs.existsSync(path.join(f.input.directory, "receipt.json"))) {
        changed = true; old(fd); throw new Error("github_pat_private_failure");
      } return old(fd);
    });
    await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies), (e) => closed(e, "cleanup_uncertain", "PUBLISH", "UNVERIFIED"));
    assert.equal(changed, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.existsSync(f.copyReceiptFile), true);
  });
  test("late receipt content mutation retires its owned inode while a foreign replacement is preserved", async (t) => {
    for (const kind of ["same-inode", "foreign-inode"]) await t.test(kind, async (child) => {
      const f = fixture(child); const health = f.dependencies.archiveHealth; let changed;
      f.dependencies.archiveHealth = async (...args) => {
        const proof = await health(...args);
        if (f.counts.health === 3) {
          const file = path.join(f.input.directory, "receipt.json"); const body = JSON.parse(fs.readFileSync(file)); body.phases[0].durationMs++;
          const bytes = Buffer.from(JSON.stringify(body, null, 2) + "\n"); const before = metadata(file);
          if (kind === "foreign-inode") { fs.renameSync(file, path.join(f.root, "old-receipt")); write(file, bytes); }
          else fs.writeFileSync(file, bytes);
          changed = metadata(file); assert.equal(changed.ino === before.ino, kind === "same-inode");
        } return proof;
      };
      await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies), (e) => closed(e,
        kind === "same-inode" ? "file_changed" : "cleanup_uncertain", kind === "same-inode" ? "PUBLISH" : "CLEANUP", kind === "same-inode" ? "CONFIRMED" : "UNVERIFIED"));
      assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), kind === "foreign-inode");
      if (kind === "foreign-inode") assert.deepEqual(metadata(path.join(f.input.directory, "receipt.json")), changed);
      assert.equal(fs.existsSync(path.join(f.input.directory, "references/copy-receipt.json")), true);
    });
  });
  test("publication/fsync and descriptor-close uncertainty remain closed and cannot publish success", async (t) => {
    for (const kind of ["fsync", "close"]) await t.test(kind, async (child) => {
      const f = fixture(child); let triggered = false;
      patch(child, kind === "fsync" ? "fsyncSync" : "closeSync", (old, fd) => {
        const name = fs.readlinkSync(`/proc/self/fd/${fd}`);
        if (!triggered && name === path.join(f.input.directory, "receipt.json")) { triggered = true; if (kind === "close") old(fd); throw new Error("github_pat_private_failure"); }
        return old(fd);
      });
      await assert.rejects(intakePostgresPrivateEvidence(f.input, f.dependencies), (e) => closed(e, kind === "close" ? "cleanup_uncertain" : "operation_failed", "PUBLISH", kind === "close" ? "UNVERIFIED" : "CONFIRMED"));
      assert.equal(triggered, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    });
  });
  test("capacity and real abort refuse writes; exclusive destination collision preserves prior state", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(intakePostgresPrivateEvidence({ ...f.input, signal: controller.signal }, f.dependencies), (e) => closed(e, "aborted", "SOURCE")); assert.equal(fs.existsSync(f.input.directory), false);
    const g = fixture(t); fs.mkdirSync(g.input.directory, { mode: 0o700 }); write(path.join(g.input.directory, "foreign"), Buffer.from("untouched"));
    await assert.rejects(intakePostgresPrivateEvidence(g.input, g.dependencies)); assert.equal(fs.readFileSync(path.join(g.input.directory, "foreign"), "utf8"), "untouched");
    const h = fixture(t); patch(t, "statfsSync", (old, ...args) => ({ ...old(...args), bavail: 1n, bsize: 1n }));
    await assert.rejects(intakePostgresPrivateEvidence(h.input, h.dependencies), (e) => closed(e, "capacity_invalid", "SOURCE")); assert.equal(fs.existsSync(h.input.directory), false);
  });
  test("unknown dependency getters and audit cleanup errors have fixed privacy-safe diagnostics", async (t) => {
    const f = fixture(t); const deps = { get auditStage() { throw new Error("private"); } };
    await assert.rejects(intakePostgresPrivateEvidence(f.input, deps), (e) => closed(e, "operation_failed", "CONTEXT"));
    const g = fixture(t); g.dependencies.auditSeal = () => { throw new Error("postgres_runtime_restore_audit_cleanup_uncertain"); };
    await assert.rejects(intakePostgresPrivateEvidence(g.input, g.dependencies), (e) => closed(e, "cleanup_uncertain", "FINAL_SEALS", "UNVERIFIED"));
    const h = fixture(t); h.dependencies.auditStage = () => { throw new Error("postgres_private_evidence_source_bundle_git_cleanup_uncertain"); };
    await assert.rejects(intakePostgresPrivateEvidence(h.input, h.dependencies), (e) => closed(e, "cleanup_uncertain", "AUDIT_STAGE", "UNVERIFIED"));
    const j = fixture(t); let reads = 0; const uncertain = new Error(); Object.defineProperty(uncertain, "message", { get() {
      reads++; return reads === 1 ? "postgres_private_evidence_cleanup_uncertain" : "github_pat_private";
    } }); j.dependencies.auditStage = () => { throw uncertain; };
    await assert.rejects(intakePostgresPrivateEvidence(j.input, j.dependencies), (e) => closed(e, "cleanup_uncertain", "AUDIT_STAGE", "UNVERIFIED")); assert.equal(reads, 1);
  });
} else if (process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000) {
  test("actual unsupported installed Git fails closed in default intake before creating evidence", async (t) => {
    assert.notEqual(actualGitVersion, "git version 2.43.0"); const f = fixture(t);
    await assert.rejects(intakePostgresPrivateEvidence(f.input), (e) => closed(e, "git_invalid", "SOURCE"));
    assert.deepEqual(f.counts, { stage: 0, seal: 0, health: 0 }); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("native positive intake suite requires the fixed installed Git2.43.0", { skip: `Actual ${actualGitVersion}; native Git2.43.0 replay remains required` }, () => {});
} else {
  test("native intake fixtures execute through a private actual UID1000 bootstrap", { skip: process.platform !== "linux" }, () => {
    if (process.getuid() !== 0) {
      const result = spawnSync("/usr/bin/sudo", ["-n", process.execPath, "--test", fileURLToPath(import.meta.url)], { cwd: rootSource,
        env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 240000, maxBuffer: 1048576 });
      assert.equal(result.status, 0, `${result.error?.code ?? ""}\n${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /# fail 0/u); assert.match(result.stdout, /# skipped 0/u); return;
    }
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-evidence-bootstrap-"))); const entries = new Map();
    const remember = (file, mode) => { fs.chmodSync(file, mode); fs.chownSync(file, 1000, 1000); entries.set(file, metadata(file)); };
    const createDirectory = (file) => { if (file !== directory) fs.mkdirSync(file, { mode: 0o700 }); remember(file, 0o700); };
    const copy = (from, to) => { assert.equal(fs.lstatSync(from).isSymbolicLink(), false); fs.writeFileSync(to, fs.readFileSync(from), { flag: "wx", mode: 0o600 }); remember(to, 0o600); };
    const modules = (from, to) => { createDirectory(to); for (const name of fs.readdirSync(from).sort()) {
      const child = path.join(from, name); assert.equal(fs.lstatSync(child).isSymbolicLink(), false);
      if (fs.lstatSync(child).isDirectory()) modules(child, path.join(to, name)); else if (name.endsWith(".mjs")) copy(child, path.join(to, name));
    } };
    try {
      createDirectory(directory); modules(path.join(rootSource, "scripts"), path.join(directory, "scripts")); createDirectory(path.join(directory, "tests")); createDirectory(path.join(directory, "tests/fixtures"));
      copy(fileURLToPath(import.meta.url), path.join(directory, "tests/postgres-private-evidence.test.mjs")); copy(path.join(rootSource, "tests/fixtures/postgres-private-retention.mjs"), path.join(directory, "tests/fixtures/postgres-private-retention.mjs"));
      for (const pin of PIN.publicFiles) {
        const target = path.join(directory, pin.source); const missing = []; let parent = path.dirname(target);
        while (!entries.has(parent)) { missing.unshift(parent); parent = path.dirname(parent); } for (const name of missing) createDirectory(name); copy(path.join(rootSource, pin.source), target);
      }
      for (const relative of ["infra/postgres-image/filesystem-policy.json", "infra/seaweed/seaweed-lock.json", "infra/seaweed/required-tests.json", "infra/seaweed-image/base-config.json", "tests/fixtures/seaweed-source/upstream/go.sum"]) {
        const target = path.join(directory, relative); const missing = []; let parent = path.dirname(target);
        while (!entries.has(parent)) { missing.unshift(parent); parent = path.dirname(parent); } for (const name of missing) createDirectory(name);
        copy(path.join(rootSource, relative), target);
      }
      const result = spawnSync("/usr/bin/setpriv", ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--",
        process.execPath, "--test", path.join(directory, "tests/postgres-private-evidence.test.mjs")], { cwd: directory,
        env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 240000, maxBuffer: 1048576 });
      assert.equal(result.status, 0, `${result.error?.code ?? ""}\n${result.stdout}\n${result.stderr}`); assert.match(result.stdout, /# fail 0/u);
      assert.match(result.stdout, new RegExp(`# skipped ${supportedGit ? 0 : 1}\\n`, "u"));
      if (!supportedGit) {
        assert.ok(result.stdout.includes(`Actual ${actualGitVersion}; native Git2.43.0 replay remains required`));
        assert.match(result.stdout, /ok 3 - actual unsupported installed Git fails closed in default intake before creating evidence/u);
      }
    } finally {
      for (const [file, expected] of entries) {
        const current = metadata(file); for (const key of ["dev", "ino", "uid", "gid", "mode"]) assert.equal(current[key], expected[key]);
        if (fs.lstatSync(file).isDirectory()) assert.deepEqual(fs.readdirSync(file).sort(), [...entries.keys()].filter((p) => path.dirname(p) === file).map((p) => path.basename(p)).sort()); else assert.equal(current.nlink, 1);
      }
      for (const [file] of [...entries].reverse()) { if (fs.lstatSync(file).isDirectory()) fs.rmdirSync(file); else fs.unlinkSync(file); }
    }
  });
}
