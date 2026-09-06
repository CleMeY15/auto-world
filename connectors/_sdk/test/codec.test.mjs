import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "@auto-world/connector-sdk";

const encoder = new globalThis.TextEncoder();
const limits = { maxBytes: 1024, maxDepth: 4, maxMembers: 32 };
const decode = (text, overrides = {}) =>
  sdk.decodeJsonPage(encoder.encode(text), { ...limits, ...overrides });

test("decoder is a public executable contract, not a build-only placeholder", () => {
  assert.equal(typeof sdk.decodeJsonPage, "function");
});

for (const [text, expected] of [
  ["null", null], ["true", true], ["false", false], ["42", 42], ["-2.5e2", -250],
  ['"é水"', "é水"], ['"\\uD83D\\uDE97"', "🚗"], ["[]", []],
]) {
  test("strict JSON accepts the valid value " + text, () => {
    const result = decode(text);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, expected);
  });
}

test("decoded objects have null prototypes and do not share source references", () => {
  const input = encoder.encode('{"name":"synthetic","nested":[{"x":1}]}');
  const result = sdk.decodeJsonPage(input, limits);
  assert.equal(result.success, true);
  input.fill(0);
  assert.equal(result.data.name, "synthetic");
  assert.equal(Object.getPrototypeOf(result.data), null);
  assert.equal(Object.getPrototypeOf(result.data.nested[0]), null);
  assert.deepEqual(Object.keys(result.data), ["name", "nested"]);
});

for (const [text, code] of [
  ["", "invalid_json"],
  ["[", "invalid_json"],
  ['{"a":}', "invalid_json"],
  ["true false", "invalid_json"],
  ["01", "invalid_json"],
  ["NaN", "invalid_json"],
  ["Infinity", "invalid_json"],
  ["1e999", "invalid_json"],
  ["+1", "invalid_json"],
  ["1.", "invalid_json"],
  ['"\\x41"', "invalid_json"],
  ['"\\uD800"', "invalid_json"],
  ['"\\uDC00"', "invalid_json"],
  ['"\\uD800x"', "invalid_json"],
  ['"line\nbreak"', "invalid_json"],
  ['{"x":1,"x":2}', "duplicate_member"],
  ['{"a":1,"\\u0061":2}', "duplicate_member"],
  ['{"nest":{"x":1,"x":2}}', "duplicate_member"],
  ['{"__proto__":{"polluted":true}}', "invalid_json"],
  ['{"constructor":1}', "invalid_json"],
  ['{"nested":{"prototype":1}}', "invalid_json"],
]) {
  test("strict JSON rejects " + JSON.stringify(text) + " as " + code, () => {
    const result = decode(text);
    assert.equal(result.success, false);
    assert.equal(result.issues[0].code, code);
    assert.deepEqual(Object.keys(result.issues[0]).sort(), ["code", "location", "offset"]);
    assert.ok(Number.isSafeInteger(result.issues[0].offset));
    assert.equal(Object.prototype.polluted, undefined);
  });
}

test("decoded duplicate comparison does not normalize Unicode", () => {
  const result = decode('{"é":1,"e\\u0301":2}');
  assert.equal(result.success, true);
  assert.equal(Object.keys(result.data).length, 2);
  assert.equal(result.data["é"], 1);
  assert.equal(result.data["e\u0301"], 2);
});

for (const bytes of [
  [0xc0, 0xaf], [0xc3], [0xed, 0xa0, 0x80], [0xff], [0xe2, 0x28, 0xa1],
]) {
  test("fatal UTF8 rejects byte sequence " + bytes.join(","), () => {
    const result = sdk.decodeJsonPage(new Uint8Array(bytes), limits);
    assert.equal(result.success, false);
    assert.equal(result.issues[0].code, "invalid_utf8");
  });
}

test("BOM is rejected explicitly and byte limits apply before parsing", () => {
  assert.equal(sdk.decodeJsonPage(new Uint8Array([0xef, 0xbb, 0xbf, 0x31]), limits).success, false);
  const bytes = encoder.encode('"é"');
  assert.equal(sdk.decodeJsonPage(bytes, { ...limits, maxBytes: bytes.length }).success, true);
  assert.equal(sdk.decodeJsonPage(bytes, { ...limits, maxBytes: bytes.length - 1 }).issues[0].code, "payload_too_large");
});

test("exact depth/member bounds distinguish containers from primitive values", () => {
  assert.equal(decode('{"a":1}', { maxDepth: 1, maxMembers: 1 }).success, true);
  assert.equal(decode('{"a":{"b":1}}', { maxDepth: 1 }).issues[0].code, "json_too_deep");
  assert.equal(decode("[1,[2]]", { maxDepth: 2, maxMembers: 3 }).success, true);
  assert.equal(decode("[1,[2]]", { maxMembers: 2 }).issues[0].code, "json_too_large");
  assert.equal(decode("[".repeat(64) + "0" + "]".repeat(64), { maxDepth: 64, maxMembers: 64 }).success, true);
  assert.equal(decode("[".repeat(65) + "0" + "]".repeat(65), { maxDepth: 64, maxMembers: 65 }).issues[0].code, "json_too_deep");
});

test("decoder errors never echo dynamic source content or decoded member names", () => {
  const sensitive = "synthetic-private-text";
  const result = decode('{"' + sensitive + '":1,"' + sensitive + '":2}');
  assert.equal(result.success, false);
  assert.ok(!JSON.stringify(result).includes(sensitive));
  assert.ok(!JSON.stringify(result).includes("synthetic"));
});

test("bounded byte mutation corpus never throws or exposes the original document", () => {
  const base = encoder.encode('{"opaque":"synthetic-never-log","a":[1,true,null]}');
  for (let index = 0; index < base.length; index += 1) {
    for (const replacement of [0, 34, 92, 127, 192, 255]) {
      const input = base.slice();
      input[index] = replacement;
      const result = sdk.decodeJsonPage(input, limits);
      assert.equal(typeof result.success, "boolean");
      if (!result.success) {
        assert.ok(!JSON.stringify(result).includes("synthetic-never-log"));
      }
    }
  }
});
