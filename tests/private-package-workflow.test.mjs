import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = JSON.parse(await readFile(new URL('../.github/workflows/private-package-proof.yml', import.meta.url), 'utf8'));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' }}";

const proofDigest = 'sha256:eac8525e2bae0875846d4ee9f6fe75908b2ac4724e49b56653e4aa3fe8bd61b6';

test('private package read proof can run only by explicit main dispatch with read-only permissions', () => {
  assert.equal(workflow.name, 'Private package read proof');
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ['verify']);
  assert.deepEqual(workflow.jobs.verify.permissions, { contents: 'read', packages: 'read' });
  assert.equal(workflow.jobs.verify.needs, undefined);
  assert.equal(workflow.jobs.verify.outputs, undefined);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.if, mainOnly);
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    assert.equal(job['timeout-minutes'], 10);
    assert.equal(job.secrets, undefined);
    assert.equal(job.container, undefined);
    assert.equal(job.services, undefined);
    assert.equal(job.env, undefined);
  }
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|id-token|attest|pull_request|workflow_run|packages["']?\s*:\s*["']write|\bpublish\b/i);
});

test('read proof uses pinned actions, the fixed existing digest, and one exact public receipt', () => {
  const job = workflow.jobs.verify;
  const actions = job.steps.filter((step) => step.uses);
  assert.deepEqual(actions.map((step) => step.uses.split('@')[0]), ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
  for (const action of actions) assert.match(action.uses, /@[a-f0-9]{40}$/);
  assert.deepEqual(actions[0].with, { 'persist-credentials': false });
  assert.equal(actions[1].with['node-version'], '22.23.2');
  const upload = actions[2];
  assert.equal(upload.if, '${{ always() }}');
  assert.deepEqual(upload.with, {
    name: 'private-package-verification-receipt',
    path: '${{ runner.temp }}/package-registry-proof/receipt.json',
    'if-no-files-found': 'error',
    'retention-days': 14,
    'compression-level': 6,
  });
  const commands = job.steps.filter((step) => step.run);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].id, 'verify');
  assert.equal(commands[0]['continue-on-error'], true);
  assert.deepEqual(commands[0].env, { GITHUB_TOKEN: '${{ github.token }}', PROOF_DIGEST: proofDigest });
  assert.equal(commands[0].run, 'node scripts/package-bootstrap/registry-proof.mjs verify --digest "${PROOF_DIGEST}" --output "${RUNNER_TEMP}/package-registry-proof"');
  assert.equal(commands[1].if, "${{ steps.verify.outcome != 'success' }}");
  assert.equal(commands[1].run, 'exit 1');
  assert.equal(commands[1].env, undefined);
  assert.doesNotMatch(JSON.stringify(workflow), /registry-proof\.mjs publish|needs\.|steps\.publish|outputs|buildx|docker\s+push/i);
});
