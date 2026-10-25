import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as api from "../scripts/postgres-image/gosu-derivative-candidate-v2.mjs";

const LOCK_FILE = new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url);
const RECIPE_FILE = new URL("../infra/postgres-image/Dockerfile.gosu-derivative-v2", import.meta.url);
const LOCK_BYTES = readFileSync(LOCK_FILE);
const RECIPE_BYTES = readFileSync(RECIPE_FILE);
const hash = (body) => createHash("sha256").update(body).digest("hex");
const identity = (body) => ({ bytes: body.byteLength, sha256: hash(body) });
const error = (code) => ({ message: code });
const open = () => api.openCandidateLockV2(LOCK_BYTES);

function contextInput(contract) {
  return {
    entries: contract.contextEntries.map((entry) => entry.type === "directory"
      ? { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime }
      : { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime, body: Buffer.alloc(0) }),
  };
}

test("candidate v2 exports only the four fixed pure interfaces", () => {
  assert.deepEqual(Object.keys(api).sort(), ["candidateContractV2", "matchExactBytesV2", "openCandidateLockV2", "validateCandidateContextV2"]);
});

test("the real candidate lock opens and returns a detached deeply frozen contract", () => {
  const handle = open();
  const contract = api.candidateContractV2(handle);
  assert.equal(Object.getPrototypeOf(handle), null);
  assert.equal(Object.isFrozen(handle), true);
  assert.deepEqual(Object.keys(contract), [
    "schemaVersion", "authority", "image", "base", "baseExecutable", "replacement", "evidenceFiles", "parentPaths",
    "manifest", "recipe", "contextEntries", "builderProfile",
  ]);
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.authority, "NOT_AUTHORIZED");
  assert.equal(contract.image, "UNBUILT");
  assert.equal(contract.base.platformDigest, "sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3");
  assert.deepEqual(contract.baseExecutable, {
    path: "usr/local/bin/gosu", type: "file", mode: 0o755, uid: 0, gid: 0, mtime: 1789680549,
    size: 1769900, sha256: "52c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0",
  });
  assert.equal(contract.replacement.size, 1936912);
  assert.equal(contract.replacement.sha256, "d0a386b6fcd757540277ed91e213e7c51f2406bad2965535ce0bd2c6214339d4");
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.evidenceFiles), true);
  assert.equal(Object.isFrozen(contract.evidenceFiles[0]), true);
  assert.throws(() => { contract.replacement.size = 1; }, TypeError);
  const second = api.candidateContractV2(handle);
  assert.notEqual(second, contract);
  assert.deepEqual(second, contract);
});

test("manifest, descriptor and recipe bytes are canonical and exactly bound", () => {
  const contract = api.candidateContractV2(open());
  const expectedNames = [
    "gosu-LICENSE", "moby-user-LICENSE", "go-LICENSE", "go-PATENTS", "x-sys-LICENSE", "x-sys-PATENTS",
    "notices.json", "module-closure.json", "sbom.cdx.json", "version.txt", "build-info.txt", "derivative-manifest.json",
  ];
  assert.deepEqual(contract.evidenceFiles.map((item) => item.path.split("/").at(-1)), expectedNames);
  assert.deepEqual(contract.contextEntries.map((item) => item.path), [
    "Dockerfile", "gosu", "auto-world-gosu", ...expectedNames.map((name) => `auto-world-gosu/${name}`),
  ]);
  assert.deepEqual(identity(Buffer.from(contract.recipe.text)), contract.recipe.identity);
  assert.deepEqual(RECIPE_BYTES, Buffer.from(contract.recipe.text));
  assert.equal(contract.recipe.text.includes("\r"), false);
  assert.equal(contract.recipe.text.endsWith("\n"), true);
  assert.equal(contract.recipe.text.split("\n").length, 4);
  assert.deepEqual(identity(Buffer.from(contract.manifest.text)), contract.manifest.identity);
  const manifest = JSON.parse(contract.manifest.text);
  assert.equal(contract.manifest.text, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(Object.keys(manifest), [
    "kind", "schemaVersion", "component", "state", "authority", "base", "source", "compiler", "modules", "binary",
    "preparation", "documents", "claims", "dates",
  ]);
  assert.deepEqual(manifest.documents.map(({ name }) => name), expectedNames.slice(0, -1));
  assert.equal(manifest.preparation.artifacts[0].jobId, 115597243634);
  assert.equal(manifest.preparation.artifacts[1].jobId, 115597243869);
  for (const forbidden of ["ownHash", "lockRawSHA", "recipeSHA", "imageDigest", "currentEvidence"]) {
    assert.equal(contract.manifest.text.includes(`"${forbidden}"`), false);
  }
  const manifestDescriptor = contract.evidenceFiles.at(-1);
  assert.deepEqual({ bytes: manifestDescriptor.size, sha256: manifestDescriptor.sha256 }, contract.manifest.identity);
});

test("the byte matcher accepts only exact native copied bytes and returns a frozen identity", () => {
  const body = Buffer.from("explicitly synthetic matcher fixture\n");
  let reads = 0;
  for (const key of ["buffer", "byteLength", "byteOffset", "constructor", Symbol.iterator]) {
    Object.defineProperty(body, key, { configurable: true, get() { reads++; throw new Error("caller getter read"); } });
  }
  const result = api.matchExactBytesV2(body, identity(Buffer.from(body)));
  assert.deepEqual(result, identity(Buffer.from(body)));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(reads, 0);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(api.matchExactBytesV2(bytes, identity(bytes)), identity(bytes));
  bytes[0] = 9;
  assert.deepEqual(result, identity(Buffer.from("explicitly synthetic matcher fixture\n")));
});

test("the byte matcher closes native type, identity and resource attacks", () => {
  const code = "postgres_gosu_derivative_binary_identity_invalid";
  const body = Buffer.from("synthetic\n"); const wanted = identity(body);
  assert.throws(() => api.matchExactBytesV2(Buffer.from("changed\n"), wanted), error(code));
  assert.throws(() => api.matchExactBytesV2(new Proxy(body, {}), wanted), error(code));
  const derived = new (class extends Uint8Array {})(body);
  assert.throws(() => api.matchExactBytesV2(derived, wanted), error(code));
  const shared = new Uint8Array(new SharedArrayBuffer(8));
  assert.throws(() => api.matchExactBytesV2(shared, identity(shared)), error(code));
  const detachedBuffer = new ArrayBuffer(8); const detached = new Uint8Array(detachedBuffer);
  globalThis.structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
  assert.throws(() => api.matchExactBytesV2(detached, { bytes: 0, sha256: hash(Buffer.alloc(0)) }), error(code));
  if (typeof ArrayBuffer.prototype.resize === "function") {
    const resizable = new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }));
    assert.throws(() => api.matchExactBytesV2(resizable, identity(resizable)), error(code));
  }
  let getterReads = 0;
  const accessor = {}; Object.defineProperty(accessor, "bytes", { enumerable: true, get() { getterReads++; return body.length; } });
  Object.defineProperty(accessor, "sha256", { enumerable: true, value: wanted.sha256 });
  assert.throws(() => api.matchExactBytesV2(body, accessor), error(code));
  assert.equal(getterReads, 0);
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { getterReads++; throw new Error("trap"); }, getPrototypeOf() { getterReads++; throw new Error("trap"); } });
  assert.throws(() => api.matchExactBytesV2(body, hostile), error(code));
  assert.equal(getterReads, 0);
  assert.throws(() => api.matchExactBytesV2(body, { ...wanted, extra: true }), error(code));
  assert.throws(() => api.matchExactBytesV2(body, Object.assign(Object.create(null), wanted)), error(code));
  assert.throws(() => api.matchExactBytesV2(Buffer.allocUnsafe(67_108_865), { bytes: 67_108_865, sha256: "0".repeat(64) }), error(code));
  const boundary = Buffer.alloc(67_108_864, 0x61);
  assert.deepEqual(api.matchExactBytesV2(boundary, identity(boundary)), identity(boundary));
});

test("lock bytes and every embedded source authority are anchored before parsing", () => {
  const code = "postgres_gosu_derivative_lock_invalid";
  const value = JSON.parse(LOCK_BYTES);
  const mutations = [
    (item) => { item.sourceContract.preparationLock.sha256 = "0".repeat(64); },
    (item) => { item.sourceContract.helpers.controls.bytes++; },
    (item) => { item.preparation.acceptance.sha256 = "0".repeat(64); },
    (item) => { item.preparation.documentProjection.bytes++; },
    (item) => { item.binary.sha256 = "0".repeat(64); },
    (item) => { item.evidence[0].sha256 = "0".repeat(64); },
    (item) => { item.claims.candidateAdmission = "AUTHORIZED"; },
    (item) => { item.dates.supportStartsAt = "future"; },
    (item) => { item.ownHash = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const changed = globalThis.structuredClone(value); mutate(changed);
    assert.throws(() => api.openCandidateLockV2(Buffer.from(`${JSON.stringify(changed, null, 2)}\n`)), error(code));
  }
  assert.throws(() => api.openCandidateLockV2(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), LOCK_BYTES])), error(code));
  assert.throws(() => api.openCandidateLockV2(Buffer.alloc(65_537)), error(code));
  assert.throws(() => api.openCandidateLockV2(new Proxy(LOCK_BYTES, {})), error(code));
});

test("opaque handles reject clones, proxies and handles from another module instance", async () => {
  const code = "postgres_gosu_derivative_lock_invalid";
  const handle = open();
  assert.throws(() => api.candidateContractV2(globalThis.structuredClone(handle)), error(code));
  assert.throws(() => api.candidateContractV2(new Proxy(handle, {})), error(code));
  const foreign = await import(`../scripts/postgres-image/gosu-derivative-candidate-v2.mjs?foreign=${Date.now()}`);
  assert.throws(() => foreign.candidateContractV2(handle), error(code));
  assert.throws(() => api.candidateContractV2(foreign.openCandidateLockV2(LOCK_BYTES)), error(code));
});

test("context validation rejects hostile shapes and caps before any genuine binary claim", () => {
  const handle = open(); const contract = api.candidateContractV2(handle);
  const code = "postgres_gosu_derivative_context_invalid";
  assert.throws(() => api.validateCandidateContextV2(handle, {}), error(code));
  assert.throws(() => api.validateCandidateContextV2(handle, { entries: [] }), error(code));
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("trap"); }, getPrototypeOf() { throw new Error("trap"); } });
  assert.throws(() => api.validateCandidateContextV2(handle, proxy), error(code));
  const accessor = contextInput(contract); let reads = 0;
  Object.defineProperty(accessor.entries[0], "body", { enumerable: true, get() { reads++; throw new Error("body getter"); } });
  assert.throws(() => api.validateCandidateContextV2(handle, accessor), error(code));
  assert.equal(reads, 0);
  const wrongOrder = contextInput(contract); [wrongOrder.entries[0], wrongOrder.entries[1]] = [wrongOrder.entries[1], wrongOrder.entries[0]];
  assert.throws(() => api.validateCandidateContextV2(handle, wrongOrder), error(code));
  const unknown = contextInput(contract); unknown.entries[0].extra = true;
  assert.throws(() => api.validateCandidateContextV2(handle, unknown), error(code));
  const hole = contextInput(contract); delete hole.entries[5];
  assert.throws(() => api.validateCandidateContextV2(handle, hole), error(code));
  const symbolEntry = contextInput(contract); symbolEntry.entries[Symbol("hidden")] = true;
  assert.throws(() => api.validateCandidateContextV2(handle, symbolEntry), error(code));
  const recipeMismatch = contextInput(contract); recipeMismatch.entries[0].body = Buffer.from("changed\n");
  assert.throws(() => api.validateCandidateContextV2(handle, recipeMismatch), error(code));
  const recipeCap = contextInput(contract); recipeCap.entries[0].body = Buffer.alloc(4_097);
  assert.throws(() => api.validateCandidateContextV2(handle, recipeCap), error(code));
  const binaryCap = contextInput(contract); binaryCap.entries[0].body = RECIPE_BYTES; binaryCap.entries[1].body = Buffer.allocUnsafe(67_108_865);
  assert.throws(() => api.validateCandidateContextV2(handle, binaryCap), error(code));
  const documentCap = contextInput(contract); documentCap.entries[3].body = Buffer.allocUnsafe(262_145);
  assert.throws(() => api.validateCandidateContextV2(handle, documentCap), error(code));
  const totalCap = contextInput(contract);
  for (let index = 3; index < totalCap.entries.length; index++) totalCap.entries[index].body = Buffer.alloc(90_000);
  assert.throws(() => api.validateCandidateContextV2(handle, totalCap), error(code));
  const linked = contextInput(contract); linked.entries.push(linked.entries[0]);
  assert.throws(() => api.validateCandidateContextV2(handle, linked), error(code));
});

test("no synthetic fixture is reported as a genuine full candidate context", () => {
  const handle = open(); const contract = api.candidateContractV2(handle); const input = contextInput(contract);
  input.entries[0].body = RECIPE_BYTES;
  input.entries[1].body = Buffer.from("explicitly synthetic, not the retained binary\n");
  input.entries[3].body = Buffer.from("explicitly synthetic evidence\n");
  assert.throws(() => api.validateCandidateContextV2(handle, input), error("postgres_gosu_derivative_context_invalid"));
});

test("context metadata is rejected before invoking any caller path method", () => {
  const handle = open(); const contract = api.candidateContractV2(handle);
  let calls = 0;
  const input = contextInput(contract);
  input.entries[0].path = { get startsWith() { calls++; throw new Error("synthetic_caller_hook"); } };
  assert.throws(() => api.validateCandidateContextV2(handle, input), error("postgres_gosu_derivative_context_invalid"));
  assert.equal(calls, 0);
  input.entries[0].path = new Proxy({}, { get() { calls++; throw new Error("synthetic_caller_hook"); } });
  assert.throws(() => api.validateCandidateContextV2(handle, input), error("postgres_gosu_derivative_context_invalid"));
  assert.equal(calls, 0);
});
