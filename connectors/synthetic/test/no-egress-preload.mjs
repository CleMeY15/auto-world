import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const blocked = () => {
  globalThis.__syntheticNetworkAttempts += 1;
  const error = new Error("synthetic_external_egress_blocked");
  error.code = "synthetic_external_egress_blocked";
  throw error;
};

globalThis.__syntheticNetworkAttempts = 0;
globalThis.fetch = blocked;
http.request = blocked;
http.get = blocked;
https.request = blocked;
https.get = blocked;
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
dgram.createSocket = blocked;
dns.lookup = blocked;
dns.resolve = blocked;
syncBuiltinESMExports();
