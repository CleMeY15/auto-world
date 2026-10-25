import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FIXED_OUTPUT_CONTROL_CONTEXT,
  OUTPUT_CONTROL_POLICY,
  OUTPUT_VERIFIER_BINARY,
  classifyCapturedVerifierOutput,
  TEST_ONLY_runCandidateAttestationOutputControls,
} from "../scripts/postgres-image/verify-candidate-output-controls.mjs";

const linux = process.platform === "linux" && typeof process.getuid === "function";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pin = (name, bytes) => ({ name, bytes: bytes.length, sha256: hash(bytes) });
const positive = (stdout) => ({ state: "VERIFIED", bundleSha256: "1", predicateSha256: "2",
  preSignReceiptSha256: "3", invocations: ["identity", "workflow"].map((mode) => ({ mode,
    status: "VERIFIED", exitCode: 0, stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: hash(Buffer.from(stdout)) })) });
const completedProcess = (stdout, durationMs = 1) => ({ code: 0, processError: false, signal: null,
  killed: false, processClosed: true, stdoutClosed: true, stderrClosed: true,
  stdout, stderr: "", durationMs });

test("fixed supplemental authority is closed over the accepted run, five files and patched verifier", () => {
  assert.equal(OUTPUT_CONTROL_POLICY.runId, "36858133579");
  assert.equal(OUTPUT_CONTROL_POLICY.sourceSha, "64778982b86faf17cb4ede9fd8027869049f6602");
  assert.deepEqual(Object.keys(OUTPUT_CONTROL_POLICY.inputs),
    ["accessReceipt", "predicate", "preSignReceipt", "bundle", "verificationReceipt"]);
  assert.deepEqual([OUTPUT_VERIFIER_BINARY.version, OUTPUT_VERIFIER_BINARY.bytes,
    OUTPUT_VERIFIER_BINARY.sha256], ["2.102.0", 42_086_560,
    "7469124f706944133d6a169691dd1c6c3511b12e85878d255e044e2948df4c9b"]);
  assert.equal(FIXED_OUTPUT_CONTROL_CONTEXT.outputDirectory.endsWith("/outputs"), true);
  assert.deepEqual(OUTPUT_CONTROL_POLICY.trustedRoot, { bytes: 34_634,
    sha256: "65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c" });
});

test("each captured successful stdout yields missing, structural truncation and malformed errors", () => {
  const stdout = `${JSON.stringify([{ attestation: {}, verificationResult: { signature: {
    certificate: {} }, statement: {} } }])}\n`;
  const controls = classifyCapturedVerifierOutput({ ...completedProcess(stdout, 37),
    stderr: "actual empty diagnostic", actualMetadata: "preserved-by-transform" });
  assert.deepEqual(Object.fromEntries(Object.entries(controls).map(([name, value]) =>
    [name, [value.proof, value.result.status, value.result.code]])), {
    missing: ["ERROR_NOT_REJECTION", "ERROR", "cli_process_error"],
    truncated: ["ERROR_NOT_REJECTION", "ERROR", "cli_result_invalid"],
    malformed: ["ERROR_NOT_REJECTION", "ERROR", "cli_result_invalid"],
  });
  assert.equal(controls.truncated.bytes, Buffer.byteLength(stdout) - 2);
  assert.notEqual(controls.malformed.sha256, hash(Buffer.from(stdout)));
});

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), "aw-postgres-output-controls-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "supplement"); const actual = path.join(base, "actual");
  const trusted = path.join(base, "trusted");
  const inputs = path.join(root, "inputs");
  const home = path.join(root, "home");
  await Promise.all([mkdir(actual, { mode: 0o700 }), mkdir(root, { mode: 0o700 }), mkdir(trusted, { mode: 0o700 })]);
  await Promise.all([mkdir(inputs, { mode: 0o700 }), mkdir(home, { mode: 0o700 })]);
  chmodSync(root, 0o700); chmodSync(inputs, 0o700);
  const values = { accessReceipt: Buffer.from("access"), predicate: Buffer.from("{}"),
    preSignReceipt: Buffer.from("presign"), bundle: Buffer.from("bundle"),
    verificationReceipt: Buffer.from("verification") };
  const names = { accessReceipt: "access-receipt.json", predicate: "predicate.json",
    preSignReceipt: "pre-sign-receipt.json", bundle: "bundle.json",
    verificationReceipt: "verification-receipt.json" };
  const context = { root, inputDirectory: actual, home, outputDirectory: path.join(root, "outputs"),
    artifactPath: path.join(inputs, "subject-manifest.json"), verifierBinary: path.join(base, "gh"),
    provisioningReceipt: path.join(root, "provisioning-receipt.json"),
    trustedRootPath: path.join(trusted, "trusted_root.jsonl"),
    trustedRootCollectionReceipt: path.join(trusted, "collection-receipt.json") };
  const toolFiles = [{ file: "gh", bytes: OUTPUT_VERIFIER_BINARY.bytes,
    sha256: OUTPUT_VERIFIER_BINARY.sha256 },
  { file: "gh_2.102.0_linux_amd64.tar.gz", ...OUTPUT_VERIFIER_BINARY.archive },
  { file: "gh_2.102.0_checksums.txt", ...OUTPUT_VERIFIER_BINARY.checksums }];
  const collection = Buffer.from(JSON.stringify({ kind: "OFFICIAL_GH_TRUSTED_ROOT_COLLECTION_V1",
    state: "COLLECTED", source: "OFFICIAL_GH_2_102_PUBLIC_TUF",
    collectedAt: "2026-10-06T12:03:05.502031+00:00",
    args: ["attestation", "trusted-root", "--hostname", "github.com"],
    tool: { version: OUTPUT_VERIFIER_BINARY.version, files: toolFiles },
    trustedRoot: { file: "trusted_root.jsonl", bytes: 12, sha256: hash(Buffer.from("trusted root")) },
    process: { exitCode: 0, signal: null, stdoutEOF: true, stderrEOF: true, closed: true },
    cacheCleanup: "VERIFIED_EMPTY", descriptorsClosed: true, registryRead: "NOT_ATTEMPTED",
    signatureVerification: "NOT_ATTEMPTED", currentness: "NOT_EVALUATED",
    revocation: "NOT_EVALUATED", admission: "NOT_AUTHORIZED" }));
  const policy = { runId: "1", sourceSha: "a".repeat(40), signerSha: "a".repeat(40),
    actorUid: process.getuid(), actorGid: process.getgid(), inputs: {},
    artifact: pin("subject-manifest.json", Buffer.from("manifest")),
    verifierBinary: pin("gh", Buffer.from("binary")), provisioningReceipt: pin("provisioning-receipt.json", Buffer.from("provision")) };
  policy.trustedRoot = pin("trusted_root.jsonl", Buffer.from("trusted root"));
  policy.trustedRootCollectionReceipt = pin("collection-receipt.json", collection);
  policy.trustedRootCollector = pin("collector.py", Buffer.from("collector"));
  for (const [key, bytes] of Object.entries(values)) {
    context[key] = path.join(actual, names[key]); policy.inputs[key] = pin(names[key], bytes);
    await writeFile(context[key], bytes, { mode: 0o600 });
  }
  await writeFile(context.artifactPath, "manifest", { mode: 0o600 });
  await writeFile(context.verifierBinary, "binary", { mode: 0o700 });
  await writeFile(context.provisioningReceipt, "provision", { mode: 0o600 });
  await writeFile(context.trustedRootPath, "trusted root", { mode: 0o600 });
  await writeFile(context.trustedRootCollectionReceipt, collection, { mode: 0o600 });
  return { context, policy };
}

test("supplement performs four calls, retains four private outputs and exposes six error controls",
  { skip: !linux }, async (t) => {
    const { context, policy } = await fixture(t); let call = 0;
    const stdout = `${JSON.stringify([{ call: 1 }])}\n`;
    const result = await TEST_ONLY_runCandidateAttestationOutputControls(context, policy, "b".repeat(40), {
      run: async () => completedProcess(stdout, ++call),
      verifyPair: async (_options, execute) => {
        await execute(["identity"]); await execute(["workflow"]);
        return positive(stdout);
      },
    });
    assert.equal(call, 4);
    assert.equal(result.retainedOutputs.length, 4);
    assert.equal(Object.values(result.outputControls).flatMap((value) => Object.values(value.controls)).length, 6);
    assert.equal(Object.values(result.outputControls).every((value) =>
      Object.values(value.controls).every((control) => control.proof === "ERROR_NOT_REJECTION"
        && control.result.status === "ERROR")), true);
    assert.deepEqual((await readdir(context.outputDirectory)).sort(), result.retainedOutputs.map((value) => value.name).sort());
    for (const output of result.retainedOutputs) assert.equal(hash(await readFile(path.join(context.outputDirectory, output.name))), output.sha256);
    assert.equal(result.descriptorsClosed, true);
    assert.equal(result.admission, "NOT_AUTHORIZED");
  });

test("a foreign output collision fails closed and is preserved", { skip: !linux }, async (t) => {
  const { context, policy } = await fixture(t);
  await mkdir(context.outputDirectory, { mode: 0o700 });
  const foreign = path.join(context.outputDirectory, "foreign"); await writeFile(foreign, "keep", { mode: 0o600 });
  await assert.rejects(TEST_ONLY_runCandidateAttestationOutputControls(context, policy, "b".repeat(40), {
    run: async () => ({ code: 0, processError: false, stdout: "[]", stderr: "", durationMs: 1 }),
    verifyPair: async () => ({ state: "VERIFIED" }),
  }));
  assert.equal(await readFile(foreign, "utf8"), "keep");
});

test("late foreign stdout collision preserves the earlier evidence and foreign output", { skip: !linux }, async (t) => {
  const { context, policy } = await fixture(t); let installed = false;
  const foreign = path.join(context.outputDirectory, "positive-before-workflow.stdout.json");
  let failure;
  await assert.rejects(TEST_ONLY_runCandidateAttestationOutputControls(context, policy, "b".repeat(40), {
    run: async () => completedProcess("[{\"verified\":true}]\n"),
    verifyPair: async (_options, execute) => {
      await execute(["identity"]); await execute(["workflow"]);
      if (!installed) { await writeFile(foreign, "foreign", { mode: 0o600 }); installed = true; }
      return positive("[{\"verified\":true}]\n");
    },
  }), (error) => { failure = error; return true; });
  assert.equal(await readFile(foreign, "utf8"), "foreign");
  assert.deepEqual((await readdir(context.outputDirectory)).sort(),
    ["positive-before-identity.stdout.json", "positive-before-workflow.stdout.json"]);
  assert.deepEqual(failure.failedContext, { state: "FAILED", acknowledgement: "NOT_PUBLISHED",
    cleanup: "NOT_ATTEMPTED", evidencePreservation: "PRESERVED_FOR_REVIEW",
    preservedOutputNames: ["positive-before-identity.stdout.json", "positive-before-workflow.stdout.json"],
    retainedOutputs: [{ name: "positive-before-identity.stdout.json", bytes: 20,
      sha256: hash(Buffer.from("[{\"verified\":true}]\n")) }] });
});

test("special permission bits on a fixed input fail before any CLI call", { skip: !linux }, async (t) => {
  const { context, policy } = await fixture(t); let calls = 0;
  chmodSync(context.verifierBinary, 0o4700);
  await assert.rejects(TEST_ONLY_runCandidateAttestationOutputControls(context, policy, "b".repeat(40), {
    run: async () => { calls += 1; return {}; }, verifyPair: async () => ({ state: "VERIFIED" }),
  }), /output_control_invalid/u);
  assert.equal(calls, 0);
});

test("trusted-root replacement during a call fails before a positive control is accepted",
  { skip: !linux }, async (t) => {
    const { context, policy } = await fixture(t); let calls = 0;
    await assert.rejects(TEST_ONLY_runCandidateAttestationOutputControls(context, policy, "b".repeat(40), {
      run: async () => {
        calls += 1; await writeFile(context.trustedRootPath, "changed trusted root", { mode: 0o600 });
        return completedProcess("[{\"verified\":true}]\n");
      },
      verifyPair: async (_options, execute) => { await execute(["identity"]); return positive("[]"); },
    }), /output_control_input_changed/u);
    assert.equal(calls, 1);
  });
