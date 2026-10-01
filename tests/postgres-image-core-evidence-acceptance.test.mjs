import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CORE_EVIDENCE, loadPostgresCoreEvidenceAcceptance,
  validatePostgresCoreEvidenceAcceptanceBytes } from "../scripts/postgres-image/core-evidence-acceptance.mjs";

const acceptanceFile = new URL("../infra/postgres-image/core-evidence-acceptance.json", import.meta.url);
const inventoryFile = new URL("../infra/postgres-image/core-evidence-inventory.json", import.meta.url);
const bytes = () => ({ acceptance: readFileSync(acceptanceFile), inventory: readFileSync(inventoryFile) });

test("accepts only the independently reviewed core evidence byte identities", () => {
  const input = bytes();
  assert.equal(input.acceptance.length, CORE_EVIDENCE.acceptance.bytes);
  assert.equal(input.inventory.length, CORE_EVIDENCE.inventory.bytes);
  const result = validatePostgresCoreEvidenceAcceptanceBytes(input.acceptance, input.inventory);
  assert.equal(result.acceptance.kind, "POSTGRES_CORE_EVIDENCE_ACCEPTANCE_V1");
  assert.equal(result.acceptance.state, "CORE_COMPLETE");
  assert.equal(result.inventory.kind, "POSTGRES_CORE_EVIDENCE_INVENTORY_V1");
});

test("rejects changed, truncated and missing core evidence bytes", () => {
  const input = bytes();
  const changed = Buffer.from(input.acceptance); changed[changed.length - 2] ^= 1;
  for (const [acceptance, inventory] of [
    [changed, input.inventory],
    [input.acceptance.subarray(0, -1), input.inventory],
    [input.acceptance, input.inventory.subarray(0, -1)],
    [undefined, input.inventory],
    [input.acceptance, undefined],
  ]) assert.throws(() => validatePostgresCoreEvidenceAcceptanceBytes(acceptance, inventory),
    /postgres_core_evidence_acceptance_invalid/u);
});

test("returns a detached deeply frozen evidence graph", () => {
  const input = bytes();
  const result = validatePostgresCoreEvidenceAcceptanceBytes(input.acceptance, input.inventory);
  input.acceptance.fill(0); input.inventory.fill(0);
  assert.equal(result.acceptance.state, "CORE_COMPLETE");
  assert.equal(result.inventory.references.length, 496);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.acceptance.claims), true);
  assert.equal(Object.isFrozen(result.inventory.references), true);
  assert.equal(Object.isFrozen(result.inventory.references[0]), true);
  assert.throws(() => { result.acceptance.state = "AUTHORIZED"; }, TypeError);
});

test("keeps legal, runtime, signing, copy and admission claims unpromoted", () => {
  const { acceptance } = loadPostgresCoreEvidenceAcceptance();
  assert.deepEqual(acceptance.claims, {
    authority: "LOCAL_DIAGNOSTIC_ROOT_RETRIEVAL",
    trustBoundary: "TRUSTED_ADMIN_ROOT_KERNEL",
    hostileSameUidIsolation: "NOT_CLAIMED",
    offHostImmutability: "NOT_CLAIMED",
    legalCompliance: "NOT_EVALUATED",
    binaryReproduction: "NOT_ESTABLISHED",
    currentness: "NOT_EVALUATED",
    runtimePermission: "NOT_GRANTED",
    signing: "NOT_ATTEMPTED",
    secondCompleteCopy: "NOT_ESTABLISHED",
    admission: "NOT_AUTHORIZED",
    supportStartedAt: null,
    supportEndsAt: null,
    archiveUntil: null,
  });
});
