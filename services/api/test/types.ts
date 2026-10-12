import { createDemoApi, type DemoApiOptions, type DemoApiTelemetrySink } from "../src/index.js";
import type { DemoReadPort } from "@auto-world/demo-search-contract";

declare const readPort: DemoReadPort;
const telemetry: DemoApiTelemetrySink = { metric(event) { void event.name; } };
const options: DemoApiOptions = { readPort, telemetry, loopbackPolicy: { boundPort: 3210 } };
const app = createDemoApi(options);
void app;
