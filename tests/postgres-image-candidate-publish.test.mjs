import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import lock from "../infra/postgres-image/lock.json" with { type: "json" };
import {
  POSTGRES_CANDIDATE_PUBLISH, classifyRemoteTagAbsence, parseCandidatePublishArguments, runPostgresCandidatePublish,
  defaultCommandRunner, readBoundedDockerFile, validateBaseManifest, validateCandidatePublishContext,
} from "../scripts/postgres-image/candidate-publish.mjs";
import { validatePostgresCandidateRemoteManifest } from "../scripts/postgres-image/candidate-proof.mjs";
import { validatePostgresConfigDelta } from "../scripts/postgres-image/evidence.mjs";

const sourceSha = "a".repeat(40);
const baseId = lock.base.configId;
const candidateId = `sha256:${"c".repeat(64)}`;
const candidateParentId = `sha256:${"8".repeat(64)}`;
const baseLayers = Array.from({ length: 10 }, (_, index) => `sha256:${String(index + 1).repeat(64).slice(0, 64)}`);
const candidateLayers = [...baseLayers, `sha256:${"b".repeat(64)}`, `sha256:${"d".repeat(64)}`];
const descriptors = baseLayers.map((digest, index) => ({
  mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest, size: 1_000 + index,
}));
const baseManifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: baseId, size: 4_000 }, layers: descriptors,
  annotations: { "org.opencontainers.image.version": "17.11-alpine3.24" } });
const dockerLayerType = "application/vnd.docker.image.rootfs.diff.tar.gzip";
const remoteManifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json",
  config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: candidateId, size: 5_000 },
  layers: [...descriptors.map((layer) => ({ ...layer, mediaType: dockerLayerType })),
    { mediaType: dockerLayerType, digest: `sha256:${"e".repeat(64)}`, size: 2_001 },
    { mediaType: dockerLayerType, digest: `sha256:${"f".repeat(64)}`, size: 2_002 }] });

function fixture(runId = "36380000001") {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-candidate-publish-"));
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: "publish",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: POSTGRES_CANDIDATE_PUBLISH.repository,
    GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: runId, GITHUB_RUN_NUMBER: "1", GITHUB_SHA: sourceSha,
    GITHUB_TOKEN: "test-registry-token", GITHUB_WORKFLOW_REF:
      `${POSTGRES_CANDIDATE_PUBLISH.repository}/${POSTGRES_CANDIDATE_PUBLISH.workflowPath}@refs/heads/main`,
    GITHUB_WORKSPACE: process.cwd(), RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_TEMP: runnerTemp,
  };
  return { env, output: path.join(runnerTemp, POSTGRES_CANDIDATE_PUBLISH.outputDirectory), runnerTemp };
}
function remoteReference(item) {
  return `${POSTGRES_CANDIDATE_PUBLISH.image}:candidate-${item.env.GITHUB_RUN_ID}-attempt-1`;
}

function response(value, status = 200) { return new globalThis.Response(JSON.stringify(value), { status }); }
function inspectBase() {
  return [{ Id: baseId, Os: "linux", Architecture: "amd64", RepoDigests: [`postgres@${lock.base.platformDigest}`],
    RootFS: { Type: "layers", Layers: baseLayers }, Config: { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"],
      Image: "", User: "", ExposedPorts: { "5432/tcp": {} }, Labels: {} } }];
}
function inspectCandidate(nonce) {
  return [{ Id: candidateId, Os: "linux", Architecture: "amd64", RepoDigests: [], RepoTags: [`aw-postgres-gosu:${nonce}`],
    Parent: candidateParentId,
    RootFS: { Type: "layers", Layers: candidateLayers }, Config: { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"],
      Image: candidateParentId, User: "", ExposedPorts: { "5432/tcp": {} }, Labels: {
        "com.auto-world.postgres-diagnostic": nonce,
        "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime",
      } } }];
}

function fake(item, { protectedMain = true, protectedSequence, pushFails = false, pushFailsButPublishes = false,
  injectForeignImage = false, orphanBaseId = false, candidateAnonymous = "denied",
  substituteExportImage = false, inheritedVolumeMount = false, remoteTagCheckResult } = {}) {
  const events = []; const containers = new Map(); let basePresent = orphanBaseId; let baseRefPresent = false;
  let candidatePresent = false;
  let pushed = false; let tagged = false; let foreignPresent = false; let createCounter = 0;
  const candidateTags = new Set();
  const nonce = (awaitHash(`${sourceSha}:${item.env.GITHUB_RUN_ID}:1`)).slice(0, 24);
  const remoteReference = `${POSTGRES_CANDIDATE_PUBLISH.image}:candidate-${item.env.GITHUB_RUN_ID}-attempt-1`;
  const imageInventory = () => [
    ...(basePresent ? [baseId] : []), ...(candidatePresent ? [candidateId] : []),
    ...(foreignPresent ? [`sha256:${"9".repeat(64)}`] : []),
  ].sort();
  const commandRunner = (command, args, options) => {
    events.push({ kind: "command", command, args: [...args], env: { ...options.env }, input: options.input });
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    if (command === "git") {
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
      if (args[0] === "show") return { status: 0, stdout: readFileSync(path.join(process.cwd(), args[1].slice(5))), stderr: "" };
    }
    assert.equal(command, "docker");
    if (args[0] === "version") return { status: 0, stdout: JSON.stringify({ Client: { Version: "28.0.4" },
      Server: { Version: "28.0.4", Platform: { Name: "Docker Engine - Community" } } }), stderr: "" };
    if (args[0] === "info") return { status: 0, stdout: JSON.stringify({ ServerVersion: "28.0.4", Driver: "overlay2",
      CgroupVersion: "2", MemoryLimit: true, SwapLimit: true, CpuCfsQuota: true, CpuCfsPeriod: true,
      OSType: "linux", Architecture: "x86_64" }), stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.1", stderr: "" };
    if (args[0] === "image" && args[1] === "ls") return { status: 0, stdout: `${imageInventory().join("\n")}${imageInventory().length ? "\n" : ""}`, stderr: "" };
    if (args[0] === "container" && args[1] === "ls") return { status: 0, stdout: `${[...containers.keys()].join("\n")}${containers.size ? "\n" : ""}`, stderr: "" };
    if (args[0] === "volume" && args[1] === "ls") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "buildx" && args[1] === "imagetools") {
      const ref = args.at(-1); const anonymous = options.env.DOCKER_CONFIG.includes("docker-anonymous");
      if (ref === `postgres@${lock.base.platformDigest}`) return { status: 0, stdout: baseManifest, stderr: "" };
      if (anonymous && pushed && ref.startsWith(`${POSTGRES_CANDIDATE_PUBLISH.image}@sha256:`)) {
        if (candidateAnonymous === "public") return { status: 0, stdout: remoteManifest, stderr: "" };
        if (candidateAnonymous === "ambiguous") return { status: 1, stdout: "", stderr: "temporary failure" };
      }
      if (anonymous) return { status: 1, stdout: "", stderr: "unauthorized: authentication required" };
      if (ref.includes("@sha256:9ee2")) return { status: 0, stdout: "bootstrap-raw", stderr: "" };
      if (ref === remoteReference) return pushed
        ? { status: 0, stdout: remoteManifest, stderr: "" }
        : remoteTagCheckResult ?? { status: 1, stdout: "", stderr: `ERROR: ${remoteReference}: not found` };
      if (pushed && ref.startsWith(`${POSTGRES_CANDIDATE_PUBLISH.image}@sha256:`)) {
        return { status: 0, stdout: remoteManifest, stderr: "" };
      }
    }
    if (args[0] === "pull") { basePresent = true; baseRefPresent = true; return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "build") { candidatePresent = true; candidateTags.add(args[args.indexOf("--tag") + 1]);
      foreignPresent = injectForeignImage; return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "image" && args[1] === "inspect") {
      const ref = args.at(-1);
      if (ref === `postgres@${lock.base.platformDigest}` && baseRefPresent) return { status: 0, stdout: JSON.stringify(inspectBase()), stderr: "" };
      if ((candidateTags.has(ref) || ref === candidateId) && candidatePresent) {
        return { status: 0, stdout: JSON.stringify(inspectCandidate(nonce)), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `Error: No such image: ${ref}` };
    }
    if (args[0] === "create") {
      createCounter += 1; const id = String(createCounter).repeat(64); const name = args[args.indexOf("--name") + 1];
      const imageId = substituteExportImage ? `sha256:${"9".repeat(64)}`
        : args.at(-1) === `postgres@${lock.base.platformDigest}` ? baseId : candidateId;
      containers.set(id, { name, imageId }); return { status: 0, stdout: `${id}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const ref = args.at(-1); const entry = containers.get(ref) ?? [...containers.entries()].find(([, value]) => value.name === ref)?.[1];
      const id = containers.has(ref) ? ref : [...containers.entries()].find(([, value]) => value.name === ref)?.[0];
      if (!entry) return { status: 1, stdout: "", stderr: `Error: No such container: ${ref}` };
      return { status: 0, stdout: JSON.stringify([{ Id: id, Name: `/${entry.name}`, Image: entry.imageId,
        State: { Status: "created", Running: false }, Mounts: inheritedVolumeMount
          ? [{ Type: "volume", Destination: "/var/lib/postgresql/data" }] : [],
        Config: { Labels: { "com.auto-world.postgres-diagnostic": nonce,
          "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime" } },
        HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"],
          Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=16777216,mode=0700" } } }]), stderr: "" };
    }
    if (args[0] === "export") { writeFileSync(args[args.indexOf("--output") + 1], "rootfs"); return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "image" && args[1] === "save") { writeFileSync(args[args.indexOf("--output") + 1], "archive"); return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded", stderr: "" };
    if (args[0] === "tag") { tagged = true; candidateTags.add(args[2]); return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "push") { assert.equal(tagged, true);
      if (pushFailsButPublishes) { pushed = true; return { status: 1, stdout: "", stderr: "transport closed" }; }
      if (pushFails) return { status: 1, stdout: "", stderr: "transport closed" };
      pushed = true; return { status: 0, stdout: "pushed", stderr: "" }; }
    if (args[0] === "rm") { containers.delete(args.at(-1)); return { status: 0, stdout: args.at(-1), stderr: "" }; }
    if (args[0] === "image" && args[1] === "rm") {
      const reference = args[2];
      if (reference === candidateId) { candidateTags.clear(); candidatePresent = false; }
      else if (candidateTags.has(reference)) { candidateTags.delete(reference); candidatePresent = candidateTags.size > 0; }
      if (args.includes(`postgres@${lock.base.platformDigest}`)) { basePresent = false; baseRefPresent = false; }
      return { status: 0, stdout: "removed", stderr: "" };
    }
    throw new Error(`unexpected:${command} ${args.join(" ")}`);
  };
  const fetchImpl = async (url) => {
    events.push({ kind: "fetch", url });
    if (url === POSTGRES_CANDIDATE_PUBLISH.branchUrl) {
      const branchReads = events.filter((event) => event.kind === "fetch" && event.url === url).length;
      const protectedValue = protectedSequence?.[branchReads - 1] ?? protectedMain;
      return response({ name: "main", protected: protectedValue, commit: { sha: sourceSha } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { events, commandRunner, fetchImpl };
}

function awaitHash(value) {
  // This deterministic implementation mirrors the production nonce without importing another helper.
  return createHash("sha256").update(value).digest("hex");
}

const validators = {
  platform: "linux", filesystemVerifier: async () => ({ result: { policy: "PASSED" } }),
  baseManifestValidator: (raw) => validateBaseManifest(raw, `sha256:${createHash("sha256").update(raw).digest("hex")}`),
  archiveValidator: (_bytes, options) => ({ sha256: "a".repeat(64), size: 7, configDigest: options.imageId,
    diffIds: options.expectedDiffIds, layerDigests: options.expectedDiffIds, layerSizes: options.expectedDiffIds.map(() => 1) }),
  bootstrapValidator: () => ({ digest: "sha256:bootstrap", size: 13 }),
  remoteValidator: validatePostgresCandidateRemoteManifest,
};

test("candidate publisher arguments and GitHub context are closed", () => {
  const item = fixture();
  try {
    assert.deepEqual(parseCandidatePublishArguments(["--output", item.output]), { output: item.output });
    assert.equal(validateCandidatePublishContext(item.env, "linux").sourceSha, sourceSha);
    for (const env of [{ ...item.env, GITHUB_RUN_NUMBER: "2" }, { ...item.env, GITHUB_RUN_ATTEMPT: "2" },
      { ...item.env, GITHUB_JOB: "other" }, { ...item.env, GITHUB_REF: "refs/heads/dev" },
      { ...item.env, GITHUB_WORKFLOW_REF:
        `${POSTGRES_CANDIDATE_PUBLISH.repository}/.github/workflows/postgres-candidate-publish-v2.yml@refs/heads/main` },
      { ...item.env, GITHUB_WORKFLOW_REF:
        `${POSTGRES_CANDIDATE_PUBLISH.repository}/.github/workflows/postgres-candidate-publish-v3.yml@refs/heads/main` },
      { ...item.env, DOCKER_CONTEXT: "foreign" }]) {
      assert.throws(() => validateCandidatePublishContext(env, "linux"), /postgres_candidate_publish_/u);
    }
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("missing remote tag accepts only the exact Buildx response for the expected reference", () => {
  const reference = "ghcr.io/clemey15/auto-world-postgres-gosu:candidate-36360408945-attempt-1";
  for (const result of [
    { status: 1, stdout: "", stderr: `ERROR: ${reference}: not found` },
    { status: 1, stdout: "", stderr: `ERROR: ${reference}: not found\n` },
    { status: 1, stdout: "", stderr: `ERROR: ${reference}: not found\r\n` },
  ]) assert.equal(classifyRemoteTagAbsence(result, reference), "ABSENT");

  for (const result of [
    { status: 0, stdout: remoteManifest, stderr: "" },
    { status: 1, stdout: "", stderr: "ERROR: ghcr.io/clemey15/other: not found" },
    { status: 1, stdout: "", stderr: `ERROR: ${reference}: not found\nextra` },
    { status: 1, stdout: "", stderr: `ERROR: ${reference}: not found\n\n` },
    { status: 1, stdout: "unexpected", stderr: `ERROR: ${reference}: not found` },
    { status: 1, stdout: "", stderr: `error: ${reference}: not found` },
    { status: 1, stdout: "", stderr: "MANIFEST_UNKNOWN: manifest unknown" },
    { status: 1, stdout: "", stderr: "unauthorized: authentication required" },
    { status: 1, stdout: "", stderr: "TLS handshake timeout" },
    { status: 1, stdout: "", stderr: "dial tcp: connection refused" },
    { status: null, signal: "SIGTERM", stdout: "", stderr: `${reference}: not found` },
  ]) assert.throws(() => classifyRemoteTagAbsence(result, reference),
    /postgres_candidate_publish_remote_tag_(?:exists|check_error)/u);
  assert.throws(() => classifyRemoteTagAbsence(
    { status: 1, stdout: "", stderr: `${reference}: not found` }, undefined),
  /postgres_candidate_publish_remote_tag_check_error/u);
});

test("ambiguous remote tag results stop before local tagging or the only push", async () => {
  for (const kind of ["extra-line", "stdout", "generic-manifest"]) {
    const item = fixture(); const expected = remoteReference(item);
    const remoteTagCheckResult = kind === "extra-line"
      ? { status: 1, stdout: "", stderr: `ERROR: ${expected}: not found\nextra` }
      : kind === "stdout" ? { status: 1, stdout: "unexpected", stderr: `ERROR: ${expected}: not found` }
        : { status: 1, stdout: "", stderr: "MANIFEST_UNKNOWN: manifest unknown" };
    const mocked = fake(item, { remoteTagCheckResult });
    try {
      await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
        env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
      }), /postgres_candidate_publish_remote_tag_check_error/u);
      assert.equal(mocked.events.some((event) => event.kind === "command" && event.args[0] === "tag"), false);
      assert.equal(mocked.events.some((event) => event.kind === "command" && event.args[0] === "push"), false);
    } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
  }
});

test("real command runner preserves binary git-show bytes when encoding is explicitly null", () => {
  const file = "infra/postgres-image/materials/gosu-1.19-r5.apk";
  const result = defaultCommandRunner("git", ["show", `HEAD:${file}`], {
    cwd: process.cwd(), env: process.env, encoding: null, timeout: 30_000,
  });
  assert.equal(result.status, 0);
  assert.ok(Buffer.isBuffer(result.stdout));
  assert.deepEqual(result.stdout, readFileSync(path.join(process.cwd(), file)));
  const textResult = defaultCommandRunner("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(), env: process.env, timeout: 30_000,
  });
  assert.equal(textResult.status, 0);
  assert.equal(typeof textResult.stdout, "string");
});

test("Docker-created files reject symlinks and oversize before reading", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-docker-file-"));
  try {
    const regular = path.join(root, "regular.tar"); const linked = path.join(root, "linked.tar");
    const oversized = path.join(root, "oversized.tar");
    writeFileSync(regular, "bounded"); symlinkSync(regular, linked); writeFileSync(oversized, "x"); truncateSync(oversized, 1025);
    assert.equal(readBoundedDockerFile(regular, true, 1024).bytes.toString("utf8"), "bounded");
    assert.throws(() => readBoundedDockerFile(linked, false, 1024), /postgres_candidate_publish_archive_invalid/u);
    assert.throws(() => readBoundedDockerFile(oversized, true, 1024), /postgres_candidate_publish_archive_invalid/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("public base manifest is bound by raw digest and closed descriptors", () => {
  const digest = `sha256:${createHash("sha256").update(baseManifest).digest("hex")}`;
  assert.equal(validateBaseManifest(baseManifest, digest).layers.length, 10);
  assert.throws(() => validateBaseManifest(`${baseManifest}\n`, digest), /postgres_candidate_publish_base_manifest_invalid/u);
  const changed = JSON.parse(baseManifest); changed.layers[0].foreign = true;
  const raw = JSON.stringify(changed); const changedDigest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  assert.throws(() => validateBaseManifest(raw, changedDigest), /postgres_candidate_publish_base_manifest_invalid/u);
  for (const mutate of [
    (manifest) => { manifest.annotations = []; },
    (manifest) => { manifest.annotations["org.opencontainers.image.version"] = "bad\nvalue"; },
    (manifest) => { manifest.config.foreign = true; },
  ]) {
    const altered = JSON.parse(baseManifest); mutate(altered); const bytes = JSON.stringify(altered);
    const alteredDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.throws(() => validateBaseManifest(bytes, alteredDigest),
      /postgres_candidate_publish_base_manifest_invalid/u);
  }
});

test("publisher builds and proves locally before login, pushes once, and cleans exact inventories", async () => {
  const item = fixture(); const mocked = fake(item);
  try {
    const nonce = (awaitHash(`${sourceSha}:${item.env.GITHUB_RUN_ID}:1`)).slice(0, 24);
    let filesystemVerified = false;
    const receipt = await runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
      filesystemVerifier: async (value) => {
        validatePostgresConfigDelta(value.baseConfig, value.candidateConfig,
          value.additionalLabels, value.parentImage);
        assert.deepEqual(value.baseConfig, inspectBase()[0].Config);
        assert.deepEqual(value.candidateConfig, inspectCandidate(nonce)[0].Config);
        assert.equal(value.parentImage, inspectCandidate(nonce)[0].Parent);
        assert.equal(value.parentImage, candidateParentId);
        assert.notEqual(value.parentImage, baseId);
        assert.throws(() => validatePostgresConfigDelta(inspectBase()[0], value.candidateConfig,
          value.additionalLabels, value.parentImage), /postgres_gosu_filesystem_delta_invalid/u);
        assert.throws(() => validatePostgresConfigDelta(value.baseConfig, value.candidateConfig,
          value.additionalLabels, baseId), /postgres_gosu_filesystem_delta_invalid/u);
        filesystemVerified = true;
        return { result: { policy: "PASSED" } };
      },
    });
    assert.equal(filesystemVerified, true);
    assert.equal(receipt.result, "PASSED"); assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
    const commands = mocked.events.filter((event) => event.kind === "command");
    const login = commands.findIndex((event) => event.args[0] === "login");
    const build = commands.findIndex((event) => event.args[0] === "build");
    const save = commands.findIndex((event) => event.args[0] === "image" && event.args[1] === "save");
    const pushes = commands.filter((event) => event.args[0] === "push");
    assert.ok(build > -1 && save > build && login > save); assert.equal(pushes.length, 1);
    assert.ok(commands.every((event) => !["run", "start", "exec"].includes(event.args[0])));
    assert.ok(commands.every((event) => event.env.GITHUB_TOKEN === undefined));
    assert.ok(commands.every((event) => event.env.DOCKER_CONTEXT === undefined));
    const creates = commands.filter((event) => event.args[0] === "create");
    assert.equal(creates.length, 2);
    assert.ok(creates.every((event) => event.args.includes("--tmpfs")
      && event.args.some((arg) => arg.startsWith("/var/lib/postgresql/data:"))));
    assert.ok(commands.some((event) => event.args[0] === "volume" && event.args[1] === "ls"));
    assert.ok(commands.filter((event) => event.args[0] === "rm").every((event) => event.args[1] === "--volumes"));
    assert.equal(commands.find((event) => event.args[0] === "login").input, "test-registry-token\n");
    const candidateRemovals = commands.filter((event) => event.args[0] === "image" && event.args[1] === "rm"
      && [remoteReference(item), ...commands.filter((value) => value.args[0] === "build")
        .map((value) => value.args[value.args.indexOf("--tag") + 1])].includes(event.args[2]));
    assert.equal(candidateRemovals.length, 2);
    assert.ok(candidateRemovals.every((event) => event.args.length === 3));
    const pushEvent = mocked.events.findIndex((event) => event.kind === "command" && event.args[0] === "push");
    const preceding = mocked.events.slice(0, pushEvent).findLastIndex((event) => event.kind === "fetch"
      && event.url === POSTGRES_CANDIDATE_PUBLISH.branchUrl);
    assert.equal(preceding, pushEvent - 1);
    const disk = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(JSON.stringify(disk).includes("test-registry-token"), false);
    assert.equal(JSON.stringify(disk).includes(item.runnerTemp), false);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("anonymous public or ambiguous read fails the job without erasing a confirmed candidate write", async () => {
  for (const candidateAnonymous of ["public", "ambiguous"]) {
    const item = fixture(); const mocked = fake(item, { candidateAnonymous });
    try {
      await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
        env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
      }), /postgres_candidate_publish_anonymous_check_failed/u);
      const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
      assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
      assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
      assert.equal(receipt.result, "FAILED");
      assert.equal(receipt.phases.find((phase) => phase.name === "anonymous_candidate_denied").result, "FAILED");
      assert.equal(mocked.events.filter((event) => event.kind === "command" && event.args[0] === "push").length, 1);
    } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
  }
});

test("stopped export rejects substituted image and inherited PostgreSQL volume", async () => {
  for (const options of [{ substituteExportImage: true }, { inheritedVolumeMount: true }]) {
    const item = fixture(); const mocked = fake(item, options);
    try {
      await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
        env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
      }), /postgres_candidate_publish_container_invalid/u);
      assert.equal(mocked.events.some((event) => event.kind === "command" && event.args[0] === "push"), false);
    } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
  }
});

test("unprotected main rejects before Docker credentials or publication", async () => {
  const item = fixture(); const mocked = fake(item, { protectedMain: false });
  try {
    await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
    }), /postgres_candidate_publish_main_ref_mismatch/u);
    const commands = mocked.events.filter((event) => event.kind === "command");
    assert.equal(commands.some((event) => ["login", "push"].includes(event.args[0])), false);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.publication, "NOT_ATTEMPTED");
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("an orphaned preexisting base config blocks pull instead of mutating foreign state", async () => {
  const item = fixture(); const mocked = fake(item, { orphanBaseId: true });
  try {
    await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
    }), /postgres_candidate_publish_base_collision/u);
    assert.equal(mocked.events.some((event) => event.kind === "command" && event.args[0] === "pull"), false);
    assert.equal(mocked.events.some((event) => event.kind === "command" && event.args[0] === "image"
      && event.args[1] === "rm" && event.args.includes(baseId)), false);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("a failed single push remains uncertain and still restores Docker inventories", async () => {
  const item = fixture(); const mocked = fake(item, { pushFails: true });
  try {
    await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
    }), /postgres_candidate_publish_push_outcome_uncertain/u);
    const pushes = mocked.events.filter((event) => event.kind === "command" && event.args[0] === "push");
    assert.equal(pushes.length, 1);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.publication, "ATTEMPTED_OUTCOME_UNCONFIRMED");
    assert.equal(receipt.phases.find((phase) => phase.name === "owned_docker_cleanup").result, "PASSED");
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("a failed push response can only become published after exact tag and digest reads", async () => {
  const item = fixture(); const mocked = fake(item, { pushFailsButPublishes: true });
  try {
    const receipt = await runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
    });
    assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
    assert.equal(receipt.pushResponse, "FAILED_BUT_REMOTE_EXACT_SUBJECT_CONFIRMED");
    assert.equal(mocked.events.filter((event) => event.kind === "command" && event.args[0] === "push").length, 1);
    assert.ok(mocked.events.some((event) => event.kind === "command" && event.args.at(-1) === receipt.subject));
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("main protection changing immediately before push blocks the only write", async () => {
  const item = fixture(); const mocked = fake(item, { protectedSequence: [true, false] });
  try {
    await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
    }), /postgres_candidate_publish_main_ref_mismatch/u);
    assert.equal(mocked.events.some((event) => event.kind === "command" && event.args[0] === "push"), false);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.publication, "NOT_ATTEMPTED");
    assert.equal(receipt.phases.find((phase) => phase.name === "owned_docker_cleanup").result, "PASSED");
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("a foreign image appearing during the build is preserved and fails ownership proof", async () => {
  const item = fixture(); const mocked = fake(item, { injectForeignImage: true });
  try {
    await assert.rejects(runPostgresCandidatePublish(["--output", item.output], {
      env: item.env, commandRunner: mocked.commandRunner, fetchImpl: mocked.fetchImpl, ...validators,
    }), /postgres_candidate_publish_image_ownership_uncertain/u);
    const commands = mocked.events.filter((event) => event.kind === "command");
    assert.equal(commands.some((event) => event.args[0] === "image" && event.args[1] === "rm"
      && event.args.includes(`sha256:${"9".repeat(64)}`)), false);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.result, "FAILED");
    assert.equal(receipt.phases.find((phase) => phase.name === "owned_docker_cleanup").result, "FAILED");
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});
