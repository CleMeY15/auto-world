import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateNativeCiIdentity } from "./ci-identity.mjs";
import { readFileBounded } from "./native-audit.mjs";
import { policyError } from "./process.mjs";
import { assertClosedObject, canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const REFERENCE = fileURLToPath(new URL("../../infra/supply-chain/materials/baseline-docker/reference.json", import.meta.url));
const REFERENCE_SHA256 = "8cd089c11c4e9656b3936f3860f971a99523b460251690ce631957710d61d7a1";
const VERIFIED = new WeakMap();
const GiB = 1024 ** 3;
const fail = (code) => { throw policyError(code); };
const same = (a, b) => canonicalJsonBuffer(a).equals(canonicalJsonBuffer(b));

export async function loadBaselineTcbReference() {
  const bytes = await readFileBounded(REFERENCE, 64 * 1024);
  if (bytes.length !== 10628 || sha256(bytes) !== REFERENCE_SHA256) fail("baseline_tcb_reference_changed");
  return parseBoundedJson(bytes, { maxBytes: 64 * 1024 });
}

function managedIdentity(managed) {
  assertClosedObject(managed, ["run", "runnerImageVersion", "cli", "packageName", "packageInfo", "packageOrigin", "metadataTools", "runtime"]);
  assertClosedObject(managed.runtime, ["version", "info"]);
  if (typeof managed.runtime.info?.ID !== "string" || !/^[a-f0-9-]{36}$/u.test(managed.runtime.info.ID)) fail("baseline_tcb_daemon_identity_invalid");
  const identity = { ...managed };
  delete identity.run;
  const info = { ...managed.runtime.info };
  delete info.ID;
  // Run identity and the ephemeral daemon ID vary per job. All other collected
  // package, runtime, feature, kernel and rootful/rootless evidence is exact.
  return { ...identity, runtime: { version: managed.runtime.version, info } };
}

export async function assertReviewedBaselineTools({ cli, metadataTools, runnerImageVersion }) {
  const reference = await loadBaselineTcbReference();
  for (const [key, value] of Object.entries({ cli, metadataTools, runnerImageVersion })) {
    if (!same(value, reference.managedIdentity[key])) fail("baseline_tcb_tool_identity_changed");
  }
}

export async function assertReviewedBaselineManaged(managed, expectedRun) {
  validateNativeCiIdentity(managed.run, expectedRun);
  const reference = await loadBaselineTcbReference();
  if (!same(managedIdentity(managed), reference.managedIdentity)) fail("baseline_tcb_runtime_changed");
}

function validateImageStore(store, config) {
  assertClosedObject(store, ["before", "after"]);
  for (const values of [store.before, store.after]) {
    if (!Array.isArray(values) || values.length > 1000 ||
        values.some((value) => typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) ||
        !same(values, [...new Set(values)].sort())) fail("baseline_tcb_image_store_invalid");
  }
  if (!store.after.includes(config) || store.before.some((id) => !store.after.includes(id)) ||
      store.after.some((id) => !store.before.includes(id) && id !== config)) fail("baseline_tcb_image_store_changed");
}

export async function validateBaselineTcbReceipt(managed, inventory, { expectedRun, expectedRecipeSha256 }) {
  await assertReviewedBaselineManaged(managed, expectedRun);
  validateNativeCiIdentity(inventory.run, expectedRun);
  const reference = await loadBaselineTcbReference();
  assertClosedObject(inventory, ["schemaVersion", "state", "baselineState", "run", "recipeSha256", "manifests",
    "localImage", "imageStore", "availableBytesBeforePull", "containersExecuted"]);
  if (!/^[a-f0-9]{64}$/u.test(expectedRecipeSha256 ?? "") || inventory.recipeSha256 !== expectedRecipeSha256 ||
      inventory.schemaVersion !== 1 || inventory.state !== "diagnostic_tcb_proposal" ||
      inventory.baselineState !== "failed_non_admitted" || inventory.containersExecuted !== 0) fail("baseline_tcb_receipt_invalid");
  if (!same(inventory.manifests, reference.manifests)) fail("baseline_tcb_manifest_changed");
  assertClosedObject(inventory.localImage, ["id", "size", "os", "architecture", "user", "entrypoint", "command", "volumes"]);
  const { volumes, ...image } = inventory.localImage;
  // Image-declared volumes could create writable anonymous mounts despite a
  // read-only rootfs. The original receipt did not collect this field.
  if (volumes !== null && (!volumes || typeof volumes !== "object" || Array.isArray(volumes) || Object.keys(volumes).length)) {
    fail("baseline_tcb_image_volumes_refused");
  }
  if (!same(image, reference.localImage)) fail("baseline_tcb_image_changed");
  validateImageStore(inventory.imageStore, image.id);
  if (typeof inventory.availableBytesBeforePull !== "string" || !/^[0-9]{1,20}$/u.test(inventory.availableBytesBeforePull) ||
      BigInt(inventory.availableBytesBeforePull) < BigInt(8 * GiB + 2 * reference.manifests.compressedBytes)) fail("baseline_tcb_disk_budget_refused");
  const identitySha256 = sha256(canonicalJsonBuffer({ referenceSha256: REFERENCE_SHA256,
    managed: managedIdentity(managed), inventory }));
  const result = Object.freeze({ run: Object.freeze({ ...expectedRun }), runnerImageVersion: managed.runnerImageVersion,
    cli: Object.freeze({ ...managed.cli }), image: Object.freeze({ child: inventory.manifests.child,
      config: image.id, os: image.os, architecture: image.architecture, size: image.size }), identitySha256 });
  VERIFIED.set(result, { summarySha256: sha256(canonicalJsonBuffer(result)),
    evidence: [
      { path: "tcb-managed-docker.json", bytes: canonicalJsonBuffer(managed) },
      { path: "tcb-inventory.json", bytes: canonicalJsonBuffer(inventory) },
    ] });
  return result;
}

// Only this process's fresh validated receipt can authorize the next diagnostic
// container. Deserialized artifacts or hand-built summaries cannot mint it.
export function assertVerifiedBaselineTcb(tcb, expectedRun) {
  if (!tcb || !VERIFIED.has(tcb) || sha256(canonicalJsonBuffer(tcb)) !== VERIFIED.get(tcb).summarySha256) fail("baseline_tcb_receipt_unverified");
  validateNativeCiIdentity(tcb.run, expectedRun);
  if (!path.posix.isAbsolute(tcb.cli.path)) fail("baseline_tcb_receipt_unverified");
  return tcb;
}

export function getVerifiedBaselineTcbEvidence(tcb, expectedRun) {
  assertVerifiedBaselineTcb(tcb, expectedRun);
  return VERIFIED.get(tcb).evidence.map(({ path: filename, bytes }) => Object.freeze({
    path: filename, bytes: Buffer.from(bytes), sha256: sha256(bytes), size: bytes.length,
  }));
}
