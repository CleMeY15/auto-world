import { createConnection } from "node:net";
import { InfraError } from "./runtime.mjs";
import { operationSignal } from "./cancellation.mjs";

async function exchange(port, request, complete) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InfraError("infra_loopback_port_invalid");
  const signal = operationSignal();
  if (signal?.aborted) throw new InfraError("process_cancelled");
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let received = Buffer.alloc(0);
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new InfraError("process_cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(5000, () => finish(new InfraError("infra_loopback_probe_timeout")));
    socket.once("connect", () => socket.write(request));
    socket.on("error", () => finish(new InfraError("infra_loopback_probe_failed")));
    socket.on("end", () => finish(new InfraError("infra_loopback_probe_incomplete")));
    socket.on("data", (chunk) => {
      if (received.length + chunk.length > 4096) { finish(new InfraError("infra_loopback_response_oversized")); return; }
      received = Buffer.concat([received, chunk]);
      try { if (complete(received)) finish(); }
      catch { finish(new InfraError("infra_loopback_protocol_invalid")); }
    });
  });
}

// Reachability plus mandatory host SCRAM, not a claim of completed host authentication.
export function postgresHostChallenge(port) {
  const fields = Buffer.from("user\0aw_reader\0database\0autoworld\0\0");
  const request = Buffer.alloc(8 + fields.length);
  request.writeUInt32BE(request.length, 0);
  request.writeUInt32BE(196608, 4);
  fields.copy(request, 8);
  return exchange(port, request, (reply) => {
    if (reply.length < 5) return false;
    const length = reply.readUInt32BE(1);
    if (reply[0] !== 82 || length < 9 || length > 256) throw new Error("invalid_authentication_frame");
    if (reply.length < length + 1) return false;
    if (reply.readUInt32BE(5) !== 10 || !reply.subarray(9, length + 1).toString("ascii").split("\0").includes("SCRAM-SHA-256")) throw new Error("scram_required");
    return true;
  });
}

export function redisHostPing(port, password) {
  if (!/^[a-f0-9]{64}$/u.test(password)) throw new InfraError("infra_redis_probe_credential_invalid");
  const request = Buffer.from(`*2\r\n$4\r\nAUTH\r\n$64\r\n${password}\r\n*1\r\n$4\r\nPING\r\n`);
  return exchange(port, request, (reply) => {
    const text = reply.toString("ascii");
    if (text.split("\r\n").length < 3) return false;
    if (text !== "+OK\r\n+PONG\r\n") throw new Error("authenticated_ping_required");
    return true;
  });
}
