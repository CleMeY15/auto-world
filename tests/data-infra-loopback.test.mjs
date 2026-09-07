import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { postgresHostChallenge, redisHostPing } from "../scripts/data-infra/loopback-probes.mjs";

async function serverReply(reply, action) {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", () => socket.end(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await action(server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("host PostgreSQL probe requires a framed SCRAM challenge, not a mere connection", async () => {
  const mechanism = Buffer.from("SCRAM-SHA-256\0\0");
  const reply = Buffer.alloc(9 + mechanism.length);
  reply[0] = 82;
  reply.writeUInt32BE(reply.length - 1, 1);
  reply.writeUInt32BE(10, 5);
  mechanism.copy(reply, 9);
  await serverReply(reply, postgresHostChallenge);
  reply.writeUInt32BE(0, 5);
  await serverReply(reply, (port) => assert.rejects(postgresHostChallenge(port), /protocol_invalid/u));
  await serverReply(Buffer.alloc(0), (port) => assert.rejects(postgresHostChallenge(port), /incomplete/u));
});

test("host Redis probe requires both authentication and PING responses", async () => {
  await serverReply("+OK\r\n+PONG\r\n", (port) => redisHostPing(port, "a".repeat(64)));
  await serverReply("-WRONGPASS\r\n-NOAUTH\r\n", (port) => assert.rejects(redisHostPing(port, "a".repeat(64)), /protocol_invalid/u));
  assert.throws(() => redisHostPing(1234, "not a credential"), /credential_invalid/u);
});
