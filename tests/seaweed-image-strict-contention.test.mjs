import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers";

import { createStrictAttempt, runStrictContentionProbe, signedPutHeaders } from
  "../scripts/seaweed-image/strict-contention.mjs";

const RUN_ID = "35953768680";
const ACCESS_KEY = "AWACCESS";
const SECRET_KEY = "AWSECRET";
const NOW = new Date("2026-09-24T12:34:56.000Z");
const PAYLOAD_A = "auto-world-strict-contention-a";
const PAYLOAD_B = "auto-world-strict-contention-b";
const HASH_A = "c9e3808c5c2d1313e62be669740edb90c86e9ea169e1c30bda2af69bae8ed0bc";
const HASH_B = "ba45a5660b356e9b7feb790e5487a2e0e89fec311ae0d4bff4125abb30576cdc";

function fakeChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const stdin = new EventEmitter();
  const writes = [];
  let killed = false;
  stdin.write = (value) => { writes.push(String(value)); return true; };
  const child = new EventEmitter();
  Object.assign(child, { stdout, stderr, stdin });
  child.kill = () => {
    if (killed) return false;
    killed = true;
    setImmediate(() => child.emit("close", null, "SIGKILL"));
    return true;
  };
  return { child, writes, get killed() { return killed; } };
}

async function waitUntil(predicate, message = "condition was not reached") {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function emitResponse(fake, status, chunks = [undefined]) {
  const response = `HTTP/1.1 ${status} ${status === 100 ? "Continue" : status === 200 ? "OK" : "Precondition Failed"}\r\n`
    + `${status === 100 ? "" : "Content-Length: 0\r\n"}\r\n`;
  if (chunks[0] === undefined) {
    fake.child.stdout.emit("data", Buffer.from(response, "latin1"));
    return;
  }
  let offset = 0;
  for (const size of chunks) {
    fake.child.stdout.emit("data", Buffer.from(response.slice(offset, offset + size), "latin1"));
    offset += size;
  }
  if (offset < response.length) {
    fake.child.stdout.emit("data", Buffer.from(response.slice(offset), "latin1"));
  }
}

function dockerFixture({ absent = "404", readback = "SEAWEED_STRICT_READBACK_VERIFIED" } = {}) {
  const calls = [];
  const docker = async (args, options) => {
    calls.push(args);
    assert.equal(options.cwd, "strict-parent");
    assert.equal(options.env.DOCKER_CONFIG, "strict-docker-config");
    assert.equal(args[0], "container");
    assert.equal(args[1], "exec");
    const script = args.at(-1);
    if (script.includes("--output /dev/null")) {
      assert.match(script, new RegExp(`/aw-raw/strict-${RUN_ID}'$`, "u"));
      return { status: 0, stdout: `${absent}\n`, stderr: "" };
    }
    assert.match(script, /SEAWEED_STRICT_READBACK_VERIFIED/u);
    return { status: 0, stdout: `${readback}\n`, stderr: "" };
  };
  return { calls, docker };
}

function probeInput(overrides = {}) {
  return {
    name: `aw-seaweed-runtime-${RUN_ID}-attempt-1`,
    runId: RUN_ID,
    options: { cwd: "strict-parent", env: { DOCKER_CONFIG: "strict-docker-config" } },
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    ...overrides,
  };
}

function fakeAbortController() {
  const listeners = new Set();
  return {
    signal: {
      addEventListener(name, listener) { if (name === "abort") listeners.add(listener); },
      removeEventListener(name, listener) { if (name === "abort") listeners.delete(listener); },
    },
    abort() { for (const listener of [...listeners]) listener(); },
  };
}

test("signed PUT headers match a deterministic SigV4 vector and exact HTTP/1.1 structure", () => {
  const value = signedPutHeaders({ key: `strict-${RUN_ID}`, payload: PAYLOAD_A,
    accessKey: ACCESS_KEY, secretKey: SECRET_KEY, now: NOW });
  assert.equal(value,
    `PUT /aw-raw/strict-${RUN_ID} HTTP/1.1\r\n`
    + "Host: 127.0.0.1:8333\r\n"
    + "If-None-Match: *\r\n"
    + "Expect: 100-continue\r\n"
    + "Content-Length: 30\r\n"
    + `x-amz-content-sha256: ${HASH_A}\r\n`
    + "x-amz-date: 20260924T123456Z\r\n"
    + "Authorization: AWS4-HMAC-SHA256 Credential=AWACCESS/20260924/us-east-1/s3/aws4_request, "
    + "SignedHeaders=host;if-none-match;x-amz-content-sha256;x-amz-date, "
    + "Signature=8851ba23e571776a21a5288dd6ce3dd0095aa0acaae695c689095dd48d029019\r\n"
    + "Connection: close\r\n\r\n");
  assert.equal(value.includes(PAYLOAD_A), false);
});

test("strict attempt parses fragmented interim and final HTTP responses", async () => {
  const fake = fakeChild();
  const attempt = createStrictAttempt(fake.child);
  const interim = attempt.waitInterim();
  emitResponse(fake, 100, [1, 2, 7, 3]);
  assert.equal(await interim, true);
  const final = attempt.waitFinal();
  emitResponse(fake, 412, [4, 1, 9, 2, 5]);
  assert.equal(await final, 412);
  attempt.dispose();
});

test("strict attempt refuses a final response before the 100 barrier", async () => {
  const fake = fakeChild();
  const attempt = createStrictAttempt(fake.child);
  const interim = attempt.waitInterim();
  emitResponse(fake, 412);
  await assert.rejects(interim, { reason: "STRICT_BARRIER_MISSING" });
  attempt.dispose();
});

test("strict attempt refuses an HTTP/1.0 interim response", async () => {
  const fake = fakeChild();
  const attempt = createStrictAttempt(fake.child);
  const interim = attempt.waitInterim();
  fake.child.stdout.emit("data", Buffer.from("HTTP/1.0 100 Continue\r\n\r\n", "latin1"));
  await assert.rejects(interim, { reason: "STRICT_RESPONSE_INVALID" });
  attempt.dispose();
});

async function driveSuccessfulBarrier({ firstStatus, secondStatus, expectedWinner }) {
  const dockerValue = dockerFixture();
  const children = [];
  const open = () => {
    const fake = fakeChild();
    children.push(fake);
    return fake.child;
  };
  const pending = runStrictContentionProbe(
    { ...probeInput(), docker: dockerValue.docker }, { open, now: () => NOW });

  await waitUntil(() => children.length === 2 && children.every((child) => child.writes.length === 1),
    "both signed header blocks were not written");
  assert.ok(children[0].writes[0].startsWith(`PUT /aw-raw/strict-${RUN_ID} HTTP/1.1\r\n`));
  assert.ok(children[1].writes[0].startsWith(`PUT /aw-raw/strict-${RUN_ID} HTTP/1.1\r\n`));
  assert.ok(children[0].writes[0].includes("Expect: 100-continue\r\n"));
  assert.ok(children[1].writes[0].includes("Expect: 100-continue\r\n"));

  emitResponse(children[0], 100, [5, 3, 2]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(children.map((child) => child.writes.length), [1, 1],
    "a body was released before both 100 responses");

  emitResponse(children[1], 100, [2, 8, 1]);
  await waitUntil(() => children.every((child) => child.writes.length === 2),
    "bodies were not released after the double barrier");
  assert.equal(children[0].writes[1], PAYLOAD_A);
  assert.equal(children[1].writes[1], PAYLOAD_B);

  emitResponse(children[0], firstStatus, [3, 6, 1]);
  emitResponse(children[1], secondStatus, [7, 2, 4]);
  const result = await pending;
  assert.deepEqual(result, { winner: expectedWinner });
  const readback = dockerValue.calls.at(-1).at(-1);
  assert.ok(readback.includes(expectedWinner === "A" ? HASH_A : HASH_B));
  assert.equal(readback.includes(expectedWinner === "A" ? HASH_B : HASH_A), false);
  assert.equal(children.every((child) => child.killed), true);
}

test("double barrier releases no body early and binds a 200/412 winner A to readback", async () => {
  await driveSuccessfulBarrier({ firstStatus: 200, secondStatus: 412, expectedWinner: "A" });
});

test("winner identification follows the 200 socket when B wins", async () => {
  await driveSuccessfulBarrier({ firstStatus: 412, secondStatus: 200, expectedWinner: "B" });
});

test("final response after the first 100 but before the second 100 never releases bodies", async () => {
  const dockerValue = dockerFixture();
  const children = [];
  const pending = runStrictContentionProbe({ ...probeInput(), docker: dockerValue.docker }, {
    now: () => NOW,
    open() { const fake = fakeChild(); children.push(fake); return fake.child; },
  });
  await waitUntil(() => children.length === 2 && children.every((child) => child.writes.length === 1));
  emitResponse(children[0], 100);
  emitResponse(children[0], 200);
  emitResponse(children[1], 100);
  await assert.rejects(pending, { reason: "STRICT_EARLY_FINAL" });
  assert.deepEqual(children.map((child) => child.writes.length), [1, 1]);
});

for (const [firstStatus, secondStatus] of [[200, 200], [200, 409], [412, 412]]) {
  test(`unexpected contention outcome ${firstStatus}/${secondStatus} fails closed`, async () => {
    const dockerValue = dockerFixture();
    const children = [];
    const pending = runStrictContentionProbe({ ...probeInput(), docker: dockerValue.docker }, {
      now: () => NOW,
      open() { const fake = fakeChild(); children.push(fake); return fake.child; },
    });
    await waitUntil(() => children.length === 2 && children.every((child) => child.writes.length === 1));
    children.forEach((child) => emitResponse(child, 100));
    await waitUntil(() => children.every((child) => child.writes.length === 2));
    emitResponse(children[0], firstStatus);
    emitResponse(children[1], secondStatus);
    await assert.rejects(pending, { reason: "STRICT_RESULT_UNEXPECTED" });
    assert.equal(dockerValue.calls.length, 1, "readback must not run without an exact winner");
  });
}

test("abort while waiting for the second 100 fails closed", async () => {
  const dockerValue = dockerFixture();
  const controller = fakeAbortController();
  const children = [];
  const pending = runStrictContentionProbe({ ...probeInput({
    options: { cwd: "strict-parent", env: { DOCKER_CONFIG: "strict-docker-config" }, signal: controller.signal },
  }), docker: dockerValue.docker }, {
    now: () => NOW,
    open() { const fake = fakeChild(); children.push(fake); return fake.child; },
  });
  await waitUntil(() => children.length === 2 && children.every((child) => child.writes.length === 1));
  emitResponse(children[0], 100);
  controller.abort();
  await assert.rejects(pending, { reason: "STRICT_TRANSPORT_FAILURE" });
  assert.equal(children.every((child) => child.writes.length === 1), true,
    "abort must not release either request body");
  assert.equal(children.every((child) => child.killed), true);
});

test("abort during the initial signed GET cannot open sockets afterward", async () => {
  const controller = fakeAbortController();
  let opened = 0;
  const pending = runStrictContentionProbe({ ...probeInput({ options: {
    cwd: "strict-parent", env: { DOCKER_CONFIG: "strict-docker-config" }, signal: controller.signal,
  } }), docker: async () => { controller.abort(); return { status: 0, stdout: "404\n", stderr: "" }; } }, {
    now: () => NOW, open() { opened += 1; return fakeChild().child; },
  });
  await assert.rejects(pending, { reason: "STRICT_TRANSPORT_FAILURE" });
  assert.equal(opened, 0);
});

test("bounded deadline kills both waiting clients without releasing bodies", async () => {
  const dockerValue = dockerFixture();
  const children = [];
  const pending = runStrictContentionProbe({ ...probeInput(), docker: dockerValue.docker }, {
    now: () => NOW, deadlineMs: 10,
    open() { const fake = fakeChild(); children.push(fake); return fake.child; },
  });
  await waitUntil(() => children.length === 2 && children.every((child) => child.writes.length === 1));
  emitResponse(children[0], 100);
  await assert.rejects(pending, { reason: "STRICT_TIMEOUT" });
  assert.equal(children.every((child) => child.killed), true);
  assert.deepEqual(children.map((child) => child.writes.length), [1, 1]);
});

test("invalid shell-facing input is rejected before the precondition request", async () => {
  let calls = 0;
  await assert.rejects(runStrictContentionProbe({ ...probeInput({ secretKey: "unsafe'value" }),
    docker: async () => { calls += 1; return { status: 0, stdout: "404\n", stderr: "" }; } }),
  { reason: "STRICT_INPUT_INVALID" });
  assert.equal(calls, 0);
});

test("non-404 initial state blocks both sockets", async () => {
  const dockerValue = dockerFixture({ absent: "200" });
  let opened = 0;
  await assert.rejects(runStrictContentionProbe({ ...probeInput(), docker: dockerValue.docker }, {
    now: () => NOW, open() { opened += 1; return fakeChild().child; },
  }), { reason: "STRICT_PRECONDITION_UNEXPECTED" });
  assert.equal(opened, 0);
});

test("winner readback mismatch fails instead of reporting contention success", async () => {
  const dockerValue = dockerFixture({ readback: "UNVERIFIED" });
  const children = [];
  const pending = runStrictContentionProbe({ ...probeInput(), docker: dockerValue.docker }, {
    now: () => NOW,
    open() { const fake = fakeChild(); children.push(fake); return fake.child; },
  });
  await waitUntil(() => children.length === 2 && children.every((child) => child.writes.length === 1));
  children.forEach((child) => emitResponse(child, 100));
  await waitUntil(() => children.every((child) => child.writes.length === 2));
  emitResponse(children[0], 200);
  emitResponse(children[1], 412);
  await assert.rejects(pending, { reason: "STRICT_READBACK_MISMATCH" });
});
