import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { chmodSync, cpSync, existsSync, globSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { captureFiles } from "../scripts/scanner/controls.mjs";
import { captureManagedArchive } from "../scripts/scanner/managed-archive.mjs";
import { commandFailureDiagnostic, recordGosuCaptureFailure, snapshotGosuExport, withGosuCaptureRoot } from "../scripts/scanner/official-audit.mjs";
import { MANAGED_GOSU_SOURCE } from "../scripts/scanner/official-controls.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (bytes) => ({ size: bytes.length, sha256: hash(bytes) });
const json = (object) => Buffer.from(JSON.stringify(object) + "\n");
const put = (root, name, bytes) => {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes);
};
const evidenceNames = ["DERIVATIVE-NOTICE.txt", "binary-sha256.txt", "build-info.txt", "compiler-version.txt",
  "go.mod", "go.sum", "gosu-version.txt", "licenses/go-LICENSE", "licenses/go-PATENTS", "licenses/gosu-LICENSE",
  "licenses/moby-sys-LICENSE", "licenses/x-sys-LICENSE", "licenses/x-sys-PATENTS", "module-download.json",
  "module-inventory.json", "module-proxy-payloads.tsv", "module-verify.txt", "offline-reconstruction.json",
  "process-replacement.txt", "source-sha256.txt", "upstream-alpine-tests.txt", "upstream-go-test-count.txt", "upstream-go-test.json"];
const privateValue = "private binary sentinel";
const compiler = "go version go1.27.3 linux/amd64";
const sourceBytes = Buffer.alloc(18160, 0x03), binary = Buffer.from(privateValue);
const finalInventory = Buffer.from(hash(binary) + "  /usr/local/bin/gosu\n");
const tsv = "module-proxy-payloads.tsv", offline = "offline-reconstruction.json";

function fixtureBytes() {
  const files = new Map();
  for (const name of evidenceNames) {
    const tracked = path.join(repo, "infra/managed-images/postgres", name);
    files.set("evidence/" + name, existsSync(tracked) ? readFileSync(tracked) : Buffer.from("fixture text\n"));
  }
  files.set("evidence/build-info.txt", readFileSync(path.join(repo, "tests/fixtures/scanner-official/managed-gosu/build-info.txt")));
  files.set("evidence/compiler-version.txt", Buffer.from(compiler + "\n"));
  files.set("evidence/source-sha256.txt", Buffer.from(hash(sourceBytes) + "  /tmp/gosu-source.tar.gz\n"));
  files.set("evidence/binary-sha256.txt", Buffer.from(hash(binary) + "  /out/gosu\n"));
  files.set("materials/gosu-source.tar.gz", sourceBytes); files.set("materials/reference-gosu", binary);
  let descriptor = "";
  for (const [module, version] of [["github.com/moby/sys/user", "v0.4.1"], ["golang.org/x/sys", "v0.1.0"]]) {
    for (const kind of ["info", "mod", "zip"]) {
      const bytes = Buffer.from(module + version + kind);
      files.set(`materials/proxy/${module}/@v/${version}.${kind}`, bytes);
      descriptor += [module, version, kind, bytes.length, hash(bytes)].join("\t") + "\n";
    }
  }
  files.set("evidence/" + tsv, Buffer.from(descriptor));
  for (const name of [tsv, "go.mod", "go.sum"]) files.set("materials/" + name, files.get("evidence/" + name));
  files.set("evidence/" + offline, json({ schemaVersion: 1, kind: "GOSU_OFFLINE_INPUTS_SAME_TOOLCHAIN_V1",
    sourceArchiveSha256: hash(sourceBytes), modulePayloadsSha256: hash(descriptor), goModSha256: MANAGED_GOSU_SOURCE.goModSha256,
    goSumSha256: MANAGED_GOSU_SOURCE.goSumSha256, compilerVersion: "go1.27.3", referenceBinarySha256: hash(binary),
    reconstructedBinarySha256: hash(binary), freshSourceAndCaches: true, network: "none",
    missingZipRefusals: ["github.com/moby/sys/user@v0.4.1", "golang.org/x/sys@v0.1.0"] }));
  return files;
}

function projection(files) {
  const entry = (name) => identity(files.get(name));
  return "gosu_material_input_v1:" + JSON.stringify({ schemaVersion: 1, kind: "GOSU_MATERIAL_INPUT_PROJECTION_V1",
    source: entry("materials/gosu-source.tar.gz"), goMod: entry("materials/go.mod"), goSum: entry("materials/go.sum"),
    moduleProxyTsv: entry("materials/" + tsv), offlineReceipt: entry("evidence/" + offline),
    referenceBinary: entry("materials/reference-gosu"), compilerVersion: compiler });
}

function temp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "aw-gosu-files-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("scratch recipe exports exactly the original seven inputs and four references under materials", () => {
  const recipe = readFileSync(path.join(repo, "infra/managed-images/Dockerfile.postgres"), "utf8");
  const stage = recipe.split("FROM scratch AS material-capture\n")[1].split("\n\n")[0].split("\n");
  const expected = [...fixtureBytes().keys()].filter((name) => name.startsWith("materials/")).map((name) => {
    const relative = name.slice(10);
    if (relative === "reference-gosu") return "COPY --from=gosu-build /out/gosu /" + name;
    const source = ["go.mod", "go.sum", tsv].includes(relative) ? "/offline-references/" : "/offline-inputs/";
    return "COPY --from=gosu-offline-reconstruction " + source + relative + " /" + name;
  });
  assert.deepEqual(stage.sort(), ["COPY --from=evidence / /evidence/", ...expected].sort());
});

test("real export rejects foreign membership, descriptor types and oversized or empty files", { skip: process.platform !== "linux" }, (t) => {
  const work = temp(t), root = path.join(work, "export"), files = fixtureBytes();
  for (const [name, bytes] of files) put(root, name, bytes);
  const snapshot = snapshotGosuExport(root, path.join(work, "copy"));
  assert.equal(Object.keys(snapshot.files).length, 34);
  const file = path.join(root, "materials/reference-gosu"), contents = readFileSync(file);
  for (const mutate of [
    () => mkdirSync(path.join(root, "extra")), () => writeFileSync(path.join(root, "extra"), "extra"),
    () => rmSync(file), () => truncateSync(file, 0), () => truncateSync(file, 16 * 1024 ** 2 + 1),
    () => linkSync(file, path.join(work, "other-link")), () => { rmSync(file); symlinkSync(work, file); },
    () => { rmSync(file); execFileSync("mkfifo", [file]); },
    () => { renameSync(path.join(root, "materials/proxy"), path.join(work, "proxy")); symlinkSync(path.join(work, "proxy"), path.join(root, "materials/proxy")); },
  ]) {
    mutate(); assert.throws(() => snapshotGosuExport(root));
    rmSync(root, { recursive: true });
    for (const [name, bytes] of files) put(root, name, bytes);
  }
  writeFileSync(file, Buffer.alloc(16 * 1024 ** 2)); snapshotGosuExport(root);
  const inode = fs.statSync(file).ino, originalRead = fs.readSync;
  let mutated = false;
  const hook = t.mock.method(fs, "readSync", (fd, ...args) => {
    const count = originalRead(fd, ...args);
    if (count && !mutated && fs.fstatSync(fd).ino === inode) {
      mutated = true; fs.appendFileSync(file, "changed during stream");
    }
    return count;
  });
  syncBuiltinESMExports();
  try { assert.throws(() => snapshotGosuExport(root)); assert.equal(mutated, true); }
  finally { hook.mock.restore(); syncBuiltinESMExports(); }
  writeFileSync(file, contents);
  put(root, "materials/" + tsv, Buffer.alloc(1024)); snapshotGosuExport(root);
  put(root, "materials/" + tsv, Buffer.alloc(1025)); assert.throws(() => snapshotGosuExport(root));
});

// Real files, owned roots, archive checks and a fixture Git commit; only three
// cryptographic pins and the native commands have synthetic counterparts.
async function fixtureCheckout(t) {
  const root = temp(t);
  for (const dir of ["scripts/scanner", "infra/managed-images"]) cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true });
  const controls = path.join(root, "scripts/scanner/official-controls.mjs");
  writeFileSync(controls, readFileSync(controls, "utf8").replaceAll(MANAGED_GOSU_SOURCE.binarySha256, hash(binary))
    .replaceAll(MANAGED_GOSU_SOURCE.sourceArchiveSha256, hash(sourceBytes))
    .replaceAll(MANAGED_GOSU_SOURCE.finalInventorySha256, hash(finalInventory)));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: root });
  git("init", "-q"); git("add", "."); git("commit", "-qm", "fixture");
  const source = git("rev-parse", "HEAD").toString().trim();
  return { root, source, adapter: await import(pathToFileURL(path.join(root, "scripts/scanner/official-audit.mjs"))) };
}

async function scenario(t, checkout, mutation = "", cachedVertices = 0) {
  const { adapter, source, root } = checkout, base = temp(t);
  const work = path.join(base, "work"), output = path.join(base, "data-foundation-audit");
  const published = path.join(output, "managed-public-evidence");
  mkdirSync(work); mkdirSync(published, { recursive: true });
  const files = fixtureBytes(), imageId = "sha256:" + "a".repeat(64);
  const tag = "auto-world-managed/postgres:" + source;
  const metadata = path.join(work, "runtime.json"), inspection = path.join(work, "inspect.json");
  writeFileSync(metadata, json({ "containerimage.config.digest": imageId, "containerimage.digest": "sha256:" + "b".repeat(64) }));
  writeFileSync(inspection, json([{ Id: imageId, RepoTags: [tag], Os: "linux", Architecture: "amd64" }]));
  const archive = path.join(work, "managed-image-postgres.tar");
  writeFileSync(archive, "fixture archive bytes"); chmodSync(archive, 0o400);
  const archiveSnapshot = await captureManagedArchive(archive, "postgres");
  const subject = { kind: "LOCAL_MANAGED_IMAGE_V1", artifactName: "/managed-image-postgres.tar", imageId, os: "linux",
    architecture: "amd64", archiveSha256: archiveSnapshot.sha256, archiveBytes: archiveSnapshot.size };
  const local = { archiveSnapshot, frozen: await captureFiles([metadata, inspection].map((file) => ({ path: file, cap: 1024 }))) };
  const run = { GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_SHA: source, GITHUB_WORKFLOW_SHA: source,
    GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" };
  const args = ["buildx", "build", "--platform", "linux/amd64", "--progress", "plain", "--file",
    path.join(root, "infra/managed-images/Dockerfile.postgres"), "--no-cache-filter", "gosu-offline-reconstruction",
    "--target", "runtime", "--tag", tag, "--metadata-file", metadata, "--load", root];
  const stderr = Buffer.from(["#6 [gosu-offline-reconstruction 2/2] RUN --mount=type=bind,from=gosu-build,source=/out/gosu,target=/reference-gosu,readonly /usr/local/bin/gosu-offline-reconstruction",
    "#6 0.1 gosu_offline_missing_zip_refused:github.com/moby/sys/user@v0.4.1", "#6 0.2 gosu_offline_missing_zip_refused:golang.org/x/sys@v0.1.0",
    "#6 0.3 gosu_offline_upstream_go_test_cases=0", "#6 0.4 gosu_offline_reconstruction_passed", "#6 0.5 " + projection(files),
    "#6 DONE 1.0s", ""].join("\n"));
  const materialInput = {};
  const trace = adapter.captureManagedGosuRuntimeTrace(Buffer.alloc(0), stderr, { run, args, commandIndex: 1, materialInput });
  const traceFile = "managed-gosu-runtime-trace.json";
  put(output, traceFile, trace);
  const firstSolve = { args, materialInput, record: { commandIndex: 1, argumentsSha256: hash(JSON.stringify(args)), stdout: identity(Buffer.alloc(0)),
    stderr: identity(stderr), exitCode: 0, eof: true, cachedVertices: 0 } };
  const build = { subject, gosuRuntimeTrace: { path: traceFile, ...identity(trace) }, materialCapture: { cleanup: "NOT_CREATED" } };
  const secondSolve = {}, recipes = adapter.recipeSnapshot(source);
  const managed = JSON.parse(readFileSync(path.join(root, "infra/managed-images/lock.json")));
  let exportPath;
  const exportSolve = (target, dest, meta) => {
    assert.equal(target, "material-capture"); exportPath = dest;
    for (const [name, bytes] of files) put(dest, name, bytes);
    writeFileSync(meta, json({ "buildx.build.ref": "fixture" }));
    secondSolve.args = ["buildx", "build", "--platform", "linux/amd64", "--progress", "plain", "--file", args[7],
      "--target", target, "--metadata-file", meta, "--output", "type=local,dest=" + dest, root];
    secondSolve.record = { commandIndex: 4, argumentsSha256: hash(JSON.stringify(secondSolve.args)), stdout: identity(Buffer.alloc(0)),
      stderr: identity(Buffer.from("#1 DONE\n")), exitCode: 0, eof: true, cachedVertices };
    if (mutation === "zip" || mutation === "coordinated") {
      const name = "materials/proxy/golang.org/x/sys/@v/v0.1.0.zip", before = files.get(name), changed = Buffer.alloc(before.length, 0x6e);
      put(dest, name, changed);
      if (mutation === "coordinated") {
        const updated = files.get("materials/" + tsv).toString().replace(hash(before), hash(changed));
        for (const dir of ["materials/", "evidence/"]) put(dest, dir + tsv, updated);
        put(dest, "evidence/" + offline, files.get("evidence/" + offline).toString().replace(hash(files.get("materials/" + tsv)), hash(updated)));
      }
    }
    if (mutation.startsWith("member ")) put(dest, mutation.slice(7), Buffer.from("substitution"));
    if (mutation === "credential") put(dest, "evidence/module-verify.txt", "Authorization: Bearer fixture-sensitive");
    if (mutation === "oversized-metadata") truncateSync(meta, 1024 * 1024 + 1);
    if (mutation === "missing-build-ref") writeFileSync(meta, "{}");
    if (mutation === "public-extra") secondSolve.record.extra = privateValue;
    if (["metadata", "capture-observation-write"].includes(mutation)) rmSync(meta);
  };
  const command = (_docker, _arguments, options) => {
    if (mutation === "container-cleanup") throw new Error("scanner_official_cleanup_uncertain");
    if (mutation === "post-copy") put(exportPath, "materials/reference-gosu", "changed");
    if (mutation === "unexpected-child" || mutation === "runtime-directory") {
      const dir = mutation === "unexpected-child" ? path.join(path.dirname(exportPath), "foreign") : path.dirname(options.file);
      if (mutation === "runtime-directory") renameSync(dir, dir + "-original");
      mkdirSync(dir);
      writeFileSync(path.join(dir, "keep"), "foreign");
    }
    writeFileSync(options.file, finalInventory);
    return finalInventory;
  };
  if (mutation === "attempt") run.GITHUB_RUN_ATTEMPT = "2";
  if (mutation === "config") subject.imageId = "sha256:" + "f".repeat(64);
  if (mutation === "archive") subject.archiveBytes++;
  if (mutation === "platform") subject.architecture = "arm64";
  if (mutation === "recipe") recipes["infra/managed-images/gosu-functional-tests.sh"].sha256 = "0".repeat(64);
  const execute = () => adapter.capturePostgresMaterials({ build, local, work, output, published, command, exportSolve, firstSolve,
    secondSolve, recipes, run, managed, source });
  const filename = "managed-gosu-material-capture.json";
  const retainedCapture = ["capture-observation-write", "runtime-directory", "unexpected-child"].includes(mutation);
  const retainedPublicStage = ["promotion-observation-write", "staging-stat"].includes(mutation);
  if (mutation === "staging-stat") {
    const stat = fs.lstatSync;
    let refuseFirst = true;
    const hook = t.mock.method(fs, "lstatSync", (file, ...args) => {
      if (refuseFirst && typeof file === "string" && path.basename(file).startsWith("gosu-public-")) {
        refuseFirst = false;
        throw new Error("cannot identify allocated staging");
      }
      return stat(file, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => { hook.mock.restore(); syncBuiltinESMExports(); });
  }
  if (["write-failure", "promotion-observation-write", "capture-observation-write"].includes(mutation)) {
    const write = fs.writeFileSync;
    const hook = t.mock.method(fs, "writeFileSync", (file, ...args) => {
      if (mutation.endsWith("observation-write") && typeof file === "string" && path.basename(file).startsWith("gosu-observation-")) {
        hook.mock.restore(); syncBuiltinESMExports();
        throw new Error("cannot write provisional receipt");
      }
      if (typeof file === "string" && file.includes("/gosu-public-") && file.endsWith("/build-info.txt")) throw new Error("fixture write failure");
      return write(file, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => { hook.mock.restore(); syncBuiltinESMExports(); });
  }
  if (mutation === "publication") {
    const rename = fs.renameSync;
    const hook = t.mock.method(fs, "renameSync", (from, to) => {
      if (to === path.join(published, "postgres-runtime")) throw new Error("fixture publish failure");
      return rename(from, to);
    });
    syncBuiltinESMExports();
    t.after(() => { hook.mock.restore(); syncBuiltinESMExports(); });
  }
  if (mutation === "metadata" || mutation === "container-cleanup") {
    const remove = fs.rmSync;
    let observed = false;
    const hook = t.mock.method(fs, "rmSync", (dir, options) => {
      if (exportPath && dir === path.dirname(exportPath)) {
        const before = JSON.parse(readFileSync(path.join(output, filename)));
        assert.equal(before.status, "FAILED");
        assert.equal(before.cleanup, "UNKNOWN");
        observed = true;
      }
      return remove(dir, options);
    });
    syncBuiltinESMExports();
    t.after(() => { hook.mock.restore(); syncBuiltinESMExports(); assert.ok(observed); });
  }

  if (mutation) {
    await assert.rejects(execute);
    assert.equal(local.gosuEvidence, undefined);
    if (existsSync(path.join(output, filename))) {
      // The provisional receipt survives interruption and precedes the final cleanup verdict.
      assert.equal(JSON.parse(readFileSync(path.join(output, filename))).cleanup, "UNKNOWN");
    }
    adapter.recordGosuCaptureFailure(work, output, build.materialCapture);
    const failed = JSON.parse(readFileSync(path.join(output, filename)));
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.cleanup, build.materialCapture.cleanup);
    if (mutation === "container-cleanup") {
      assert.equal(failed.cleanup, "UNKNOWN");
      assert.equal(failed.reason, "scanner_gosu_material_cleanup_unknown");
    }
    if (mutation === "metadata") assert.equal(failed.cleanup, "REMOVED");
    if (retainedCapture || retainedPublicStage) assert.equal(failed.cleanup, "UNKNOWN");
    if (mutation === "publication") {
      assert.deepEqual(build.publicEvidence.map((file) => file.path).sort(), [...evidenceNames].sort());
      assert.ok(build.publicEvidence.every((file) => hash(readFileSync(path.join(published, "postgres", file.path))) === file.sha256));
      assert.equal(existsSync(path.join(published, "postgres-runtime")), false);
    } else {
      assert.deepEqual(readdirSync(published), []);
      assert.equal(build.publicEvidence, undefined);
    }
    assert.equal(build.runtimeGosuEvidence, undefined);
    assert.equal(readdirSync(work).some((name) => name.startsWith("gosu-public-")), retainedPublicStage);
  } else {
    await execute();
    const bytes = readFileSync(path.join(output, filename)), record = JSON.parse(bytes);
    assert.equal(record.status, "CAPTURED_IN_JOB_ONLY"); assert.equal(record.cleanup, "REMOVED");
    assert.equal(record.exportSolve.cachedVertices, cachedVertices); assert.equal(record.materials.length, 11);
    assert.equal(record.exportedFiles, 34); assert.equal(record.recipes.length, 15);
    assert.equal(record.materials.find((row) => row.role === "referenceBinary").size, binary.length);
    assert.deepEqual(record.inputProjection, identity(Buffer.from(projection(files) + "\n")));
    assert.deepEqual(record.manifest, identity(readFileSync(path.join(work, "capture-manifest.json"))));
    assert.ok(bytes.length <= 32768); assert.equal(bytes.includes(base), false); assert.equal(bytes.includes(binary), false);
    assert.equal(local.gosuEvidence.kind, "SOURCE_BOUND_GOSU_V1");
    assert.deepEqual(build.publicEvidence.map((row) => row.path).sort(), [...evidenceNames].sort());
  }
  if (mutation === "unexpected-child" || mutation === "runtime-directory") {
    const dir = mutation === "runtime-directory" ? "postgres-runtime" : "foreign";
    assert.equal(readFileSync(path.join(path.dirname(exportPath), dir, "keep"), "utf8"), "foreign");
  }
  if (exportPath) assert.equal(existsSync(path.dirname(exportPath)), retainedCapture);
}

test("two-solve binding uses the observed first projection and exact recipe, archive and export files", { skip: process.platform !== "linux" }, async (t) => {
  const checkout = await fixtureCheckout(t);
  for (const cached of [0, 3]) await t.test("positive fixture, observed cached vertices " + cached, (c) => scenario(c, checkout, "", cached));
  for (const mutation of ["zip", "coordinated", "member evidence/go.mod", "member evidence/go.sum", "member evidence/" + tsv,
    "member materials/gosu-source.tar.gz", "member materials/reference-gosu", "attempt", "config", "archive", "platform",
    "recipe", "credential", "post-copy", "metadata", "public-extra", "container-cleanup", "publication", "write-failure", "capture-observation-write",
    "promotion-observation-write", "staging-stat", "missing-build-ref", "oversized-metadata", "runtime-directory", "unexpected-child"]) await t.test(mutation, (c) => scenario(c, checkout, mutation));
});

test("wrapper and cleanup failures keep the global receipt and resolved upload free of private diagnostics", { skip: process.platform !== "linux" }, (t) => {
  const base = temp(t), output = path.join(base, "data-foundation-audit"), work = path.join(base, "work");
  mkdirSync(work); mkdirSync(output);
  const source = readFileSync(path.join(repo, "scripts/scanner/official-audit.mjs"), "utf8");
  const wrapper = source.slice(source.indexOf("  const command = (executable, originalArgs,"), source.indexOf("  const phase = async"));
  const workflow = JSON.parse(readFileSync(path.join(repo, ".github/workflows/data-foundation-managed.yml")));
  const upload = workflow.jobs.audit.steps.find((step) => step.uses?.startsWith("actions/upload-artifact")).with.path.split("\n");
  assert.ok(upload.includes("${{ runner.temp }}/data-foundation-audit/managed-gosu-material-capture.json"));
  for (const [code, foreign, first] of [["ENOSPC", false, false], ["ETIMEDOUT", true, false], ["EIO", false, true], ["ENOSPC", true, true]]) {
    const receipt = { commands: [], phases: [], builds: [{ materialCapture: {} }] };
    const status = receipt.builds[0].materialCapture;
    let sentinel, foreignFile;
    const fail = (reason) => { throw new Error(reason); };
    assert.throws(() => withGosuCaptureRoot(work, status, (root) => {
      sentinel = root + "/private.zip";
      const diagnostics = Buffer.from([sentinel, privateValue, "Authorization: Bearer fixture-sensitive"].join("\n"));
      if (foreign) {
        renameSync(root, root + "-moved"); mkdirSync(root);
        foreignFile = path.join(root, "foreign"); writeFileSync(foreignFile, "keep");
      }
      const command = runInNewContext(`(() => { ${wrapper} return command; })()`, { Buffer, path, output, environment: {},
        DOCKER: "/fixture", receipt, cleanupUncertain: false, successful: () => false, commandFailureDiagnostic, fail,
        writeFileSync: (...args) => code === "EIO" ? fail(sentinel) : writeFileSync(...args),
        invoke: () => ({ stdout: diagnostics, stderr: diagnostics, status: 1, error: { code }, signal: null }) });
      command("/fixture", ["buildx", "build"], { privateOutput: !first, gosuRuntimeTrace: first });
    }), { message: foreign ? "scanner_gosu_material_cleanup_unknown" : "scanner_gosu_material_capture_invalid" });
    const failure = recordGosuCaptureFailure(work, output, status, first);
    receipt.phases.push({ result: "failed", reason: failure.message });
    assert.equal(status.cleanup, foreign ? "UNKNOWN" : "REMOVED");
    if (foreign) assert.equal(readFileSync(foreignFile, "utf8"), "keep");
    const receiptName = "official-audit-receipt.json";
    put(output, receiptName, json(receipt));
    const resolved = upload.flatMap((entry) => globSync(entry.replace("${{ runner.temp }}/", ""), { cwd: base }));
    assert.deepEqual(resolved.sort(), ["data-foundation-audit/managed-gosu-material-capture.json", "data-foundation-audit/" + receiptName]);
    const observation = JSON.parse(readFileSync(path.join(base, resolved[0])));
    assert.equal(observation.status, "FAILED"); assert.equal(observation.cleanup, status.cleanup);
    const bytes = Buffer.concat(resolved.map((file) => readFileSync(path.join(base, file))));
    for (const secret of [sentinel, privateValue, "fixture-sensitive"]) assert.equal(bytes.includes(secret), false);
    for (const entry of readdirSync(output)) rmSync(path.join(output, entry));
  }
});

test("cleanup preserves a substituted exporter destination even under the original owned parent", { skip: process.platform !== "linux" }, (t) => {
  const parent = temp(t), status = {};
  let foreign;
  assert.throws(() => withGosuCaptureRoot(parent, status, (_root, createDirectory) => {
    const destination = createDirectory("export");
    renameSync(destination, destination + "-original");
    mkdirSync(destination);
    foreign = path.join(destination, "keep");
    writeFileSync(foreign, "foreign");
    throw new Error("export interrupted");
  }), { message: "scanner_gosu_material_cleanup_unknown" });
  assert.equal(status.cleanup, "UNKNOWN");
  assert.equal(readFileSync(foreign, "utf8"), "foreign");
});

test("PostgreSQL inspection and immutable archive save keep failed command output outside the upload", { skip: process.platform !== "linux" }, async (t) => {
  const root = temp(t);
  const moduleDir = path.join(root, "scripts/scanner");
  cpSync(path.join(repo, "scripts/scanner"), moduleDir, { recursive: true });
  const original = readFileSync(path.join(moduleDir, "official-audit.mjs"), "utf8");
  const section = (start, end) => {
    const first = original.indexOf(start), last = original.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return original.slice(first, last);
  };
  // Run the production wrapper, identity/save branch, failure handler and final receipt writer.
  // Only Docker and the surrounding runner bootstrap are replaced.
  const harness = original + `
    export async function exercise({work, output, artifacts, archive, tag, metadataFile, invoke}) {
      const candidate = { role: "postgres" }, postgres = true, environment = {}, localImages = new Map();
      const build = { result: "failed", materialCapture: { cleanup: "NOT_CREATED" } };
      const receipt = { builds: [build], commands: [] };
      let cleanupUncertain = false;
      ${section("  const successful = (result)", "  const phase = async")}
      try {
        ${section("            const inspectedFile = path.join(output,", '          if (build.result !== "passed" &&')}
      ${section('    writeJson(path.join(output, "official-audit-receipt.json"), receipt);', "\n  }")}
      return build;
    }`;
  const runner = path.join(moduleDir, "inspect-save-fixture.mjs");
  writeFileSync(runner, harness);
  const { exercise } = await import(pathToFileURL(runner));
  const workflow = JSON.parse(readFileSync(path.join(repo, ".github/workflows/data-foundation-managed.yml")));
  const patterns = workflow.jobs.audit.steps.find((s) => s.uses?.startsWith("actions/upload-artifact")).with.path.split("\n");
  for (const mode of ["inspect-failure", "invalid-inspect", "mismatched-config", "save-failure", "retag"]) {
    await t.test(mode, async (sub) => {
      const base = temp(sub), work = path.join(base, "work"), artifacts = path.join(work, "artifacts");
      const output = path.join(base, "data-foundation-audit"), tag = "auto-world-managed/postgres:" + "a".repeat(40);
      mkdirSync(artifacts, { recursive: true }); mkdirSync(output);
      const id = "sha256:" + "1".repeat(64), other = "sha256:" + "2".repeat(64);
      const metadataFile = path.join(artifacts, "postgres-buildx.json");
      const archive = path.join(artifacts, "managed-image-postgres.tar");
      writeFileSync(metadataFile, json({ "containerimage.config.digest": mode === "mismatched-config" ? other : id, "containerimage.digest": other }));
      const sentinels = [work, privateValue, "fixture-sensitive"];
      const diagnostic = Buffer.from(work + " " + privateValue + " Authorization: Bearer fixture-sensitive");
      const inspection = json([{ Id: id, Os: "linux", Architecture: "amd64", RepoTags: [tag] }]);
      let saved;
      const invoke = (_executable, args) => {
        const inspect = args[1] === "inspect";
        const failed = mode === (inspect ? "inspect-failure" : "save-failure");
        if (!inspect) {
          saved = args.at(-1);
          // The tag now points to a different image; the inspected ID still resolves to the original bytes.
          if (!failed) writeFileSync(archive, saved === id ? id : other);
        }
        return { status: failed ? 1 : 0, signal: null, stdout: failed || mode === "invalid-inspect" ? diagnostic : inspect ? inspection : Buffer.alloc(0),
          stderr: failed ? diagnostic : Buffer.alloc(0) };
      };
      const build = await exercise({ work, output, artifacts, archive, tag, metadataFile, invoke });
      assert.equal(build.result, mode === "retag" ? "passed" : "failed");
      assert.equal(saved, ["retag", "save-failure"].includes(mode) ? id : undefined);
      const files = patterns.flatMap((pattern) => globSync(pattern.replace("${{ runner.temp }}/", ""), { cwd: base }));
      assert.ok(files.includes("data-foundation-audit/official-audit-receipt.json"));
      assert.equal(files.includes("data-foundation-audit/managed-postgres-inspect.json"), mode === "retag");
      if (mode === "retag") {
        assert.equal(build.subject.imageId, id);
        assert.equal(build.subject.archiveSha256, hash(id));
        assert.deepEqual(readFileSync(path.join(output, "managed-postgres-inspect.json")), inspection);
      } else {
        assert.ok(files.includes("data-foundation-audit/managed-gosu-material-capture.json"));
        for (const file of files) {
          const bytes = readFileSync(path.join(base, file));
          for (const sentinel of sentinels) assert.equal(bytes.includes(sentinel), false, file);
        }
      }
    });
  }
});
