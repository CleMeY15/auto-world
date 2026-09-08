import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertClosedObject,
  canonicalJsonBuffer,
  parseBoundedJson,
  sha256,
} from "../scripts/supply-chain/strict-json.mjs";

const code = (expected) => (error) => error?.code === expected;

test("strict JSON rejects duplicate keys, malformed UTF-8, and trailing data", () => {
  assert.throws(() => parseBoundedJson(Buffer.from('{"a":1,"a":2}')), code("JSON_DUPLICATE_KEY"));
  assert.throws(() => parseBoundedJson(Buffer.from([0xc3, 0x28])), code("JSON_UTF8_INVALID"));
  assert.throws(() => parseBoundedJson(Buffer.from("{}[]")), code("JSON_TRAILING_DATA"));
});

test("strict JSON enforces byte, depth, and member boundaries exactly", () => {
  const bytes = Buffer.from('{"a":1}');
  assert.deepEqual(parseBoundedJson(bytes, { maxBytes: bytes.length }), { a: 1 });
  assert.throws(
    () => parseBoundedJson(bytes, { maxBytes: bytes.length - 1 }),
    code("JSON_TOO_LARGE"),
  );
  assert.deepEqual(parseBoundedJson(Buffer.from("[[0]]"), { maxDepth: 2 }), [[0]]);
  assert.throws(
    () => parseBoundedJson(Buffer.from("[[0]]"), { maxDepth: 1 }),
    code("JSON_DEPTH_EXCEEDED"),
  );
  assert.deepEqual(parseBoundedJson(Buffer.from("[0,1]"), { maxMembers: 2 }), [0, 1]);
  assert.throws(
    () => parseBoundedJson(Buffer.from("[0,1]"), { maxMembers: 1 }),
    code("JSON_MEMBERS_EXCEEDED"),
  );
});

test("canonical JSON is deterministic and does not mutate its input", () => {
  const input = { z: [3, { y: true, x: null }], a: "é" };
  const before = JSON.parse(JSON.stringify(input));
  const first = canonicalJsonBuffer(input);
  const second = canonicalJsonBuffer({ a: "é", z: [3, { x: null, y: true }] });

  assert.equal(first.toString("utf8"), '{"a":"é","z":[3,{"x":null,"y":true}]}');
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(sha256(Buffer.alloc(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("closed object validation rejects missing, unknown, and ambiguous key contracts", () => {
  assert.equal(assertClosedObject({ a: 1, b: 2 }, ["a"], ["b"]).b, 2);
  assert.throws(() => assertClosedObject({}, ["a"]), code("SCHEMA_FIELD_MISSING"));
  assert.throws(() => assertClosedObject({ a: 1, c: 3 }, ["a"]), code("SCHEMA_FIELD_UNKNOWN"));
  assert.throws(() => assertClosedObject({ a: 1 }, ["a"], ["a"]), code("SCHEMA_KEYS_INVALID"));
});

test("prototype-shaped JSON keys remain inert own data", () => {
  const parsed = parseBoundedJson(Buffer.from('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, "__proto__"), true);
  assert.equal({}.polluted, undefined);
  assert.equal(canonicalJsonBuffer(parsed).toString("utf8"), '{"__proto__":{"polluted":true}}');
});

test("canonical JSON rejects cyclic, sparse, accessor, and non-finite values", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = Array(2);
  sparse[1] = 1;
  assert.throws(() => canonicalJsonBuffer(cyclic), code("JSON_VALUE_CYCLIC"));
  assert.throws(() => canonicalJsonBuffer(sparse), code("JSON_VALUE_INVALID"));
  assert.throws(() => canonicalJsonBuffer({ get unsafe() { return 1; } }), code("JSON_VALUE_INVALID"));
  assert.throws(() => canonicalJsonBuffer({ value: Number.POSITIVE_INFINITY }), code("JSON_VALUE_INVALID"));
});
