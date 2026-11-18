import { createHash } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { collectImageAudits } from "./audit.mjs";
import { captureFiles, readBoundedJson } from "./controls.mjs";
import { boundedJsonBytes } from "./official-report-bytes.mjs";
import { validateOfficialImageSbom, validateOfficialReleaseConfig, validateOfficialScannerIdentity } from "./official-audit.mjs";
import { deriveAwsComparison, readPreviousAwsInventory } from "./official-aws-comparator.mjs";
import { evaluateImageReport } from "./official-controls.mjs";
import { compareOpenSearchInputs, validateOpenSearchBaseline } from "./official-opensearch-comparator.mjs";

const fiveFile = "image-five-subject-results.json";
const awsFile = "image-aws-cli-comparison.json";
const checkpointFile = "image-aws-comparison-checkpoint.json";
const sealFile = "image-aws-comparison-checkpoint-identity.json";
const reportCap = 64 * 1024 ** 2;
const formats = ["json", "cyclonedx"];
const previousRole = "aws-cli-previous";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// Config identities from the original raw 44321947040/1 pair and the AWS control.
const imageIds = {
  opensearch: "sha256:d7fb1e7bde3bdfe89c1066d8297621fe75af28d2c7e9dc9f3b8c7f2106537fba",
  "aws-cli": "sha256:25c7966f5a6c335934d4a1b75584e12c3495a038df0848359d586d669821ffa4",
  [previousRole]: "sha256:e84d8cf62bb8820751a8575e8d60a55735bb561e53db1f5d44e7c8ab1d147c6e",
};
const sha256 = /^[a-f0-9]{64}$/u;
const databaseFiles = ["db/trivy.db", "db/metadata.json", "java-db/trivy-java.db", "java-db/metadata.json"];

function requireEvidence(condition, reason) {
  if (!condition) throw new Error(reason);
}
function validIdentity(entry, cap) {
  return typeof entry?.sha256 === "string" && sha256.test(entry.sha256) && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= cap;
}
function reportNames(role) {
  return [`image-${role}.json`, `image-${role}.cdx.json`];
}
async function boundFile(output, file, expected) {
  requireEvidence(expected?.file === file && validIdentity(expected, reportCap), "scanner_comparison_identity_invalid");
  const { value, identity } = await readBoundedJson(path.join(output, file), reportCap);
  requireEvidence(equal(expected, { file, ...identity }), "scanner_frozen_input_changed");
  return value;
}

async function readReportPair(output, image, identities) {
  const [json, sbom] = reportNames(image.role);
  return {
    json: await boundFile(output, json, { file: json, ...identities[0] }),
    sbom: await boundFile(output, sbom, { file: sbom, ...identities[1] }),
  };
}

function validateCommands(config, checkpoint) {
  const { commands, commandCount, awsComparator } = checkpoint;
  const images = [...config.images, awsComparator?.previousSubject];
  requireEvidence(commands.length === 12 && Number.isSafeInteger(commandCount) && commandCount >= 12, "scanner_comparison_command_mapping_invalid");
  const names = new Set();
  for (const [i, { role, format, index, record, report }] of commands.entries()) {
    const image = images[Math.floor(i / 2)];
    requireEvidence(role === image?.role && format === formats[i % 2] && index === commandCount - 11 + i,
      "scanner_comparison_command_mapping_invalid");
    const lease = record?.lease;
    requireEvidence(record?.executable === "docker" && record.exitCode === 0 && record.signal === null && record.error === null &&
      record.ownedContainerAbsent === true && (record.cleanup?.inspected === 1 && record.cleanup.removed === false ||
        record.cleanup?.inspected === 0 && record.cleanup.removed === true), "scanner_comparison_execution_invalid");
    requireEvidence(typeof lease?.name === "string" && lease.name.startsWith("aw-official-") && uuid.test(lease.name.slice(12)) &&
      uuid.test(lease.owner) && lease.owner === commands[0].record.lease.owner && !names.has(lease.name), "scanner_comparison_lease_invalid");
    requireEvidence(validIdentity(report, reportCap) && equal(record.scan, {
      role, format, reference: image.repository + "@" + image.platform.digest,
      lease: { name: lease.name, owner: lease.owner }, output: { sha256: report.sha256, size: report.size },
    }), "scanner_comparison_scan_binding_mismatch");
    names.add(lease.name);
  }
  requireEvidence(equal(awsComparator?.commandIndices, commands.slice(-2).map(({ index }) => index)), "scanner_comparison_command_mapping_invalid");
}

function validateInputs(checkpoint, config) {
  const run = checkpoint.run;
  requireEvidence(/^[\w.-]+\/[\w.-]+$/u.test(run?.GITHUB_REPOSITORY ?? "") &&
    [run.GITHUB_SHA, run.GITHUB_WORKFLOW_SHA].every((sha) => typeof sha === "string" && /^[a-f0-9]{40}$/u.test(sha)) &&
    [run.GITHUB_RUN_ID, run.GITHUB_RUN_ATTEMPT].every((id) => typeof id === "string" && /^[1-9]\d*$/u.test(id)), "scanner_comparison_run_invalid");
  const inputs = checkpoint.awsComparisonInputs;
  validateOfficialScannerIdentity(inputs?.scanner, config.scanner);
  requireEvidence(Array.isArray(inputs.databaseFiles) && inputs.databaseFiles.length === databaseFiles.length &&
    databaseFiles.every((file) => inputs.databaseFiles.some((entry) => entry?.file === file)) &&
    inputs.databaseFiles.every((entry) => validIdentity(entry, Number.MAX_SAFE_INTEGER)), "scanner_comparison_database_evidence_invalid");
}

// Upstream has no approved dispositions. Each emitted occurrence produces exactly
// one finding and one policy blocker; result iteration preserves duplicate paths.
function verifyOccurrences(image, json, evaluation) {
  const emitted = json.Results.flatMap((result) => (result.Vulnerabilities ?? []).map((v) => ({
    imageDigest: image.manifestDigest, target: result.Target, vulnerabilityId: v.VulnerabilityID, packageName: v.PkgName,
    installedVersion: v.InstalledVersion, severity: v.Severity, fixedVersion: v.FixedVersion ?? "",
  })));
  requireEvidence(equal(emitted, evaluation.findings), "scanner_comparison_findings_mismatch");
  const blockers = emitted.map((finding) => ({ ...finding, code: finding.severity === "CRITICAL" || finding.fixedVersion.trim()
    ? "image_vulnerability_blocked" : "unfixed_high_needs_independent_disposition" }));
  const policyOnly = evaluation.blockers.filter((entry) =>
    ["image_vulnerability_blocked", "unfixed_high_needs_independent_disposition"].includes(entry.code));
  requireEvidence(equal(policyOnly, blockers), "scanner_comparison_blockers_mismatch");
}

async function replay(config, images, original, output, operations, at, inspectPair) {
  requireEvidence(equal(original?.reports?.map(({ role }) => role), images.map(({ role }) => role)), "scanner_comparison_roles_invalid");
  // Run the collector's decision construction on the captured reports only.
  const replayed = await collectImageAudits(images, {
    beforeScan() {}, scan() {}, afterScan() {},
    async captureReport(image) {
      const names = reportNames(image.role);
      const expected = original.reports.find((report) => report.role === image.role).report;
      requireEvidence(Array.isArray(expected) && expected.length === 2 && expected.every((id) => validIdentity(id, reportCap)),
        "scanner_comparison_report_identity_invalid");
      const files = { json: path.join(output, names[0]), sbom: path.join(output, names[1]) };
      if (!operations) return { identity: expected, files };
      const captured = await operations.captureReport(image);
      requireEvidence(equal(captured.files, files) && equal(captured.identity, expected), "scanner_frozen_input_changed");
      return captured;
    },
    async readReport(image, captured) {
      if (operations) return operations.readReport(image, captured);
      return readReportPair(output, image, captured.identity);
    },
    async evaluate(image, reports) {
      await inspectPair?.(image, reports);
      const expectedId = imageIds[image.role];
      if (expectedId) {
        const ids = reports.sbom.metadata?.component?.properties?.filter((entry) => entry.name === "aquasecurity:trivy:ImageID");
        requireEvidence(reports.json.Metadata?.ImageID === expectedId && ids?.length === 1 && ids[0].value === expectedId,
          "scanner_comparison_image_config_mismatch");
      }
      let evaluation;
      if (operations) evaluation = await operations.evaluate(image, reports);
      else {
        validateOfficialImageSbom(reports.json, reports.sbom, image);
        evaluation = evaluateImageReport(reports.json, image, [], at, { expectedScannerVersion: config.scanner.version });
      }
      verifyOccurrences(image, reports.json, evaluation);
      const files = reportNames(image.role).map((file) => ({ path: path.join(output, file), cap: reportCap }));
      const captured = await captureFiles(files);
      const record = original.reports.find(({ role }) => role === image.role);
      requireEvidence(equal(record.report, captured.map(({ size, sha256 }) => ({ size, sha256 }))), "scanner_frozen_input_changed");
      return evaluation;
    },
  });
  for (const record of [...original.reports, ...replayed.reports]) {
    if (record.result === "rejected" && (record.stage !== "policy" || record.reason !== "scanner_image_policy_blocked" || !record.blockerCount)) {
      throw new Error(record.reason ?? "scanner_comparison_technical_rejection");
    }
  }
  requireEvidence(equal(replayed, original), "scanner_comparison_decisions_mismatch");
  for (const blocker of replayed.blockers) {
    requireEvidence(["image_vulnerability_blocked", "unfixed_high_needs_independent_disposition"].includes(blocker.code),
      `scanner_comparison_ineligible_blocker:${blocker.role}:${blocker.code}`);
  }
}

async function verifyAws(config, checkpoint, output, five, operations, at) {
  const aws = checkpoint.awsComparator;
  requireEvidence(aws?.qualification === "passed" && !aws.reason, aws?.reason ?? "scanner_comparison_aws_unqualified");
  const previous = aws.previousSubject;
  requireEvidence(previous?.role === previousRole && previous.repository === "amazon/aws-cli" && previous.version === "2.38.5" &&
    previous.manifestDigest === "sha256:c8156a0e74e13929a42d7e60f0d4e14e7d28d980cd21822505d4bff80e5460c1" &&
    previous.platform?.digest === "sha256:25fea7c13a5b32ac8bde048af1cd286e41f07d5d37e6649f23c14a6f9bf284d9", "scanner_comparison_aws_subject_invalid");
  await replay(config, [previous], aws.control, output, operations, at);
  const [old] = aws.control.reports;
  requireEvidence(aws.oldPolicy === (old.result === "passed" ? "clean" : "blocked"), "scanner_comparison_aws_policy_mismatch");
  const delta = await boundFile(output, awsFile, aws.delta);
  const current = config.images.find(({ role }) => role === "aws-cli");
  const readPair = (image, expected) => readReportPair(output, image, expected);
  const derived = await deriveAwsComparison({
    old: await readPreviousAwsInventory(aws.control, readPair),
    candidate: current, control: aws.control, currentRecord: five?.reports.find(({ role }) => role === current.role),
    inputs: checkpoint.awsComparisonInputs, readPair,
  });
  requireEvidence(equal(delta, derived.data), "scanner_comparison_aws_delta_mismatch");
  requireEvidence(aws.historicalDatabaseContext === derived.historicalDatabaseContext, "scanner_comparison_aws_inputs_mismatch");
  if (derived.reason) throw new Error(derived.reason);
}

async function check(config, checkpoint, output, operations, receipt) {
  validateOfficialReleaseConfig(config);
  const reasons = [];
  async function inspect(stage, fn) {
    try { await fn(); } catch (error) { reasons.push({ stage, reason: error.message }); }
  }
  const at = new Date(checkpoint.evaluatedAt);
  await inspect("inputs", () => validateInputs(checkpoint, config));
  await inspect("commands", () => validateCommands(config, checkpoint));
  let five;
  await inspect("five", async () => {
    five = await boundFile(output, fiveFile, checkpoint.fiveImageEvidence);
    requireEvidence(checkpoint.fiveImageResult === (five.rejections.length ? "rejected" : "passed"), "scanner_comparison_five_result_invalid");
    if (receipt) requireEvidence(equal(five, { reports: receipt.reports, blockers: receipt.blockers, rejections: receipt.rejections }),
      "scanner_comparison_five_receipt_mismatch");
    await replay(config, config.images, five, output, operations, at, (image, pair) => {
      if (image.role === "opensearch") return inspect("opensearch_3_9", () => validateOpenSearchBaseline(pair,
        five.blockers.filter((row) => row.role === image.role), compareOpenSearchInputs(checkpoint.awsComparisonInputs)));
    });
  });
  await inspect("report_mapping", () => {
    for (const { role, format, report } of checkpoint.commands) {
      const record = (role === previousRole ? checkpoint.awsComparator?.control : five)?.reports?.find((entry) => entry.role === role);
      const i = formats.indexOf(format);
      requireEvidence(validIdentity(record?.report?.[i], reportCap) && equal(report, { file: reportNames(role)[i], ...record.report[i] }),
        "scanner_comparison_command_report_mismatch");
    }
  });
  await inspect("aws", () => verifyAws(config, checkpoint, output, five, operations, at));
  return reasons;
}

async function writeBounded(output, file, value) {
  const bytes = boundedJsonBytes(value, reportCap, "scanner_comparison_checkpoint_limit");
  await writeFile(path.join(output, file), bytes, { flag: "wx", mode: 0o600 });
  return { file, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Call after the AWS attempt, before any candidate command. scanCommands is
 * [{role,format:"json"|"cyclonedx",index:<1-based receipt.commands index>}].
 * The mapping covers the consecutive suffix of receipt.commands in config.images
 * order followed by aws-cli-previous. Use the actual indices collected as each
 * command runs, including failed attempts. Keep receipt.fiveImageEvidence,
 * fiveImageResult, reports/blockers/rejections, run, awsComparisonInputs and
 * awsComparator from the raw audit. Pass its captureReport/readReport/evaluate.
 * Return the verified reader result. Launch only if eligible === true.
 * A refusal is sealed with the available evidence. Failure to write or verify
 * the checkpoint or its seal throws. A missing scan report yields eligible:false.
 */
export async function writeComparisonCheckpoint({ config, receipt, output, operations, scanCommands }) {
  const checkpoint = { schemaVersion: 1, evaluatedAt: new Date().toISOString(), run: receipt.run,
    fiveImageEvidence: receipt.fiveImageEvidence, fiveImageResult: receipt.fiveImageResult,
    awsComparisonInputs: receipt.awsComparisonInputs, awsComparator: receipt.awsComparator, commandCount: receipt.commands.length,
    commands: scanCommands.map(({ role, format, index }) => {
      const source = role === previousRole ? receipt.awsComparator?.control : receipt;
      const identity = source?.reports?.find((entry) => entry.role === role)?.report?.[formats.indexOf(format)];
      return { role, format, index, record: receipt.commands[index - 1] ?? null,
        report: identity ? { file: reportNames(role)[formats.indexOf(format)], ...identity } : null };
    }) };
  requireEvidence(operations && ["captureReport", "readReport", "evaluate"].every((fn) => typeof operations[fn] === "function"),
    "scanner_comparison_operations_invalid");
  checkpoint.reasons = await check(config, checkpoint, output, operations, receipt);
  const identity = await writeBounded(output, checkpointFile, checkpoint);
  await writeBounded(output, sealFile, identity);
  return readComparisonCheckpoint({ config, output, expectedIdentity: identity, expectedRun: receipt.run });
}

/**
 * Fresh disk-only replay at the checkpoint's evaluation time. Optional
 * expectedIdentity/expectedRun bind an external receipt or archive to this
 * output. The adjacent seal detects corruption, not replacement of the archive.
 * Returns {identity:{file,size,sha256},checkpoint,eligible,reasons,candidateEvidence}.
 * Each refusal reason has {stage,reason}. Seal/identity read errors throw.
 * eligible describes prerequisites before candidate execution. candidateEvidence
 * counts only presence of image-<candidateRole>{.json,.cdx.json}; it cannot
 * establish successful execution. Default candidateRole is opensearch-candidate.
 */
export async function readComparisonCheckpoint({ config, output, expectedIdentity, expectedRun, candidateRole = "opensearch-candidate" }) {
  const { value: identity } = await readBoundedJson(path.join(output, sealFile), 1024);
  if (expectedIdentity !== undefined) requireEvidence(equal(expectedIdentity, identity), "scanner_frozen_input_changed");
  const checkpoint = await boundFile(output, checkpointFile, identity);
  requireEvidence(checkpoint.schemaVersion === 1 && Array.isArray(checkpoint.reasons), "scanner_comparison_checkpoint_invalid");
  if (expectedRun !== undefined) requireEvidence(equal(expectedRun, checkpoint.run), "scanner_comparison_run_mismatch");
  const reasons = await check(config, checkpoint, output);
  for (const reason of checkpoint.reasons) if (!reasons.some((entry) => equal(entry, reason))) reasons.push(reason);
  requireEvidence(/^[a-z0-9][a-z0-9-]{0,63}$/u.test(candidateRole), "scanner_comparison_candidate_role_invalid");
  const present = [];
  for (const file of reportNames(candidateRole)) {
    try { await lstat(path.join(output, file)); present.push(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { identity, checkpoint, eligible: reasons.length === 0, reasons, candidateEvidence: {
    state: ["absent", "partial", "both_files_present"][present.length], files: present } };
}
