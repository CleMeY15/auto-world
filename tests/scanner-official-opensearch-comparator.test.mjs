import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readBoundedJson } from "../scripts/scanner/controls.mjs";
import { validateOfficialImageSbom } from "../scripts/scanner/official-audit.mjs";
import { evaluateImageReport } from "../scripts/scanner/official-controls.mjs";
import { compareOpenSearchCandidate } from "../scripts/scanner/official-opensearch-comparator.mjs";

const release = JSON.parse(await readFile(new URL("../infra/scanner/official-release.json", import.meta.url)));
const previous = release.images.find((row) => row.role === "opensearch");
const previousConfig = "sha256:d7fb1e7bde3bdfe89c1066d8297621fe75af28d2c7e9dc9f3b8c7f2106537fba";
const candidateConfig = "sha256:5aaea29f67a40c1dada19f00f2477fd24184334d474a29fc4cc70c50166a8adc";
const candidatePlatform = "sha256:ffa260e43be96b49144fb7ececbb135c3fd7081567adc781c49ec9232ce1e47f";
const diskFloor = 12 * 1024 ** 3;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const prop = (key, value) => ({ name: "aquasecurity:trivy:" + key, value });
const file = (dir, role, format) => path.join(dir, "image-" + role + (format === "json" ? ".json" : ".cdx.json"));

const reference = async (file) => JSON.parse(await readFile(new URL("../docs/validation/opensearch-310/" + file, import.meta.url)));
const baselineReport = await reference("image-opensearch.json");
const baselineSbom = await reference("image-opensearch.cdx.json");
const baselineMetadata = baselineReport.Metadata;
const candidateImageConfig = await reference("3.10.0-config.json");
const candidateManifest = await reference("3.10.0-platform.json");
// ISIZE of the seven authenticated 3.10 layer archives (all below 4 GiB).
const candidateSizes = [155598848, 11930624, 20992, 1535065600, 1024, 3072, 8192];
const layerMetadata = {
  ImageConfig: candidateImageConfig, DiffIDs: candidateImageConfig.rootfs.diff_ids,
  Layers: candidateManifest.layers.map((layer, i) => ({ Size: candidateSizes[i], Digest: layer.digest, DiffID: candidateImageConfig.rootfs.diff_ids[i] })),
  Size: candidateSizes.reduce((a, b) => a + b, 0),
};

function reports(digest, config, blocked) {
  const subject = previous.repository + "@" + digest;
  const purl = "pkg:oci/opensearch@" + digest + "?arch=amd64&repository_url=index.docker.io%2Fopensearchproject%2Fopensearch";
  return {
    json: { ArtifactName: subject, ArtifactType: "container_image", SchemaVersion: 2, CreatedAt: new Date().toISOString(),
      Trivy: { Version: "0.76.2" }, Metadata: { ...JSON.parse(JSON.stringify(digest === candidatePlatform ? layerMetadata : baselineMetadata)),
        ImageID: config, Reference: subject, RepoDigests: [subject] },
      Results: [{ Class: "lang-pkgs", Target: "Java", Type: "jar", Packages: [{ Name: "org.example:test", Version: "1" }],
        Vulnerabilities: blocked ? [{ VulnerabilityID: "CVE-TEST", PkgName: "org.example:test", InstalledVersion: "1", Severity: "HIGH", FixedVersion: "2" }] : [] }] },
    cyclonedx: { bomFormat: "CycloneDX", specVersion: "1.6", dependencies: [],
      metadata: { component: { type: "container", name: subject, purl, "bom-ref": purl,
        properties: [prop("ImageID", config), prop("Reference", subject), prop("RepoDigest", subject)] } },
      components: [{ type: "library", name: "org.example:test", version: "1", "bom-ref": "example", properties: [prop("PkgType", "jar")] }] },
  };
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "opensearch-comparator-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = [], calls = [];
  const previousPair = reports(previous.platform.digest, previousConfig, options.oldBlocked);
  options.mutateOld?.(previousPair);
  if (options.oldWrongConfig) previousPair.cyclonedx.metadata.component.properties[0].value = candidateConfig;
  const report = [];
  for (const format of ["json", "cyclonedx"]) {
    const bytes = Buffer.from(JSON.stringify(previousPair[format]));
    await writeFile(file(dir, previous.role, format), bytes);
    report.push({ sha256: sha(bytes), size: bytes.length });
  }
  const blockers = evaluateImageReport(previousPair.json, previous).blockers.map((row) => ({ role: previous.role, ...row }));
  const receipt = { scope: "upstream", commands: [], reports: [{ role: previous.role, report }], blockers,
    run: { GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: "a".repeat(40) },
    awsComparisonInputs: { scanner: { sha256: release.scanner.binarySha256, size: 176386208 },
      databaseFiles: [{ file: "db/trivy.db", sha256: "a".repeat(64), size: 1760485376 },
        { file: "java-db/trivy-java.db", sha256: "a41f53b9b2b3d57ef45aeda3abd8f03dc17dfcacc5aaec277600218919de5e15", size: 1582481408 }] } };
  const owner = randomUUID();
  const args = { config: release, receipt, output: dir,
    availableBytes: (output) => { assert.equal(output, dir); events.push("disk"); return diskFloor; },
    remainingTimeMs: () => { events.push("clock"); return 12 * 60_000; },
    verifyCheckpoints: () => { events.push("checkpoints"); return true; },
    buildOpenSearchComparison: async (inputs) => {
      calls.push(inputs);
      return { qualification: "passed", findings: inputs.candidateReport.json.Results[0].Vulnerabilities };
    },
    operations: {
      beforeScan: () => events.push("before"),
      afterScan: () => events.push("after"),
      scan: async (image, { runFormat }) => {
        assert.equal(image.repository, "opensearchproject/opensearch");
        assert.equal(image.platform.digest, candidatePlatform);
        assert.equal(image.manifestDigest, "sha256:02d6d6e40c820ae08233b60540aa5d3d9364d64e2dc724e38d6c8c794879b2a0");
        const pair = reports(candidatePlatform, candidateConfig, options.blocked);
        options.mutatePair?.(pair);
        for (const format of ["json", "cyclonedx"]) {
          await runFormat(format, async (timeoutMs) => {
            assert.equal(timeoutMs, 600_000);
            events.push(format);
            const record = { executable: "docker", exitCode: 0, signal: null, error: null,
              lease: { name: "aw-official-" + randomUUID(), owner }, cleanup: { inspected: 1, removed: false }, ownedContainerAbsent: true };
            receipt.commands.push(record);
            options.command?.(format, record, receipt);
            const bytes = Buffer.from(options.stdout?.(format) ?? JSON.stringify(pair[format]));
            const target = file(dir, image.role, format);
            await writeFile(target, bytes, { flag: "wx" });
            await options.afterWrite?.(format, target);
            return bytes;
          });
        }
      },
      captureReport: async (image) => {
        const files = ["json", "cyclonedx"].map((format) => file(dir, image.role, format));
        const identity = [];
        for (const target of files) {
          const bytes = await readFile(target);
          identity.push({ sha256: sha(bytes), size: bytes.length });
        }
        return { identity, files };
      },
      readReport: async (_image, capture) => ({ json: (await readBoundedJson(capture.files[0])).value, sbom: (await readBoundedJson(capture.files[1])).value }),
      evaluate: (image, pair) => {
        validateOfficialImageSbom(pair.json, pair.sbom, image);
        return evaluateImageReport(pair.json, image);
      },
    } };
  return { args, dir, events, calls, receipt, run: () => compareOpenSearchCandidate(args) };
}

test("a completed pair on a changed DB retains a blocked candidate and its new finding", async (t) => {
  const f = await fixture(t, { blocked: true });
  await assert.rejects(f.run(), /scanner_opensearch_candidate_policy_blocked/u);
  const c = f.receipt.openSearchComparator;
  assert.deepEqual([c.result, c.qualification, c.execution, c.candidatePolicy], ["failed", "passed", "complete", "blocked"]);
  assert.deepEqual(c.commandIndices, [1, 2]);
  assert.deepEqual(f.events, ["checkpoints", "before", "disk", "clock", "json", "clock", "cyclonedx", "after"]);
  assert.deepEqual(f.receipt.blockers, []);
  assert.equal(f.calls[0].historicalInputsMatch, false);
  assert.equal(f.calls[0].candidateBlockers[0].role, "opensearch-candidate");
  const bytes = await readFile(path.join(f.dir, c.delta.file));
  assert.equal(c.delta.sha256, sha(bytes));
  assert.equal(c.delta.size, bytes.length);
  const delta = JSON.parse(bytes);
  assert.equal(delta.inventory.findings[0].VulnerabilityID, "CVE-TEST");
  assert.equal(delta.historical.runId, "44321947040");
  assert.equal(delta.reports.length, 4);
});

test("the baseline's policy refusal survives a clean candidate", async (t) => {
  const f = await fixture(t, { oldBlocked: true });
  const c = await f.run();
  assert.deepEqual([c.result, c.qualification, c.candidatePolicy], ["passed", "passed", "clean"]);
  assert.deepEqual(f.calls[0].oldBlockers, f.receipt.blockers);
  assert.equal(f.receipt.blockers.length, 1);
});

for (const [name, mutate, reason] of [
  ["missing verifier", (a) => { delete a.verifyCheckpoints; }, /checkpoints_invalid/u],
  ["ineligible prior scans", (a) => { a.verifyCheckpoints = () => false; }, /checkpoints_invalid/u],
  ["corrupt earlier checkpoint", (a) => { a.verifyCheckpoints = () => { throw new Error("checkpoint_hash"); }; }, /checkpoint_hash/u],
  ["managed scope", (a) => { a.receipt.scope = "managed"; }, /checkpoints_invalid/u],
  ["old image substitution", (a) => { a.config = { ...release, images: [{ ...previous, version: "3.10.0" }] }; }, /baseline_invalid/u],
  ["missing old report hash", (a) => { delete a.receipt.reports[0].report[0].sha256; }, /frozen_input_changed/u],
  ["absent scanner", (a) => { delete a.receipt.awsComparisonInputs.scanner; }, /inputs_invalid/u],
  ["absent DB", (a) => { a.receipt.awsComparisonInputs.databaseFiles.pop(); }, /inputs_invalid/u],
  ["missing DB size", (a) => { delete a.receipt.awsComparisonInputs.databaseFiles[0].size; }, /inputs_invalid/u],
  ["duplicated DB", (a) => { a.receipt.awsComparisonInputs.databaseFiles.push(a.receipt.awsComparisonInputs.databaseFiles[0]); }, /inputs_invalid/u],
  ["substituted historical replay", (a) => { a.receipt.awsComparisonInputs.databaseFiles[0].sha256 = "7244f40ff53c4ac2909d8fba04aa4937354a620c380dc83bbc51df715f6cd68d"; }, /historical_replay_changed/u],
  ["one byte below 12 GiB", (a) => { a.availableBytes = () => diskFloor - 1; }, /insufficient_disk/u],
  ["one ms below 12 minutes", (a) => { a.remainingTimeMs = () => 12 * 60_000 - 1; }, /insufficient_time/u],
  ["unavailable step budget", (a) => { delete a.remainingTimeMs; }, /insufficient_time/u],
]) {
  test("no candidate commands for " + name, async (t) => {
    const f = await fixture(t);
    mutate(f.args);
    await assert.rejects(f.run(), reason);
    assert.equal(f.receipt.commands.length, 0);
    assert.equal(f.receipt.openSearchComparator.qualification, "failed");
  });
}

for (const [name, options, reason, expectedCommands] of [
  ["malformed JSON", { stdout: (fmt) => fmt === "json" ? "{" : undefined }, /json_file_invalid/u, 1],
  ["substituted valid bytes", { afterWrite: (fmt, target) => fmt === "json" && writeFile(target, "{}", { flag: "w" }) }, /frozen_input_changed/u, 1],
  ["wrong config", { mutatePair: (p) => { p.json.Metadata.ImageID = previousConfig; } }, /json_subject_invalid/u, 1],
  ["3.9 layer DiffIDs under the correct 3.10 config label", { mutatePair: (p) => {
    p.json.Metadata.DiffIDs = baselineMetadata.DiffIDs;
  } }, /scanner_opensearch_/u, 1],
  ["3.9 layer descriptors under the correct 3.10 config label", { mutatePair: (p) => {
    p.json.Metadata.Layers = baselineMetadata.Layers;
  } }, /scanner_opensearch_/u, 1],
  ["wrong subject", { mutatePair: (p) => { p.json.ArtifactName = previous.repository; } }, /json_subject_invalid/u, 1],
  ["wrong schema", { mutatePair: (p) => { p.json.SchemaVersion = 1; } }, /image_report_invalid/u, 1],
  ["wrong SBOM config", { mutatePair: (p) => { p.cyclonedx.metadata.component.properties[0].value = previousConfig; } }, /sbom_subject_invalid/u, 2],
  ["wrong old SBOM config", { oldWrongConfig: true }, /sbom_subject_invalid/u, 0],
  ["missing SBOM", { afterWrite: (fmt, target) => fmt === "cyclonedx" && rm(target) }, /ENOENT/u, 2],
  ["absent owned cleanup", { command: (_fmt, record) => { delete record.ownedContainerAbsent; } }, /cleanup_uncertain/u, 1],
  ["duplicate lease", { command: (fmt, record, r) => { if (fmt === "cyclonedx") record.lease.name = r.commands[0].lease.name; } }, /command_invalid/u, 2],
  ["nonzero exit even with stdout", { command: (_fmt, record) => { record.exitCode = 1; } }, /command_failed/u, 1],
]) {
  test("rejects " + name, async (t) => {
    const f = await fixture(t, options);
    await assert.rejects(f.run(), reason);
    const c = f.receipt.openSearchComparator;
    assert.equal(c.commandIndices.length, expectedCommands);
    assert.equal(c.qualification, "failed");
    assert.equal(c.candidatePolicy, "unmeasured");
    assert.equal(c.delta, undefined);
  });
}

test("time is measured again after authenticated JSON and cleanup", async (t) => {
  const f = await fixture(t);
  f.args.remainingTimeMs = () => f.receipt.commands.length ? 719999 : 720000;
  await assert.rejects(f.run(), /insufficient_time/u);
  const c = f.receipt.openSearchComparator;
  assert.deepEqual([c.execution, c.commandIndices, c.formats.map((f) => f.status)], ["partial", [1], ["captured", "refused"]]);
  assert.equal(c.formats[0].sha256, sha(await readFile(path.join(f.dir, c.formats[0].file))));
});

for (const [code, exit, cause] of [["ENOSPC", 1, "ENOSPC"], ["ETIMEDOUT", null, "timeout"], [null, 137, "unknown"]]) {
  test("command resource cause " + cause, async (t) => {
    const f = await fixture(t, { command: (_fmt, record) => {
      record.error = code;
      record.exitCode = exit;
      throw new Error("scanner_official_command_failed");
    } });
    await assert.rejects(f.run(), /official_command_failed/u);
    const c = f.receipt.openSearchComparator;
    assert.equal(c.formats[0].cause, cause);
    assert.equal(c.commandIndices.length, 1);
  });
}

test("retains both inventory refusal evidence and candidate policy", async (t) => {
  const f = await fixture(t, { blocked: true });
  f.args.buildOpenSearchComparison = () => ({ qualification: "failed", reason: "scanner_inventory_loss", missing: ["plugin/a.jar"] });
  await assert.rejects(f.run(), /scanner_inventory_loss/u);
  const c = f.receipt.openSearchComparator;
  assert.deepEqual([c.result, c.qualification, c.candidatePolicy, c.execution], ["failed", "failed", "blocked", "complete"]);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dir, c.delta.file))).inventory.missing, ["plugin/a.jar"]);
});

test("rejects changed report after inventory interpretation", async (t) => {
  const f = await fixture(t, { blocked: true });
  f.args.buildOpenSearchComparison = async () => {
    await writeFile(file(f.dir, previous.role, "json"), "{}");
    return { qualification: "passed" };
  };
  await assert.rejects(f.run(), /frozen_input_changed/u);
  assert.equal(f.receipt.openSearchComparator.delta, undefined);
  assert.equal(f.receipt.openSearchComparator.candidatePolicy, "blocked");
});

test("bounded delta refuses repeated path expansion before publication", async (t) => {
  const f = await fixture(t);
  f.args.buildOpenSearchComparison = () => ({ qualification: "passed", paths: Array(65).fill("P".repeat(1024 ** 2)) });
  await assert.rejects(f.run(), /delta_limit/u);
  await assert.rejects(readFile(path.join(f.dir, "image-opensearch-comparison.json")), { code: "ENOENT" });
});


test("exact same-DB replay admits all 82 original ordered blockers", async (t) => {
  const f = await fixture(t, { mutateOld: (pair) => {
    pair.json = { ...baselineReport, CreatedAt: new Date().toISOString() };
    pair.cyclonedx = baselineSbom;
    validateOfficialImageSbom(pair.json, pair.cyclonedx, previous);
  } });
  f.receipt.awsComparisonInputs.databaseFiles[0].sha256 = "7244f40ff53c4ac2909d8fba04aa4937354a620c380dc83bbc51df715f6cd68d";
  await f.run();
  assert.equal(f.calls[0].historicalInputsMatch, true);
  assert.equal(f.calls[0].oldBlockers.length, 82);
});

test("records an explicit OOM observation on the failed command", async (t) => {
  const f = await fixture(t, { command: (_fmt, row) => { row.exitCode = 137; row.oomKilled = true; } });
  await assert.rejects(f.run(), /command_failed/u);
  assert.equal(f.receipt.openSearchComparator.formats[0].cause, "OOM");
});

test("rejects altered JSON cleanup evidence during the second command", async (t) => {
  const f = await fixture(t, { command: (fmt, _row, receipt) => {
    if (fmt === "cyclonedx") receipt.commands[0].ownedContainerAbsent = false;
  } });
  await assert.rejects(f.run(), /execution_incomplete/u);
  assert.equal(f.receipt.openSearchComparator.qualification, "failed");
});
