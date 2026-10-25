import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPostgresPrivateEvidenceSourceBundle, inspectPostgresPrivateEvidenceSource,
  validatePostgresPrivateEvidenceSourceBundle, validatePostgresPrivateEvidenceSourceBundleProof } from "../scripts/postgres-image/private-evidence-source-bundle.mjs";

const ROLES = ["head", "publication", "audit", "runtime", "retention", "copy", "cold", "sql"];
const hash = (v) => createHash("sha256").update(v).digest("hex");
const clone = (v) => globalThis.structuredClone(v);
const native = process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000;
const ENV = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_ALLOW_PROTOCOL: "file" };
function actualGitVersion() {
  const binary = fs.lstatSync("/usr/bin/git");
  assert.equal(binary.isFile(), true); assert.equal(binary.isSymbolicLink(), false);
  assert.equal(fs.realpathSync("/usr/bin/git"), "/usr/bin/git");
  assert.equal(binary.uid, 0); assert.equal(binary.gid, 0); assert.equal(binary.nlink, 1); assert.equal(binary.mode & 0o7022, 0);
  const r = spawnSync("/usr/bin/git", ["--version"], { cwd: "/", env: ENV, encoding: "utf8", timeout: 10000, maxBuffer: 1024 });
  assert.equal(r.error, undefined); assert.equal(r.status, 0); assert.equal(r.signal, null); assert.equal(r.stderr, "");
  assert.match(r.stdout, /^git version [0-9]+\.[0-9]+\.[0-9]+\n$/u); return r.stdout.trim();
}
function assertNativeResult(r) {
  assert.equal(r.status, 0, `${r.error?.code ?? ""}\n${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /# fail 0/u);
  const installed = actualGitVersion(); const expectedSkips = installed === "git version 2.43.0" ? 0 : 1;
  assert.ok(r.stdout.includes(`# skipped ${expectedSkips}\n`));
  if (expectedSkips === 1) {
    assert.match(r.stdout, /ok [0-9]+ - actual unsupported Git rejects valid source inspection and creation before producing a bundle/u);
    assert.ok(r.stdout.includes(`# SKIP installed ${installed}; positive native fixtures require the production Git 2.43.0 pin`));
  }
}
function git(workspace, args, input) {
  const r = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture",
    "-c", "user.email=fixture@example.invalid", ...args], { cwd: workspace, env: ENV, input, encoding: null, timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stderr.toString()); return r.stdout;
}
function fixtures(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-source-bundle-fixture-"))); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace"); const directory = path.join(root, "source");
  fs.mkdirSync(workspace, { mode: 0o700 }); fs.mkdirSync(directory, { mode: 0o700 });
  const empty = path.join(root, "empty"); fs.mkdirSync(empty, { mode: 0o700 });
  git(workspace, ["init", "--quiet", `--template=${empty}`, "--initial-branch=main"]);
  const blobPins = []; const commits = {};
  for (const role of ROLES) {
    const bytes = Buffer.from(`FROM scratch\n# harmless ${role} fixture\n`);
    const blob = git(workspace, ["hash-object", "-w", "--stdin"], bytes).toString().trim();
    const tree = git(workspace, ["mktree"], Buffer.from(`100644 blob ${blob}\tDockerfile\n`)).toString().trim();
    const commit = git(workspace, ["commit-tree", tree, "-m", `harmless ${role}`]).toString().trim();
    commits[role] = commit; blobPins.push({ recipeRevision: commit, path: "Dockerfile", size: bytes.length, sha256: hash(bytes) });
    if (role === "head") { fs.writeFileSync(path.join(workspace, "Dockerfile"), bytes, { mode: 0o600 }); }
  }
  git(workspace, ["update-ref", "refs/heads/main", commits.head]); git(workspace, ["read-tree", commits.head]);
  return { root, workspace, directory, commits, input: { workspace, directory, recipeRevision: commits.head,
    recipes: Object.fromEntries(ROLES.slice(1).map((role) => [role, commits[role]])), blobPins, deadline: Date.now() + 120000 } };
}
function synthetic() {
  const commits = Object.fromEntries(ROLES.map((role, i) => [role, String(i + 1).repeat(40)]));
  const input = { workspace: "/home/fixture/workspace", directory: "/home/fixture/source", recipeRevision: commits.head,
    recipes: Object.fromEntries(ROLES.slice(1).map((role) => [role, commits[role]])),
    blobPins: ROLES.map((role) => ({ recipeRevision: commits[role], path: "Dockerfile", sha256: "a".repeat(64), size: 32 })), deadline: Date.now() + 120000 };
  const meta = (ino, size, mode, nlink) => ({ dev: "1", ino: String(ino), uid: 1000, gid: 1000, mode, nlink, size, mtimeNs: "1", ctimeNs: "1" });
  const proof = { kind: "POSTGRES_PRIVATE_EVIDENCE_SOURCE_BUNDLE_V1", state: "VERIFIED", recipeRevision: commits.head,
    source: { head: commits.head, workspace: input.workspace, gitDirectory: `${input.workspace}/.git`, commonDirectory: `${input.workspace}/.git`,
      workspaceIdentity: meta(1, 4096, 0o700, 3), gitDirectoryIdentity: meta(2, 4096, 0o700, 3), commonDirectoryIdentity: meta(2, 4096, 0o700, 3),
      refsSha256: "b".repeat(64), files: [{ path: "Dockerfile", size: 32, sha256: "a".repeat(64), identity: meta(3, 32, 0o600, 1) }] },
    file: { name: "recipes.bundle", size: 2048, sha256: "c".repeat(64), identity: meta(4, 2048, 0o600, 1) },
    refs: ROLES.map((role) => ({ name: `refs/archive/${role}`, commit: commits[role] })),
    blobs: input.blobPins.map((pin) => ({ ...pin, blob: "d".repeat(40) })), zeroPrerequisites: true,
    packVerification: "OFFLINE_FULL_FSCK", sourceUnchanged: true, auxiliaryCleanup: "REMOVED" };
  return { input, proof };
}
test("pure closed proof binds all eight independent recipes and every byte pin", () => {
  const { input, proof } = synthetic(); const verified = validatePostgresPrivateEvidenceSourceBundleProof(proof, input);
  assert.deepEqual(verified, proof); assert.equal(Object.isFrozen(verified.source.files[0].identity), true);
  for (const change of [(v) => { v.extra = true; }, (v) => { v.refs.pop(); }, (v) => { v.refs[1].commit = input.recipeRevision; },
    (v) => { v.blobs[1].sha256 = "f".repeat(64); }, (v) => { v.file.identity.nlink = 2; }, (v) => { v.file.identity.mode = 0o644; },
    (v) => { v.source.commonDirectory = "/foreign"; }, (v) => { v.source.files[0].identity.uid = 0; },
    (v) => { v.zeroPrerequisites = false; }, (v) => { v.auxiliaryCleanup = "UNCERTAIN"; },
    (v) => { v.file.size = "2048"; }, (v) => { v.blobs[0].blob = { toString() { throw new Error(); } }; }]) {
    const value = clone(proof); change(value);
    assert.throws(() => validatePostgresPrivateEvidenceSourceBundleProof(value, input), /^Error: postgres_private_evidence_source_bundle_proof_invalid$/u);
  }
});
test("typed arguments, all recipe pins and actual Linux actor are mandatory before creation", async () => {
  const { input, proof } = synthetic();
  for (const change of [(v) => { v.blobPins.pop(); }, (v) => { v.recipes.sql = v.recipeRevision; },
    (v) => { v.blobPins[0].path = "../Dockerfile"; }, (v) => { v.blobPins[0].size = "32"; },
    (v) => { v.recipeRevision = { toString() { return "a".repeat(40); } }; }]) {
    const value = clone(input); change(value);
    assert.throws(() => validatePostgresPrivateEvidenceSourceBundleProof(proof, value));
    await assert.rejects(createPostgresPrivateEvidenceSourceBundle(value));
  }
  if (!native) await assert.rejects(createPostgresPrivateEvidenceSourceBundle(input), /context_invalid/u);
});

if (native && actualGitVersion() === "git version 2.43.0") {
  test("default Git creates a full offline bundle of seven nonancestor recipes and replays it without source mutation", async (t) => {
    const f = fixtures(t); const before = await inspectPostgresPrivateEvidenceSource({ workspace: f.workspace, deadline: f.input.deadline });
    for (const role of ROLES.slice(1)) {
      const r = spawnSync("/usr/bin/git", ["merge-base", "--is-ancestor", f.commits[role], f.commits.head], { cwd: f.workspace, env: ENV }); assert.equal(r.status, 1);
    }
    const siblings = fs.readdirSync(f.root).sort(); const proof = await createPostgresPrivateEvidenceSourceBundle(f.input);
    assert.deepEqual(fs.readdirSync(f.root).sort(), siblings); assert.deepEqual(fs.readdirSync(f.directory), ["recipes.bundle"]);
    assert.equal(proof.refs.length, 8); assert.equal(proof.blobs.length, 8); assert.equal(proof.file.identity.mode, 0o600);
    assert.equal(hash(fs.readFileSync(path.join(f.directory, "recipes.bundle"))), proof.file.sha256);
    assert.deepEqual(await validatePostgresPrivateEvidenceSourceBundle(proof, f.input), proof);
    assert.deepEqual(await inspectPostgresPrivateEvidenceSource({ workspace: f.workspace, deadline: f.input.deadline }), before);
  });
  test("native HEAD closure accepts the exact public Alpine key filename containing @", async (t) => {
    const f = fixtures(t); const name = "alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub"; const bytes = Buffer.from("harmless public key fixture\n");
    fs.writeFileSync(path.join(f.workspace, name), bytes, { mode: 0o600 }); git(f.workspace, ["add", "--", name]);
    git(f.workspace, ["commit", "--quiet", "--amend", "--no-edit"]);
    const revision = git(f.workspace, ["rev-parse", "HEAD"]).toString().trim();
    f.input.blobPins[0].recipeRevision = revision; f.input.recipeRevision = revision;
    f.input.blobPins.push({ recipeRevision: revision, path: name, size: bytes.length, sha256: hash(bytes) });
    const proof = await createPostgresPrivateEvidenceSourceBundle(f.input);
    assert.equal(proof.blobs.at(-1).path, name); assert.deepEqual(await validatePostgresPrivateEvidenceSourceBundle(proof, f.input), proof);
  });
  test("native configured clean filter is rejected before any worktree command can execute it", async (t) => {
    const f = fixtures(t); const marker = path.join(f.root, "filter-executed"); const file = path.join(f.workspace, "Dockerfile");
    git(f.workspace, ["config", "filter.fixture.clean", `printf harmless > '${marker}'; cat`]);
    fs.mkdirSync(path.join(f.workspace, ".git/info"), { mode: 0o700 });
    fs.writeFileSync(path.join(f.workspace, ".git/info/attributes"), "Dockerfile filter=fixture\n", { mode: 0o600 });
    git(f.workspace, ["read-tree", f.commits.head]); fs.writeFileSync(file, fs.readFileSync(file));
    assert.equal(fs.existsSync(marker), false);
    const expected = /^Error: postgres_private_evidence_source_bundle_source_invalid$/u;
    await assert.rejects(inspectPostgresPrivateEvidenceSource({ workspace: f.workspace, deadline: f.input.deadline }), expected);
    await assert.rejects(createPostgresPrivateEvidenceSourceBundle(f.input), expected);
    assert.equal(fs.existsSync(marker), false); assert.deepEqual(fs.readdirSync(f.directory), []);
    assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith(".postgres-source-bundle-work-")), false);
  });
  for (const kind of ["shallow", "partial", "promisor", "alternates", "replace", "grafts", "includes", "linked", "unsafe-config", "dirty", "unexpected-output", "wrong-mode", "objects-alias", "dangling-shallow"]) {
    test(`native source preflight rejects ${kind} before producing a bundle`, async (t) => {
      const f = fixtures(t); const gitDir = path.join(f.workspace, ".git");
      if (kind === "shallow") fs.writeFileSync(path.join(gitDir, "shallow"), `${f.commits.head}\n`, { mode: 0o600 });
      if (kind === "partial") git(f.workspace, ["config", "extensions.partialClone", "origin"]);
      if (kind === "promisor") fs.writeFileSync(path.join(gitDir, "objects/pack", "pack-fixture.promisor"), "", { mode: 0o600 });
      if (kind === "alternates") fs.writeFileSync(path.join(gitDir, "objects/info/alternates"), "/foreign\n", { mode: 0o600 });
      if (kind === "replace") { fs.mkdirSync(path.join(gitDir, "refs/replace")); fs.writeFileSync(path.join(gitDir, "refs/replace", f.commits.head), `${f.commits.sql}\n`, { mode: 0o600 }); }
      if (kind === "grafts") { fs.mkdirSync(path.join(gitDir, "info")); fs.writeFileSync(path.join(gitDir, "info/grafts"), "", { mode: 0o600 }); }
      if (kind === "includes") fs.appendFileSync(path.join(gitDir, "config"), "\n[include]\n path = /foreign\n");
      if (kind === "linked") fs.writeFileSync(path.join(gitDir, "commondir"), "../foreign\n", { mode: 0o600 });
      if (kind === "unsafe-config") fs.chmodSync(path.join(gitDir, "config"), 0o666);
      if (kind === "dirty") fs.appendFileSync(path.join(f.workspace, "Dockerfile"), "# changed\n");
      if (kind === "unexpected-output") fs.writeFileSync(path.join(f.directory, "foreign"), "x", { mode: 0o600 });
      if (kind === "wrong-mode") fs.chmodSync(f.directory, 0o755);
      if (kind === "objects-alias") { fs.renameSync(path.join(gitDir, "objects"), path.join(gitDir, "objects.original")); fs.symlinkSync("objects.original", path.join(gitDir, "objects")); }
      if (kind === "dangling-shallow") fs.symlinkSync("/nonexistent-source-bundle-fixture", path.join(gitDir, "shallow"));
      await assert.rejects(createPostgresPrivateEvidenceSourceBundle(f.input), /^Error: postgres_private_evidence_source_bundle_[a-z_]+$/u);
      assert.equal(fs.existsSync(path.join(f.directory, "recipes.bundle")), false);
      assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith(".postgres-source-bundle-work-")), false);
    });
  }
  for (const kind of ["symlink", "hardlink", "mode", "inode", "bytes", "extra"]) {
    test(`full native replay refuses ${kind} substitution and retains private evidence`, async (t) => {
      const f = fixtures(t); const proof = await createPostgresPrivateEvidenceSourceBundle(f.input); const file = path.join(f.directory, "recipes.bundle");
      if (kind === "symlink") { fs.renameSync(file, file + ".original"); fs.symlinkSync(file + ".original", file); }
      if (kind === "hardlink") fs.linkSync(file, path.join(f.root, "linked"));
      if (kind === "mode") fs.chmodSync(file, 0o644);
      if (kind === "inode") { const b = fs.readFileSync(file); fs.renameSync(file, file + ".original"); fs.writeFileSync(file, b, { mode: 0o600 }); }
      if (kind === "bytes") fs.appendFileSync(file, "x");
      if (kind === "extra") fs.writeFileSync(path.join(f.directory, "foreign"), "x", { mode: 0o600 });
      await assert.rejects(validatePostgresPrivateEvidenceSourceBundle(proof, f.input)); assert.ok(fs.existsSync(file));
    });
  }
  for (const kind of ["thin", "corrupt", "missing-blob", "changed-head", "changed-metadata", "process-failure", "abort", "foreign-cleanup", "capacity"]) {
    test(`native generation ${kind} failure cannot publish success or delete retained state`, async (t) => {
      const f = fixtures(t); const controller = new globalThis.AbortController(); f.input.signal = controller.signal; let acted = false;
      if (kind === "missing-blob") f.input.blobPins[1].sha256 = "f".repeat(64);
      const deps = { commandRunner: async (request, real) => {
        if (kind === "process-failure" && request.args.includes("create")) return { status: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from("private raw error"), closed: true };
        const result = await real(request);
        if (!acted && request.args.includes("create")) {
          acted = true;
          if (kind === "thin") fs.writeSync(request.stdoutFd, Buffer.from(`# v2 git bundle\n-${f.commits.head} prerequisite\n\n`), 0, undefined, 0);
          if (kind === "corrupt") { const file = path.join(f.directory, "recipes.bundle"); const b = fs.readFileSync(file); const offset = b.indexOf("\n\n") + 6; fs.writeSync(request.stdoutFd, Buffer.from([b[offset] ^ 255]), 0, 1, offset); }
          if (kind === "changed-head") git(f.workspace, ["update-ref", "refs/heads/main", f.commits.sql]);
          if (kind === "changed-metadata") fs.chmodSync(path.join(f.workspace, "Dockerfile"), 0o644);
          if (kind === "abort") controller.abort();
          if (kind === "foreign-cleanup") fs.writeFileSync(path.join(request.cwd, "foreign"), "preserve", { mode: 0o600 });
          if (kind === "capacity") { const fd = fs.openSync(path.join(request.cwd, "collect.git", "oversize"), "wx", 0o600); fs.ftruncateSync(fd, 512 * 1024 * 1024 + 1); fs.closeSync(fd); }
        }
        return result;
      } };
      await assert.rejects(createPostgresPrivateEvidenceSourceBundle(f.input, deps), (e) => /^postgres_private_evidence_source_bundle_[a-z_]+$/u.test(e.message) && !e.message.includes("private raw error"));
      const retained = fs.readdirSync(f.root).filter((name) => name.startsWith(".postgres-source-bundle-work-")); assert.equal(retained.length, 1);
      if (kind === "foreign-cleanup") assert.equal(fs.readFileSync(path.join(f.root, retained[0], "foreign"), "utf8"), "preserve");
    });
  }
  test("missing recipe, pinned blob and expired/aborted operation fail closed", async (t) => {
    for (const kind of ["recipe", "blob", "deadline", "abort"]) await t.test(kind, async (sub) => {
      const f = fixtures(sub);
      if (kind === "recipe") { f.input.recipes.sql = "f".repeat(40); f.input.blobPins[7].recipeRevision = "f".repeat(40); }
      if (kind === "blob") f.input.blobPins[1].path = "missing.txt";
      if (kind === "deadline") f.input.deadline = Date.now() - 1;
      if (kind === "abort") { const c = new globalThis.AbortController(); c.abort(); f.input.signal = c.signal; }
      await assert.rejects(createPostgresPrivateEvidenceSourceBundle(f.input)); assert.equal(fs.existsSync(path.join(f.directory, "recipes.bundle")), kind === "blob");
    });
  });
  for (const kind of ["abort", "deadline"]) {
    test(`actual Git child ${kind} is bounded, closed and retains its failed bundle`, async (t) => {
      const f = fixtures(t); const controller = new globalThis.AbortController(); f.input.signal = controller.signal;
      let timer; const started = Date.now();
      const deps = { commandRunner: async (request, real) => {
        if (!request.args.includes("create")) return await real(request);
        if (kind === "abort") timer = setTimeout(() => controller.abort(), 50);
        return await real({ ...request, args: ["-c", "alias.fixture-wait=!sleep 30", "fixture-wait"], timeoutMs: kind === "deadline" ? 50 : request.timeoutMs });
      } };
      try { await assert.rejects(createPostgresPrivateEvidenceSourceBundle(f.input, deps), new RegExp(`^Error: postgres_private_evidence_source_bundle_${kind === "abort" ? "aborted" : "deadline_exceeded"}$`, "u")); }
      finally { if (timer) globalThis.clearTimeout(timer); }
      assert.ok(Date.now() - started < 5000); assert.ok(fs.existsSync(path.join(f.directory, "recipes.bundle")));
      assert.equal(fs.readdirSync(f.root).filter((v) => v.startsWith(".postgres-source-bundle-work-")).length, 1);
    });
  }
} else if (native) {
  const installed = actualGitVersion();
  test("actual unsupported Git rejects valid source inspection and creation before producing a bundle", async (t) => {
    assert.notEqual(installed, "git version 2.43.0"); assert.equal(process.geteuid(), 1000); assert.equal(process.getegid(), 1000);
    const f = fixtures(t);
    assert.equal(git(f.workspace, ["status", "--porcelain"]).length, 0);
    assert.equal(git(f.workspace, ["rev-parse", "HEAD"]).toString().trim(), f.input.recipeRevision);
    assert.equal(fs.lstatSync(f.workspace).mode & 0o7777, 0o700); assert.equal(fs.lstatSync(f.directory).mode & 0o7777, 0o700);
    assert.equal(fs.lstatSync(path.join(f.workspace, "Dockerfile")).uid, 1000); assert.deepEqual(fs.readdirSync(f.directory), []);
    const expected = /^Error: postgres_private_evidence_source_bundle_git_invalid$/u;
    await assert.rejects(inspectPostgresPrivateEvidenceSource({ workspace: f.workspace, deadline: f.input.deadline }), expected);
    await assert.rejects(createPostgresPrivateEvidenceSourceBundle(f.input), expected);
    assert.deepEqual(fs.readdirSync(f.directory), []);
    assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith(".postgres-source-bundle-work-")), false);
  });
  test("positive native fixtures require the pinned production Git", {
    skip: `installed ${installed}; positive native fixtures require the production Git 2.43.0 pin`,
  }, () => {});
} else {
  test("native Git fixtures run as actual Linux UID/GID1000 from a private public-module bootstrap", { skip: process.platform !== "linux" }, () => {
    if (process.getuid() !== 0) {
      const r = spawnSync("/usr/bin/sudo", ["-n", process.execPath, "--test", fileURLToPath(import.meta.url)],
        { cwd: "/", env: ENV, encoding: "utf8", timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(r.status, 0, `${r.error?.code ?? ""}\n${r.stdout}\n${r.stderr}`); assert.match(r.stdout, /# fail 0/u); assert.match(r.stdout, /# skipped 0/u);
      assert.match(r.stdout, /ok [0-9]+ - native Git fixtures run as actual Linux UID\/GID1000 from a private public-module bootstrap/u); return;
    }
    const source = fileURLToPath(new URL("../", import.meta.url)); const created = new Map();
    const copy = (owner) => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-source-bundle-bootstrap-")));
      const remember = (file, directory) => { fs.chmodSync(file, directory ? 0o700 : 0o600); fs.chownSync(file, owner, owner);
        created.set(file, { identity: fs.lstatSync(file, { bigint: true }), directory }); };
      remember(root, true);
      for (const name of ["scripts", "scripts/postgres-image", "tests"]) { const p = path.join(root, name); fs.mkdirSync(p, { mode: 0o700 }); remember(p, true); }
      for (const name of ["scripts/postgres-image/private-evidence-source-bundle.mjs", "tests/postgres-private-evidence-source-bundle.test.mjs"]) {
        const from = path.join(source, name); assert.ok(fs.lstatSync(from).isFile() && !fs.lstatSync(from).isSymbolicLink());
        const to = path.join(root, name); fs.writeFileSync(to, fs.readFileSync(from), { mode: 0o600, flag: "wx" }); remember(to, false);
      }
      return root;
    };
    const args = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
    try {
      const protectedRoot = copy(0);
      const denied = spawnSync("/usr/bin/setpriv", [...args, process.execPath, "--test", path.join(protectedRoot, "tests/postgres-private-evidence-source-bundle.test.mjs")],
        { cwd: "/", env: ENV, encoding: "utf8", timeout: 10000, maxBuffer: 65536 }); assert.notEqual(denied.status, 0);
      const root = copy(1000); const r = spawnSync("/usr/bin/setpriv", [...args, process.execPath, "--test", path.join(root, "tests/postgres-private-evidence-source-bundle.test.mjs")],
        { cwd: root, env: ENV, encoding: "utf8", timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
      assertNativeResult(r);
    } finally {
      for (const [file, e] of created) { const s = fs.lstatSync(file, { bigint: true });
        for (const key of ["dev", "ino", "uid", "gid", "mode"]) assert.equal(s[key], e.identity[key]);
        assert.equal(s.isSymbolicLink(), false); assert.equal(s.isDirectory(), e.directory);
        if (e.directory) assert.deepEqual(fs.readdirSync(file).sort(), [...created.keys()].filter((p) => path.dirname(p) === file).map((p) => path.basename(p)).sort());
        else assert.equal(s.nlink, 1n);
      }
      for (const [file, e] of [...created].reverse()) { if (e.directory) fs.rmdirSync(file); else fs.unlinkSync(file); }
    }
  });
}
