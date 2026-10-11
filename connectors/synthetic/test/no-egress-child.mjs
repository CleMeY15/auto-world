import { createSyntheticHarness } from "@auto-world/synthetic-connector/demo";

const harness = createSyntheticHarness();
const result = await harness.run("valid", { invocationKey: "no-egress" });
process.stdout.write(JSON.stringify({ status: result.status, networkAttempts: globalThis.__syntheticNetworkAttempts }));
