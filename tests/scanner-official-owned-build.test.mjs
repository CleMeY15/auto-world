import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildOwnedScanner,
  canonicalJson,
  createOwnedContainerRunner,
  directoryBytes,
  manifestTree,
  ownedBuildDockerArguments,
  ownedCleanupEvidence,
  ownedContainerCreateArguments,
  ownedCompilerReceipt,
  ownedFailureResult,
  removeOwnedScannerPaths,
  requiredOwnedFreeBytes,
  runOwnedFinalCleanup,
  sha256,
  validateGitArchiveListing,
  validateModuleClosure,
  validateOwnedOutput,
  validateOwnedScannerLock
} from "../scripts/scanner/owned-build.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCK_PATH = path.join(ROOT, "infra/scanner/owned-scanner-lock.json");
const PATCH_PATH = path.join(ROOT, "infra/scanner/patches/trivy-go-jose-4.1.6.patch");
const NOTICE_PATH = path.join(ROOT, "infra/scanner/AUTO-WORLD-TRIVY-NOTICE.txt");
const LOCK = JSON.parse(readFileSync(LOCK_PATH, "utf8"));

const TRIVY_SYMLINKS = [
  ["pkg/fanal/analyzer/language/golang/binary/testdata/symlink", "foo", "19102815663d23f8b75a47e7a01965dcdc96468c"],
  ["pkg/fanal/analyzer/language/rust/binary/testdata/symlink", "foo", "19102815663d23f8b75a47e7a01965dcdc96468c"],
  ["pkg/fanal/walker/testdata/fs/sym.txt", "bar", "ba0e162e1c47469e3fe4b393a8bf8c569f302116"],
];

function materializeTrivyLinkTargets(root) {
  for (const [relative, target] of TRIVY_SYMLINKS) writeFileSync(path.resolve(path.dirname(path.join(root, ...relative.split("/"))), target), "", { flag: "wx" });
}

function trivySymlinkTree(materializeTargets = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-trivy-links-"));
  try {
    writeFileSync(path.join(root, "source.txt"), "data");
    for (const [relative, target] of TRIVY_SYMLINKS) {
      const link = path.join(root, ...relative.split("/")); mkdirSync(path.dirname(link), { recursive: true }); symlinkSync(target, link, "file");
    }
    if (materializeTargets) materializeTrivyLinkTargets(root);
    return root;
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}

function removeTrivySymlinkTree(root) {
  for (const [relative, targets] of [...TRIVY_SYMLINKS.map(([item, target]) => [item, [target, "../outside"]]), ["extra-link", ["foo"]]]) {
    const link = path.join(root, ...relative.split("/"));
    for (const target of targets) {
      const materialized = path.resolve(path.dirname(link), target); mkdirSync(path.dirname(materialized), { recursive: true });
      try { writeFileSync(materialized, "", { flag: "ax" }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    }
    try { unlinkSync(link); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  rmSync(root, { recursive: true, force: true });
}

test("owned scanner lock freezes the exact derivative without altering the CLI version", () => {
  const lock = validateOwnedScannerLock(JSON.parse(JSON.stringify(LOCK)));
  assert.equal(lock.receiptKind, "auto-world-trivy-0.76.1-jose4.1.6-r1");
  assert.equal(lock.scanner.cliVersion, "0.76.1");
  assert.equal(lock.scanner.sourceCommit, "e713f67f7d54decdcd9b3132c9751833dcced698");
  assert.equal(lock.scanner.sourceTree, "2b2e1ef32745d09fbd85b9d040da722333dd4258");
  assert.equal(lock.scanner.patched.goSum.sha256, "a934abfc262a21a885c2c9b755f43397460996d67a07d1ab3fa52e8e66d94e84");
  assert.equal(lock.goJose.version, "v4.1.6");
  assert.equal(lock.goJose.sum, "h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=");
  assert.equal(lock.compiler.builder.platformDigest, "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747");
  assert.equal(lock.compiler.archive.sha256, "65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40");
  assert.deepEqual(lock.patch.changedPaths, ["go.mod", "go.sum"]);
  for (const mutate of [
    (value) => { value.compiler.builder.reference = "golang:latest"; },
    (value) => { value.patch.sha256 = "0".repeat(64); },
    (value) => { value.goJose.tree = "0".repeat(40); },
    (value) => { value.fixtures.git.commit = "0".repeat(40); },
    (value) => { value.limits.publicTotalBytes = Number.MAX_SAFE_INTEGER; },
    (value) => { value.compiler.builder.unknown = true; }
  ]) {
    const changed = JSON.parse(JSON.stringify(LOCK)); mutate(changed);
    assert.throws(() => validateOwnedScannerLock(changed), /scanner_owned_lock_invalid/u);
  }
});

test("owned patch contains exactly the three approved substitutions", () => {
  const bytes = readFileSync(PATCH_PATH);
  const patch = bytes.toString("utf8");
  assert.equal(bytes.length, LOCK.patch.bytes);
  assert.equal(sha256(bytes), LOCK.patch.sha256);
  assert.equal((patch.match(/^-/gmu) ?? []).length, 5); // two file headers plus three removed lines
  assert.equal((patch.match(/^\+/gmu) ?? []).length, 5); // two file headers plus three added lines
  assert.match(patch, /go-jose\/go-jose\/v4 v4\.1\.5 \/\/ indirect/u);
  assert.match(patch, /go-jose\/go-jose\/v4 v4\.1\.6 \/\/ indirect/u);
  assert.match(patch, /v4\.1\.6 h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=/u);
  assert.match(patch, /v4\.1\.6\/go\.mod h1:x4oUasVrzR7071A4TnHLGSPpNOm2a21K9Kf04k1rs08=/u);
  assert.doesNotMatch(patch, /grpc|x\/net|fixture-locking/u);
});

test("owned derivative notice is exact and disclaims upstream sponsorship", () => {
  const bytes = readFileSync(NOTICE_PATH);
  assert.equal(bytes.length, LOCK.notice.bytes);
  assert.equal(sha256(bytes), LOCK.notice.sha256);
  const notice = bytes.toString("utf8");
  assert.match(notice, /based on Trivy 0\.76\.1/u);
  assert.match(notice, /Aqua Security does not sponsor/u);
  assert.match(notice, /go-jose\/go-jose\/v4 from v4\.1\.5 to v4\.1\.6/u);
});

test("canonical JSON is stable across insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: [3, true] } }), '{"a":{"x":[3,true],"y":2},"z":1}');
  assert.equal(sha256(Buffer.from(`${canonicalJson({ b: 2, a: 1 })}\n`)), sha256(Buffer.from(`${canonicalJson({ a: 1, b: 2 })}\n`)));
});

test("module closure binds downloaded bytes and the compiled subset", () => {
  const material = (seed) => ({ bytes: seed, sha256: String(seed).padStart(64, "0") });
  const downloads = [
    { Path: "example.invalid/uncompiled", Version: "v1.0.0", Sum: "h1:u", GoModSum: "h1:um", ZipIdentity: material(1), ModIdentity: material(2), InfoIdentity: material(3) },
    { Path: LOCK.goJose.module, Version: LOCK.goJose.version, Sum: LOCK.goJose.sum, GoModSum: LOCK.goJose.goModSum, ZipIdentity: material(4), ModIdentity: material(5), InfoIdentity: material(6) }
  ];
  const modules = [
    { Path: "github.com/aquasecurity/trivy", Main: true },
    { Path: "example.invalid/uncompiled", Version: "v1.0.0", Sum: "h1:u", GoModSum: "h1:um" },
    { Path: LOCK.goJose.module, Version: LOCK.goJose.version, Sum: LOCK.goJose.sum, GoModSum: LOCK.goJose.goModSum }
  ];
  const closure = validateModuleClosure(downloads, modules, [LOCK.goJose.module], LOCK);
  assert.equal(closure.modules.length, 2);
  assert.equal(closure.modules.find((item) => item.path === LOCK.goJose.module).compiled, true);
  assert.equal(closure.modules.find((item) => item.path === "example.invalid/uncompiled").compiled, false);
  assert.equal(closure.sha256, sha256(Buffer.from(`${canonicalJson({ modules: closure.modules, materials: closure.materials })}\n`)));
  assert.equal(closure.materials.length, 2);
  assert.throws(() => validateModuleClosure(downloads, modules, [], LOCK), /scanner_owned_go_jose_closure_invalid/u);
  assert.throws(() => validateModuleClosure(downloads, [...modules, { Path: "example.invalid/local", Version: "v1.0.0", Replace: { Path: ".." } }], [LOCK.goJose.module], LOCK), /scanner_owned_module_closure_invalid/u);
});

test("Trivy source trees preserve only the three pinned dangling symlinks without following them", (context) => {
  let probe;
  try { probe = trivySymlinkTree(); }
  catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) { context.skip("symbolic-link creation is unavailable on this Windows host"); return; }
    throw error;
  }
  let materializeTargets = false;
  try { manifestTree(probe, 1_024, { trivySource: true }); }
  catch (error) {
    if (process.platform === "win32" && ["ENOENT", "EINVAL", "UNKNOWN"].includes(error?.code)) {
      materializeTrivyLinkTargets(probe); materializeTargets = true; manifestTree(probe, 1_024, { trivySource: true });
    } else {
      removeTrivySymlinkTree(probe); throw error;
    }
  }
  removeTrivySymlinkTree(probe);
  const withTree = (mutation, assertion) => {
    const root = trivySymlinkTree(materializeTargets);
    try { mutation?.(root); assertion(root); } finally { removeTrivySymlinkTree(root); }
  };
  withTree(null, (root) => {
    assert.equal(directoryBytes(root, 13, { trivySource: true }), 13);
    assert.throws(() => directoryBytes(root, 12, { trivySource: true }), /scanner_owned_tree_budget_exceeded/u);
    assert.throws(() => manifestTree(root, 1_024), /scanner_owned_tree_invalid/u);
    const links = manifestTree(root, 1_024, { trivySource: true }).filter((entry) => entry.type === "symlink");
    assert.deepEqual(links.map(({ path: relative, target, bytes, gitBlobSha1 }) => [relative, target, bytes, gitBlobSha1]),
      TRIVY_SYMLINKS.map(([relative, target, blob]) => [relative, target, 3, blob]));
    assert.deepEqual(links.map((entry) => entry.sha256), [sha256(Buffer.from("foo")), sha256(Buffer.from("foo")), sha256(Buffer.from("bar"))]);
  });
  withTree((root) => unlinkSync(path.join(root, ...TRIVY_SYMLINKS[0][0].split("/"))),
    (root) => assert.throws(() => manifestTree(root, 1_024, { trivySource: true }), /scanner_owned_tree_invalid/u));
  withTree((root) => { const link = path.join(root, ...TRIVY_SYMLINKS[1][0].split("/")); unlinkSync(link); writeFileSync(link, "foo"); },
    (root) => assert.throws(() => manifestTree(root, 1_024, { trivySource: true }), /scanner_owned_tree_invalid/u));
  withTree((root) => { const link = path.join(root, ...TRIVY_SYMLINKS[2][0].split("/")); unlinkSync(link); symlinkSync("../outside", link, "file");
    if (materializeTargets) writeFileSync(path.resolve(path.dirname(link), "../outside"), "", { flag: "wx" }); },
    (root) => assert.throws(() => manifestTree(root, 1_024, { trivySource: true }), /scanner_owned_tree_invalid/u));
  withTree((root) => { symlinkSync("foo", path.join(root, "extra-link"), "file"); if (materializeTargets) writeFileSync(path.join(root, "foo"), "", { flag: "wx" }); },
    (root) => assert.throws(() => manifestTree(root, 1_024, { trivySource: true }), /scanner_owned_tree_invalid/u));
  withTree(null, (root) => {
    const before = manifestTree(root, 1_024, { trivySource: true }); writeFileSync(path.join(root, "coverage.txt"), "coverage");
    const after = manifestTree(root, 1_024, { trivySource: true }); assert.notEqual(canonicalJson(before), canonicalJson(after));
  });
  withTree((root) => {
    writeFileSync(path.join(root, "Case"), "a", { flag: "wx" });
    try { writeFileSync(path.join(root, "case"), "b", { flag: "wx" }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
  }, (root) => {
    if (readdirSync(root).filter((name) => name === "Case" || name === "case").length !== 2) return;
    assert.throws(() => manifestTree(root, 1_024, { trivySource: true }), /scanner_owned_tree_invalid/u);
  });
});

test("both build paths are offline and use the same canonical output", () => {
  const base = { lock: LOCK, source: "/runner/source", moduleCache: "/runner/mod", buildCache: "/runner/cache", output: "/runner/out", user: "1001:1002" };
  const a = ownedBuildDockerArguments(base);
  const b = ownedBuildDockerArguments({ ...base, officialGoRoot: "/runner/go" });
  for (const args of [a, b]) {
    assert.deepEqual(args.slice(0, 8), ["run", "--rm", "--platform", "linux/amd64", "--user", "1001:1002", "--network", "none"]);
    assert.ok(args.includes("--cap-drop"));
    assert.ok(args.includes("ALL"));
    assert.ok(args.includes("4g"));
    assert.ok(args.includes("GOAMD64=v1"));
    assert.ok(args.includes("--pull=never"));
    assert.ok(args.includes("/runner/source:/src:ro"));
    assert.ok(args.includes("/runner/out:/out"));
    assert.match(args.at(-1), /-o \/out\/trivy/u);
    assert.match(args.at(-1), /-buildvcs=false/u);
    assert.match(args.at(-1), /app\.ver=0\.76\.1/u);
    assert.doesNotMatch(args.at(-1), /autoworld/u);
  }
  assert.equal(a.includes("/runner/go:/usr/local/go:ro"), false);
  assert.equal(b.includes("/runner/go:/usr/local/go:ro"), true);
  assert.throws(() => ownedBuildDockerArguments({ ...base, user: "root" }), /scanner_owned_container_user_invalid/u);
});

test("diagnostic receipts bind each exact compiler delivery", () => {
  assert.deepEqual(ownedCompilerReceipt(LOCK, "A"), {
    delivery: "BUILDER_IMAGE", goVersion: "go1.27.3", goos: "linux", goarch: "amd64", cgoEnabled: false,
    identity: { kind: "OCI_PLATFORM", reference: LOCK.compiler.builder.reference, indexDigest: LOCK.compiler.builder.indexDigest, platformDigest: LOCK.compiler.builder.platformDigest }
  });
  assert.deepEqual(ownedCompilerReceipt(LOCK, "B"), {
    delivery: "OFFICIAL_ARCHIVE", goVersion: "go1.27.3", goos: "linux", goarch: "amd64", cgoEnabled: false,
    identity: { kind: "GO_ARCHIVE", url: LOCK.compiler.archive.url, bytes: LOCK.compiler.archive.bytes, sha256: LOCK.compiler.archive.sha256 }
  });
  assert.throws(() => ownedCompilerReceipt(LOCK, "C"), /scanner_owned_construction_invalid/u);
});

test("owned containers preserve foreign collisions and are removed by exact ID after timeout", () => {
  const runValue = { workflow: "wf", runId: "123", runAttempt: 1, sourceSha: "a".repeat(40) };
  const name = "aw-owned-scanner-123-1-upstream-c1";
  const owner = `123-1-${"a".repeat(40)}`;
  const createArgs = ownedContainerCreateArguments(["run", "--rm", "--network", "none", "--pull=never", "image", "true"], { name, owner });
  assert.deepEqual(createArgs.slice(0, 6), ["create", "--name", name, "--label", `com.autoworld.owned-scanner=${owner}`, "--network"]);
  assert.equal(createArgs.includes("--rm"), false);
  assert.throws(() => ownedContainerCreateArguments(["run", "--rm", "--network", "none", "image"], { name, owner }), /scanner_owned_offline_pull_policy_invalid/u);

  const id = "b".repeat(64); let created = false; let removed = false; const calls = []; const dockerEnv = { HOME: "/isolated", DOCKER_CONFIG: "/isolated/config" };
  const executeCommand = (_command, args, options) => {
    calls.push({ args, env: options.env });
    if (args[0] === "inspect") {
      const target = args.at(-1);
      if (target === name) return created ? { status: 0, stdout: Buffer.from(`${args[2].includes("Labels") ? `${owner}|` : ""}${id}\n`), stderr: Buffer.alloc(0) } :
        { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${name}\n`) };
      return removed ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${id}\n`) } : { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) };
    }
    if (args[0] === "create") { created = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    if (args[0] === "start") throw new Error("timeout");
    if (args[0] === "rm") { removed = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    throw new Error("unexpected");
  };
  const runner = createOwnedContainerRunner({ runValue, scope: "upstream", dockerEnv, executeCommand });
  assert.throws(() => runner.execute(["run", "--rm", "image", "true"], { timeoutMs: 1, maxBytes: 1 }), /timeout/u);
  assert.equal(runner.liveCount(), 0);
  assert.equal(removed, true);
  assert.ok(calls.every((item) => item.env === dockerEnv));

  let foreignCalls = 0;
  const foreign = createOwnedContainerRunner({ runValue, scope: "upstream", executeCommand: (_command, args) => {
    foreignCalls += 1; assert.equal(args[0], "inspect"); return { status: 0, stdout: Buffer.from(`${"c".repeat(64)}\n`), stderr: Buffer.alloc(0) };
  } });
  assert.throws(() => foreign.execute(["run", "--rm", "image", "true"], {}), /scanner_owned_container_collision/u);
  assert.equal(foreignCalls, 1);

  let cleanupRecovered = false; let cleanupCreated = false;
  const uncertain = createOwnedContainerRunner({ runValue, scope: "managed", executeCommand: (_command, args) => {
    const target = args.at(-1);
    if (args[0] === "create") { cleanupCreated = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    if (args[0] === "start") return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    if (args[0] === "rm") return cleanupRecovered ? { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) } : { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("permission denied\n") };
    if (args[0] === "inspect" && !cleanupCreated) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) };
    if (args[0] === "inspect" && args[2].includes("Labels")) return { status: 0, stdout: Buffer.from(`${owner}|${id}\n`), stderr: Buffer.alloc(0) };
    return cleanupRecovered ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) } : { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("daemon unavailable\n") };
  } });
  assert.throws(() => uncertain.execute(["run", "--rm", "image", "true"], {}), /scanner_owned_container_cleanup_uncertain/u);
  assert.equal(uncertain.liveCount(), 1);
  cleanupRecovered = true;
  assert.equal(uncertain.cleanupAll(), true);
  assert.equal(uncertain.liveCount(), 0);

  let malformedCreated = false; let malformedRemovals = 0;
  const malformed = createOwnedContainerRunner({ runValue, scope: "upstream", executeCommand: (_command, args) => {
    const target = args.at(-1);
    if (args[0] === "inspect" && !malformedCreated) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) };
    if (args[0] === "create") { malformedCreated = true; return { status: 0, stdout: Buffer.from("malformed\n"), stderr: Buffer.alloc(0) }; }
    if (args[0] === "inspect") return { status: 0, stdout: Buffer.from(`foreign|${id}\n`), stderr: Buffer.alloc(0) };
    if (args[0] === "rm") malformedRemovals += 1;
    return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  } });
  assert.throws(() => malformed.execute(["run", "--rm", "image", "true"], {}), /scanner_owned_container_identity_invalid/u);
  assert.equal(malformedRemovals, 0);
});

test("expired cleanup budget still attempts exact container and path cleanup without masking the deadline", () => {
  const calls = [];
  assert.throws(() => runOwnedFinalCleanup({
    beginCleanup: () => { calls.push("budget"); throw new Error("scanner_owned_time_budget_refused"); },
    cleanupContainers: () => { calls.push("containers"); throw new Error("container_cleanup_failed"); },
    cleanupPaths: () => { calls.push("paths"); }
  }), (error) => error.message === "scanner_owned_time_budget_refused" && error.cleanupErrors?.[0]?.message === "container_cleanup_failed");
  assert.deepEqual(calls, ["budget", "containers", "paths"]);
  const cleanupFailure = new Error("scanner_owned_container_cleanup_uncertain", { cause: new Error("scanner_owned_time_budget_refused") });
  assert.deepEqual(ownedCleanupEvidence(cleanupFailure, false), { attempted: true, absent: false,
    failure: "scanner_owned_container_cleanup_uncertain", budgetFailure: true });
  assert.deepEqual(ownedCleanupEvidence(null, true), { attempted: true, absent: true, failure: null, budgetFailure: false });
  const cleanup = ownedCleanupEvidence(cleanupFailure, false);
  assert.deepEqual(ownedFailureResult({ run: { workflow: "wf", runId: "456", runAttempt: 1, sourceSha: "d".repeat(40) },
    primary: new Error("build_failed"), cleanup, budget: { state: "FAILED" }, journal: [{ stage: "owned:build", status: "FAILED" }] }), {
    schemaVersion: 1, receiptKind: "auto-world-trivy-0.76.1-jose4.1.6-r1", state: "BUILD_DIAGNOSTIC", result: "FAILED",
    run: { workflow: "wf", runId: "456", runAttempt: 1, sourceSha: "d".repeat(40) }, firstFailure: "build_failed", cleanup,
    budget: { state: "FAILED" }, journal: [{ stage: "owned:build", status: "FAILED" }]
  });

  const runValue = { workflow: "wf", runId: "456", runAttempt: 1, sourceSha: "d".repeat(40) };
  const name = "aw-owned-scanner-456-1-upstream-c1"; const owner = `456-1-${"d".repeat(40)}`; const id = "e".repeat(64);
  let created = false; let removed = false; const timeouts = [];
  const runner = createOwnedContainerRunner({ runValue, scope: "upstream", budget: {
    commandTimeoutMs: (cap) => Math.min(cap, 1234),
    cleanupCommandTimeoutMs: () => { throw new Error("scanner_owned_time_budget_refused"); }
  }, executeCommand: (_command, args, options) => {
    timeouts.push(options.timeoutMs);
    if (args[0] === "inspect") {
      const target = args.at(-1);
      if (!created) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${name}\n`) };
      if (args[2].includes("Labels")) return { status: 0, stdout: Buffer.from(`${owner}|${id}\n`), stderr: Buffer.alloc(0) };
      return removed ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`Error: No such object: ${target}\n`) } : { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) };
    }
    if (args[0] === "create") { created = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    if (args[0] === "start") return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    if (args[0] === "rm") { removed = true; return { status: 0, stdout: Buffer.from(`${id}\n`), stderr: Buffer.alloc(0) }; }
    throw new Error("unexpected");
  } });
  assert.throws(() => runner.execute(["run", "--rm", "image", "true"], { timeoutMs: 9999, maxBytes: 1 }), /scanner_owned_time_budget_refused/u);
  assert.equal(runner.liveCount(), 0);
  assert.ok(timeouts.slice(0, 4).every((value) => value === 1234));
  assert.deepEqual(timeouts.slice(-2), [5000, 5000]);
});

test("Git fixture archive contract rejects links, duplicates, case collisions and traversal", () => {
  assert.deepEqual(validateGitArchiveListing("test-repo/\ntest-repo/file\n", "d directory\n- file\n"), [
    { path: "test-repo", type: "directory" }, { path: "test-repo/file", type: "file" }
  ]);
  for (const [listing, verbose] of [
    ["test-repo/link\n", "l link\n"],
    ["test-repo/file\ntest-repo/file\n", "- file\n- file\n"],
    ["test-repo/File\ntest-repo/file\n", "- file\n- file\n"],
    ["test-repo/../escape\n", "- file\n"]
  ]) assert.throws(() => validateGitArchiveListing(listing, verbose), /scanner_owned_git_fixture_invalid/u);
});

test("owned output and cleanup remain below an exact runner temporary root", () => {
  const runner = mkdtempSync(path.join(os.tmpdir(), "aw-owned-runner-"));
  try {
    const output = path.join(runner, "public", "owned");
    assert.equal(validateOwnedOutput(output, runner), output);
    assert.throws(() => validateOwnedOutput(runner, runner), /scanner_owned_output_invalid/u);
    assert.throws(() => validateOwnedOutput(path.resolve(runner, "..", "escape"), runner), /scanner_owned_output_invalid/u);
    const owned = path.join(runner, "aw-owned-scanner-12345678");
    mkdirSync(path.join(owned, "out-b"), { recursive: true });
    writeFileSync(path.join(owned, "out-b", "trivy"), "private");
    assert.equal(removeOwnedScannerPaths(owned, runner, ["out-b"]), true);
    assert.equal(removeOwnedScannerPaths(owned, runner), true);
    assert.throws(() => removeOwnedScannerPaths(path.join(runner, "unowned"), runner), /scanner_owned_cleanup_path_invalid/u);
  } finally {
    rmSync(runner, { recursive: true, force: true });
  }
});

test("owned resource projection preserves the 25 percent reserve and managed floor", () => {
  const GiB = 1024 ** 3;
  assert.equal(requiredOwnedFreeBytes("upstream", 8 * GiB), 10 * GiB);
  assert.equal(requiredOwnedFreeBytes("managed", 8 * GiB), 20 * GiB);
  assert.equal(requiredOwnedFreeBytes("managed", 24 * GiB), 30 * GiB);
  assert.throws(() => requiredOwnedFreeBytes("other", GiB), /scanner_owned_space_projection_invalid/u);
});

test("provider build cannot run on a local non-Linux/non-Actions process", () => {
  assert.throws(() => buildOwnedScanner({ output: path.resolve("owned-public"), scope: "upstream", budget: {} }), /scanner_owned_build_requires_linux_actions/u);
});

test("build source retains private evidence and exposes bounded public receipts", () => {
  const source = readFileSync(path.join(ROOT, "scripts/scanner/owned-build.mjs"), "utf8");
  assert.match(source, /publicDirectory/u);
  assert.match(source, /ownedPublicDirectory/u);
  assert.match(source, /public-manifest\.json/u);
  assert.match(source, /cleanupDuplicate/u);
  assert.match(source, /cleanupAll/u);
  assert.match(source, /rust-controls", String\(index \+ 1\), "Cargo\.lock"/u);
  assert.match(source, /files\.length \+ 1 > limits\.publicEntries/u);
  assert.match(source, /--network", "none/u);
  assert.match(source, /go test -mod=readonly -count=1 \.\/\.\.\./u);
  assert.match(source, /mage -v test:unit/u);
  assert.match(source, /GOPROXY=https:\/\/proxy\.golang\.org/u);
  assert.doesNotMatch(source, /infra\/scanner\/scanner-lock\.json|scripts\/scanner\/build\.mjs/u);
});
