import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createOwnedDirectory,
  cleanEnvironment,
  policyError,
  removeOwnedDirectory,
  runCommand,
} from "./process.mjs";
import {
  assertClosedObject,
  canonicalJsonBuffer,
  parseBoundedJson,
  sha256,
} from "./strict-json.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const AIRGAP_TIMEOUT_MS = 10 * 60_000;
const COSIGN_SOURCE_COMMIT = "11926fa5bbbbde47e88fc006b625a17769b743b2";
const FAILURE_NETWORK = /(?:tuf|rekor|fulcio|timestamp|network|connection|dial tcp|lookup|certificate transparency)/iu;
const FAILURE_SIGNATURE = /(?:invalid signature|signature verification failed|verification failure|unable to verify|error verifying signature)/iu;
const FAILURE_MISSING_KEY = /(?:no such file|cannot find|failed to (?:read|load).*key|open .*missing|opening.*key)/iu;

const fail = (code) => {
  throw policyError(code);
};
const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export function parseCosignArguments(argv) {
  const names = ["--binary", "--binary-sha256", "--source", "--source-sha256", "--workspace", "--output"];
  if (!Array.isArray(argv) || argv.length !== names.length * 2) fail("cosign_arguments_refused");
  const output = Object.create(null);
  for (let index = 0; index < names.length; index += 1) {
    if (argv[index * 2] !== names[index]) fail("cosign_arguments_refused");
    const value = argv[index * 2 + 1];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail("cosign_arguments_refused");
    output[names[index].slice(2).replaceAll("-", "_")] = value;
  }
  if (![output.binary, output.source, output.workspace, output.output].every(path.isAbsolute) ||
      !HASH.test(output.binary_sha256) || !HASH.test(output.source_sha256)) fail("cosign_arguments_refused");
  return Object.freeze(output);
}

export function assertCosignRuntime(platform = process.platform, environment = process.env) {
  if (platform !== "linux" || environment.GITHUB_ACTIONS !== "true") fail("cosign_runtime_refused");
}

export function validateNetworkNamespaceSnapshot(interfaces, ipv4Routes, ipv6Routes) {
  if (!Array.isArray(interfaces) || interfaces.length !== 1 || interfaces[0] !== "lo") {
    fail("cosign_network_namespace_invalid");
  }
  const ipv4Lines = String(ipv4Routes).trim().split(/\r?\n/u).slice(1).filter(Boolean);
  const ipv6Lines = String(ipv6Routes).trim().split(/\r?\n/u).filter(Boolean);
  if (ipv4Lines.some((line) => line.trim().split(/\s+/u)[0] !== "lo") ||
      ipv6Lines.some((line) => line.trim().split(/\s+/u).at(-1) !== "lo")) {
    fail("cosign_network_namespace_invalid");
  }
  return Object.freeze({
    interfaces: ["lo"],
    ipv4NonLoopbackRoutes: 0,
    ipv6NonLoopbackRoutes: 0,
    status: "isolated",
  });
}

export function classifyCosignFailure(kind, bytes) {
  const text = Buffer.from(bytes).toString("utf8");
  if (text.length > 1024 * 1024 || FAILURE_NETWORK.test(text)) fail("cosign_negative_wrong_reason");
  if ((kind === "wrong_key" || kind === "tampered_subject") && FAILURE_SIGNATURE.test(text)) {
    return "signature_invalid";
  }
  if (kind === "missing_key" && FAILURE_MISSING_KEY.test(text)) return "key_missing";
  fail("cosign_negative_wrong_reason");
}

export function validateSignatureLedger(bytes, expected) {
  const ledger = parseBoundedJson(bytes, { maxBytes: 4096, maxDepth: 8, maxMembers: 32 });
  assertClosedObject(ledger, ["entries", "schemaVersion"]);
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length !== 1) {
    fail("cosign_ledger_invalid");
  }
  const entry = ledger.entries[0];
  assertClosedObject(entry, ["bundleSha256", "keySha256", "sourceSha256", "status", "subjectSha256"]);
  for (const name of ["bundleSha256", "keySha256", "sourceSha256", "subjectSha256"]) {
    if (!HASH.test(entry[name]) || entry[name] !== expected[name]) fail("cosign_ledger_identity_mismatch");
  }
  if (entry.status === "revoked") fail("cosign_ledger_revoked");
  if (entry.status !== "active") fail("cosign_ledger_invalid");
  if (!Buffer.from(bytes).equals(canonicalJsonBuffer(ledger))) fail("cosign_ledger_noncanonical");
  return Object.freeze({ status: "active" });
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function validateInputFile(file, expectedHash, maximum, invalidCode, mismatchCode) {
  const info = await lstat(file).catch(() => fail(invalidCode));
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximum || await realpath(file) !== file) {
    fail(invalidCode);
  }
  if (await hashFile(file) !== expectedHash) fail(mismatchCode);
  return Object.freeze({ bytes: info.size, sha256: expectedHash });
}

async function validateWorkspace(workspace, output, runnerTemp) {
  if (typeof runnerTemp !== "string" || !path.isAbsolute(runnerTemp)) fail("cosign_workspace_refused");
  const [workspaceReal, runnerReal] = await Promise.all([realpath(workspace), realpath(runnerTemp)]);
  const info = await lstat(workspaceReal);
  if (!info.isDirectory() || info.isSymbolicLink() || !isInside(runnerReal, workspaceReal) ||
      (await readdir(workspaceReal)).length !== 0) fail("cosign_workspace_refused");
  if (path.dirname(output) !== workspaceReal || !/^cosign-airgap-[a-z0-9-]+\.json$/u.test(path.basename(output))) {
    fail("cosign_output_refused");
  }
  await lstat(output).then(() => fail("cosign_output_refused"), (error) => {
    if (error?.code !== "ENOENT") fail("cosign_output_refused");
  });
  return workspaceReal;
}

async function validateEvidenceFile(file) {
  const info = await lstat(file).catch(() => fail("cosign_evidence_missing"));
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_EVIDENCE_BYTES ||
      await realpath(file) !== file) fail("cosign_evidence_invalid");
  return readFile(file);
}

function runCosign(binary, args, cwd) {
  const environment = cleanEnvironment({ HOME: cwd, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin:/bin", TMPDIR: cwd,
    ...(["generate-key-pair", "sign-blob"].includes(args[0]) ? { COSIGN_PASSWORD: process.env.COSIGN_PASSWORD } : {}) });
  const result = spawnSync(binary, args, {
    cwd,
    encoding: null,
    env: environment,
    input: Buffer.alloc(0),
    maxBuffer: 1024 * 1024,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) fail(result.error.code === "ETIMEDOUT" ? "cosign_command_timeout" : "cosign_command_failed");
  return Object.freeze({
    code: result.status,
    output: Buffer.concat([Buffer.from(result.stdout ?? []), Buffer.from(result.stderr ?? [])]),
  });
}

function requireSuccess(result) {
  if (result.code !== 0) fail("cosign_command_failed");
}

function requireExpectedFailure(result, kind) {
  if (result.code === 0) fail("cosign_negative_unexpected_success");
  return classifyCosignFailure(kind, result.output);
}

async function writeExclusive(file, bytes, mode = 0o600) {
  const handle = await open(file, "wx", mode);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

async function runNamespaceSuite(argv) {
  if (process.platform !== "linux") fail("cosign_runtime_refused");
  if (argv.length !== 6 || !argv.slice(0, 4).every((value) => typeof value === "string" && path.isAbsolute(value)) ||
      !HASH.test(argv[4]) || !/^net:\[[0-9]+\]$/u.test(argv[5])) {
    fail("cosign_namespace_arguments_refused");
  }
  const [binary, directory, proofFile, resultFile, binarySha256, parentNamespace] = argv;
  const [directoryReal, binaryReal] = await Promise.all([realpath(directory), realpath(binary)]);
  if (directoryReal !== directory || binaryReal !== binary || !isInside(directory, proofFile) ||
      !isInside(directory, resultFile) || process.cwd() !== directory) fail("cosign_namespace_arguments_refused");
  await validateInputFile(binary, binarySha256, MAX_BINARY_BYTES, "cosign_binary_invalid", "cosign_binary_identity_mismatch");
  const namespace = await readlink("/proc/self/ns/net");
  if (namespace === parentNamespace || !/^net:\[[0-9]+\]$/u.test(namespace)) fail("cosign_network_namespace_unchanged");
  // /sys may retain the parent's sysfs mount. /proc/net is namespace scoped.
  const interfaces = (await readFile("/proc/net/dev", "utf8")).trim().split(/\r?\n/u).slice(2)
    .map((line) => line.trim().split(":")[0]).sort();
  const snapshot = validateNetworkNamespaceSnapshot(
    interfaces,
    await readFile("/proc/net/route", "utf8"),
    await readFile("/proc/net/ipv6_route", "utf8"),
  );
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "192.0.2.1", port: 9 });
    socket.setTimeout(1000);
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ENETUNREACH") resolve();
      else reject(policyError("cosign_network_probe_invalid"));
    });
    socket.once("connect", () => { socket.destroy(); reject(policyError("cosign_network_probe_connected")); });
    socket.once("timeout", () => { socket.destroy(); reject(policyError("cosign_network_probe_timeout")); });
  });
  await writeExclusive(proofFile, canonicalJsonBuffer({ ...snapshot, namespaceSha256: sha256(Buffer.from(namespace)),
    parentNamespaceSha256: sha256(Buffer.from(parentNamespace)), probe: "ENETUNREACH" }));
  const version = runCosign(binary, ["version", "--json"], directory);
  requireSuccess(version);
  if (!/"gitVersion"\s*:\s*"3\.1\.3-autoworld\.1"/u.test(version.output.toString("utf8"))) fail("cosign_version_identity_mismatch");

  const keyA = path.join(directory, "key-a");
  const keyB = path.join(directory, "key-b");
  const subject = path.join(directory, "subject.json");
  const tampered = path.join(directory, "subject-tampered.json");
  const bundle = path.join(directory, "bundle.sigstore.json");
  requireSuccess(runCosign(binary, ["generate-key-pair", "--output-key-prefix", keyA], directory));
  requireSuccess(runCosign(binary, ["generate-key-pair", "--output-key-prefix", keyB], directory));
  requireSuccess(runCosign(binary, [
    "sign-blob", "--key", `${keyA}.key`, "--bundle", bundle,
    "--use-signing-config=false", "--tlog-upload=false", subject,
  ], directory));
  requireSuccess(runCosign(binary, [
    "verify-blob", "--key", `${keyA}.pub`, "--bundle", bundle,
    "--insecure-ignore-tlog", subject,
  ], directory));
  const wrongKey = requireExpectedFailure(runCosign(binary, [
    "verify-blob", "--key", `${keyB}.pub`, "--bundle", bundle,
    "--insecure-ignore-tlog", subject,
  ], directory), "wrong_key");
  const tamper = requireExpectedFailure(runCosign(binary, [
    "verify-blob", "--key", `${keyA}.pub`, "--bundle", bundle,
    "--insecure-ignore-tlog", tampered,
  ], directory), "tampered_subject");
  const missingKey = requireExpectedFailure(runCosign(binary, [
    "verify-blob", "--key", path.join(directory, "missing.pub"), "--bundle", bundle,
    "--insecure-ignore-tlog", subject,
  ], directory), "missing_key");

  const publicA = await validateEvidenceFile(`${keyA}.pub`);
  const publicB = await validateEvidenceFile(`${keyB}.pub`);
  const bundleBytes = await validateEvidenceFile(bundle);
  const namespaceResult = canonicalJsonBuffer({
    bundleSha256: sha256(bundleBytes),
    missingKey,
    primaryKeySha256: sha256(publicA),
    secondaryKeySha256: sha256(publicB),
    tamper,
    valid: "signature_valid",
    wrongKey,
  });
  await writeExclusive(resultFile, namespaceResult);
}

async function loadNamespaceResult(file) {
  const bytes = await validateEvidenceFile(file);
  const value = parseBoundedJson(bytes, { maxBytes: 4096, maxDepth: 4, maxMembers: 16 });
  assertClosedObject(value, [
    "bundleSha256", "missingKey", "primaryKeySha256", "secondaryKeySha256", "tamper", "valid", "wrongKey",
  ]);
  if (![value.bundleSha256, value.primaryKeySha256, value.secondaryKeySha256].every((item) => HASH.test(item)) ||
      value.primaryKeySha256 === value.secondaryKeySha256 || value.valid !== "signature_valid" ||
      value.wrongKey !== "signature_invalid" || value.tamper !== "signature_invalid" ||
      value.missingKey !== "key_missing" || !bytes.equals(canonicalJsonBuffer(value))) {
    fail("cosign_namespace_result_invalid");
  }
  return value;
}

function makeLedger(result, sourceSha256, subjectSha256, status) {
  return canonicalJsonBuffer({
    entries: [{
      bundleSha256: result.bundleSha256,
      keySha256: result.primaryKeySha256,
      sourceSha256,
      status,
      subjectSha256,
    }],
    schemaVersion: 1,
  });
}

export async function runCosignAirgap(args, environment = process.env) {
  assertCosignRuntime(process.platform, environment);
  const started = Date.now();
  const workspace = await validateWorkspace(args.workspace, args.output, environment.RUNNER_TEMP);
  await Promise.all([
    validateInputFile(args.binary, args.binary_sha256, MAX_BINARY_BYTES, "cosign_binary_invalid", "cosign_binary_identity_mismatch"),
    validateInputFile(args.source, args.source_sha256, MAX_SOURCE_BYTES, "cosign_source_invalid", "cosign_source_identity_mismatch"),
  ]);
  const unshare = "/usr/bin/unshare";
  const unshareInfo = await lstat(unshare).catch(() => fail("cosign_unshare_unavailable"));
  if (!unshareInfo.isFile() || unshareInfo.isSymbolicLink() || await realpath(unshare) !== unshare) {
    fail("cosign_unshare_unavailable");
  }
  const owned = await createOwnedDirectory(workspace);
  let output;
  try {
    const subject = canonicalJsonBuffer({
      binarySha256: args.binary_sha256,
      schemaVersion: 1,
      sourceCommit: COSIGN_SOURCE_COMMIT,
      sourceSha256: args.source_sha256,
    });
    const subjectSha256 = sha256(subject);
    await writeExclusive(path.join(owned.path, "subject.json"), subject);
    await writeExclusive(path.join(owned.path, "subject-tampered.json"), canonicalJsonBuffer({
      binarySha256: "0".repeat(64),
      schemaVersion: 1,
      sourceCommit: COSIGN_SOURCE_COMMIT,
      sourceSha256: args.source_sha256,
    }));
    const proofFile = path.join(owned.path, "network-proof.json");
    const resultFile = path.join(owned.path, "namespace-result.json");
    const password = `auto-world-disposable-${randomBytes(32).toString("hex")}`;
    await runCommand(unshare, [
      "--user", "--map-root-user", "--net", "--fork",
      process.execPath, path.resolve(fileURLToPath(import.meta.url)),
      "--namespace-suite", args.binary, owned.path, proofFile, resultFile, args.binary_sha256,
      await readlink("/proc/self/ns/net"),
    ], {
      cwd: owned.path,
      env: {
        COSIGN_PASSWORD: password,
        HOME: owned.path,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
        TMPDIR: owned.path,
      },
      maxOutputBytes: 1024 * 1024,
      timeoutMs: AIRGAP_TIMEOUT_MS,
    }).catch((error) => {
      if (error?.code === "command_failed") fail("cosign_unshare_or_suite_failed");
      throw error;
    });
    const proof = parseBoundedJson(await validateEvidenceFile(proofFile), { maxBytes: 4096, maxDepth: 4, maxMembers: 16 });
    assertClosedObject(proof, ["interfaces", "ipv4NonLoopbackRoutes", "ipv6NonLoopbackRoutes", "status", "namespaceSha256", "parentNamespaceSha256", "probe"]);
    if (proof.status !== "isolated" || proof.interfaces?.length !== 1 || proof.interfaces[0] !== "lo" ||
        proof.ipv4NonLoopbackRoutes !== 0 || proof.ipv6NonLoopbackRoutes !== 0 ||
        !HASH.test(proof.namespaceSha256) || !HASH.test(proof.parentNamespaceSha256) ||
        proof.namespaceSha256 === proof.parentNamespaceSha256 || proof.probe !== "ENETUNREACH") fail("cosign_network_proof_invalid");
    const namespace = await loadNamespaceResult(resultFile);
    const publicKey = await validateEvidenceFile(path.join(owned.path, "key-a.pub"));
    const publicBundle = await validateEvidenceFile(path.join(owned.path, "bundle.sigstore.json"));
    if (sha256(publicKey) !== namespace.primaryKeySha256 || sha256(publicBundle) !== namespace.bundleSha256) fail("cosign_public_evidence_mismatch");
    const expected = {
      bundleSha256: namespace.bundleSha256,
      keySha256: namespace.primaryKeySha256,
      sourceSha256: args.source_sha256,
      subjectSha256,
    };
    const activeLedger = makeLedger(namespace, args.source_sha256, subjectSha256, "active");
    validateSignatureLedger(activeLedger, expected);
    const revokedLedger = Buffer.from(makeLedger(namespace, args.source_sha256, subjectSha256, "revoked"));
    let revokedReason;
    try {
      validateSignatureLedger(revokedLedger, expected);
    } catch (error) {
      if (error?.code !== "cosign_ledger_revoked") throw error;
      revokedReason = error.code;
    }
    if (revokedReason !== "cosign_ledger_revoked") fail("cosign_revocation_unexpected_success");
    if (Date.now() - started > AIRGAP_TIMEOUT_MS) fail("cosign_airgap_timeout");
    output = Object.freeze({
      binarySha256: args.binary_sha256,
      bundleSha256: namespace.bundleSha256,
      network: "isolated_namespace",
      networkProof: proof,
      primaryKeySha256: namespace.primaryKeySha256,
      publicKeyBase64: publicKey.toString("base64"),
      bundleBase64: publicBundle.toString("base64"),
      subjectBase64: subject.toString("base64"),
      revokedLedger: revokedReason,
      sourceCommit: COSIGN_SOURCE_COMMIT,
      sourceSha256: args.source_sha256,
      status: "passed",
      subjectSha256,
      tests: Object.freeze({
        missingKey: namespace.missingKey,
        tamper: namespace.tamper,
        valid: namespace.valid,
        wrongKey: namespace.wrongKey,
      }),
    });
  } finally {
    await removeOwnedDirectory(owned);
  }
  await writeExclusive(args.output, Buffer.concat([canonicalJsonBuffer(output), Buffer.from("\n")]));
  return output;
}

async function main() {
  try {
    if (process.argv[2] === "--namespace-suite") {
      await runNamespaceSuite(process.argv.slice(3));
      return;
    }
    await runCosignAirgap(parseCosignArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${typeof error?.code === "string" ? error.code : "cosign_airgap_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
