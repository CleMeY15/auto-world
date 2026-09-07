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
};
const sequences = { policy: ["checkout", "node", "tests", "status"], "lock-proposal": ["checkout", "node", "proposal", "artifact", "refusal"] };

export function validatePreparationWorkflow(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > 64 * 1024) throw policyError("workflow_size_refused");
  const text = input.replaceAll("\r\n", "\n");
  if (!text.startsWith(header)) throw policyError("workflow_header_refused");
  const jobs = text.slice(header.length).split(/(?=^[ ]{2}[a-z][a-z-]*:\n)/mu);
  if (jobs.length !== 2) throw policyError("workflow_jobs_refused");
  for (const [index, name] of ["policy", "lock-proposal"].entries()) {
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
