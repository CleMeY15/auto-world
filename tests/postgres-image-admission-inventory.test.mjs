import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import inventory from "../infra/postgres-image/admission-inventory.json" with { type: "json" };
import remote from "../infra/postgres-image/candidate-remote.json" with { type: "json" };
import acceptance from "../infra/postgres-image/complete-private-copy-acceptance.json" with { type: "json" };

const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`);
const sha = value => createHash("sha256").update(value).digest("hex");
const generationOne = Object.freeze({
  admissionGeneration: 1,
  generationRootSha256: "9c2aa7b61440da334c81ca3a6ac8abced389f238136471fcd5da00adfdaf607c",
  authorityRevision: 1,
  currentRevisionSha256: "4fb2e30c0540173a814cc7b1957719a61f67f97ecd618f2b071224fd88709daf",
  state: "PENDING",
});

function assertGenerationOneHistory(value) {
  assert.ok(value.admissionGeneration > generationOne.admissionGeneration);
  assert.equal(value.previousGenerations.length, 1);
  assert.equal(new Set(value.previousGenerations.map(item => item.admissionGeneration)).size,
    value.previousGenerations.length);
  assert.deepEqual(value.previousGenerations[0], generationOne);
}

test("the shipped admission inventory authenticates its immutable root and complete contiguous revision preimages", () => {
  const root = inventory.generationRoot, rootHash = sha(canonical(root));
  assert.equal(root.admissionGeneration, inventory.admissionGeneration);
  assert.equal(root.image.subject, remote.subject);
  assert.equal(root.image.manifestDigest, remote.manifest.digest);
  assert.equal(root.image.configDigest, remote.candidate.imageId);
  assert.deepEqual(root.image.diffIds, remote.candidate.diffIds);
  assert.equal(root.image.diffIdsSha256, sha(canonical(root.image.diffIds)));
  assertGenerationOneHistory(inventory);
  assert.notEqual(rootHash, generationOne.generationRootSha256);
  assert.deepEqual(root.evidence.p5, {
    acceptance: { bytes: 4604, sha256: "9079ccb664f39d54296fcb4a4ae1287c6bfe116db7518d18ee0a4db4cb8e438b" },
    recipeRevision: acceptance.recipeRevision, completePolicy: acceptance.completePolicy, launchPlan: acceptance.launchPlan,
    counts: { ...acceptance.counts, controlReferences: 44 }, proofs: acceptance.proofs,
  });
  assert.equal(inventory.authorityRevision, inventory.authorityRevisions.length);
  let prior = null;
  for (const [index, revision] of inventory.authorityRevisions.entries()) {
    assert.equal(revision.authorityRevision, index + 1);
    assert.equal(revision.previousRevisionSha256, prior);
    assert.equal(revision.generationRootSha256, rootHash);
    prior = sha(canonical(revision)); assert.equal(inventory.revisionHashes[index], prior);
    if (revision.state === "PENDING") {
      for (const field of ["supportStartedAt", "supportEndsAt", "archiveUntil"]) assert.equal(revision[field], null);
      assert.deepEqual(revision.currentEvidence, { audit: null, packageControls: null });
    }
  }
  assert.equal(inventory.currentRevisionSha256, prior);
  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /(?:\/opt\/|\/home\/|\/mnt\/|[A-Z]:\\|contentBase64|nativeIdentity|mtimeNs|ctimeNs|executionId)/u);
});

test("the generation-one history summary cannot be rewritten while advancing admission generation", () => {
  const changed = globalThis.structuredClone(inventory);
  changed.previousGenerations[0].currentRevisionSha256 = "0".repeat(64);
  assert.throws(() => assertGenerationOneHistory(changed));
});

test("generation two activation retains the initial revision and binds the actual current audit and package observation", () => {
  assert.equal(sha(canonical(inventory.generationRoot)),
    "f1894e6bb5b09b51033707d4cf8943c91d726a61dbb6a07e9aef942fa80e1220");
  assert.equal(inventory.revisionHashes[0],
    "28a46b871c4d92770789abe905c77bfd7066e847f7138ad438f517e29c4eb1da");
  const active = inventory.authorityRevisions[1];
  assert.equal(active.state, "ACTIVE");
  assert.equal(active.previousRevisionSha256, inventory.revisionHashes[0]);
  assert.deepEqual([active.supportStartedAt, active.supportEndsAt, active.archiveUntil],
    ["2026-10-07", "2027-10-07", "2028-10-06"]);
  assert.equal(Date.parse(active.archiveUntil) - Date.parse(active.supportEndsAt), 365 * 86_400_000);
  const audit = active.currentEvidence.audit;
  assert.equal(sha(Buffer.from(`${JSON.stringify(audit, null, 2)}\n`)),
    "e910c271d14a480ae625902e02f9132a47833ec5434660e3ac4c90167ea35e6c");
  assert.equal(audit.checkedAt, "2026-10-06T22:21:49.375163974Z");
  assert.deepEqual(audit.source, {
    recipeRevision: "fe397f1fc3f49ce4ef850338cec319366cb22c55",
    workflowPath: ".github/workflows/postgres-admission-current-audit.yml",
    runId: "37538340223", attempt: "1",
  });
  assert.equal(audit.files.length, 16);
  const controls = fs.readFileSync("infra/postgres-image/package-controls.json");
  assert.deepEqual(active.currentEvidence.packageControls, {
    size: controls.length, sha256: sha(controls), observedAt: JSON.parse(controls).observedAt,
  });
  assert.equal(active.currentEvidence.packageControls.sha256,
    "29ca213f523b623d18d17b95195342f39002e138304a70ba93ce50444421021b");
});

test("frozen execution pins cover the complete supported and offline relative-import closure without mutable evidence or self-reference", () => {
  const files = inventory.generationRoot.executionFiles;
  assert.deepEqual(files.map(item => item.path), files.map(item => item.path).sort());
  assert.equal(new Set(files.map(item => item.path)).size, files.length);
  const pins = new Map(files.map(item => [item.path, item]));
  assert.equal(pins.has("infra/postgres-image/admission-inventory.json"), false);
  assert.equal(pins.has("infra/postgres-image/package-controls.json"), false);
  assert.equal(pins.has("infra/postgres-image/admission-consumers.json"), false);
  const visited = new Set();
  function verify(name) {
    if (visited.has(name)) return; visited.add(name);
    const item = pins.get(name); assert.ok(item, `missing frozen import ${name}`);
    const bytes = fs.readFileSync(name);
    assert.equal(bytes.length, item.size, name); assert.equal(sha(bytes), item.sha256, name);
    if (!name.endsWith(".mjs")) return;
    for (const match of bytes.toString("utf8").matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/gu))
      verify(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
  }
  for (const name of ["scripts/postgres-image/admitted-postgres.mjs", "scripts/postgres-image/admission-archive-observation.mjs",
    "scripts/postgres-image/admission-observability.mjs"]) verify(name);
  for (const item of files) verify(item.path);
});
