import { get as httpGet } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createSocket } from "node:dgram";
import { lookup, resolve } from "node:dns";

const attempts = [
  () => globalThis.fetch("http://127.0.0.1:9"),
  () => httpGet("http://127.0.0.1:9"),
  () => httpsRequest("https://127.0.0.1:9"),
  () => netConnect(9, "127.0.0.1"),
  () => tlsConnect(9, "127.0.0.1"),
  () => createSocket("udp4"),
  () => lookup("localhost", () => {}),
  () => resolve("localhost", () => {}),
];
const codes = [];
for (const attempt of attempts) {
  try {
    attempt();
    codes.push("unexpected");
  } catch (error) {
    codes.push(error.code ?? "unknown");
  }
}
process.stdout.write(JSON.stringify({ codes, networkAttempts: globalThis.__syntheticNetworkAttempts }));
if (codes.some((code) => code !== "synthetic_external_egress_blocked")) process.exitCode = 1;
