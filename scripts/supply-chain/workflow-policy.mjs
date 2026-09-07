import { policyError } from "./process.mjs";

// Closed grammar for this reviewed workflow only, not general YAML support or a
// repository-wide permission ceiling. No block or action input is left unchecked.
const header = `name: Native bootstrap preparation

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: native-bootstrap-\${{ github.ref }}
  cancel-in-progress: true

jobs:
`;
const preludes = {
  policy: `    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
`,
  "lock-proposal": `    needs: policy
    runs-on: ubuntu-24.04
    timeout-minutes: \${{ matrix.timeout }}
    strategy:
      fail-fast: false
      max-parallel: 2
      matrix:
        include:
          - tool: oras
            timeout: 30
          - tool: cosign
            timeout: 60
          - tool: trivy
            timeout: 90
    steps:
`,
  "native-build": `    needs: policy
    runs-on: ubuntu-24.04
    timeout-minutes: \${{ matrix.timeout }}
    strategy:
      fail-fast: false
      max-parallel: 2
      matrix:
        include:
          - tool: oras
            repeat: 1
            timeout: 30
          - tool: oras
            repeat: 2
            timeout: 30
          - tool: cosign
            repeat: 1
            timeout: 60
          - tool: cosign
            repeat: 2
            timeout: 60
          - tool: trivy
            repeat: 1
            timeout: 90
          - tool: trivy
            repeat: 2
            timeout: 90
    steps:
`,
  "native-reproducibility": `    needs: native-build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
`,
  "native-cli": `    needs: native-reproducibility
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    steps:
`,
  "native-audit": `    needs: native-reproducibility
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    steps:
`,
  "baseline-inventory": `    needs: policy
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
`,
  "baseline-comparison": `    needs: [native-audit, baseline-inventory]
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    steps:
`,
  installation: `    needs: [native-reproducibility, native-cli, native-audit, baseline-comparison]
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
`,
};
const bodies = {
  checkout: `        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: \${{ github.sha }}
          persist-credentials: false`,
  node: `        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.23.2`,
  tests: "        run: node --test tests/supply-chain-*.test.mjs",
  status: "        run: node scripts/supply-chain/dormant.mjs status",
  refusal: "        run: node scripts/supply-chain/dormant.mjs installation",
  proposal: `        env:
          BOOTSTRAP_TOOL: \${{ matrix.tool }}
        run: >-
          node scripts/supply-chain/lock-update.mjs propose
          --tool "$BOOTSTRAP_TOOL"
          --workspace "$RUNNER_TEMP/auto-world-native-$BOOTSTRAP_TOOL"
          --output "$RUNNER_TEMP/native-lock-$BOOTSTRAP_TOOL.json"`,
  artifact: `        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: native-lock-\${{ matrix.tool }}
          path: |
            \${{ runner.temp }}/native-lock-\${{ matrix.tool }}.json
            \${{ runner.temp }}/auto-world-native-\${{ matrix.tool }}/proposal-assets
          if-no-files-found: error
          retention-days: 30`,
  build: `        env:
          BOOTSTRAP_TOOL: \${{ matrix.tool }}
          BOOTSTRAP_REPEAT: \${{ matrix.repeat }}
        run: >-
          node scripts/supply-chain/native-build.mjs build
          --tool "$BOOTSTRAP_TOOL"
          --repeat "$BOOTSTRAP_REPEAT"
          --lock "$GITHUB_WORKSPACE/infra/supply-chain/native-materials.lock.json"
          --workspace "$RUNNER_TEMP/auto-world-native-build-$BOOTSTRAP_TOOL-$BOOTSTRAP_REPEAT"
          --output "$RUNNER_TEMP/native-build-$BOOTSTRAP_TOOL-$BOOTSTRAP_REPEAT.json"`,
  package: `        env:
          BOOTSTRAP_TOOL: \${{ matrix.tool }}
          BOOTSTRAP_REPEAT: \${{ matrix.repeat }}
        run: >-
          node scripts/supply-chain/candidate-artifacts.mjs package
          --tool "$BOOTSTRAP_TOOL" --repeat "$BOOTSTRAP_REPEAT"`,
  candidate: `        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: native-candidate-\${{ matrix.tool }}-\${{ matrix.repeat }}
          path: \${{ runner.temp }}/native-candidate-\${{ matrix.tool }}-\${{ matrix.repeat }}
          if-no-files-found: error
          retention-days: 30`,
  download: `        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          pattern: native-candidate-*
          path: \${{ runner.temp }}/native-candidates
          merge-multiple: false`,
  compare: "        run: node scripts/supply-chain/candidate-artifacts.mjs verify",
  comparison: `        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: native-reproducibility
          path: \${{ runner.temp }}/native-reproducibility.json
          if-no-files-found: error
          retention-days: 30`,
  cli: "        run: node scripts/supply-chain/native-cli.mjs",
  cliEvidence: `        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: native-cli
          path: \${{ runner.temp }}/native-cli
          if-no-files-found: error
          retention-days: 30`,
  audit: "        run: node scripts/supply-chain/native-scan.mjs",
  auditEvidence: `        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: native-audit
          path: \${{ runner.temp }}/native-audit
          if-no-files-found: error
          retention-days: 30`,
  baselineInventory: "        run: node scripts/supply-chain/baseline-scanner.mjs inventory",
  baselineInventoryEvidence: `        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: baseline-inventory
          path: \${{ runner.temp }}/baseline-inventory
          if-no-files-found: error
          retention-days: 30`,
  auditDownload: `        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: native-audit
          path: \${{ runner.temp }}/native-audit`,
  baselineCompare: "        run: node scripts/supply-chain/baseline-scanner.mjs compare",
  baselineCompareEvidence: `        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: baseline-comparison
          path: \${{ runner.temp }}/baseline-comparison
          if-no-files-found: error
          retention-days: 30`,
};
const sequences = {
  policy: ["checkout", "node", "tests", "status"],
  "lock-proposal": ["checkout", "node", "proposal", "artifact", "refusal"],
  "native-build": ["checkout", "node", "build", "package", "candidate"],
  "native-reproducibility": ["checkout", "node", "download", "compare", "comparison"],
  "native-cli": ["checkout", "node", "download", "cli", "cliEvidence"],
  "native-audit": ["checkout", "node", "download", "audit", "auditEvidence"],
  "baseline-inventory": ["checkout", "node", "baselineInventory", "baselineInventoryEvidence"],
  "baseline-comparison": ["checkout", "node", "download", "auditDownload", "baselineCompare", "baselineCompareEvidence"],
  installation: ["checkout", "node", "refusal"],
};

export function validatePreparationWorkflow(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > 64 * 1024) throw policyError("workflow_size_refused");
  const text = input.replaceAll("\r\n", "\n");
  if (!text.startsWith(header)) throw policyError("workflow_header_refused");
  const jobs = text.slice(header.length).split(/(?=^[ ]{2}[a-z][a-z-]*:\n)/mu);
  if (jobs.length !== Object.keys(sequences).length) throw policyError("workflow_jobs_refused");
  for (const [index, name] of Object.keys(sequences).entries()) {
    const prefix = `  ${name}:\n${preludes[name]}`;
    const job = jobs[index].trimEnd();
    if (!job.startsWith(prefix)) throw policyError("workflow_job_refused");
    const steps = job.slice(prefix.length).split(/(?=^[ ]{6}- name: )/mu);
    if (steps.length !== sequences[name].length) throw policyError("workflow_steps_refused");
    for (const [stepIndex, kind] of sequences[name].entries()) {
      const step = steps[stepIndex].trimEnd();
      const newline = step.indexOf("\n");
      if (newline < 0 || !/^[ ]{6}- name: [A-Za-z0-9 ()/-]+$/u.test(step.slice(0, newline)) ||
          step.slice(newline + 1) !== bodies[kind]) throw policyError("workflow_step_refused");
    }
  }
  return Object.freeze({ scope: "reviewed_workflow_only", capabilities: Object.freeze([]) });
}
