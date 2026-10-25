import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ATTESTATION } from "./candidate-attestation.mjs";
import {
  CUSTOM_TRUSTED_ROOT,
  RECONSTRUCTED_SUBJECT_ARTIFACT,
  classifyVerification,
  runGh,
  verifyCandidateAttestationPair,
} from "./verify-candidate-attestation.mjs";

export const OUTPUT_VERIFIER_BINARY = Object.freeze({
  version: "2.102.0",
  releasedAt: "2026-09-30",
  bytes: 42_086_560,
  sha256: "7469124f706944133d6a169691dd1c6c3511b12e85878d255e044e2948df4c9b",
  archive: Object.freeze({ bytes: 15_319_960,
    sha256: "bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386" }),
  checksums: Object.freeze({ bytes: 1_971,
    sha256: "afe49e9affa232faa8212aed035417166f6ade9b9470acb53d4dbd28c0504e8d" }),
});

export const OUTPUT_CONTROL_POLICY = Object.freeze({
  runId: "36858133579",
  sourceSha: "64778982b86faf17cb4ede9fd8027869049f6602",
  signerSha: "64778982b86faf17cb4ede9fd8027869049f6602",
  actorUid: 1000,
  actorGid: 1000,
  provisioningReceipt: Object.freeze({ name: "provisioning-receipt.json", bytes: 2_983,
    sha256: "3aeaebc2cd06ce506b057072bd592bf571fcf91ce19b61d90776367f72a068fe" }),
  trustedRoot: CUSTOM_TRUSTED_ROOT,
  trustedRootCollectionReceipt: Object.freeze({ name: "collection-receipt.json", bytes: 6_504,
    sha256: "7c785ccd596fbc5524b9b6498f2a705d1950f16fd4c6630255db0e586196a702" }),
  trustedRootCollector: Object.freeze({ name: "collector.py", bytes: 11_719,
    sha256: "1ed0c565e1d0ccbb1cb9f61b44630a8c261fc6f59a8ec844f53fb5ec59e94add" }),
  inputs: Object.freeze({
    accessReceipt: Object.freeze({ name: "access-receipt.json", bytes: 5_457,
      sha256: "84f81230c30b9cbca1a4a42ef27e91c3d77610318987b3f499affda43f0d1772" }),
    predicate: Object.freeze({ name: "predicate.json", bytes: 9_949,
      sha256: "d724d03784b62b5fface2f0241e18b203fbbc5702f23bc7de8296f5ffa0d301c" }),
    preSignReceipt: Object.freeze({ name: "pre-sign-receipt.json", bytes: 837,
      sha256: "983ebb489bdae61bef59ac3f389084c528fb20beecf5edd8ce4ecb46b078fe3e" }),
    bundle: Object.freeze({ name: "bundle.json", bytes: 23_607,
      sha256: "a09432b7020435699d911da1082537290880eec2db865b4d21cdf09dc0b969d1" }),
    verificationReceipt: Object.freeze({ name: "verification-receipt.json", bytes: 37_813,
      sha256: "a647d3ddeeb77292db9e3a35efe7a6073306d41f686bedcb1c6a68c8285ec7ce" }),
  }),
});

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/u;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const native = (value) => ({ dev: String(value.dev), ino: String(value.ino), uid: Number(value.uid),
  gid: Number(value.gid), mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink),
  size: Number(value.size), mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) });
const same = (left, right) => isDeepStrictEqual(native(left), native(right));
const fail = (reason = "postgres_candidate_attestation_output_control_invalid") => { throw new Error(reason); };

export const FIXED_OUTPUT_CONTROL_CONTEXT = Object.freeze({
  root: "/home/autoworld/postgres-candidate-output-controls-36858133579-v1",
  inputDirectory: "/home/autoworld/postgres-candidate-attestation-36858133579-actual/files",
  bundle: "/home/autoworld/postgres-candidate-attestation-36858133579-actual/files/bundle.json",
  predicate: "/home/autoworld/postgres-candidate-attestation-36858133579-actual/files/predicate.json",
  preSignReceipt: "/home/autoworld/postgres-candidate-attestation-36858133579-actual/files/pre-sign-receipt.json",
  accessReceipt: "/home/autoworld/postgres-candidate-attestation-36858133579-actual/files/access-receipt.json",
  verificationReceipt: "/home/autoworld/postgres-candidate-attestation-36858133579-actual/files/verification-receipt.json",
  artifactPath: "/home/autoworld/postgres-candidate-output-controls-36858133579-v1/inputs/subject-manifest.json",
  verifierBinary: "/home/autoworld/postgres-output-verifier-gh-2.102.0-20261006/gh",
  home: "/home/autoworld/postgres-candidate-output-controls-36858133579-v1/home",
  outputDirectory: "/home/autoworld/postgres-candidate-output-controls-36858133579-v1/outputs",
  provisioningReceipt: "/home/autoworld/postgres-candidate-output-controls-36858133579-v1/provisioning-receipt.json",
  trustedRootPath: "/home/autoworld/postgres-output-trusted-root-gh-2.102.0-20261006-v2/trusted_root.jsonl",
  trustedRootCollectionReceipt: "/home/autoworld/postgres-output-trusted-root-gh-2.102.0-20261006-v2/collection-receipt.json",
});

async function snapshot(file, expected, uid, mode) {
  if (typeof file !== "string" || !path.isAbsolute(file)) fail();
  let handle;
  try {
    const namedBefore = await lstat(file, { bigint: true });
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
      | (constants.O_NONBLOCK ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || !same(namedBefore, before) || Number(before.size) !== expected.bytes
      || (process.platform === "linux" && (before.uid !== BigInt(uid.uid)
        || before.gid !== BigInt(uid.gid) || (before.mode & 0o7777n) !== BigInt(mode)))) fail();
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const namedAfter = await lstat(file, { bigint: true });
    if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256
      || !same(before, after) || !same(before, namedAfter)) fail("postgres_candidate_attestation_output_control_input_changed");
    return { bytes, identity: native(before), sha256: expected.sha256 };
  } catch (error) {
    if (error?.message?.startsWith("postgres_candidate_attestation_output_control_")) throw error;
    fail();
  } finally { await handle?.close(); }
}

async function requirePrivateDirectory(directory, actor, names) {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory
    || (process.platform === "linux" && (info.uid !== BigInt(actor.uid) || info.gid !== BigInt(actor.gid)
      || (info.mode & 0o7777n) !== 0o700n))
    || (names && !isDeepStrictEqual((await readdir(directory)).sort(), [...names].sort()))) fail();
  return native(info);
}

async function requireSameDirectory(directory, actor, identity, names) {
  const current = await requirePrivateDirectory(directory, actor, names);
  if (!isDeepStrictEqual(current, identity)) fail("postgres_candidate_attestation_output_control_input_changed");
}

function inputDefinitions(context, policy) {
  return [
    [context.accessReceipt, policy.inputs.accessReceipt, 0o600],
    [context.predicate, policy.inputs.predicate, 0o600],
    [context.preSignReceipt, policy.inputs.preSignReceipt, 0o600],
    [context.bundle, policy.inputs.bundle, 0o600],
    [context.verificationReceipt, policy.inputs.verificationReceipt, 0o600],
    [context.artifactPath, policy.artifact ?? RECONSTRUCTED_SUBJECT_ARTIFACT, 0o600],
    [context.verifierBinary, policy.verifierBinary ?? OUTPUT_VERIFIER_BINARY, 0o700],
    [context.provisioningReceipt, policy.provisioningReceipt, 0o600],
    [context.trustedRootPath, policy.trustedRoot, 0o600],
    [context.trustedRootCollectionReceipt, policy.trustedRootCollectionReceipt, 0o600],
  ];
}

async function snapshots(context, policy) {
  return Promise.all(inputDefinitions(context, policy)
    .map(([file, expected, mode]) => snapshot(file, expected,
      { uid: policy.actorUid, gid: policy.actorGid }, mode)));
}

function requireUnchanged(before, after) {
  if (before.some((value, index) => value.sha256 !== after[index].sha256
    || !isDeepStrictEqual(value.identity, after[index].identity))) {
    fail("postgres_candidate_attestation_output_control_input_changed");
  }
}

function validateTrustedRootCollection(bytes, policy) {
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(); }
  const expectedToolFiles = [
    { file: "gh", bytes: OUTPUT_VERIFIER_BINARY.bytes, sha256: OUTPUT_VERIFIER_BINARY.sha256 },
    { file: "gh_2.102.0_linux_amd64.tar.gz", ...OUTPUT_VERIFIER_BINARY.archive },
    { file: "gh_2.102.0_checksums.txt", ...OUTPUT_VERIFIER_BINARY.checksums },
  ];
  if (value?.kind !== "OFFICIAL_GH_TRUSTED_ROOT_COLLECTION_V1" || value.state !== "COLLECTED"
    || value.source !== "OFFICIAL_GH_2_102_PUBLIC_TUF"
    || !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+\+00:00$/u.test(value.collectedAt ?? "")
    || !isDeepStrictEqual(value.args, ["attestation", "trusted-root", "--hostname", "github.com"])
    || value.tool?.version !== OUTPUT_VERIFIER_BINARY.version
    || !isDeepStrictEqual(value.tool.files, expectedToolFiles)
    || value.trustedRoot?.file !== "trusted_root.jsonl"
    || value.trustedRoot?.bytes !== policy.trustedRoot.bytes
    || value.trustedRoot?.sha256 !== policy.trustedRoot.sha256
    || !isDeepStrictEqual(value.process, { exitCode: 0, signal: null, stdoutEOF: true,
      stderrEOF: true, closed: true })
    || value.cacheCleanup !== "VERIFIED_EMPTY" || value.descriptorsClosed !== true
    || value.registryRead !== "NOT_ATTEMPTED" || value.signatureVerification !== "NOT_ATTEMPTED"
    || value.currentness !== "NOT_EVALUATED" || value.revocation !== "NOT_EVALUATED"
    || value.admission !== "NOT_AUTHORIZED") fail();
  return value;
}

function positiveMatches(result, captured) {
  return result?.state === "VERIFIED" && captured.length === 2
    && result.invocations?.length === 2
    && ["identity", "workflow"].every((mode, index) => {
      const processResult = captured[index]; const invocation = result.invocations[index];
      return invocation?.mode === mode && invocation.status === "VERIFIED" && invocation.exitCode === 0
        && processResult?.code === 0 && processResult.processError === false
        && processResult.signal === null && processResult.killed === false
        && processResult.processClosed === true && processResult.stdoutClosed === true
        && processResult.stderrClosed === true
        && typeof processResult.stdout === "string" && Buffer.byteLength(processResult.stdout) >= 2
        && Buffer.byteLength(processResult.stdout) <= MAX_STDOUT_BYTES
        && invocation.stdoutBytes === Buffer.byteLength(processResult.stdout)
        && invocation.stdoutSha256 === hash(Buffer.from(processResult.stdout));
    });
}

function outputVariants(stdout) {
  const bytes = Buffer.from(stdout);
  let last = bytes.length - 1;
  while (last >= 0 && /\s/u.test(String.fromCharCode(bytes[last]))) last -= 1;
  if (last < 1) fail();
  const truncated = bytes.subarray(0, last);
  const malformed = Buffer.from(bytes);
  let first = 0;
  while (first < malformed.length && /\s/u.test(String.fromCharCode(malformed[first]))) first += 1;
  if (malformed[first] !== 0x5b) fail();
  malformed[first] = 0x21;
  return { truncated, malformed };
}

export function classifyCapturedVerifierOutput(processResult) {
  if (!processResult || processResult.code !== 0 || processResult.processError !== false
    || typeof processResult.stdout !== "string" || typeof processResult.stderr !== "string"
    || Buffer.byteLength(processResult.stdout) < 2
    || Buffer.byteLength(processResult.stdout) > MAX_STDOUT_BYTES) fail();
  const variants = outputVariants(processResult.stdout);
  const missing = { ...processResult }; delete missing.stdout;
  const values = {
    missing: classifyVerification(missing),
    truncated: classifyVerification({ ...processResult, stdout: variants.truncated.toString("utf8") }),
    malformed: classifyVerification({ ...processResult, stdout: variants.malformed.toString("utf8") }),
  };
  if (!isDeepStrictEqual(Object.fromEntries(Object.entries(values).map(([name, value]) =>
    [name, [value.status, value.code]])), {
    missing: ["ERROR", "cli_process_error"], truncated: ["ERROR", "cli_result_invalid"],
    malformed: ["ERROR", "cli_result_invalid"],
  })) fail();
  return Object.fromEntries(Object.entries(values).map(([name, result]) => [name, {
    proof: "ERROR_NOT_REJECTION", result,
    bytes: name === "missing" ? 0 : variants[name].length,
    sha256: hash(name === "missing" ? Buffer.alloc(0) : variants[name]),
  }]));
}

async function retainOutput(directory, basename, stdout, actor) {
  const bytes = Buffer.from(stdout);
  if (bytes.length < 2 || bytes.length > MAX_STDOUT_BYTES || path.basename(basename) !== basename) fail();
  const file = path.join(directory, basename); let handle;
  try {
    handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(bytes); await handle.sync();
    if (process.platform === "linux") await handle.chmod(0o600);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || Number(before.size) !== bytes.length
      || (process.platform === "linux" && (before.uid !== BigInt(actor.uid)
        || before.gid !== BigInt(actor.gid) || (before.mode & 0o7777n) !== 0o600n))) fail();
    const readback = Buffer.alloc(bytes.length); let offset = 0;
    while (offset < readback.length) {
      const { bytesRead } = await handle.read(readback, offset, readback.length - offset, offset);
      if (bytesRead < 1) fail(); offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, readback.length)).bytesRead !== 0) fail();
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (!readback.equals(bytes) || !same(before, after) || !same(before, named)) fail();
    return { name: basename, bytes: bytes.length, sha256: hash(bytes), identity: native(after) };
  } finally { await handle?.close(); }
}

async function syncDirectory(directory, actor, names) {
  const before = await requirePrivateDirectory(directory, actor, names); let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY
      | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const heldBefore = await handle.stat({ bigint: true });
    if (!isDeepStrictEqual(native(heldBefore), before)) fail();
    await handle.sync();
    const heldAfter = await handle.stat({ bigint: true });
    const namedAfter = await lstat(directory, { bigint: true });
    if (!same(heldBefore, heldAfter) || !same(heldBefore, namedAfter)) fail();
  } finally { await handle?.close(); }
}

async function execute(context, policy, recipeRevision, dependencies) {
  if (process.platform !== "linux" || process.getuid() !== policy.actorUid
    || process.getgid() !== policy.actorGid || !SHA.test(recipeRevision)) fail();
  const actor = { uid: policy.actorUid, gid: policy.actorGid };
  await requirePrivateDirectory(context.root, actor, ["home", "inputs", "provisioning-receipt.json"]);
  await requirePrivateDirectory(path.dirname(context.artifactPath), actor, [path.basename(context.artifactPath)]);
  await requirePrivateDirectory(context.home, actor);
  const initial = await snapshots(context, policy);
  const expectedPredicate = JSON.parse(initial[1].bytes.toString("utf8"));
  const trustedRootCollection = validateTrustedRootCollection(initial.at(-1).bytes, policy);
  await mkdir(context.outputDirectory, { mode: 0o700 });
  const guardedDirectories = await Promise.all([
    [context.root, ["home", "inputs", "outputs", "provisioning-receipt.json"]],
    [path.dirname(context.accessReceipt)], [path.dirname(context.artifactPath), [path.basename(context.artifactPath)]],
    [path.dirname(context.verifierBinary)], [context.home, []],
    [path.dirname(context.trustedRootPath)],
  ].map(async ([directory, names]) => ({ directory, names,
    identity: await requirePrivateDirectory(directory, actor, names) })));
  const guardDirectories = async () => Promise.all(guardedDirectories.map((entry) =>
    requireSameDirectory(entry.directory, actor, entry.identity, entry.names)));
  const created = [];
  try {
    const pairOptions = { bundle: context.bundle, predicate: context.predicate,
      preSignReceipt: context.preSignReceipt, expectedPredicate,
      preSignExpected: { runId: policy.runId, recipeRevision: policy.sourceSha },
      sourceSha: policy.sourceSha, signerSha: policy.signerSha,
      artifactPath: context.artifactPath, artifactExpected: RECONSTRUCTED_SUBJECT_ARTIFACT,
      trustedRootPath: context.trustedRootPath, trustedRootExpected: CUSTOM_TRUSTED_ROOT };
    const captured = [];
    const executeCli = async (args) => {
      await guardDirectories();
      const currentBefore = await snapshots(context, policy); requireUnchanged(initial, currentBefore);
      const result = await dependencies.run(args, context.verifierBinary, { home: context.home });
      let currentAfter;
      try { currentAfter = await snapshots(context, policy); }
      catch { fail("postgres_candidate_attestation_output_control_input_changed"); }
      requireUnchanged(initial, currentAfter);
      await guardDirectories();
      captured.push(result); return result;
    };
    const before = await dependencies.verifyPair(pairOptions, executeCli);
    if (!positiveMatches(before, captured)) fail();
    const retained = [];
    for (const [index, mode] of ["identity", "workflow"].entries()) {
      const value = await retainOutput(context.outputDirectory, `positive-before-${mode}.stdout.json`,
        captured[index].stdout, actor); created.push(value); retained.push(value);
    }
    const controls = Object.fromEntries(["identity", "workflow"].map((mode, index) =>
      [mode, { source: { name: retained[index].name, bytes: retained[index].bytes,
        sha256: retained[index].sha256 }, controls: classifyCapturedVerifierOutput(captured[index]) }]));
    captured.length = 0;
    const after = await dependencies.verifyPair(pairOptions, executeCli);
    if (!positiveMatches(after, captured)
      || before.bundleSha256 !== after.bundleSha256 || before.predicateSha256 !== after.predicateSha256
      || before.preSignReceiptSha256 !== after.preSignReceiptSha256) fail();
    for (const [index, mode] of ["identity", "workflow"].entries()) {
      const value = await retainOutput(context.outputDirectory, `positive-after-${mode}.stdout.json`,
        captured[index].stdout, actor); created.push(value); retained.push(value);
    }
    const final = await snapshots(context, policy); requireUnchanged(initial, final); await guardDirectories();
    await syncDirectory(context.outputDirectory, actor, retained.map((value) => value.name));
    return {
      kind: "POSTGRES_CANDIDATE_ATTESTATION_OUTPUT_CONTROLS_V1", state: "VERIFIED",
      authority: "LOCAL_SUPPLEMENTAL_VERIFIER_OUTPUT_CONTROL",
      recipeRevision, recipeAuthority: "EXTERNALLY_REVIEWED_CALLER_BINDING",
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
      runtimePermission: "NOT_GRANTED", currentness: "NOT_EVALUATED", archiveClosure: "NOT_ESTABLISHED",
      supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
      subject: `${ATTESTATION.subjectName}@${ATTESTATION.subjectDigest}`,
      sourceSha: policy.sourceSha, signerSha: policy.signerSha,
      artifact: { origin: RECONSTRUCTED_SUBJECT_ARTIFACT.origin,
        name: path.basename(context.artifactPath), bytes: RECONSTRUCTED_SUBJECT_ARTIFACT.bytes,
        sha256: RECONSTRUCTED_SUBJECT_ARTIFACT.sha256, registryRead: "NOT_ATTEMPTED" },
      tool: { version: OUTPUT_VERIFIER_BINARY.version, releasedAt: OUTPUT_VERIFIER_BINARY.releasedAt,
        bytes: OUTPUT_VERIFIER_BINARY.bytes, sha256: OUTPUT_VERIFIER_BINARY.sha256,
        archive: OUTPUT_VERIFIER_BINARY.archive, checksums: OUTPUT_VERIFIER_BINARY.checksums,
        authority: "EXTERNALLY_REVIEWED_PROVISIONING_RECEIPT_BINDING" },
      provisioningReceipt: { name: policy.provisioningReceipt.name,
        bytes: policy.provisioningReceipt.bytes, sha256: policy.provisioningReceipt.sha256,
        authority: "EXTERNALLY_REVIEWED_CALLER_BINDING" },
      trustedRoot: { name: path.basename(context.trustedRootPath), bytes: policy.trustedRoot.bytes,
        sha256: policy.trustedRoot.sha256, collection: {
          name: policy.trustedRootCollectionReceipt.name, bytes: policy.trustedRootCollectionReceipt.bytes,
          sha256: policy.trustedRootCollectionReceipt.sha256,
          collectedAt: trustedRootCollection.collectedAt, source: trustedRootCollection.source,
          args: trustedRootCollection.args, controller: policy.trustedRootCollector,
          authority: "EXTERNALLY_REVIEWED_PUBLIC_TUF_COLLECTION" },
        currentness: "NOT_EVALUATED", revocation: "NOT_EVALUATED" },
      inputs: Object.fromEntries(Object.entries(policy.inputs).map(([name, value]) =>
        [name, { name: value.name, bytes: value.bytes, sha256: value.sha256 }])),
      positiveControls: { before, after }, outputControls: controls,
      retainedOutputs: retained.map((value) => ({ name: value.name, bytes: value.bytes,
        sha256: value.sha256 })),
      sourceUnchanged: true, descriptorsClosed: true,
    };
  } catch (error) {
    let preservedOutputNames = null;
    try { preservedOutputNames = (await readdir(context.outputDirectory)).sort(); } catch { /* no owned output path */ }
    if (error && typeof error === "object") {
      try { Object.defineProperty(error, "failedContext", { value: {
        state: "FAILED", acknowledgement: "NOT_PUBLISHED", cleanup: "NOT_ATTEMPTED",
        evidencePreservation: "PRESERVED_FOR_REVIEW", preservedOutputNames,
        retainedOutputs: created.map((value) => ({ name: value.name, bytes: value.bytes, sha256: value.sha256 })),
      } }); } catch { /* preserve the original fail-closed error */ }
    }
    throw error;
  }
}

export async function runCandidateAttestationOutputControls(recipeRevision) {
  return execute(FIXED_OUTPUT_CONTROL_CONTEXT, OUTPUT_CONTROL_POLICY, recipeRevision,
    { run: runGh, verifyPair: verifyCandidateAttestationPair });
}

export async function TEST_ONLY_runCandidateAttestationOutputControls(context, policy, recipeRevision,
  dependencies = {}) {
  return execute(context, policy, recipeRevision,
    { run: dependencies.run ?? runGh, verifyPair: dependencies.verifyPair ?? verifyCandidateAttestationPair });
}
