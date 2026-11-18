import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { collectImageAudits } from "./audit.mjs";
import { captureFiles, readBoundedJson } from "./controls.mjs";

const previous = {
  role: "aws-cli-previous", repository: "amazon/aws-cli", version: "2.38.5",
  manifestDigest: "sha256:c8156a0e74e13929a42d7e60f0d4e14e7d28d980cd21822505d4bff80e5460c1",
  platform: { os: "linux", architecture: "amd64", digest: "sha256:25fea7c13a5b32ac8bde048af1cd286e41f07d5d37e6649f23c14a6f9bf284d9" },
};
const oldConfig = "sha256:e84d8cf62bb8820751a8575e8d60a55735bb561e53db1f5d44e7c8ab1d147c6e";
const newConfig = "sha256:25c7966f5a6c335934d4a1b75584e12c3495a038df0848359d586d669821ffa4";
// PR251 raw-main 44267312226/1, image-aws-cli.json. Complete package multiset,
// independent of ordering, advisory database bytes and vulnerability counts.
const oldPackageHash = "96ba0fcc473d3d4d00e4c80b49b26cedcb7231e487f26ca6858011d8b8894dc8";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(message); };

// Keep the comparison's projected rows within the original 64 MiB report budget,
// including repeated target strings that occur just once in a raw result.
function appendRow(rows, row, budget) {
  budget.bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
  if (budget.bytes > 24 * 1024 ** 2) fail("scanner_aws_comparison_limit");
  rows.push(row);
}

// Byte identities of Trivy and its two databases in the authenticated PR251 raw run.
const historicalInputs = {
  scanner: { sha256: "6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3", size: 176386208 },
  databases: {
    "db/trivy.db": { sha256: "b4b9f44be196aac7bf3c359abdcacfaa97a7ccaf56297d04745b7dae554eae86", size: 1759723520 },
    "java-db/trivy-java.db": { sha256: "a41f53b9b2b3d57ef45aeda3abd8f03dc17dfcacc5aaec277600218919de5e15", size: 1582481408 },
  },
};

function historicalContext(inputs) {
  if (!isDeepStrictEqual(inputs?.scanner, historicalInputs.scanner) || !Array.isArray(inputs.databaseFiles)) {
    fail("scanner_aws_comparison_inputs_invalid");
  }
  let identical = true;
  for (const [file, expected] of Object.entries(historicalInputs.databases)) {
    const matches = inputs.databaseFiles.filter((db) => db.file === file);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/u.test(matches[0].sha256) ||
        !Number.isSafeInteger(matches[0].size) || matches[0].size < 1) fail("scanner_aws_comparison_inputs_invalid");
    identical &&= matches[0].sha256 === expected.sha256 && matches[0].size === expected.size;
  }
  return identical ? "identical" : "changed";
}

async function inventory(image, record, configId, operations) {
  if (!record?.report || record.result !== "passed" && record.reason !== "scanner_image_policy_blocked") {
    fail(record?.reason ?? "scanner_aws_report_missing");
  }
  const captured = await operations.captureReport(image);
  if (!isDeepStrictEqual(captured.identity, record.report)) fail("scanner_frozen_input_changed");
  const { json, sbom } = await operations.readReport(image, captured);
  const subject = image.repository + "@" + image.platform.digest;
  const component = sbom.metadata.component;
  const purl = "pkg:oci/aws-cli@" + image.platform.digest + "?arch=amd64&repository_url=index.docker.io%2Famazon%2Faws-cli";
  if (json.Metadata.ImageID !== configId || json.Metadata.Reference !== subject ||
      !isDeepStrictEqual(json.Metadata.RepoDigests, [subject]) || component.purl !== purl || component["bom-ref"] !== purl) fail("scanner_aws_subject_invalid");
  for (const [name, value] of [["ImageID", configId], ["Reference", subject], ["RepoDigest", subject]]) {
    const properties = component.properties?.filter((entry) => entry.name === "aquasecurity:trivy:" + name);
    if (properties?.length !== 1 || properties[0].value !== value) fail("scanner_aws_subject_invalid");
  }

  const packages = [], findings = [];
  const budget = { bytes: 0 };
  for (const result of json.Results) {
    const target = result.Class === "os-pkgs" ? null : result.Target;
    if (target === null && (result.Type !== "amazon" || json.Metadata.OS?.Family !== "amazon" ||
        result.Target !== subject + " (amazon " + json.Metadata.OS.Name + ")")) fail("scanner_aws_subject_invalid");
    for (const pkg of result.Packages) {
      appendRow(packages, { class: result.Class, type: result.Type, target, name: pkg.Name, epoch: pkg.Epoch ?? 0,
        version: pkg.Version, release: pkg.Release ?? "", arch: pkg.Arch ?? "", file: pkg.FilePath ?? "" }, budget);
    }
    for (const v of result.Vulnerabilities ?? []) {
      appendRow(findings, { class: result.Class, type: result.Type, target, vulnerabilityId: v.VulnerabilityID, name: v.PkgName,
        installedVersion: v.InstalledVersion, fixedVersion: v.FixedVersion ?? "", severity: v.Severity,
        packageId: v.PkgID ?? null, packagePath: v.PkgPath ?? null }, budget);
    }
  }
  const identities = packages.map((p) => JSON.stringify([p.class, p.type, p.name, p.epoch, p.version, p.release, p.arch, p.file]));
  return { subject, configId, json: { file: path.basename(captured.files.json), ...record.report[0] },
    sbom: { file: path.basename(captured.files.sbom), ...record.report[1] }, packages, findings, packageHash: sha(identities.sort().join("\n")) };
}

// Indices refer to the complete ordered rows on each side. Consume duplicate
// keys one occurrence at a time, without treating a changed EVR as a fixed CVE.
function reconcile(oldRows, newRows, key) {
  const available = new Map();
  for (let i = newRows.length - 1; i >= 0; --i) {
    const k = key(newRows[i]);
    if (!available.has(k)) available.set(k, []);
    available.get(k).push(i);
  }
  const matched = [], removed = [], used = new Set();
  for (const [i, row] of oldRows.entries()) {
    const j = available.get(key(row))?.pop();
    if (j === undefined) removed.push(i);
    else { matched.push([i, j]); used.add(j); }
  }
  return { matched, removed, added: [...newRows.keys()].filter((j) => !used.has(j)) };
}

// The original 243-row matrix retains the identical AWS blocker sequence as
// 44267312226/1. This comparison describes database drift on the old image
// separately from the two measurements made on the current database.
async function historicalAws() {
  const file = path.resolve(import.meta.dirname, "../../docs/validation/upstream-20261118/original-findings.json");
  const { value, identity } = await readBoundedJson(file, 1024 ** 2);
  if (identity.sha256 !== "7a939d8e1a7b13e0e184d16ff2886b4e81c57d8a3067101305816fd6aa89ea5b") fail("scanner_aws_history_invalid");
  return {
    runId: "44267312226", attempt: 1,
    receiptSha256: "a9f53af490a2d312cd4da66c42ea0edeb9170d4233dcd751d80e71cafd31d35c",
    reportSha256: "063df2968ecc8a819417969869c14f5740ebf47c91da2d8998c0f4cf43df4690",
    sbomSha256: "1d0309c36179d62ac61aebb26ba1e0cf12fd18fda4c2ac8243040b71103610f5",
    orderedBlockers: value.findings.map((row) => row.originalBlocker).filter((b) => b.role === "aws-cli"),
  };
}

export async function comparePreviousAws({ config, receipt, output, operations }) {
  const candidate = config.images.find((image) => image.role === "aws-cli");
  const comparison = { previousSubject: previous, qualification: "failed", oldPolicy: "unmeasured" };
  receipt.awsComparator = comparison;
  const commandStart = receipt.commands.length;
  try {
    const control = await collectImageAudits([previous], operations);
    comparison.control = control;
    const [record] = control.reports;
    const old = await inventory(previous, record, oldConfig, operations);
    const commands = receipt.commands.slice(commandStart);
    if (commands.length !== 2 || commands.some((entry) => entry.ownedContainerAbsent !== true ||
        entry.exitCode !== 0 || entry.signal !== null || entry.error !== null)) fail("scanner_aws_control_execution_invalid");
    comparison.oldPolicy = record.result === "passed" ? "clean" : "blocked";
    if (candidate?.repository !== previous.repository || candidate.version !== "2.41.0" ||
        candidate.manifestDigest !== "sha256:c5d442efed03350a3c3d7a42b23f42a8e7b76acf5dbb4b021f2641bcd36680ea" ||
        candidate.platform.digest !== "sha256:eb3b4742dbfd983bcb79e2df22fbcfde9ad5b3f8277ff1d4050bd7f9cdd9c090") fail("scanner_aws_candidate_invalid");
    const current = await inventory(candidate, receipt.reports.find((entry) => entry.role === candidate.role), newConfig, operations);
    const packageKey = (p) => JSON.stringify(p);
    const findingKey = (f) => JSON.stringify([f.class, f.type, f.target, f.name, f.packagePath, f.vulnerabilityId]);
    const coverageKey = (p) => JSON.stringify([p.class, p.type, p.target, p.name, p.arch]);
    const history = await historicalAws();
    const occurrence = (b) => JSON.stringify([b.target, b.vulnerabilityId, b.packageName, b.installedVersion]);
    const historicalToOld = reconcile(history.orderedBlockers, control.blockers, occurrence);
    comparison.historicalDatabaseContext = historicalContext(receipt.awsComparisonInputs);
    const historicalReplayMatches = isDeepStrictEqual(history.orderedBlockers,
      control.blockers.map((blocker) => ({ ...blocker, role: candidate.role })));
    const data = { history, historicalToOld, historicalInputs, historicalReplayMatches, old, current,
      inventoryScope: "Packages detected by Trivy; bundled or frozen Python dependencies may be absent.",
      packages: reconcile(old.packages, current.packages, packageKey),
      findings: reconcile(old.findings, current.findings, findingKey),
      missingInventory: reconcile(old.packages, current.packages, coverageKey).removed };
    const file = "image-aws-cli-comparison.json";
    const bytes = Buffer.from(JSON.stringify(data) + "\n");
    if (bytes.length > 64 * 1024 ** 2) fail("scanner_aws_comparison_limit");
    writeFileSync(path.join(output, file), bytes, { flag: "wx", mode: 0o600 });
    const [identity] = await captureFiles([{ path: path.join(output, file), cap: 64 * 1024 ** 2 }]);
    if (identity.sha256 !== sha(bytes) || identity.size !== bytes.length) fail("scanner_frozen_input_changed");
    comparison.delta = { file, sha256: identity.sha256, size: identity.size };
    if (old.packageHash !== oldPackageHash || data.missingInventory.length ||
        !current.packages.some((pkg) => pkg.type === "amazon" && pkg.name === "perl-Unicode-Normalize")) fail("scanner_aws_inventory_loss");
    if (comparison.historicalDatabaseContext === "identical" && !historicalReplayMatches) fail("scanner_aws_historical_replay_changed");
    if (!historicalToOld.matched.length || control.blockers.some((b) => !b.vulnerabilityId)) fail("scanner_aws_unexpected_control");
    comparison.qualification = "passed";
  } catch (error) {
    comparison.reason = error.message;
    throw error;
  } finally {
    comparison.commandIndices = receipt.commands.slice(commandStart).map((_, i) => commandStart + i + 1);
  }
}
