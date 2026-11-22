import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createHttpsTransport, isPublicAddress, responsePolicy, retryAfter } from "../dist/transport.js";

const publicV4 = { address: "1.1.1.1", family: 4 };
const publicV6 = { address: "2606:4700:4700::1111", family: 6 };
const url = "https://listings.example.com/vehicles/car-123";
const terminal = { success: false, kind: "terminal" };
const transient = { success: false, kind: "transient" };

function response({ status = 200, headers = { "content-type": "text/html; charset=utf-8" }, chunks = [Buffer.from("<html>car</html>")], complete = true } = {}) {
  const stream = Readable.from(chunks, { objectMode: false });
  stream.statusCode = status;
  stream.headers = headers;
  stream.complete = complete;
  return stream;
}

// These are local DNS and HTTPS doubles. No test opens a socket or resolves a
// real host; request options are captured before the simulated response starts.
function harness({ addresses = [publicV4], resolver, incoming = response(), serve } = {}) {
  const dnsCalls = [];
  const requestCalls = [];
  const transport = createHttpsTransport({
    resolve(hostname, options) {
      dnsCalls.push({ hostname, options });
      return resolver ? resolver(hostname, options) : Promise.resolve(addresses);
    },
    request(target, options, respond) {
      const request = new EventEmitter();
      const call = { target, options, request, endCalls: 0 };
      requestCalls.push(call);
      const abort = () => request.emit("error", new Error("simulated request aborted"));
      const cleanup = () => options.signal.removeEventListener("abort", abort);
      options.signal.addEventListener("abort", abort, { once: true });
      request.once("error", cleanup);
      incoming.once("end", cleanup);
      incoming.once("close", cleanup);
      request.end = () => {
        call.endCalls += 1;
        globalThis.queueMicrotask(() => {
          if (options.signal.aborted) return;
          if (serve) serve({ request, respond, incoming });
          else respond(incoming);
        });
      };
      return request;
    },
  });
  return {
    dnsCalls, requestCalls, incoming,
    capture(overrides = {}) {
      return transport.capture({ url, maxBytes: 1024, signal: new globalThis.AbortController().signal, ...overrides });
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function policy(statusCode, headers = { "content-type": "text/html" }, maxBytes = 1024) {
  return responsePolicy({ statusCode, headers }, maxBytes);
}

test("public address policy permits public IPv4 and native IPv6 unicast", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "100.63.255.254", "100.128.0.1", "172.15.255.254", "172.32.0.1", "2001:4860:4860::8888", "2606:4700:4700::1111", "2a00:1450:4001:800::200e"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("public address policy refuses private, local, special-use and invalid IPv4", () => {
  for (const address of [
    "0.0.0.0", "0.12.34.56", "10.0.0.1", "127.0.0.1", "127.255.255.254",
    "100.64.0.1", "100.127.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.254",
    "192.168.1.1", "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.19.255.254",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "", "example.com", "1.1.1.999", "127.1", "2130706433", "0x7f000001", "1.1.1.1 ",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("public address policy refuses local, mapped, transition and documentation IPv6", () => {
  for (const address of [
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "64:ff9b::808:808",
    "2001::1", "2001:20::1", "2001:db8::1", "2002:808:808::1", "3fff::1", "4000::1",
    "[2606:4700:4700::1111]", "2606:4700:::1111",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("pins the verified public DNS answer while preserving hostname TLS verification", async () => {
  const h = harness({ addresses: [publicV4, { address: "8.8.8.8", family: 4 }] });
  const result = await h.capture();
  assert.equal(result.success, true);
  assert.deepEqual(h.dnsCalls, [{ hostname: "listings.example.com", options: { all: true, verbatim: true } }]);
  assert.equal(h.requestCalls.length, 1);
  const { target, options, endCalls } = h.requestCalls[0];
  assert.equal(target.href, url);
  assert.equal(endCalls, 1);
  assert.equal(options.method, "GET");
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.servername, "listings.example.com");
  assert.equal(options.family, 4);
  assert.equal(options.maxHeaderSize, 16 * 1024);
  assert.equal(options.signal.aborted, false);
  assert.deepEqual(options.headers, {
    "User-Agent": "AutoFindexBot/0.1 (+https://autofind.tech)",
    Accept: "text/html",
    "Accept-Encoding": "identity",
  });
  assert.equal(Object.hasOwn(options, "auth"), false);
  assert.equal(target.username, "");
  assert.equal(target.password, "");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let lookupResult;
    options.lookup("listings.example.com", {}, (...args) => { lookupResult = args; });
    assert.deepEqual(lookupResult, [null, "1.1.1.1", 4]);
  }
  assert.equal(h.dnsCalls.length, 1, "the socket lookup must not perform another DNS query");
  let changedHost;
  options.lookup("other.example.com", {}, (...args) => { changedHost = args; });
  assert.equal(changedHost[0] instanceof Error, true);
  assert.deepEqual(changedHost.slice(1), ["", 0]);
});

test("pins public IPv6 without substituting an address for the certificate hostname", async () => {
  const h = harness({ addresses: [publicV6, publicV4] });
  assert.equal((await h.capture()).success, true);
  const { options } = h.requestCalls[0];
  assert.equal(options.family, 6);
  assert.equal(options.servername, "listings.example.com");
  assert.equal(options.rejectUnauthorized, true);
  let result;
  options.lookup("listings.example.com", {}, (...args) => { result = args; });
  assert.deepEqual(result, [null, publicV6.address, 6]);
});

test("refuses all DNS answers if even one answer is private or has the wrong family", async () => {
  for (const addresses of [
    [publicV4, { address: "127.0.0.1", family: 4 }],
    [{ address: "10.0.0.1", family: 4 }, publicV4],
    [publicV6, { address: "::1", family: 6 }],
    [publicV4, { address: "::ffff:169.254.169.254", family: 6 }],
    [{ address: "1.1.1.1", family: 6 }],
    [{ address: publicV6.address, family: 4 }],
    [{ address: "1.1.1.1", family: "4" }],
    [{ address: "not-an-address", family: 4 }],
  ]) {
    const h = harness({ addresses });
    assert.deepEqual(await h.capture(), terminal, JSON.stringify(addresses));
    assert.equal(h.requestCalls.length, 0);
  }
});

test("bounds DNS result counts and rejects non-array lookup results", async () => {
  for (const addresses of [[], Array.from({ length: 17 }, () => publicV4), publicV4, null]) {
    const h = harness({ addresses });
    assert.deepEqual(await h.capture(), terminal);
    assert.equal(h.requestCalls.length, 0);
  }
  const h = harness({ addresses: Array.from({ length: 16 }, () => publicV4) });
  assert.equal((await h.capture()).success, true);
});

test("rejects unsafe URLs before DNS, including credentials, private names and IP literals", async () => {
  // Construct unmistakably fictitious URL credentials to exercise rejection
  // without embedding a credential-shaped URL in the repository secret scan.
  const credentialUrl = new URL("https://listings.example.com/vehicle");
  credentialUrl.username = "fixture-user";
  credentialUrl.password = "fixture-password";
  for (const target of [
    "http://listings.example.com/vehicle", "ftp://listings.example.com/vehicle",
    credentialUrl.href, "https://user@listings.example.com/vehicle",
    "https://localhost/vehicle", "https://dealer.local/vehicle", "https://dealer.internal/vehicle",
    "https://dealer.home/vehicle", "https://dealer.lan/vehicle", "https://dealer/vehicle",
    "https://127.0.0.1/vehicle", "https://2130706433/vehicle", "https://[::1]/vehicle",
    "https://8.8.8.8/vehicle", "https://listings.example.com:8443/vehicle",
    "https://listings.example.com./vehicle", "https://listings.example.com/vehicle#fragment",
    "https://listings.example.com/a b", "https://listings.example.com/\nvehicle",
    `https://listings.example.com/${"x".repeat(2048)}`, "not a URL", "", null,
  ]) {
    const h = harness();
    assert.deepEqual(await h.capture({ url: target }), terminal, String(target));
    assert.equal(h.dnsCalls.length, 0);
    assert.equal(h.requestCalls.length, 0);
  }
});

test("rejects missing, non-integer and excessive body limits before DNS", async () => {
  for (const maxBytes of [undefined, null, 0, -1, 1.5, "1024", Number.NaN, Number.POSITIVE_INFINITY, 524289]) {
    const h = harness();
    assert.deepEqual(await h.capture({ maxBytes }), terminal);
    assert.equal(h.dnsCalls.length, 0);
    assert.equal(h.requestCalls.length, 0);
  }
});

test("recognizes only bounded delta-seconds Retry-After values", () => {
  for (const [value, milliseconds] of [["0", 0], ["1", 1000], ["001", 1000], ["120", 120000], ["300", 300000]]) {
    assert.equal(retryAfter(value), milliseconds);
  }
  for (const value of [undefined, null, ["120"], 120, "", " 120", "120 ", "+1", "-1", "1.5", "1e2", "301", "999", "1000", "0001", "Wed, 21 Oct 2015 07:28:00 GMT"]) {
    assert.equal(retryAfter(value), undefined, String(value));
  }
});

test("returns rate limiting without consuming a body or following a Location", async () => {
  const h = harness({ incoming: response({ status: 429, headers: { "retry-after": "120", location: "https://other.example.com/" } }) });
  assert.deepEqual(await h.capture(), { success: false, kind: "rate_limited", retryAfterMs: 120000 });
  assert.equal(h.incoming.destroyed, true);
  assert.equal(h.requestCalls.length, 1);
  assert.equal(h.dnsCalls.length, 1);
  assert.deepEqual(policy(429, { "retry-after": "301" }), { success: false, kind: "rate_limited" });
  assert.deepEqual(policy(429, { "retry-after": ["120", "180"] }), { success: false, kind: "rate_limited" });
  assert.deepEqual(policy(429, { "retry-after": "0" }), { success: false, kind: "rate_limited", retryAfterMs: 0 });
});

test("never follows any redirect, including redirects to loopback or another origin", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of ["https://127.0.0.1/private", "https://other.example.com/vehicle", "/another-vehicle"]) {
      const h = harness({ incoming: response({ status, headers: { location } }) });
      assert.deepEqual(await h.capture(), terminal);
      assert.equal(h.incoming.destroyed, true);
      assert.equal(h.requestCalls.length, 1);
      assert.equal(h.dnsCalls.length, 1);
    }
  }
});

test("classifies server failures as transient and other non-success statuses as terminal", () => {
  for (const status of [500, 502, 503, 504, 599]) assert.deepEqual(policy(status), transient);
  for (const status of [100, 101, 201, 204, 206, 300, 304, 400, 401, 403, 404, 410, 451]) {
    assert.deepEqual(policy(status), terminal, String(status));
  }
});

test("refuses invalid statuses instead of coercing them into retryable responses", () => {
  for (const status of [undefined, null, -1, 0, 99, 600, 200.5, 500.5, Number.NaN, Number.POSITIVE_INFINITY, "200", "503", true]) {
    assert.deepEqual(policy(status), terminal, String(status));
  }
});

test("accepts only the bounded HTML encoding profile", () => {
  for (const type of ["text/html", "text/html; charset=utf-8", "text/html; charset=us-ascii", 'text/html; charset="UTF-8"', 'TEXT/HTML ; CHARSET = "us-ascii" ']) {
    assert.equal(policy(200, { "content-type": type }), null, type);
    assert.equal(policy(200, { "content-type": type, "content-encoding": "identity", "content-length": "1024" }), null, type);
  }
});

test("refuses absent, ambiguous, non-HTML and unsupported charset declarations", () => {
  for (const type of [
    undefined, ["text/html"], "application/json", "application/xhtml+xml", "text/plain", "text/html, text/plain",
    "text/html; charset=iso-8859-1", "text/html; charset=utf-16", "text/html; charset=windows-1252",
    "text/html; charset=utf-8; charset=us-ascii", "text/html; boundary=anything",
    'text/html; charset="utf-8', 'text/html; charset=utf-8"', "text/html; charset='utf-8'",
  ]) {
    assert.deepEqual(policy(200, { "content-type": type }), terminal, String(type));
  }
});

test("refuses compression and malformed or excessive declared body lengths", () => {
  for (const encoding of ["gzip", "br", "deflate", "identity,gzip", ["identity"], ""]) {
    assert.deepEqual(policy(200, { "content-type": "text/html", "content-encoding": encoding }), terminal, String(encoding));
  }
  for (const length of ["1025", "999999999999999999999999", "-1", "+1", "1.5", " 10", "10 ", "1e2", "", ["10"], 10]) {
    assert.deepEqual(policy(200, { "content-type": "text/html", "content-length": length }), terminal, String(length));
  }
  assert.equal(policy(200, { "content-type": "text/html", "content-length": "0" }), null);
});

test("destroys rejected HTML responses before they enter the body pipeline", async () => {
  for (const headers of [
    { "content-type": "text/html; charset=iso-8859-1" },
    { "content-type": "text/html", "content-encoding": "gzip" },
    { "content-type": "text/html", "content-length": "1025" },
  ]) {
    const h = harness({ incoming: response({ headers }) });
    assert.deepEqual(await h.capture(), terminal);
    assert.equal(h.incoming.destroyed, true);
    assert.equal(h.incoming.readableDidRead, false);
  }
});

test("returns the exact received bytes with a normalized successful content type", async () => {
  const chunks = [Buffer.from("<html>"), Buffer.from("véhicule"), Buffer.from("</html>")];
  const h = harness({ incoming: response({ chunks }) });
  assert.deepEqual(await h.capture(), {
    success: true, body: new Uint8Array(Buffer.concat(chunks)), status: 200, contentType: "text/html",
  });
});

test("accepts a complete stream exactly at the byte limit", async () => {
  const chunks = [Buffer.from("abcd"), Buffer.from("efgh")];
  const h = harness({ incoming: response({ chunks }) });
  const result = await h.capture({ maxBytes: 8 });
  assert.equal(result.success, true);
  assert.deepEqual(result.body, new Uint8Array(Buffer.from("abcdefgh")));
});

test("enforces the streamed byte cap even without a length or with an understated one", async () => {
  for (const headers of [{ "content-type": "text/html" }, { "content-type": "text/html", "content-length": "4" }]) {
    const h = harness({ incoming: response({ headers, chunks: [Buffer.from("abcd"), Buffer.from("efgh")] }) });
    assert.deepEqual(await h.capture({ maxBytes: 7 }), terminal);
    assert.equal(h.incoming.destroyed, true);
  }
  const h = harness({ incoming: response({ chunks: [Buffer.from("éé")] }) });
  assert.deepEqual(await h.capture({ maxBytes: 3 }), terminal, "the limit counts bytes, not Unicode characters");
});

test("never returns a successful partial body when the HTTP response is incomplete", async () => {
  const h = harness({ incoming: response({ complete: false }) });
  assert.deepEqual(await h.capture(), transient);
});

test("classifies DNS failures and request errors without exposing error details", async () => {
  const dns = harness({ resolver: async () => { throw new Error("private resolver diagnostics"); } });
  assert.deepEqual(await dns.capture(), transient);
  assert.equal(dns.requestCalls.length, 0);
  const request = harness({ serve: ({ request: outgoing }) => outgoing.emit("error", new Error("private TLS diagnostics")) });
  assert.deepEqual(await request.capture(), transient);
  assert.equal(request.requestCalls.length, 1);
});

test("classifies errored and aborted response bodies as transient", async () => {
  for (const event of ["error", "aborted"]) {
    const incoming = new Readable({ read() { return undefined; } });
    incoming.statusCode = 200;
    incoming.headers = { "content-type": "text/html" };
    incoming.complete = false;
    const h = harness({ incoming, serve: ({ respond }) => {
      respond(incoming);
      incoming.push(Buffer.from("partial"));
      if (event === "error") incoming.destroy(new Error("simulated response failure"));
      else { incoming.emit("aborted"); incoming.destroy(); }
    } });
    assert.deepEqual(await h.capture(), transient, event);
  }
});

test("does not start DNS or HTTPS when the caller already cancelled", async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  const h = harness();
  assert.deepEqual(await h.capture({ signal: controller.signal }), terminal);
  assert.equal(h.dnsCalls.length, 0);
  assert.equal(h.requestCalls.length, 0);
});

test("cancels during DNS and ignores an answer that arrives after cancellation", async () => {
  const controller = new globalThis.AbortController();
  const answer = deferred();
  const h = harness({ resolver: () => answer.promise });
  const pending = h.capture({ signal: controller.signal });
  assert.equal(h.dnsCalls.length, 1);
  controller.abort();
  assert.deepEqual(await pending, terminal);
  answer.resolve([publicV4]);
  await Promise.resolve();
  assert.equal(h.requestCalls.length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("propagates cancellation to a request waiting for headers", async () => {
  const controller = new globalThis.AbortController();
  const started = deferred();
  const h = harness({ serve: () => started.resolve() });
  const pending = h.capture({ signal: controller.signal });
  await started.promise;
  controller.abort();
  assert.deepEqual(await pending, terminal);
  assert.equal(h.requestCalls[0].options.signal.aborted, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("cancels during body streaming without returning a partial success", async () => {
  const controller = new globalThis.AbortController();
  const started = deferred();
  const incoming = new Readable({ read() { return undefined; } });
  incoming.statusCode = 200;
  incoming.headers = { "content-type": "text/html" };
  incoming.complete = false;
  const h = harness({ incoming, serve: ({ respond }) => {
    respond(incoming);
    incoming.push(Buffer.from("partial"));
    started.resolve();
  } });
  const pending = h.capture({ signal: controller.signal });
  await started.promise;
  controller.abort();
  assert.deepEqual(await pending, terminal);
  assert.equal(h.requestCalls[0].options.signal.aborted, true);
  incoming.destroy();
});

test("removes the caller abort listener after success and failure", async () => {
  for (const incoming of [response(), response({ status: 403 })]) {
    const controller = new globalThis.AbortController();
    const h = harness({ incoming });
    await h.capture({ signal: controller.signal });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    assert.equal(h.requestCalls[0].options.signal.aborted, false);
  }
});
