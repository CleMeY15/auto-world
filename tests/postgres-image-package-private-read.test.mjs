import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  POSTGRES_PACKAGE_PRIVATE_READ,
  parsePrivateReadArguments,
  runPostgresPackagePrivateRead,
  validatePinnedManifest,
  validatePrivateReadContext,
} from "../scripts/postgres-image/package-private-read.mjs";

const sourceSha = "a".repeat(40);
const baselineImage = `sha256:${"1".repeat(64)}`;
const baselineContainer = "2".repeat(64);
const containerId = "3".repeat(64);
const unknownImage = `sha256:${"4".repeat(64)}`;

function manifest({ configDigest = POSTGRES_PACKAGE_PRIVATE_READ.configDigest, fill = "x" } = {}) {
  const value = { schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: 500 },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: `sha256:${"d".repeat(64)}`, size: 1024 }], annotations: { padding: "" } };
  const empty = JSON.stringify(value);
  value.annotations.padding = fill.repeat(POSTGRES_PACKAGE_PRIVATE_READ.manifestBytes - Buffer.byteLength(empty));
  const raw = JSON.stringify(value);
  assert.equal(Buffer.byteLength(raw), POSTGRES_PACKAGE_PRIVATE_READ.manifestBytes);
  return raw;
}

const rawManifest = manifest();

function fixture(runId = "36370000001") {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-private-read-"));
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: "verify",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: POSTGRES_PACKAGE_PRIVATE_READ.repository,
    GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: runId, GITHUB_RUN_NUMBER: "2", GITHUB_SHA: sourceSha,
    GITHUB_TOKEN: "secret-token-value",
    GITHUB_WORKFLOW_REF: `${POSTGRES_PACKAGE_PRIVATE_READ.repository}/${POSTGRES_PACKAGE_PRIVATE_READ.workflowPath}@refs/heads/main`,
    GITHUB_WORKSPACE: process.cwd(), RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_TEMP: runnerTemp,
  };
  return { env, output: path.join(runnerTemp, POSTGRES_PACKAGE_PRIVATE_READ.outputDirectory), runnerTemp };
}

function branchResponse(sha = sourceSha, protectedBranch = true) {
  return new globalThis.Response(JSON.stringify({ name: "main", protected: protectedBranch, commit: { sha } }), { status: 200 });
}

function exactManifestHash(raw, digest) {
  if (Buffer.byteLength(raw) !== POSTGRES_PACKAGE_PRIVATE_READ.manifestBytes ||
      digest !== POSTGRES_PACKAGE_PRIVATE_READ.digest) throw new Error("changed");
  return { sha256: digest, size: Buffer.byteLength(raw) };
}

function imageMetadata(subject, { wrongLabels = false } = {}) {
  return JSON.stringify({ Id: POSTGRES_PACKAGE_PRIVATE_READ.configDigest, Os: "linux", Architecture: "amd64",
    Size: 2048, RepoTags: [], RepoDigests: [subject], Config: { Labels: {
      "org.opencontainers.image.source": POSTGRES_PACKAGE_PRIVATE_READ.sourceUrl,
      "org.opencontainers.image.description": wrongLabels ? "changed" : POSTGRES_PACKAGE_PRIVATE_READ.description,
    } } });
}

function containerMetadata(subject, name, ownerLabel, { foreign = false, id = containerId, wrongSecurity = false } = {}) {
  return JSON.stringify({ Id: id, Name: `/${name}`, Image: POSTGRES_PACKAGE_PRIVATE_READ.configDigest,
    Config: { Image: foreign ? "ghcr.io/example/foreign@sha256:bad" : subject,
      Cmd: [`/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}`], Labels: {
        "org.opencontainers.image.source": POSTGRES_PACKAGE_PRIVATE_READ.sourceUrl,
        "org.opencontainers.image.description": POSTGRES_PACKAGE_PRIVATE_READ.description,
        "org.auto-world.private-read-owner": ownerLabel,
      } }, State: { Running: false, Status: "created" }, HostConfig: {
      NetworkMode: "none", ReadonlyRootfs: true, CapDrop: ["ALL"],
      SecurityOpt: [wrongSecurity ? "no-new-privileges=false" : "no-new-privileges=true"],
    }, Mounts: [] });
}

function mockRunner({
  calls, anonymousMessage = "unauthorized: authentication required", anonymousSuccess = false,
  changedPayload = false, dirty = false, failContainerRemoval = false, failImageRemoval = false,
  failCreateNoEffect = false, failPull = false, failPullNoEffect = false, foreignContainer = false,
  inspectSignal = false, lostCreate = false,
  onImageRemoved, preexistingConfig = false, preexistingContainer = false, remoteAfter = rawManifest,
  remoteBefore = rawManifest, substitutedImport = false, unknownPartial = false, wrongLabels = false,
  wrongSecurity = false,
} = {}) {
  const subject = `${POSTGRES_PACKAGE_PRIVATE_READ.image}@${POSTGRES_PACKAGE_PRIVATE_READ.digest}`;
  let imagePresent = preexistingConfig;
  let containerPresent = preexistingContainer;
  let pulled = false;
  let created = false;
  let remoteReads = 0;
  let ownerLabel;
  let containerName;
  return (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, env: options.env, input: options.input, timeout: options.timeout });
    if (command === "git") {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: dirty ? " M README.md\n" : "", stderr: "" };
      if (args[0] === "show") {
        const file = args[1].slice("HEAD:".length);
        const bytes = readFileSync(path.join(process.cwd(), file), "utf8");
        return { status: 0, stdout: substitutedImport && file.endsWith("prepare.mjs") ? `${bytes}\n` : bytes, stderr: "" };
      }
    }
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.1\n", stderr: "" };
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded", stderr: "" };
    if (args[0] === "buildx" && args[1] === "imagetools") {
      if (options.env.DOCKER_CONFIG.endsWith("docker-anonymous")) return anonymousSuccess
        ? { status: 0, stdout: rawManifest, stderr: "" }
        : { status: 1, stdout: "", stderr: anonymousMessage };
      remoteReads += 1;
      return { status: 0, stdout: remoteReads === 1 ? remoteBefore : remoteAfter, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "ls") {
      const ids = [baselineImage];
      if (imagePresent) ids.push(unknownPartial ? unknownImage : POSTGRES_PACKAGE_PRIVATE_READ.configDigest);
      return { status: 0, stdout: `${ids.sort().join("\n")}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "ls") {
      const ids = [baselineContainer];
      if (containerPresent) ids.push(containerId);
      return { status: 0, stdout: `${ids.sort().join("\n")}\n`, stderr: "" };
    }
    if (args[0] === "pull") {
      pulled = true;
      imagePresent = !failPullNoEffect;
      return failPull || failPullNoEffect ? { status: 1, stdout: "partial", stderr: "pull failed" }
        : { status: 0, stdout: "pulled", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect") {
      const reference = args.at(-1);
      if (inspectSignal && pulled && reference === subject) {
        return { status: 0, signal: "SIGTERM", stdout: imageMetadata(subject), stderr: "" };
      }
      if (args[2] === "--format") return imagePresent && !unknownPartial
        ? { status: 0, stdout: imageMetadata(subject, { wrongLabels }), stderr: "" }
        : { status: 1, stdout: "", stderr: `Error response from daemon: No such image: ${reference}` };
      const present = reference === subject ? imagePresent && !unknownPartial
        : reference === POSTGRES_PACKAGE_PRIVATE_READ.configDigest && imagePresent && !unknownPartial;
      return present ? { status: 0, stdout: "[]", stderr: "" }
        : { status: 1, stdout: "", stderr: `Error response from daemon: No such image: ${reference}` };
    }
    if (args[0] === "create") {
      created = true;
      containerPresent = !failCreateNoEffect;
      containerName = args[args.indexOf("--name") + 1];
      ownerLabel = args[args.indexOf("--label") + 1].split("=").slice(1).join("=");
      return lostCreate || failCreateNoEffect ? { status: 1, stdout: "", stderr: "response lost" }
        : { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const reference = args.at(-1);
      if (containerPresent && args[2] === "--format") return { status: 0,
        stdout: containerMetadata(subject, containerName ?? reference, ownerLabel ?? `${sourceSha}:36370000001:1`,
          { foreign: foreignContainer, wrongSecurity }), stderr: "" };
      return containerPresent ? { status: 0, stdout: "[]", stderr: "" }
        : { status: 1, stdout: "", stderr: `Error response from daemon: No such container: ${reference}` };
    }
    if (args[0] === "cp") {
      writeFileSync(args[2], changedPayload ? "changed\n" : POSTGRES_PACKAGE_PRIVATE_READ.payload);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "rm") {
      if (failContainerRemoval) return { status: 1, stdout: "", stderr: "busy" };
      containerPresent = false;
      return { status: 0, stdout: containerId, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "rm") {
      if (failImageRemoval) return { status: 1, stdout: "", stderr: "busy" };
      imagePresent = false;
      onImageRemoved?.();
      return { status: 0, stdout: subject, stderr: "" };
    }
    throw new Error(`unexpected:${command}:${args.join(" ")}:${created}`);
  };
}

test("fixed subject, arguments, context and manifest shape are closed", (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  assert.deepEqual(parsePrivateReadArguments(["--output", item.output]), { output: item.output });
  assert.equal(validatePrivateReadContext(item.env, "linux").runId, item.env.GITHUB_RUN_ID);
  for (const invalid of [
    { ...item.env, GITHUB_JOB: "publish" }, { ...item.env, GITHUB_RUN_NUMBER: "1" },
    { ...item.env, GITHUB_RUN_ATTEMPT: "2" }, { ...item.env, GITHUB_REF: "refs/heads/dev" },
    { ...item.env, GITHUB_REPOSITORY: "other/repo" }, { ...item.env, GITHUB_TOKEN: "" },
  ]) assert.throws(() => validatePrivateReadContext(invalid, "linux"), /postgres_package_private_read_/u);
  assert.throws(() => parsePrivateReadArguments(["--output", "relative"]), /arguments_invalid/u);
  const proof = validatePinnedManifest(rawManifest, exactManifestHash);
  assert.equal(proof.sha256, POSTGRES_PACKAGE_PRIVATE_READ.digest);
  assert.equal(proof.size, 524);
  assert.throws(() => validatePinnedManifest(manifest({ configDigest: `sha256:${"e".repeat(64)}` }), exactManifestHash),
    /manifest_invalid/u);
  const invalidLayers = JSON.parse(rawManifest);
  invalidLayers.layers = { 0: invalidLayers.layers[0], length: 1 };
  assert.throws(() => validatePinnedManifest(JSON.stringify(invalidLayers), () => ({
    sha256: POSTGRES_PACKAGE_PRIVATE_READ.digest, size: POSTGRES_PACKAGE_PRIVATE_READ.manifestBytes,
  })), /manifest_invalid/u);
});

test("private read binds protected main, isolated denial, exact stopped payload and complete cleanup", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  let fetches = 0;
  const receipt = await runPostgresPackagePrivateRead({ argv: ["--output", item.output],
    commandRunner: mockRunner({ calls }), env: item.env, fetchImpl: async () => { fetches += 1; return branchResponse(); },
    manifestHashValidator: exactManifestHash, platform: "linux" });
  assert.equal(fetches, 2);
  assert.equal(receipt.state, "PRIVATE_READ_PROOF");
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.publication, "NOT_ATTEMPTED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(receipt.supportStartedAt, null);
  assert.equal(receipt.supportEndsAt, null);
  assert.equal(receipt.archiveUntil, null);
  assert.equal(receipt.packageSettings, "NOT_VERIFIED_BY_THIS_RECEIPT");
  assert.deepEqual(receipt.remoteManifestBefore, receipt.remoteManifestAfter);
  assert.equal(receipt.copiedPayload.sha256, POSTGRES_PACKAGE_PRIVATE_READ.payloadSha256);
  assert.deepEqual(receipt.containerCleanup, { state: "REMOVED", id: containerId });
  assert.deepEqual(receipt.imageCleanup, { state: "REMOVED", id: POSTGRES_PACKAGE_PRIVATE_READ.configDigest });
  assert.deepEqual(receipt.phases.map(({ name, result }) => [name, result]), [
    ["managed_tool_identity", "PASSED"], ["checkout_and_import_closure", "PASSED"],
    ["protected_main_before_credentials", "PASSED"], ["authorized_registry_login", "PASSED"],
    ["authorized_manifest_before", "PASSED"], ["anonymous_manifest_denied", "PASSED"],
    ["authorized_manifest_after", "PASSED"], ["local_collision_and_inventory", "PASSED"],
    ["protected_main_before_pull", "PASSED"], ["authorized_pinned_pull", "PASSED"],
    ["exact_pulled_image", "PASSED"], ["stopped_container_create", "PASSED"],
    ["exact_stopped_container", "PASSED"], ["stopped_container_payload", "PASSED"],
    ["owned_docker_cleanup", "PASSED"], ["owned_temporary_cleanup", "PASSED"],
  ]);
  const login = calls.find(({ args }) => args[0] === "login");
  assert.equal(login.input, `${item.env.GITHUB_TOKEN}\n`);
  assert.equal(login.env.GITHUB_TOKEN, undefined);
  const reads = calls.filter(({ args }) => args[0] === "buildx" && args[1] === "imagetools");
  assert.equal(reads.length, 3);
  assert.notEqual(reads[0].env.DOCKER_CONFIG, reads[1].env.DOCKER_CONFIG);
  const create = calls.find(({ args }) => args[0] === "create");
  for (const flag of ["--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true"]) {
    assert.equal(create.args.includes(flag), true);
  }
  assert.equal(calls.some(({ args }) => args[0] === "run" || args[0] === "start"), false);
  const serialized = readFileSync(path.join(item.output, "receipt.json"), "utf8");
  assert.doesNotMatch(serialized, /secret-token-value/u);
  assert.equal(existsSync(path.join(item.runnerTemp, `aw-postgres-package-private-read-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
});

test("alternate code, main, manifests and anonymous outcomes fail before unsafe work", async (context) => {
  const variants = [
    { id: "dirty", runner: { dirty: true }, expected: /checkout_dirty/u },
    { id: "import", runner: { substitutedImport: true }, expected: /checkout_dirty/u },
    { id: "anonymous-success", runner: { anonymousSuccess: true }, expected: /anonymous_remote_succeeded/u },
    { id: "anonymous-network", runner: { anonymousMessage: "TLS handshake timeout" }, expected: /anonymous_remote_error/u },
    { id: "manifest-config", runner: { remoteBefore: manifest({ configDigest: `sha256:${"e".repeat(64)}` }) }, expected: /manifest_invalid/u },
    { id: "manifest-change", runner: { remoteAfter: manifest({ fill: "y" }) }, expected: /manifest_changed/u },
  ];
  for (const [index, variant] of variants.entries()) {
    const item = fixture(`3637000010${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls, ...variant.runner }), env: item.env, fetchImpl: async () => branchResponse(),
      manifestHashValidator: exactManifestHash, platform: "linux" }), variant.expected);
    assert.equal(calls.some(({ args }) => args[0] === "pull"), false);
  }

  const changedMain = fixture("36370000109");
  context.after(() => rmSync(changedMain.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  let fetches = 0;
  await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", changedMain.output],
    commandRunner: mockRunner({ calls }), env: changedMain.env,
    fetchImpl: async () => branchResponse(fetches++ === 0 ? sourceSha : "f".repeat(40)),
    manifestHashValidator: exactManifestHash, platform: "linux" }), /main_mismatch/u);
  assert.equal(calls.some(({ args }) => args[0] === "pull"), false);
});

test("an initially unprotected or mismatched main stops before credentials and registry reads", async (context) => {
  for (const [index, response] of [
    branchResponse(sourceSha, false),
    branchResponse("f".repeat(40)),
  ].entries()) {
    const item = fixture(`3637000012${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls }), env: item.env, fetchImpl: async () => response,
      manifestHashValidator: exactManifestHash, platform: "linux" }), /main_mismatch/u);
    assert.equal(calls.some(({ args }) => args[0] === "login" || args[0] === "pull" ||
      (args[0] === "buildx" && args[1] === "imagetools")), false);
  }
});

test("pre-existing cache or container collisions are preserved and block pull", async (context) => {
  for (const [index, variant] of [{ preexistingConfig: true }, { preexistingContainer: true }].entries()) {
    const item = fixture(`3637000020${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls, ...variant }), env: item.env, fetchImpl: async () => branchResponse(),
      manifestHashValidator: exactManifestHash, platform: "linux" }), /local_collision/u);
    assert.equal(calls.some(({ args }) => args[0] === "pull" || args[0] === "rm" ||
      (args[0] === "image" && args[1] === "rm")), false);
  }
});

test("partial pull and create are cleaned only with exact recovered ownership", async (context) => {
  for (const [index, variant] of [{ failPull: true }, { lostCreate: true }].entries()) {
    const item = fixture(`3637000030${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls, ...variant }), env: item.env, fetchImpl: async () => branchResponse(),
      manifestHashValidator: exactManifestHash, platform: "linux" }), /(?:pull_failed|container_create_failed)/u);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.phases.find(({ name }) => name === "owned_docker_cleanup").result, "PASSED");
    assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
  }
});

test("failed pull or create with proven no local effect records ABSENT cleanup", async (context) => {
  const cases = [
    { options: { failPullNoEffect: true }, expected: /pull_failed/u, cleanup: "imageCleanup" },
    { options: { failCreateNoEffect: true }, expected: /container_create_failed/u, cleanup: "containerCleanup" },
  ];
  for (const [index, itemCase] of cases.entries()) {
    const item = fixture(`3637000031${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls: [], ...itemCase.options }), env: item.env,
      fetchImpl: async () => branchResponse(), manifestHashValidator: exactManifestHash, platform: "linux" }),
    itemCase.expected);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.deepEqual(receipt[itemCase.cleanup], { state: "ABSENT" });
    assert.equal(receipt.phases.find(({ name }) => name === "owned_docker_cleanup").result, "PASSED");
  }
});

test("unknown partial objects, interrupted inspection and foreign containers are preserved as uncertain", async (context) => {
  const variants = [
    { id: "unknown", options: { failPull: true, unknownPartial: true } },
    { id: "signal", options: { inspectSignal: true } },
    { id: "foreign-container", options: { foreignContainer: true, lostCreate: true } },
    { id: "wrong-security", options: { wrongSecurity: true } },
  ];
  for (const [index, variant] of variants.entries()) {
    const item = fixture(`3637000040${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls, ...variant.options }), env: item.env, fetchImpl: async () => branchResponse(),
      manifestHashValidator: exactManifestHash, platform: "linux" }), /postgres_package_private_read_/u);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.result, "FAILED");
    assert.equal(receipt.phases.find(({ name }) => name === "owned_docker_cleanup").result, "FAILED");
    if (variant.id === "foreign-container") {
      assert.equal(calls.some(({ args }) => args[0] === "rm" || (args[0] === "image" && args[1] === "rm")), false);
    }
  }
});

test("replaced owned work, output or parent directories are never removed or written", async (context) => {
  for (const [index, target] of ["work", "output", "parent"].entries()) {
    const item = fixture(`3637000060${index}`);
    const work = path.join(item.runnerTemp, `aw-postgres-package-private-read-${item.env.GITHUB_RUN_ID}-attempt-1`);
    const selected = target === "work" ? work : target === "output" ? item.output : item.runnerTemp;
    const displaced = `${selected}-displaced`;
    context.after(() => {
      rmSync(item.runnerTemp, { recursive: true, force: true });
      rmSync(displaced, { recursive: true, force: true });
    });
    let replaced = false;
    const replace = () => {
      if (replaced) return;
      replaced = true;
      renameSync(selected, displaced);
      mkdirSync(selected, { mode: 0o700 });
      writeFileSync(path.join(selected, "foreign-marker"), "preserve\n");
    };
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls: [], onImageRemoved: replace }), env: item.env,
      fetchImpl: async () => branchResponse(), manifestHashValidator: exactManifestHash, platform: "linux" }),
    /postgres_package_private_read_/u);
    assert.equal(readFileSync(path.join(selected, "foreign-marker"), "utf8"), "preserve\n");
    if (target === "work") {
      assert.equal(JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8")).result, "FAILED");
    } else assert.equal(existsSync(path.join(selected, "receipt.json")), false);
  }
});

test("changed payload, removal failures and time budget retain redacted FAILED receipts", async (context) => {
  for (const [index, variant] of [{ changedPayload: true }, { failContainerRemoval: true, failImageRemoval: true }].entries()) {
    const item = fixture(`3637000050${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", item.output],
      commandRunner: mockRunner({ calls: [], ...variant }), env: item.env, fetchImpl: async () => branchResponse(),
      manifestHashValidator: exactManifestHash, platform: "linux" }), /postgres_package_private_read_/u);
    const raw = readFileSync(path.join(item.output, "receipt.json"), "utf8");
    assert.match(raw, /"result": "FAILED"/u);
    assert.doesNotMatch(raw, /secret-token-value/u);
  }

  const timed = fixture("36370000509");
  context.after(() => rmSync(timed.runnerTemp, { recursive: true, force: true }));
  let clock = 0;
  await assert.rejects(runPostgresPackagePrivateRead({ argv: ["--output", timed.output],
    commandRunner: mockRunner({ calls: [] }), env: timed.env, fetchImpl: async () => branchResponse(),
    manifestHashValidator: exactManifestHash, now: () => { clock += 70_000; return clock; }, platform: "linux" }),
  /job_timeout/u);
  const receipt = JSON.parse(readFileSync(path.join(timed.output, "receipt.json"), "utf8"));
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.phases.some(({ result }) => result === "FAILED"), true);
  assert.equal(readdirSync(timed.runnerTemp).includes(`aw-postgres-package-private-read-${timed.env.GITHUB_RUN_ID}-attempt-1`), false);
});
