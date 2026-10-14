import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";

const blocked = () => { throw new Error("network_primitive_blocked"); };
for (const [target, names] of [
  [net, ["connect", "createConnection"]],
  [tls, ["connect"]],
  [http, ["request", "get"]],
  [https, ["request", "get"]],
]) {
  for (const name of names) target[name] = blocked;
}
globalThis.fetch = blocked;

const { createSyntheticDemoReadPort, createSyntheticDemoReadPortV2 } = await import("../demo/createSyntheticDemoReadPort.mjs");
const port = await createSyntheticDemoReadPort();
const result = await port.search({ schemaVersion: 1, sort: "listing_asc" }, {
  requestId: "req_0123456789abcdef0123456789abcdef",
  signal: new globalThis.AbortController().signal,
});
if (!result.success || result.data.results.length !== 1) throw new Error("demo_read_failed");
const portV2 = await createSyntheticDemoReadPortV2();
const contextV2 = { requestId: "req_0123456789abcdef0123456789abcdef", signal: new globalThis.AbortController().signal };
const catalog = await portV2.catalog(contextV2);
const resultV2 = await portV2.search({ schemaVersion: 2, sort: "listing_asc" }, contextV2);
if (!catalog.success || !resultV2.success || !resultV2.data.results.some((item) => item.description.status === "authored_synthetic")) throw new Error("demo_read_v2_failed");
process.stdout.write("NO_EGRESS_OK\n");
