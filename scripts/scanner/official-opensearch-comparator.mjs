import { createHash } from "node:crypto";
import { statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { collectImageAudits } from "./audit.mjs";
import { captureFiles, readBoundedJson } from "./controls.mjs";
import { evaluateImageReport } from "./official-controls.mjs";

const repository = "opensearchproject/opensearch";
const old = {
  role: "opensearch", repository, version: "3.9.0",
  manifestDigest: "sha256:3bf4fe26aeb9f7b03c0ebcb1302bb24e855ee6b89fd926d26a71a83ef6f7e076",
  platform: { os: "linux", architecture: "amd64", variant: null, digest: "sha256:84871c53f4d8ec5ecc9019d234951ef0c37ca60ced365c9db2ba96e4662daef2" },
  configId: "sha256:d7fb1e7bde3bdfe89c1066d8297621fe75af28d2c7e9dc9f3b8c7f2106537fba",
};
const candidate = {
  role: "opensearch-candidate", repository, version: "3.10.0",
  manifestDigest: "sha256:02d6d6e40c820ae08233b60540aa5d3d9364d64e2dc724e38d6c8c794879b2a0",
  platform: { os: "linux", architecture: "amd64", digest: "sha256:ffa260e43be96b49144fb7ececbb135c3fd7081567adc781c49ec9232ce1e47f" },
  configId: "sha256:5aaea29f67a40c1dada19f00f2477fd24184334d474a29fc4cc70c50166a8adc",
};
const historical = {
  sourceCommit: "5d0599cdeb3589b0c2ab0e42778769c9ad771b32", runId: "44321947040", attempt: 1,
  artifactId: "14436050679", artifactSha256: "838d34d5ecbfc9b423342e47e39120be6ccad3908cbf8809a880cce074e1ea0b",
  receipt: { sha256: "927f0336de75c2e5747d68d958e52c9543de8bee629ca15613fba19488c02159", size: 163221 },
  json: { sha256: "56668110157c3e5acd463912679c5939af61829fb820c35bb1191dcd8eeb224c", size: 1701419 },
  sbom: { sha256: "ffb0fd9a50935de5009c4b1fe0db590235b494531579a66dfa977695f237a730", size: 1492475 },
  scanner: { sha256: "6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3", size: 176386208 },
  databaseFiles: [
    { file: "db/trivy.db", sha256: "7244f40ff53c4ac2909d8fba04aa4937354a620c380dc83bbc51df715f6cd68d", size: 1760485376 },
    { file: "java-db/trivy-java.db", sha256: "a41f53b9b2b3d57ef45aeda3abd8f03dc17dfcacc5aaec277600218919de5e15", size: 1582481408 },
  ],
  // SHA-256 of UTF-8 compact JSON, original row order, sorted keys per blocker.
  oldOrderedBlockersSha256: "a66921c68caa597ed5cbec9c959cf5d0feb7d33c0e23ad56198bf2e3abb4fcbe",
};
const cap = 64 * 1024 ** 2;
const diskFloor = 12 * 1024 ** 3;
const timeoutMs = 10 * 60_000;
const reserveMs = 2 * 60_000;
const formats = ["json", "cyclonedx"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => { throw new Error(reason); };
const reportName = (image, format) => `image-${image.role}${format === "json" ? ".json" : ".cdx.json"}`;

function compareInputs(inputs) {
  if (!isDeepStrictEqual(inputs?.scanner, historical.scanner) || !Array.isArray(inputs.databaseFiles)) {
    fail("scanner_opensearch_inputs_invalid");
  }
  const databases = historical.databaseFiles.map((expected) => {
    const matches = inputs.databaseFiles.filter((row) => row?.file === expected.file);
    const [db] = matches;
    if (matches.length !== 1 || typeof db.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(db.sha256) ||
        !Number.isSafeInteger(db.size) || db.size < 1 || db.sha256 === expected.sha256 && db.size !== expected.size) {
      fail("scanner_opensearch_inputs_invalid");
    }
    return { file: db.file, sha256: db.sha256, size: db.size };
  });
  return { scanner: inputs.scanner, databases, historicalInputsMatch: isDeepStrictEqual(databases, historical.databaseFiles) };
}

function validateSubject(image, json, sbom) {
  const subject = image.repository + "@" + image.platform.digest;
  if (json?.ArtifactName !== subject || json.Metadata?.Reference !== subject || json.Metadata.ImageID !== image.configId ||
      !isDeepStrictEqual(json.Metadata.RepoDigests, [subject])) fail("scanner_opensearch_json_subject_invalid");
  if (sbom === undefined) return;
  const component = sbom?.metadata?.component;
  const purl = "pkg:oci/opensearch@" + image.platform.digest + "?arch=amd64&repository_url=index.docker.io%2Fopensearchproject%2Fopensearch";
  if (component?.purl !== purl || component["bom-ref"] !== purl || component.name !== subject ||
      !Array.isArray(component.properties)) fail("scanner_opensearch_sbom_subject_invalid");
  for (const [key, value] of Object.entries({ Reference: subject, ImageID: image.configId, RepoDigest: subject })) {
    const rows = component.properties.filter((row) => row?.name === "aquasecurity:trivy:" + key);
    if (rows.length !== 1 || rows[0].value !== value) fail("scanner_opensearch_sbom_subject_invalid");
  }
}

async function readPair(output, image, expected) {
  const pair = {};
  for (const [index, format] of formats.entries()) {
    const { value, identity } = await readBoundedJson(path.join(output, reportName(image, format)), cap);
    if (!isDeepStrictEqual(identity, expected?.[index])) fail("scanner_frozen_input_changed");
    pair[index === 0 ? "json" : "sbom"] = value;
  }
  validateSubject(image, pair.json, pair.sbom);
  return pair;
}

async function freeBytes(output) {
  const { bavail, bsize } = await statfs(output, { bigint: true });
  return Number(bavail * bsize);
}

function commandCause(error, command) {
  const message = command?.diagnostic?.stderrTail ?? "";
  if (error?.code === "ENOSPC" || command?.error === "ENOSPC" || /\bno space left on device\b/iu.test(message)) return "ENOSPC";
  if (command?.error === "ETIMEDOUT" || error?.code === "ETIMEDOUT") return "timeout";
  if (command?.oomKilled === true) return "OOM";
  return "unknown";
}

function validateCommand(commands, index) {
  const command = commands[index];
  const lease = command?.lease;
  if (commands.length !== index + 1 || command?.executable !== "docker" ||
      !/^aw-official-[a-f0-9-]{36}$/u.test(lease?.name ?? "") || !/^[a-f0-9-]{36}$/u.test(lease.owner) ||
      commands.slice(0, index).some((row) => row.lease && (row.lease.name === lease.name || row.lease.owner !== lease.owner))) {
    fail("scanner_opensearch_command_invalid");
  }
  if (command.ownedContainerAbsent !== true ||
      !(command.cleanup?.inspected === 1 && command.cleanup.removed === false ||
        command.cleanup?.inspected === 0 && command.cleanup.removed === true)) fail("scanner_official_cleanup_uncertain");
  if (command.exitCode !== 0 || command.signal !== null || command.error !== null) fail("scanner_official_command_failed");
}

// Bound the serialized tree before allocating the complete buffer. Inventory rows
// may repeat long paths many more times than they occur in the original inputs.
function boundedBytes(document) {
  let size = 1; // trailing newline
  function count(value) {
    if (value !== null && typeof value === "object") {
      size += 2;
      let first = true;
      for (const key of Object.keys(value)) {
        if (!first) size++;
        first = false;
        if (!Array.isArray(value)) size += Buffer.byteLength(JSON.stringify(key)) + 1;
        count(value[key]);
      }
    } else {
      if (typeof value === "string" && value.length > cap) fail("scanner_opensearch_delta_limit");
      size += Buffer.byteLength(JSON.stringify(value));
    }
    if (size > cap) fail("scanner_opensearch_delta_limit");
  }
  count(document);
  const bytes = Buffer.from(JSON.stringify(document) + "\n");
  if (bytes.length !== size) fail("scanner_opensearch_delta_invalid");
  return bytes;
}

async function persistDelta(output, document) {
  const file = "image-opensearch-comparison.json";
  const target = path.join(output, file);
  const bytes = boundedBytes(document);
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  const [readback] = await captureFiles([{ path: target, cap }]);
  if (readback.size !== bytes.length || readback.sha256 !== sha(bytes)) fail("scanner_frozen_input_changed");
  return { file, size: readback.size, sha256: readback.sha256 };
}

// verifyCheckpoints must re-read and validate both on-disk checkpoints and their
// dependencies for this run. runFormat must wrap the existing command that
// writes the named report and returns its exact stdout. Await one before the next.
export async function compareOpenSearchCandidate({ config, receipt, output, operations, remainingTimeMs,
  verifyCheckpoints, buildOpenSearchComparison, availableBytes = freeBytes }) {
  const start = receipt.commands.length;
  const comparison = { candidate, result: "failed", qualification: "failed", candidatePolicy: "unmeasured",
    execution: "not_started", formats: [] };
  receipt.openSearchComparator = comparison;
  const identities = [];
  const executions = [];
  let activeFormat;
  try {
    if (receipt.scope !== "upstream" || typeof verifyCheckpoints !== "function" ||
        await verifyCheckpoints() !== true) fail("scanner_opensearch_checkpoints_invalid");
    if (typeof buildOpenSearchComparison !== "function") fail("scanner_opensearch_inventory_unavailable");
    const baseline = config.images.filter((image) => image.role === old.role);
    if (baseline.length !== 1 || baseline[0].repository !== old.repository || baseline[0].version !== old.version ||
        baseline[0].manifestDigest !== old.manifestDigest || !isDeepStrictEqual(baseline[0].platform, old.platform)) {
      fail("scanner_opensearch_baseline_invalid");
    }
    comparison.inputs = compareInputs(receipt.awsComparisonInputs);
    const oldBlockers = receipt.blockers.filter((row) => row.role === old.role);
    if (comparison.inputs.historicalInputsMatch) {
      const sortedRows = oldBlockers.map((row) => Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])));
      if (sha(JSON.stringify(sortedRows)) !== historical.oldOrderedBlockersSha256) fail("scanner_opensearch_historical_replay_changed");
    }
    const oldIdentity = receipt.reports.find((row) => row.role === old.role)?.report;
    const oldReport = await readPair(output, old, oldIdentity);
    const runFormat = async (format, execute) => {
      const index = identities.length;
      if (activeFormat || index >= formats.length || format !== formats[index] || receipt.commands.length !== start + index) fail("scanner_opensearch_format_order_invalid");
      activeFormat = format;
      const observation = { format, status: "refused", timeoutMs, reserveMs };
      comparison.formats.push(observation);
      if (index === 0) {
        const bytes = await availableBytes(output);
        const sufficient = Number.isSafeInteger(bytes) && bytes >= diskFloor;
        comparison.diskPreflight = { freeBytes: bytes, requiredBytes: diskFloor, sufficient };
        if (!sufficient) fail("scanner_opensearch_insufficient_disk");
      }
      const remaining = typeof remainingTimeMs === "function" ? await remainingTimeMs() : null;
      observation.remainingTimeMs = remaining;
      if (!Number.isFinite(remaining) || remaining > 60 * 60_000 || remaining < timeoutMs + reserveMs) fail("scanner_opensearch_insufficient_time");
      observation.status = "started";
      comparison.execution = "partial";
      let bytes;
      try {
        bytes = await execute(timeoutMs);
        validateCommand(receipt.commands, start + index);
        executions.push(globalThis.structuredClone(receipt.commands[start + index]));
      } catch (error) {
        observation.status = "command_failed";
        observation.reason = error.message;
        observation.cause = commandCause(error, receipt.commands[start + index]);
        throw error;
      }
      observation.commandIndex = start + index + 1;
      observation.status = "validating_report";
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > cap) fail("scanner_opensearch_report_size_invalid");
      const file = reportName(candidate, format);
      const { value, identity } = await readBoundedJson(path.join(output, file), cap);
      if (identity.size !== bytes.length || identity.sha256 !== sha(bytes)) fail("scanner_frozen_input_changed");
      if (format === "json") {
        validateSubject(candidate, value);
        evaluateImageReport(value, candidate, [], new Date(), { expectedScannerVersion: config.scanner.version });
      }
      identities.push(identity);
      Object.assign(observation, { status: "captured", file, ...identity });
      activeFormat = undefined;
      return bytes;
    };

    const collected = await collectImageAudits([candidate], { ...operations, scan: (image) => operations.scan(image, { runFormat }),
      evaluate: (image, pair) => {
        validateSubject(image, pair.json, pair.sbom);
        return operations.evaluate(image, pair);
      } });
    const [record] = collected.reports;
    comparison.report = record;
    const policyRefusal = record.stage === "policy" && record.reason === "scanner_image_policy_blocked" &&
      record.blockerCount > 0 && record.blockerCount === collected.blockers.length;
    if (record.result !== "passed" && !policyRefusal) fail(record.reason);
    if (identities.length !== 2 || !isDeepStrictEqual(receipt.commands.slice(start), executions) ||
        !isDeepStrictEqual(record.report, identities)) fail("scanner_opensearch_execution_incomplete");
    const candidateReport = await readPair(output, candidate, identities);
    comparison.execution = "complete";
    comparison.candidatePolicy = record.result === "passed" ? "clean" : "blocked";
    const inventory = await buildOpenSearchComparison({ oldReport, candidateReport,
      historicalInputsMatch: comparison.inputs.historicalInputsMatch,
      currentInputs: receipt.awsComparisonInputs, oldBlockers, candidateBlockers: collected.blockers });
    if (!["passed", "failed"].includes(inventory?.qualification)) fail("scanner_opensearch_inventory_verdict_invalid");
    const reportFiles = [old, candidate].flatMap((image) => formats.map((format) => ({ path: path.join(output, reportName(image, format)), cap })));
    const after = await captureFiles(reportFiles);
    if (!isDeepStrictEqual(after.map(({ sha256, size }) => ({ sha256, size })), [...oldIdentity, ...identities])) fail("scanner_frozen_input_changed");
    comparison.delta = await persistDelta(output, { schemaVersion: 1, run: receipt.run, old, candidate, historical, inputs: comparison.inputs,
      reports: after.map(({ path: file, sha256, size }) => ({ file: path.basename(file), sha256, size })), candidateBlockers: collected.blockers, inventory });
    if (inventory.qualification !== "passed") fail(inventory.reason || "scanner_opensearch_inventory_failed");
    comparison.qualification = "passed";
    if (comparison.candidatePolicy === "blocked") fail("scanner_opensearch_candidate_policy_blocked");
    comparison.result = "passed";
    return comparison;
  } catch (error) {
    comparison.reason = error.message;
    if (activeFormat) {
      const observation = comparison.formats.at(-1);
      observation.reason ??= error.message;
      if (observation.status === "validating_report") observation.status = "report_failed";
    }
    if (error.code === "ENOSPC") comparison.cause = "ENOSPC";
    throw error;
  } finally {
    comparison.commandIndices = receipt.commands.slice(start).map((_, i) => start + i + 1);
  }
}
