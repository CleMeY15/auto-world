import "./guard.mjs";

import { createDemoApi } from "../dist/index.js";
import { createSyntheticDemoReadPort } from "./createSyntheticDemoReadPort.mjs";

const port = 3210;
const readPort = await createSyntheticDemoReadPort();
const app = createDemoApi({ readPort, clock: () => new Date(), loopbackPolicy: { boundPort: port } });

await app.listen({ host: "127.0.0.1", port });
