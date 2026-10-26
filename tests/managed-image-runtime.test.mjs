import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CASE_NAMES, containerSignature, createRuntimeCompose, prepareRuntimeContext, readVerifiedRuntimeFile,
  validateRuntimeInput, verifyRuntimeReferences } from "./managed-image-runtime.integration.mjs";

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const root = path.resolve(os.tmpdir(), "aw-runtime-contract-fixture");
const run = { sourceCommit: "a".repeat(40), runId: "90001", attempt: "2" };
const hash = "b".repeat(64), imageId = (index) => `sha256:${String(index + 1).repeat(64)}`;
const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const proof = (name, size = 1) => ({ path: path.join(root, name), size, sha256: hash });
const credentials = { postgres: "1".repeat(64), redis: "2".repeat(64), s3Access: "3".repeat(64), s3Secret: "4".repeat(64) };
const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function fixture() {
  return { schemaVersion: 1, run: clone(run), ownerToken: "11111111-1111-4111-8111-111111111111", sourceInputs: [proof("bootstrap.sh")],
    roles: ["postgres", "opensearch", "redis", "seaweedfs", "aws-cli"].map((role, index) => ({ role, imageId: imageId(index), platform: "linux/amd64",
      reports: { json: proof(`${role}.json`), sbom: proof(`${role}.cdx.json`) }, evidence: [proof(`${role}-evidence.txt`)],
      subject: ["postgres", "opensearch", "aws-cli"].includes(role)
        ? { kind: "LOCAL_MANAGED_IMAGE_V1", imageId: imageId(index), os: "linux", architecture: "amd64", archiveSha256: hash,
          archiveBytes: 512, archiveCapBytes: (role === "opensearch" ? 4 : 2) * GiB, artifactName: `/managed-image-${role}.tar` }
        : { kind: "UPSTREAM_REGISTRY_SUBJECT", repository: role === "redis" ? "library/redis" : "chrislusf/seaweedfs",
          manifestDigest: `sha256:${"c".repeat(64)}`, platform: { os: "linux", architecture: "amd64", variant: null, digest: `sha256:${"d".repeat(64)}` } },
    })) };
}

const linuxNonRoot = process.platform === "linux" && typeof process.getuid === "function" && process.getuid() !== 0;
const bytesHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function writeProof(file, bytes) {
  await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  return { path: file, size: bytes.length, sha256: bytesHash(bytes) };
}
async function startupFixture(directory, mutate = () => {}) {
  const value = fixture();
  const bootstrap = fileURLToPath(new URL("../infra/object-store-init.sh", import.meta.url));
  const bootstrapBytes = await fs.readFile(bootstrap);
  const bootstrapProof = { path: bootstrap, size: bootstrapBytes.length, sha256: bytesHash(bootstrapBytes) };
  value.sourceInputs = [bootstrapProof];
  const emptyEvidence = await writeProof(path.join(directory, "test-output-fixture.log"), Buffer.alloc(0));
  for (const role of value.roles) {
    const artifactName = role.subject.kind === "LOCAL_MANAGED_IMAGE_V1" ? role.subject.artifactName :
      `${role.subject.repository}@${role.subject.platform.digest}`;
    role.reports.json = await writeProof(path.join(directory, `${role.role}.json`),
      Buffer.from(JSON.stringify({ ArtifactName: artifactName, Metadata: { ImageID: role.imageId, ImageConfig: { os: "linux", architecture: "amd64" } } })));
    role.reports.sbom = await writeProof(path.join(directory, `${role.role}.cdx.json`),
      Buffer.from(JSON.stringify({ bomFormat: "CycloneDX", metadata: { component: { name: artifactName } } })));
    role.evidence = [emptyEvidence];
  }
  mutate(value, { bootstrapProof, emptyEvidence });
  const inputFile = path.join(directory, "runtime-input.json");
  const inputProof = await writeProof(inputFile, Buffer.from(JSON.stringify(value)));
  return { emptyEvidence, environment: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_TEMP: directory,
    GITHUB_SHA: run.sourceCommit, GITHUB_RUN_ID: run.runId, GITHUB_RUN_ATTEMPT: run.attempt,
    AW_MANAGED_RUNTIME_INPUT: inputFile, AW_MANAGED_RUNTIME_INPUT_SHA256: inputProof.sha256 } };
}

test("runtime contract import exposes four gated cases without executing or registering integration cases", () => {
  assert.deepEqual(CASE_NAMES, ["start-and-refusal", "sql-raw-index", "restart-persistence", "cold-canonical-restore"]);
  const imported = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(new URL("./managed-image-runtime.integration.mjs", import.meta.url).href)})`],
    { env: { SystemRoot: process.env.SystemRoot ?? "", GITHUB_ACTIONS: "false" }, timeout: 5000, maxBuffer: MiB, encoding: "utf8" });
  assert.equal(imported.error, undefined); assert.equal(imported.status, 0); assert.equal(imported.stdout, ""); assert.equal(imported.stderr, "");
});
test("runtime input accepts complete frozen synthetic proofs and exact byte caps without mutation", () => {
  const value = fixture(); value.sourceInputs[0].size = MiB;
  for (const role of value.roles) { role.reports.json.size = 64 * MiB; role.evidence[0].size = 4 * MiB; if (role.subject.archiveCapBytes) role.subject.archiveBytes = role.subject.archiveCapBytes; }
  const before = JSON.stringify(value); freeze(value); assert.equal(validateRuntimeInput(value, freeze(clone(run))), value); assert.equal(JSON.stringify(value), before);
});
test("runtime input accepts only the canonical empty hash for typed role evidence", () => {
  const value = fixture(); value.roles[1].evidence[0] = { ...proof("empty-evidence.log", 0), sha256: emptyHash };
  assert.equal(validateRuntimeInput(value, run), value);
  for (const mutate of [
    (changed) => { changed.roles[1].evidence[0].sha256 = hash; },
    (changed) => { changed.roles[1].reports.json = { ...changed.roles[1].evidence[0] }; },
    (changed) => { changed.roles[1].reports.sbom = { ...changed.roles[1].evidence[0] }; },
    (changed) => { changed.sourceInputs[0] = { ...changed.roles[1].evidence[0] }; },
  ]) {
    const changed = clone(value); mutate(changed); assert.throws(() => validateRuntimeInput(changed, run));
  }
});
test("runtime reader keeps canonical empty authority evidence-only across real reads", { skip: !linuxNonRoot }, async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aw-runtime-empty-reader-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.chmod(directory, 0o700);
  const empty = path.join(directory, "empty.log"), emptyProof = await writeProof(empty, Buffer.alloc(0));
  const first = await readVerifiedRuntimeFile(empty, MiB, emptyProof, "evidence");
  assert.equal(first.size, 0); assert.equal(first.sha256, emptyHash);
  await readVerifiedRuntimeFile(empty, MiB, { ...emptyProof, identity: first.identity }, "evidence");
  await assert.rejects(readVerifiedRuntimeFile(empty, MiB, emptyProof));
  await assert.rejects(readVerifiedRuntimeFile(empty, MiB, { ...emptyProof, size: 1 }, "evidence"));
  await assert.rejects(readVerifiedRuntimeFile(empty, MiB, { ...emptyProof, sha256: hash }, "evidence"));

  const nonempty = path.join(directory, "nonempty.log"), nonemptyProof = await writeProof(nonempty, Buffer.from("x"));
  await assert.rejects(readVerifiedRuntimeFile(nonempty, MiB, { ...nonemptyProof, sha256: emptyHash }, "evidence"));
  await assert.rejects(readVerifiedRuntimeFile(path.join(directory, "missing.log"), MiB, emptyProof, "evidence"));
  const symbolic = path.join(directory, "symbolic.log"); await fs.symlink(empty, symbolic);
  await assert.rejects(readVerifiedRuntimeFile(symbolic, MiB, { ...emptyProof, path: symbolic }, "evidence"));
  const hard = path.join(directory, "hard.log"); await fs.link(empty, hard);
  await assert.rejects(readVerifiedRuntimeFile(empty, MiB, emptyProof, "evidence"));
  await assert.rejects(readVerifiedRuntimeFile(hard, MiB, { ...emptyProof, path: hard }, "evidence"));
});
test("runtime startup preparation retains typed empty evidence through deduplication and revalidation", { skip: !linuxNonRoot }, async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aw-runtime-empty-startup-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.chmod(directory, 0o700);
  const { emptyEvidence, environment } = await startupFixture(directory);
  const runtime = await prepareRuntimeContext(environment);
  assert.deepEqual(runtime.references.filter((item) => item.path === emptyEvidence.path)
    .map(({ size, sha256, referenceType }) => ({ size, sha256, referenceType })), [{ size: 0, sha256: emptyHash, referenceType: "evidence" }]);
  await verifyRuntimeReferences(runtime);
  await fs.rmdir(runtime.directory);
});
test("runtime startup rejects cross-type references while preserving same-type evidence deduplication", { skip: !linuxNonRoot }, async (context) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "aw-runtime-reference-types-"));
  context.after(() => fs.rm(parent, { recursive: true, force: true }));
  await fs.chmod(parent, 0o700);
  const collisions = [
    (value, proofs) => { value.roles[0].reports.json = { ...proofs.bootstrapProof }; },
    (value, proofs) => { value.roles[0].evidence = [{ ...proofs.bootstrapProof }]; },
    (value) => { value.roles[0].evidence = [{ ...value.roles[0].reports.json }]; },
  ];
  for (const [index, mutate] of collisions.entries()) {
    const directory = path.join(parent, `case-${index}`); await fs.mkdir(directory, { mode: 0o700 });
    const { environment } = await startupFixture(directory, mutate);
    await assert.rejects(prepareRuntimeContext(environment));
  }
});
for (const [name, mutate] of [
  ["top-level array", () => []], ["unknown field", (v) => { v.privateText = "not allowed"; }],
  ["coerced owner", (v) => { v.ownerToken = [v.ownerToken]; }], ["stale source", (v) => { v.run.sourceCommit = "e".repeat(40); }],
  ["stale run", (v) => { v.run.runId = "90002"; }], ["numeric attempt", (v) => { v.run.attempt = 2; }],
  ["coerced source", (v) => { v.run.sourceCommit = [v.run.sourceCommit]; }], ["missing role", (v) => { v.roles.pop(); }],
  ["duplicate role", (v) => { v.roles[1] = clone(v.roles[0]); }], ["unknown role", (v) => { v.roles[0].role = "foreign"; }],
  ["coerced role", (v) => { v.roles[0].role = ["postgres"]; }], ["coerced image", (v) => { v.roles[0].imageId = [v.roles[0].imageId]; }],
  ["substituted managed subject", (v) => { v.roles[0].subject.imageId = imageId(4); }], ["wrong platform", (v) => { v.roles[0].platform = "linux/arm64"; }],
  ["wrong upstream repository", (v) => { v.roles[2].subject.repository = "foreign/redis"; }], ["coerced upstream digest", (v) => { v.roles[2].subject.platform.digest = [imageId(2)]; }],
  ["missing source proofs", (v) => { v.sourceInputs = []; }], ["sparse source proofs", (v) => { v.sourceInputs = Array(1); }],
  ["missing managed proofs", (v) => { v.roles[0].evidence = []; }], ["sparse managed proofs", (v) => { v.roles[0].evidence = Array(1); }],
  ["malformed source proof", (v) => { v.sourceInputs[0] = null; }], ["missing SBOM proof", (v) => { delete v.roles[0].reports.sbom; }],
  ["relative proof path", (v) => { v.sourceInputs[0].path = "relative.txt"; }], ["coerced proof path", (v) => { v.sourceInputs[0].path = [v.sourceInputs[0].path]; }],
  ["uppercase proof hash", (v) => { v.sourceInputs[0].sha256 = "B".repeat(64); }], ["coerced proof hash", (v) => { v.sourceInputs[0].sha256 = [hash]; }],
  ["numeric proof size string", (v) => { v.sourceInputs[0].size = "1"; }], ["source proof over cap", (v) => { v.sourceInputs[0].size = MiB + 1; }],
  ["zero proof size", (v) => { v.sourceInputs[0].size = 0; }], ["extra proof field", (v) => { v.sourceInputs[0].privateText = "not allowed"; }],
  ["report proof over cap", (v) => { v.roles[0].reports.json.size = 64 * MiB + 1; }], ["evidence proof over cap", (v) => { v.roles[0].evidence[0].size = 4 * MiB + 1; }],
  ["zero archive bytes", (v) => { v.roles[0].subject.archiveBytes = 0; }], ["archive over cap", (v) => { v.roles[0].subject.archiveBytes = 2 * GiB + 1; }],
  ["coerced archive hash", (v) => { v.roles[0].subject.archiveSha256 = [hash]; }],
]) test(`runtime input rejects ${name}`, () => { const value = fixture(); const replaced = mutate(value); assert.throws(() => validateRuntimeInput(replaced ?? value, run)); });
test("runtime input requires each role's exact archive ceiling rather than an adjustable limit", () => {
  for (const index of [0, 1, 4]) for (const delta of [-1, 1]) { const value = fixture(); value.roles[index].subject.archiveCapBytes += delta; assert.throws(() => validateRuntimeInput(value, run)); }
});
test("runtime run syntax remains strict even when an invalid value matches the parent binding", () => {
  for (const [key, invalid] of [["sourceCommit", "A".repeat(40)], ["runId", "01"], ["runId", "9".repeat(25)], ["attempt", "0"], ["attempt", ["2"]]]) {
    const value = fixture(); value.run[key] = invalid; assert.throws(() => validateRuntimeInput(value, clone(value.run)));
  }
});

test("runtime manifests isolate fresh source and restore projects while retaining exact subjects and safety boundaries", () => {
  const input = freeze(fixture()), before = JSON.stringify(input), projects = [randomUUID(), randomUUID()].map((id) => `aw-test-${id}`);
  const base = JSON.parse(readFileSync(new URL("../infra/compose.json", import.meta.url), "utf8"));
  const manifests = projects.map((project, index) => createRuntimeCompose(input, project, path.join(root, project), freeze(credentials), { restore: index === 1 }));
  const serviceRoles = { postgres: "postgres", opensearch: "opensearch", redis: "redis", "object-store": "seaweedfs" };
  for (const [index, manifest] of manifests.entries()) {
    assert.deepEqual(Object.keys(manifest).sort(), ["networks", "services", "volumes"]);
    assert.deepEqual(Object.keys(manifest.services).sort(), Object.keys(serviceRoles).sort());
    for (const [name, service] of Object.entries(manifest.services)) {
      assert.equal(service.image, input.roles.find((role) => role.role === serviceRoles[name]).imageId); assert.equal(service.platform, "linux/amd64");
      assert.equal(service.pull_policy, "never"); assert.equal(service.tty, false); assert.equal(service.stdin_open, false); assert.equal(service.logging.driver, "none");
      assert.equal(service.container_name, `${projects[index]}-${name}`); assert.deepEqual(service.labels, { "io.auto-world.owner": input.ownerToken });
      assert.equal(Boolean(service.volumes[0].volume?.nocopy), index === 1 || name === "object-store");
      assert.ok(service.ports.every((port) => port.host_ip === "127.0.0.1" && port.protocol === "tcp" && !Object.hasOwn(port, "published")));
      assert.equal(service.ports[0].target, base.services[name].ports[0].target);
      for (const limit of ["cpus", "pids_limit", "mem_limit", "stop_grace_period"]) assert.equal(service[limit], base.services[name][limit]);
      for (const forbidden of ["profiles", "build", "privileged", "network_mode"]) assert.equal(Object.hasOwn(service, forbidden), false);
    }
    for (const volume of Object.values(manifest.volumes)) { assert.ok(volume.name.startsWith(`${projects[index]}_`)); assert.deepEqual(volume.labels, { "io.auto-world.owner": input.ownerToken }); }
    assert.equal(manifest.networks.foundation.name, `${projects[index]}_foundation`); assert.equal(manifest.networks.foundation.driver_opts["com.docker.network.bridge.host_binding_ipv4"], "127.0.0.1");
    assert.equal(manifest.networks.foundation.driver, "bridge"); assert.equal(manifest.networks.foundation.internal, false); assert.deepEqual(manifest.networks.foundation.labels, { "io.auto-world.owner": input.ownerToken });
    const mounts = manifest.services["object-store"].volumes.filter((mount) => mount.type === "bind");
    assert.deepEqual(mounts.map((mount) => [mount.source, mount.target, mount.read_only]), [[path.join(root, projects[index], "s3.json"), "/run/aw-input/s3.json", true], [path.join(root, projects[index], "object-store-init.sh"), "/run/aw/bootstrap.sh", true]]);
  }
  assert.notEqual(projects[0], projects[1]); assert.equal(JSON.stringify(input), before);
  assert.equal(Object.values(manifests[0].services).some((service) => service.image === input.roles[4].imageId), false);
  const standard = createRuntimeCompose(input, projects[0], path.join(root, projects[0]), credentials);
  assert.deepEqual(standard, manifests[0]);
});
test("runtime manifest rejects malformed project, directory, credentials and restore options", () => {
  const args = [fixture(), `aw-test-${randomUUID()}`, root, credentials];
  for (const [index, value] of [[1, "aw-local-old"], [1, [args[1]]], [2, "relative"], [3, { ...credentials, postgres: [credentials.postgres] }]]) {
    const changed = [...args]; changed[index] = value; assert.throws(() => createRuntimeCompose(...changed));
  }
  for (const options of [null, [], { restore: "true" }, { restore: 1 }, { restore: true, extra: true }]) assert.throws(() => createRuntimeCompose(...args, options));
});
test("runtime service commands and raw bootstrap match actual infrastructure while core uses its direct entrypoint", () => {
  const base = JSON.parse(readFileSync(new URL("../infra/compose.json", import.meta.url), "utf8"));
  const generated = createRuntimeCompose(fixture(), `aw-test-${randomUUID()}`, root, credentials).services;
  for (const name of ["postgres", "object-store"]) assert.deepEqual(generated[name].command, base.services[name].command);
  assert.deepEqual(generated["object-store"].entrypoint, base.services["object-store"].entrypoint); assert.deepEqual(generated["object-store"].tmpfs, base.services["object-store"].tmpfs);
  assert.equal(Object.hasOwn(generated.opensearch, "command"), false);
  assert.equal(Object.hasOwn(generated.opensearch, "entrypoint"), false);
  const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  assert.match(source("infra/object-store-init.sh"), /chown 1000:1000 \/run\/aw-private \/run\/aw-private\/s3\.json/u);
  assert.match(source("infra/managed-images/Dockerfile.postgres"), /test "\$\(id -u postgres\):\$\(id -g postgres\)" = '70:70'/u);
  const core = source("infra/managed-images/Dockerfile.opensearch-core"); assert.match(core, /USER 1000:1000/u); assert.match(core, /ENTRYPOINT \["\/usr\/share\/opensearch\/bin\/opensearch"\]\r?\nCMD \[\]/u);
  assert.match(core, /OPENSEARCH_PATH_CONF=\/usr\/share\/opensearch\/config/u);
  const config = source("infra/managed-images/opensearch-core/opensearch.yml");
  for (const setting of ["discovery.type: single-node", "network.host: 0.0.0.0", "path.data: /usr/share/opensearch/data", "bootstrap.memory_lock: true"]) assert.ok(config.split(/\r?\n/u).includes(setting));
});

function inspectedPostgres(restore = false, binds = false) {
  const context = { input: fixture() }, project = { project: `aw-test-${randomUUID()}`, restore };
  const volume = `${project.project}_postgres-data`, target = "/var/lib/postgresql/data";
  const declaration = { Type: "volume", Source: volume, Target: target, ReadOnly: false, VolumeOptions: { NoCopy: restore } };
  const value = { Id: "f".repeat(64), Image: context.input.roles[0].imageId, Name: `/${project.project}-postgres`, State: { Status: "running" },
    Config: { Tty: false, OpenStdin: false, Labels: { "io.auto-world.owner": context.input.ownerToken, "com.docker.compose.project": project.project, "com.docker.compose.service": "postgres" } },
    HostConfig: { Privileged: false, NetworkMode: `${project.project}_foundation`, ...(binds ? { Binds: [`${volume}:${target}:rw`] } : { Mounts: [declaration] }) },
    Mounts: [{ Type: "volume", Name: volume, Source: `/var/lib/docker/volumes/${volume}/_data`, Destination: target, Driver: "local", Mode: "rw", RW: true, Propagation: "" }] };
  return { context, project, value, volume, target, declaration };
}
for (const [name, restore, binds] of [["source Binds without HostConfig.Mounts", false, true], ["source Mounts", false, false], ["restore Mounts", true, false]]) {
  test(`runtime inspection accepts exact ${name} declarations without mutating the Docker observation`, async () => {
    const data = freeze(inspectedPostgres(restore, binds)), before = JSON.stringify(data);
    const signature = await containerSignature(data.context, data.project, "postgres", data.value);
    assert.deepEqual(JSON.parse(signature), [data.value.Id, data.value.Image, data.value.Mounts]); assert.equal(JSON.stringify(data), before);
  });
}
for (const [name, change, restore = false, binds = false] of [
  ["wrong declared source", (d) => { d.value.HostConfig.Mounts[0].Source = "foreign-volume"; }],
  ["wrong declared target", (d) => { d.value.HostConfig.Mounts[0].Target = "/foreign"; }],
  ["read-only declaration contradicting the effective mount", (d) => { d.value.HostConfig.Mounts[0].ReadOnly = true; }],
  ["source NoCopy true", (d) => { d.value.HostConfig.Mounts[0].VolumeOptions.NoCopy = true; }],
  ["restore NoCopy false", (d) => { d.value.HostConfig.Mounts[0].VolumeOptions.NoCopy = false; }, true],
  ["restore missing NoCopy", (d) => { delete d.value.HostConfig.Mounts[0].VolumeOptions; }, true],
  ["restore copy-default Binds", () => {}, true, true],
  ["duplicate Mounts declarations", (d) => { d.value.HostConfig.Mounts.push(clone(d.declaration)); }],
  ["ambiguous Binds plus Mounts", (d) => { d.value.HostConfig.Binds = [`${d.volume}:${d.target}:rw`]; }],
  ["conflicting Binds plus Mounts", (d) => { d.value.HostConfig.Binds = [`foreign:${d.target}:rw`]; }],
  ["extra declaration absent from effective mounts", (d) => { d.value.HostConfig.Mounts.push({ ...clone(d.declaration), Target: "/foreign" }); }],
  ["wrong Binds volume", (d) => { d.value.HostConfig.Binds[0] = `foreign:${d.target}:rw`; }, false, true],
  ["wrong Binds target", (d) => { d.value.HostConfig.Binds[0] = `${d.volume}:/foreign:rw`; }, false, true],
  ["read-only Binds mode", (d) => { d.value.HostConfig.Binds[0] = `${d.volume}:${d.target}:ro`; }, false, true],
  ["duplicate Binds", (d) => { d.value.HostConfig.Binds.push(d.value.HostConfig.Binds[0]); }, false, true],
  ["substituted effective mount", (d) => { d.value.Mounts[0].Name = "foreign-volume"; }],
  ["read-only effective mount", (d) => { d.value.Mounts[0].RW = false; }],
  ["wrong owner label", (d) => { d.value.Config.Labels["io.auto-world.owner"] = randomUUID(); }],
  ["wrong config image ID", (d) => { d.value.Image = imageId(4); }],
]) test(`runtime inspection refuses ${name}`, async () => {
  const data = inspectedPostgres(restore, binds); change(data);
  await assert.rejects(containerSignature(data.context, data.project, "postgres", freeze(data.value)));
});
