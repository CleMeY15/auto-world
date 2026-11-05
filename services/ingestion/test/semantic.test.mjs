import assert from "node:assert/strict";
import { test } from "node:test";

import { referenceKey, semanticCommand } from "../.prototype-dist/semantic.js";

test("canonical semantic commands sort object keys but preserve array order", () => {
  const left = semanticCommand({ schemaVersion: 1, signal: {}, leaseFence: 7, nested: { z: 1, a: [2, 1] } });
  const right = semanticCommand({ nested: { a: [2, 1], z: 1 }, leaseFence: 99, signal: {}, schemaVersion: 1 });
  assert.deepEqual(left, right);
  assert.notEqual(left.sha256, semanticCommand({ schemaVersion: 1, nested: { a: [1, 2], z: 1 } }).sha256);
});

test("canonical semantic commands distinguish absence from explicit null", () => {
  assert.notEqual(semanticCommand({ value: null }).sha256, semanticCommand({}).sha256);
});

test("raw audit binds exact bytes and their framed length without storing them in command text", () => {
  const first = semanticCommand({ operationKey: "stage_a", bytes: new Uint8Array([1, 2]) }, true, new Uint8Array([1, 2]));
  const changed = semanticCommand({ operationKey: "stage_a", bytes: new Uint8Array([1, 3]) }, true, new Uint8Array([1, 3]));
  assert.equal(first.text.includes("bytes"), false);
  assert.notEqual(first.sha256, changed.sha256);
});

test("semantic commands reject accessors and unsupported values", () => {
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
  assert.throws(() => semanticCommand(accessor), /invalid_semantic_command/u);
  assert.throws(() => semanticCommand({ value: Number.NaN }), /invalid_semantic_command/u);
});

test("reference keys reproduce the frozen length-framed SHA-256 contract", () => {
  assert.equal(
    referenceKey("tmb_", "missing-tombstone", "scope_example", "listing-42", "empty", "inv_example", "final_example"),
    "tmb_617b780c32c7111c5990cc46ea8a992f7ee08ed1507bddcb9ed71746a4a83276",
  );
});
