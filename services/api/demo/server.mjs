import "./guard.mjs";

import { createDemoApi } from "../dist/index.js";
import { createSyntheticDemoReadPort, createSyntheticDemoReadPortV2 } from "./createSyntheticDemoReadPort.mjs";

const port = 3210;
const readPort = await createSyntheticDemoReadPort();
const readPortV2 = await createSyntheticDemoReadPortV2();
const app = createDemoApi({ readPort, readPortV2, clock: () => new Date(), loopbackPolicy: { boundPort: port } });

await app.listen({ host: "127.0.0.1", port });
