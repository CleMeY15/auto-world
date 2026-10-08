import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { styles } from "../dist/styles.js";

const output = fileURLToPath(new URL("../dist/styles.css", import.meta.url));
await mkdir(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true });
await writeFile(output, `${styles.trim()}\n`, "utf8");
