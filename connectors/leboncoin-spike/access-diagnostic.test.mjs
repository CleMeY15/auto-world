import assert from "node:assert/strict";
import { constants, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { test } from "node:test";
import { ACCESS_TARGET_URL, FRAGMENT_PREFIX, KEY_FINGERPRINT, MAX_BODY_BYTES, MAX_ENVELOPE_BYTES,
  decodeSealedFragments, diagnosticIdentity, encodeSealedFragments, inspectSealedEnvelope, loadDiagnosticPublicKey,
  sealAccessCapture, selectDiagnosticHeaders, summarizeAccessCapture, trackAccessDocument, validateDiagnosticPublicKey } from "./access-diagnostic.mjs";
import { projectAccessDiagnostic, runAccessDiagnostic } from "./diagnose-access.mjs";

const START = Date.parse("2026-11-22T15:00:00.000Z");
const ENV = { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "1" };
const IDENTITY = diagnosticIdentity(ENV, "b".repeat(32));
const RUNTIME = { node: "22.23.2", platform: "linux", arch: "x64" };
const options = { env: ENV, runtime: RUNTIME, startedAt: new Date(START).toISOString(), completedAt: new Date(START + 100).toISOString() };
const requestEvent = (overrides = {}) => ({ type: "Document", frameId: "frame-1", requestId: "request-1", loaderId: "loader-1",
  request: { url: ACCESS_TARGET_URL, method: "GET", headers: { "User-Agent": "SYNTHETIC_AGENT", Cookie: "PRIVATE_COOKIE" } }, ...overrides });
const responseEvent = (status = 403, overrides = {}) => ({ type: "Document", frameId: "frame-1", requestId: "request-1", loaderId: "loader-1",
  response: { url: ACCESS_TARGET_URL, status, mimeType: "text/html", headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "PRIVATE_COOKIE" } }, ...overrides });
const tracker = () => trackAccessDocument({ url: ACCESS_TARGET_URL, frameId: "frame-1" });

async function captured(body = "<html>Please enable JS and disable any ad blocker PRIVATE_TOKEN</html>", status = 403) {
  const state = tracker();
  state.request(requestEvent()); state.response(responseEvent(status)); state.finished({ requestId: "request-1" });
  const calls = [];
  const record = { schema_version: "leboncoin-access-capture/v1", identity: IDENTITY, captured_at: new Date(START + 50).toISOString(),
    ...await state.capture({ send: async (command, args) => { calls.push([command, args]); return { body, base64Encoded: false }; } }) };
  const summary = { ...summarizeAccessCapture(record), goto_calls: 1, navigation_requests_allowed: 1, additional_navigations_blocked: 0 };
  record.public_summary = summary;
  return { record, summary, calls, state };
}

function report(summary) {
  return { schema_version: "leboncoin-own-browser-attempt/v1", acquisition: "own_playwright_dom", requested_url: ACCESS_TARGET_URL,
    status: summary.navigation_status === 403 ? "access_blocked" : "diagnostic_only", navigation_status: summary.navigation_status,
    diagnostic_status: "sealed", transport: { engine: "playwright_chromium", retries: 0, navigation_attempts: 1 },
    runtime: { context: "fresh_nonpersistent", headless: true, chromium_sandbox: true, shared_profile: false,
      playwright_version: "1.64.0", chromium_version: "156.0.8078.4" } };
}

test("403 verification captures the attributed CDP body exactly once and exposes only technical markers", async () => {
  const value = await captured();
  assert.equal(value.record.body.status, "captured");
  assert.equal(value.record.body.representation, "cdp_text_utf8");
  assert.match(Buffer.from(value.record.body.base64, "base64").toString("utf8"), /PRIVATE_TOKEN/u);
  assert.equal(value.summary.classification, "verification_markers_observed");
  assert.equal(value.summary.signals.javascript_required, true);
  assert.deepEqual(value.calls, [["Network.getResponseBody", { requestId: "request-1" }]]);
  assert.equal(JSON.stringify(value.summary).includes("PRIVATE_"), false);
  assert.equal(JSON.stringify(value.record.document).includes("PRIVATE_COOKIE"), false);
  await assert.rejects(value.state.capture({ send: () => assert.fail("second body read") }), /already_attempted/u);
});

test("generic 403 and HTTP 200 verification are distinct from successful listing acquisition", async () => {
  assert.equal((await captured("<h1>Forbidden</h1>")).summary.classification, "generic_access_denied");
  assert.equal((await captured("<h1>Verify you are human</h1>", 200)).summary.classification, "verification_markers_observed");
  assert.equal((await captured("<h1>Some ordinary document</h1>", 200)).summary.classification, "no_refusal_observed");
  assert.equal((await captured("Too many requests", 429)).summary.classification, "rate_limited");
  assert.equal((await captured("Unusual traffic", 200)).summary.classification, "refusal_markers_observed");
  assert.equal((await captured("<script>const errorMessage='Access denied';</script>", 200)).summary.classification, "refusal_markers_observed");
  // Source markers in an ordinary script do not establish a displayed challenge.
  assert.equal((await captured("<script>const captchaEnabled=false;</script><main>Annonce normale</main>", 200)).summary.classification, "verification_markers_observed");
});

test("iframe-only response cannot be assigned to the main document", async () => {
  const state = tracker();
  state.request(requestEvent({ frameId: "other-frame" }));
  state.response(responseEvent(403, { frameId: "other-frame" }));
  state.finished({ requestId: "request-1" });
  const value = await state.capture({ send: () => assert.fail("iframe body must not be requested") });
  assert.equal(value.identity_status, "missing");
  assert.equal(value.body.status, "no_response");
  assert.equal(value.counts.iframe_document_requests_observed, 1);
});

for (const mutation of [
  (state) => state.request(requestEvent({ redirectResponse: { status: 302 } })),
  (state) => state.request(requestEvent({ requestId: "request-2", loaderId: "loader-2" })),
  (state) => state.request(requestEvent({ frameId: "iframe-2" })),
  (state) => state.response(responseEvent(403, { loaderId: "different-loader" })),
  (state) => state.response(responseEvent(403, { response: { url: "https://invalid.example/challenge?PRIVATE_TOKEN", status: 403 } })),
]) {
  test("redirect, reused identity, second document or correlation mismatch rejects attribution", async () => {
    const state = tracker(); state.request(requestEvent()); mutation(state);
    const value = await state.capture({ send: () => assert.fail("ambiguous body must not be read") });
    assert.equal(value.identity_status, "ambiguous");
    assert.equal(value.body.status, "identity_rejected");
    assert.equal(value.document, null);
    assert.equal(value.body.base64, null);
  });
}

test("a late second document invalidates captured attribution before sealing", async () => {
  const value = await captured();
  value.state.request(requestEvent({ requestId: "request-2", loaderId: "loader-2" }));
  const final = value.state.finalize(value.record);
  assert.equal(final.body.status, "identity_rejected");
  assert.equal(final.body.base64, null);
  assert.equal(final.counts.main_document_requests_observed, 2);
});

test("body size limit is exact and text encodings are counted in bytes", async () => {
  assert.equal((await captured("a".repeat(MAX_BODY_BYTES))).record.body.bytes, MAX_BODY_BYTES);
  for (const text of ["a".repeat(MAX_BODY_BYTES + 1), "é".repeat(MAX_BODY_BYTES / 2 + 1)]) {
    const value = await captured(text);
    assert.equal(value.record.body.status, "limit_exceeded");
    assert.equal(value.record.body.sha256, null);
    assert.equal(value.record.body.base64, null);
  }
});

test("base64 bytes are preserved and malformed, evicted or failed bodies never refetch", async () => {
  const examples = [
    { returned: { body: Buffer.from([0, 255, 128]).toString("base64"), base64Encoded: true }, status: "captured", bytes: 3 },
    { returned: { body: "!!!PRIVATE_TOKEN!!!", base64Encoded: true }, status: "unavailable", bytes: null },
    { error: "PRIVATE_PROTOCOL_ERROR", status: "unavailable", bytes: null },
    { error: "Request content was evicted from inspector cache PRIVATE_DETAIL", status: "evicted", bytes: null },
    { failed: true, status: "loading_failed", bytes: null },
  ];
  for (const example of examples) {
    const state = tracker(); state.request(requestEvent()); state.response(responseEvent());
    if (example.failed) state.failed({ requestId: "request-1" }); else state.finished({ requestId: "request-1" });
    let calls = 0;
    const value = await state.capture({ send: async (command) => {
      calls += 1; assert.equal(command, "Network.getResponseBody");
      if (example.error) throw new Error(example.error);
      return example.returned;
    } });
    assert.equal(value.body.status, example.status);
    assert.equal(value.body.bytes, example.bytes);
    assert.equal(calls, example.failed ? 0 : 1);
    assert.equal(JSON.stringify(summarizeAccessCapture(value)).includes("PRIVATE_"), false);
  }
});

test("deadline ends an unfinished body read without a fallback or second call", async () => {
  const state = tracker(); state.request(requestEvent()); state.response(responseEvent()); state.finished({ requestId: "request-1" });
  let calls = 0;
  const value = await state.capture({ send: () => { calls += 1; return new Promise(() => undefined); } }, 2);
  assert.equal(value.body.status, "timeout");
  assert.equal(calls, 1);
});

test("headers use an explicit bounded selection; hostile and secret values do not escape", () => {
  const selected = selectDiagnosticHeaders({ "Set-Cookie": "SECRET", Authorization: "SECRET", Location: "https://invalid.example/PRIVATE_TOKEN",
    "X-DataDome": "PRIVATE_TOKEN", "Content-Type": "text/html", Server: "s".repeat(1025), "X-Private": "PRIVATE_TOKEN" });
  assert.deepEqual(selected.values, { "content-type": "text/html" });
  assert.equal(selected.limited, true);
  assert.equal(JSON.stringify(selected).includes("SECRET"), false);
});

test("the committed public key has the required fingerprint and invalid keys stop before invocation", async () => {
  const key = await loadDiagnosticPublicKey();
  assert.equal(key.fingerprint, KEY_FINGERPRINT);
  let calls = 0;
  await assert.rejects(runAccessDiagnostic({ env: ENV, runtime: RUNTIME, clock: () => START,
    prepare: async () => validateDiagnosticPublicKey("PRIVATE_INVALID_KEY"),
    run: async () => { calls += 1; } }), /public_key_invalid/u);
  assert.equal(calls, 0);
  await assert.rejects(runAccessDiagnostic({ env: { ...ENV, GITHUB_RUN_ATTEMPT: "2" }, runtime: RUNTIME, clock: () => START,
    prepare: async () => key, run: async () => { calls += 1; } }), /identity_invalid/u);
  assert.equal(calls, 0);
});

test("standard RSA OAEP SHA256 and AES GCM round trip binds AAD and rejects altered ciphertext/tag/key", async () => {
  // Synthetic keypair exists only in this offline test. No retained private key is opened.
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const pem = pair.publicKey.export({ type: "spki", format: "pem" });
  const fingerprint = createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const key = validateDiagnosticPublicKey(pem, fingerprint);
  const { record } = await captured();
  const first = sealAccessCapture(record, key);
  const second = sealAccessCapture(record, key);
  assert.notDeepEqual(first, second);
  const original = JSON.parse(first);
  const decrypt = (envelope) => {
    const aesKey = privateDecrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.wrapped_key_base64, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(envelope.nonce_base64, "base64"));
    decipher.setAAD(Buffer.from(envelope.aad_base64, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag_base64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext_base64, "base64")), decipher.final()]);
  };
  assert.deepEqual(JSON.parse(decrypt(original)), record);
  assert.equal(inspectSealedEnvelope(first, IDENTITY, fingerprint).bytes, first.length);
  for (const field of ["aad_base64", "wrapped_key_base64", "nonce_base64", "tag_base64", "ciphertext_base64"]) {
    const altered = globalThis.structuredClone(original);
    const bytes = Buffer.from(altered[field], "base64"); bytes[0] ^= 1; altered[field] = bytes.toString("base64");
    assert.throws(() => decrypt(altered));
  }
  assert.throws(() => validateDiagnosticPublicKey(pem), /public_key_invalid/u);
  assert.throws(() => inspectSealedEnvelope(first, { ...IDENTITY, github_run_id: "987" }, fingerprint));
});

test("fragment transport preserves exact envelope bytes and rejects missing/reordered/corrupt content", async () => {
  const { record } = await captured("a".repeat(MAX_BODY_BYTES));
  const sealed = sealAccessCapture(record, await loadDiagnosticPublicKey());
  const lines = encodeSealedFragments(sealed);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => Buffer.byteLength(`${line}\n`) <= 4096));
  assert.deepEqual(decodeSealedFragments(lines), sealed);
  assert.throws(() => decodeSealedFragments(lines.slice(1)));
  assert.throws(() => decodeSealedFragments([...lines].reverse()));
  const corrupt = [...lines];
  const item = JSON.parse(corrupt[0].slice(FRAGMENT_PREFIX.length));
  item.data = `${item.data[0] === "A" ? "B" : "A"}${item.data.slice(1)}`;
  corrupt[0] = `${FRAGMENT_PREFIX}${JSON.stringify(item)}`;
  assert.throws(() => decodeSealedFragments(corrupt));
  assert.throws(() => encodeSealedFragments(Buffer.alloc(MAX_ENVELOPE_BYTES + 1)));
});

test("public projection rejects a forged binding and omits all source text and arbitrary fields", async () => {
  const { record, summary } = await captured();
  const sealedBytes = sealAccessCapture(record, await loadDiagnosticPublicKey());
  const input = { execution: "finished", exitCode: 2, report: report(summary), summary, sealedBytes };
  input.report.title = "PRIVATE_TITLE"; input.report.reason = "PRIVATE_ERROR";
  input.summary.photo = "https://invalid.example/PRIVATE_PHOTO"; input.summary.vin = "PRIVATE_VIN";
  const receipt = projectAccessDiagnostic(input, options);
  assert.equal(receipt.status, "response_captured");
  assert.equal(receipt.response_status, 403);
  assert.equal(JSON.stringify(receipt).includes("PRIVATE_"), false);
  assert.equal(JSON.stringify(receipt).includes("leboncoin.fr"), false);
  assert.equal(receipt.sealed_response_bytes, sealedBytes.length);
  assert.equal(projectAccessDiagnostic({ ...input, summary: { ...summary, capture_id: "c".repeat(32) } }, options).status, "invalid_evidence");
  const extra = JSON.parse(sealedBytes); extra.private_text = "PRIVATE_LEAK";
  assert.equal(projectAccessDiagnostic({ ...input, sealedBytes: Buffer.from(JSON.stringify(extra)) }, options).status, "invalid_evidence");
});

test("one-shot execution never retries a refusal, timeout, partial record or child exception", async () => {
  for (const execution of ["finished", "timeout", "error", "throw"]) {
    let calls = 0; let now = START;
    const result = await runAccessDiagnostic({ env: ENV, runtime: RUNTIME, clock: () => now, prepare: async () => undefined,
      run: async () => { calls += 1; now += 10; if (execution === "throw") throw new Error("PRIVATE_ERROR"); return { execution, exitCode: 2 }; } });
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result.receipt).includes("PRIVATE_"), false);
    assert.notEqual(result.receipt.status, "response_captured");
  }
});
