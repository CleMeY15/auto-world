import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { baselineInventoryArguments, parseBaselineArgs, validateBaselineManifests } from "../scripts/supply-chain/baseline-scanner.mjs";
import { assertReviewedBaselineTools, assertVerifiedBaselineTcb, getVerifiedBaselineTcbEvidence, loadBaselineTcbReference,
  validateBaselineTcbReceipt } from "../scripts/supply-chain/baseline-tcb.mjs";

async function receipt() {
  const reference = await loadBaselineTcbReference();
  const run = { ...reference.reviewedReceipt.run, id: "34170565631" };
  const managed = { ...globalThis.structuredClone(reference.managedIdentity), run };
  managed.runtime.info.ID = "d67bd2e5-c674-4039-b894-ae52dbe8151a";
  const recipeSha256 = "d".repeat(64);
  const inventory = { schemaVersion: 1, state: "diagnostic_tcb_proposal", baselineState: "failed_non_admitted",
    run, recipeSha256, manifests: reference.manifests, localImage: { ...reference.localImage, volumes: null },
    imageStore: { before: [], after: [reference.localImage.id] }, availableBytesBeforePull: String(16 * 1024 ** 3), containersExecuted: 0 };
  return { managed, inventory, options: { expectedRun: run, expectedRecipeSha256: recipeSha256 } };
}

test("baseline inventory exposes only a fixed local daemon and immutable public image acquisition", () => {
  assert.deepEqual(parseBaselineArgs(["inventory"]), { mode: "inventory" });
  for (const operation of ["version", "info", "images", "pull", "inspect"]) {
    const args = baselineInventoryArguments("/owned/empty", operation);
    assert.deepEqual(args.slice(0, 4), ["--host", "unix:///var/run/docker.sock", "--config", "/owned/empty"]);
    assert.equal(args.some((entry) => ["run", "create", "build", "login", "push"].includes(entry)), false);
  }
  const pull = baselineInventoryArguments("/owned/empty", "pull");
  assert.equal(pull.at(-1), "aquasec/trivy@sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9");
  for (const argv of [["inventory", "--enable"], ["run"], ["pull", "other"], []]) assert.throws(() => parseBaselineArgs(argv));
  for (const operation of ["run", "create", "build", "login", "__proto__"]) assert.throws(() => baselineInventoryArguments("/owned/empty", operation));
});

test("baseline rejects manifest substitution and refuses both entry points outside Linux Actions", () => {
  assert.throws(() => validateBaselineManifests(Buffer.from("{}"), Buffer.from("{}")), { code: "baseline_manifest_identity_mismatch" });
  const script = fileURLToPath(new URL("../scripts/supply-chain/baseline-scanner.mjs", import.meta.url));
  for (const [mode, code] of [["inventory", "baseline_requires_secret_free_linux_ci"], ["compare", "candidate_artifact_requires_secret_free_linux_ci"]]) {
    const result = spawnSync(process.execPath, [script, mode], { env: {}, encoding: "utf8", timeout: 5000, maxBuffer: 4096 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), code);
  }
});

test("fresh exact TCB receipts preserve the reviewed runtime but bind the current run", async () => {
  const { managed, inventory, options } = await receipt();
  const tcb = await validateBaselineTcbReceipt(managed, inventory, options);
  assert.equal(assertVerifiedBaselineTcb(tcb, options.expectedRun), tcb);
  assert.equal(tcb.run.id, "34170565631");
  assert.equal(tcb.image.child, inventory.manifests.child);
  assert.equal(Object.isFrozen(tcb), true);
  assert.equal(Object.isFrozen(tcb.run), true);
  assert.equal(Object.isFrozen(tcb.cli), true);
  assert.equal(Object.isFrozen(tcb.image), true);
  assert.throws(() => assertVerifiedBaselineTcb(globalThis.structuredClone(tcb), options.expectedRun), { code: "baseline_tcb_receipt_unverified" });
  assert.throws(() => assertVerifiedBaselineTcb(tcb, { ...options.expectedRun, attempt: 2 }), { code: "native_ci_identity_invalid" });
  const evidence = getVerifiedBaselineTcbEvidence(tcb, options.expectedRun);
  assert.deepEqual(evidence.map((entry) => entry.path), ["tcb-managed-docker.json", "tcb-inventory.json"]);
  const originalBytes = Buffer.from(evidence[0].bytes);
  evidence[0].bytes.fill(0);
  managed.packageInfo = "mutated after validation";
  assert.deepEqual(getVerifiedBaselineTcbEvidence(tcb, options.expectedRun)[0].bytes, originalBytes);
});

test("TCB revalidation rejects runner, binary, package, daemon, kernel and runtime drift", async () => {
  const mutations = [
    (r) => { r.managed.runnerImageVersion = "20260901.1.1"; },
    (r) => { r.managed.cli.sha256 = "0".repeat(64); },
    (r) => { r.managed.metadataTools.dpkg.size += 1; },
    (r) => { r.managed.packageOrigin = "unverified"; },
    (r) => { r.managed.packageInfo = r.managed.packageInfo.replace("28.0.4", "28.0.5"); },
    (r) => { r.managed.runtime.version.Server.ApiVersion = "1.49"; },
    (r) => { r.managed.runtime.info.KernelVersion = "other"; },
    (r) => { r.managed.runtime.info.SecurityOptions.push("name=rootless"); },
    (r) => { r.managed.runtime.info.Runtimes.runc.path = "other"; },
    (r) => { r.managed.runtime.info.DefaultRuntime = "other"; },
  ];
  for (const mutate of mutations) {
    const r = await receipt();
    mutate(r);
    await assert.rejects(validateBaselineTcbReceipt(r.managed, r.inventory, r.options), { code: "baseline_tcb_runtime_changed" });
  }
  const r = await receipt();
  await assertReviewedBaselineTools(r.managed);
  r.managed.cli.size += 1;
  await assert.rejects(assertReviewedBaselineTools(r.managed), { code: "baseline_tcb_tool_identity_changed" });
});

test("TCB refuses writable image volumes and image or store substitution", async () => {
  const badVolumes = [undefined, { "/cache": {} }, [], "/tmp", true];
  for (const volumes of badVolumes) {
    const r = await receipt();
    r.inventory.localImage.volumes = volumes;
    await assert.rejects(validateBaselineTcbReceipt(r.managed, r.inventory, r.options));
  }
  for (const mutate of [
    (r) => { r.inventory.localImage.id = `sha256:${"1".repeat(64)}`; },
    (r) => { r.inventory.localImage.size += 1; },
    (r) => { r.inventory.manifests.child = `sha256:${"1".repeat(64)}`; },
    (r) => { r.inventory.imageStore.after.push(`sha256:${"2".repeat(64)}`); },
    (r) => { r.inventory.imageStore.before.push(`sha256:${"2".repeat(64)}`); },
    (r) => { r.inventory.imageStore.after = []; },
    (r) => { r.inventory.availableBytesBeforePull = "1"; },
  ]) {
    const r = await receipt();
    mutate(r);
    await assert.rejects(validateBaselineTcbReceipt(r.managed, r.inventory, r.options));
  }
});

test("TCB refuses stale attempts, collector drift, capability claims and unexpected fields", async () => {
  for (const mutate of [
    (r) => { r.inventory.run = { ...r.inventory.run, attempt: 2 }; },
    (r) => { r.managed.run = { ...r.managed.run, id: "1" }; },
    (r) => { r.inventory.recipeSha256 = "0".repeat(64); },
    (r) => { r.inventory.containersExecuted = 1; },
    (r) => { r.inventory.baselineState = "admitted"; },
    (r) => { r.inventory.extra = true; },
    (r) => { r.managed.runtime.info.extra = true; },
  ]) {
    const r = await receipt();
    mutate(r);
    await assert.rejects(validateBaselineTcbReceipt(r.managed, r.inventory, r.options));
  }
});
