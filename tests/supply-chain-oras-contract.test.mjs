import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { createBootstrapFixture } from "../scripts/supply-chain/oci.mjs";
import {
  assertOrasRuntime,
  createRegistryHandler,
  createRegistryState,
  parseOrasArguments,
  readFixture,
  verifyRegistryGraph,
} from "../scripts/supply-chain/oras-integration.mjs";

const code = (expected) => (error) => error?.code === expected;

test("layout inventory consumes single-use names once and refuses oversized unexpected output", async () => {
  const owned = await createOwnedDirectory();
  try {
    await mkdir(path.join(owned.path, "blobs"));
    const files = new Map([["index.json", Buffer.from("{}")], ["blobs/config", Buffer.from("config")]]);
    for (const [name, bytes] of files) await writeFile(path.join(owned.path, name), bytes);
    assert.deepEqual(await readFixture(owned.path, files.keys()), new Map([...files].sort()));
    await writeFile(path.join(owned.path, "unexpected"), Buffer.alloc(32 * 1024));
    await assert.rejects(readFixture(owned.path, files.keys()), code("oras_layout_size_limit"));
  } finally { await removeOwnedDirectory(owned); }
});

test("ORAS integration accepts only the fixed absolute CLI contract", () => {
  const parsed = parseOrasArguments([
    "--binary", "/tmp/oras",
    "--sha256", "a".repeat(64),
    "--workspace", "/tmp/owned",
    "--output", "/tmp/owned/oras-integration-result.json",
  ]);
  assert.equal(parsed.binary, "/tmp/oras");
  assert.throws(() => parseOrasArguments([
    "--binary", "oras", "--sha256", "a".repeat(64),
    "--workspace", "/tmp/owned", "--output", "/tmp/owned/result.json",
  ]), code("oras_arguments_refused"));
  assert.throws(() => parseOrasArguments([
    "--binary", "/tmp/oras", "--sha256", "A".repeat(64),
    "--workspace", "/tmp/owned", "--output", "/tmp/owned/result.json",
  ]), code("oras_arguments_refused"));
  assert.throws(() => parseOrasArguments([
    "--binary", "/tmp/oras", "--sha256", "a".repeat(64),
    "--workspace", "/tmp/owned", "--output", "/tmp/owned/result.json", "--debug", "true",
  ]), code("oras_arguments_refused"));
});

test("ORAS runtime refuses non-Linux and non-Actions execution", () => {
  assert.throws(() => assertOrasRuntime("win32", { GITHUB_ACTIONS: "true" }), code("oras_runtime_refused"));
  assert.throws(() => assertOrasRuntime("linux", {}), code("oras_runtime_refused"));
  assert.doesNotThrow(() => assertOrasRuntime("linux", { GITHUB_ACTIONS: "true" }));
});

const exchange = async (handler, { method, path, headers = {}, body = Buffer.alloc(0) }) => {
  const server = (await import("node:http")).createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    return await new Promise((resolve, reject) => {
      const outgoing = request({ host: "127.0.0.1", port: address.port, method, path, headers }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => resolve({ body: Buffer.concat(chunks), headers: response.headers, status: response.statusCode }));
      });
      outgoing.once("error", reject);
      outgoing.end(body);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("minimal registry protocol stores exact blobs and manifests", async () => {
  const state = createRegistryState();
  const handler = createRegistryHandler(state);
  const ping = await exchange(handler, { method: "GET", path: "/v2/" });
  assert.equal(ping.status, 200);

  const start = await exchange(handler, { method: "POST", path: "/v2/oras-test/blobs/uploads/" });
  assert.equal(start.status, 202);
  const bytes = Buffer.from("config");
  const valueDigest = `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}`;
  const finish = await exchange(handler, {
    method: "PUT",
    path: `${start.headers.location}?digest=${encodeURIComponent(valueDigest)}`,
    body: bytes,
  });
  assert.equal(finish.status, 201);
  assert.deepEqual(state.blobs.get(valueDigest), bytes);

  const manifest = Buffer.from('{"mediaType":"application/vnd.oci.image.manifest.v1+json"}');
  const put = await exchange(handler, { method: "PUT", path: "/v2/oras-test/manifests/bootstrap", body: manifest });
  assert.equal(put.status, 201);
  assert.equal(state.tags.get("bootstrap"), put.headers["docker-content-digest"]);
  assert.deepEqual(state.manifests.get(put.headers["docker-content-digest"]), manifest);
});

test("sentinel inspection detects credential material at a secondary origin", async () => {
  const sentinel = "credential-sentinel";
  const encoded = Buffer.from(`user:${sentinel}`).toString("base64");
  const state = createRegistryState({ sentinels: [sentinel, encoded] });
  const handler = createRegistryHandler(state, { inspectForLeaks: true });
  const response = await exchange(handler, {
    method: "POST",
    path: `/token?probe=${sentinel}`,
    headers: { authorization: `Basic ${encoded}` },
    body: Buffer.from(sentinel),
  });
  assert.equal(response.status, 404);
  assert.ok(state.leaks.length >= 2);
});

test("redirect, bearer, and upload-location modes expose only their fixed challenge", async () => {
  const redirect = createRegistryState({ mode: "redirect", secondaryOrigin: "https://localhost:4444" });
  const redirected = await exchange(createRegistryHandler(redirect), { method: "GET", path: "/v2/" });
  assert.equal(redirected.status, 307);
  assert.equal(redirected.headers.location, "https://localhost:4444/v2/");

  const bearer = createRegistryState({ mode: "bearer", secondaryOrigin: "https://localhost:4444" });
  const challenged = await exchange(createRegistryHandler(bearer), { method: "GET", path: "/v2/" });
  assert.equal(challenged.status, 401);
  assert.match(challenged.headers["www-authenticate"], /^Bearer realm="https:\/\/localhost:4444\/token"/u);

  const upload = createRegistryState({ mode: "upload-location", secondaryOrigin: "https://localhost:4444" });
  const moved = await exchange(createRegistryHandler(upload), { method: "POST", path: "/v2/oras-test/blobs/uploads/" });
  assert.equal(moved.status, 202);
  assert.equal(moved.headers.location, "https://localhost:4444/v2/oras-test/blobs/uploads/foreign");

  const denied = createRegistryState({ mode: "deny" });
  const refused = await exchange(createRegistryHandler(denied), { method: "GET", path: "/v2/" });
  assert.equal(refused.status, 418);
});

test("native negatives require credentials to be exercised before the cross-origin challenge", async () => {
  const credential = Buffer.from("user:disposable-sentinel").toString("base64");
  for (const [mode, method, requestPath, expectedStatus] of [
    ["redirect", "HEAD", "/v2/oras-test/manifests/bootstrap", 307],
    ["bearer", "HEAD", "/v2/oras-test/blobs/sha256:" + "a".repeat(64), 401],
    ["upload-location", "POST", "/v2/oras-test/blobs/uploads/", 202],
  ]) {
    const state = createRegistryState({ mode, credential, secondaryOrigin: "https://localhost:4444" });
    const handler = createRegistryHandler(state);
    const initial = await exchange(handler, { method, path: requestPath });
    assert.equal(initial.status, 401);
    assert.equal(state.challenges, 0);
    const authenticated = await exchange(handler, { method, path: requestPath, headers: { authorization: `Basic ${credential}` } });
    assert.equal(authenticated.status, expectedStatus);
    assert.equal(state.challenges, 1);
    assert.equal(state.authenticatedRequests, 1);
  }
});

test("registry graph refuses a duplicate digest hidden across blob and manifest stores", () => {
  const fixture = createBootstrapFixture();
  const state = createRegistryState();
  const bytes = (digest) => fixture.files.get(`blobs/sha256/${digest.slice(7)}`);
  state.blobs.set(fixture.configDigest, bytes(fixture.configDigest));
  state.manifests.set(fixture.childDigest, bytes(fixture.childDigest));
  state.manifests.set(fixture.parentDigest, bytes(fixture.parentDigest));
  state.tags.set("bootstrap", fixture.parentDigest);
  assert.doesNotThrow(() => verifyRegistryGraph(state, fixture));
  state.blobs.set(fixture.parentDigest, bytes(fixture.parentDigest));
  assert.throws(() => verifyRegistryGraph(state, fixture), code("oras_registry_graph_mismatch"));
});

test("local registry refuses cumulative uploads and request floods", async () => {
  const state = createRegistryState();
  const handler = createRegistryHandler(state);
  const start = await exchange(handler, { method: "POST", path: "/v2/oras-test/blobs/uploads/" });
  const first = await exchange(handler, { method: "PATCH", path: start.headers.location, body: Buffer.alloc(32 * 1024) });
  assert.equal(first.status, 202);
  const overflow = await exchange(handler, { method: "PATCH", path: start.headers.location, body: Buffer.from("x") });
  assert.equal(overflow.status, 500);
  assert.equal(state.failure, "oras_registry_request_failed");
  const flooded = createRegistryState();
  flooded.requests = 128;
  assert.equal((await exchange(createRegistryHandler(flooded), { method: "GET", path: "/v2/" })).status, 500);
});
