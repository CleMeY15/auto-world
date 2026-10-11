import { performance } from "node:perf_hooks";
import { createDemoApi } from "../dist/index.js";
import { createSyntheticDemoReadPort } from "../demo/createSyntheticDemoReadPort.mjs";

const warmup = 25;
const samples = 200;
const thresholdMs = 500;
const readPort = await createSyntheticDemoReadPort();
const app = createDemoApi({ readPort, clock: () => new Date(), loopbackPolicy: { boundPort: 3210 } });
const request = Object.freeze({
  method: "POST",
  url: "/v1/demo/search",
  headers: Object.freeze({ host: "127.0.0.1:3210", "content-type": "application/json" }),
  payload: JSON.stringify({ schemaVersion: 1, sort: "listing_asc" }),
});

try {
  for (let index = 0; index < warmup; index += 1) {
    const response = await app.inject(request);
    if (response.statusCode !== 200) throw new Error("fixture_performance_warmup_failed");
  }

  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    const response = await app.inject(request);
    durations.push(performance.now() - started);
    if (response.statusCode !== 200) throw new Error("fixture_performance_sample_failed");
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(samples * 0.95) - 1];
  const report = Object.freeze({
    schemaVersion: 1,
    profile: "synthetic_fixture_fastify_inject_endpoint",
    transport: "fastify.inject_no_socket_or_network_latency",
    productionScaleClaim: false,
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    warmup,
    samples,
    thresholdMs,
    p95Ms: Number(p95.toFixed(3)),
    passed: p95 < thresholdMs,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await app.close();
}
