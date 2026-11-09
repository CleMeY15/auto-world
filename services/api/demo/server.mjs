import "./guard.mjs";

import { createDemoApi } from "../dist/index.js";
import { createSyntheticDemoReadPort, createSyntheticDemoReadPortsV2V3 } from "./createSyntheticDemoReadPort.mjs";

const port = 3210;
const readPort = await createSyntheticDemoReadPort();
const { readPortV2, keywordReadPort } = await createSyntheticDemoReadPortsV2V3();
const app = createDemoApi({ readPort, readPortV2, keywordReadPort, clock: () => new Date(), loopbackPolicy: { boundPort: port } });

await app.listen({ host: "127.0.0.1", port });
