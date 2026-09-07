import { TextDecoder } from "node:util";
import { assertClosedObject, sha256 } from "./strict-json.mjs";
import { policyError } from "./process.mjs";
import { validatePreparationWorkflow } from "./workflow-policy.mjs";

export const NATIVE_WORKFLOW_PATH = ".github/workflows/native-bootstrap.yml";
const REPOSITORY = "CleMeY15/auto-world";
const FIELDS = ["id", "attempt", "workflowSha", "sourceSha", "workflowRef", "event", "workflowFileSha256"];
const fail = () => { throw policyError("native_ci_identity_invalid"); };

function validateShape(run) {
  assertClosedObject(run, FIELDS);
  if (typeof run.id !== "string" || !/^[1-9][0-9]{0,19}$/u.test(run.id) || !Number.isSafeInteger(run.attempt) || run.attempt < 1 ||
      !/^[a-f0-9]{40}$/u.test(run.workflowSha) || !/^[a-f0-9]{40}$/u.test(run.sourceSha) ||
      !/^[a-f0-9]{64}$/u.test(run.workflowFileSha256) || typeof run.workflowRef !== "string") fail();
  const prefix = `${REPOSITORY}/${NATIVE_WORKFLOW_PATH}@`;
  if (!run.workflowRef.startsWith(prefix)) fail();
  const ref = run.workflowRef.slice(prefix.length);
  if (run.event === "push" ? ref !== "refs/heads/main" : run.event !== "pull_request" || !/^refs\/pull\/[1-9][0-9]*\/merge$/u.test(ref)) fail();
  return ref;
}

// The caller supplies actual GitHub context and bounded bytes read from the exact
// clean checkout. No receipt or downloaded artifact supplies these expectations.
export function createNativeCiIdentity(environment, workflowBytes) {
  if (environment.GITHUB_ACTIONS !== "true" || environment.GITHUB_REPOSITORY !== REPOSITORY ||
      !/^[1-9][0-9]*$/u.test(environment.GITHUB_RUN_ATTEMPT ?? "") || !Buffer.isBuffer(workflowBytes) ||
      workflowBytes.length < 1 || workflowBytes.length > 64 * 1024) fail();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(workflowBytes);
  validatePreparationWorkflow(text);
  const run = { id: environment.GITHUB_RUN_ID, attempt: Number(environment.GITHUB_RUN_ATTEMPT),
    workflowSha: environment.GITHUB_WORKFLOW_SHA, sourceSha: environment.GITHUB_SHA,
    workflowRef: environment.GITHUB_WORKFLOW_REF, event: environment.GITHUB_EVENT_NAME,
    workflowFileSha256: sha256(workflowBytes) };
  if (validateShape(run) !== environment.GITHUB_REF) fail();
  return Object.freeze(run);
}

export function validateNativeCiIdentity(run, expected) {
  validateShape(run);
  validateShape(expected);
  if (FIELDS.some((key) => run[key] !== expected[key])) fail();
  return run;
}
