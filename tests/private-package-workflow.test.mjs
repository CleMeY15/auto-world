import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = JSON.parse(await readFile(new URL('../.github/workflows/private-package-proof.yml', import.meta.url), 'utf8'));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' }}";

test('private proof can run only by explicit main dispatch with separate job permissions', () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ['publish', 'verify']);
  assert.deepEqual(workflow.jobs.publish.permissions, { contents: 'read', packages: 'write' });
  assert.deepEqual(workflow.jobs.verify.permissions, { contents: 'read', packages: 'read' });
  assert.equal(workflow.jobs.verify.needs, 'publish');
  assert.deepEqual(workflow.jobs.publish.outputs, { digest: '${{ steps.publish.outputs.digest }}' });
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
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|id-token|attest|pull_request|workflow_run/i);
});

test('proof jobs use pinned actions, ephemeral job tokens and only exact public receipt uploads', () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const actions = job.steps.filter((step) => step.uses);
    assert.deepEqual(actions.map((step) => step.uses.split('@')[0]), ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
    for (const action of actions) assert.match(action.uses, /@[a-f0-9]{40}$/);
    assert.deepEqual(actions[0].with, { 'persist-credentials': false });
    assert.equal(actions[1].with['node-version'], '22.23.2');
    const upload = actions[2];
    assert.equal(upload.if, '${{ always() }}');
    assert.equal(upload.with.path, '${{ runner.temp }}/package-registry-proof/receipt.json');
    assert.equal(upload.with['retention-days'], 14);
    assert.equal(upload.with['if-no-files-found'], 'error');
    const commands = job.steps.filter((step) => step.run);
    assert.equal(commands.length, 2);
    assert.equal(commands[0].id, name);
    assert.equal(commands[0]['continue-on-error'], true);
    assert.equal(commands[0].env.GITHUB_TOKEN, '${{ github.token }}');
    assert.equal(commands[1].if, `\${{ steps.${name}.outcome != 'success' }}`);
    assert.equal(commands[1].run, 'exit 1');
    assert.equal(commands[1].env, undefined);
    if (name === 'publish') {
      assert.deepEqual(commands[0].env, { GITHUB_TOKEN: '${{ github.token }}' });
      assert.equal(commands[0].run, 'node scripts/package-bootstrap/registry-proof.mjs publish --output "${RUNNER_TEMP}/package-registry-proof"');
    } else {
      assert.deepEqual(commands[0].env, { GITHUB_TOKEN: '${{ github.token }}', PROOF_DIGEST: '${{ needs.publish.outputs.digest }}' });
      assert.equal(commands[0].run, 'node scripts/package-bootstrap/registry-proof.mjs verify --digest "${PROOF_DIGEST}" --output "${RUNNER_TEMP}/package-registry-proof"');
    }
  }
});
