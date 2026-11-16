import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/scanner/retention-setup-buildx.sh", import.meta.url));
const linux = process.platform === "linux";

test("Buildx setup refuses unsafe contexts before any command or host effect", { skip: !linux }, (context) => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "scanner-buildx-refusal-"));
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const guard = path.join(temporary, "guard.sh");
  // Catch external commands and sudo even if an invalid-context guard regresses.
  writeFileSync(guard, "trap 'case $BASH_COMMAND in uname*|id*|grep*|stat*|sudo*|mktemp*|env*|curl*|sha256sum*) printf COMMAND_REACHED >&2; exit 97;; esac' DEBUG\n");
  const env = { PATH: "/usr/bin:/bin", BASH_ENV: guard,
    GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux",
    RUNNER_TEMP: "/home/runner/work/_temp", GITHUB_REPOSITORY: "CleMeY15/auto-world" };
  const cases = [
    { args: ["unexpected"], env },
    { args: [], env: { ...env, GITHUB_ACTIONS: "false" } },
    { args: [], env: { ...env, RUNNER_ENVIRONMENT: "self-hosted" } },
    { args: [], env: { ...env, RUNNER_OS: "Windows" } },
    { args: [], env: { ...env, RUNNER_TEMP: temporary } },
    { args: [], env: { ...env, GITHUB_REPOSITORY: "untrusted/fork" } },
  ];
  for (const item of cases) {
    const result = spawnSync("/bin/bash", [script, ...item.args], { env: item.env, encoding: "utf8", timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "scanner_retention_buildx_context_invalid\n");
  }
});

test("Buildx probe and publisher use the same setup before publisher provenance", () => {
  const readWorkflow = (file) => JSON.parse(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url)));
  const publisher = readWorkflow("scanner-retention-publish.yml").jobs.publish;
  const setup = publisher.steps.findIndex((step) => step.run === "bash scripts/scanner/retention-setup-buildx.sh");
  assert.ok(setup >= 0 && setup < publisher.steps.findIndex((step) => step.id === "provenance"));
  const probe = readWorkflow("scanner-retention-tools-tests.yml");
  assert.deepEqual(probe.permissions, { contents: "read" });
  assert.equal(probe.on.workflow_dispatch, undefined);
  const steps = probe.jobs["buildx-discovery"].steps;
  assert.equal(steps.at(-2).run, "bash scripts/scanner/retention-setup-buildx.sh");
  assert.equal(steps.at(-1).run, "node scripts/scanner/retention-tools-probe.mjs");
  assert.equal(probe.jobs["buildx-discovery"]["timeout-minutes"], 10);
  for (const event of ["pull_request", "push"]) {
    assert.ok(probe.on[event].paths.includes("infra/scanner/retention-publisher-tools.json"));
  }
  const module = readFileSync(new URL("../scripts/scanner/retention-tools-probe.mjs", import.meta.url), "utf8");
  assert.match(module, /scannerRetentionPublisherChildEnvironment\(context, config, work\)/u);
  assert.match(module, /validateScannerRetentionPublisherTools/u);
});
