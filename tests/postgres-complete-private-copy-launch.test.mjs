import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { posix as path } from "node:path";
import { compilePostgresCoreEvidenceInventoryPolicy } from "../scripts/postgres-image/core-evidence-inventory-policy.mjs";
import { postgresCompletePrivateCopyPolicyContract, TEST_ONLY_compilePostgresCompletePrivateCopyPolicy } from
  "../scripts/postgres-image/complete-private-copy-policy.mjs";
import { loadPostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";
import { postgresCompletePrivateCopyLaunchControlReservedBytes } from "../scripts/postgres-image/complete-private-copy.mjs";
import { getPostgresLaunchControlExecutionId, getPostgresLaunchControlLaunchPlanSha256, getPostgresLaunchControlPolicySha256,
  getPostgresLaunchControlReferences, getPostgresLaunchControlSpecification, loadPostgresLaunchControlPolicy,
  postgresCompletePrivateCopyLaunchContract, runPostgresCompletePrivateCopyChild,
  TEST_ONLY_readPostgresCompletePrivateCopyLaunchFile,
  TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess,
  TEST_ONLY_loadPostgresCompletePrivateCopyLaunchPlan, TEST_ONLY_loadPostgresLaunchControlPolicy,
  TEST_ONLY_runPostgresCompletePrivateCopyChild, validateLoadedPostgresCompletePrivateCopyLaunchPlan,
  validateLoadedPostgresLaunchControlPolicy } from "../scripts/postgres-image/complete-private-copy-launch.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
const clone = value => globalThis.structuredClone(value);
const nativeProcess = process.platform === "linux" && process.getuid?.() === 0
  && process.execPath === postgresCompletePrivateCopyLaunchContract.node && process.version === "v22.23.2";
const native = (ino, size, mode = 0o600) => ({ dev: "2096", ino: String(ino), uid: 0, gid: 0, mode, nlink: 1, size,
  mtimeNs: String(ino + 1000), ctimeNs: String(ino + 2000) });
const parent = ino => ({ dev: "2096", ino: String(ino), uid: 0, gid: 0, mode: 0o700 });
const proof = (file, bytes, ino, mode = 0o600) => ({ path: file, size: bytes.length, sha256: sha(bytes), nativeIdentity: native(ino, bytes.length, mode),
  parentIdentity: parent(ino + 1) });
function coreFixture() {
  const manifest = loadPostgresSourceClosureManifest();
  const references = manifest.materials.map((material, index) => ({ id: `material-${String(index).padStart(3, "0")}`,
    group: "DECLARED_SOURCE_MATERIALS_323", role: material.role, object: { sha256: material.expected.sha256 ?? sha(Buffer.from(material.id)),
      size: material.expected.size ?? index + 1, sha512: material.expected.sha512, gitBlobSha1: material.expected.gitBlobSha1 },
    materialId: material.id, historical: false, provenance: { kind: "COMPILED_SOURCE_MANIFEST", subject: manifest.subject,
      identifier: material.id, state: "BYTES_VERIFIED_UNADMITTED" } }));
  const retrieval = references.map((item, index) => ({ referenceId: item.id, path: `/unopened/core/${item.id}`, size: item.object.size,
    sha256: item.object.sha256, sha512: item.object.sha512, gitBlobSha1: item.object.gitBlobSha1, ownerProfile: "ROOT_PRIVATE",
    nativeIdentity: native(1000 + index, item.object.size), parentIdentity: parent(5000 + index) }));
  return compilePostgresCoreEvidenceInventoryPolicy({ kind: "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1", subject: manifest.subject,
    references, groups: [{ id: "DECLARED_SOURCE_MATERIALS_323", role: "DECLARED_SOURCE_MATERIALS", required: true,
      referenceIds: references.map(item => item.id) }], history: [], laterRequired: ["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"],
    retrieval: { references: retrieval, sourceBundleReferenceId: null, sourceBundleProof: null } });
}
function completePolicy() {
  const references = postgresCompletePrivateCopyPolicyContract.requiredGroupIds.map((groupId, index) => ({
    referenceId: `supplement-${String(index).padStart(2, "0")}`, groupId, role: `REVIEWED_OBJECT_${index}`, path: `/unopened/supplement/${index}`,
    size: index + 1, sha256: sha(Buffer.from(`supplement:${index}`)), sha512: null, gitBlobSha1: null, ownerProfile: "ROOT_PRIVATE",
    nativeIdentity: native(7000 + index, index + 1), parentIdentity: parent(8000 + index) }));
  return TEST_ONLY_compilePostgresCompletePrivateCopyPolicy({ kind: postgresCompletePrivateCopyPolicyContract.kind,
    subject: postgresCompletePrivateCopyPolicyContract.subject, corePolicySha256: postgresCompletePrivateCopyPolicyContract.corePolicySha256,
    coreReferenceDigest: postgresCompletePrivateCopyPolicyContract.coreReferenceDigest,
    coreReferenceCount: postgresCompletePrivateCopyPolicyContract.coreReferenceCount,
    supplementalAcceptance: clone(postgresCompletePrivateCopyPolicyContract.supplementalAcceptance),
    groups: postgresCompletePrivateCopyPolicyContract.requiredGroupIds.map((groupId, index) => ({ groupId,
      referenceIds: [references[index].referenceId] })), references }, coreFixture());
}
function fullReference(referenceId, role, file, bytes, ino, ownerProfile = "ROOT_PROTECTED_RECIPE", mode = 0o400) {
  return { referenceId, groupId: "P5_LAUNCH_CONTROL", role, path: file, size: bytes.length, sha256: sha(bytes), sha512: null,
    gitBlobSha1: null, ownerProfile, nativeIdentity: native(ino, bytes.length, mode), parentIdentity: parent(ino + 1) };
}
function planFixture() {
  const nonce = "0123456789abcdef01234567", stage = `${postgresCompletePrivateCopyLaunchContract.stageParent}/pg-complete-launch-${nonce}`;
  const callerBytes = Buffer.from("caller"), policyBytes = Buffer.from("policy");
  const references = [
    fullReference("caller", "FIXED_CALLER", `${stage}/caller.mjs`, callerBytes, 9000),
    fullReference("complete-policy", "COMPLETE_POLICY", `${stage}/complete-policy.json`, policyBytes, 9010, "ROOT_PRIVATE", 0o600),
    { referenceId: "runtime", groupId: "P5_LAUNCH_CONTROL", role: "NODE_RUNTIME", path: postgresCompletePrivateCopyLaunchContract.node,
      size: postgresCompletePrivateCopyLaunchContract.nodeSize, sha256: postgresCompletePrivateCopyLaunchContract.nodeSha256, sha512: null,
      gitBlobSha1: null, ownerProfile: "ROOT_EXECUTABLE", nativeIdentity: native(9020, postgresCompletePrivateCopyLaunchContract.nodeSize, 0o755),
      parentIdentity: { ...parent(9021), mode: 0o755 } },
  ].sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  const lateReferences = [["invoker", "INVOKER", "invoker.py"], ["supervisor", "SUPERVISOR", "supervisor.mjs"],
    ["supervisor-test", "SUPERVISOR_TEST", "supervisor.test.mjs"]].map(([id, role, name], index) =>
    fullReference(id, role, `${stage}/${name}`, Buffer.from(name), 9100 + index * 10));
  const value = { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_LAUNCH_PLAN_V1", executionId: `pg-complete-${nonce}`, recipeRevision: "a".repeat(40),
    policySha256: "b".repeat(64), reservationBytes: postgresCompletePrivateCopyLaunchControlReservedBytes, stagePath: stage, references,
    lateSelectors: lateReferences.map(({ referenceId, groupId, role, path, ownerProfile }) => ({ referenceId, groupId, role, path, ownerProfile })),
    callerReferenceId: "caller", runtimeReferenceId: "runtime", outputLimits: clone(postgresCompletePrivateCopyLaunchContract.outputLimits) };
  const bytes = encode(value), ownProof = proof(`${stage}/launch-plan.json`, bytes, 9200, 0o400);
  const plan = TEST_ONLY_loadPostgresCompletePrivateCopyLaunchPlan(bytes, sha(bytes), completePolicy(), { ownProof, lateReferences });
  return { plan, bytes, stage, nonce, lateReferences };
}
function processFixture(item, scenario = {}) {
  const root = `${postgresCompletePrivateCopyLaunchContract.privateRoot}/test-pg-complete`, proofRoot = `${root}-proof-${item.nonce}`;
  const claims = { authority: "PRIVATE_CHILD_PROVISIONAL_ONLY", closure: "NOT_ESTABLISHED", secondCompletePrivateCopy: "AWAITING_ROOT_ACK",
    processEOF: "NOT_OBSERVED", processExit: "NOT_OBSERVED", admission: "NOT_AUTHORIZED", currentness: "NOT_EVALUATED",
    runtimePermission: "NOT_GRANTED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null, selectedFixtureOnly: true };
  const inventoryBytes = encode({ inventory: true }), capacityBytes = encode({ capacity: true });
  const receiptValue = { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_RECEIPT_V1", state: "PUBLISHED_AWAITING_COPY_RETRIEVAL_ACK",
    execution: { executionId: item.plan.executionId, recipeRevision: "a".repeat(40), launchPlanSha256: item.plan.launchPlanSha256 },
    policy: { sha256: "b".repeat(64) }, capacity: {}, generations: {}, preservation: { receipt: null }, claims };
  const receiptBytes = encode(receiptValue);
  const receipt = proof(`${proofRoot}/receipt.json`, receiptBytes, 9300), inventory = proof(`${proofRoot}/inventory.json`, inventoryBytes, 9310);
  const capacity = proof(`${root}-capacity-${item.nonce}.json`, capacityBytes, 9320);
  const descriptor = { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_CHILD_DESCRIPTOR_V1", state: "PUBLISHED_AWAITING_COPY_RETRIEVAL_ACK",
    executionId: item.plan.executionId, launchPlanSha256: item.plan.launchPlanSha256, receipt, inventory, capacity, claims };
  const stdoutBytes = scenario.stdout ?? encode(descriptor), stderrBytes = scenario.stderr ?? Buffer.alloc(0);
  const files = new Map([[receipt.path, { bytes: receiptBytes, ...receipt }], [inventory.path, { bytes: inventoryBytes, ...inventory }],
    [capacity.path, { bytes: capacityBytes, ...capacity }], [`${item.stage}/actor.stdout.jsonl`, { bytes: stdoutBytes,
      ...proof(`${item.stage}/actor.stdout.jsonl`, stdoutBytes, 9330) }], [`${item.stage}/actor.stderr.txt`, { bytes: stderrBytes,
      ...proof(`${item.stage}/actor.stderr.txt`, stderrBytes, 9340) }]]);
  return { process: async () => ({ status: scenario.status ?? 0, signal: scenario.signal ?? null, closed: scenario.closed ?? true,
    stdoutEnded: scenario.stdoutEnded ?? true, stderrEnded: scenario.stderrEnded ?? true }),
  read(file) {
    const value = files.get(file); if (!value) throw new Error("missing fixture");
    const result = { ...value };
    if (scenario.readPath === "missing") delete result.path;
    if (scenario.readPath === "wrong") result.path = "/untrusted/substitution";
    return result;
  } };
}

test("closed TEST_ONLY launch chain creates non-cloneable capabilities and exact five-field control specification", async () => {
  const item = planFixture();
  assert.throws(() => validateLoadedPostgresCompletePrivateCopyLaunchPlan(item.plan), /capability_invalid/u);
  const child = await TEST_ONLY_runPostgresCompletePrivateCopyChild(item.plan, {}, processFixture(item));
  const specification = getPostgresLaunchControlSpecification(item.plan, child);
  assert.deepEqual(Object.keys(specification), ["kind", "executionId", "launchPlanSha256", "policySha256", "references"]);
  assert.equal(specification.references.length, 12);
  assert.deepEqual(specification.references.map(value => value.referenceId), [...specification.references.map(value => value.referenceId)].sort());
  const bytes = encode(specification), control = TEST_ONLY_loadPostgresLaunchControlPolicy(bytes, sha(bytes), item.plan, child);
  assert.throws(() => validateLoadedPostgresLaunchControlPolicy(control), /capability_invalid/u);
  for (const value of [clone(item.plan), clone(child), clone(control), specification]) {
    assert.throws(() => getPostgresLaunchControlSpecification(value, child), /capability_invalid/u);
  }
});

test("raw actor references bind fixed authenticated-plan paths when held reads omit or forge path", async () => {
  for (const readPath of ["missing", "wrong"]) {
    const item = planFixture();
    const child = await TEST_ONLY_runPostgresCompletePrivateCopyChild(item.plan, {}, processFixture(item, { readPath }));
    const specification = getPostgresLaunchControlSpecification(item.plan, child);
    assert.equal(specification.references.find(value => value.role === "RAW_ACTOR_STDOUT").path,
      `${item.stage}/actor.stdout.jsonl`);
    assert.equal(specification.references.find(value => value.role === "RAW_ACTOR_STDERR").path,
      `${item.stage}/actor.stderr.txt`);
    const bytes = encode(specification);
    assert.doesNotThrow(() => TEST_ONLY_loadPostgresLaunchControlPolicy(bytes, sha(bytes), item.plan, child));
  }
});

test("control loader rejects cross-plan, missing, extra and mutated late references", async () => {
  const first = planFixture(), child = await TEST_ONLY_runPostgresCompletePrivateCopyChild(first.plan, {}, processFixture(first));
  const specification = getPostgresLaunchControlSpecification(first.plan, child);
  for (const mutate of [value => value.references.pop(), value => value.references.push(clone(value.references[0])), value => {
    value.references.find(item => item.referenceId === "supervisor").sha256 = "f".repeat(64);
  }]) {
    const value = clone(specification); mutate(value); const bytes = encode(value);
    assert.throws(() => TEST_ONLY_loadPostgresLaunchControlPolicy(bytes, sha(bytes), first.plan, child), /invalid/u);
  }
  const second = planFixture();
  assert.throws(() => getPostgresLaunchControlSpecification(second.plan, child), /capability_invalid/u);
});

test("child supervision requires real close/EOF/code zero, canonical one-line stdout and empty stderr", async () => {
  const scenarios = [{ status: 1 }, { signal: "SIGKILL", status: null }, { closed: false }, { stdoutEnded: false }, { stderrEnded: false },
    { stderr: Buffer.from("bad") }, { stdout: Buffer.from("{}") }, { stdout: Buffer.from("{}\n{}\n") }, { stdout: Buffer.from("{\"x\":1}\n") }];
  for (const scenario of scenarios) {
    const item = planFixture();
    await assert.rejects(TEST_ONLY_runPostgresCompletePrivateCopyChild(item.plan, {}, processFixture(item, scenario)));
  }
});

test("production entry points reject TEST_ONLY authority and dependency injection before effects", async () => {
  const item = planFixture(); let accessed = false;
  const dependencies = Object.defineProperty({}, "spawn", { enumerable: true, get() { accessed = true; return () => {}; } });
  await assert.rejects(runPostgresCompletePrivateCopyChild(item.plan, {}, dependencies), /invalid/u); assert.equal(accessed, false);
  await assert.rejects(TEST_ONLY_runPostgresCompletePrivateCopyChild(item.plan, { argv: [] }, processFixture(item)), /invalid/u);
  const child = await TEST_ONLY_runPostgresCompletePrivateCopyChild(item.plan, {}, processFixture(item));
  const specification = getPostgresLaunchControlSpecification(item.plan, child), bytes = encode(specification);
  assert.throws(() => loadPostgresLaunchControlPolicy(bytes, sha(bytes), item.plan, child), /capability_invalid/u);
});

test("production getters accept only genuine production control capabilities", () => {
  for (const getter of [getPostgresLaunchControlReferences, getPostgresLaunchControlPolicySha256, getPostgresLaunchControlExecutionId,
    getPostgresLaunchControlLaunchPlanSha256]) assert.throws(() => getter({}), /capability_invalid/u);
});

function nativeProcessFixture(t, source, operationMs = 2000) {
  const directory = fs.mkdtempSync("/var/tmp/aw-pg-launch-process-"); fs.chmodSync(directory, 0o700);
  let verified = false;
  const caller = path.join(directory, "caller.mjs"), outputPath = path.join(directory, "actor.stdout.jsonl"),
    errorPath = path.join(directory, "actor.stderr.txt");
  fs.writeFileSync(caller, source, { flag: "wx", mode: 0o400 }); fs.chmodSync(caller, 0o400);
  t.after(() => { if (verified) fs.rmSync(directory, { recursive: true, force: true }); });
  return { spec: { caller, outputPath, errorPath, operationMs, cleanupMs: 1500 }, verified() { verified = true; } };
}

test("native default process waits for inherited-pipe descendant EOF and captures trailing bytes", { skip: !nativeProcess }, async t => {
  const source = `import {spawn} from "node:child_process";
const child=spawn(process.execPath,["-e",${JSON.stringify("setTimeout(()=>process.stdout.write('late\\n'),300)")}],{stdio:["ignore","inherit","inherit"]});
child.unref();process.stdout.write("early\\n");`;
  const fixture = nativeProcessFixture(t, source), started = Date.now();
  assert.deepEqual(await TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess(fixture.spec),
    { status: 0, signal: null, closed: true, stdoutEnded: true, stderrEnded: true });
  assert.ok(Date.now() - started >= 250);
  assert.equal(fs.readFileSync(fixture.spec.outputPath, "utf8"), "early\nlate\n");
  assert.equal(fs.readFileSync(fixture.spec.errorPath).length, 0); fixture.verified();
});

test("native default process times out an inherited-pipe descendant that never closes", { skip: !nativeProcess }, async t => {
  const source = `import {spawn} from "node:child_process";
const child=spawn(process.execPath,["-e",${JSON.stringify("setInterval(()=>{},1000)")}],{stdio:["ignore","inherit","inherit"]});child.unref();`;
  const fixture = nativeProcessFixture(t, source, 150);
  await assert.rejects(TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess(fixture.spec), /(?:timeout|cleanup_uncertain)$/u);
  fixture.verified();
});

test("native default process bounds stdout and stderr while clean output closes normally", { skip: !nativeProcess }, async t => {
  const clean = nativeProcessFixture(t, "process.stdout.write('canonical\\n');");
  await TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess(clean.spec);
  assert.equal(fs.readFileSync(clean.spec.outputPath, "utf8"), "canonical\n"); clean.verified();
  for (const stream of ["stdout", "stderr"]) {
    const source = `process.${stream}.write(Buffer.alloc(70000,120));`;
    const fixture = nativeProcessFixture(t, source);
    await assert.rejects(TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess(fixture.spec));
    assert.ok(fs.statSync(stream === "stdout" ? fixture.spec.outputPath : fixture.spec.errorPath).size <= 64 * 1024);
    fixture.verified();
  }
});

test("native process cleanup attempts both log fsyncs and closes and latches uncertainty", { skip: !nativeProcess }, async t => {
  for (const [fault, expected] of [["FSYNC_FIRST", ["fsync:stdout", "fsync:stderr", "close:stdout", "close:stderr"]],
    ["CLOSE_FIRST", ["fsync:stdout", "fsync:stderr", "close:stdout", "close:stderr"]],
    ["SPAWN_CLOSE_FIRST", ["close:stdout", "close:stderr"]]]) {
    const fixture = nativeProcessFixture(t, "process.stdout.write('ok\\n');"); fixture.spec.fault = fault;
    await assert.rejects(TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess(fixture.spec), error => {
      assert.match(error.message, /cleanup_uncertain$/u); assert.deepEqual(error.TEST_ONLY_cleanupAttempts, expected); return true;
    });
    fixture.verified();
  }
});

test("native held-read cleanup attempts file and every anchor after injected close failure", { skip: !nativeProcess }, t => {
  for (const fault of ["FILE_CLOSE", "ANCHOR_CLOSE"]) {
    const directory = fs.mkdtempSync(`${postgresCompletePrivateCopyLaunchContract.privateRoot}/test-pg-launch-held-`);
    fs.chmodSync(directory, 0o700); const file = path.join(directory, "object.bin");
    fs.writeFileSync(file, "held", { flag: "wx", mode: 0o600 }); fs.chmodSync(file, 0o600); let verified = false;
    t.after(() => { if (verified) fs.rmSync(directory, { recursive: true, force: true }); });
    assert.throws(() => TEST_ONLY_readPostgresCompletePrivateCopyLaunchFile({ path: file, fault }), error => {
      assert.match(error.message, /cleanup_uncertain$/u); assert.equal(error.TEST_ONLY_cleanupAttempts[0], "file");
      assert.ok(error.TEST_ONLY_cleanupAttempts.includes("anchor-0")); assert.ok(error.TEST_ONLY_cleanupAttempts.includes("anchor-1")); return true;
    });
    verified = true;
  }
});
