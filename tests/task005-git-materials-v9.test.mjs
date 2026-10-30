import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm,
  writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  TEST_ONLY_CHILD_OPERATIONS as childOperations,
  TEST_ONLY_LIMITS as limits,
  TEST_ONLY_assessHelp as assessHelp,
  TEST_ONLY_canonicalJson as canonicalJson,
  TEST_ONLY_cleanupOwnedState as cleanupOwnedState,
  TEST_ONLY_downloadBytes as downloadBytes,
  TEST_ONLY_executeActor as rawExecuteActor,
  TEST_ONLY_materializeObservation as rawMaterializeObservation,
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
  TEST_ONLY_writeFailureMarker as writeFailureMarker,
} from "../scripts/diagnostics/task005-git-materials-v9.mjs";

const workflowPath = new URL("../.github/workflows/task005-git-materials-v9.yml", import.meta.url);
const actorPath = new URL("../scripts/diagnostics/task005-git-materials-v9.mjs", import.meta.url);
const BASE = "4517b120f1e126dff15e710a34d950694e20eae5";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MERGE = "89abcdef0123456789abcdef0123456789abcdef";
const FIXTURE_UID = 20_001;
const FIXTURE_GID = 20_002;
const PRIVATE_DIRECTORY_MODE = 0o040700;

function ownerIdentityFixture({
  uid = FIXTURE_UID,
  gid = FIXTURE_GID,
  statUid = uid,
  statGid = gid,
  mode = PRIVATE_DIRECTORY_MODE,
  getuid,
  getgid,
  stat,
  lstat: lstatOverride,
} = {}) {
  const calls = { getuid: 0, getgid: 0, lstat: 0, targets: [] };
  const ownerStat = stat ?? { uid: statUid, gid: statGid, mode };
  const identityIo = {
    getuid: getuid ?? (() => { calls.getuid += 1; return uid; }),
    getgid: getgid ?? (() => { calls.getgid += 1; return gid; }),
    lstat: lstatOverride ?? (async (target) => {
      calls.lstat += 1;
      calls.targets.push(target);
      return ownerStat;
    }),
  };
  return { calls, identityIo, ownerStat, pair: `${uid}:${gid}` };
}

function defaultFixtureIdentityIo() {
  return ownerIdentityFixture().identityIo;
}

function materializeObservation(options) {
  return rawMaterializeObservation({ identityIo: defaultFixtureIdentityIo(), ...options });
}

function executeActor(context, options = {}) {
  return rawExecuteActor(context, { identityIo: defaultFixtureIdentityIo(), ...options });
}

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
      head: { ref: "codex/task-0005-git-materials-v9", sha: HEAD,
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
    GITHUB_HEAD_REF: "codex/task-0005-git-materials-v9",
    GITHUB_HEAD_SHA: HEAD,
    GITHUB_SHA: MERGE,
    GITHUB_RUN_NUMBER: "1",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "40999999999",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/task005-git-materials-v9.yml@refs/pull/205/merge",
    RUNNER_TEMP: runnerTemp,
    PATH: process.env.PATH ?? "",
  };
  return { runnerTemp, eventPath, env };
}

function completeHelp() {
  return {
    root: Buffer.from("apk-tools command summary"),
    add: Buffer.from("add --simulate --keys-dir --repositories-file --root --root-tmpfs[=AUTO] --network[=BOOL]"),
    fetch: Buffer.from("fetch --output --stdout"),
    verify: Buffer.from("verify"),
    query: Buffer.from("query --format --fields --from --recursive"),
    manifest: Buffer.from("manifest"),
    version: Buffer.from("version --test"),
  };
}

const GLOBAL_HELP_TOKENS = Object.freeze(["--keys-dir", "--repositories-file", "--root"]);
const NETWORK_BOOL_TOKEN = "--network[=BOOL]";
const NETWORK_ALIAS_TOKEN = "--no-network";
const ASCII_HELP_DELIMITERS = Object.freeze([
  ["space", " "], ["tab", "\t"], ["LF", "\n"], ["VT", "\v"], ["FF", "\f"], ["CR", "\r"],
]);

function helpWithAdd(add, root = completeHelp().root) {
  return { ...completeHelp(), root: Buffer.isBuffer(root) ? root : Buffer.from(root),
    add: Buffer.isBuffer(add) ? add : Buffer.from(add) };
}

function canonicalAddTokens(network = NETWORK_BOOL_TOKEN) {
  return ["add", "--simulate", ...GLOBAL_HELP_TOKENS, "--root-tmpfs[=AUTO]", network];
}

function addTokensWithoutBareRoot(network = NETWORK_BOOL_TOKEN) {
  return canonicalAddTokens(network).filter((token) => token !== "--root");
}

function sourceDerivedHelp() {
  const tokens = canonicalAddTokens();
  const rootAt = tokens.indexOf("--root");
  assert.notEqual(rootAt, -1);
  tokens.splice(rootAt, 1, "--root,", "-p", "ROOT");
  return helpWithAdd(tokens.join(" "));
}

function helpWithRootPresentation(tokens, position = "end") {
  const base = addTokensWithoutBareRoot();
  return helpWithAdd((position === "start" ? [...tokens, ...base] : [...base, ...tokens]).join(" "));
}

function helpWithoutExactAddToken(token, decoys = []) {
  const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
  const tokens = canonicalAddTokens(network).filter((value) => value !== token);
  return helpWithAdd([...tokens, ...decoys].join(" "), `${token} ${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`);
}

function helpWithoutManifestCapability() {
  return { ...completeHelp(), manifest: Buffer.from("unsupported operation") };
}

function enoughCapacity() {
  return { bavail: BigInt(30 * 1024 ** 2), bsize: 1024n };
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const INSTALLED_PATH = "/lib/apk/db/installed";
const CHECKSUM_ENTRYPOINT = "/bin/busybox";
const CHECKSUM_ARGS = Object.freeze(["sha256sum", INSTALLED_PATH]);
const LEGACY_CHECKSUM_ENTRYPOINT = "/bin/sha256sum";
const V6_FETCH_SCRIPT = "set -eu; set -o pipefail; /sbin/apk --keys-dir /etc/apk/keys --repositories-file /materials/repositories \"$1\" fetch --stdout \"$2\" | /bin/sha256sum";
const V7_FETCH_SCRIPT = V6_FETCH_SCRIPT.replace("| /bin/sha256sum", "| /bin/busybox sha256sum");
// The private native stderr was not retained. This models its measured byte count only.
const syntheticObservedStderr = () => Buffer.alloc(329, 0x78);
const INDEX_VERIFY_OPERATION = "MATERIAL_INDEX_VERIFY";
const INDEX_VERIFY_ENTRYPOINT = "/sbin/apk";
const INDEX_VERIFY_ARGS = Object.freeze([
  "--keys-dir", "/etc/apk/keys", "verify", "/materials/repo/APKINDEX.tar.gz",
]);
const INDEX_VERIFY_PREFIX = "/materials/repo/APKINDEX.tar.gz: ";
const INDEX_VERIFY_UNKNOWN = "APK_INDEX_VERIFY_UNKNOWN";
const OMIT_STREAM = Symbol("OMIT_STREAM");
const INDEX_VERIFY_KNOWN = Object.freeze([
  Object.freeze(["UNTRUSTED signature", "APKE_SIGNATURE_UNTRUSTED"]),
  Object.freeze(["BAD signature", "APKE_SIGNATURE_INVALID"]),
  Object.freeze(["crypto error", "APKE_CRYPTO_ERROR"]),
  Object.freeze(["cryptographic algorithm not supported", "APKE_CRYPTO_NOT_SUPPORTED"]),
  Object.freeze(["cryptographic key format not recognized", "APKE_CRYPTO_KEY_FORMAT"]),
  Object.freeze(["unexpected end of file", "APKE_EOF"]),
  Object.freeze(["file format is invalid or inconsistent", "APKE_FORMAT_INVALID"]),
  Object.freeze(["file format is obsolete (e.g. missing embedded checksum)", "APKE_FORMAT_OBSOLETE"]),
  Object.freeze(["file format not supported (in this applet)", "APKE_FORMAT_NOT_SUPPORTED"]),
  Object.freeze(["v2 index format error", "APKE_V2NDX_FORMAT"]),
  Object.freeze(["v2 package format error", "APKE_V2PKG_FORMAT"]),
  Object.freeze(["v2 package integrity error", "APKE_V2PKG_INTEGRITY"]),
  Object.freeze(["file integrity error", "APKE_FILE_INTEGRITY"]),
  Object.freeze(["Permission denied", "EACCES"]),
]);

function indexVerifyLine(literal) {
  return Buffer.from(`${INDEX_VERIFY_PREFIX}${literal}\n`);
}

function projectedFailure(error) {
  return JSON.parse(publicFailure(error));
}

function indexVerifierFailure(stdout, stderr = Buffer.alloc(0), overrides = {}) {
  const result = { status: 1, ...overrides };
  if (stdout !== OMIT_STREAM) result.stdout = stdout;
  if (stderr !== OMIT_STREAM) result.stderr = stderr;
  return captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
    INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
}

function indexDiagnostic(stdoutBytes, stderrBytes = 0, overrides = {}) {
  return expectedDiagnostic(INDEX_VERIFY_OPERATION, "EXIT_STATUS", {
    status: 1, stdoutBytes, stderrBytes, ...overrides,
  });
}

async function readMarkerBytes(bytes) {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  return readFailureMarker(context, {
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
      nlink: 1, mode: 0o100600, size: bytes.length }),
    readFile: async () => bytes,
  });
}

function response(bytes, headers = {}) {
  return new globalThis.Response(bytes, { status: 200, headers: { "content-length": String(bytes.length), ...headers } });
}

function observationFixture({
  repositoryHash,
  secfixes = { "0": ["CVE-2021-29468"] },
  failAt = -1,
  failResult,
  installedBeforeHash = "b".repeat(64),
  installedAfterHash = installedBeforeHash,
  installedOutput,
  bindingOutput,
} = {}) {
  const index = Buffer.from("signed-index-fixture");
  const apk = Buffer.from("signed-git-apk-fixture");
  const secdb = Buffer.from(JSON.stringify({
    distroversion: "v3.24",
    reponame: "main",
    packages: [{ pkg: { name: "git", secfixes } }],
  }));
  const calls = [];
  const fetchCalls = [];
  const records = [];
  let installedCalls = 0;
  const command = (executable, args, options) => {
    assert.equal(executable, "docker");
    calls.push([...args]);
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    if (records.length - 1 === failAt) {
      return failResult ?? { status: 23, stdout: Buffer.from("PRIVATE_STDOUT_SENTINEL"),
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
      assert.match(carrierArgs.at(1), /\| \/bin\/busybox sha256sum$/u);
      stdout = bindingOutput ?? `${repositoryHash ?? hash(apk)}  -\n`;
    } else if (entrypoint === "/bin/busybox") {
      assert.deepEqual(carrierArgs, ["sha256sum", "/lib/apk/db/installed"]);
      const digest = installedCalls++ === 0 ? installedBeforeHash : installedAfterHash;
      stdout = installedOutput ?? `${digest}  /lib/apk/db/installed\n`;
    } else if (entrypoint === "/bin/sha256sum") {
      return { status: 127, stdout: Buffer.alloc(0), stderr: syntheticObservedStderr() };
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
    fetchCalls.push(url);
    if (url.endsWith("APKINDEX.tar.gz")) return response(index);
    if (url.endsWith("git-2.54.0-r0.apk")) return response(apk);
    if (url.endsWith("main.json")) return response(secdb, {
      etag: '"secdb-fixture"', "last-modified": "Wed, 28 Oct 2026 20:00:00 GMT",
    });
    assert.fail(`unexpected injected URL: ${url}`);
  };
  return { apk, calls, command, fetchCalls, fetchImpl, records };
}

function recordedCarrierArgs(record) {
  const entrypointAt = record.args.indexOf("--entrypoint");
  assert.notEqual(entrypointAt, -1);
  return { entrypoint: record.args[entrypointAt + 1], args: record.args.slice(entrypointAt + 3) };
}

function recordedOwnerPair(record) {
  const userIndexes = record.args.flatMap((value, index) => value === "--user" ? [index] : []);
  assert.deepEqual(userIndexes, [6]);
  assert.deepEqual(record.args.slice(4, 10), ["--platform", "linux/amd64", "--user",
    record.args[7], "--network", "none"]);
  return record.args[7];
}

function reverseOwnerBindingToV8(records, expectedPair) {
  assert.equal(records.length, 11);
  const reversed = globalThis.structuredClone(records);
  const changed = [];
  for (const [index, record] of records.entries()) {
    assert.equal(recordedOwnerPair(record), expectedPair);
    const userAt = reversed[index].args.indexOf("--user");
    assert.equal(userAt, 6);
    reversed[index].args.splice(userAt, 2);
    if (!isDeepStrictEqual(record, reversed[index])) changed.push(index);
  }
  assert.deepEqual(changed, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  return reversed;
}

function recordedNetworkArguments(records) {
  assert.equal(records.length, 11);
  const firstSimulation = recordedCarrierArgs(records[3]);
  const query = recordedCarrierArgs(records[4]);
  const binding = recordedCarrierArgs(records[6]);
  const secondSimulation = recordedCarrierArgs(records[8]);
  assert.equal(firstSimulation.entrypoint, "/sbin/apk");
  assert.equal(query.entrypoint, "/sbin/apk");
  assert.equal(binding.entrypoint, "/bin/sh");
  assert.equal(secondSimulation.entrypoint, "/sbin/apk");
  const selectApkNetwork = ({ args }) => args.find((value) => value === "--network=no" || value === "--no-network");
  assert.equal(binding.args[2], "actor");
  return [selectApkNetwork(firstSimulation), selectApkNetwork(query), binding.args[3],
    selectApkNetwork(secondSimulation)];
}

async function materialNetworkArguments(help) {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help, imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    return recordedNetworkArguments(observed.records);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function assertMaterialNetworkRefusal(help) {
  const fixture = await fixtureContext();
  let childCalls = 0;
  let fetchCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    const before = { ...resources, containerNames: [...resources.containerNames] };
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help, imageId: FIXTURE_IMAGE_ID },
      command: () => { childCalls += 1; assert.fail("network refusal must precede child execution"); },
      fetchImpl: () => { fetchCalls += 1; assert.fail("network refusal must precede fetch"); },
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
    }));
    assert.equal(error.code, "task005_git_materials_probe_not_run");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    assert.equal(childCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(resources, before);
    assert.deepEqual(await readdir(context.privateRoot), []);
    await assert.rejects(lstat(path.join(context.privateRoot, "repo")), { code: "ENOENT" });
    await assert.rejects(lstat(path.join(context.privateRoot, "repositories")), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function assertIdentityRefusal(identityIo, verify = () => {}) {
  const fixture = await fixtureContext();
  let childCalls = 0;
  let fetchCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    const before = globalThis.structuredClone(resources);
    const error = await captureRejected(() => rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: () => { childCalls += 1; assert.fail("identity refusal must precede child execution"); },
      fetchImpl: () => { fetchCalls += 1; assert.fail("identity refusal must precede fetch"); },
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
      identityIo,
    }));
    assert.equal(error.code, "task005_git_materials_private_root_invalid");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
    assert.equal(childCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(resources, before);
    assert.deepEqual(await readdir(context.privateRoot), []);
    await assert.rejects(lstat(path.join(context.privateRoot, "repo")), { code: "ENOENT" });
    await assert.rejects(lstat(path.join(context.privateRoot, "repositories")), { code: "ENOENT" });
    verify(error, context);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function withBoundMaterialOwner(callback, {
  uid = FIXTURE_UID, gid = FIXTURE_GID, identityIo,
} = {}) {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  const owner = identityIo === undefined ? ownerIdentityFixture({ uid, gid })
    : { calls: undefined, identityIo, pair: `${uid}:${gid}` };
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    await rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
      identityIo: owner.identityIo,
    });
    await callback({ context, fixture, observed, owner, resources });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
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
      .replaceAll("git-materials-v9", "git-materials-v6")
      .replaceAll("git-materials-v6", "git-materials-v5")
      .replaceAll("git-materials-v5", "git-materials-v4")
      .replaceAll("git-materials-v4", "git-materials-v3")
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

function reverseChecksumInvocationsToV6(records) {
  assert.equal(records.length, 11);
  const reversed = globalThis.structuredClone(records);
  const directIndexes = [1, 9];
  for (const index of directIndexes) {
    const current = recordedCarrierArgs(records[index]);
    assert.equal(current.entrypoint, CHECKSUM_ENTRYPOINT);
    assert.deepEqual(current.args, CHECKSUM_ARGS);
    const entrypointAt = reversed[index].args.indexOf("--entrypoint");
    reversed[index].args[entrypointAt + 1] = LEGACY_CHECKSUM_ENTRYPOINT;
    reversed[index].args.splice(entrypointAt + 3, 1);
    assert.deepEqual(recordedCarrierArgs(reversed[index]), {
      entrypoint: LEGACY_CHECKSUM_ENTRYPOINT, args: [INSTALLED_PATH],
    });
  }
  const binding = recordedCarrierArgs(records[6]);
  assert.equal(binding.entrypoint, "/bin/sh");
  assert.deepEqual(binding.args.slice(0, 3), ["-ceu", V7_FETCH_SCRIPT, "actor"]);
  const bindingEntrypointAt = reversed[6].args.indexOf("--entrypoint");
  assert.equal(reversed[6].args[bindingEntrypointAt + 4], V7_FETCH_SCRIPT);
  reversed[6].args[bindingEntrypointAt + 4] = V6_FETCH_SCRIPT;
  assert.equal(recordedCarrierArgs(reversed[6]).args[1], V6_FETCH_SCRIPT);
  const changed = records.map((record, index) => ({ record, reversed: reversed[index], index }))
    .filter(({ record, reversed: value }) => !isDeepStrictEqual(record, value))
    .map(({ index }) => index);
  assert.deepEqual(changed, [1, 6, 9]);
  return reversed;
}

const CARRIER_DIGEST = "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747";
const CARRIER_REFERENCE = `golang@${CARRIER_DIGEST}`;
const FIXTURE_IMAGE_ID = `sha256:${"e".repeat(64)}`;
const HELP_CASES = Object.freeze([
  Object.freeze({ operation: "PROBE_HELP_ROOT", args: Object.freeze(["--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_ADD", args: Object.freeze(["add", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_VERIFY", args: Object.freeze(["verify", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_QUERY", args: Object.freeze(["query", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_MANIFEST", args: Object.freeze(["manifest", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_FETCH", args: Object.freeze(["fetch", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_VERSION", args: Object.freeze(["version", "--help"]) }),
]);

const MATERIAL_OPERATIONS = Object.freeze([
  "MATERIAL_KEYS", "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST",
  "MATERIAL_QUERY", "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST",
  "MATERIAL_SIMULATE_SECOND", "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE",
]);

const DIRECT_OPERATIONS = Object.freeze([
  "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "CLEANUP_CONTAINER_DISCOVER",
  "CLEANUP_CONTAINER_LIST", "CLEANUP_CONTAINER_REMOVE", "CLEANUP_IMAGE_LIST", "CLEANUP_IMAGE_REMOVE",
]);

function freshCarrierResources() {
  return { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 };
}

function carrierContext() {
  return { runId: "40999999999", privateRoot: "C:/private" };
}

function probeCommandFixture(context, failAt = -1, help = completeHelp()) {
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
        "--label", "com.auto-world.task005.git-materials-v9=true",
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
        stdout = help[key].toString("utf8");
      } else assert.fail(`unexpected probe command ${args.join(" ")}`);
    }
    return { status: index >= 4 ? 1 : 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
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
        "label=com.auto-world.task005.git-materials-v9=true", "--filter",
        `label=com.auto-world.github-run-id=${context.runId}`, "--format", "{{.Names}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 1 || index === 3) {
      assert.deepEqual(args, ["container", "ls", "--all", "--format",
        "{{.Names}}|{{.Label \"com.auto-world.task005.git-materials-v9\"}}|{{.Label \"com.auto-world.github-run-id\"}}"]);
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

test("representative legacy checksum entrypoint retains the observed closed child diagnostic", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const legacy = globalThis.structuredClone(observed.records[1]);
    const entrypointAt = legacy.args.indexOf("--entrypoint");
    legacy.args[entrypointAt + 1] = LEGACY_CHECKSUM_ENTRYPOINT;
    legacy.args.splice(entrypointAt + 3, 1);
    const result = observed.command(legacy.executable, legacy.args, legacy.options);
    const error = captureThrown(() => validateCommandResult(result, [0], "MATERIAL_INSTALLED_BEFORE"));
    assert.equal(error.code, "task005_git_materials_child_failed");
    assert.deepEqual(error.childDiagnostic, expectedDiagnostic("MATERIAL_INSTALLED_BEFORE", "EXIT_STATUS", {
      status: 127, stdoutBytes: 0, stderrBytes: 329,
    }));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("representative checksum fixture rejects altered BusyBox invocation vectors", async (t) => {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const valid = observed.records[1];
    const cases = [
      ["different multiplexer path", (args, at) => { args[at + 1] = "/usr/bin/busybox"; }],
      ["missing applet", (args, at) => { args.splice(at + 3, 1); }],
      ["different installed path", (args, at) => { args[at + 4] = "/tmp/installed"; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, () => {
        const args = [...valid.args];
        const entrypointAt = args.indexOf("--entrypoint");
        mutate(args, entrypointAt);
        assert.throws(() => observed.command(valid.executable, args, valid.options), /unexpected injected command|deep-equal/u);
      });
    }
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("installed checksum parser rejects noncanonical native output", async (t) => {
  const cases = [
    ["single separator space", `${"b".repeat(64)} ${INSTALLED_PATH}\n`],
    ["uppercase digest", `${"B".repeat(64)}  ${INSTALLED_PATH}\n`],
    ["short digest", `${"b".repeat(63)}  ${INSTALLED_PATH}\n`],
    ["missing filename marker", `${"b".repeat(64)}\n`],
  ];
  for (const [name, installedOutput] of cases) {
    await t.test(name, async () => {
      const fixture = await fixtureContext();
      const observed = observationFixture({ installedOutput });
      try {
        const context = await requireContext(fixture.env, "linux");
        await mkdir(context.privateRoot, { mode: 0o700 });
        await assert.rejects(materializeObservation({
          availableBytes: 30 * 1024 ** 2,
          context,
          probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
            imageId: FIXTURE_IMAGE_ID },
          command: observed.command,
          fetchImpl: observed.fetchImpl,
          now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
          resources: freshCarrierResources(),
        }), { code: "task005_git_materials_material_invalid" });
        assert.equal(observed.records.length, 2);
        assert.equal(observed.fetchCalls.length, 0);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("stdin checksum parser rejects a missing dash marker", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ bindingOutput: `${hash(Buffer.from("signed-git-apk-fixture"))}  stdin\n` });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await assert.rejects(materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }), { code: "task005_git_materials_material_invalid" });
    assert.equal(observed.records.length, 7);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("successful checksum status with stderr remains a material refusal", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 1,
    failResult: { status: 0, stdout: Buffer.from(`${"b".repeat(64)}  ${INSTALLED_PATH}\n`),
      stderr: Buffer.from("PRIVATE_NATIVE_STDERR") } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    assert.equal(observed.fetchCalls.length, 0);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("installed-before native failure stops and publishes through the full actor lifecycle", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 1,
    failResult: { status: 127, stdout: Buffer.alloc(0), stderr: syntheticObservedStderr() } });
  let privateSnapshot;
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      cleanup: async () => {
        privateSnapshot = {
          repo: await readdir(path.join(context.privateRoot, "repo")),
          repositories: await readFile(path.join(context.privateRoot, "repositories"), "utf8"),
        };
        await cleanupPrivate(context);
      },
    }));
    assert.equal(error.code, "task005_git_materials_child_failed");
    assert.deepEqual(error.childDiagnostic, expectedDiagnostic("MATERIAL_INSTALLED_BEFORE", "EXIT_STATUS", {
      status: 127, stdoutBytes: 0, stderrBytes: 329,
    }));
    assert.equal(observed.records.length, 2);
    assert.deepEqual(recordedCarrierArgs(observed.records[1]), {
      entrypoint: CHECKSUM_ENTRYPOINT, args: CHECKSUM_ARGS,
    });
    assert.equal(observed.fetchCalls.length, 0);
    assert.deepEqual(privateSnapshot, {
      repo: [], repositories: "ndx file:///materials/repo/APKINDEX.tar.gz\n",
    });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const { receipt } = await readPublicEvidence(context);
    assert.equal(receipt.code, "task005_git_materials_child_failed");
    assert.deepEqual(receipt.childDiagnostic, error.childDiagnostic);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("installed database mismatch refuses after the second checksum and before SecDB acquisition", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ installedBeforeHash: "b".repeat(64), installedAfterHash: "c".repeat(64) });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await assert.rejects(materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }), { code: "task005_git_materials_solver_invalid" });
    assert.equal(observed.records.length, 10);
    assert.deepEqual(recordedCarrierArgs(observed.records[1]),
      { entrypoint: CHECKSUM_ENTRYPOINT, args: CHECKSUM_ARGS });
    assert.deepEqual(recordedCarrierArgs(observed.records[9]),
      { entrypoint: CHECKSUM_ENTRYPOINT, args: CHECKSUM_ARGS });
    assert.equal(observed.fetchCalls.length, 2);
    assert.equal(observed.fetchCalls.some((url) => url.endsWith("main.json")), false);
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
  assert.match(bytes, /github\.head_ref == 'codex\/task-0005-git-materials-v9'/u);
  assert.match(bytes, /github\.run_number == 1 && github\.run_attempt == 1/u);
  assert.match(bytes, /runs-on: ubuntu-24\.04\n {4}timeout-minutes: 45/u);
  assert.match(bytes, /Run the focused actor contract tests before acquisition\n {8}timeout-minutes: 2\n {8}run: node --test tests\/task005-git-materials-v9\.test\.mjs/u);
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
  assert.match(bytes, /\.github\/workflows\/task005-git-materials-v9\.yml\n {6}- scripts\/diagnostics\/task005-git-materials-v9\.mjs\n {6}- tests\/task005-git-materials-v9\.test\.mjs/u);
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
    assert.equal(options.headers["user-agent"], "auto-world-task005-git-materials-v9");
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

test("global capabilities are bound to exact add-help tokens", async (t) => {
  const cases = [
    ["--keys-dir", ["prefix--keys-dir", "--keys-dir-suffix"]],
    ["--repositories-file", ["prefix--repositories-file", "--repositories-file-suffix"]],
    ["--root", ["--root-tmpfs[=AUTO]", "prefix--root", "--root-suffix"]],
  ];
  for (const [token, decoys] of cases) {
    await t.test(token, () => {
      const help = helpWithoutExactAddToken(token, decoys);
      help.verify = Buffer.from(`verify ${token}`);
      assert.deepEqual(assessHelp(help), { complete: false, missing: [`add:${token}`] });
    });
  }
  await t.test("exact tokens coexist with official and hostile decoys", () => {
    const help = helpWithAdd([...canonicalAddTokens(), "prefix--keys-dir", "--repositories-file-suffix",
      "prefix--root", "--root-suffix"].join(" "));
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
});

test("documented root presentation satisfies the existing root capability", async (t) => {
  await t.test("source-derived fixture", () => {
    assert.deepEqual(assessHelp(sourceDerivedHelp()), { complete: true, missing: [] });
  });
  await t.test("triple at stream start", () => {
    assert.deepEqual(assessHelp(helpWithRootPresentation(["--root,", "-p", "ROOT"], "start")), {
      complete: true, missing: [],
    });
  });
  await t.test("triple at stream end", () => {
    assert.deepEqual(assessHelp(helpWithRootPresentation(["--root,", "-p", "ROOT"])), {
      complete: true, missing: [],
    });
  });
  for (const [name, delimiter] of ASCII_HELP_DELIMITERS) {
    await t.test(`${name} between triple members`, () => {
      const add = `${addTokensWithoutBareRoot().join(" ")} --root,${delimiter}-p${delimiter}ROOT`;
      assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: true, missing: [] });
    });
  }
  await t.test("repeated approved whitespace", () => {
    const add = `${addTokensWithoutBareRoot().join(" ")} --root,  \t-p\n\rROOT`;
    assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: true, missing: [] });
  });
  await t.test("mixed approved whitespace", () => {
    const add = `${addTokensWithoutBareRoot().join(" ")} --root,\t\n-p\v\f\rROOT`;
    assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: true, missing: [] });
  });
  await t.test("duplicates coexist with decoys", () => {
    const help = helpWithRootPresentation(["prefix--root,", "--root-tmpfs[=AUTO]", "--root,", "-p", "ROOT",
      "--root,suffix", "--root,", "-p", "ROOT", "--networking"]);
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
  await t.test("bare root remains independently valid beside a malformed triple", () => {
    const help = helpWithAdd([...canonicalAddTokens(), "--root,", "intervening", "-p", "ROOT"].join(" "));
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
});

test("documented root presentation requires the exact adjacent ordered triple", async (t) => {
  const cases = [
    ["missing comma token", ["-p", "ROOT"]],
    ["missing alias", ["--root,", "ROOT"]],
    ["missing placeholder", ["--root,", "-p"]],
    ["alias before comma token", ["-p", "--root,", "ROOT"]],
    ["placeholder before tuple", ["ROOT", "--root,", "-p"]],
    ["placeholder before alias", ["--root,", "ROOT", "-p"]],
    ["intervening before alias", ["--root,", "intervening", "-p", "ROOT"]],
    ["intervening before placeholder", ["--root,", "-p", "intervening", "ROOT"]],
    ["altered short alias", ["--root,", "-r", "ROOT"]],
    ["long alias substitute", ["--root,", "--root-alias", "ROOT"]],
    ["lowercase placeholder", ["--root,", "-p", "root"]],
    ["placeholder suffix", ["--root,", "-p", "ROOTS"]],
    ["comma token case", ["--Root,", "-p", "ROOT"]],
    ["alias case", ["--root,", "-P", "ROOT"]],
    ["placeholder case", ["--root,", "-p", "Root"]],
    ["extra comma", ["--root,,", "-p", "ROOT"]],
    ["comma token prefix", ["prefix--root,", "-p", "ROOT"]],
    ["comma token suffix", ["--root,suffix", "-p", "ROOT"]],
    ["alias punctuation", ["--root,", "-p,", "ROOT"]],
    ["placeholder punctuation", ["--root,", "-p", "ROOT,"]],
    ["comma token alone", ["--root,"]],
    ["alias and placeholder alone", ["-p", "ROOT"]],
    ["comma token and alias only", ["--root,", "-p"]],
    ["comma token and placeholder only", ["--root,", "ROOT"]],
  ];
  for (const [name, tokens] of cases) {
    await t.test(name, () => {
      assert.deepEqual(assessHelp(helpWithRootPresentation(tokens)), {
        complete: false, missing: ["add:--root"],
      });
    });
  }
  for (const [name, delimiter] of [["NBSP", "\u00a0"], ["EM SPACE", "\u2003"]]) {
    await t.test(`${name} between comma token and alias`, () => {
      const add = `${addTokensWithoutBareRoot().join(" ")} --root,${delimiter}-p ROOT`;
      assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: false, missing: ["add:--root"] });
    });
    await t.test(`${name} between alias and placeholder`, () => {
      const add = `${addTokensWithoutBareRoot().join(" ")} --root, -p${delimiter}ROOT`;
      assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: false, missing: ["add:--root"] });
    });
  }
  await t.test("tokens in other streams cannot complete the add tuple", () => {
    const help = helpWithRootPresentation([]);
    help.root = Buffer.from("--root,");
    help.verify = Buffer.from("verify -p ROOT");
    assert.deepEqual(assessHelp(help), { complete: false, missing: ["add:--root"] });
  });
});

test("exact add-help tokens accept only the six ASCII whitespace delimiters", async (t) => {
  const tokens = [...GLOBAL_HELP_TOKENS, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN];
  for (const token of tokens) {
    for (const [name, delimiter] of ASCII_HELP_DELIMITERS) {
      await t.test(`${token} with ${name}`, () => {
        const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
        const values = canonicalAddTokens(network);
        assert.ok(values.includes(token));
        assert.deepEqual(assessHelp(helpWithAdd(values.join(delimiter))), { complete: true, missing: [] });
      });
    }
  }
});

test("exact add-help tokens are accepted at stream edges", async (t) => {
  for (const token of [...GLOBAL_HELP_TOKENS, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN]) {
    const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
    const remainder = canonicalAddTokens(network).filter((value) => value !== token);
    await t.test(`${token} at start`, () => {
      assert.deepEqual(assessHelp(helpWithAdd([token, ...remainder].join(" "))), { complete: true, missing: [] });
    });
    await t.test(`${token} at end`, () => {
      assert.deepEqual(assessHelp(helpWithAdd([...remainder, token].join(" "))), { complete: true, missing: [] });
    });
  }
});

test("case punctuation and Unicode whitespace cannot manufacture exact add-help tokens", async (t) => {
  for (const token of [...GLOBAL_HELP_TOKENS, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN]) {
    const expected = token.startsWith("--network") || token === NETWORK_ALIAS_TOKEN
      ? "add:network-denial" : `add:${token}`;
    const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
    const base = canonicalAddTokens(network).filter((value) => value !== token);
    const variants = [
      ["case", token.toUpperCase()],
      ["punctuation", `${token},`],
      ["NBSP", `prefix\u00a0${token}\u00a0suffix`],
      ["EM SPACE", `prefix\u2003${token}\u2003suffix`],
    ];
    for (const [name, variant] of variants) {
      await t.test(`${token} ${name}`, () => {
        assert.deepEqual(assessHelp(helpWithAdd([...base, variant].join(" "))), {
          complete: false, missing: [expected],
        });
      });
    }
  }
});

test("add-help tokenization is closed for malformed and absent streams", async (t) => {
  await t.test("malformed UTF-8", () => {
    const help = completeHelp();
    help.add = Buffer.from([0xff]);
    assert.throws(() => assessHelp(help), { code: "task005_git_materials_probe_not_run" });
  });
  await t.test("absent add stream", () => {
    const help = completeHelp();
    delete help.add;
    assert.deepEqual(assessHelp(help), {
      complete: false,
      missing: ["add:--keys-dir", "add:--repositories-file", "add:--root", "add:--simulate",
        "add:network-denial"],
    });
  });
});

test("network capability accepts only exact add-help presentations", async (t) => {
  for (const token of [NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN]) {
    await t.test(token, () => {
      assert.deepEqual(assessHelp(helpWithAdd(canonicalAddTokens(token).join(" "))), {
        complete: true, missing: [],
      });
    });
  }
  const rejected = [
    ["missing", ""], ["MODE", "--network=MODE"], ["spaced MODE", "--network MODE"],
    ["bare", "--network"], ["affirmative", "--network=yes"], ["loose alias", "--offline"],
    ["networking", "--networking"], ["BOOL suffix", "--network[=BOOL]suffix"],
    ["alias prefix", "prefix--no-network"],
  ];
  for (const [name, presentation] of rejected) {
    await t.test(name, () => {
      const add = [...canonicalAddTokens().filter((value) => value !== NETWORK_BOOL_TOKEN), presentation]
        .filter(Boolean).join(" ");
      const help = helpWithAdd(add, `${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`);
      help.verify = Buffer.from(`verify ${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`);
      assert.deepEqual(assessHelp(help), { complete: false, missing: ["add:network-denial"] });
    });
  }
  await t.test("both exact forms duplicate and coexist with decoys", () => {
    const help = helpWithAdd([...canonicalAddTokens(), NETWORK_ALIAS_TOKEN, NETWORK_BOOL_TOKEN,
      NETWORK_ALIAS_TOKEN, "--networking", "--network[=BOOL]suffix", "prefix--no-network"].join(" "));
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
});

test("add simulate and existing applet capability requirements remain binding", async (t) => {
  const cases = [
    ["add", "--simulate", "add:--simulate"],
    ["verify", "verify", "verify:verify"],
    ["query", "--recursive", "query:--recursive"],
    ["manifest", "manifest", "manifest:manifest"],
    ["fetch", "--stdout", "fetch:--stdout"],
    ["version", "--test", "version:--test"],
  ];
  for (const [stream, token, expected] of cases) {
    await t.test(expected, () => {
      const help = completeHelp();
      help[stream] = Buffer.from(help[stream].toString("utf8").replace(token, "missing"));
      assert.deepEqual(assessHelp(help), { complete: false, missing: [expected] });
    });
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
  const source = await readFile(new URL("../scripts/diagnostics/task005-git-materials-v9.mjs", import.meta.url), "utf8");
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
  const publicRoot = path.join(fixture.runnerTemp, "task005-git-materials-v9-public");
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

test("the seven exact help tuples accept status one", async (t) => {
  for (const helpCase of HELP_CASES) {
    await t.test(helpCase.operation, () => {
      let calls = 0;
      const resources = freshCarrierResources();
      const result = runCarrier(carrierContext(), resources, () => {
        calls += 1;
        return { status: 1, stdout: Buffer.from("valid help"), stderr: Buffer.alloc(0) };
      }, helpCase.operation, "/sbin/apk", [...helpCase.args]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout.toString("utf8"), "valid help");
      assert.equal(calls, 1);
      assert.deepEqual(resources, {
        carrierMayBeOwned: false,
        containerNames: ["aw-task005-git-materials-40999999999-001"],
        nextOrdinal: 1,
      });
    });
  }
});

test("the seven exact help tuples reject every alternate exit status", async (t) => {
  for (const helpCase of HELP_CASES) {
    for (const status of [0, 2, 23, 125, 126, 127]) {
      await t.test(`${helpCase.operation} status ${status}`, () => {
        const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
          status, stdout: Buffer.from("valid help"), stderr: Buffer.alloc(0),
        }), helpCase.operation, "/sbin/apk", [...helpCase.args]));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(helpCase.operation,
          status === 0 ? "RESULT_INVALID" : "EXIT_STATUS", { status: status === 0 ? null : status,
            stdoutBytes: 10 }));
      });
    }
  }
});

test("help status one does not override child failure precedence", async (t) => {
  const cases = [
    ["spawn error", { status: 1, error: Object.assign(new Error("private"), { code: "EACCES" }),
      stdout: Buffer.from("help"), stderr: Buffer.alloc(0) }, "SPAWN_ERROR", { stdoutBytes: 4 }],
    ["signal", { status: 1, signal: "SIGKILL", stdout: Buffer.from("help"), stderr: Buffer.alloc(0) },
      "SIGNAL", { signal: "SIGKILL", stdoutBytes: 4 }],
    ["output cap", { status: 1, stdout: Buffer.alloc(limits.childOutputBytes + 1), stderr: Buffer.alloc(0) },
      "OUTPUT_CAP", { stdoutBytes: limits.childOutputBytes + 1 }],
  ];
  for (const [name, result, reason, diagnostic] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
        "PROBE_HELP_ROOT", "/sbin/apk", ["--help"]));
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, expectedDiagnostic("PROBE_HELP_ROOT", reason, diagnostic));
    });
  }
});

test("help stream shape is closed after status validation", async (t) => {
  const refused = [
    ["empty stdout", { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }],
    ["malformed UTF-8 stdout", { status: 1, stdout: Buffer.from([0xff]), stderr: Buffer.alloc(0) }],
    ["nonempty stderr", { status: 1, stdout: Buffer.from("help"), stderr: Buffer.from("private") }],
    ["non-Buffer stdout", { status: 1, stdout: "help", stderr: Buffer.alloc(0) }],
    ["non-Buffer stderr", { status: 1, stdout: Buffer.from("help"), stderr: "PRIVATE_STDERR" }],
  ];
  for (const [name, result] of refused) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
        "PROBE_HELP_ROOT", "/sbin/apk", ["--help"]));
      assert.equal(error.code, "task005_git_materials_probe_not_run");
      assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    });
  }
  await t.test("valid whitespace remains a stream-shape success", () => {
    const result = runCarrier(carrierContext(), freshCarrierResources(), () => ({
      status: 1, stdout: Buffer.from(" "), stderr: Buffer.alloc(0),
    }), "PROBE_HELP_ROOT", "/sbin/apk", ["--help"]);
    assert.equal(result.stdout.toString("utf8"), " ");
  });
});

test("wrong help tuples refuse before command or resource mutation", async (t) => {
  for (const helpCase of HELP_CASES) {
    const sparseArgs = new Array(helpCase.args.length);
    for (let index = 1; index < helpCase.args.length; index += 1) sparseArgs[index] = helpCase.args[index];
    const mutations = [
      ["entrypoint", "/bin/sh", [...helpCase.args], []],
      ["args", "/sbin/apk", [...helpCase.args, "--private"], []],
      ["sparse args", "/sbin/apk", sparseArgs, []],
      ["mounts", "/sbin/apk", [...helpCase.args], [{ source: "C:/private", target: "/materials" }]],
    ];
    for (const [name, entrypoint, args, mounts] of mutations) {
      await t.test(`${helpCase.operation} ${name}`, () => {
        let calls = 0;
        const command = () => { calls += 1; return { status: 1, stdout: Buffer.from("help"),
          stderr: Buffer.alloc(0) }; };
        const resources = { carrierMayBeOwned: false, containerNames: ["retained"], nextOrdinal: 4 };
        const before = { ...resources, containerNames: [...resources.containerNames] };
        const error = captureThrown(() => runCarrier(carrierContext(), resources, command, helpCase.operation,
          entrypoint, args, mounts));
        assert.equal(error.code, "task005_git_materials_probe_not_run");
        assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
        assert.equal(calls, 0);
        assert.deepEqual(resources, before);
      });
    }
  }
});

test("status one remains rejected by every non-help carrier operation", async (t) => {
  for (const operation of ["PROBE_APK_VERSION", ...MATERIAL_OPERATIONS]) {
    await t.test(operation, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
        status: 1, stdout: Buffer.from("output"), stderr: Buffer.alloc(0),
      }), operation, "/sbin/apk", ["--version"]));
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
        status: 1, stdoutBytes: 6,
      }));
    });
  }
});

test("status one remains rejected by every direct child operation", async (t) => {
  for (const operation of DIRECT_OPERATIONS) {
    await t.test(operation, () => {
      const error = captureThrown(() => runCommand(operation, () => ({
        status: 1, stdout: Buffer.from("output"), stderr: Buffer.alloc(0),
      }), "docker", ["version"], { cwd: "C:/private", env: {}, timeoutMs: 1 }));
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
        status: 1, stdoutBytes: 6,
      }));
    });
  }
});

test("status zero remains accepted by every non-help child operation", async (t) => {
  for (const operation of ["PROBE_APK_VERSION", ...MATERIAL_OPERATIONS, ...DIRECT_OPERATIONS]) {
    await t.test(operation, () => {
      const command = () => ({ status: 0, stdout: Buffer.from("output"), stderr: Buffer.alloc(0) });
      const result = DIRECT_OPERATIONS.includes(operation)
        ? runCommand(operation, command, "docker", ["version"], { cwd: "C:/private", env: {}, timeoutMs: 1 })
        : runCarrier(carrierContext(), freshCarrierResources(), command, operation, "/sbin/apk", ["--version"]);
      assert.equal(result.status, 0);
    });
  }
});

test("material commands use only the network denial selected from exact add-help tokens", async (t) => {
  const cases = [
    ["BOOL", helpWithAdd(canonicalAddTokens(NETWORK_BOOL_TOKEN).join(" ")), "--network=no"],
    ["alias", helpWithAdd(canonicalAddTokens(NETWORK_ALIAS_TOKEN).join(" ")), "--no-network"],
    ["add BOOL overrides root alias", helpWithAdd(canonicalAddTokens(NETWORK_BOOL_TOKEN).join(" "),
      NETWORK_ALIAS_TOKEN), "--network=no"],
    ["add alias overrides root BOOL", helpWithAdd(canonicalAddTokens(NETWORK_ALIAS_TOKEN).join(" "),
      NETWORK_BOOL_TOKEN), "--no-network"],
    ["BOOL precedes alias duplicates and decoys", helpWithAdd([...canonicalAddTokens(NETWORK_BOOL_TOKEN),
      NETWORK_ALIAS_TOKEN, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN, "--networking",
      "--network[=BOOL]suffix", "prefix--no-network"].join(" ")), "--network=no"],
  ];
  for (const [name, help, expected] of cases) {
    await t.test(name, async () => {
      assert.deepEqual(await materialNetworkArguments(help), Array(4).fill(expected));
    });
  }
});

test("unsupported add-help network forms refuse before child fetch or material filesystem effects", async (t) => {
  const cases = [
    ["missing", ""], ["MODE", "--network=MODE"], ["spaced MODE", "--network MODE"],
    ["bare", "--network"], ["affirmative", "--network=yes"], ["loose alias", "--offline"],
    ["networking", "--networking"], ["BOOL suffix", "--network[=BOOL]suffix"],
    ["alias prefix", "prefix--no-network"],
  ];
  for (const [name, presentation] of cases) {
    await t.test(name, async () => {
      const add = [...canonicalAddTokens().filter((value) => value !== NETWORK_BOOL_TOKEN), presentation]
        .filter(Boolean).join(" ");
      await assertMaterialNetworkRefusal(helpWithAdd(add, `${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`));
    });
  }
  await t.test("malformed UTF-8", async () => {
    const help = completeHelp();
    help.add = Buffer.from([0xff]);
    await assertMaterialNetworkRefusal(help);
  });
});

test("workflow bytes equal the frozen V8 workflow after approved namespace normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v9", "task005-git-materials-v8")
    .replaceAll("task-0005-git-materials-v9", "task-0005-git-materials-v8")
    .replaceAll("diagnostic V9", "diagnostic V8"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "dfdf1135fdd42da3c7893ada8e74194f879ffcab3b13725980bfcbfd30522290");
});

test("workflow bytes retain the frozen V7 workflow seal through V8 normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v9", "task005-git-materials-v7")
    .replaceAll("task-0005-git-materials-v9", "task-0005-git-materials-v7")
    .replaceAll("diagnostic V9", "diagnostic V7"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "9ce94988e64f2bd886570c397d95317d2f2a969ac3365e7e76a4d8536d2d4a7b");
});

test("workflow bytes retain the frozen V6 workflow seal through V7 normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v9", "task005-git-materials-v6")
    .replaceAll("task-0005-git-materials-v9", "task-0005-git-materials-v6")
    .replaceAll("diagnostic V9", "diagnostic V6"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "3a24853a41d2ca8697d1ca9925108726a99b6c6b386e5f51ea012215ccf71757");
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
    const v8Records = reverseOwnerBindingToV8(observed.records, `${FIXTURE_UID}:${FIXTURE_GID}`);
    const v6Records = reverseChecksumInvocationsToV6(v8Records);
    const transcript = v6Records.map((record) => normalizedCommandRecord(record, context));
    assert.equal(transcript.length, 11);
    assert.deepEqual(transcript.map((record) => record.executable), Array(11).fill("docker"));
    assert.equal(hash(Buffer.from(canonicalJson(transcript))),
      "0b7a76654e5ecb38a2369b0d2140ec5504db18ad664af41fa9c62f1f42930dde");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("source-derived root presentation preserves the frozen material transcript", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: sourceDerivedHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const v8Records = reverseOwnerBindingToV8(observed.records, `${FIXTURE_UID}:${FIXTURE_GID}`);
    const v6Records = reverseChecksumInvocationsToV6(v8Records);
    const transcript = v6Records.map((record) => normalizedCommandRecord(record, context));
    assert.equal(transcript.length, 11);
    assert.deepEqual(recordedNetworkArguments(observed.records), Array(4).fill("--network=no"));
    assert.equal(hash(Buffer.from(canonicalJson(transcript))),
      "0b7a76654e5ecb38a2369b0d2140ec5504db18ad664af41fa9c62f1f42930dde");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("source contains only the three reviewed checksum invocation changes", async () => {
  const source = await readFile(actorPath, "utf8");
  assert.equal(source.match(/"\/bin\/busybox",\s*\["sha256sum", "\/lib\/apk\/db\/installed"\]/gu)?.length, 2);
  assert.equal(source.match(/\| \/bin\/busybox sha256sum/gu)?.length, 1);
  assert.equal(source.match(/"\/bin\/sha256sum"/gu)?.length ?? 0, 0);
  assert.equal(source.match(/\| \/bin\/sha256sum/gu)?.length ?? 0, 0);
  const keyScript = source.match(/const keyScript = (".*");\r?\n/u);
  assert.ok(keyScript);
  assert.equal(JSON.parse(keyScript[1]),
    "set -eu; find /etc/apk/keys -mindepth 1 -maxdepth 1 -exec /bin/sh -ceu 'for f do [ -f \"$f\" ] && [ ! -L \"$f\" ] && [ \"$(stat -c %h \"$f\")\" = 1 ] || exit 41; n=$(basename \"$f\"); b=$(wc -c < \"$f\"); h=$(sha256sum \"$f\" | cut -d\" \" -f1); printf \"%s\\t%s\\t%s\\n\" \"$n\" \"$b\" \"$h\"; done' actor {} +");
});

test("default probe accepts seven status-one help results and reaches materialization", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  let materializeCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = probeCommandFixture(context);
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: cleanupPrivate,
      materialize: () => {
        materializeCalls += 1;
        throw Object.assign(new Error("controlled boundary"), { code: "task005_git_materials_material_invalid" });
      },
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(materializeCalls, 1);
    assert.equal(observed.records.length, 11);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default probe accepts the source-derived root presentation and reaches materialization", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  let materializeCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = probeCommandFixture(context, -1, sourceDerivedHelp());
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: cleanupPrivate,
      materialize: () => {
        materializeCalls += 1;
        throw Object.assign(new Error("controlled boundary"), { code: "task005_git_materials_material_invalid" });
      },
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(materializeCalls, 1);
    assert.equal(observed.records.length, 11);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default probe refuses incomplete source-derived root presentations before materialization", {
  skip: process.platform !== "linux",
}, async (t) => {
  const unicodeAdd = `${addTokensWithoutBareRoot().join(" ")} --root,\u00a0-p ROOT`;
  const cases = [
    ["missing alias", helpWithRootPresentation(["--root,", "ROOT"])],
    ["intervening token", helpWithRootPresentation(["--root,", "intervening", "-p", "ROOT"])],
    ["Unicode-only separation", helpWithAdd(unicodeAdd)],
  ];
  for (const [name, help] of cases) {
    await t.test(name, async () => {
      const fixture = await fixtureContext();
      let materializeCalls = 0;
      let fetchCalls = 0;
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = probeCommandFixture(context, -1, help);
        const evidence = await executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          fetchImpl: () => { fetchCalls += 1; assert.fail("NOT_RUN must precede material fetch"); },
          materialize: () => { materializeCalls += 1; return undefined; },
        });
        assert.equal(evidence.receipt.state, "NOT_RUN");
        assert.deepEqual(evidence.receipt.missingCapabilities, ["add:--root"]);
        assert.equal(materializeCalls, 0);
        assert.equal(fetchCalls, 0);
        assert.equal(observed.records.length, 11);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("default probe keeps incomplete status-one help at NOT_RUN before materialization", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  let materializeCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = probeCommandFixture(context, -1, helpWithoutManifestCapability());
    const evidence = await executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: cleanupPrivate,
      materialize: () => { materializeCalls += 1; return undefined; },
    });
    assert.equal(evidence.receipt.state, "NOT_RUN");
    assert.deepEqual(evidence.receipt.missingCapabilities, ["manifest:manifest"]);
    assert.equal(materializeCalls, 0);
    assert.equal(observed.records.length, 11);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default probe keeps incomplete add-global evidence at NOT_RUN before materialization", {
  skip: process.platform !== "linux",
}, async (t) => {
  const cases = [
    ["missing exact global token", helpWithoutExactAddToken("--repositories-file",
      ["prefix--repositories-file", "--repositories-file-suffix"]), ["add:--repositories-file"]],
    ["missing exact network presentation", helpWithAdd(canonicalAddTokens()
      .filter((value) => value !== NETWORK_BOOL_TOKEN).join(" "), NETWORK_BOOL_TOKEN), ["add:network-denial"]],
  ];
  for (const [name, help, missing] of cases) {
    await t.test(name, async () => {
      const fixture = await fixtureContext();
      let materializeCalls = 0;
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = probeCommandFixture(context, -1, help);
        const evidence = await executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          materialize: () => { materializeCalls += 1; return undefined; },
        });
        assert.equal(evidence.receipt.state, "NOT_RUN");
        assert.deepEqual(evidence.receipt.missingCapabilities, missing);
        assert.equal(materializeCalls, 0);
        assert.equal(observed.records.length, 11);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
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

test("index verifier maps every exact reviewed native line to its closed category", async (t) => {
  for (const [literal, category] of INDEX_VERIFY_KNOWN) {
    await t.test(category, () => {
      const stdout = indexVerifyLine(literal);
      const error = indexVerifierFailure(stdout);
      const projected = projectedFailure(error);
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, indexDiagnostic(stdout.length));
      assert.deepEqual(Object.keys(error.childDiagnostic).sort(),
        ["operation", "reason", "signal", "status", "stderrBytes", "stdoutBytes"]);
      assert.equal(projected.nativeErrorCategory, category);
      assert.deepEqual(projected.childDiagnostic, error.childDiagnostic);
      assert.doesNotMatch(JSON.stringify(projected), new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    });
  }
  assert.equal(indexVerifyLine("Permission denied").length, 51);
  assert.equal(indexVerifyLine("crypto error").length, 46);
});

test("index verifier classifies unmatched validator-valid stream shapes as unknown", async (t) => {
  const known = indexVerifyLine(INDEX_VERIFY_KNOWN[0][0]);
  const cases = [
    ["synthetic 51 bytes", Buffer.alloc(51, 0x78), Buffer.alloc(0)],
    ["one byte", Buffer.from("x"), Buffer.alloc(0)],
    ["256 bytes", Buffer.alloc(256, 0x78), Buffer.alloc(0)],
    ["257 bytes", Buffer.alloc(257, 0x78), Buffer.alloc(0)],
    ["empty stdout", Buffer.alloc(0), Buffer.alloc(0)],
    ["missing stdout", OMIT_STREAM, Buffer.alloc(0)],
    ["non-Buffer stdout", "PRIVATE", Buffer.alloc(0)],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28]), Buffer.alloc(0)],
    ["UTF-8 BOM prefix", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), known]), Buffer.alloc(0)],
    ["prefix", Buffer.concat([Buffer.from("prefix"), known]), Buffer.alloc(0)],
    ["suffix", Buffer.concat([known, Buffer.from("suffix")]), Buffer.alloc(0)],
    ["case change", Buffer.from(known.toString("utf8").toLowerCase()), Buffer.alloc(0)],
    ["punctuation change", Buffer.from(known.toString("utf8").replace(": ", ":")), Buffer.alloc(0)],
    ["multiple lines", Buffer.concat([known, known]), Buffer.alloc(0)],
    ["embedded NUL", Buffer.from(known.toString("utf8").replace("UNTRUSTED", "UNTRUSTED\0")), Buffer.alloc(0)],
    ["CRLF", Buffer.from(known.toString("utf8").replace("\n", "\r\n")), Buffer.alloc(0)],
    ["ANSI", Buffer.from(`\u001b[31m${known.toString("utf8")}\u001b[0m`), Buffer.alloc(0)],
    ["known line with stderr", known, Buffer.from("x")],
    ["missing stderr", known, OMIT_STREAM],
    ["non-Buffer stderr", known, "PRIVATE"],
  ];
  for (const [name, stdout, stderr] of cases) {
    await t.test(name, () => {
      const error = indexVerifierFailure(stdout, stderr);
      const projected = projectedFailure(error);
      assert.equal(error.childDiagnostic.reason, "EXIT_STATUS");
      assert.equal(error.childDiagnostic.status, 1);
      assert.equal(projected.nativeErrorCategory, INDEX_VERIFY_UNKNOWN);
      assert.equal(projected.childDiagnostic.stdoutBytes, Buffer.isBuffer(stdout) ? stdout.length : 0);
      assert.equal(projected.childDiagnostic.stderrBytes, Buffer.isBuffer(stderr) ? stderr.length : 0);
    });
  }
});

test("index verifier category never overrides validator precedence", async (t) => {
  const stdout = indexVerifyLine("Permission denied");
  const cases = [
    ["status two", { status: 2, stdout, stderr: Buffer.alloc(0) }],
    ["timeout", { status: 1, error: { code: "ETIMEDOUT" }, stdout, stderr: Buffer.alloc(0) }],
    ["spawn error", { status: 1, error: { code: "EACCES" }, stdout, stderr: Buffer.alloc(0) }],
    ["signal", { status: 1, signal: "SIGKILL", stdout, stderr: Buffer.alloc(0) }],
    ["output cap", { status: 1, stdout: Buffer.alloc(limits.childOutputBytes + 1), stderr: Buffer.alloc(0) }],
  ];
  for (const [name, result] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
        INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
      assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
    });
  }
  await t.test("status zero remains success", () => {
    const result = runCarrier(carrierContext(), freshCarrierResources(), () => ({
      status: 0, stdout, stderr: Buffer.alloc(0),
    }), INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]);
    assert.equal(result.status, 0);
  });
});

test("index verifier category is bound to the exact operation and command tuple", async (t) => {
  const stdout = indexVerifyLine("Permission denied");
  const cases = [
    ["wrong operation", "MATERIAL_APK_VERIFY", INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]],
    ["wrong entrypoint", INDEX_VERIFY_OPERATION, "/bin/sh", [...INDEX_VERIFY_ARGS]],
    ["wrong subject", INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT,
      [...INDEX_VERIFY_ARGS.slice(0, -1), "/materials/repo/private.tar.gz"]],
    ["extra argument", INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS, "PRIVATE"]],
  ];
  for (const [name, operation, entrypoint, args] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
        status: 1, stdout, stderr: Buffer.alloc(0),
      }), operation, entrypoint, args));
      assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
    });
  }
  await t.test("sparse argv keeps existing invocation behavior without category", () => {
    const sparse = new Array(INDEX_VERIFY_ARGS.length);
    for (let index = 1; index < sparse.length; index += 1) sparse[index] = INDEX_VERIFY_ARGS[index];
    let calls = 0;
    const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => {
      calls += 1;
      return { status: 1, stdout, stderr: Buffer.alloc(0) };
    }, INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, sparse));
    assert.equal(calls, 1);
    assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
  });
});

test("index verifier snapshots hostile argv once before invocation", () => {
  const target = [...INDEX_VERIFY_ARGS];
  const descriptorReads = new Map();
  const args = new Proxy(target, {
    getOwnPropertyDescriptor(value, key) {
      descriptorReads.set(String(key), (descriptorReads.get(String(key)) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
  });
  let invokedCarrierArgs;
  const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), (_executable, dockerArgs) => {
    invokedCarrierArgs = [...dockerArgs];
    target[3] = "/materials/repo/PRIVATE.tar.gz";
    return { status: 1, stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0) };
  }, INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, args));
  const entrypointAt = invokedCarrierArgs.indexOf("--entrypoint");
  assert.deepEqual(invokedCarrierArgs.slice(entrypointAt + 3), INDEX_VERIFY_ARGS);
  assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
  assert.equal(descriptorReads.get("length"), 1);
  for (let index = 0; index < INDEX_VERIFY_ARGS.length; index += 1) {
    assert.equal(descriptorReads.get(String(index)), 1);
  }
});

test("index verifier snapshots each hostile result field once for validator and classifier", () => {
  const first = {
    stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0), error: undefined, signal: null, status: 1,
  };
  const descriptorReads = new Map();
  const result = new Proxy(first, {
    getOwnPropertyDescriptor(value, key) {
      const name = String(key);
      const count = (descriptorReads.get(name) ?? 0) + 1;
      descriptorReads.set(name, count);
      if (count > 1) return { configurable: true, enumerable: true, writable: true,
        value: name === "status" ? 0 : name === "stdout" ? Buffer.from("PRIVATE") : value[name] };
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
  });
  const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
    INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
  assert.deepEqual(error.childDiagnostic, indexDiagnostic(first.stdout.length));
  for (const field of ["stdout", "stderr", "error", "signal", "status"]) {
    assert.equal(descriptorReads.get(field), 1);
  }
});

test("index verifier result snapshot invokes no accessors", () => {
  let getterCalls = 0;
  const result = { stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0) };
  Object.defineProperty(result, "status", {
    get() { getterCalls += 1; throw new Error("PRIVATE_STATUS"); },
  });
  const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
    INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(getterCalls, 0);
  assert.deepEqual(error.childDiagnostic, expectedDiagnostic(INDEX_VERIFY_OPERATION, "RESULT_INVALID", {
    stdoutBytes: 51,
  }));
  assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
});

test("classifier failure keeps the validator error primary and falls back to unknown", () => {
  const OriginalTextDecoder = globalThis.TextDecoder;
  const classifierFailure = new Error("PRIVATE_CLASSIFIER");
  globalThis.TextDecoder = class {
    decode() { throw classifierFailure; }
  };
  try {
    const error = indexVerifierFailure(indexVerifyLine("Permission denied"));
    assert.notEqual(error, classifierFailure);
    assert.deepEqual(error.childDiagnostic, indexDiagnostic(51));
    assert.equal(projectedFailure(error).nativeErrorCategory, INDEX_VERIFY_UNKNOWN);
  } finally {
    globalThis.TextDecoder = OriginalTextDecoder;
  }
});

test("foreign validator errors with forged diagnostics remain ineligible and preserve identity", () => {
  const line = indexVerifyLine("Permission denied");
  const foreign = Object.assign(new Error("PRIVATE_FOREIGN"), {
    code: "task005_git_materials_child_failed",
    childDiagnostic: indexDiagnostic(line.length),
    nativeErrorCategory: "EACCES",
  });
  const hostile = new Proxy(line, {
    get(target, key) {
      if (key === "length") throw foreign;
      return Reflect.get(target, key, target);
    },
  });
  const observed = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
    status: 1, stdout: hostile, stderr: Buffer.alloc(0),
  }), INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(observed, foreign);
  assert.equal(Object.hasOwn(projectedFailure(observed), "nativeErrorCategory"), false);
});

test("a validator error from an earlier call cannot gain a category from a later hostile snapshot", () => {
  const line = indexVerifyLine("Permission denied");
  const earlier = captureThrown(() => validateCommandResult({
    status: 1, stdout: line, stderr: Buffer.alloc(0),
  }, [0], INDEX_VERIFY_OPERATION));
  const hostile = new Proxy(line, {
    get(target, key) {
      if (key === "length") throw earlier;
      return Reflect.get(target, key, target);
    },
  });
  const observed = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
    status: 1, stdout: hostile, stderr: Buffer.alloc(0),
  }), INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(observed, earlier);
  assert.equal(Object.hasOwn(projectedFailure(observed), "nativeErrorCategory"), false);
});

test("trusted native categories survive safe projection while forged clones and accessors do not", () => {
  const trusted = indexVerifierFailure(indexVerifyLine("Permission denied"));
  assert.equal(projectedFailure(trusted).nativeErrorCategory, "EACCES");

  const forged = {
    code: trusted.code,
    childDiagnostic: { ...trusted.childDiagnostic },
    nativeErrorCategory: "EACCES",
  };
  assert.equal(Object.hasOwn(projectedFailure(forged), "nativeErrorCategory"), false);

  let getterCalls = 0;
  Object.defineProperty(forged, "nativeErrorCategory", {
    configurable: true,
    get() { getterCalls += 1; throw new Error("PRIVATE_CATEGORY"); },
  });
  forged[Symbol("PRIVATE_CATEGORY")] = "EACCES";
  assert.equal(Object.hasOwn(projectedFailure(forged), "nativeErrorCategory"), false);
  assert.equal(getterCalls, 0);
});

test("failure markers realize every known category only at its exact native byte length", async (t) => {
  for (const [literal, category] of INDEX_VERIFY_KNOWN) {
    await t.test(category, async (known) => {
      const length = indexVerifyLine(literal).length;
      const valid = { code: "task005_git_materials_child_failed",
        childDiagnostic: indexDiagnostic(length), nativeErrorCategory: category };
      const observed = await readMarkerBytes(Buffer.from(canonicalJson(valid)));
      assert.deepEqual(observed, valid);
      assert.equal(projectedFailure(observed).nativeErrorCategory, category);
      for (const [name, diagnostic] of [
        ["length minus one", indexDiagnostic(length - 1)],
        ["length plus one", indexDiagnostic(length + 1)],
        ["nonempty stderr", indexDiagnostic(length, 1)],
      ]) {
        await known.test(`rejects ${name}`, async () => {
          const bytes = Buffer.from(canonicalJson({ ...valid, childDiagnostic: diagnostic }));
          await assert.rejects(readMarkerBytes(bytes), { code: "task005_git_materials_cleanup_failed" });
        });
      }
    });
  }
});

test("unknown category markers enforce the aggregate child output cap", async (t) => {
  const accepted = [
    ["zero bytes", 0, 0],
    ["257 stdout bytes", 257, 0],
    ["nonempty stderr", 0, 1],
    ["exact aggregate cap", limits.childOutputBytes - 1, 1],
  ];
  for (const [name, stdoutBytes, stderrBytes] of accepted) {
    await t.test(name, async () => {
      const record = { code: "task005_git_materials_child_failed",
        childDiagnostic: indexDiagnostic(stdoutBytes, stderrBytes), nativeErrorCategory: INDEX_VERIFY_UNKNOWN };
      const observed = await readMarkerBytes(Buffer.from(canonicalJson(record)));
      assert.equal(projectedFailure(observed).nativeErrorCategory, INDEX_VERIFY_UNKNOWN);
    });
  }
  await t.test("aggregate cap plus one", async () => {
    const record = { code: "task005_git_materials_child_failed",
      childDiagnostic: indexDiagnostic(limits.childOutputBytes, 1), nativeErrorCategory: INDEX_VERIFY_UNKNOWN };
    await assert.rejects(readMarkerBytes(Buffer.from(canonicalJson(record))),
      { code: "task005_git_materials_cleanup_failed" });
  });
});

test("category-bearing markers reject every unbound or noncanonical shape", async (t) => {
  const length = indexVerifyLine("Permission denied").length;
  const valid = { code: "task005_git_materials_child_failed",
    childDiagnostic: indexDiagnostic(length), nativeErrorCategory: "EACCES" };
  const invalid = [
    ["missing diagnostic", { code: valid.code, nativeErrorCategory: "EACCES" }],
    ["generic code", { ...valid, code: "task005_git_materials_download_failed" }],
    ["wrong operation", { ...valid, childDiagnostic: { ...valid.childDiagnostic, operation: "MATERIAL_APK_VERIFY" } }],
    ["wrong reason", { ...valid, childDiagnostic: { ...valid.childDiagnostic,
      reason: "SIGNAL", status: null, signal: "SIGKILL" } }],
    ["wrong status", { ...valid, childDiagnostic: { ...valid.childDiagnostic, status: 2 } }],
    ["non-null signal", { ...valid, childDiagnostic: { ...valid.childDiagnostic, signal: "SIGKILL" } }],
    ["unknown category", { ...valid, nativeErrorCategory: "APKE_PRIVATE" }],
    ["case-changed category", { ...valid, nativeErrorCategory: "eacces" }],
    ["extra field", { ...valid, private: "PRIVATE" }],
  ];
  for (const [name, record] of invalid) {
    await t.test(name, async () => {
      await assert.rejects(readMarkerBytes(Buffer.from(canonicalJson(record))),
        { code: "task005_git_materials_cleanup_failed" });
    });
  }
  await t.test("noncanonical key order", async () => {
    const bytes = Buffer.from(`${JSON.stringify({ nativeErrorCategory: "EACCES", code: valid.code,
      childDiagnostic: valid.childDiagnostic })}\n`);
    await assert.rejects(readMarkerBytes(bytes), { code: "task005_git_materials_cleanup_failed" });
  });
});

test("failure marker writer preserves a trusted category and ignores symbol metadata", {
  skip: process.platform !== "linux",
}, async () => {
  const created = await mkdtemp(path.join(os.tmpdir(), "task005-git-marker-v9-"));
  const privateRoot = await realpath(created);
  try {
    const trusted = indexVerifierFailure(indexVerifyLine("Permission denied"));
    trusted[Symbol("PRIVATE_CATEGORY")] = "PRIVATE";
    await writeFailureMarker({ privateRoot }, trusted);
    const bytes = await readFile(path.join(privateRoot, "failure-code"));
    assert.doesNotMatch(bytes.toString("utf8"), /PRIVATE/u);
    const observed = await readFailureMarker({ privateRoot });
    assert.equal(projectedFailure(observed).nativeErrorCategory, "EACCES");
  } finally {
    await rm(privateRoot, { recursive: true, force: true });
  }
});

test("immediate cleanup publishes the exact verifier category without raw streams", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 2, failResult: {
    status: 1, stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0),
  } });
  let indexPresentBeforeCleanup = false;
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: async (ownedContext) => {
        indexPresentBeforeCleanup = (await lstat(path.join(ownedContext.privateRoot, "repo", "APKINDEX.tar.gz"))).isFile();
        await cleanupPrivate(ownedContext);
      },
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
    }));
    assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
    assert.equal(indexPresentBeforeCleanup, true);
    assert.equal(observed.records.length, 3);
    assert.equal(observed.fetchCalls.length, 1);
    assert.match(observed.fetchCalls[0], /APKINDEX\.tar\.gz$/u);
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.nativeErrorCategory, "EACCES");
    assert.deepEqual(evidence.receipt.childDiagnostic, indexDiagnostic(51));
    assert.deepEqual(evidence.manifest, {
      actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", authority: "DIAGNOSTIC_ONLY", files: [],
      installationAuthorization: false, state: "EMPTY_BLOCKED",
    });
    assert.doesNotMatch(JSON.stringify(evidence), /Permission denied|PRIVATE/u);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("deferred cleanup revalidates marker provenance and publishes the same verifier category", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 2, failResult: {
    status: 1, stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0),
  } });
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(), command: observed.command,
      cleanup: async () => { throw Object.assign(new Error("PRIVATE_CLEANUP"),
        { code: "task005_git_materials_cleanup_failed" }); },
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
    }));
    assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
    const marker = await readFailureMarker(context);
    assert.equal(marker.nativeErrorCategory, "EACCES");
    assert.equal(projectedFailure(marker).nativeErrorCategory, "EACCES");
    const forged = globalThis.structuredClone(marker);
    assert.equal(Object.hasOwn(projectedFailure(forged), "nativeErrorCategory"), false);

    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.nativeErrorCategory, "EACCES");
    assert.deepEqual(evidence.receipt.childDiagnostic, indexDiagnostic(51));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("cleanup failure never replaces a trusted verifier error or its category", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const first = indexVerifierFailure(indexVerifyLine("Permission denied"));
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw first; },
      cleanup: async () => { throw Object.assign(new Error("PRIVATE_CLEANUP"),
        { code: "task005_git_materials_cleanup_failed" }); },
    }));
    assert.equal(observed, first);
    assert.equal(projectedFailure(observed).nativeErrorCategory, "EACCES");
    assert.equal(projectedFailure(await readFailureMarker(context)).nativeErrorCategory, "EACCES");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("an invalid category marker still runs cleanup and publishes no evidence", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const forged = {
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...indexDiagnostic(51), operation: "MATERIAL_APK_VERIFY" },
      nativeErrorCategory: "EACCES",
    };
    await writeFile(path.join(context.privateRoot, "failure-code"), canonicalJson(forged), { mode: 0o600 });
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

test("material owner identity is captured once and frozen across all eleven commands", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  const owner = ownerIdentityFixture();
  let mutated = false;
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    const command = (...args) => {
      if (!mutated) {
        mutated = true;
        owner.ownerStat.uid = 99_001;
        owner.ownerStat.gid = 99_002;
      }
      return observed.command(...args);
    };
    await rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
      identityIo: owner.identityIo,
    });
    assert.deepEqual(owner.calls, { getuid: 1, getgid: 1, lstat: 1, targets: [context.privateRoot] });
    assert.equal(observed.records.length, 11);
    assert.deepEqual(observed.records.map(recordedOwnerPair), Array(11).fill(owner.pair));
    assert.deepEqual(Object.keys(resources).sort(), ["carrierMayBeOwned", "containerNames", "nextOrdinal"]);
    assert.doesNotMatch(JSON.stringify(resources), new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}`, "u"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("material owner binding accepts zero mixed-zero and upper-bound identities", async (t) => {
  const cases = [
    ["zero owner", 0, 0],
    ["zero UID", 0, 37],
    ["zero GID", 41, 0],
    ["common upper bound", 2_147_483_647, 2_147_483_647],
  ];
  for (const [name, uid, gid] of cases) {
    await t.test(name, async () => {
      await withBoundMaterialOwner(({ observed, owner }) => {
        assert.deepEqual(observed.records.map(recordedOwnerPair), Array(11).fill(`${uid}:${gid}`));
        assert.deepEqual(owner.calls.getuid, 1);
        assert.deepEqual(owner.calls.getgid, 1);
        assert.deepEqual(owner.calls.lstat, 1);
      }, { uid, gid });
    });
  }
});

test("identity I/O rejects missing throwing accessor-backed and proxied capabilities before effects", async (t) => {
  let accessorCalls = 0;
  const accessorIo = { getgid: () => FIXTURE_GID, lstat: async () => (
    { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) };
  Object.defineProperty(accessorIo, "getuid", { get() { accessorCalls += 1; return () => FIXTURE_UID; } });
  const getgidAccessorIo = { getuid: () => FIXTURE_UID, lstat: async () => (
    { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) };
  Object.defineProperty(getgidAccessorIo, "getgid", { get() { accessorCalls += 1; return () => FIXTURE_GID; } });
  const lstatAccessorIo = { getuid: () => FIXTURE_UID, getgid: () => FIXTURE_GID };
  Object.defineProperty(lstatAccessorIo, "lstat", { get() { accessorCalls += 1; return async () => (
    { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }); } });
  const cases = [
    ["missing getuid", { getgid: () => FIXTURE_GID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["missing getgid", { getuid: () => FIXTURE_UID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["missing lstat", { getuid: () => FIXTURE_UID, getgid: () => FIXTURE_GID }],
    ["non-function getuid", { getuid: FIXTURE_UID, getgid: () => FIXTURE_GID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["non-function getgid", { getuid: () => FIXTURE_UID, getgid: FIXTURE_GID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["accessor getuid", accessorIo],
    ["accessor getgid", getgidAccessorIo],
    ["accessor lstat", lstatAccessorIo],
    ["throwing getuid", ownerIdentityFixture({ getuid: () => { throw new Error("PRIVATE_UID"); } }).identityIo],
    ["throwing getgid", ownerIdentityFixture({ getgid: () => { throw new Error("PRIVATE_GID"); } }).identityIo],
    ["non-function lstat", { getuid: () => FIXTURE_UID, getgid: () => FIXTURE_GID, lstat: 1 }],
    ["throwing lstat", ownerIdentityFixture({ lstat: async () => { throw new Error("PRIVATE_STAT"); } }).identityIo],
    ["proxied identity object", new Proxy(ownerIdentityFixture().identityIo, {})],
    ["proxied getuid function", ownerIdentityFixture({ getuid: new Proxy(() => FIXTURE_UID, {}) }).identityIo],
  ];
  for (const [name, identityIo] of cases) {
    await t.test(name, () => assertIdentityRefusal(identityIo));
  }
  assert.equal(accessorCalls, 0);
});

test("owner IDs reject every noncanonical numeric shape and cap overflow before effects", async (t) => {
  const values = [
    ["string", "20001"], ["boolean", true], ["NaN", Number.NaN], ["positive infinity", Number.POSITIVE_INFINITY],
    ["fraction", 1.5], ["negative", -1], ["cap plus one", 2_147_483_648],
  ];
  for (const [valueName, value] of values) {
    const cases = [
      [`process UID ${valueName}`, ownerIdentityFixture({ uid: value, statUid: value }).identityIo],
      [`process GID ${valueName}`, ownerIdentityFixture({ gid: value, statGid: value }).identityIo],
      [`owner UID ${valueName}`, ownerIdentityFixture({ statUid: value }).identityIo],
      [`owner GID ${valueName}`, ownerIdentityFixture({ statGid: value }).identityIo],
    ];
    for (const [name, identityIo] of cases) {
      await t.test(name, () => assertIdentityRefusal(identityIo));
    }
  }
});

test("private-root stat rejects owner mismatches unsafe descriptors and invalid mode bits", async (t) => {
  let uidAccessorCalls = 0;
  const accessorStat = { gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE };
  Object.defineProperty(accessorStat, "uid", { get() { uidAccessorCalls += 1; return FIXTURE_UID; } });
  const gidAccessorStat = { uid: FIXTURE_UID, mode: PRIVATE_DIRECTORY_MODE };
  Object.defineProperty(gidAccessorStat, "gid", { get() { uidAccessorCalls += 1; return FIXTURE_GID; } });
  const modeAccessorStat = { uid: FIXTURE_UID, gid: FIXTURE_GID };
  Object.defineProperty(modeAccessorStat, "mode", {
    get() { uidAccessorCalls += 1; return PRIVATE_DIRECTORY_MODE; },
  });
  const cases = [
    ["missing UID", ownerIdentityFixture({ stat: { gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE } }).identityIo],
    ["missing GID", ownerIdentityFixture({ stat: { uid: FIXTURE_UID, mode: PRIVATE_DIRECTORY_MODE } }).identityIo],
    ["missing mode", ownerIdentityFixture({ stat: { uid: FIXTURE_UID, gid: FIXTURE_GID } }).identityIo],
    ["UID accessor", ownerIdentityFixture({ stat: accessorStat }).identityIo],
    ["GID accessor", ownerIdentityFixture({ stat: gidAccessorStat }).identityIo],
    ["mode accessor", ownerIdentityFixture({ stat: modeAccessorStat }).identityIo],
    ["proxied stat", ownerIdentityFixture({ stat: new Proxy(
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }, {}) }).identityIo],
    ["UID mismatch", ownerIdentityFixture({ statUid: FIXTURE_UID + 1 }).identityIo],
    ["GID mismatch", ownerIdentityFixture({ statGid: FIXTURE_GID + 1 }).identityIo],
    ["regular file", ownerIdentityFixture({ mode: 0o100700 }).identityIo],
    ["symbolic link", ownerIdentityFixture({ mode: 0o120700 }).identityIo],
    ["missing directory type", ownerIdentityFixture({ mode: 0o700 }).identityIo],
    ["group-readable directory", ownerIdentityFixture({ mode: 0o040750 }).identityIo],
    ["world-readable directory", ownerIdentityFixture({ mode: 0o040705 }).identityIo],
    ["nonnumeric mode", ownerIdentityFixture({ mode: "040700" }).identityIo],
    ["mode cap overflow", ownerIdentityFixture({ mode: 0x1_0000_0000 }).identityIo],
  ];
  for (const [name, identityIo] of cases) {
    await t.test(name, () => assertIdentityRefusal(identityIo));
  }
  assert.equal(uidAccessorCalls, 0);
});

test("poisoned environment identity cannot alter the captured owner pair", async (t) => {
  const original = new Map(["UID", "GID", "USER", "LOGNAME"].map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.UID = "91001";
  process.env.GID = "91002";
  process.env.USER = "PRIVATE_USER_SENTINEL";
  process.env.LOGNAME = "PRIVATE_LOGNAME_SENTINEL";
  await withBoundMaterialOwner(({ observed, owner }) => {
    const serialized = JSON.stringify(observed.records);
    assert.deepEqual(observed.records.map(recordedOwnerPair), Array(11).fill(owner.pair));
    assert.doesNotMatch(serialized, /91001|91002|PRIVATE_USER_SENTINEL|PRIVATE_LOGNAME_SENTINEL/u);
  });
});

test("private-root directory validation uses numeric mode bits without invoking stat methods", async () => {
  let methodAccesses = 0;
  const stat = { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE };
  Object.defineProperties(stat, {
    isDirectory: { get() { methodAccesses += 1; throw new Error("PRIVATE_METHOD"); } },
    isSymbolicLink: { get() { methodAccesses += 1; throw new Error("PRIVATE_METHOD"); } },
  });
  const owner = ownerIdentityFixture({ stat });
  await withBoundMaterialOwner(({ observed }) => {
    assert.equal(observed.records.length, 11);
  }, { uid: FIXTURE_UID, gid: FIXTURE_GID, identityIo: owner.identityIo });
  assert.equal(methodAccesses, 0);
});

test("an exact private material mount dispatches with the frozen owner and immutable mount", async () => {
  await withBoundMaterialOwner(({ context, resources, owner }) => {
    const mount = { source: context.privateRoot, target: "/materials" };
    let record;
    const result = runCarrier(context, resources, (executable, args, options) => {
      record = { executable, args: [...args], options };
      mount.source = "C:/PRIVATE_MUTATION";
      mount.target = "/PRIVATE_MUTATION";
      mount.readonly = false;
      return { status: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) };
    }, "MATERIAL_QUERY", "/sbin/apk", ["query"], [mount]);
    assert.equal(result.stdout.toString("utf8"), "ok");
    assert.equal(record.executable, "docker");
    assert.equal(recordedOwnerPair(record), owner.pair);
    assert.ok(record.args.includes(`type=bind,src=${context.privateRoot},dst=/materials,readonly`));
    assert.doesNotMatch(record.args.join(" "), /PRIVATE_MUTATION/u);
  });
});

test("private owner binding cannot be forged on public resources or context properties", () => {
  const context = carrierContext();
  const resources = { ...freshCarrierResources(), materialUser: `${FIXTURE_UID}:${FIXTURE_GID}`,
    ownerBinding: { privateRoot: context.privateRoot, uid: FIXTURE_UID, gid: FIXTURE_GID } };
  const before = globalThis.structuredClone(resources);
  let calls = 0;
  assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "MATERIAL_QUERY", "/sbin/apk",
    ["query"], [{ source: context.privateRoot, target: "/materials" }]),
  { code: "task005_git_materials_private_root_invalid" });
  assert.equal(calls, 0);
  assert.deepEqual(resources, before);
});

test("proxied resources cannot acquire a material owner binding", () => {
  const context = carrierContext();
  const resources = new Proxy(freshCarrierResources(), {});
  let calls = 0;
  assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "MATERIAL_QUERY", "/sbin/apk",
    ["query"], [{ source: context.privateRoot, target: "/materials" }]),
  { code: "task005_git_materials_private_root_invalid" });
  assert.equal(calls, 0);
});

test("a material owner binding cannot be reused for another private root", async () => {
  await withBoundMaterialOwner(({ context, resources }) => {
    const foreignContext = { ...context, privateRoot: `${context.privateRoot}-foreign` };
    const before = globalThis.structuredClone(resources);
    let calls = 0;
    assert.throws(() => runCarrier(foreignContext, resources, () => { calls += 1; }, "MATERIAL_QUERY",
      "/sbin/apk", ["query"], [{ source: foreignContext.privateRoot, target: "/materials" }]),
    { code: "task005_git_materials_private_root_invalid" });
    assert.equal(calls, 0);
    assert.deepEqual(resources, before);
  });
});

test("an accessor-backed context root cannot reuse a private owner binding", async () => {
  await withBoundMaterialOwner(({ context, resources }) => {
    let accessorCalls = 0;
    const hostileContext = { ...context };
    Object.defineProperty(hostileContext, "privateRoot", {
      get() { accessorCalls += 1; return context.privateRoot; }, enumerable: true,
    });
    const before = globalThis.structuredClone(resources);
    let calls = 0;
    assert.throws(() => runCarrier(hostileContext, resources, () => { calls += 1; }, "MATERIAL_QUERY",
      "/sbin/apk", ["query"], [{ source: context.privateRoot, target: "/materials" }]),
    { code: "task005_git_materials_private_root_invalid" });
    assert.equal(accessorCalls, 0);
    assert.equal(calls, 0);
    assert.deepEqual(resources, before);
  });
});

test("non-material operations cannot consume a private material mount binding", async () => {
  await withBoundMaterialOwner(({ context, resources }) => {
    const before = globalThis.structuredClone(resources);
    let calls = 0;
    assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "PROBE_APK_VERSION",
      "/sbin/apk", ["--version"], [{ source: context.privateRoot, target: "/materials" }]),
    { code: "task005_git_materials_private_root_invalid" });
    assert.equal(calls, 0);
    assert.deepEqual(resources, before);
  });
});

test("bound resources do not leak the owner pair to an unmounted probe", async () => {
  await withBoundMaterialOwner(({ context, resources, owner }) => {
    let record;
    runCarrier(context, resources, (executable, args, options) => {
      record = { executable, args: [...args], options };
      return { status: 0, stdout: Buffer.from("apk-tools 3.0.0, compiled for x86_64."), stderr: Buffer.alloc(0) };
    }, "PROBE_APK_VERSION", "/sbin/apk", ["--version"]);
    assert.equal(record.args.includes("--user"), false);
    assert.equal(record.args.includes(owner.pair), false);
  });
});

test("material mounts reject foreign extra writable accessor-backed and proxied shapes", async (t) => {
  await withBoundMaterialOwner(async ({ context, resources }) => {
    const accessorMount = { source: context.privateRoot, target: "/materials" };
    let readonlyAccessorCalls = 0;
    Object.defineProperty(accessorMount, "readonly", {
      get() { readonlyAccessorCalls += 1; return true; }, enumerable: true,
    });
    const symbolMount = { source: context.privateRoot, target: "/materials" };
    symbolMount[Symbol("PRIVATE")] = true;
    const cases = [
      ["foreign source", [{ source: `${context.privateRoot}-foreign`, target: "/materials" }]],
      ["foreign target", [{ source: context.privateRoot, target: "/private-materials" }]],
      ["explicit writable", [{ source: context.privateRoot, target: "/materials", readonly: false }]],
      ["extra mount", [{ source: context.privateRoot, target: "/materials" },
        { source: context.privateRoot, target: "/other" }]],
      ["extra property", [{ source: context.privateRoot, target: "/materials", privateUser: "forged" }]],
      ["symbol property", [symbolMount]],
      ["readonly accessor", [accessorMount]],
      ["proxied mount", [new Proxy({ source: context.privateRoot, target: "/materials" }, {})]],
      ["proxied mount array", new Proxy([{ source: context.privateRoot, target: "/materials" }], {})],
    ];
    for (const [name, mounts] of cases) {
      await t.test(name, () => {
        const before = globalThis.structuredClone(resources);
        let calls = 0;
        assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "MATERIAL_QUERY",
          "/sbin/apk", ["query"], mounts), { code: "task005_git_materials_private_root_invalid" });
        assert.equal(calls, 0);
        assert.deepEqual(resources, before);
      });
    }
    assert.equal(readonlyAccessorCalls, 0);
  });
});

test("executeActor forwards explicit identity I/O and publishes no owner identity on immediate refusal", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const owner = ownerIdentityFixture({ statUid: FIXTURE_UID + 1 });
  let childCalls = 0;
  let fetchCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => rawExecuteActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      identityIo: owner.identityIo,
      command: () => { childCalls += 1; assert.fail("owner refusal must precede material child execution"); },
      fetchImpl: () => { fetchCalls += 1; assert.fail("owner refusal must precede material fetch"); },
      cleanup: cleanupPrivate,
    }));
    assert.equal(error.code, "task005_git_materials_private_root_invalid");
    assert.deepEqual(owner.calls, { getuid: 1, getgid: 1, lstat: 1, targets: [context.privateRoot] });
    assert.equal(childCalls, 0);
    assert.equal(fetchCalls, 0);
    const evidence = await readPublicEvidence(context);
    const serialized = JSON.stringify(evidence);
    assert.equal(evidence.receipt.code, "task005_git_materials_private_root_invalid");
    assert.equal(Object.hasOwn(evidence.receipt, "childDiagnostic"), false);
    assert.doesNotMatch(serialized, new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}|uid|gid|user`, "iu"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("deferred owner refusal marker and cleanup receipt contain no owner identity", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const owner = ownerIdentityFixture({ statGid: FIXTURE_GID + 1 });
  try {
    const context = await requireContext(fixture.env, "linux");
    await assert.rejects(rawExecuteActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      identityIo: owner.identityIo,
      command: () => assert.fail("owner refusal must precede material child execution"),
      fetchImpl: () => assert.fail("owner refusal must precede material fetch"),
      cleanup: async () => { throw Object.assign(new Error("PRIVATE_CLEANUP"),
        { code: "task005_git_materials_cleanup_failed" }); },
    }), { code: "task005_git_materials_private_root_invalid" });
    const marker = await readFile(path.join(context.privateRoot, "failure-code"), "utf8");
    assert.doesNotMatch(marker, new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}|uid|gid|user`, "iu"));
    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.code, "task005_git_materials_private_root_invalid");
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}|uid|gid|user`, "iu"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default Linux identity binds material commands to the actual private-root owner", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const info = await lstat(context.privateRoot);
    assert.equal(info.uid, process.getuid());
    assert.equal(info.gid, process.getgid());
    assert.equal(info.mode & 0o170000, 0o040000);
    assert.equal(info.mode & 0o777, 0o700);
    await rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    assert.deepEqual(observed.records.map(recordedOwnerPair),
      Array(11).fill(`${process.getuid()}:${process.getgid()}`));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});
