import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const workflow = JSON.parse(await readFile(path.join(root, ".github/workflows/data-foundation-audit.yml"), "utf8"));
const release = JSON.parse(await readFile(path.join(root, "infra/scanner/official-release.json"), "utf8"));
const steps = (value) => value.jobs.audit.steps;
const step = (value, id) => steps(value).find((entry) => entry.id === id);
const clone = () => JSON.parse(JSON.stringify(workflow));
const actions = {
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  node: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  upload: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
};

function assertReadOnlyBoundary(value) {
  assert.deepEqual(value.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(value.jobs), ["audit"]);
  const job = value.jobs.audit;
  assert.equal(job.permissions, undefined);
  assert.equal(job.env, undefined);
  for (const entry of steps(value)) {
    assert.equal(entry.permissions, undefined);
    if (entry.id === "provenance") {
      assert.deepEqual(entry.env, { GH_TOKEN: "${{ github.token }}", GH_DEBUG: "", GH_PROMPT_DISABLED: "1" });
    } else {
      assert.equal(entry.env, undefined);
      assert.doesNotMatch(entry.run ?? "", /\$\{\{\s*(?:secrets|github\.token)/u);
    }
  }
  assert.match(step(value, "audit").run, /env -u GH_TOKEN -u GITHUB_TOKEN -u NODE_AUTH_TOKEN node /u);
  assert.equal(steps(value).find((entry) => entry.uses === actions.checkout).with["persist-credentials"], false);
}

function assertQualificationOrder(value) {
  const source = step(value, "provenance").run;
  const positions = [
    source.indexOf("stat --printf=%s"),
    source.indexOf("sha256sum --check --strict"),
    source.indexOf("gh attestation verify"),
    source.indexOf("verification-identity.json"),
    source.indexOf("expect_refusal changed-bytes"),
    source.indexOf("expect_refusal wrong-source"),
    source.indexOf("expect_refusal wrong-workflow"),
    source.indexOf("expect_refusal wrong-ref"),
    source.indexOf("verification-after-controls.json"),
    source.indexOf("\ntar --extract"),
    source.indexOf("go version -m"),
  ];
  assert.ok(positions.every((position) => position >= 0), "each acquisition, refusal and inspection phase is present");
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.equal([...source.matchAll(/\btar --extract/gu)].length, 1);
  assert.match(source, /--no-same-owner --no-same-permissions -- trivy/u);
  assert.match(source, /--bundle "\$bundle" --repo "\$repository"/u);
  assert.match(source, /--cert-identity "\$4" --cert-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/u);
  assert.match(source, /--source-digest "\$2" --source-ref "\$3" --deny-self-hosted-runners/u);
  assert.match(source, /--signer-workflow "\$workflow"/u);
  assert.match(source, /test "\$status" -eq 1/u);
  assert.match(source, /grep -Fq -- "\$expected_message"/u);
  assert.match(source, /printf '\\000' >> "\$root\/negative\/changed-bytes\.tar\.gz"/u);
  assert.doesNotMatch(source, /\b(?:sudo|apt-get|pip|npm install|docker (?:run|pull|build|push))\b/u);
}

function assertFailureEnforcement(value) {
  for (const entry of steps(value)) assert.equal(entry["continue-on-error"], undefined);
  const audit = step(value, "audit");
  assert.equal(audit.if, undefined);
  assert.equal(audit["timeout-minutes"], 60);
  assert.match(audit.run, /^set -euo pipefail\n/u);
  assert.doesNotMatch(audit.run, /\|\|\s*(?:true|:)|set \+e/u);
  const upload = steps(value).find((entry) => entry.uses === actions.upload);
  assert.equal(upload.if, "${{ always() }}");
  const final = steps(value).at(-1);
  assert.equal(final.if, "${{ always() && steps.audit.outcome != 'success' }}");
  assert.equal(final.run, "exit 1");
  assert.ok(steps(value).indexOf(upload) > steps(value).indexOf(audit));
}

function assertPublicAllowlist(value) {
  const upload = steps(value).find((entry) => entry.uses === actions.upload);
  const entries = upload.with.path.split("\n");
  assert.equal(new Set(entries).size, entries.length);
  assert.ok(entries.includes("${{ runner.temp }}/data-foundation-audit/database-evidence.json"),
    "retain actual database timestamps, hashes and freshness decisions after the runner exits");
  const auditFiles = new Set([
    "official-audit-receipt.json", "scanner-self.json", "scanner-self.cdx.json",
    "scanner-version-probe.json", "scanner-version.txt", "go-build-info.txt",
    "fixture-*-official.json", "fixture-*-baseline.json", "image-*.json",
    "database-*-manifest.json", "database-evidence.json", "carrier-inspect.json", "docker-version.json", "buildx-version.txt",
  ]);
  for (const entry of entries) {
    const prefix = "${{ runner.temp }}/";
    assert.ok(entry.startsWith(prefix));
    const relative = entry.slice(prefix.length);
    if (relative.startsWith("trivy-provenance/public/")) {
      assert.match(relative, /^trivy-provenance\/public\/[a-z0-9.-]+\.(?:json|jsonl|tsv|txt)$/u);
    } else {
      assert.ok(relative.startsWith("data-foundation-audit/"));
      assert.ok(auditFiles.has(relative.slice("data-foundation-audit/".length)));
    }
    assert.doesNotMatch(relative, /(?:^|\/)(?:bin|download|negative|cache|db|private|\.omx)(?:\/|$)|\.tar(?:\.gz)?$|\.zip$|\.stderr$|\.stdout$|\*\*/u);
  }
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["retention-days"], 14);
}

test("diagnostic workflow uses exact managed tools without write or retained checkout authority", () => {
  assertReadOnlyBoundary(workflow);
  assert.equal(workflow.jobs.audit["runs-on"], "ubuntu-24.04");
  assert.equal(workflow.jobs.audit["timeout-minutes"], 75);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(steps(workflow).filter((entry) => entry.uses).map((entry) => entry.uses),
    [actions.checkout, actions.node, actions.upload]);
  const node = steps(workflow).find((entry) => entry.uses === actions.node);
  assert.deepEqual(node.with, { "node-version": "22.23.4", "package-manager-cache": false, cache: "" });
  assert.match(step(workflow, "tests").run, /test "\$\(node --version\)" = v22\.23\.4/u);
});

test("permission and credential mutations cannot move authority into candidate execution", () => {
  for (const mutate of [
    (value) => { value.permissions.packages = "write"; },
    (value) => { value.jobs.audit.permissions = { contents: "write" }; },
    (value) => { value.jobs.audit.env = { GH_TOKEN: "${{ github.token }}" }; },
    (value) => { step(value, "audit").env = { GH_TOKEN: "${{ github.token }}" }; },
    (value) => { steps(value)[0].with["persist-credentials"] = true; },
    (value) => { step(value, "audit").run = step(value, "audit").run.replace("-u GH_TOKEN ", ""); },
  ]) {
    const changed = clone();
    mutate(changed);
    assert.throws(() => assertReadOnlyBoundary(changed));
  }
});

test("automatic audit triggers cover release, evaluator and fixture inputs on PRs and main", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push"]);
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.push.paths, workflow.on.pull_request.paths);
  for (const required of [
    ".github/workflows/data-foundation-audit.yml", "infra/scanner/official-release.json",
    "infra/scanner/scanner-lock.json", "infra/scanner/materials/scanner-fixtures/**",
    "scripts/scanner/official-*.mjs", "scripts/scanner/audit.mjs",
    "scripts/scanner/audit-policy.mjs", "scripts/scanner/controls.mjs", "tests/scanner-official-*.test.mjs",
  ]) assert.ok(workflow.on.pull_request.paths.includes(required));
  assert.doesNotMatch(JSON.stringify(workflow.on), /pull_request_target|workflow_run/u);
});

test("archive expectations bind the reviewed upstream release and all five candidate roles", () => {
  assert.deepEqual(release.scanner, {
    version: "0.76.1",
    sourceCommit: "e713f67f7d54decdcd9b3132c9751833dcced698",
    archive: { name: "trivy_0.76.1_Linux-64bit.tar.gz", bytes: 52676794,
      sha256: "c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0" },
    repository: "aquasecurity/trivy",
    signerWorkflow: "aquasecurity/trivy/.github/workflows/reusable-release.yaml",
    sourceRef: "refs/tags/v0.76.1",
    goVersion: "1.27.3",
  });
  assert.deepEqual(release.images.map((image) => image.role).sort(), ["aws-cli", "opensearch", "postgres", "redis", "seaweedfs"]);
  for (const image of release.images) {
    assert.match(image.manifestDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(image.platform.digest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(image.platform.os, "linux");
    assert.equal(image.platform.architecture, "amd64");
  }
});

test("positive and refusal controls precede single-member extraction and data-only build inspection", () => {
  assertQualificationOrder(workflow);
  const source = step(workflow, "provenance").run;
  for (const field of ["version", "repository", "archive.name", "archive.bytes", "archive.sha256", "sourceCommit", "sourceRef", "signerWorkflow"]) {
    assert.ok(source.includes("'.scanner." + field + "'"));
  }
  assert.match(source, /mkdir -- "\$root"/u);
  assert.doesNotMatch(source, /mkdir -p|--clobber/u);
});

test("missing refusal or early extraction is rejected by the ordering regression", () => {
  const missingRefusal = clone();
  step(missingRefusal, "provenance").run = step(missingRefusal, "provenance").run.replace("expect_refusal wrong-source", "unused wrong-source");
  assert.throws(() => assertQualificationOrder(missingRefusal));
  const earlyExtraction = clone();
  step(earlyExtraction, "provenance").run = "\ntar --extract\n" + step(earlyExtraction, "provenance").run;
  assert.throws(() => assertQualificationOrder(earlyExtraction));
});

test("three pure suites precede authenticated acquisition and scanner execution", () => {
  const tests = step(workflow, "tests");
  for (const file of ["scanner-official-controls.test.mjs", "scanner-official-audit.test.mjs", "scanner-official-workflow.test.mjs"]) {
    assert.ok(tests.run.includes("tests/" + file));
  }
  assert.ok(steps(workflow).indexOf(tests) < steps(workflow).indexOf(step(workflow, "provenance")));
  assert.ok(steps(workflow).indexOf(step(workflow, "provenance")) < steps(workflow).indexOf(step(workflow, "audit")));
  assert.match(step(workflow, "audit").run, /scripts\/scanner\/official-audit\.mjs/u);
  for (const argument of ["--scanner", "--build-info", "--output"]) {
    assert.ok(step(workflow, "audit").run.includes(argument + ' "${RUNNER_TEMP}/'));
  }
});

test("failed audit stays failed while the public evidence allowlist always uploads", () => {
  assertFailureEnforcement(workflow);
  assertPublicAllowlist(workflow);
});

test("masked failure, missing enforcement and broad artifact capture are rejected", () => {
  for (const mutate of [
    (value) => { step(value, "audit")["continue-on-error"] = true; },
    (value) => { step(value, "audit").if = "${{ false }}"; },
    (value) => { steps(value).at(-1).if = "${{ success() }}"; },
    (value) => { steps(value).find((entry) => entry.uses === actions.upload).if = "${{ success() }}"; },
  ]) {
    const changed = clone();
    mutate(changed);
    assert.throws(() => assertFailureEnforcement(changed));
  }
  for (const path of ["${{ runner.temp }}/**", "${{ runner.temp }}/trivy-provenance/download/*", "${{ runner.temp }}/data-foundation-audit/*"]) {
    const changed = clone();
    steps(changed).find((entry) => entry.uses === actions.upload).with.path += "\n" + path;
    assert.throws(() => assertPublicAllowlist(changed));
  }
});

test("database freshness evidence cannot be omitted from retained public reports", () => {
  const changed = clone();
  const upload = steps(changed).find((entry) => entry.uses === actions.upload);
  upload.with.path = upload.with.path.split("\n").filter((entry) => !entry.endsWith("/database-evidence.json")).join("\n");
  assert.throws(() => assertPublicAllowlist(changed));
});
