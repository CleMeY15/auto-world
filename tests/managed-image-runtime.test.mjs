import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { CASE_NAMES, createRuntimeCompose, validateRuntimeInput } from "./managed-image-runtime.integration.mjs";

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const root = path.resolve(os.tmpdir(), "aw-runtime-contract-fixture");
const run = { sourceCommit: "a".repeat(40), runId: "90001", attempt: "2" };
const hash = "b".repeat(64), imageId = (index) => `sha256:${String(index + 1).repeat(64)}`;
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
  ["archive over cap", (v) => { v.roles[0].subject.archiveBytes = 2 * GiB + 1; }], ["coerced archive hash", (v) => { v.roles[0].subject.archiveSha256 = [hash]; }],
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
