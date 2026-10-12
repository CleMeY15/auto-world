import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertIdentity } from "../scripts/postgres-image/gosu-derivative-archives-v1.mjs";
import * as builder from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";
import * as controls from "../scripts/postgres-image/gosu-derivative-controls-v1.mjs";

const lock = JSON.parse(await readFile(new URL("../infra/postgres-image/materials/gosu-derivative-lock-v1.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const cacheBytes = new Map([
  ["moby-user", Buffer.from('{"Version":"v0.1.0","Time":"2023-09-18T20:18:40Z","Origin":{"VCS":"git","URL":"https://github.com/moby/sys","Subdir":"user","Hash":"c0711cde08c8fa33857a2c28721659267f49b5e2","Ref":"refs/tags/user/v0.1.0"}}')],
  ["x-sys", Buffer.from('{"Version":"v0.1.0","Time":"2022-10-13T17:17:32Z","Origin":{"VCS":"git","URL":"https://go.googlesource.com/sys","Hash":"95e765b1cc43ac521bd4fd501e00774e34401449","Ref":"refs/tags/v0.1.0"}}')],
]);

test("the former comparator rejects the authentic Go 1.26.9 info-cache serialization", () => {
  for (const item of lock.modules) assert.throws(() => assertIdentity(cacheBytes.get(item.id), item.info, "gosu_module_cache_invalid"), /gosu_module_cache_invalid/u);
});

test("wire and Go cache info identities remain exact and independent", () => {
  for (const item of lock.modules) {
    assertIdentity(Buffer.from(item.id === "moby-user" ? '{"Version":"v0.1.0","Time":"2023-09-18T20:18:40Z","Origin":{"VCS":"git","URL":"https://github.com/moby/sys","Subdir":"user","Ref":"refs/tags/user/v0.1.0","Hash":"c0711cde08c8fa33857a2c28721659267f49b5e2"}}' : '{"Version":"v0.1.0","Time":"2022-10-13T17:17:32Z","Origin":{"VCS":"git","URL":"https://go.googlesource.com/sys","Ref":"refs/tags/v0.1.0","Hash":"95e765b1cc43ac521bd4fd501e00774e34401449"}}'), item.info, "wire_invalid");
    assertIdentity(cacheBytes.get(item.id), builder.moduleInfoCacheIdentity(item), "cache_invalid");
  }
});

test("every cache-byte mutation and the authenticated wire order are rejected", () => {
  for (const item of lock.modules) {
    const authentic = cacheBytes.get(item.id); const descriptor = builder.moduleInfoCacheIdentity(item);
    assert.throws(() => assertIdentity(Buffer.from(item.id === "moby-user" ? '{"Version":"v0.1.0","Time":"2023-09-18T20:18:40Z","Origin":{"VCS":"git","URL":"https://github.com/moby/sys","Subdir":"user","Ref":"refs/tags/user/v0.1.0","Hash":"c0711cde08c8fa33857a2c28721659267f49b5e2"}}' : '{"Version":"v0.1.0","Time":"2022-10-13T17:17:32Z","Origin":{"VCS":"git","URL":"https://go.googlesource.com/sys","Ref":"refs/tags/v0.1.0","Hash":"95e765b1cc43ac521bd4fd501e00774e34401449"}}'), descriptor, "cache_invalid"), /cache_invalid/u);
    for (let offset = 0; offset < authentic.length; offset += 1) { const changed = Buffer.from(authentic); changed[offset] ^= 1; assert.throws(() => assertIdentity(changed, descriptor, "cache_invalid"), /cache_invalid/u); }
  }
});

test("cache descriptors are closed, fixed and complete", () => {
  const mutations = [
    (x) => { delete x.info.cache; }, (x) => { x.info.cache = null; }, (x) => { x.info.cache.extra = true; },
    (x) => { x.info.cache.bytes = 0; }, (x) => { x.info.cache.bytes = -1; }, (x) => { x.info.cache.bytes = 1.5; }, (x) => { x.info.cache.bytes = "205"; },
    (x) => { x.info.cache.bytes += 1; }, (x) => { x.info.cache.sha256 = x.info.cache.sha256.toUpperCase(); }, (x) => { x.info.cache.sha256 = "f".repeat(64); },
    (x) => { x.info.cache.sha256 = "f".repeat(63); }, (x) => { x.info.extra = true; }, (x) => { x.path = "example.invalid/module"; }, (x) => { x.version = "v0.1.1"; },
  ];
  for (const item of lock.modules) {
    assert.deepEqual(builder.moduleInfoCacheIdentity(item), item.info.cache);
    for (const mutate of mutations) { const changed = clone(item); mutate(changed); assert.throws(() => builder.moduleInfoCacheIdentity(changed), /gosu_lock_(?:shape|identity|contract)_invalid/u); }
    const polluted = clone(item); Object.setPrototypeOf(polluted.info.cache, { forged: true }); assert.throws(() => builder.moduleInfoCacheIdentity(polluted), /gosu_lock_identity_invalid/u);
  }
});

test("the complete ordered module collection is validated before preparation mutation", async () => {
  assert.equal(typeof controls.validateLock, "function");
  assert.doesNotThrow(() => controls.validateLock(lock));
  const mutations = [
    (x) => { delete x.modules; }, (x) => { x.modules = []; }, (x) => { x.modules = [x.modules[0]]; },
    (x) => { x.modules = [x.modules[0], clone(x.modules[0])]; }, (x) => { x.modules[0].id = "unknown"; }, (x) => { x.modules.reverse(); },
  ];
  for (const mutate of mutations) { const changed = clone(lock); mutate(changed); assert.throws(() => controls.validateLock(changed), /gosu_lock_(?:shape|contract)_invalid/u); }
  const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url), "utf8");
  assert.match(source, /async function loadLock\(\) \{[^}]*validateLock\(value\);[^}]*return \{ value, identity:/su);
  assert.match(source, /const \{ value: lock \} = await loadLock\(\);[\s\S]*assertInitiallyAbsentOwnedChild/u);
});
