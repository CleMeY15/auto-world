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
const generationTwo = Object.freeze({
  admissionGeneration: 2,
  generationRootSha256: "f1894e6bb5b09b51033707d4cf8943c91d726a61dbb6a07e9aef942fa80e1220",
  authorityRevision: 1,
  currentRevisionSha256: "28a46b871c4d92770789abe905c77bfd7066e847f7138ad438f517e29c4eb1da",
  state: "PENDING",
});
const generationTwoExecutionFilesSha256 = "ba6df81ae377d4d2e52ebf83d003ac57cd538f8423955696f62be020e5c1206d";
const generationThreeAdditions = Object.freeze([
  { path: "infra/seaweed-image/base-config.json", size: 13_676,
    sha256: "31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927" },
  { path: "infra/seaweed/required-tests.json", size: 7_120,
    sha256: "eb50caadd818336196a8e4d4f29ea82971c154140656b83569e6cf6b8808aa09" },
  { path: "tests/fixtures/seaweed-source/upstream/go.sum", size: 289_547,
    sha256: "d0da511e41d4013cbcc31d959d7533edb8312cfefa8722919085d5cbc6eb8fe2" },
]);

function assertGenerationOneHistory(value) {
  assert.ok(value.admissionGeneration > generationOne.admissionGeneration);
  assert.equal(value.previousGenerations.length, 2);
  assert.equal(new Set(value.previousGenerations.map(item => item.admissionGeneration)).size,
    value.previousGenerations.length);
  assert.deepEqual(value.previousGenerations[0], generationOne);
  assert.deepEqual(value.previousGenerations[1], generationTwo);
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

test("generation three starts PENDING and retains the exact generation one and two summaries", () => {
  assert.equal(inventory.admissionGeneration, 3);
  assert.equal(inventory.generationRoot.admissionGeneration, 3);
  assertGenerationOneHistory(inventory);
  assert.equal(inventory.authorityRevision, 1);
  assert.equal(inventory.authorityRevisions.length, 1);
  assert.equal(inventory.revisionHashes.length, 1);
  const pending = inventory.authorityRevisions[0];
  assert.equal(pending.state, "PENDING");
  assert.equal(pending.previousRevisionSha256, null);
  assert.equal(pending.generationRootSha256, sha(canonical(inventory.generationRoot)));
  assert.deepEqual([pending.supportStartedAt, pending.supportEndsAt, pending.archiveUntil], [null, null, null]);
  assert.deepEqual(pending.currentEvidence, { audit: null, packageControls: null });
  assert.equal(pending.revocationReason, null);
  assert.equal(inventory.currentRevisionSha256, sha(canonical(pending)));
  assert.deepEqual(inventory.revisionHashes, [inventory.currentRevisionSha256]);
});

test("frozen execution pins cover the complete supported and offline execution closure without mutable evidence or self-reference", () => {
  const files = inventory.generationRoot.executionFiles;
  assert.equal(files.length, 74);
  assert.deepEqual(files.map(item => item.path), files.map(item => item.path).sort());
  assert.equal(new Set(files.map(item => item.path)).size, files.length);
  const pins = new Map(files.map(item => [item.path, item]));
  for (const pin of generationThreeAdditions) assert.deepEqual(pins.get(pin.path), pin);
  const additions = new Set(generationThreeAdditions.map(item => item.path));
  assert.equal(sha(canonical(files.filter(item => !additions.has(item.path)))),
    generationTwoExecutionFilesSha256);
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
