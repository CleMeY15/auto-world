import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stagePostgresRuntimeAudit, sealPostgresRuntimeAuditStage, replayLocalPostgresRuntimeAudit,
  postgresRuntimeAuditValidUntil, validatePostgresRuntimeAuditStageProof, preflightLocalPostgresRuntimeAudit } from "../scripts/postgres-image/runtime-restore-audit.mjs";
import { validateDatabaseMetadata } from "../scripts/scanner/audit-policy.mjs";
import { evaluateLocalPostgresGosuAudit } from "../scripts/postgres-image/audit-policy.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const encode = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
const write = (file, bytes) => { fs.writeFileSync(file, bytes, { mode: 0o600 }); fs.chmodSync(file, 0o600); };
const deadline = () => Date.now() + 120000;
const clone = (v) => globalThis.structuredClone(v);
const suiteInputs = ["candidate-remote.json", "candidate-runtime.json", "lock.json", "Dockerfile", "candidate-publication-receipt.json", "filesystem-policy.json"];
function privateSuiteCopy(source, owner) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-audit-bootstrap-")));
  const created = new Map();
  const remember = (file, mode) => {
    fs.chmodSync(file, mode); fs.chownSync(file, owner, owner);
    const s = fs.lstatSync(file, { bigint: true });
    created.set(file, { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode, directory: s.isDirectory() });
  };
  const makeDirectory = (file) => { if (file !== directory) fs.mkdirSync(file, { mode: 0o700 }); remember(file, 0o700); };
  const copyFile = (from, to) => {
    const s = fs.lstatSync(from); assert.ok(s.isFile() && !s.isSymbolicLink());
    const bytes = fs.readFileSync(from); write(to, bytes); remember(to, 0o600);
    assert.deepEqual(fs.readFileSync(to), bytes);
  };
  makeDirectory(directory);
  const copyModules = (from, to) => {
    makeDirectory(to);
    for (const name of fs.readdirSync(from).sort()) {
      const entry = path.join(from, name); const s = fs.lstatSync(entry);
      assert.equal(s.isSymbolicLink(), false);
      if (s.isDirectory()) copyModules(entry, path.join(to, name));
      else if (name.endsWith(".mjs")) copyFile(entry, path.join(to, name));
    }
  };
  copyModules(path.join(source, "scripts"), path.join(directory, "scripts"));
  makeDirectory(path.join(directory, "tests"));
  copyFile(path.join(source, "tests/postgres-runtime-restore-audit.test.mjs"), path.join(directory, "tests/postgres-runtime-restore-audit.test.mjs"));
  makeDirectory(path.join(directory, "infra")); makeDirectory(path.join(directory, "infra/postgres-image"));
  for (const name of suiteInputs) copyFile(path.join(source, "infra/postgres-image", name), path.join(directory, "infra/postgres-image", name));
  makeDirectory(path.join(directory, "infra/seaweed"));
  for (const name of ["seaweed-lock.json", "required-tests.json"]) copyFile(path.join(source, "infra/seaweed", name), path.join(directory, "infra/seaweed", name));
  makeDirectory(path.join(directory, "infra/seaweed-image"));
  copyFile(path.join(source, "infra/seaweed-image/base-config.json"), path.join(directory, "infra/seaweed-image/base-config.json"));
  for (const name of ["tests/fixtures", "tests/fixtures/seaweed-source", "tests/fixtures/seaweed-source/upstream"]) makeDirectory(path.join(directory, name));
  copyFile(path.join(source, "tests/fixtures/seaweed-source/upstream/go.sum"), path.join(directory, "tests/fixtures/seaweed-source/upstream/go.sum"));
  const cleanup = () => {
    // Only this helper's exact creations can be removed; a substituted leaf is retained.
    for (const [file, expected] of created) {
      const s = fs.lstatSync(file, { bigint: true });
      assert.ok(!s.isSymbolicLink() && s.dev === expected.dev && s.ino === expected.ino && s.uid === expected.uid
        && s.gid === expected.gid && s.mode === expected.mode && s.isDirectory() === expected.directory);
      if (s.isDirectory()) assert.deepEqual(fs.readdirSync(file).sort(), [...created.keys()].filter((p) => path.dirname(p) === file).map((p) => path.basename(p)).sort());
      else assert.equal(s.nlink, 1n);
    }
    for (const [file, expected] of [...created].reverse()) {
      if (expected.directory) fs.rmdirSync(file); else fs.unlinkSync(file);
    }
  };
  return { directory, cleanup };
}
const phaseNames = ["managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
  "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias", "private_docker_save",
  "full_archive_validation", "private_archive_callback", "owned_docker_cleanup", "owned_temporary_cleanup"];
function git(workspace, args) {
  const r = spawnSync("/usr/bin/git", args, { cwd: workspace, env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}
function reports(policy, now, timestamps = {}) {
  const stamp = (delta) => new Date(now.getTime() - delta).toISOString();
  const root = policy.audit.context.root; const remote = JSON.parse(fs.readFileSync(path.join(sourceRoot, "infra/postgres-image/candidate-remote.json")));
  const alias = `aw-postgres-gosu:${hash(Buffer.from(`${policy.audit.runId}:${policy.audit.recipeRevision}`)).slice(0, 24)}`;
  const subject = { artifactName: "/candidate/saved.tar", imageId: remote.candidate.imageId, configDigest: remote.candidate.imageId,
    archiveSha256: "2".repeat(64), tag: alias, diffIds: remote.candidate.diffIds };
  const values = { vulnerability: { Version: 2, UpdatedAt: timestamps.updated ?? stamp(3600000), DownloadedAt: stamp(1800000) },
    java: { Version: 1, UpdatedAt: "2025-01-01T00:00:00Z", DownloadedAt: stamp(1800000) } };
  const evidence = { checkedAt: now.toISOString(), maxAgeMsByDatabase: { vulnerability: 172800000, java: null },
    files: [], observed: {}, validation: "VERIFIED" };
  for (const [i, name] of ["db/trivy.db", "db/metadata.json", "java-db/trivy-java.db", "java-db/metadata.json"].entries()) {
    evidence.files.push({ path: `${root}/scanner-work/cache/${name}`, sha256: String(i).repeat(64), size: 128, cap: 1024 });
  }
  const databases = { files: evidence.files, metadata: {}, registry: [] }; const files = new Map();
  for (const [name, index] of [["vulnerability", 1], ["java", 3]]) {
    evidence.observed[name] = { value: values[name], identity: { sha256: evidence.files[index].sha256, size: 128 } };
    databases.metadata[name] = validateDatabaseMetadata(values[name], { now, database: name });
    const bytes = encode({ schemaVersion: 2, layers: [{ digest: `sha256:${String(index).repeat(64)}`, size: 4096,
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip" }] });
    files.set(`database-${name}-before-manifest.json`, bytes); files.set(`database-${name}-after-manifest.json`, bytes);
    databases.registry.push({ name, repository: `ghcr.io/aquasecurity/trivy-${name === "java" ? "java-db" : "db"}`,
      tag: name === "java" ? "1" : "2", digest: `sha256:${hash(bytes)}`, size: bytes.length, layerBytes: 4096 });
  }
  files.set("database-evidence.json", encode(evidence));
  const gosu = "github.com/tianon/gosu"; const purl = `pkg:golang/${gosu}`;
  const dependencies = ["github.com/moby/sys/user@v0.1.0", "golang.org/x/sys@v0.1.0", "stdlib@v1.26.8"];
  const report = { SchemaVersion: 2, Trivy: { Version: "0.74.0-autoworld.2" }, CreatedAt: timestamps.created ?? stamp(900000),
    ArtifactType: "container_image", ArtifactName: subject.artifactName,
    Metadata: { ImageID: subject.imageId, RepoTags: [alias], DiffIDs: subject.diffIds,
      ImageConfig: { os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: subject.diffIds } }, OS: { Family: "alpine", Name: "3.24.1" } },
    Results: [{ Target: `${subject.artifactName} (alpine 3.24.1)`, Class: "os-pkgs", Type: "alpine",
      Packages: [{ Name: "alpine-baselayout", Version: "3.7.0", Release: "r0" }, { Name: "gosu", Version: "1.19-r5" }], Vulnerabilities: [] },
    { Target: "usr/bin/gosu", Class: "lang-pkgs", Type: "gobinary", Packages: [{ Name: "github.com/moby/sys/user", Version: "v0.1.0" },
      { Name: "golang.org/x/sys", Version: "v0.1.0" }, { Name: "stdlib", Version: "v1.26.8" },
      { Name: gosu, ID: gosu, Relationship: "root", Identifier: { PURL: purl }, AnalyzedBy: "gobinary",
        Layer: { DiffID: subject.diffIds.at(-1) }, DependsOn: dependencies }], Vulnerabilities: [] }] };
  const props = (type) => [{ name: "aquasecurity:trivy:PkgType", value: type }];
  const pkg = (name, version, type) => ({ type: "library", name, version, properties: props(type),
    ...(type === "gobinary" ? { "bom-ref": `pkg:golang/${name}@${version}` } : {}) });
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.7", version: 1, metadata: { component: { type: "container", name: subject.artifactName } },
    components: [{ type: "application", name: "usr/bin/gosu", properties: [{ name: "aquasecurity:trivy:Type", value: "gobinary" }, { name: "aquasecurity:trivy:Class", value: "lang-pkgs" }] },
      pkg("alpine-baselayout", "3.7.0-r0", "alpine"), pkg("gosu", "1.19-r5", "alpine"), pkg("github.com/moby/sys/user", "v0.1.0", "gobinary"),
      pkg("golang.org/x/sys", "v0.1.0", "gobinary"), pkg("stdlib", "v1.26.8", "gobinary"),
      { type: "library", name: gosu, purl, "bom-ref": purl, properties: [...props("gobinary"), { name: "aquasecurity:trivy:PkgID", value: gosu },
        { name: "aquasecurity:trivy:LayerDiffID", value: subject.diffIds.at(-1) }] },
      { type: "operating-system", name: "alpine", version: "3.24.1", properties: [{ name: "aquasecurity:trivy:Type", value: "alpine" }, { name: "aquasecurity:trivy:Class", value: "os-pkgs" }] }],
    dependencies: [{ ref: purl, dependsOn: dependencies.map((v) => `pkg:golang/${v}`) }] };
  const evaluated = evaluateLocalPostgresGosuAudit({ vulnerabilityReport: report, cyclonedxReport: sbom, subject,
    archiveEvidence: subject, databaseEvidence: values, now });
  const candidate = { kind: "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY",
    publication: "PUBLISHED_UNADMITTED", registryWrite: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    runId: policy.audit.runId, recipeRevision: policy.audit.recipeRevision, subject: remote.subject, alias,
    remoteManifest: { digest: remote.manifest.digest, bytes: remote.manifest.bytes, state: "RAW_MANIFEST_VERIFIED", mediaType: remote.manifest.mediaType,
      config: remote.manifest.config, layers: remote.manifest.layers, baseLayerCount: 10, newLayerCount: 2 },
    engine: { state: "ENGINE_VERIFIED", docker: "28.0.4", buildx: "buildx 0.37.1", serverVersion: "28.0.4", pullResponse: "SUCCESS",
      compressedDigestVerification: "MANAGED_MOBY_PULL", compressedSizeVerification: "RECORDED_ONLY" },
    image: { imageId: subject.imageId, diffIds: subject.diffIds, platform: "linux/amd64" },
    archive: { state: "ARCHIVE_VERIFIED", imageId: subject.imageId, diffIds: subject.diffIds, archiveSha256: subject.archiveSha256, archiveBytes: 2048, saveResponse: "SUCCESS" },
    publisher: { result: "PASSED", runId: remote.publisher.runId, recipeRevision: remote.publisher.recipeRevision,
      receiptSha256: remote.publisher.receiptSha256, receiptBytes: remote.publisher.receiptBytes },
    phases: phaseNames.map((name) => ({ name, result: "PASSED", durationMs: 0 })) };
  files.set("candidate-vulnerabilities.json", encode(report)); files.set("candidate-sbom.cdx.json", encode(sbom));
  const controlNames = policy.audit.files.map((v) => v.name).filter((v) => v.startsWith("scanner-") || v.startsWith("fixture-"));
  for (const name of controlNames) files.set(name, encode(name.endsWith(".cdx.json") ? { bomFormat: "CycloneDX", components: [] } : { SchemaVersion: 2, Results: [] }));
  const id = (name) => ({ sha256: hash(files.get(name)), size: files.get(name).length });
  files.set("audit-receipt.json", encode({ kind: "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1", state: "COMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", imageExecution: "NOT_ATTEMPTED",
    runId: policy.audit.runId, recipeRevision: policy.audit.recipeRevision, phase: "COMPLETE", containerCleanup: [],
    scanner: { ...policy.audit.scanner, builds: [policy.audit.scanner.binary, policy.audit.scanner.binary] }, databases,
    subject: { ...subject, archiveBytes: 2048 }, reports: { vulnerability: id("candidate-vulnerabilities.json"), cyclonedx: id("candidate-sbom.cdx.json") },
    scannerControls: { state: "COMPLETE", reports: Object.fromEntries(controlNames.map((v) => [v, id(v)])) },
    candidate, registrySubject: remote.subject, scannerInput: "LOCAL_DOCKER_SAVE_ARCHIVE", findingCount: 0, blockerCount: 0,
    blockers: [], blockersTruncated: false, inventory: evaluated.inventory, supportStartedAt: null, supportEndsAt: null, archiveUntil: null }));
  policy.audit.files = policy.audit.files.map(({ name }) => ({ name, ...id(name) })); policy.audit.receipt = id("audit-receipt.json");
  return files;
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-audit-native-"))); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"); const workspace = path.join(root, "workspace");
  fs.mkdirSync(source, { mode: 0o700 }); fs.mkdirSync(workspace, { mode: 0o700 }); fs.mkdirSync(path.join(workspace, "infra/postgres-image"), { recursive: true });
  const policy = JSON.parse(fs.readFileSync(path.join(sourceRoot, "infra/postgres-image/candidate-runtime.json")));
  const files = reports(policy, new Date()); for (const [name, bytes] of files) write(path.join(source, name), bytes);
  for (const name of ["candidate-remote.json", "lock.json", "Dockerfile", "candidate-publication-receipt.json"]) {
    write(path.join(workspace, "infra/postgres-image", name), fs.readFileSync(path.join(sourceRoot, "infra/postgres-image", name)));
  }
  write(path.join(workspace, "infra/postgres-image/candidate-runtime.json"), encode(policy));
  git(workspace, ["init", "--quiet"]); git(workspace, ["add", "infra"]);
  git(workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "synthetic audit fixture"]);
  return { source, target: path.join(root, "stage"), policy, workspace, deadline: deadline(), root };
}
const native = process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000;
if (native) {
  test("default preflight is read-only and validates originals without establishing a separate copy", (t) => {
    const item = fixture(t);
    const before = sealPostgresRuntimeAuditStage({ ...item, directory: item.source });
    const siblings = fs.readdirSync(item.root).sort();
    const summary = preflightLocalPostgresRuntimeAudit(item);
    assert.deepEqual(Object.keys(summary).sort(), ["auditReceiptSha256", "checkedAt", "validUntil"].sort());
    assert.equal(summary.auditReceiptSha256, item.policy.audit.receipt.sha256);
    assert.ok(Date.parse(summary.validUntil) > Date.parse(summary.checkedAt));
    assert.deepEqual(fs.readdirSync(item.root).sort(), siblings); assert.equal(fs.existsSync(item.target), false);
    assert.deepEqual(sealPostgresRuntimeAuditStage({ ...item, directory: item.source }, before), before);
    assert.throws(() => replayLocalPostgresRuntimeAudit(before, item), /audit_stage_invalid/u);
    fs.appendFileSync(path.join(item.source, "database-evidence.json"), " ");
    assert.throws(() => preflightLocalPostgresRuntimeAudit(item));
    assert.equal(fs.existsSync(item.target), false);
  });
  test("native private stage and real default replay produce only closed currentness ACK", (t) => {
    const item = fixture(t); const proof = stagePostgresRuntimeAudit(item);
    assert.equal(Object.isFrozen(proof.files[0].target), true);
    assert.deepEqual(validatePostgresRuntimeAuditStageProof(proof, item.policy), proof);
    assert.deepEqual(sealPostgresRuntimeAuditStage({ ...item, directory: item.target }, proof), proof);
    const ack = replayLocalPostgresRuntimeAudit(proof, item);
    assert.deepEqual(Object.keys(ack).sort(), ["auditReceiptSha256", "checkedAt", "validUntil"].sort());
    assert.equal(ack.auditReceiptSha256, item.policy.audit.receipt.sha256);
    assert.ok(Date.parse(ack.validUntil) > Date.parse(ack.checkedAt)); assert.ok(!JSON.stringify(ack).includes("observed"));
  });
  for (const mutation of ["symlink", "hardlink", "mode", "bytes", "replace", "extra", "directory", "setuid-file", "setuid-directory"]) {
    test(`native seal refuses ${mutation} substitution and preserves both private directories`, (t) => {
      const item = fixture(t); const proof = stagePostgresRuntimeAudit(item); const name = path.join(item.target, "audit-receipt.json");
      if (mutation === "symlink") { fs.unlinkSync(name); fs.symlinkSync(path.join(item.source, "audit-receipt.json"), name); }
      if (mutation === "hardlink") fs.linkSync(name, path.join(item.root, "extra-link"));
      if (mutation === "mode") fs.chmodSync(name, 0o644);
      if (mutation === "bytes") fs.appendFileSync(name, " ");
      if (mutation === "replace") { const bytes = fs.readFileSync(name); fs.unlinkSync(name); write(name, bytes); }
      if (mutation === "extra") write(path.join(item.target, "extra.json"), encode({}));
      if (mutation === "directory") fs.chmodSync(item.target, 0o755);
      if (mutation === "setuid-file") fs.chmodSync(name, 0o4600);
      if (mutation === "setuid-directory") fs.chmodSync(item.target, 0o4700);
      assert.throws(() => sealPostgresRuntimeAuditStage({ ...item, directory: item.target }, proof), /^Error: postgres_runtime_restore_audit_/u);
      assert.ok(fs.existsSync(item.source)); assert.ok(fs.existsSync(item.target));
    });
  }
  test("partial stage failure retains copied files and never changes originals", (t) => {
    const item = fixture(t); const original = fs.readFileSync(path.join(item.source, "audit-receipt.json"));
    fs.chmodSync(path.join(item.source, "candidate-sbom.cdx.json"), 0o644);
    assert.throws(() => stagePostgresRuntimeAudit(item));
    assert.deepEqual(fs.readFileSync(path.join(item.target, "audit-receipt.json")), original);
    assert.deepEqual(fs.readFileSync(path.join(item.source, "audit-receipt.json")), original);
  });
  test("preexisting destination is preserved without overwriting any file", (t) => {
    const item = fixture(t); fs.mkdirSync(item.target, { mode: 0o700 });
    const file = path.join(item.target, "retained-private.json"); const bytes = encode({ retained: true }); write(file, bytes);
    assert.throws(() => stagePostgresRuntimeAudit(item));
    assert.deepEqual(fs.readFileSync(file), bytes); assert.deepEqual(fs.readdirSync(item.target), ["retained-private.json"]);
  });
  test("real Git rejects changed source and committed mismatch without exposing source bytes", (t) => {
    const item = fixture(t); fs.appendFileSync(path.join(item.workspace, "infra/postgres-image/Dockerfile"), "\n# private text\n");
    assert.throws(() => stagePostgresRuntimeAudit(item), (error) => error.message === "postgres_runtime_restore_audit_source_uncommitted" && Object.keys(error).length === 0);
    assert.equal(fs.existsSync(item.target), false);
  });
  for (const kind of ["file", "directory"]) {
    test(`source Git ${kind} refuses native special permission bits`, (t) => {
      const item = fixture(t);
      fs.chmodSync(kind === "file" ? path.join(item.workspace, "infra/postgres-image/Dockerfile") : item.workspace,
        kind === "file" ? 0o4600 : 0o4700);
      assert.throws(() => stagePostgresRuntimeAudit(item), /audit_(?:file|directory)_invalid/u);
      assert.equal(fs.existsSync(item.target), false);
    });
  }
  test("source substitution after staging cannot pass replay", (t) => {
    const item = fixture(t); const proof = stagePostgresRuntimeAudit(item);
    fs.appendFileSync(path.join(item.source, "database-evidence.json"), " ");
    assert.throws(() => replayLocalPostgresRuntimeAudit(proof, item));
  });
  test("native FD mutation during copy fails closed and retains its partial stage", (t) => {
    const item = fixture(t); const nativeWrite = fs.writeSync; let changed = false;
    t.mock.method(fs, "writeSync", (...args) => {
      const result = nativeWrite(...args);
      if (!changed) { changed = true; fs.appendFileSync(path.join(item.source, "audit-receipt.json"), " "); }
      return result;
    }); syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    assert.throws(() => stagePostgresRuntimeAudit(item), /audit_file_/u); assert.ok(fs.existsSync(item.target));
  });
  test("FD-close uncertainty takes precedence and never leaks the native failure", (t) => {
    const item = fixture(t); const nativeClose = fs.closeSync;
    t.mock.method(fs, "closeSync", (fd) => { nativeClose(fd); throw new Error("github_pat_private_raw_failure"); });
    syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    assert.throws(() => stagePostgresRuntimeAudit(item), (error) => error.message === "postgres_runtime_restore_audit_cleanup_uncertain" && Object.keys(error).length === 0);
  });
  test("native Git failure and private throwing getters become closed errors", (t) => {
    const item = fixture(t); fs.renameSync(path.join(item.workspace, ".git"), path.join(item.workspace, "git-retained"));
    assert.throws(() => stagePostgresRuntimeAudit(item), (e) => e.message === "postgres_runtime_restore_audit_source_uncommitted" && Object.keys(e).length === 0);
    fs.renameSync(path.join(item.workspace, "git-retained"), path.join(item.workspace, ".git"));
    const policy = { ...item.policy, get kind() { throw new Error("github_pat_private_failure"); } };
    assert.throws(() => stagePostgresRuntimeAudit({ ...item, policy }), (e) => e.message === "postgres_runtime_restore_audit_failed" && Object.keys(e).length === 0);
  });
  test("default replay refuses a rehashed incomplete native audit receipt", (t) => {
    const item = fixture(t); const name = path.join(item.source, "audit-receipt.json"); const value = JSON.parse(fs.readFileSync(name));
    value.state = "INCOMPLETE"; const bytes = encode(value); write(name, bytes);
    item.policy.audit.receipt = { sha256: hash(bytes), size: bytes.length };
    item.policy.audit.files = item.policy.audit.files.map((file) => file.name === "audit-receipt.json" ? { name: file.name, ...item.policy.audit.receipt } : file);
    write(path.join(item.workspace, "infra/postgres-image/candidate-runtime.json"), encode(item.policy));
    git(item.workspace, ["add", "infra"]); git(item.workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "incomplete fixture"]);
    const proof = stagePostgresRuntimeAudit(item);
    assert.throws(() => replayLocalPostgresRuntimeAudit(proof, item), /audit_replay_failed/u);
    assert.throws(() => preflightLocalPostgresRuntimeAudit(item), /audit_replay_failed/u);
    assert.ok(fs.existsSync(name)); assert.ok(fs.existsSync(path.join(item.target, "audit-receipt.json")));
  });
  test("closed proof rejects forged identity types, owners, links, sizes and extra fields", (t) => {
    const item = fixture(t); const proof = stagePostgresRuntimeAudit(item);
    for (const mutate of [(v) => { v.extra = true; }, (v) => { v.directory.uid = 0; }, (v) => { v.directory.gid = 1001; },
      (v) => { v.directory.mode = 0o755; }, (v) => { v.sourceDirectory.ino = [v.sourceDirectory.ino]; },
      (v) => { v.directory.ctimeNs = -1; }, (v) => { v.directory.nlink = 3; }, (v) => { v.target = "/tmp/../foreign"; },
      (v) => { v.files[0].source.gid = 1001; }, (v) => { v.files[0].target.dev = [v.files[0].target.dev]; },
      (v) => { v.files[0].target.nlink = 2; }, (v) => { v.files[0].target.size++; },
      (v) => { v.files[0].name = "../foreign"; }, (v) => { v.files[0].sha256 = "a".repeat(64); },
      (v) => { v.sourceIdentities.policy.extra = "private"; }, (v) => { v.sourceIdentities.lock.sha256 = 42; },
      (v) => { v.sourceIdentities.policy.size = 0; }, (v) => { v.files.pop(); }]) {
      const value = clone(proof); mutate(value);
      assert.throws(() => validatePostgresRuntimeAuditStageProof(value, item.policy), (e) => ["postgres_runtime_restore_audit_stage_invalid", "postgres_runtime_restore_audit_path_invalid"].includes(e.message) && Object.keys(e).length === 0);
    }
  });
  test("malformed or standalone seals and expired operation cannot authorize replay", (t) => {
    const item = fixture(t); const proof = stagePostgresRuntimeAudit(item);
    const standalone = sealPostgresRuntimeAuditStage({ ...item, directory: item.target });
    assert.throws(() => replayLocalPostgresRuntimeAudit(standalone, item));
    assert.throws(() => replayLocalPostgresRuntimeAudit({ ...proof, extra: true }, item));
    assert.throws(() => replayLocalPostgresRuntimeAudit(proof, { ...item, deadline: Date.now() - 1 }));
  });
} else {
  test("native audit fixtures run under actual Linux UID/GID1000", { skip: process.platform !== "linux" }, () => {
    if (process.getuid() === 0) {
      const protectedSource = privateSuiteCopy(sourceRoot, 0); let bootstrap;
      try {
        const args = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
        const refused = spawnSync("/usr/bin/setpriv", [...args, process.execPath, "--test", path.join(protectedSource.directory, "tests/postgres-runtime-restore-audit.test.mjs")],
          { cwd: "/", env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld" }, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
        assert.equal(refused.error, undefined); assert.notEqual(refused.status, 0);
        bootstrap = privateSuiteCopy(protectedSource.directory, 1000);
        const result = spawnSync("/usr/bin/setpriv", [...args, process.execPath, "--test", path.join(bootstrap.directory, "tests/postgres-runtime-restore-audit.test.mjs")],
          { cwd: bootstrap.directory, env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, encoding: "utf8", timeout: 90000, maxBuffer: 1048576 });
        assert.equal(result.status, 0, `${result.error?.code ?? ""}\n${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /# fail 0/u); assert.match(result.stdout, /# skipped 0/u);
      } finally { bootstrap?.cleanup(); protectedSource.cleanup(); }
      return;
    }
    const args = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--",
      process.execPath, "--test", fileURLToPath(import.meta.url)];
    const result = spawnSync(process.getuid() === 0 ? "/usr/bin/setpriv" : "/usr/bin/sudo",
      process.getuid() === 0 ? args : ["-n", process.execPath, "--test", fileURLToPath(import.meta.url)], { cwd: sourceRoot,
        env: { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, encoding: "utf8", timeout: 90000, maxBuffer: 1048576 });
    assert.equal(result.status, 0, `${result.error?.code ?? ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# fail 0/u); assert.match(result.stdout, /# skipped 0/u);
  });
}
if (process.platform === "linux" && process.getuid() === 0 && process.getgid() === 0) {
  test("native root stages only owned fixture creations and refuses actual foreign GID", (t) => {
    const item = fixture(t);
    const own = (file) => {
      fs.chownSync(file, 1000, 1000);
      if (fs.lstatSync(file).isDirectory()) for (const name of fs.readdirSync(file)) own(path.join(file, name));
    };
    own(item.root);
    assert.equal(preflightLocalPostgresRuntimeAudit(item).auditReceiptSha256, item.policy.audit.receipt.sha256);
    assert.equal(fs.existsSync(item.target), false);
    const proof = stagePostgresRuntimeAudit(item); const file = path.join(item.target, "audit-receipt.json");
    assert.deepEqual(sealPostgresRuntimeAuditStage({ ...item, directory: item.target }, proof), proof);
    assert.equal(replayLocalPostgresRuntimeAudit(proof, item).auditReceiptSha256, item.policy.audit.receipt.sha256);
    fs.chownSync(file, 1000, 1001);
    assert.throws(() => sealPostgresRuntimeAuditStage({ ...item, directory: item.target }, proof), /audit_file_invalid/u);
    assert.equal(fs.existsSync(file), true);
  });
}
test("currentness deadline applies only vulnerability/report TTL, with strict ms boundary and Java age waiver", () => {
  const now = new Date("2026-09-30T12:00:00.123Z");
  const evidence = { observed: { vulnerability: { value: { Version: 2, UpdatedAt: "2026-09-30T01:15:45.849462612Z", DownloadedAt: "2026-09-30T02:00:00Z" } },
    java: { value: { Version: 1, UpdatedAt: "2025-01-01T00:00:00Z", DownloadedAt: "2026-09-30T02:00:00Z" } } } };
  const report = { CreatedAt: "2026-09-30T03:00:00Z" };
  assert.equal(postgresRuntimeAuditValidUntil(evidence, report, now), "2026-10-02T01:15:45.849Z");
  assert.equal(postgresRuntimeAuditValidUntil(evidence, report, new Date("2026-10-02T01:15:45.848Z")), "2026-10-02T01:15:45.849Z");
  assert.throws(() => postgresRuntimeAuditValidUntil(evidence, report, new Date("2026-10-02T01:15:45.849Z")), /audit_expired/u);
  for (const change of ["future", "order", "version", "stale", "reportFuture", "invalidCalendar", "reportBeforeDb"]) {
    const v = clone(evidence); const r = clone(report);
    if (change === "future") v.observed.java.value.DownloadedAt = "2026-10-01T00:00:00Z";
    if (change === "order") v.observed.vulnerability.value.UpdatedAt = "2026-09-30T04:00:00Z";
    if (change === "version") v.observed.vulnerability.value.Version = 1;
    if (change === "stale") v.observed.vulnerability.value.UpdatedAt = "2026-09-27T00:00:00Z";
    if (change === "reportFuture") r.CreatedAt = "2026-10-01T00:00:00Z";
    if (change === "invalidCalendar") r.CreatedAt = "2026-02-30T00:00:00Z";
    if (change === "reportBeforeDb") r.CreatedAt = "2026-09-30T01:30:00Z";
    assert.throws(() => postgresRuntimeAuditValidUntil(v, r, now), /audit_expired/u);
  }
});
