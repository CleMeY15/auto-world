import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectImageAudits } from "../scripts/scanner/audit.mjs";
import { readBoundedJson } from "../scripts/scanner/controls.mjs";
import { comparePreviousAws } from "../scripts/scanner/official-aws-comparator.mjs";
import { validateOfficialImageSbom } from "../scripts/scanner/official-audit.mjs";
import { evaluateImageReport } from "../scripts/scanner/official-controls.mjs";
import { readComparisonCheckpoint, writeComparisonCheckpoint } from "../scripts/scanner/official-comparison-checkpoint.mjs";

const configUrl = new URL("../infra/scanner/official-release.json", import.meta.url);
const config = JSON.parse(readFileSync(configUrl));
const pr253 = JSON.parse(readFileSync(new URL("../docs/validation/opensearch-310/official-audit-receipt.json", import.meta.url)));
const fixtureDir = new URL("./fixtures/scanner-official/opensearch-comparison-pr253/", import.meta.url);
test.beforeEach((t) => t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-18T14:18:00Z") }));
const formats = ["json", "cyclonedx"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function save(output, file, object) {
  const bytes = Buffer.from(JSON.stringify(object));
  writeFileSync(path.join(output, file), bytes);
  return { file, size: bytes.length, sha256: hash(bytes) };
}
const load = (output, file) => JSON.parse(readFileSync(path.join(output, file)));

function pair(image, scenario) {
  if (image.role === "opensearch") {
    const fromPr253 = (file) => JSON.parse(readFileSync(new URL("../docs/validation/opensearch-310/" + file, import.meta.url)));
    const json = fromPr253("image-opensearch.json");
    const sbom = fromPr253("image-opensearch.cdx.json");
    const properties = sbom.metadata.component.properties;
    if (scenario === "wrong-id") properties.find((p) => p.name === "aquasecurity:trivy:ImageID").value = "sha256:" + "2".repeat(64);
    if (scenario === "old-json-diffid") json.Metadata.DiffIDs[0] = json.Metadata.DiffIDs[1];
    if (scenario === "old-sbom-diffid") properties.find((p) => p.name === "aquasecurity:trivy:DiffID").value = "sha256:" + "2".repeat(64);
    if (scenario === "clean") for (const result of json.Results) delete result.Vulnerabilities;
    return { json, sbom };
  }
  const subject = image.repository + "@" + image.platform.digest;
  const id = "sha256:" + "1".repeat(64);
  const property = (name, value) => ({ name: "aquasecurity:trivy:" + name, value });
  const targets = image.role === "seaweedfs" ? [["usr/bin/weed", "gobinary"], ["usr/bin/weed-volume", "rustbinary"], ["usr/bin/weed-worker", "rustbinary"]]
    : [["fixture", "jar"]];
  if (image.role === "seaweedfs" && scenario === "missing-target") targets.pop();
  const vuln = { VulnerabilityID: "CVE-2026-1234", PkgName: "lib", InstalledVersion: "1", Severity: "HIGH", FixedVersion: "2" };
  const findings = image.role === "postgres" && scenario !== "clean"
    ? [vuln, vuln, { ...vuln, FixedVersion: "" }] : [];
  const Results = targets.map(([Target, Type]) => ({ Target, Type, Class: "lang-pkgs", Packages: [{ Name: "lib", Version: "1" }], Vulnerabilities: findings }));
  const json = { SchemaVersion: 2, Trivy: { Version: "0.76.2" }, CreatedAt: new Date().toISOString(), ArtifactName: subject,
    ArtifactType: "container_image", Metadata: { ImageID: id, ImageConfig: image.platform }, Results };
  const components = [...new Set(targets.map(([, type]) => type))].map((type) => ({
    name: "lib", type: "library", version: "1", "bom-ref": "lib-" + type, properties: [property("PkgType", type)],
  }));
  for (const [target, type] of targets.filter(([, type]) => type !== "jar")) {
    components.push({ name: target, type: "application", "bom-ref": target, properties: [property("Type", type), property("Class", "lang-pkgs")] });
  }
  if (scenario === "eosl" && image.role === "postgres") {
    json.Metadata.OS = { Family: "alpine", Name: "3", EOSL: true };
    components.push({ type: "operating-system", name: "alpine", version: "3", "bom-ref": "os",
      properties: [property("Type", "alpine"), property("Class", "os-pkgs")] });
  }
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { name: subject, "bom-ref": subject,
    type: "container", properties: [property("ImageID", id)] } },
  components, dependencies: [] };
  return { json, sbom };
}

async function fixture(t, scenario = "") {
  const output = mkdtempSync(path.join(tmpdir(), "aw-checkpoint-"));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  // The evaluator's three-target rule is scoped to this historical SeaweedFS pin.
  const release = JSON.parse(JSON.stringify(config));
  if (scenario === "missing-target") release.images.find(({ role }) => role === "seaweedfs").platform.digest =
    "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362";
  const receipt = { run: { GITHUB_REPOSITORY: "fixture/project", GITHUB_SHA: "a".repeat(40), GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_RUN_ID: "12", GITHUB_RUN_ATTEMPT: "1" }, commands: [{ executable: "preflight" }] };
  const scanCommands = [];
  const owner = randomUUID();
  const operations = {
    beforeScan() {}, afterScan() {},
    scan(image) {
      const isAws = ["aws-cli", "aws-cli-previous"].includes(image.role);
      const synthetic = isAws ? null : pair(image, scenario);
      for (const format of formats) {
        const json = format === "json";
        const file = "image-" + image.role + (json ? ".json" : ".cdx.json");
        let bytes = isAws ? readFileSync(new URL(file, fixtureDir)) : Buffer.from(JSON.stringify(json ? synthetic.json : synthetic.sbom));
        if (file === "image-aws-cli-previous.json" && scenario === "duplicate-old-package") {
          const report = JSON.parse(bytes);
          const packages = report.Results[0].Packages;
          packages.push(packages[0]);
          bytes = Buffer.from(JSON.stringify(report));
        }
        writeFileSync(path.join(output, file), bytes);
        const lease = { name: "aw-official-" + randomUUID(), owner };
        receipt.commands.push({ executable: "docker", exitCode: 0, error: null, signal: null, lease,
          scan: { role: image.role, format, reference: image.repository + "@" + image.platform.digest, lease: { ...lease },
            output: { sha256: hash(bytes), size: bytes.length } },
          cleanup: { inspected: 1, removed: false }, ownedContainerAbsent: true });
        scanCommands.push({ role: image.role, format, index: receipt.commands.length });
      }
      if (scenario === "technical" && image.role === "redis") throw new Error("scanner_official_command_failed");
    },
    async captureReport(image) {
      const files = { json: path.join(output, "image-" + image.role + ".json"), sbom: path.join(output, "image-" + image.role + ".cdx.json") };
      return { files, identity: [(await readBoundedJson(files.json)).identity, (await readBoundedJson(files.sbom)).identity] };
    },
    async readReport(_image, { files }) {
      return { json: (await readBoundedJson(files.json)).value, sbom: (await readBoundedJson(files.sbom)).value };
    },
    evaluate(image, { json, sbom }) {
      validateOfficialImageSbom(json, sbom, image);
      return evaluateImageReport(json, image);
    },
  };
  const five = await collectImageAudits(release.images, operations);
  Object.assign(receipt, five);
  receipt.fiveImageEvidence = save(output, "image-five-subject-results.json", five);
  receipt.fiveImageResult = five.rejections.length ? "rejected" : "passed";
  receipt.awsComparisonInputs = JSON.parse(JSON.stringify(pr253.awsComparisonInputs));
  const comparison = comparePreviousAws({ config: release, receipt, output, operations });
  if (scenario === "duplicate-old-package") {
    await assert.rejects(comparison, /scanner_aws_inventory_loss/u);
  } else {
    await comparison;
    assert.deepEqual(receipt.awsComparator.delta, pr253.awsComparator.delta);
  }
  return { config: release, receipt, output, operations, scanCommands };
}

function readInFreshProcess(output, identity) {
  const module = new URL("../scripts/scanner/official-comparison-checkpoint.mjs", import.meta.url);
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { readComparisonCheckpoint } from ${JSON.stringify(module.href)};
    import { readFileSync } from "node:fs";
    const config = JSON.parse(readFileSync(new URL(${JSON.stringify(configUrl.href)})));
    console.log(JSON.stringify(await readComparisonCheckpoint({config, output: process.argv[1], expectedIdentity: JSON.parse(process.argv[2])})));
  `, output, JSON.stringify(identity)]));
}

test("twelve exact command records, policy-only refusals and fresh disk-only partial recovery", async (t) => {
  const f = await fixture(t);
  const result = await writeComparisonCheckpoint(f);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.eligible, true);
  assert.equal(result.checkpoint.fiveImageResult, "rejected");
  assert.deepEqual(result.checkpoint.commands.map(({ record }) => record), f.receipt.commands.slice(1));
  assert.equal(result.checkpoint.awsComparator.oldPolicy, "blocked");
  save(f.output, "image-opensearch-candidate.json", { partial: true });
  assert.equal(existsSync(path.join(f.output, "official-audit-receipt.json")), false);
  const fresh = readInFreshProcess(f.output, result.identity);
  assert.equal(fresh.eligible, true);
  assert.deepEqual(fresh.checkpoint, result.checkpoint);
  assert.deepEqual(fresh.candidateEvidence, { state: "partial", files: ["image-opensearch-candidate.json"] });
});

for (const [scenario, reason] of [["eosl", "scanner_comparison_ineligible_blocker:postgres:image_os_end_of_life"],
  ["technical", "scanner_official_command_failed"], ["missing-target", "scanner_comparison_ineligible_blocker:seaweedfs:image_inventory_incomplete"],
  ["wrong-id", "scanner_comparison_image_config_mismatch"]]) {
  test("gate refuses " + scenario, async (t) => {
    const f = await fixture(t, scenario);
    const result = await writeComparisonCheckpoint(f);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.some((r) => r.reason === reason), JSON.stringify(result.reasons));
    if (scenario === "eosl") {
      const five = load(f.output, result.checkpoint.fiveImageEvidence.file);
      assert.equal(five.rejections[0].reason, "scanner_image_policy_blocked");
      assert.deepEqual(five.blockers.filter(({ role }) => role === "postgres").map(({ code }) => code), ["image_os_end_of_life", "image_vulnerability_blocked",
        "image_vulnerability_blocked", "unfixed_high_needs_independent_disposition"]);
      assert.equal(five.reports[0].blockerCount, 4);
    }
  });
}

for (const [scenario, reason] of [["old-json-diffid", "scanner_opensearch_old_json_subject_invalid"],
  ["old-sbom-diffid", "scanner_opensearch_old_sbom_subject_invalid"]]) {
  test("producer and fresh reader refuse sealed " + scenario, async (t) => {
    const f = await fixture(t, scenario);
    const decisions = load(f.output, f.receipt.fiveImageEvidence.file);
    assert.equal(decisions.blockers.filter(({ role }) => role === "opensearch").length, 82);
    const { checkpoint, identity, eligible } = await writeComparisonCheckpoint(f);
    const refusal = [{ stage: "opensearch_3_9", reason }];
    assert.deepEqual(checkpoint.reasons, refusal);
    assert.equal(eligible, false);

    // Replace the producer verdict and its seal. The reader must discover the
    // contradiction in the authenticated old pair independently.
    checkpoint.reasons = [];
    const seal = save(f.output, identity.file, checkpoint);
    save(f.output, "image-aws-comparison-checkpoint-identity.json", seal);
    const fresh = readInFreshProcess(f.output, seal);
    assert.deepEqual(fresh.reasons, refusal);
    assert.equal(fresh.eligible, false);
    assert.equal(fresh.candidateEvidence.state, "absent");
    assert.deepEqual(load(f.output, checkpoint.fiveImageEvidence.file), decisions);
    assert.deepEqual(checkpoint.awsComparator, f.receipt.awsComparator);
  });
}

test("clean five subjects can proceed while an AWS failure retains both dispositions on disk", async (t) => {
  const clean = await fixture(t, "clean");
  assert.equal((await writeComparisonCheckpoint(clean)).eligible, true);
  const red = await fixture(t);
  Object.assign(red.receipt.awsComparator, { qualification: "failed", reason: "scanner_aws_inventory_loss" });
  const result = await writeComparisonCheckpoint(red);
  assert.equal(result.checkpoint.fiveImageResult, "rejected");
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.reason === "scanner_aws_inventory_loss"));
});

test("ordered decisions, duplicate occurrences, counts and rejections must all replay", async (t) => {
  for (const change of [
    (five) => { five.blockers[1] = five.blockers[2]; },
    (five) => { five.blockers.reverse(); },
    (five) => { five.rejections = []; },
    (five) => { five.reports[0].findingCount++; },
    (five) => { five.reports[0].result = "passed"; },
  ]) {
    const f = await fixture(t);
    const five = load(f.output, f.receipt.fiveImageEvidence.file);
    change(five);
    Object.assign(f.receipt, five);
    f.receipt.fiveImageResult = five.rejections.length ? "rejected" : "passed";
    f.receipt.fiveImageEvidence = save(f.output, f.receipt.fiveImageEvidence.file, five);
    assert.equal((await writeComparisonCheckpoint(f)).eligible, false);
  }
  const f = await fixture(t);
  const evaluate = f.operations.evaluate;
  f.operations.evaluate = (image, reports) => {
    const result = evaluate(image, reports);
    if (image.role === "postgres") result.findings[0] = result.findings[2];
    return result;
  };
  const result = await writeComparisonCheckpoint(f);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.reason === "scanner_comparison_findings_mismatch"));
});

test("refuses missing inputs, invalid mappings, leases, execution and cleanup", async (t) => {
  for (const change of [
    (f) => { delete f.receipt.run.GITHUB_SHA; },
    (f) => { delete f.receipt.awsComparisonInputs.scanner.sha256; },
    (f) => { delete f.receipt.awsComparisonInputs.databaseFiles[0].size; },
    (f) => { f.receipt.awsComparisonInputs.databaseFiles.splice(2, 1); },
    (f) => { f.scanCommands.pop(); },
    (f) => { f.scanCommands[1].format = "json"; },
    (f) => { f.scanCommands[1].index = 2; },
    (f) => { f.receipt.commands[2].lease.name = f.receipt.commands[1].lease.name; },
    (f) => { f.receipt.commands[5].lease.owner = randomUUID(); },
    (f) => { delete f.receipt.commands[2].scan; },
    (f) => { f.receipt.commands[2].scan.role = "aws-cli-previous"; },
    (f) => { f.receipt.commands[2].scan.format = "json"; },
    (f) => { f.receipt.commands[2].scan.reference = "amazon/aws-cli@latest"; },
    (f) => { f.receipt.commands[2].scan.lease.owner = randomUUID(); },
    (f) => { f.receipt.commands[2].scan.output.sha256 = "0".repeat(64); },
    (f) => { f.receipt.commands[2].scan.output.size++; },
    (f) => { f.receipt.commands[6].ownedContainerAbsent = false; },
    (f) => { f.receipt.commands[7].cleanup = { inspected: 0, removed: false }; },
    (f) => { delete f.receipt.commands[8]; },
    (f) => { f.receipt.commands[9].exitCode = 1; },
    (f) => { f.receipt.awsComparator.commandIndices.reverse(); },
    (f) => { delete f.receipt.awsComparator.delta.size; },
    (f) => { const file = f.receipt.awsComparator.delta.file; const delta = load(f.output, file);
      delta.old.json = delta.current.json; f.receipt.awsComparator.delta = save(f.output, file, delta); },
  ]) {
    const f = await fixture(t);
    change(f);
    assert.equal((await writeComparisonCheckpoint(f)).eligible, false, String(change));
  }
});

test("refuses valid leases exchanged between formats before sealing", async (t) => {
  const f = await fixture(t);
  const [json, sbom] = f.receipt.commands.slice(-2);
  [json.lease, sbom.lease] = [sbom.lease, json.lease];
  const result = await writeComparisonCheckpoint(f);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some(({ stage, reason }) => stage === "commands" && reason === "scanner_comparison_scan_binding_mismatch"));
});

test("recomputes the complete AWS delta even when the delta and checkpoint are correctly sealed", async (t) => {
  const f = await fixture(t);
  const { checkpoint, identity, eligible } = await writeComparisonCheckpoint(f);
  assert.equal(eligible, true);
  const file = checkpoint.awsComparator.delta.file;
  const original = load(f.output, file);
  const { old, current, historicalInputs } = original;
  const identityOnly = ({ subject, configId, json, sbom }) => ({ subject, configId, json, sbom });
  for (const altered of [
    { old: identityOnly(old), current: identityOnly(current), historicalInputs },
    { ...original, missingInventory: [0] },
    { ...original, old: { ...old, packageHash: current.packageHash } },
    { ...original, historicalToOld: { ...original.historicalToOld, matched: [] } },
    { ...original, historicalReplayMatches: false },
  ]) {
    checkpoint.awsComparator.delta = save(f.output, file, altered);
    const seal = save(f.output, identity.file, checkpoint);
    save(f.output, "image-aws-comparison-checkpoint-identity.json", seal);
    const result = await readComparisonCheckpoint({ config, output: f.output, expectedIdentity: seal });
    assert.deepEqual(result.reasons, [{ stage: "aws", reason: "scanner_comparison_aws_delta_mismatch" }]);
    assert.equal(result.eligible, false);
  }
});

test("a complete authentic delta still requires successful inventory qualification", async (t) => {
  const f = await fixture(t, "duplicate-old-package");
  const { awsComparator } = f.receipt;
  assert.equal(awsComparator.qualification, "failed");
  assert.ok(load(f.output, awsComparator.delta.file).missingInventory.length > 0);
  awsComparator.qualification = "passed";
  delete awsComparator.reason;
  const result = await writeComparisonCheckpoint(f);
  assert.deepEqual(result.reasons, [{ stage: "aws", reason: "scanner_aws_inventory_loss" }]);
  assert.equal(result.eligible, false);
});

test("fresh reader detects missing or altered checkpoints, reports, delta and command records", async (t) => {
  const f = await fixture(t);
  const { identity, eligible } = await writeComparisonCheckpoint(f);
  assert.equal(eligible, true);
  const read = () => readComparisonCheckpoint({ config, output: f.output, expectedIdentity: identity });
  for (const file of ["image-five-subject-results.json", "image-redis.json", "image-postgres.cdx.json", "image-aws-cli-previous.cdx.json",
    "image-aws-cli-comparison.json"]) {
    const target = path.join(f.output, file), bytes = readFileSync(target);
    rmSync(target);
    assert.equal((await read()).eligible, false);
    writeFileSync(target, Buffer.concat([bytes, Buffer.from(" ")]));
    assert.equal((await read()).eligible, false);
    writeFileSync(target, bytes);
  }
  const checkpoint = load(f.output, identity.file);
  for (const change of [(cp) => cp.commands.splice(1, 1), (cp) => { cp.commands[0].record.lease.name = "aw-official-" + randomUUID(); },
    (cp) => { cp.commands[0].record.ownedContainerAbsent = false; }]) {
    const copy = JSON.parse(JSON.stringify(checkpoint));
    change(copy);
    save(f.output, identity.file, copy);
    await assert.rejects(read, /scanner_frozen_input_changed/u);
  }
  rmSync(path.join(f.output, identity.file));
  await assert.rejects(read, /ENOENT/u);
  rmSync(path.join(f.output, "image-aws-comparison-checkpoint-identity.json"));
  await assert.rejects(read, /ENOENT/u);
});

test("a report changed during interpretation cannot authorize launch", async (t) => {
  const f = await fixture(t);
  const evaluate = f.operations.evaluate;
  f.operations.evaluate = (image, reports) => {
    const result = evaluate(image, reports);
    if (image.role === "redis") {
      const file = path.join(f.output, "image-redis.json");
      writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("\n")]));
    }
    return result;
  };
  const result = await writeComparisonCheckpoint(f);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((entry) => entry.reason === "scanner_frozen_input_changed"));
});

test("failed scan mapping is preserved alongside AWS and five-subject refusals", async (t) => {
  const f = await fixture(t, "technical");
  f.scanCommands.pop();
  f.receipt.commands.pop();
  f.receipt.commands.at(-1).ownedContainerAbsent = false;
  Object.assign(f.receipt.awsComparator, { qualification: "failed", reason: "scanner_official_cleanup_uncertain",
    commandIndices: [f.receipt.commands.length] });
  delete f.receipt.awsComparator.delta;
  const result = await writeComparisonCheckpoint(f);
  assert.equal(result.eligible, false);
  const fresh = await readComparisonCheckpoint({ config, output: f.output });
  assert.deepEqual(fresh, result);
  assert.equal(fresh.checkpoint.commands.length, 11);
  assert.equal(fresh.checkpoint.commands.at(-1).record.ownedContainerAbsent, false);
  assert.equal(fresh.checkpoint.fiveImageResult, "rejected");
  assert.ok(fresh.reasons.some(({ reason }) => reason === "scanner_official_cleanup_uncertain"));
  assert.ok(fresh.reasons.some(({ reason }) => reason === "scanner_official_command_failed"));
  await assert.rejects(() => readComparisonCheckpoint({ config, output: f.output, expectedRun: { ...f.receipt.run, GITHUB_RUN_ATTEMPT: "2" } }),
    /scanner_comparison_run_mismatch/u);
});
