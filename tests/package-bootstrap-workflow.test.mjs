import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = JSON.parse(await readFile(new URL('../.github/workflows/package-bootstrap.yml', import.meta.url), 'utf8'));

test('preparation workflow grants only source read and accepts no dispatch inputs', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const job = workflow.jobs.prepare;
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 10);
  assert.equal(job.permissions, undefined);
  assert.equal(job.secrets, undefined);
  assert.equal(job.container, undefined);
  assert.equal(job.services, undefined);
  assert.equal(job.env, undefined);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|github\.token|id-token|packages\s*"\s*:/i);
});

test('preparation retains only its receipt, propagates failure and pins managed actions', () => {
  const steps = workflow.jobs.prepare.steps;
  const actions = steps.filter((step) => step.uses);
  assert.deepEqual(actions.map((step) => step.uses.split('@')[0]), ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
  for (const action of actions) assert.match(action.uses, /@[a-f0-9]{40}$/);
  assert.deepEqual(actions[0].with, { 'persist-credentials': false });
  assert.equal(actions[1].with['node-version'], '22.23.2');
  const upload = actions[2];
  assert.equal(upload.if, '${{ always() }}');
  assert.deepEqual(upload.with, {
    name: 'package-preparation-receipt',
    path: '${{ runner.temp }}/package-bootstrap/receipt.json',
    'if-no-files-found': 'error',
    'retention-days': 14,
    'compression-level': 6,
  });
  const commands = steps.filter((step) => step.run);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].run, 'node scripts/package-bootstrap/prepare.mjs --output "${RUNNER_TEMP}/package-bootstrap"');
  assert.equal(commands[0]['continue-on-error'], true);
  assert.equal(commands[1].if, "${{ steps.prepare.outcome != 'success' }}");
  assert.equal(commands[1].run, 'exit 1');
  for (const step of steps) assert.equal(step.env, undefined);
});
