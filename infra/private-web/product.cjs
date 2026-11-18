// Launch only the built Next distribution, on the service-owned Unix socket.
const http = require("node:http");
const { createRequire } = require("node:module");
const path = require("node:path");
const appRequire = createRequire(path.resolve("package.json"));
const app = appRequire("next")({ dev: false, dir: process.cwd(), hostname: "127.0.0.1" });
app.prepare().then(() => {
  http.createServer(app.getRequestHandler()).listen(process.env.PRIVATE_WEB_SOCKET || "/run/aw-private-product/web.sock");
});
