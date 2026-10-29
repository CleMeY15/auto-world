import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TEST_ONLY_CHILD_OPERATIONS as childOperations,
  TEST_ONLY_LIMITS as limits,
  TEST_ONLY_assessHelp as assessHelp,
  TEST_ONLY_canonicalJson as canonicalJson,
  TEST_ONLY_cleanupOwnedState as cleanupOwnedState,
  TEST_ONLY_downloadBytes as downloadBytes,
  TEST_ONLY_executeActor as executeActor,
  TEST_ONLY_materializeObservation as materializeObservation,
  TEST_ONLY_main as run,
  TEST_ONLY_notRunEvidence as notRunEvidence,
  TEST_ONLY_parseKeyManifest as parseKeyManifest,
  TEST_ONLY_parseQuery as parseQuery,
  TEST_ONLY_parseRegularManifest as parseRegularManifest,
  TEST_ONLY_parseSecdb as parseSecdb,
  TEST_ONLY_parseTransaction as parseTransaction,
  TEST_ONLY_privateTreeBytes as privateTreeBytes,
  TEST_ONLY_publicFailure as publicFailure,
  TEST_ONLY_readFailureMarker as readFailureMarker,
  TEST_ONLY_requireContext as requireContext,
  TEST_ONLY_runCarrier as runCarrier,
  TEST_ONLY_runCommand as runCommand,
  TEST_ONLY_validateCanonicalUrl as validateCanonicalUrl,
  TEST_ONLY_validateCommandResult as validateCommandResult,
  TEST_ONLY_validateEvidence as validateEvidence,
} from "../scripts/diagnostics/task005-git-materials-v3.mjs";

const workflowPath = new URL("../.github/workflows/task005-git-materials-v3.yml", import.meta.url);
const BASE = "4517b120f1e126dff15e710a34d950694e20eae5";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MERGE = "89abcdef0123456789abcdef0123456789abcdef";

async function fixtureContext() {
  const created = await mkdtemp(path.join(os.tmpdir(), "task005-git-materials-"));
  const runnerTemp = await realpath(created);
  const eventPath = path.join(runnerTemp, "event.json");
  const event = {
    action: "opened",
    number: 205,
    repository: { full_name: "CleMeY15/auto-world" },
    pull_request: {
      draft: true,
      state: "open",
      base: { ref: "main", sha: BASE, repo: { full_name: "CleMeY15/auto-world" } },
      head: { ref: "codex/task-0005-git-materials-v3", sha: HEAD,
        repo: { full_name: "CleMeY15/auto-world" } },
    },
  };
  await writeFile(eventPath, JSON.stringify(event), { mode: 0o600 });
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_ACTION: "opened",
    GITHUB_BASE_REF: "main",
    GITHUB_HEAD_REF: "codex/task-0005-git-materials-v3",
    GITHUB_HEAD_SHA: HEAD,
    GITHUB_SHA: MERGE,
    GITHUB_RUN_NUMBER: "1",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "40999999999",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/task005-git-materials-v3.yml@refs/pull/205/merge",
    RUNNER_TEMP: runnerTemp,
    PATH: process.env.PATH ?? "",
  };
  return { runnerTemp, eventPath, env };
}

function completeHelp() {
  return {
    root: Buffer.from("--keys-dir --repositories-file --root --network MODE"),
    add: Buffer.from("add --simulate"),
    fetch: Buffer.from("fetch --output --stdout"),
    verify: Buffer.from("verify"),
    query: Buffer.from("query --format --fields --from --recursive"),
    manifest: Buffer.from("manifest"),
    version: Buffer.from("version --test"),
  };
}

function helpWithoutManifestCapability() {
  return { ...completeHelp(), manifest: Buffer.from("unsupported operation") };
}

function enoughCapacity() {
  return { bavail: BigInt(30 * 1024 ** 2), bsize: 1024n };
}

const hash = (value) => createHash("sha256").update(value).digest("hex");

function response(bytes, headers = {}) {
  return new globalThis.Response(bytes, { status: 200, headers: { "content-length": String(bytes.length), ...headers } });
}

function observationFixture({ repositoryHash, secfixes = { "0": ["CVE-2021-29468"] }, failAt = -1 } = {}) {
  const index = Buffer.from("signed-index-fixture");
  const apk = Buffer.from("signed-git-apk-fixture");
  const secdb = Buffer.from(JSON.stringify({
    distroversion: "v3.24",
    reponame: "main",
    packages: [{ pkg: { name: "git", secfixes } }],
  }));
  const calls = [];
  const records = [];
  const command = (executable, args, options) => {
    assert.equal(executable, "docker");
    calls.push([...args]);
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    if (records.length - 1 === failAt) {
      return { status: 23, stdout: Buffer.from("PRIVATE_STDOUT_SENTINEL"),
        stderr: Buffer.from("PRIVATE_STDERR_SENTINEL") };
    }
    const entrypointAt = args.indexOf("--entrypoint");
    assert.notEqual(entrypointAt, -1);
    const entrypoint = args[entrypointAt + 1];
    const carrierArgs = args.slice(entrypointAt + 3);
    let stdout;
    if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("find /etc/apk/keys")) {
      stdout = `alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub\t451\t${"a".repeat(64)}\n`;
    } else if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("fetch --stdout")) {
      stdout = `${repositoryHash ?? hash(apk)}  -\n`;
    } else if (entrypoint === "/bin/sha256sum") {
      stdout = `${"b".repeat(64)}  /lib/apk/db/installed\n`;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("verify")) {
      stdout = "";
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("add")) {
      stdout = "(1/1) Installing git (2.54.0-r0)\nOK: 12 MiB in 15 packages\n";
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("query")) {
      const queryAt = carrierArgs.indexOf("query");
      assert.deepEqual(carrierArgs.slice(queryAt + 1, queryAt + 3), ["--from", "repositories"]);
      const fieldsAt = carrierArgs.indexOf("--fields");
      assert.equal(carrierArgs[fieldsAt + 1],
        "name,version,arch,file-size,installed-size,license,origin,maintainer,commit,depends,install-if");
      stdout = JSON.stringify([{ name: "git", version: "2.54.0-r0", arch: "x86_64",
        "file-size": apk.length, "installed-size": 1024, license: "GPL-2.0-only",
        origin: "git", maintainer: "Alpine Developers <alpine-devel@lists.alpinelinux.org>",
        commit: "c".repeat(40), depends: ["so:libc.musl-x86_64.so.1"], "install-if": [] }]);
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("manifest")) {
      stdout = `SHA256:${"d".repeat(64)}  usr/bin/git\n`;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("version")) {
      stdout = ">\n";
    } else {
      assert.fail(`unexpected injected command: ${entrypoint} ${carrierArgs.join(" ")}`);
    }
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  const fetchImpl = async (url) => {
    if (url.endsWith("APKINDEX.tar.gz")) return response(index);
    if (url.endsWith("git-2.54.0-r0.apk")) return response(apk);
    if (url.endsWith("main.json")) return response(secdb, {
      etag: '"secdb-fixture"', "last-modified": "Wed, 28 Oct 2026 20:00:00 GMT",
    });
    assert.fail(`unexpected injected URL: ${url}`);
  };
  return { apk, calls, command, fetchImpl, records };
}

async function cleanupPrivate(context) {
  await rm(context.privateRoot, { recursive: true });
}

async function readPublicEvidence(context) {
  return {
    receipt: JSON.parse(await readFile(path.join(context.publicRoot, "receipt.json"), "utf8")),
    manifest: JSON.parse(await readFile(path.join(context.publicRoot, "manifest.json"), "utf8")),
  };
}

function captureThrown(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail("expected callback to throw");
}

async function captureRejected(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  assert.fail("expected callback to reject");
}

function expectedDiagnostic(operation, reason, {
  status = null, signal = null, stdoutBytes = 0, stderrBytes = 0,
} = {}) {
  return { operation, reason, status, signal, stdoutBytes, stderrBytes };
}

function childFailure(operation, result = { status: 23, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) {
  return captureThrown(() => validateCommandResult(result, [0], operation));
}

function normalizedCommandRecord(record, context) {
  const normalize = (value) => typeof value === "string"
    ? value.replaceAll(context.runnerTemp, "<RUNNER_TEMP>")
      .replace(/aw-task005-git-materials-[0-9]+-[0-9]{3}/gu, "aw-task005-git-materials-<RUN_ID>-<ORDINAL>")
      .replaceAll(context.runId, "<RUN_ID>")
      .replaceAll("\\", "/")
    : value;
  return {
    executable: record.executable,
    args: record.args.map(normalize),
    cwd: normalize(record.options.cwd),
    env: Object.fromEntries(Object.entries(record.options.env).sort().map(([key, value]) => [key,
      key === "PATH" ? "<PATH>" : key === "DOCKER_CONFIG" && value !== "" ? "<DOCKER_CONFIG>" : normalize(value)])),
    timeoutMs: record.options.timeoutMs,
  };
}

const CARRIER_DIGEST = "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747";
const CARRIER_REFERENCE = `golang@${CARRIER_DIGEST}`;
const FIXTURE_IMAGE_ID = `sha256:${"e".repeat(64)}`;

function probeCommandFixture(context, failAt = -1) {
  const records = [];
  const command = (executable, args, options) => {
    const index = records.length;
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    assert.equal(executable, "docker");
    assert.deepEqual(Object.keys(options.env).sort(), ["DOCKER_CONFIG", "LANG", "LC_ALL", "PATH"]);
    if (index === 0) {
      assert.deepEqual(args, ["image", "ls", "--all", "--digests", "--no-trunc", "--format",
        "{{.Repository}}@{{.Digest}}|{{.ID}}"]);
      assert.equal(options.cwd, context.runnerTemp);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
    } else if (index === 1) {
      assert.deepEqual(args, ["pull", "--platform", "linux/amd64", CARRIER_REFERENCE]);
      assert.equal(options.cwd, context.privateRoot);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= limits.transferMs);
    } else if (index === 2) {
      assert.deepEqual(args, ["image", "inspect", "--format", "{{json .RepoDigests}}|{{.Id}}", CARRIER_REFERENCE]);
      assert.equal(options.cwd, context.privateRoot);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
    } else {
      const expectedCarrierArgs = [
        ["/sbin/apk", ["--version"]], ["/sbin/apk", ["--help"]], ["/sbin/apk", ["add", "--help"]],
        ["/sbin/apk", ["verify", "--help"]], ["/sbin/apk", ["query", "--help"]],
        ["/sbin/apk", ["manifest", "--help"]], ["/sbin/apk", ["fetch", "--help"]],
        ["/sbin/apk", ["version", "--help"]],
      ][index - 3];
      const name = `aw-task005-git-materials-${context.runId}-${String(index - 2).padStart(3, "0")}`;
      assert.deepEqual(args, ["run", "--rm", "--pull", "never", "--platform", "linux/amd64", "--network", "none",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pids-limit", "64",
        "--memory", "256m", "--memory-swap", "256m", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--name", name,
        "--label", "com.auto-world.task005.git-materials-v3=true",
        "--label", `com.auto-world.github-run-id=${context.runId}`,
        "--entrypoint", expectedCarrierArgs[0], CARRIER_REFERENCE, ...expectedCarrierArgs[1]]);
      assert.equal(options.cwd, context.privateRoot);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= limits.childMs);
    }
    if (index === failAt) return { status: 23, stdout: Buffer.alloc(0), stderr: Buffer.from("PRIVATE_PROBE") };
    let stdout = "";
    if (index === 0) stdout = "";
    else if (index === 1) stdout = "pulled\n";
    else if (index === 2) stdout = `${JSON.stringify([CARRIER_REFERENCE])}|${FIXTURE_IMAGE_ID}\n`;
    else {
      const entrypointAt = args.indexOf("--entrypoint");
      const entrypoint = args[entrypointAt + 1];
      const carrierArgs = args.slice(entrypointAt + 3);
      if (entrypoint === "/sbin/apk" && carrierArgs.length === 1 && carrierArgs[0] === "--version") {
        stdout = "apk-tools 3.0.0, compiled for x86_64.\n";
      } else if (entrypoint === "/sbin/apk") {
        const key = carrierArgs[0] === "--help" ? "root" : carrierArgs[0];
        stdout = completeHelp()[key].toString("utf8");
      } else assert.fail(`unexpected probe command ${args.join(" ")}`);
    }
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  return { command, records };
}

async function cleanupFaultFixture(context, failAt) {
  await mkdir(context.privateRoot, { mode: 0o700 });
  await writeFile(path.join(context.privateRoot, "carrier-initially-absent"), "INITIAL_ABSENT\n", { mode: 0o600 });
  await writeFile(path.join(context.privateRoot, "carrier-image-id"), `${FIXTURE_IMAGE_ID}\n`, { mode: 0o600 });
  const name = `aw-task005-git-materials-${context.runId}-001`;
  const records = [];
  let containerRemoved = false;
  let imageRemoved = false;
  const command = (executable, args, options) => {
    const index = records.length;
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    assert.equal(executable, "docker");
    assert.deepEqual(Object.keys(options.env).sort(), ["DOCKER_CONFIG", "LANG", "LC_ALL", "PATH"]);
    assert.equal(options.cwd, context.runnerTemp);
    if (index === 0) {
      assert.deepEqual(args, ["container", "ls", "--all", "--filter",
        "label=com.auto-world.task005.git-materials-v3=true", "--filter",
        `label=com.auto-world.github-run-id=${context.runId}`, "--format", "{{.Names}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 1 || index === 3) {
      assert.deepEqual(args, ["container", "ls", "--all", "--format",
        "{{.Names}}|{{.Label \"com.auto-world.task005.git-materials-v3\"}}|{{.Label \"com.auto-world.github-run-id\"}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 2) {
      assert.deepEqual(args, ["container", "rm", "--force", name]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 4 || index === 6) {
      assert.deepEqual(args, ["image", "ls", "--all", "--digests", "--no-trunc", "--format",
        "{{.Repository}}@{{.Digest}}|{{.ID}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 5) {
      assert.deepEqual(args, ["image", "rm", CARRIER_REFERENCE]);
      assert.equal(options.timeoutMs, 60_000);
    }
    if (index === failAt) return { status: 23, stdout: Buffer.alloc(0), stderr: Buffer.from("PRIVATE_CLEANUP") };
    let stdout = "";
    if (args[0] === "container" && args[1] === "ls" && args.includes("--filter")) stdout = `${name}\n`;
    else if (args[0] === "container" && args[1] === "ls") {
      stdout = containerRemoved ? "" : `${name}|true|${context.runId}\n`;
    } else if (args[0] === "container" && args[1] === "rm") containerRemoved = true;
    else if (args[0] === "image" && args[1] === "ls") {
      stdout = imageRemoved ? "" : `${CARRIER_REFERENCE}|${FIXTURE_IMAGE_ID}\n`;
    } else if (args[0] === "image" && args[1] === "rm") imageRemoved = true;
    else assert.fail(`unexpected cleanup command ${args.join(" ")}`);
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  return { command, records };
}

test("supported partial collection emits a non-authoritative material observation", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const evidence = await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: `sha256:${"e".repeat(64)}` },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
    });
    validateEvidence(evidence, context);
    assert.equal(evidence.receipt.state, "MATERIAL_OBSERVATION_ONLY");
    assert.equal(evidence.receipt.installationAuthority, false);
    assert.deepEqual(evidence.receipt.boundaries, {
      hookContent: "NOT_INSPECTED",
      indexMetadata: "OBSERVED",
      nonregularFileMetadata: "NOT_INSPECTED",
      regularFileManifest: "OBSERVED",
      repoCommitMeaning: "SIGNED_INDEX_DECLARATION_ONLY",
    });
    assert.deepEqual(evidence.receipt.execution, {
      gitExecuted: false, packageInstalled: false, packagePayloadExecuted: false,
    });
    assert.equal(evidence.receipt.security.stage2, "BLOCKED");
    assert.equal(evidence.manifest.packages[0].indexBinding, "VERIFIED_BY_APK_FETCH");
    assert.equal(evidence.manifest.packages[0].localSignature, "VERIFIED_BY_APK_VERIFY");
    assert.ok(observed.calls.every((args) => !args.includes("git")));
    assert.ok(observed.calls.filter((args) => args.includes("add")).every((args) => args.includes("--simulate")));
    assert.equal((await lstat(context.privateRoot)).isDirectory(), true);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("signed-index repository bytes must match the downloaded APK", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ repositoryHash: "f".repeat(64) });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await assert.rejects(materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: `sha256:${"e".repeat(64)}` },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
    }), { code: "task005_git_materials_material_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("material observation stops when the actor deadline is exhausted", async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    let call = 0;
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: `sha256:${"e".repeat(64)}` },
      command: () => assert.fail("deadline must stop before the first command"),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
      fetchImpl: () => assert.fail("deadline must stop before acquisition"),
      now: () => call++ === 0 ? 0 : limits.actorMs,
    }));
    assert.equal(error.code, "task005_git_materials_child_timeout");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("private evidence rejects hard-linked material", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "task005-git-hardlink-"));
  try {
    const first = path.join(root, "first.apk");
    await writeFile(first, "fixture", { mode: 0o600 });
    await link(first, path.join(root, "second.apk"));
    await assert.rejects(privateTreeBytes(root), { code: "task005_git_materials_material_invalid" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup distinguishes a Docker daemon error from confirmed absence", async () => {
  const fixture = await fixtureContext();
  const context = await requireContext(fixture.env, "linux");
  try {
    await assert.rejects(cleanupOwnedState(context, () => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("daemon unavailable") })),
      { code: "task005_git_materials_child_failed" });
    await cleanupOwnedState(context, (_command, args) => {
      assert.deepEqual(args.slice(0, 3), ["container", "ls", "--all"]);
      return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("workflow is a one-shot draft PR actor with read-only permission and exact paths", async () => {
  const bytes = await readFile(workflowPath, "utf8");
  assert.match(bytes, /pull_request:\n {4}types: \[opened\]\n {4}branches: \[main\]/u);
  assert.doesNotMatch(bytes, /workflow_dispatch:|\bpush:|schedule:/u);
  assert.equal([...bytes.matchAll(/^permissions:/gmu)].length, 1);
  assert.match(bytes, /^permissions:\n {2}contents: read$/mu);
  assert.match(bytes, /github\.event\.pull_request\.draft == true/u);
  assert.match(bytes, /github\.head_ref == 'codex\/task-0005-git-materials-v3'/u);
  assert.match(bytes, /github\.run_number == 1 && github\.run_attempt == 1/u);
  assert.match(bytes, /runs-on: ubuntu-24\.04\n {4}timeout-minutes: 45/u);
  assert.match(bytes, /Run the focused actor contract tests before acquisition\n {8}timeout-minutes: 2\n {8}run: node --test tests\/task005-git-materials-v3\.test\.mjs/u);
  assert.match(bytes, /id: diagnose\n {8}timeout-minutes: 22/u);
  assert.match(bytes, /id: cleanup\n {8}if: \$\{\{ always\(\) \}\}\n {8}timeout-minutes: 10/u);
  const stepTimeouts = [...bytes.matchAll(/^ {8}timeout-minutes: ([0-9]+)$/gmu)]
    .map((match) => Number(match[1]));
  assert.equal(stepTimeouts.reduce((total, value) => total + value, 0), 44);
  assert.match(bytes, /node-version: 22\.23\.2/u);
  assert.match(bytes, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(bytes, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(bytes, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.doesNotMatch(bytes, /secrets\.|github\.token|actions\/cache|packages:\s*write|contents:\s*write|environment:/u);
  assert.match(bytes, /\.github\/workflows\/task005-git-materials-v3\.yml\n {6}- scripts\/diagnostics\/task005-git-materials-v3\.mjs\n {6}- tests\/task005-git-materials-v3\.test\.mjs/u);
  assert.match(bytes, /if-no-files-found: error/u);
  assert.match(bytes, /compression-level: 0/u);
  assert.match(bytes, /steps\.diagnose\.outcome != 'success'.*steps\.cleanup\.outcome != 'success'.*steps\.retain\.outcome != 'success'.*steps\.dispose\.outcome != 'success'/u);
  assert.ok(bytes.indexOf("Run the focused actor contract tests before acquisition")
    < bytes.indexOf("Probe and diagnose exact Alpine materials"));
});

test("context accepts only the exact opened draft PR and accepted base", async () => {
  const fixture = await fixtureContext();
  try {
    const accepted = await requireContext(fixture.env, "linux");
    assert.equal(accepted.eventNumber, 205);
    assert.equal(accepted.headSha, HEAD);
    for (const changed of [
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_EVENT_ACTION: "synchronize" },
      { GITHUB_HEAD_REF: "other" },
      { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_RUN_ATTEMPT: "2" },
      { RUNNER_ENVIRONMENT: "self-hosted" },
      { GITHUB_WORKFLOW_REF: "other" },
    ]) {
      await assert.rejects(requireContext({ ...fixture.env, ...changed }, "linux"),
        { code: "task005_git_materials_context_invalid" });
    }
    await assert.rejects(requireContext(fixture.env, "win32"),
      { code: "task005_git_materials_context_invalid" });
    const event = JSON.parse(await readFile(fixture.eventPath, "utf8"));
    event.pull_request.base.sha = "f".repeat(40);
    await writeFile(fixture.eventPath, JSON.stringify(event));
    await assert.rejects(requireContext(fixture.env, "linux"),
      { code: "task005_git_materials_context_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("canonical URL boundary rejects alternate hosts, mutable paths and query data", () => {
  assert.equal(validateCanonicalUrl("https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz", "index"),
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz");
  assert.equal(validateCanonicalUrl("https://secdb.alpinelinux.org/v3.24/main.json", "secdb"),
    "https://secdb.alpinelinux.org/v3.24/main.json");
  assert.equal(validateCanonicalUrl("https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk", "apk"),
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk");
  for (const value of [
    "http://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk",
    "https://example.invalid/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk",
    "https://dl-cdn.alpinelinux.org/alpine/edge/main/x86_64/git-2.54.0-r0.apk",
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/../secret.apk",
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk?mirror=x",
  ]) assert.throws(() => validateCanonicalUrl(value, "apk"), { code: "task005_git_materials_url_invalid" });
  assert.throws(() => validateCanonicalUrl("https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/../secret.apk", "any"),
    { code: "task005_git_materials_url_invalid" });
  assert.throws(() => validateCanonicalUrl("https://secdb.alpinelinux.org/v3.24/main.json", "unknown"),
    { code: "task005_git_materials_url_invalid" });
});

test("bounded downloader uses a signal for a successful body", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  let signal;
  const headers = new globalThis.Headers({ "content-length": "2", etag: '"fixture"',
    "last-modified": "Wed, 28 Oct 2026 20:00:00 GMT" });
  const body = () => ({
    getReader: () => {
      let sent = false;
      return {
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: new Uint8Array([123, 125]) };
        },
        cancel: async () => {},
      };
    },
  });
  const fetched = await downloadBytes(url, 4, async (observed, options) => {
    assert.equal(observed, url);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["user-agent"], "auto-world-task005-git-materials-v3");
    signal = options.signal;
    return { ok: true, status: 200, url, headers, body: body() };
  }, 2_000, () => 1_000);
  assert.ok(signal instanceof globalThis.AbortSignal);
  assert.equal(fetched.bytes.toString("utf8"), "{}");
});

test("bounded downloader rejects a body that exceeds its cap after successful headers", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  const headers = new globalThis.Headers();
  const body = { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array([1, 2]) }),
    cancel: async () => {},
  }) };
  await assert.rejects(downloadBytes(url, 1, async () => ({ ok: true, status: 200, url,
    headers, body }), 2_000, () => 1_000), { code: "task005_git_materials_material_limit_exceeded" });
});

test("bounded downloader rejects a body that stalls after successful headers", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  const headers = new globalThis.Headers();
  await assert.rejects(downloadBytes(url, 4, async (_observed, options) => ({
    ok: true,
    status: 200,
    url,
    headers,
    body: { getReader: () => ({
      read: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
      cancel: async () => {},
    }) },
  }), 20, () => 0), { code: "task005_git_materials_download_failed" });
});

test("bounded downloader aborts when response headers never arrive without an unhandled rejection", { timeout: 1_000 }, async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    await assert.rejects(downloadBytes(url, 4, () => new Promise(() => {}), 20, () => 0),
      { code: "task005_git_materials_download_failed" });
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("bounded downloader rejects a redirect outside the canonical origin", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  await assert.rejects(downloadBytes(url, 4, async () => ({ ok: false, status: 302, url,
    headers: new globalThis.Headers({ location: "https://example.invalid/private" }) }), 2_000, () => 1_000),
  { code: "task005_git_materials_url_invalid" });
});

test("capability assessment is exact and missing capability yields bounded NOT_RUN before material acquisition", async () => {
  const help = completeHelp();
  assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  help.query = Buffer.from("query --format --fields --from");
  assert.deepEqual(assessHelp(help), { complete: false, missing: ["query:--recursive"] });
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = notRunEvidence(context, "apk-tools 3.0.0, compiled for x86_64.", help,
      assessHelp(help), { containersAbsent: true, privateFilesAbsent: true },
      `sha256:${"e".repeat(64)}`, 30 * 1024 ** 2);
    validateEvidence(observed, context);
    assert.equal(observed.receipt.state, "NOT_RUN");
    assert.equal(observed.receipt.materialsAcquired, false);
    assert.equal(observed.receipt.installationAuthorization, false);
    assert.equal(observed.receipt.packageInstalled, false);
    assert.equal(observed.receipt.gitExecuted, false);
    assert.deepEqual(observed.receipt.missingCapabilities, ["query:--recursive"]);
    const receiptBytes = Buffer.from(canonicalJson(observed.receipt));
    assert.ok(receiptBytes.length <= limits.publicFileBytes);
    assert.doesNotMatch(receiptBytes.toString("utf8"), new RegExp(fixture.runnerTemp.replaceAll("\\", "\\\\"), "u"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("capability assessment requires fetch stdout support from measured help", () => {
  const help = completeHelp();
  help.fetch = Buffer.from("fetch --output");
  assert.deepEqual(assessHelp(help), { complete: false, missing: ["fetch:--stdout"] });
});

test("public disposal fixture is provably missing the manifest capability", () => {
  assert.deepEqual(assessHelp(helpWithoutManifestCapability()), {
    complete: false,
    missing: ["manifest:manifest"],
  });
});

test("complete capability set rejects an observation that grants installation authority", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await assert.rejects(executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: () => assert.fail("container cleanup command is not expected without a created name"),
      cleanup: cleanupPrivate,
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), names: [] }),
      materialize: async () => ({
        receipt: { actor: "OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1", state: "MATERIAL_OBSERVATION_ONLY",
          installationAuthority: true },
        manifest: { actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", state: "MATERIAL_OBSERVATION_ONLY",
          installationAuthorization: false },
      }),
    }), { code: "task005_git_materials_material_invalid" });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("cleanup failure does not replace the first material failure", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await assert.rejects(executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw Object.assign(new Error("first"), { code: "task005_git_materials_download_failed" }); },
      command: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
      cleanup: async () => { throw Object.assign(new Error("cleanup"), { code: "task005_git_materials_cleanup_failed" }); },
    }), { code: "task005_git_materials_download_failed" });
    assert.equal((await lstat(context.privateRoot)).isDirectory(), true);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("public errors and canonical JSON do not expose arbitrary fields or paths", () => {
  const safe = JSON.parse(publicFailure({ code: "task005_git_materials_child_timeout", path: "C:/private/material.apk" }));
  assert.deepEqual(safe, {
    actor: "TASK005_GIT_MATERIALS_V1",
    authority: "DIAGNOSTIC_ONLY",
    code: "task005_git_materials_child_timeout",
    installationAuthorization: false,
    state: "FAILED",
  });
  const unsafe = publicFailure({ code: "unsafe /private/path", stack: "secret" });
  assert.equal(JSON.parse(unsafe).code, "task005_git_materials_failed");
  assert.doesNotMatch(unsafe, /private|secret/u);
  const brandedSecret = publicFailure({ code: "task005_git_materials_secret_stolen" });
  assert.equal(JSON.parse(brandedSecret).code, "task005_git_materials_failed");
  assert.equal(canonicalJson({ z: 1, a: { z: 2, a: 1 } }), '{"a":{"a":1,"z":2},"z":1}\n');
});

test("solver parser accepts additions only and requires the exact Git root", () => {
  const observed = parseTransaction(Buffer.from("(1/2) Installing pcre2 (10.49-r0)\n(2/2) Installing git (2.54.0-r0)\nOK: 42 MiB in 31 packages\n"));
  assert.deepEqual(observed, [
    { action: "ADD", name: "pcre2", order: 1, version: "10.49-r0" },
    { action: "ADD", name: "git", order: 2, version: "2.54.0-r0" },
  ]);
  assert.throws(() => parseTransaction(Buffer.from("(1/1) Upgrading git (2.54.0-r0)\n")),
    { code: "task005_git_materials_solver_invalid" });
  assert.throws(() => parseTransaction(Buffer.from("(1/1) Installing pcre2 (10.49-r0)\n")),
    { code: "task005_git_materials_solver_invalid" });
});

test("regular-file manifest rejects noncanonical paths and invalid UTF-8", () => {
  const observed = parseRegularManifest(Buffer.from(`SHA256:${"a".repeat(64)}  usr/bin/git\nSHA1:${"b".repeat(40)}  usr/libexec/git-core/git-add\n`));
  assert.equal(observed.entries.length, 2);
  assert.match(observed.sha256, /^[0-9a-f]{64}$/u);
  assert.throws(() => parseRegularManifest(Buffer.from(`SHA256:${"a".repeat(64)}  ../escape\n`)),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseRegularManifest(Buffer.from([0xc3, 0x28])),
    { code: "task005_git_materials_material_invalid" });
});

test("key manifest rejects duplicate, malformed and non-key entries", () => {
  const digest = "a".repeat(64);
  assert.throws(() => parseKeyManifest(Buffer.from(`alpine.rsa.pub\t42\t${digest}\nalpine.rsa.pub\t42\t${digest}\n`)),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseKeyManifest(Buffer.from(`not-a-key\t42\t${digest}\n`)),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseKeyManifest(Buffer.from([0xc3, 0x28])),
    { code: "task005_git_materials_material_invalid" });
});

test("query parser rejects malformed UTF-8 and malformed JSON", () => {
  const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
  assert.throws(() => parseQuery(Buffer.from([0xc3, 0x28]), transaction),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseQuery(Buffer.from("{"), transaction),
    { code: "task005_git_materials_material_invalid" });
});

test("query parser rejects legacy field names that apk query does not expose", () => {
  const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
  const legacy = [{ name: "git", version: "2.54.0-r0", architecture: "x86_64",
    checksum: "Q1fixture", size: 19, "installed-size": 1024, license: "GPL-2.0-only",
    origin: "git", maintainer: "Alpine Developers", commit: "c".repeat(40), depends: [], "install-if": [] }];
  assert.throws(() => parseQuery(Buffer.from(JSON.stringify(legacy)), transaction),
    { code: "task005_git_materials_material_invalid" });
});

test("SecDB zero sentinels stay unresolved and are never version-compared", () => {
  const compared = [];
  const secdb = Buffer.from(JSON.stringify({
    distroversion: "v3.24",
    reponame: "main",
    packages: [{ pkg: { name: "git", secfixes: {
      "0": ["CVE-2021-29468", "CVE-2021-46101"],
      "2.50.1-r0": ["CVE-2025-0001"],
    } } }],
  }));
  const result = parseSecdb(secdb, [{ name: "git", origin: "git", version: "2.54.0-r0" }], (left, right) => {
    compared.push([left, right]); return ">";
  });
  assert.deepEqual(compared, [["2.54.0-r0", "2.50.1-r0"]]);
  assert.equal(result[0].fixes.filter((item) => item.state === "SECDB_ZERO_SENTINEL_UNRESOLVED").length, 2);
  assert.equal(result[0].fixes.find((item) => item.cve === "CVE-2025-0001").state, "AT_OR_ABOVE_RECORDED_FIX");
  const absent = parseSecdb(secdb, [{ name: "libcurl", origin: "curl", version: "8.23.0-r0" }], () => assert.fail());
  assert.equal(absent[0].state, "UNKNOWN");
});

test("observation schema keeps both metadata gaps and every execution authority false", () => {
  const context = { runnerTemp: "/runner-temp" };
  const receipt = {
    actor: "OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1", authority: "DIAGNOSTIC_ONLY",
    boundaries: { hookContent: "NOT_INSPECTED", indexMetadata: "OBSERVED",
      nonregularFileMetadata: "NOT_INSPECTED", regularFileManifest: "OBSERVED",
      repoCommitMeaning: "SIGNED_INDEX_DECLARATION_ONLY" },
    carrier: { imageId: `sha256:${"e".repeat(64)}` }, cleanup: {}, closure: {},
    execution: { gitExecuted: false, packageInstalled: false, packagePayloadExecuted: false },
    index: { genericVerification: "PASSED", repositoryAcceptance: "SOLE_LOCAL_REPOSITORY_SOLVE_PASSED" },
    installationAuthority: false, keyManifest: {},
    packages: [{ name: "git", size: 19, version: "2.54.0-r0" }], resources: {},
    secdb: { acquisitionToUseMs: 0, freshness: "WITHIN_48_HOURS_NONAUTHORITATIVE", snapshotAgeMs: 0 },
    security: { exhaustiveCoverage: false, severityAvailable: false, stage2: "BLOCKED", stillUnfixedStateAvailable: false },
    source: {}, state: "MATERIAL_OBSERVATION_ONLY", transaction: {},
  };
  const manifest = { actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", installationAuthorization: false,
    packages: [{ bytes: 19, filename: "git-2.54.0-r0.apk", indexBinding: "VERIFIED_BY_APK_FETCH",
      localSignature: "VERIFIED_BY_APK_VERIFY", sha256: "f".repeat(64),
      url: "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk" }],
    state: "MATERIAL_OBSERVATION_ONLY" };
  assert.equal(validateEvidence({ receipt, manifest }, context).receipt.installationAuthority, false);
  assert.throws(() => validateEvidence({ receipt: { ...receipt, installationAuthority: true }, manifest }, context),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => validateEvidence({ receipt: { ...receipt,
    boundaries: { ...receipt.boundaries, hookContent: "OBSERVED" } }, manifest }, context),
  { code: "task005_git_materials_material_invalid" });
});

test("actor source contains no extraction, v2 dump, installation or Git execution command", async () => {
  const source = await readFile(new URL("../scripts/diagnostics/task005-git-materials-v3.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["'](?:extract|adbdump)["']/u);
  assert.doesNotMatch(source, /["']git["']\s*,\s*\[/u);
  assert.match(source, /"add", "--simulate", "git=2\.54\.0-r0"/u);
  assert.doesNotMatch(source, /"add", "git=/u);
  assert.match(source, /packageInstalled: false/u);
  assert.match(source, /packagePayloadExecuted: false/u);
  assert.match(source, /gitExecuted: false/u);
  assert.match(source, /find \/etc\/apk\/keys -mindepth 1 -maxdepth 1/u);
  assert.doesNotMatch(source, /\/etc\/apk\/keys\/\*\.rsa\.pub/u);
  assert.match(source, /writeFile\(repositories, "ndx file:\/\/\/materials\/repo\/APKINDEX\.tar\.gz\\n"/u);
  assert.match(source, /const queryFields = "name,version,arch,file-size,installed-size,license,origin,maintainer,commit,depends,install-if"/u);
  assert.doesNotMatch(source, /const queryFields = "[^"]*(?:architecture|checksum|(?:^|,)size(?:,|$))/u);
});

test("public disposal refuses unknown entries instead of broad deletion", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  const publicRoot = path.join(fixture.runnerTemp, "task005-git-materials-v3-public");
  const incompleteHelp = helpWithoutManifestCapability();
  assert.deepEqual(assessHelp(incompleteHelp), {
    complete: false,
    missing: ["manifest:manifest"],
  });
  try {
    await run(["execute"], fixture.env, {
      platform: "linux",
      statfs: async () => enoughCapacity(),
      command: () => assert.fail("container cleanup command is not expected without a created name"),
      cleanup: cleanupPrivate,
      probe: async () => ({
        version: "apk-tools 3.0.0, compiled for x86_64.",
        help: incompleteHelp,
        names: [],
      }),
      log: () => {},
    });
    await writeFile(path.join(publicRoot, "unknown"), "retain", { mode: 0o600 });
    await assert.rejects(run(["dispose-public"], fixture.env, { platform: "linux", log: () => {} }),
      { code: "task005_git_materials_public_cleanup_failed" });
    assert.equal((await lstat(path.join(publicRoot, "unknown"))).isFile(), true);
    await rm(path.join(publicRoot, "unknown"));
    await chmod(path.join(publicRoot, "receipt.json"), 0o600);
    await run(["dispose-public"], fixture.env, { platform: "linux", log: () => {} });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("child result classification preserves only closed diagnostics across direct and carrier operations", async (t) => {
  const overflow = Buffer.alloc(limits.childOutputBytes + 1, 0x78);
  const cases = [
    { name: "timeout", result: { error: { code: "ETIMEDOUT" } }, code: "task005_git_materials_child_timeout",
      diagnostic: expectedDiagnostic(null, "TIMEOUT") },
    { name: "native output cap", result: { error: { code: "ENOBUFS" } }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "OUTPUT_CAP") },
    { name: "measured output cap", result: { status: 0, stdout: overflow, stderr: Buffer.alloc(0) },
      code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "OUTPUT_CAP", { stdoutBytes: limits.childOutputBytes + 1 }) },
    { name: "spawn error", result: { error: { code: "EACCES" } }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "SPAWN_ERROR") },
    { name: "signal", result: { signal: "SIGKILL" }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "SIGNAL", { signal: "SIGKILL" }) },
    { name: "exit status", result: { status: 23 }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "EXIT_STATUS", { status: 23 }) },
    { name: "invalid result", result: { status: 256 }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "RESULT_INVALID") },
  ];
  for (const operation of ["PROBE_IMAGE_PULL", "MATERIAL_QUERY"]) {
    for (const item of cases) {
      await t.test(`${operation} ${item.name}`, () => {
        const error = captureThrown(() => validateCommandResult(item.result, [0], operation));
        assert.equal(error.code, item.code);
        assert.deepEqual(error.childDiagnostic, { ...item.diagnostic, operation });
        const serialized = JSON.stringify(error.childDiagnostic);
        assert.doesNotMatch(serialized, /PRIVATE|EACCES|ETIMEDOUT|ENOBUFS/u);
      });
    }
  }
});

test("child result classification applies the approved precedence without relaxing successful status", () => {
  const timedOut = captureThrown(() => validateCommandResult({
    error: { code: "ETIMEDOUT" }, signal: "SIGKILL", status: 23,
    stdout: Buffer.alloc(limits.childOutputBytes + 1),
  }, [0], "PROBE_IMAGE_PULL"));
  assert.deepEqual(timedOut.childDiagnostic, expectedDiagnostic("PROBE_IMAGE_PULL", "TIMEOUT",
    { stdoutBytes: limits.childOutputBytes + 1 }));

  const spawnError = captureThrown(() => validateCommandResult({ error: { code: "EACCES" }, signal: "SIGKILL", status: 23 },
    [0], "PROBE_IMAGE_PULL"));
  assert.deepEqual(spawnError.childDiagnostic, expectedDiagnostic("PROBE_IMAGE_PULL", "SPAWN_ERROR"));

  const signalled = captureThrown(() => validateCommandResult({ signal: "SIGKILL", status: 23 },
    [0], "PROBE_IMAGE_PULL"));
  assert.deepEqual(signalled.childDiagnostic, expectedDiagnostic("PROBE_IMAGE_PULL", "SIGNAL", { signal: "SIGKILL" }));

  const stdout = Buffer.from("ok");
  const stderr = Buffer.alloc(0);
  assert.deepEqual(validateCommandResult({ status: 0, stdout, stderr }, [0], "PROBE_IMAGE_PULL"),
    { status: 0, stdout, stderr });
});

test("signal projection preserves only the native allowlist", async (t) => {
  for (const signal of ["SIGABRT", "SIGALRM", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL",
    "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP", "SIGUSR1", "SIGUSR2"]) {
    await t.test(signal, () => {
      const error = captureThrown(() => validateCommandResult({ signal }, [0], "MATERIAL_QUERY"));
      assert.equal(error.childDiagnostic.signal, signal);
    });
  }
  const other = captureThrown(() => validateCommandResult({ signal: "SIGPRIVATE" }, [0], "MATERIAL_QUERY"));
  assert.equal(other.childDiagnostic.signal, "OTHER");
});

test("hostile child results cannot invoke accessors or expose inherited and private data", () => {
  let getterCalls = 0;
  const result = Object.create({ status: 23, stdout: Buffer.from("INHERITED_PRIVATE") });
  Object.defineProperty(result, "error", { get() { getterCalls += 1; throw new Error("PRIVATE_GETTER"); } });
  Object.defineProperty(result, "stderr", { get() { getterCalls += 1; return Buffer.from("PRIVATE_STDERR"); } });
  const error = captureThrown(() => validateCommandResult(result, [0], "MATERIAL_QUERY"));
  assert.equal(getterCalls, 0);
  assert.deepEqual(error.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "RESULT_INVALID"));
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE/u);

  const trapped = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("PRIVATE_PROXY"); } });
  const trappedError = captureThrown(() => validateCommandResult(trapped, [0], "MATERIAL_QUERY"));
  assert.deepEqual(trappedError.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "RESULT_INVALID"));
});

test("child byte counts ignore non-Buffers and clamp each stream independently", () => {
  const nonBuffers = captureThrown(() => validateCommandResult({ status: 23, stdout: "PRIVATE", stderr: new Uint8Array(9) },
    [0], "MATERIAL_QUERY"));
  assert.deepEqual(nonBuffers.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23 }));

  const oversized = captureThrown(() => validateCommandResult({ status: 0,
    stdout: Buffer.alloc(limits.childOutputBytes + 2), stderr: Buffer.alloc(limits.childOutputBytes + 3) },
  [0], "MATERIAL_QUERY"));
  assert.deepEqual(oversized.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "OUTPUT_CAP", {
    stdoutBytes: limits.childOutputBytes + 1, stderrBytes: limits.childOutputBytes + 1,
  }));
});

test("invalid operations reject before command invocation and carrier resource mutation", () => {
  let calls = 0;
  const command = () => { calls += 1; return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; };
  assert.throws(() => runCommand("MATERIAL_git=2.54.0-r0", command, "docker", ["version"], {
    cwd: "C:/private", env: {}, timeoutMs: 1,
  }), { code: "task005_git_materials_child_failed" });
  assert.equal(calls, 0);

  const resources = { nextOrdinal: 4, containerNames: ["retained"] };
  assert.throws(() => runCarrier({ runId: "40999999999", privateRoot: "C:/private" }, resources, command,
    "UNKNOWN_OPERATION", "/sbin/apk", ["--version"]), { code: "task005_git_materials_child_failed" });
  assert.equal(calls, 0);
  assert.deepEqual(resources, { nextOrdinal: 4, containerNames: ["retained"] });
});

test("the child operation set is exact, unique and immutable", () => {
  const expected = [
    "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "PROBE_APK_VERSION",
    "PROBE_HELP_ROOT", "PROBE_HELP_ADD", "PROBE_HELP_VERIFY", "PROBE_HELP_QUERY",
    "PROBE_HELP_MANIFEST", "PROBE_HELP_FETCH", "PROBE_HELP_VERSION", "MATERIAL_KEYS",
    "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST", "MATERIAL_QUERY",
    "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST", "MATERIAL_SIMULATE_SECOND",
    "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE", "CLEANUP_CONTAINER_DISCOVER",
    "CLEANUP_CONTAINER_LIST", "CLEANUP_CONTAINER_REMOVE", "CLEANUP_IMAGE_LIST", "CLEANUP_IMAGE_REMOVE",
  ];
  assert.deepEqual([...childOperations], expected);
  assert.equal(new Set(childOperations).size, 27);
  assert.ok(childOperations.every((operation) => /^[A-Z][A-Z0-9_]*$/u.test(operation)));
  assert.equal(Object.isFrozen(childOperations), true);
});

test("public failure projection accepts only a complete closed diagnostic", () => {
  const error = childFailure("MATERIAL_QUERY", {
    status: 23, stdout: Buffer.from("PRIVATE_STDOUT_SENTINEL"), stderr: Buffer.from("PRIVATE_STDERR_SENTINEL"),
  });
  error.path = "C:/PRIVATE/material.apk";
  error.stack = "PRIVATE_STACK";
  const projected = JSON.parse(publicFailure(error));
  assert.deepEqual(projected, {
    actor: "TASK005_GIT_MATERIALS_V1",
    authority: "DIAGNOSTIC_ONLY",
    childDiagnostic: expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", {
      status: 23, stdoutBytes: 23, stderrBytes: 23,
    }),
    code: "task005_git_materials_child_failed",
    installationAuthorization: false,
    state: "FAILED",
  });
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|material\.apk/u);

  for (const diagnostic of [
    { ...error.childDiagnostic, extra: "PRIVATE" },
    Object.create({ operation: "MATERIAL_QUERY" }, Object.fromEntries(Object.entries(error.childDiagnostic)
      .filter(([key]) => key !== "operation").map(([key, value]) => [key, { value, enumerable: true }]))),
    Object.assign(Object.create({ inherited: "PRIVATE" }), error.childDiagnostic),
    { ...error.childDiagnostic, status: 22.5 },
    { ...error.childDiagnostic, reason: "TIMEOUT" },
  ]) {
    const safe = JSON.parse(publicFailure({ code: error.code, childDiagnostic: diagnostic }));
    assert.equal(safe.code, error.code);
    assert.equal(Object.hasOwn(safe, "childDiagnostic"), false);
    assert.doesNotMatch(JSON.stringify(safe), /PRIVATE/u);
  }
});

test("public failure projection never invokes code or diagnostic accessors", () => {
  let calls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "code", { get() { calls += 1; throw new Error("PRIVATE_CODE"); } });
  Object.defineProperty(hostile, "childDiagnostic", { get() { calls += 1; throw new Error("PRIVATE_DIAGNOSTIC"); } });
  assert.equal(JSON.parse(publicFailure(hostile)).code, "task005_git_materials_failed");
  assert.equal(calls, 0);
});

test("workflow bytes equal the frozen V2 workflow after approved namespace normalization", async () => {
  const bytes = await readFile(workflowPath);
  assert.equal(bytes.length, 3934);
  assert.equal(hash(bytes), "5da28a5278e36f5cee00a3d36706b79a35ef54cf397e68b954ae41806db38230");
});

test("material child commands remain byte-equivalent to the frozen V2 transcript", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
    });
    const transcript = observed.records.map((record) => normalizedCommandRecord(record, context));
    assert.equal(transcript.length, 11);
    assert.deepEqual(transcript.map((record) => record.executable), Array(11).fill("docker"));
    assert.equal(hash(Buffer.from(canonicalJson(transcript))),
      "0b7a76654e5ecb38a2369b0d2140ec5504db18ad664af41fa9c62f1f42930dde");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("every probe operation is wired to the real failing child call", { skip: process.platform !== "linux" }, async (t) => {
  const operations = [
    "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "PROBE_APK_VERSION",
    "PROBE_HELP_ROOT", "PROBE_HELP_ADD", "PROBE_HELP_VERIFY", "PROBE_HELP_QUERY",
    "PROBE_HELP_MANIFEST", "PROBE_HELP_FETCH", "PROBE_HELP_VERSION",
  ];
  for (const [failAt, operation] of operations.entries()) {
    await t.test(operation, async () => {
      const fixture = await fixtureContext();
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = probeCommandFixture(context, failAt);
        const error = await captureRejected(() => executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          materialize: () => assert.fail("probe failure must stop before material collection"),
        }));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
          status: 23, stderrBytes: 13,
        }));
        assert.equal(observed.records.length, failAt + 1);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("every material operation is wired to the real failing carrier call", { skip: process.platform !== "linux" }, async (t) => {
  const operations = [
    "MATERIAL_KEYS", "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST",
    "MATERIAL_QUERY", "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST",
    "MATERIAL_SIMULATE_SECOND", "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE",
  ];
  for (const [failAt, operation] of operations.entries()) {
    await t.test(operation, async () => {
      const fixture = await fixtureContext();
      const observed = observationFixture({ failAt, secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
      try {
        const context = await requireContext(fixture.env, "linux");
        const error = await captureRejected(() => executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          probe: async () => ({
            version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID,
          }),
          fetchImpl: observed.fetchImpl,
          now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
        }));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
          status: 23, stdoutBytes: 23, stderrBytes: 23,
        }));
        assert.equal(observed.records.length, failAt + 1);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("every cleanup operation is wired to the real failing child call", { skip: process.platform !== "linux" }, async (t) => {
  const cases = [
    [0, "CLEANUP_CONTAINER_DISCOVER"],
    [1, "CLEANUP_CONTAINER_LIST"],
    [2, "CLEANUP_CONTAINER_REMOVE"],
    [4, "CLEANUP_IMAGE_LIST"],
    [5, "CLEANUP_IMAGE_REMOVE"],
  ];
  for (const [failAt, operation] of cases) {
    await t.test(operation, async () => {
      const fixture = await fixtureContext();
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = await cleanupFaultFixture(context, failAt);
        const error = await captureRejected(() => cleanupOwnedState(context, observed.command));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
          status: 23, stderrBytes: 15,
        }));
        assert.equal(observed.records.length, failAt + 1);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("failure marker metadata is rejected before any unsafe read", async (t) => {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  const valid = Buffer.from('{"code":"task005_git_materials_child_failed"}\n');
  const base = { isFile: () => true, isSymbolicLink: () => false, nlink: 1, mode: 0o100600, size: valid.length };
  const cases = [
    ["directory", { isFile: () => false }],
    ["symlink", { isSymbolicLink: () => true }],
    ["hardlink", { nlink: 2 }],
    ["unsafe mode", { mode: 0o100644 }],
    ["too small", { size: 2 }],
    ["oversize", { size: 1025 }],
    ["noninteger size", { size: 4.5 }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      let reads = 0;
      const info = { ...base, ...override };
      await assert.rejects(readFailureMarker(context, {
        lstat: async () => info,
        readFile: async () => { reads += 1; throw new Error("PRIVATE_READ"); },
      }), { code: "task005_git_materials_cleanup_failed" });
      assert.equal(reads, 0);
    });
  }
});

test("failure marker accepts only canonical bounded UTF-8 records", async (t) => {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  const validDiagnostic = expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23, stderrBytes: 4 });
  const validRecords = [
    { code: "task005_git_materials_child_timeout" },
    { code: "task005_git_materials_child_failed" },
    { code: "task005_git_materials_download_failed" },
    { code: "task005_git_materials_child_failed", childDiagnostic: validDiagnostic },
  ];
  for (const record of validRecords) {
    await t.test(`accepts ${record.code}${record.childDiagnostic ? " with diagnostic" : " without diagnostic"}`, async () => {
      const bytes = Buffer.from(canonicalJson(record));
      let reads = 0;
      const observed = await readFailureMarker(context, {
        lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
          nlink: 1, mode: 0o100600, size: bytes.length }),
        readFile: async () => { reads += 1; return bytes; },
      });
      assert.deepEqual(observed, record);
      assert.equal(reads, 1);
    });
  }

  const invalid = [
    ["missing newline", Buffer.from('{"code":"task005_git_materials_child_failed"}')],
    ["leading whitespace", Buffer.from(' {"code":"task005_git_materials_child_failed"}\n')],
    ["duplicate key", Buffer.from('{"code":"task005_git_materials_child_failed","code":"task005_git_materials_child_failed"}\n')],
    ["malformed JSON", Buffer.from('{"code":\n')],
    ["invalid UTF-8", Buffer.from([0xff, 0xfe, 0xfd])],
    ["array root", Buffer.from('["task005_git_materials_child_failed"]\n')],
    ["null root", Buffer.from('null\n')],
    ["unexpected field", Buffer.from('{"code":"task005_git_materials_child_failed","private":"secret"}\n')],
    ["generic code with diagnostic", Buffer.from(canonicalJson({
      code: "task005_git_materials_download_failed", childDiagnostic: validDiagnostic,
    }))],
    ["timeout code with exit diagnostic", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_timeout", childDiagnostic: validDiagnostic,
    }))],
    ["child code with timeout diagnostic", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: expectedDiagnostic("MATERIAL_QUERY", "TIMEOUT"),
    }))],
    ["unknown operation", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, operation: "MATERIAL_PRIVATE" },
    }))],
    ["unknown reason", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, reason: "PRIVATE_REASON" },
    }))],
    ["unknown signal", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, reason: "SIGNAL", status: null, signal: "SIGPRIVATE" },
    }))],
    ["out of range exit status", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, status: 256 },
    }))],
    ["out of range byte count", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, stderrBytes: limits.childOutputBytes + 2 },
    }))],
    ["missing diagnostic key", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: Object.fromEntries(Object.entries(validDiagnostic).filter(([key]) => key !== "signal")),
    }))],
    ["fractional byte count", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, stderrBytes: 1.5 },
    }))],
    ["extra diagnostic field", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, private: "secret" },
    }))],
  ];
  for (const [name, bytes] of invalid) {
    await t.test(`rejects ${name}`, async () => {
      await assert.rejects(readFailureMarker(context, {
        lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
          nlink: 1, mode: 0o100600, size: bytes.length }),
        readFile: async () => bytes,
      }), { code: "task005_git_materials_cleanup_failed" });
    });
  }
});

test("failure marker rejects a post-lstat size change", async () => {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  const bytes = Buffer.from('{"code":"task005_git_materials_child_failed"}\n');
  await assert.rejects(readFailureMarker(context, {
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
      nlink: 1, mode: 0o100600, size: bytes.length + 1 }),
    readFile: async () => bytes,
  }), { code: "task005_git_materials_cleanup_failed" });
});

test("the first child diagnostic survives cleanup failure and deferred publication", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const first = childFailure("MATERIAL_QUERY");
    const cleanup = childFailure("CLEANUP_CONTAINER_REMOVE");
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw first; },
      cleanup: async () => { throw cleanup; },
    }));
    assert.equal(observed, first);
    assert.deepEqual(observed.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23 }));
    const marker = await readFailureMarker(context);
    assert.deepEqual(marker, { code: first.code, childDiagnostic: first.childDiagnostic });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });

    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const evidence = await readPublicEvidence(context);
    assert.deepEqual(evidence.receipt, {
      actor: "TASK005_GIT_MATERIALS_V1",
      authority: "DIAGNOSTIC_ONLY",
      childDiagnostic: first.childDiagnostic,
      cleanup: { containersAbsent: true, privateFilesAbsent: true },
      code: "task005_git_materials_child_failed",
      installationAuthorization: false,
      state: "BLOCKED",
    });
    assert.deepEqual(evidence.manifest, {
      actor: "TASK005_GIT_MATERIALS_MANIFEST_V1",
      authority: "DIAGNOSTIC_ONLY",
      files: [],
      installationAuthorization: false,
      state: "EMPTY_BLOCKED",
    });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("a cleanup-first child failure retains its own closed diagnostic", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const cleanup = childFailure("CLEANUP_CONTAINER_REMOVE");
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.",
        help: helpWithoutManifestCapability(), imageId: FIXTURE_IMAGE_ID }),
      cleanup: async () => { throw cleanup; },
    }));
    assert.equal(observed, cleanup);
    assert.deepEqual(await readFailureMarker(context), { code: cleanup.code, childDiagnostic: cleanup.childDiagnostic });
    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    const { receipt } = await readPublicEvidence(context);
    assert.deepEqual(receipt.childDiagnostic, cleanup.childDiagnostic);
    assert.equal(receipt.code, cleanup.code);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("immediate cleanup publishes the actor child diagnostic exactly once", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const first = childFailure("MATERIAL_QUERY");
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw first; },
      cleanup: cleanupPrivate,
    }));
    assert.equal(observed, first);
    const before = await readPublicEvidence(context);
    assert.deepEqual(before.receipt.childDiagnostic, first.childDiagnostic);
    await run(["cleanup"], fixture.env, { platform: "linux",
      command: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }), log: () => {} });
    assert.deepEqual(await readPublicEvidence(context), before);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("a pre-child internal timeout publishes no invented diagnostic", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const deadline = Object.assign(new Error("deadline"), { code: "task005_git_materials_child_timeout" });
    let childCalls = 0;
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: () => { childCalls += 1; throw new Error("must not run"); },
      probe: async () => { throw deadline; },
      cleanup: cleanupPrivate,
    }));
    assert.equal(observed, deadline);
    assert.equal(childCalls, 0);
    assert.equal(Object.hasOwn(observed, "childDiagnostic"), false);
    const { receipt } = await readPublicEvidence(context);
    assert.equal(receipt.code, "task005_git_materials_child_timeout");
    assert.equal(Object.hasOwn(receipt, "childDiagnostic"), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("an invalid deferred marker cannot suppress cleanup or publish forged evidence", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await writeFile(path.join(context.privateRoot, "failure-code"),
      '{"code":"task005_git_materials_child_failed","private":"forged"}\n', { mode: 0o600 });
    let cleanupCalls = 0;
    await assert.rejects(run(["cleanup"], fixture.env, {
      platform: "linux",
      cleanup: async () => { cleanupCalls += 1; await cleanupPrivate(context); },
      log: () => {},
    }), { code: "task005_git_materials_cleanup_failed" });
    assert.equal(cleanupCalls, 1);
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});
