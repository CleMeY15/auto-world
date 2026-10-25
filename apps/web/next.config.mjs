import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: root,
  turbopack: { root },
  async headers() {
    return [{
      source: "/carte-grise",
      headers: [{ key: "X-DNS-Prefetch-Control", value: "off" }],
    }, {
      source: "/historique-vehicule",
      headers: [{ key: "X-DNS-Prefetch-Control", value: "off" }],
    }];
  },
};
