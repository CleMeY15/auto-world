import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  POSTGRES_PACKAGE_BOOTSTRAP,
  parseBootstrapArguments,
  parsePublishedDigest,
  runPostgresPackageBootstrap,
  sha256,
  validateBootstrapContext,
  validateLocalBootstrapImage,
  validateOutputPath,
} from "../scripts/postgres-image/package-bootstrap.mjs";

const sourceSha = "a".repeat(40);
const rawManifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${"c".repeat(64)}`, size: 500 },
  layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
    digest: `sha256:${"d".repeat(64)}`, size: 1024 }] });
const manifestDigest = `sha256:${sha256(Buffer.from(rawManifest))}`;
const localId = `sha256:${"c".repeat(64)}`;

function fixture(runId = "36360000001") {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-package-bootstrap-"));
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: "publish",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: POSTGRES_PACKAGE_BOOTSTRAP.repository,
    GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: runId, GITHUB_RUN_NUMBER: "1", GITHUB_SHA: sourceSha,
    GITHUB_TOKEN: "secret-token-value",
    GITHUB_WORKFLOW_REF: `${POSTGRES_PACKAGE_BOOTSTRAP.repository}/${POSTGRES_PACKAGE_BOOTSTRAP.workflowPath}@refs/heads/main`,
    GITHUB_WORKSPACE: process.cwd(), RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_TEMP: runnerTemp,
  };
  return { env, output: path.join(runnerTemp, POSTGRES_PACKAGE_BOOTSTRAP.outputDirectory), runnerTemp,
    tag: `${POSTGRES_PACKAGE_BOOTSTRAP.image}:bootstrap-${runId}` };
}

function branchResponse(sha = sourceSha, protectedBranch = true) {
  return new globalThis.Response(JSON.stringify({ name: "main", protected: protectedBranch, commit: { sha } }), { status: 200 });
}

function localImage(tag, { labels, tags = [tag] } = {}) {
  return JSON.stringify({ Id: localId, Os: "linux", Architecture: "amd64", Size: 2048, RepoTags: tags,
    Config: { Labels: labels ?? {
      "org.opencontainers.image.source": POSTGRES_PACKAGE_BOOTSTRAP.sourceUrl,
      "org.opencontainers.image.description": POSTGRES_PACKAGE_BOOTSTRAP.description,
    } } });
}

function runner({ calls, tag, retainLocal = false, retainIdAfterUntag = false, failPush = false,
  foreignLocal = false, remoteCollision = false, mismatchedRemote = false, failCleanup = false,
  ambiguousInspect = false, ambiguousRemoteAbsent = false, committedSubstitution = false,
  foreignId = false, interruptedInspect = false, metadataConfigDigest = localId, preexistingConfig = false,
  newIdAfterFailedPush = false, publishedManifest = rawManifest } = {}) {
  let built = false;
  let tagRemoved = false;
  let idRemoved = false;
  let remoteReads = 0;
  return (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, env: options.env, input: options.input, timeout: options.timeout });
    if (command === "git") {
      if (args[0] === "rev-parse") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (args[0] === "show") {
        const file = args[1].slice("HEAD:".length);
        const bytes = readFileSync(path.join(process.cwd(), file), "utf8");
        return { status: 0, stdout: committedSubstitution && file.endsWith("prepare.mjs") ? `${bytes}\n` : bytes, stderr: "" };
      }
    }
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") {
      return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    }
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded", stderr: "" };
    if (args[0] === "buildx" && args[1] === "imagetools") {
      remoteReads += 1;
      if (remoteReads === 1) return remoteCollision
        ? { status: 0, stdout: rawManifest, stderr: "" }
        : { status: 1, stdout: "", stderr: ambiguousRemoteAbsent ? "configuration file not found" : "manifest unknown: not found" };
      return { status: 0, stdout: mismatchedRemote && remoteReads === 3 ? `${publishedManifest} ` : publishedManifest, stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "build") {
      built = true;
      if (!failPush) {
        const metadata = args[args.indexOf("--metadata-file") + 1];
        writeFileSync(metadata, JSON.stringify({ "containerimage.digest": `sha256:${sha256(Buffer.from(publishedManifest))}`,
          "containerimage.config.digest": metadataConfigDigest }));
      }
      return failPush ? { status: 1, stdout: "", stderr: "credential=SECRET_VALUE" }
        : { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "ls") {
      const present = preexistingConfig || (built && !idRemoved &&
        (retainIdAfterUntag || (retainLocal && !tagRemoved) || (failPush && newIdAfterFailedPush)));
      return { status: 0, stdout: present ? `${localId}\n` : "", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect") {
      const reference = args.at(-1);
      if (reference === tag) {
        if (built && interruptedInspect && !tagRemoved) {
          return { error: new Error("interrupted"), status: 0, stdout: localImage(tag), stderr: "" };
        }
        if (built && ambiguousInspect && !tagRemoved) return { status: 2, stdout: "", stderr: "inspection failed" };
        if (!built || !retainLocal || tagRemoved) {
          return { status: 1, stdout: "", stderr: `Error response from daemon: No such image: ${tag}` };
        }
        return { status: 0, stdout: localImage(tag, foreignLocal ? {
          labels: { "org.opencontainers.image.source": "https://example.test/foreign" }, tags: [tag, "foreign:tag"],
        } : {}), stderr: "" };
      }
      if (reference === localId) {
        if (!retainIdAfterUntag || idRemoved) {
          return { status: 1, stdout: "", stderr: `Error response from daemon: No such image: ${localId}` };
        }
        return { status: 0, stdout: localImage(tag, foreignId ? {
          labels: { "org.opencontainers.image.source": "https://example.test/foreign" }, tags: [],
        } : { tags: [] }), stderr: "" };
      }
    }
    if (args[0] === "image" && args[1] === "rm") {
      if (failCleanup) return { status: 1, stdout: "", stderr: "busy" };
      if (args[2] === tag) tagRemoved = true;
      if (args[2] === localId) idRemoved = true;
      return { status: 0, stdout: "removed", stderr: "" };
    }
    throw new Error(`unexpected:${command}:${args.join(" ")}`);
  };
}

test("fixed PostgreSQL package bootstrap material is harmless and dependency-free", () => {
  assert.equal(POSTGRES_PACKAGE_BOOTSTRAP.image, "ghcr.io/clemey15/auto-world-postgres-gosu");
  assert.equal(POSTGRES_PACKAGE_BOOTSTRAP.payload, "auto-world-postgres-gosu-package-bootstrap-v1\n");
  assert.match(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, /^FROM scratch\n/u);
  assert.doesNotMatch(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, /^(?:RUN|ADD)\s/mu);
  assert.match(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, /COPY bootstrap\.txt \/bootstrap\.txt/u);
  assert.match(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, /not a runtime image/u);
  assert.equal(Buffer.byteLength(POSTGRES_PACKAGE_BOOTSTRAP.payload) < 1024, true);
  assert.equal(sha256(Buffer.from(POSTGRES_PACKAGE_BOOTSTRAP.payload)),
    "3dcac3d89244976f683b3d6c26b91cd992b758baa17801f08b1533c0e235be38");
  assert.equal(sha256(Buffer.from(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile)),
    "aea9d6d5010b46d1fa97daa186252d0d641d7aa31d1ac2b68541b94596b0de65");
});

test("arguments, output path, context and digest metadata reject alternate execution", (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  assert.deepEqual(parseBootstrapArguments(["--output", item.output]), { output: item.output });
  assert.equal(validateOutputPath(item.output, item.runnerTemp), item.output);
  assert.equal(validateBootstrapContext(item.env, "linux").sourceSha, sourceSha);
  for (const invalid of [
    { ...item.env, GITHUB_EVENT_NAME: "push" }, { ...item.env, GITHUB_REF: "refs/heads/feature" },
    { ...item.env, GITHUB_RUN_NUMBER: "2" }, { ...item.env, GITHUB_RUN_ATTEMPT: "2" },
    { ...item.env, GITHUB_JOB: "other" }, { ...item.env, RUNNER_ENVIRONMENT: "self-hosted" },
    { ...item.env, GITHUB_TOKEN: "" }, { ...item.env, GITHUB_WORKFLOW_REF: item.env.GITHUB_WORKFLOW_REF.replace("postgres", "other") },
  ]) assert.throws(() => validateBootstrapContext(invalid, "linux"), /postgres_package_bootstrap_/u);
  assert.throws(() => validateBootstrapContext(item.env, "win32"), /requires_github_linux/u);
  assert.throws(() => parseBootstrapArguments(["--output", "relative"]), /arguments_invalid/u);
  assert.throws(() => validateOutputPath(path.join(item.runnerTemp, "other"), item.runnerTemp), /output_path_invalid/u);
  assert.deepEqual(parsePublishedDigest({ "containerimage.digest": manifestDigest,
    "containerimage.config.digest": localId }), { manifestDigest, configDigest: localId });
  assert.throws(() => parsePublishedDigest({ "containerimage.digest": manifestDigest }), /metadata_invalid/u);
  for (const metadata of [null, [], {}, { "containerimage.digest": "sha256:short" },
    { "containerimage.digest": manifestDigest, "containerimage.config.digest": "bad" }]) {
    assert.throws(() => parsePublishedDigest(metadata), /postgres_package_bootstrap_/u);
  }
});

test("local image ownership requires the exact sole tag, platform, labels and bounded image", () => {
  const tag = `${POSTGRES_PACKAGE_BOOTSTRAP.image}:bootstrap-1`;
  assert.equal(validateLocalBootstrapImage(localImage(tag), tag).id, localId);
  assert.equal(validateLocalBootstrapImage(localImage(tag, { tags: [] }), tag, { afterTagRemoval: true }).tags.length, 0);
  for (const raw of ["not-json", localImage(tag, { tags: [tag, "foreign:tag"] }),
    localImage(tag, { labels: { "org.opencontainers.image.source": POSTGRES_PACKAGE_BOOTSTRAP.sourceUrl } })]) {
    assert.throws(() => validateLocalBootstrapImage(raw, tag), /local_image_invalid/u);
  }
});

test("publisher binds clean HEAD, checks protected main twice and confirms tag plus digest manifests", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  let fetches = 0;
  const receipt = await runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls, tag: item.tag }), env: item.env,
    fetchImpl: async () => { fetches += 1; return branchResponse(); }, platform: "linux" });
  assert.equal(fetches, 2);
  assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(receipt.supportStartedAt, null);
  assert.equal(receipt.supportEndsAt, null);
  assert.equal(receipt.archiveUntil, null);
  assert.equal(receipt.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(receipt.forkIsolation, "NOT_VERIFIED");
  assert.equal(receipt.manifestDigest, manifestDigest);
  assert.equal(receipt.configDigest, localId);
  assert.equal(receipt.subject, `${POSTGRES_PACKAGE_BOOTSTRAP.image}@${manifestDigest}`);
  assert.deepEqual(Object.keys(receipt).sort(), [
    "admission", "archiveUntil", "code", "configDigest", "forkAccessTest", "forkIsolation", "image", "kind",
    "localImageCleanup", "localInventoryAfter", "localInventoryBefore", "manifestDigest", "packageConfiguration",
    "payload", "phases", "postWriteGate", "publication", "recipe", "remoteDigestManifest",
    "remoteTagManifest", "repository", "result", "runAttempt", "runId", "schemaVersion", "sourceRef",
    "sourceSha", "state", "subject", "supportEndsAt", "supportStartedAt", "tools",
  ]);
  assert.deepEqual(receipt.payload, { path: "/bootstrap.txt",
    sha256: "3dcac3d89244976f683b3d6c26b91cd992b758baa17801f08b1533c0e235be38", size: 46 });
  assert.equal(receipt.recipe.sha256, "aea9d6d5010b46d1fa97daa186252d0d641d7aa31d1ac2b68541b94596b0de65");
  assert.equal(receipt.recipe.size, 246);
  assert.deepEqual(receipt.remoteTagManifest, { sha256: manifestDigest, size: Buffer.byteLength(rawManifest),
    configDigest: localId });
  assert.deepEqual(receipt.remoteDigestManifest, receipt.remoteTagManifest);
  assert.deepEqual(receipt.localImageCleanup, { state: "ABSENT" });
  assert.deepEqual(receipt.code.files.map((entry) => entry.path),
    POSTGRES_PACKAGE_BOOTSTRAP.authenticatedFiles);
  assert.deepEqual(receipt.phases.map(({ name, result }) => [name, result]), [
    ["managed_tool_identity", "PASSED"], ["checkout_and_recipe_identity", "PASSED"],
    ["protected_main_before_login", "PASSED"], ["local_tag_absent", "PASSED"], ["local_inventory_before", "PASSED"],
    ["fixed_scratch_materialization", "PASSED"], ["registry_login", "PASSED"],
    ["remote_tag_absent", "PASSED"], ["protected_main_before_write", "PASSED"],
    ["harmless_first_write", "PASSED"], ["remote_tag_manifest", "PASSED"],
    ["remote_digest_manifest", "PASSED"], ["owned_cleanup", "PASSED"],
  ]);
  const login = calls.find(({ args }) => args[0] === "login");
  assert.equal(login.input, `${item.env.GITHUB_TOKEN}\n`);
  assert.equal(login.args.includes(item.env.GITHUB_TOKEN), false);
  assert.equal(login.env.GITHUB_TOKEN, undefined);
  assert.equal(path.dirname(login.env.BUILDX_CONFIG), login.env.DOCKER_CONFIG);
  const build = calls.find(({ args }) => args[0] === "buildx" && args[1] === "build");
  assert.equal(build.args.includes("--push"), true);
  assert.equal(build.args.includes("--network=none"), true);
  assert.equal(build.args.includes(item.tag), true);
  assert.equal(calls.some(({ args }) => ["run", "create", "prune"].includes(args[0])), false);
  const rawReceipt = readFileSync(path.join(item.output, "receipt.json"), "utf8");
  assert.equal(rawReceipt.includes(item.env.GITHUB_TOKEN), false);
  assert.equal(existsSync(path.join(item.runnerTemp, `aw-postgres-package-bootstrap-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
});

test("a validated retained local image and untagged cache image are both removed safely", async (context) => {
  const item = fixture("36360000002");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  const receipt = await runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls, tag: item.tag, retainLocal: true, retainIdAfterUntag: true }), env: item.env,
    fetchImpl: async () => branchResponse(), platform: "linux" });
  assert.deepEqual(receipt.localImageCleanup, { state: "REMOVED", id: localId });
  assert.deepEqual(calls.filter(({ args }) => args[0] === "image" && args[1] === "rm").map(({ args }) => args[2]),
    [item.tag, localId]);
  assert.equal(calls.some(({ args }) => args.includes("--force") || args.includes("-f")), false);
});

test("an untagged config image is removed only when absent from the pre-write inventory", async (context) => {
  const created = fixture("36360000004");
  context.after(() => rmSync(created.runnerTemp, { recursive: true, force: true }));
  const createdCalls = [];
  const createdReceipt = await runPostgresPackageBootstrap({ argv: ["--output", created.output],
    commandRunner: runner({ calls: createdCalls, tag: created.tag, retainIdAfterUntag: true }), env: created.env,
    fetchImpl: async () => branchResponse(), platform: "linux" });
  assert.deepEqual(createdReceipt.localImageCleanup, { state: "REMOVED", id: localId });
  assert.deepEqual(createdCalls.filter(({ args }) => args[0] === "image" && args[1] === "rm").map(({ args }) => args[2]),
    [localId]);

  const existing = fixture("36360000005");
  context.after(() => rmSync(existing.runnerTemp, { recursive: true, force: true }));
  const existingCalls = [];
  const existingReceipt = await runPostgresPackageBootstrap({ argv: ["--output", existing.output],
    commandRunner: runner({ calls: existingCalls, tag: existing.tag, retainIdAfterUntag: true, preexistingConfig: true }),
    env: existing.env, fetchImpl: async () => branchResponse(), platform: "linux" });
  assert.deepEqual(existingReceipt.localImageCleanup, { state: "PREEXISTING_NOT_REMOVED" });
  assert.equal(existingCalls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);

  const retagged = fixture("36360000007");
  context.after(() => rmSync(retagged.runnerTemp, { recursive: true, force: true }));
  const retaggedCalls = [];
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", retagged.output],
    commandRunner: runner({ calls: retaggedCalls, tag: retagged.tag, retainLocal: true, preexistingConfig: true }),
    env: retagged.env, fetchImpl: async () => branchResponse(), platform: "linux" }), /local_image_preexisting/u);
  const retaggedReceipt = JSON.parse(readFileSync(path.join(retagged.output, "receipt.json"), "utf8"));
  assert.deepEqual(retaggedReceipt.localImageCleanup, { state: "PREEXISTING_NOT_REMOVED" });
  assert.equal(retaggedReceipt.result, "FAILED");
  assert.equal(retaggedCalls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);

  const foreign = fixture("36360000006");
  context.after(() => rmSync(foreign.runnerTemp, { recursive: true, force: true }));
  const foreignCalls = [];
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", foreign.output],
    commandRunner: runner({ calls: foreignCalls, tag: foreign.tag, retainIdAfterUntag: true, foreignId: true }),
    env: foreign.env, fetchImpl: async () => branchResponse(), platform: "linux" }), /local_image_invalid/u);
  const foreignReceipt = JSON.parse(readFileSync(path.join(foreign.output, "receipt.json"), "utf8"));
  assert.deepEqual(foreignReceipt.localImageCleanup, { state: "UNCERTAIN" });
  assert.equal(foreignCalls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
});

test("failed push preserves unconfirmed outcome, redacts diagnostics and cleans its exact local image", async (context) => {
  const item = fixture("36360000003");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls, tag: item.tag, retainLocal: true, failPush: true }), env: item.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /push_outcome_unconfirmed/u);
  const raw = readFileSync(path.join(item.output, "receipt.json"), "utf8");
  const receipt = JSON.parse(raw);
  assert.equal(receipt.publication, "ATTEMPTED_OUTCOME_UNCONFIRMED");
  assert.equal(receipt.result, "FAILED");
  assert.deepEqual(receipt.localImageCleanup, { state: "REMOVED", id: localId });
  assert.doesNotMatch(raw, /SECRET_VALUE|secret-token-value/u);
  assert.equal(receipt.phases.at(-1).result, "PASSED");

  const untagged = fixture("36360000008");
  context.after(() => rmSync(untagged.runnerTemp, { recursive: true, force: true }));
  const untaggedCalls = [];
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", untagged.output],
    commandRunner: runner({ calls: untaggedCalls, tag: untagged.tag, failPush: true, newIdAfterFailedPush: true }),
    env: untagged.env, fetchImpl: async () => branchResponse(), platform: "linux" }), /push_outcome_unconfirmed/u);
  const untaggedReceipt = JSON.parse(readFileSync(path.join(untagged.output, "receipt.json"), "utf8"));
  assert.deepEqual(untaggedReceipt.localImageCleanup, { state: "UNCERTAIN" });
  assert.equal(untaggedReceipt.phases.at(-1).result, "FAILED");
  assert.equal(untaggedCalls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
});

test("foreign local tags, existing remote tags, unprotected main and dirty code fail closed", async (context) => {
  const cases = [
    { id: "foreign", options: { retainLocal: true, foreignLocal: true }, expected: /local_image_invalid/u },
    { id: "remote", options: { remoteCollision: true }, expected: /remote_tag_collision/u },
  ];
  for (const [index, itemCase] of cases.entries()) {
    const item = fixture(`3636000010${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", item.output],
      commandRunner: runner({ calls, tag: item.tag, ...itemCase.options }), env: item.env,
      fetchImpl: async () => branchResponse(), platform: "linux" }), itemCase.expected);
    assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
  }

  const branch = fixture("36360000102");
  context.after(() => rmSync(branch.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", branch.output],
    commandRunner: runner({ calls: [], tag: branch.tag }), env: branch.env,
    fetchImpl: async () => branchResponse(sourceSha, false), platform: "linux" }), /main_mismatch/u);

  const dirty = fixture("36360000103");
  context.after(() => rmSync(dirty.runnerTemp, { recursive: true, force: true }));
  const base = runner({ calls: [], tag: dirty.tag });
  const dirtyRunner = (command, args, options) => args[0] === "status"
    ? { status: 0, stdout: " M scripts/postgres-image/package-bootstrap.mjs\n", stderr: "" }
    : base(command, args, options);
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", dirty.output], commandRunner: dirtyRunner,
    env: dirty.env, fetchImpl: async () => branchResponse(), platform: "linux" }), /checkout_dirty/u);

  const substituted = fixture("36360000104");
  context.after(() => rmSync(substituted.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", substituted.output],
    commandRunner: runner({ calls: [], tag: substituted.tag, committedSubstitution: true }), env: substituted.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /checkout_dirty/u);

  const ambiguousRemote = fixture("36360000105");
  context.after(() => rmSync(ambiguousRemote.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", ambiguousRemote.output],
    commandRunner: runner({ calls: [], tag: ambiguousRemote.tag, ambiguousRemoteAbsent: true }), env: ambiguousRemote.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /remote_tag_state_ambiguous/u);
});

test("remote mismatch and cleanup failure retain confirmed publication facts without claiming success", async (context) => {
  const mismatch = fixture("36360000201");
  context.after(() => rmSync(mismatch.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", mismatch.output],
    commandRunner: runner({ calls: [], tag: mismatch.tag, mismatchedRemote: true }), env: mismatch.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /remote_manifest_invalid/u);
  const mismatchReceipt = JSON.parse(readFileSync(path.join(mismatch.output, "receipt.json"), "utf8"));
  assert.equal(mismatchReceipt.publication, "ATTEMPTED_OUTCOME_UNCONFIRMED");
  assert.equal(mismatchReceipt.admission, "NOT_AUTHORIZED");

  const cleanup = fixture("36360000202");
  context.after(() => rmSync(cleanup.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", cleanup.output],
    commandRunner: runner({ calls: [], tag: cleanup.tag, retainLocal: true, failCleanup: true }), env: cleanup.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /command_failed/u);
  const cleanupReceipt = JSON.parse(readFileSync(path.join(cleanup.output, "receipt.json"), "utf8"));
  assert.equal(cleanupReceipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(cleanupReceipt.publication, "PUBLISHED_UNADMITTED");
  assert.equal(cleanupReceipt.result, "FAILED");
  assert.deepEqual(cleanupReceipt.localImageCleanup, { state: "FAILED", id: localId });
  assert.equal(cleanupReceipt.phases.at(-1).result, "FAILED");
});

test("a changed protected-main head stops before the first registry write", async (context) => {
  const item = fixture("36360000206");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  let fetches = 0;
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls, tag: item.tag }), env: item.env,
    fetchImpl: async () => branchResponse(fetches++ === 0 ? sourceSha : "f".repeat(40)), platform: "linux" }),
  /main_mismatch/u);
  assert.equal(fetches, 2);
  assert.equal(calls.some(({ args }) => args[0] === "buildx" && args[1] === "build"), false);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.publication, "NOT_ATTEMPTED");
  assert.deepEqual(receipt.localImageCleanup, { state: "NOT_CREATED" });
});

test("an uncertain post-push local inventory is retried during cleanup and never reported absent", async (context) => {
  const item = fixture("36360000203");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls: [], tag: item.tag, ambiguousInspect: true }), env: item.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /local_inventory_ambiguous/u);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.publication, "ATTEMPTED_OUTCOME_UNCONFIRMED");
  assert.equal(receipt.result, "FAILED");
  assert.deepEqual(receipt.localImageCleanup, { state: "UNCERTAIN" });
  assert.equal(receipt.phases.at(-1).reason, "postgres_package_bootstrap_cleanup_uncertain");

  const interrupted = fixture("36360000205");
  context.after(() => rmSync(interrupted.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", interrupted.output],
    commandRunner: runner({ calls, tag: interrupted.tag, interruptedInspect: true }), env: interrupted.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /local_inventory_ambiguous/u);
  const interruptedReceipt = JSON.parse(readFileSync(path.join(interrupted.output, "receipt.json"), "utf8"));
  assert.deepEqual(interruptedReceipt.localImageCleanup, { state: "UNCERTAIN" });
  assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
});

test("remote proof rejects a self-consistent manifest with an alternate layer shape", async (context) => {
  const item = fixture("36360000204");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const parsed = JSON.parse(rawManifest);
  const alternate = JSON.stringify({ ...parsed, layers: [...parsed.layers,
    { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: `sha256:${"e".repeat(64)}`, size: 1 }] });
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls: [], tag: item.tag, publishedManifest: alternate }), env: item.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /remote_manifest_invalid/u);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.publication, "ATTEMPTED_OUTCOME_UNCONFIRMED");
  assert.equal(receipt.result, "FAILED");

  const config = fixture("36360000207");
  context.after(() => rmSync(config.runnerTemp, { recursive: true, force: true }));
  const parsedConfig = JSON.parse(rawManifest);
  parsedConfig.config.digest = `sha256:${"e".repeat(64)}`;
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", config.output],
    commandRunner: runner({ calls: [], tag: config.tag, publishedManifest: JSON.stringify(parsedConfig) }), env: config.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /remote_manifest_invalid/u);

  const local = fixture("36360000208");
  context.after(() => rmSync(local.runnerTemp, { recursive: true, force: true }));
  const localCalls = [];
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", local.output],
    commandRunner: runner({ calls: localCalls, tag: local.tag, retainLocal: true,
      metadataConfigDigest: `sha256:${"e".repeat(64)}` }), env: local.env,
    fetchImpl: async () => branchResponse(), platform: "linux" }), /local_image_invalid/u);
  assert.equal(localCalls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
});

test("the monotonic budget stops before publication and preserves the cleanup reserve", async (context) => {
  const item = fixture("36360000301");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  let clock = 0;
  await assert.rejects(runPostgresPackageBootstrap({ argv: ["--output", item.output],
    commandRunner: runner({ calls, tag: item.tag }), env: item.env,
    fetchImpl: async () => branchResponse(), now: () => { clock += 70_000; return clock; }, platform: "linux" }),
  /job_timeout/u);
  assert.equal(calls.some(({ args }) => args[0] === "buildx" && args[1] === "build"), false);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.publication, "NOT_ATTEMPTED");
  assert.equal(receipt.result, "FAILED");
  assert.deepEqual(receipt.localImageCleanup, { state: "NOT_CREATED" });
  assert.equal(receipt.phases.filter((phase) => phase.result === "FAILED").length, 1);
  assert.equal(receipt.phases.find((phase) => phase.result === "FAILED").reason,
    "postgres_package_bootstrap_job_timeout");
  assert.deepEqual(receipt.phases.at(-1), {
    name: "owned_cleanup", result: "PASSED", durationMs: 70_000,
  });
});
