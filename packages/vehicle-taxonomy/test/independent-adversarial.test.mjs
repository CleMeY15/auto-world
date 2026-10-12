import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMakeId,
  parseTaxonomyEntryReference,
  parseTaxonomyRelease,
  resolveTaxonomyEntryReference,
} from "../dist/index.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const baseRelease = () => ({
  schemaVersion: 1,
  catalogId: "taxcat_adversarial",
  releaseId: "taxrel_adversarial_1",
  revision: 1,
  releasedAt: "2026-10-12T00:00:00.000Z",
  dataMode: "synthetic",
  attributions: [
    { attributionId: "taxattr_a", kind: "synthetic_fixture", fixtureRef: "fixture/adversarial/a" },
    { attributionId: "taxattr_b", kind: "synthetic_fixture", fixtureRef: "fixture/adversarial/b" },
  ],
  makes: [
    {
      makeId: "make_a",
      primaryName: { value: "AW Fixture Label A", attributionId: "taxattr_a" },
      aliases: [{ value: "AW Fixture Label B", attributionId: "taxattr_b" }],
    },
  ],
  models: [
    {
      modelId: "model_a",
      makeId: "make_a",
      primaryName: { value: "AW Fixture Model Alpha", attributionId: "taxattr_a" },
      aliases: [],
    },
  ],
});

const assertRejected = (result) => {
  assert.equal(result.success, false);
  assert.ok(result.issues.length > 0);
};

const assertRecursivelyFrozen = (value, seen = new Set()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertRecursivelyFrozen(value[key], seen);
  }
};

test("rejects a revoked release proxy without throwing", () => {
  const { proxy, revoke } = Proxy.revocable(baseRelease(), {});
  revoke();

  let result;
  assert.doesNotThrow(() => {
    result = parseTaxonomyRelease(proxy);
  });
  assertRejected(result);
});

test("sanitizes reflection errors from a hostile nested proxy", () => {
  const input = baseRelease();
  input.makes[0].primaryName = new Proxy(input.makes[0].primaryName, {
    ownKeys() {
      throw new Error("SECRET_REFLECTION_SENTINEL");
    },
  });

  let result;
  assert.doesNotThrow(() => {
    result = parseTaxonomyRelease(input);
  });
  assertRejected(result);
  assert.equal(JSON.stringify(result).includes("SECRET_REFLECTION_SENTINEL"), false);
});

test("rejects a non-enumerable release property", () => {
  const input = baseRelease();
  Object.defineProperty(input, "hidden", { value: "SECRET_HIDDEN", enumerable: false });

  assertRejected(parseTaxonomyRelease(input));
});

test("rejects a symbol property on a nested name", () => {
  const input = baseRelease();
  input.makes[0].primaryName[Symbol("secret")] = "SECRET_SYMBOL";

  assertRejected(parseTaxonomyRelease(input));
});

test("rejects an augmented collection array", () => {
  const input = baseRelease();
  input.models.extra = "SECRET_ARRAY_PROPERTY";

  assertRejected(parseTaxonomyRelease(input));
});

test("rejects a sparse collection array", () => {
  const input = baseRelease();
  input.models.length = 2;

  assertRejected(parseTaxonomyRelease(input));
});

test("rejects a non-enumerable array index", () => {
  const input = baseRelease();
  const model = input.models[0];
  Object.defineProperty(input.models, "0", { value: model, enumerable: false });

  assertRejected(parseTaxonomyRelease(input));
});

test("rejects a dangling parent on the final model", () => {
  const input = baseRelease();
  input.models.push({
    modelId: "model_z",
    makeId: "make_missing",
    primaryName: { value: "AW Fixture Model Zeta", attributionId: "taxattr_a" },
    aliases: [],
  });

  const result = parseTaxonomyRelease(input);
  assertRejected(result);
  assert.deepEqual(result.issues[0], {
    code: "invalid_value",
    path: "release.models[1].makeId",
  });
});

test("rejects a dangling attribution on the final alias", () => {
  const input = baseRelease();
  input.makes[0].aliases.push({ value: "AW Fixture Label Z", attributionId: "taxattr_missing" });

  const result = parseTaxonomyRelease(input);
  assertRejected(result);
  assert.deepEqual(result.issues[0], {
    code: "invalid_value",
    path: "release.makes[0].aliases[1].attributionId",
  });
});

test("accepts the maximum ID suffix length", () => {
  const result = parseMakeId(`make_${"a".repeat(64)}`);

  assert.equal(result.success, true);
});

test("rejects an ID suffix beyond the maximum length", () => {
  const result = parseMakeId(`make_${"a".repeat(65)}`);

  assertRejected(result);
});

test("accepts exact UTC millisecond timestamps at supported year limits", () => {
  for (const releasedAt of ["0001-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z"]) {
    const input = baseRelease();
    input.releasedAt = releasedAt;
    assert.equal(parseTaxonomyRelease(input).success, true, releasedAt);
  }
});

test("rejects a timestamp without exact millisecond precision", () => {
  const input = baseRelease();
  input.releasedAt = "2026-10-12T00:00:00Z";

  assertRejected(parseTaxonomyRelease(input));
});

test("enforces the UTF-16 name length boundary", () => {
  const accepted = baseRelease();
  accepted.makes[0].primaryName.value = "A".repeat(80);
  assert.equal(parseTaxonomyRelease(accepted).success, true);

  const rejected = baseRelease();
  rejected.makes[0].primaryName.value = "A".repeat(81);
  assertRejected(parseTaxonomyRelease(rejected));
});

test("enforces the fixture reference length boundary", () => {
  const accepted = baseRelease();
  accepted.attributions[0].fixtureRef = "a".repeat(128);
  assert.equal(parseTaxonomyRelease(accepted).success, true);

  const rejected = baseRelease();
  rejected.attributions[0].fixtureRef = "a".repeat(129);
  assertRejected(parseTaxonomyRelease(rejected));
});

test("rejects duplicate alias values with different attributions", () => {
  const input = baseRelease();
  input.makes[0].aliases.push({ value: "AW Fixture Label B", attributionId: "taxattr_a" });

  assertRejected(parseTaxonomyRelease(input));
});

test("accepts null-prototype records at every object layer", () => {
  const toNullPrototype = (value) => {
    if (Array.isArray(value)) return value.map(toNullPrototype);
    if (value === null || typeof value !== "object") return value;
    const result = Object.create(null);
    for (const [key, child] of Object.entries(value)) result[key] = toNullPrototype(child);
    return result;
  };

  assert.equal(parseTaxonomyRelease(toNullPrototype(baseRelease())).success, true);
});

test("rebuilds a recursively frozen graph without caller-owned objects", () => {
  const input = baseRelease();
  const result = parseTaxonomyRelease(input);
  assert.equal(result.success, true);

  assertRecursivelyFrozen(result);
  assert.notEqual(result.data, input);
  assert.notEqual(result.data.attributions, input.attributions);
  assert.notEqual(result.data.attributions[0], input.attributions[0]);
  assert.notEqual(result.data.makes, input.makes);
  assert.notEqual(result.data.makes[0], input.makes[0]);
  assert.notEqual(result.data.makes[0].primaryName, input.makes[0].primaryName);
  assert.notEqual(result.data.makes[0].aliases, input.makes[0].aliases);
  assert.notEqual(result.data.models, input.models);
  assert.notEqual(result.data.models[0], input.models[0]);
});

test("resolves altered content from an independently parsed snapshot with the same tuple", () => {
  const first = parseTaxonomyRelease(baseRelease());
  const alteredInput = clone(baseRelease());
  alteredInput.makes[0].primaryName.value = "Bster";
  const altered = parseTaxonomyRelease(alteredInput);
  const reference = parseTaxonomyEntryReference({
    kind: "make",
    release: {
      catalogId: "taxcat_adversarial",
      releaseId: "taxrel_adversarial_1",
      revision: 1,
    },
    makeId: "make_a",
  });

  assert.equal(first.success, true);
  assert.equal(altered.success, true);
  assert.equal(reference.success, true);
  const resolution = resolveTaxonomyEntryReference(altered.data, reference.data);
  assert.equal(resolution.status, "found");
  assert.equal(resolution.kind, "make");
  assert.equal(resolution.data.primaryName.value, "Bster");
  assert.equal(Object.isFrozen(resolution), true);
  assert.equal(resolution.data, altered.data.makes[0]);
});
