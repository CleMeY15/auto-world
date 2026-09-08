import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareNativeBuilds, validateNativeBuildRecord, verifyNativeBuildDirectory } from "./candidate-records.mjs";
import { createNativeCiIdentity, NATIVE_WORKFLOW_PATH } from "./ci-identity.mjs";
import { validateMaterialLock, validateSourceSelection } from "./materials.mjs";
import { hashFileBounded, readFileBounded } from "./native-audit.mjs";
import { policyError, runCommand } from "./process.mjs";
import { canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const MiB = 1024 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLS = ["oras", "cosign", "trivy"];
const fail = (code) => { throw policyError(code); };
const artifactName = ({ tool, repeat }) => `native-candidate-${tool}-${repeat}`;

export function assertCandidateTransferBudget(sizes) {
  if (!Array.isArray(sizes) || sizes.length < 1 || sizes.length > 6 || sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 6 * 1024 * MiB)) fail("candidate_artifact_size_refused");
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > 8 * 1024 * MiB) fail("candidate_consumption_size_refused");
  return total;
}

async function directoryAt(directory) {
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory) fail("candidate_artifact_path_refused");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("candidate_artifact_path_refused");
}

async function exactEntries(directory, expected) {
  await directoryAt(directory);
  const remaining = new Set(expected);
  // Streaming enumeration refuses the first extra entry, without allocating an
  // attacker-controlled directory listing before checking the closed inventory.
  for await (const entry of await opendir(directory)) {
    if (!remaining.delete(entry.name)) fail("candidate_artifact_inventory_invalid");
  }
  if (remaining.size) fail("candidate_artifact_inventory_invalid");
}

async function artifactInventory(directory, record) {
  await exactEntries(directory, ["record.json", "source.tar.gz", "out"]);
  await exactEntries(path.join(directory, "out"), record.outputs.map((output) => path.basename(output.path)));
  let size = 0;
  for (const relative of ["record.json", "source.tar.gz", ...record.outputs.map((output) => output.path)]) {
    const file = path.join(directory, relative);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await realpath(file) !== file) fail("candidate_artifact_path_refused");
    size += info.size;
    if (!Number.isSafeInteger(size) || size > 6 * 1024 * MiB) fail("candidate_artifact_size_refused");
  }
  return assertCandidateTransferBudget([size]);
}

export async function verifyCandidateArtifact(directory, expected, sourceArchive) {
  await directoryAt(directory);
  const bytes = await readFileBounded(path.join(directory, "record.json"), 8 * MiB);
  const record = validateNativeBuildRecord(parseBoundedJson(bytes), expected);
  const size = await artifactInventory(directory, record);
  await verifyNativeBuildDirectory(directory, record, expected);
  const source = await hashFileBounded(path.join(directory, "source.tar.gz"), 2 * 1024 * MiB);
  if (source.sha256 !== sourceArchive.sha256 || source.size !== sourceArchive.size) fail("candidate_source_archive_mismatch");
  if (await artifactInventory(directory, record) !== size) fail("candidate_artifact_changed");
  return { record, size, recordSha256: sha256(bytes) };
}

export async function verifyCandidateArtifactMatrix(directory, expectations, sources) {
  if (!Array.isArray(expectations) || expectations.length !== 6 || new Set(expectations.map(artifactName)).size !== 6 ||
      expectations.some((entry) => !TOOLS.includes(entry.tool) || ![1, 2].includes(entry.repeat))) fail("candidate_matrix_invalid");
  await exactEntries(directory, expectations.map(artifactName));
  const records = [];
  const inventories = [];
  let total = 0;
  for (const expected of expectations) {
    const artifact = path.join(directory, artifactName(expected));
    const bytes = await readFileBounded(path.join(artifact, "record.json"), 8 * MiB);
    const record = validateNativeBuildRecord(parseBoundedJson(bytes), expected);
    const size = await artifactInventory(artifact, record);
    records.push(record);
    inventories.push({ size, recordSha256: sha256(bytes) });
    total = assertCandidateTransferBudget(inventories.map((entry) => entry.size));
  }
  // Check the entire consumption budget before hashing any large payload.
  for (const [index, expected] of expectations.entries()) {
    const verified = await verifyCandidateArtifact(path.join(directory, artifactName(expected)), expected, sources[expected.tool]);
    if (verified.size !== inventories[index].size || verified.recordSha256 !== inventories[index].recordSha256) fail("candidate_artifact_changed");
  }
  await exactEntries(directory, expectations.map(artifactName));
  const comparison = compareNativeBuilds(records, expectations);
  return { schemaVersion: 1, ...comparison, run: records[0].run,
    selectionSha256: records[0].selectionSha256, materialLockSha256: records[0].materialLockSha256,
    records: expectations.map((expected, index) => ({ artifact: artifactName(expected), sha256: inventories[index].recordSha256 })), consumedBytes: total };
}

// Snapshot the exact records hashed by the matrix verifier before executing any
// candidate. A later rewritten record must never become a new expected subject.
export async function loadVerifiedCandidateRecords(directory, matrix, expectations) {
  if (!Array.isArray(matrix?.records) || matrix.records.length !== 6 || !Array.isArray(expectations) || expectations.length !== 6) fail("candidate_matrix_invalid");
  const records = [];
  for (const expected of expectations) {
    const name = artifactName(expected);
    const identities = matrix.records.filter((entry) => entry.artifact === name);
    if (identities.length !== 1 || !/^[a-f0-9]{64}$/u.test(identities[0].sha256)) fail("candidate_matrix_invalid");
    const bytes = await readFileBounded(path.join(directory, name, "record.json"), 8 * MiB);
    if (sha256(bytes) !== identities[0].sha256) fail("candidate_record_changed_after_matrix");
    const record = validateNativeBuildRecord(parseBoundedJson(bytes), expected);
    records.push(Object.freeze({ ...record, runner: Object.freeze(record.runner), run: Object.freeze(record.run),
      outputs: Object.freeze(record.outputs.map((output) => Object.freeze({ ...output, buildInfo: Object.freeze(output.buildInfo) }))) }));
  }
  if (new Set(records.map(artifactName)).size !== 6) fail("candidate_matrix_invalid");
  return Object.freeze(records);
}

export async function copyExpectedFile(source, destination, expected, cap) {
  if (!Number.isSafeInteger(expected.size) || expected.size < 1 || expected.size > cap || !/^[a-f0-9]{64}$/u.test(expected.sha256)) fail("candidate_copy_identity_invalid");
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== expected.size || await realpath(source) !== source) fail("candidate_copy_source_invalid");
  const input = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let output;
  try {
    const opened = await input.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size !== info.size || opened.nlink !== 1) fail("candidate_copy_source_changed");
    output = await open(destination, "wx", 0o600);
    const buffer = Buffer.alloc(64 * 1024);
    const hash = createHash("sha256");
    let total = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > expected.size) fail("candidate_copy_source_changed");
      hash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset, null);
        if (!bytesWritten) fail("candidate_copy_write_failed");
        offset += bytesWritten;
      }
    }
    const end = await input.stat();
    if (total !== expected.size || hash.digest("hex") !== expected.sha256 || end.size !== info.size || end.mtimeMs !== info.mtimeMs || end.nlink !== 1) fail("candidate_copy_source_changed");
  } finally {
    const closed = await Promise.allSettled([input.close(), ...(output ? [output.close()] : [])]);
    if (closed.some((entry) => entry.status === "rejected")) fail("candidate_copy_close_failed");
  }
}

// Only these explicitly verified public files enter an upload directory. Build
// caches, test homes, credentials and disposable signing material are excluded.
export async function packageCandidateArtifact({ buildDirectory, recordFile, sourceFile, destination, expected, sourceArchive }) {
  await directoryAt(buildDirectory);
  if ((await lstat(recordFile)).nlink !== 1) fail("candidate_copy_source_invalid");
  const recordBytes = await readFileBounded(recordFile, 8 * MiB);
  const record = validateNativeBuildRecord(parseBoundedJson(recordBytes), expected);
  await verifyNativeBuildDirectory(buildDirectory, record, expected);
  if (!path.isAbsolute(destination)) fail("candidate_artifact_path_refused");
  await directoryAt(path.dirname(destination));
  await mkdir(destination, { recursive: false });
  await directoryAt(destination);
  await mkdir(path.join(destination, "out"));
  await copyExpectedFile(recordFile, path.join(destination, "record.json"), { sha256: sha256(recordBytes), size: recordBytes.length }, 8 * MiB);
  await copyExpectedFile(sourceFile, path.join(destination, "source.tar.gz"), sourceArchive, 2 * 1024 * MiB);
  for (const output of record.outputs) {
    await copyExpectedFile(path.join(buildDirectory, output.path), path.join(destination, output.path), output, 512 * MiB);
  }
  return verifyCandidateArtifact(destination, expected, sourceArchive);
}

export function parseCandidateArtifactArgs(argv) {
  if (argv.length === 1 && argv[0] === "verify") return { mode: "verify" };
  if (argv.length !== 5 || argv[0] !== "package" || argv[1] !== "--tool" || !TOOLS.includes(argv[2]) || argv[3] !== "--repeat" || !["1", "2"].includes(argv[4])) fail("candidate_artifact_arguments_refused");
  return { mode: "package", tool: argv[2], repeat: Number(argv[4]) };
}

export async function loadCandidateContext() {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !/^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA ?? "") ||
      !/^[a-f0-9]{40}$/u.test(process.env.GITHUB_WORKFLOW_SHA ?? "") || !/^[1-9][0-9]*$/u.test(process.env.GITHUB_RUN_ID ?? "") ||
      !/^[1-9][0-9]*$/u.test(process.env.GITHUB_RUN_ATTEMPT ?? "") || !Number.isSafeInteger(Number(process.env.GITHUB_RUN_ATTEMPT)) ||
      !path.isAbsolute(process.env.RUNNER_TEMP ?? "")) fail("candidate_artifact_requires_secret_free_linux_ci");
  const runnerTemp = await realpath(process.env.RUNNER_TEMP);
  const env = { PATH: "/usr/bin:/bin", HOME: runnerTemp, TMPDIR: runnerTemp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const git = ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-C", ROOT];
  const invokeGit = async (tail) => (await runCommand("/usr/bin/git", [...git, ...tail], { cwd: ROOT, env })).stdout.toString("utf8").trim();
  if (await invokeGit(["rev-parse", "HEAD^{commit}"]) !== process.env.GITHUB_SHA || await invokeGit(["status", "--porcelain", "--untracked-files=no"])) fail("candidate_checkout_identity_mismatch");
  const inputs = ["infra/supply-chain/native-sources.json", "infra/supply-chain/native-materials.lock.json", NATIVE_WORKFLOW_PATH];
  await invokeGit(["ls-files", "--error-unmatch", "--", ...inputs]);
  const run = createNativeCiIdentity(process.env, await readFileBounded(path.join(ROOT, NATIVE_WORKFLOW_PATH), 64 * 1024));
  const selection = validateSourceSelection(parseBoundedJson(await readFileBounded(path.join(ROOT, inputs[0]), 8 * MiB)));
  const lockBytes = await readFileBounded(path.join(ROOT, inputs[1]), 8 * MiB);
  const lock = validateMaterialLock(parseBoundedJson(lockBytes), selection);
  const sources = Object.fromEntries(lock.proposals.map((proposal) => [proposal.tool, proposal.sourceArchive]));
  const expectations = TOOLS.flatMap((tool) => [1, 2].map((repeat) => {
    const selected = selection.tools.find((entry) => entry.name === tool);
    const proposal = lock.proposals.find((entry) => entry.tool === tool);
    return { tool, repeat, sourceCommit: selected.commit, repositoryCommit: process.env.GITHUB_SHA,
      selectionSha256: lock.selectionSha256, materialLockSha256: sha256(lockBytes), recipeSha256: proposal.recipeSha256,
      compilerVersion: selection.compiler.version, runnerImageVersion: proposal.managedRunner.imageVersion,
      utilityInventorySha256: sha256(canonicalJsonBuffer(proposal.managedRunner.utilities)),
      run };
  }));
  return { runnerTemp, selection, lock, lockBytes, expectations, sources };
}

async function main() {
  const args = parseCandidateArtifactArgs(process.argv.slice(2));
  const { runnerTemp, selection, expectations, sources } = await loadCandidateContext();
  if (args.mode === "verify") {
    const result = await verifyCandidateArtifactMatrix(path.join(runnerTemp, "native-candidates"), expectations, sources);
    await writeFile(path.join(runnerTemp, "native-reproducibility.json"), canonicalJsonBuffer(result), { flag: "wx" });
  } else {
    const expected = expectations.find((entry) => entry.tool === args.tool && entry.repeat === args.repeat);
    const selected = selection.tools.find((entry) => entry.name === args.tool);
    const buildDirectory = path.join(runnerTemp, `aw-build-${args.tool}-${args.repeat}`);
    await packageCandidateArtifact({ buildDirectory,
      recordFile: path.join(runnerTemp, `native-build-${args.tool}-${args.repeat}.json`),
      sourceFile: path.join(buildDirectory, `${selected.repository.split("/")[1]}-${selected.commit}.tar.gz`),
      destination: path.join(runnerTemp, artifactName(expected)), expected, sourceArchive: sources[args.tool] });
  }
  process.stdout.write(`${JSON.stringify({ phase: "candidate_artifacts", status: "pass", operation: args.mode })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("candidate_artifact_verification_failed\n");
    process.exitCode = 1;
  });
}
