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

test("the shipped admission inventory authenticates its immutable root and complete contiguous revision preimages", () => {
  const root = inventory.generationRoot, rootHash = sha(canonical(root));
  assert.equal(root.admissionGeneration, inventory.admissionGeneration);
  assert.equal(root.image.subject, remote.subject);
  assert.equal(root.image.manifestDigest, remote.manifest.digest);
  assert.equal(root.image.configDigest, remote.candidate.imageId);
  assert.deepEqual(root.image.diffIds, remote.candidate.diffIds);
  assert.equal(root.image.diffIdsSha256, sha(canonical(root.image.diffIds)));
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
