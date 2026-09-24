import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { buildFixtureTar, fixtureConfig, sha256 } from "../scripts/image-import-fixture/archive.mjs";
import { importChanges, runDiagnostic, validateContext, validateImage } from "../scripts/image-import-fixture/run.mjs";

const owner = "run-123456789-attempt-1";
const tag = `auto-world-import-fixture:${owner}`;
const imageId = `sha256:${"a".repeat(64)}`;
const diffID = () => `sha256:${sha256(buildFixtureTar())}`;
const metadata = () => ({ Id: imageId, Os: "linux", Architecture: "amd64", RepoTags: [tag], Size: 1024,
  Config: { ...fixtureConfig(owner), User: "", Hostname: "", Domainname: "", Image: "", AttachStdin: false,
    AttachStdout: false, AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, OnBuild: null },
  RootFS: { Type: "layers", Layers: [diffID()] } });
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const missing = (ref) => ({ status: 1, stdout: "[]\n", stderr: `Error response from daemon: No such image: ${ref}\n` });

// Independently frame a tiny complete Docker/OCI archive for the runner's positive control.
function savedFixture({ classic = false, serverVersion = "28.0.4" } = {}) {
  const json = (value) => Buffer.from(JSON.stringify(value));
  const message = "auto-world synthetic import fixture v1";
  const created = "2026-09-23T00:00:00Z";
  const neutral = { Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false, AttachStderr: false,
    Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "", Volumes: null,
    WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null };
  const layer = classic ? buildFixtureTar() : gzipSync(buildFixtureTar());
  const layerMediaType = `application/vnd.oci.image.layer.v1.tar${classic ? "" : "+gzip"}`;
  const configValue = { os: "linux", architecture: "amd64", created, config: fixtureConfig(owner),
    rootfs: { type: "layers", diff_ids: [diffID()] }, history: [{ created, comment: message }],
    ...(classic ? { comment: message, container_config: neutral, docker_version: serverVersion } : {}) };
  const config = json(configValue);
  const descriptor = (bytes, mediaType) => ({ mediaType, digest: `sha256:${sha256(bytes)}`, size: bytes.length });
  const manifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: descriptor(config, "application/vnd.oci.image.config.v1+json"),
    layers: [descriptor(layer, layerMediaType)] });
  const indexDescriptor = { ...descriptor(manifest, "application/vnd.oci.image.manifest.v1+json"),
    annotations: { "io.containerd.image.name": `docker.io/library/${tag}`, "org.opencontainers.image.ref.name": owner } };
  const entries = {
    "oci-layout": json({ imageLayoutVersion: "1.0.0" }),
    "index.json": json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [indexDescriptor] }),
    "manifest.json": json([{ Config: `blobs/sha256/${sha256(config)}`, RepoTags: [tag], Layers: [`blobs/sha256/${sha256(layer)}`],
      ...(classic ? { LayerSources: { [diffID()]: descriptor(layer, layerMediaType) } } : {}) }]),
    [`blobs/sha256/${sha256(manifest)}`]: manifest,
    [`blobs/sha256/${sha256(config)}`]: config,
    [`blobs/sha256/${sha256(layer)}`]: layer,
  };
  if (classic) {
    const legacy = json({ id: "d".repeat(64), os: "linux", architecture: "amd64", created,
      config: configValue.config, comment: message, container_config: neutral, docker_version: serverVersion });
    entries[`blobs/sha256/${sha256(legacy)}`] = legacy;
    entries.repositories = json({ "auto-world-import-fixture": { [owner]: diffID().slice(7) } });
  }
  const blocks = [];
  for (const [name, contents] of Object.entries(entries)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "ascii");
    for (const [offset, width, value] of [[100, 8, 420], [108, 8, 0], [116, 8, 0], [124, 12, contents.length], [136, 12, 1700000000]]) {
      header.write(`${value.toString(8).padStart(width - 1, "0")}\0`, offset, width, "ascii");
    }
    header.fill(32, 148, 156);
    header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    blocks.push(header, contents, Buffer.alloc((512 - contents.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return { bytes: Buffer.concat(blocks), id: `sha256:${sha256(classic ? config : manifest)}` };
}

function setup(t, customize = () => undefined) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-import-fixture-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "image-import-fixture");
  const work = path.join(root, `aw-image-import-${owner}`);
  const env = { PATH: process.env.PATH, GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", RUNNER_TEMP: root,
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "push",
    GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "123456789", GITHUB_SHA: "b".repeat(40),
    GITHUB_TOKEN: "hostile-secret-placeholder", DOCKER_HOST: "tcp://foreign.invalid", DOCKER_CONTEXT: "foreign" };
  const calls = [];
  let imported = false;
  let removed = false;
  const commandRunner = (args, options) => {
    calls.push({ args, options });
    const custom = customize({ args, options, imported, removed, root, output, work });
    if (custom) return custom;
    if (args[0] === "version") return ok("28.0.4|28.0.4\n");
    if (args[1] === "inspect" && args[2] !== "--format") return missing(args[2]);
    if (args[1] === "import") { imported = true; return ok(`${imageId}\n`); }
    if (args[1] === "inspect" && args[2] === "--format") return ok(JSON.stringify(metadata()));
    if (args[1] === "save") return { status: 1, stdout: "", stderr: "hostile-secret-placeholder" };
    if (args[1] === "rm") { removed = true; return ok(); }
    throw new Error("Unexpected Docker command");
  };
  return { root, work, output, env, calls, commandRunner,
    run: (overrides = {}) => runDiagnostic({ argv: ["--output", output], env, platform: "linux", commandRunner, ...overrides }),
    receipt: () => JSON.parse(readFileSync(path.join(output, "receipt.json"), "utf8")) };
}

test("import fixture accepts only exact Linux main attempt1 context and a fresh owned output", (t) => {
  const run = setup(t);
  assert.equal(validateContext(run.env, "linux").sourceSha, "b".repeat(40));
  assert.equal(validateContext({ ...run.env, GITHUB_EVENT_NAME: "workflow_dispatch" }, "linux").attempt, 1);
  for (const changes of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_REF: "refs/heads/other" },
    { GITHUB_REPOSITORY: "other/auto-world" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: "../foreign" },
    { GITHUB_SHA: "mutable" }, { GITHUB_ACTIONS: "false" }, { RUNNER_OS: "Windows" }]) {
    assert.throws(() => run.run({ env: { ...run.env, ...changes } }), /image_import_/u);
  }
  assert.throws(() => run.run({ platform: "win32" }), /requires_linux_actions/u);
  for (const argv of [[], ["--output", "relative"], ["--output", run.root], ["--output", run.output, "extra"]]) {
    assert.throws(() => run.run({ argv }), /output_invalid/u);
  }
  assert.equal(run.calls.length, 0);
  mkdirSync(run.output);
  writeFileSync(path.join(run.output, "foreign.txt"), "preserve");
  assert.throws(() => run.run(), /owned_path_exists/u);
  assert.equal(readFileSync(path.join(run.output, "foreign.txt"), "utf8"), "preserve");
});

test("import identity binds returned ID, unique tag, one layer, platform, size and runtime config", () => {
  assert.equal(validateImage(metadata(), { imageId, tag, owner }), diffID());
  for (const change of [{ Id: `sha256:${"c".repeat(64)}` }, { RepoTags: [tag, "foreign:tag"] }, { Os: "windows" },
    { Architecture: "arm64" }, { Size: 65537 }, { RootFS: { Type: "layers", Layers: [] } },
    { Config: { ...fixtureConfig(owner), User: "1000" } }]) {
    assert.throws(() => validateImage({ ...metadata(), ...change }, { imageId, tag, owner }), /image_import_/u);
  }
  const changes = importChanges(owner);
  assert.equal(changes.some((entry) => /^USER /u.test(entry)), false);
  assert.deepEqual(changes.filter((entry) => /^ENTRYPOINT|^CMD/u.test(entry)), [
    `ENTRYPOINT ${JSON.stringify(fixtureConfig(owner).Entrypoint)}`, `CMD ${JSON.stringify(fixtureConfig(owner).Cmd)}`,
  ]);
});

test("complete import/save fidelity and cleanup yield a public PASS receipt with actual identity semantics", (t) => {
  const saved = savedFixture();
  const run = setup(t, ({ args }) => {
    if (args[1] === "import") return ok(`${saved.id}\n`);
    if (args[2] === "--format") return ok(JSON.stringify({ ...metadata(), Id: saved.id }));
    if (args[1] === "save") { writeFileSync(args[3], saved.bytes); return ok(); }
  });
  const receipt = run.run();
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.archive.archiveSha256, sha256(saved.bytes));
  assert.equal(receipt.archive.diffID, diffID());
  assert.equal(receipt.image.identityType, "CONTAINERD_MANIFEST_ID");
  assert.equal(receipt.image.imageId, saved.id);
  assert.equal(receipt.cleanupOwnership, "EXACT_IMAGE_REMOVED_ABSENCE_VERIFIED");
  assert.equal(receipt.phases.every((phase) => phase.result === "PASSED"), true);
  assert.deepEqual(run.receipt(), receipt);
  assert.deepEqual(readdirSync(run.root), ["image-import-fixture"]);
  assert.deepEqual(readdirSync(run.output), ["receipt.json"]);
  assert.equal(receipt.imageExecution, "NOT_ATTEMPTED");
  assert.equal(receipt.publication, "NOT_ATTEMPTED");
  const imported = run.calls.find(({ args }) => args[1] === "import").args;
  assert.equal(imported.filter((arg) => arg === "--message").length, 1);
  assert.equal(imported[imported.indexOf("--message") + 1], "auto-world synthetic import fixture v1");
});

test("classic export is bound to the observed server version and still cleans up after a mismatch", (t) => {
  for (const exportedVersion of ["28.0.4", "28.0.5"]) {
    const saved = savedFixture({ classic: true, serverVersion: exportedVersion });
    const run = setup(t, ({ args }) => {
      if (args[0] === "version") return ok("29.0.0|28.0.4\n");
      if (args[1] === "import") return ok(`${saved.id}\n`);
      if (args[2] === "--format") return ok(JSON.stringify({ ...metadata(), Id: saved.id }));
      if (args[1] === "save") { writeFileSync(args[3], saved.bytes); return ok(); }
    });
    if (exportedVersion === "28.0.4") {
      const receipt = run.run();
      assert.equal(receipt.result, "PASSED");
      assert.equal(receipt.image.identityType, "CLASSIC_CONFIG_ID");
    } else assert.throws(() => run.run(), /image_import_save_config_invalid/u);
    assert.equal(run.receipt().tools.server, "28.0.4");
    assert.equal(run.receipt().cleanupOwnership, "EXACT_IMAGE_REMOVED_ABSENCE_VERIFIED");
    assert.equal(existsSync(run.work), false);
  }
});

test("failure after ownership removes only the exact image and temporary data, and keeps a sanitized FAILED receipt", (t) => {
  const run = setup(t);
  assert.throws(() => run.run(), /image_import_command_failed/u);
  const receipt = run.receipt();
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.cleanupOwnership, "EXACT_IMAGE_REMOVED_ABSENCE_VERIFIED");
  assert.equal(receipt.phases.find((phase) => phase.name === "save_and_verify").result, "FAILED");
  assert.equal(receipt.phases.at(-1).result, "PASSED");
  assert.equal(existsSync(run.work), false);
  assert.deepEqual(readdirSync(run.output), ["receipt.json"]);
  assert.doesNotMatch(JSON.stringify(receipt), /hostile-secret|foreign\.invalid/u);
  assert.deepEqual(run.calls.filter(({ args }) => args[1] === "rm").map(({ args }) => args), [["image", "rm", tag]]);
  assert.deepEqual(run.calls.slice(-2).map(({ args }) => args), [["image", "inspect", tag], ["image", "inspect", imageId]]);
  for (const { args, options } of run.calls) {
    assert.equal(args[0] === "version" || (args[0] === "image" && ["inspect", "import", "save", "rm"].includes(args[1])), true);
    assert.equal(options.env.DOCKER_HOST, "unix:///var/run/docker.sock");
    assert.equal(options.env.DOCKER_CONFIG, path.join(run.work, "docker-config"));
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.DOCKER_CONTEXT, undefined);
    assert.equal(options.timeout > 0 && options.timeout <= 120000, true);
  }
});

test("pre-existing tags and ambiguous absence errors never authorize import or deletion", (t) => {
  for (const result of [ok("[]"), { status: 1, stdout: "[]", stderr: "daemon unavailable" }]) {
    const run = setup(t, ({ args }) => args[1] === "inspect" ? result : undefined);
    assert.throws(() => run.run(), /image_import_(image_exists|absence_unproven)/u);
    assert.equal(run.calls.some(({ args }) => args[1] === "import" || args[1] === "rm"), false);
    assert.equal(run.receipt().cleanupOwnership, "NOT_ESTABLISHED_NO_IMAGE_REMOVAL");
  }
});

test("returned versus inspected identity mismatch preserves ambiguous image", (t) => {
  const run = setup(t, ({ args }) => args[2] === "--format" ? ok(JSON.stringify({ ...metadata(), Id: `sha256:${"c".repeat(64)}` })) : undefined);
  assert.throws(() => run.run(), /image_import_image_identity_invalid/u);
  assert.equal(run.calls.some(({ args }) => ["save", "rm"].includes(args[1])), false);
  assert.equal(run.receipt().cleanupOwnership, "NOT_ESTABLISHED_NO_IMAGE_REMOVAL");
});

test("ownership is rechecked before deletion and deletion absence must be proven", (t) => {
  let inspections = 0;
  const changed = setup(t, ({ args }) => {
    if (args[2] === "--format" && ++inspections > 1) return ok(JSON.stringify({ ...metadata(), RepoTags: ["foreign:tag"] }));
  });
  assert.throws(() => changed.run(), /image_import_command_failed/u);
  assert.equal(changed.calls.some(({ args }) => args[1] === "rm"), false);
  assert.equal(changed.receipt().phases.find((phase) => phase.name === "image_cleanup").result, "FAILED");
  const remains = setup(t, ({ args, removed }) => args[1] === "inspect" && args[2] === imageId && removed ? ok("[]") : undefined);
  assert.throws(() => remains.run(), /image_import_command_failed/u);
  assert.equal(remains.receipt().phases.find((phase) => phase.name === "image_cleanup").reason, "image_import_image_exists");
});

test("archive integrity failure still reaches image cleanup and exposes no raw archive bytes", (t) => {
  const run = setup(t, ({ args }) => {
    if (args[1] === "save") { writeFileSync(args[3], "hostile-secret-placeholder"); return ok(); }
  });
  assert.throws(() => run.run(), /image_import_/u);
  assert.equal(run.receipt().cleanupOwnership, "EXACT_IMAGE_REMOVED_ABSENCE_VERIFIED");
  assert.doesNotMatch(JSON.stringify(run.receipt()), /hostile-secret/u);
});

test("a replaced temporary directory is preserved rather than recursively removed", (t) => {
  const run = setup(t, ({ args, work }) => {
    if (args[1] === "save") {
      renameSync(work, `${work}-original`);
      mkdirSync(work);
      writeFileSync(path.join(work, "foreign.txt"), "preserve");
      return { status: 1, stdout: "", stderr: "failed" };
    }
  });
  assert.throws(() => run.run(), /image_import_command_failed/u);
  assert.equal(readFileSync(path.join(run.work, "foreign.txt"), "utf8"), "preserve");
  assert.equal(run.receipt().phases.at(-1).reason, "image_import_owned_directory_changed");
});
