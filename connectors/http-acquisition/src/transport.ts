import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { publicHttpsUrl, USER_AGENT } from "./manifest.js";
import type { CaptureResponse, CaptureTransport } from "./types.js";

const terminal: CaptureResponse = Object.freeze({ success: false, kind: "terminal" });
const transient: CaptureResponse = Object.freeze({ success: false, kind: "transient" });
const MAX_TIMEOUT_MS = 8_000;

// Conservative public-unicast allow policy. IPv4-mapped/transition IPv6 and
// special-use destinations cannot provide a route to a private service.
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes(".") || address.includes("%")) return false;
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 1 ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const first = Number.parseInt(parts[0] ?? "0", 16);
  const second = Number.parseInt(parts[1] ?? "0", 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}

export function retryAfter(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^\d{1,3}$/u.test(value)) return undefined;
  const seconds = Number(value);
  return seconds <= 300 ? seconds * 1000 : undefined;
}

export function responsePolicy(response: Pick<IncomingMessage, "statusCode" | "headers">, maxBytes: number): CaptureResponse | null {
  if (typeof response.statusCode !== "number" || !Number.isInteger(response.statusCode)) return terminal;
  if (response.statusCode === 429) {
    const delay = retryAfter(response.headers["retry-after"]);
    return { success: false, kind: "rate_limited", ...(delay === undefined ? {} : { retryAfterMs: delay }) };
  }
  if (response.statusCode !== undefined && response.statusCode >= 500 && response.statusCode <= 599) return transient;
  if (response.statusCode !== 200) return terminal;
  const type = response.headers["content-type"];
  const encoding = response.headers["content-encoding"];
  const length = response.headers["content-length"];
  if (typeof type !== "string" || !/^text\/html(?:\s*;\s*charset\s*=\s*(?:utf-8|us-ascii|"utf-8"|"us-ascii"))?\s*$/iu.test(type)
    || (encoding !== undefined && encoding !== "identity")
    || (length !== undefined && (typeof length !== "string" || !/^\d+$/u.test(length) || Number(length) > maxBytes))) return terminal;
  return null;
}

type TransportDependencies = { readonly resolve: typeof lookup; readonly request: typeof httpsRequest };

// Dependency injection is internal for network boundary tests. Ordinary package
// exports always construct this with Node's HTTPS/TLS and DNS implementations.
export function createHttpsTransport(dependencies: TransportDependencies = { resolve: lookup, request: httpsRequest }): CaptureTransport {
  return {
    async capture(input) {
      const url = publicHttpsUrl(input.url);
      if (!url || input.signal.aborted || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 524288) return terminal;
      const controller = new globalThis.AbortController();
      const cancel = () => controller.abort();
      input.signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(cancel, MAX_TIMEOUT_MS);
      try {
        const addresses = await new Promise<Awaited<ReturnType<typeof lookup>> | { address: string; family: number }[]>((resolve, reject) => {
          const stop = () => reject(new Error("transport_cancelled"));
          controller.signal.addEventListener("abort", stop, { once: true });
          dependencies.resolve(url.hostname, { all: true, verbatim: true }).then(resolve, reject)
            .finally(() => controller.signal.removeEventListener("abort", stop));
        });
        if (controller.signal.aborted || !Array.isArray(addresses) || addresses.length < 1 || addresses.length > 16
          || addresses.some((entry) => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) return terminal;
        const pinned = addresses[0]!;
        return await new Promise<CaptureResponse>((resolve) => {
          let settled = false;
          const settle = (value: CaptureResponse) => { if (!settled) { settled = true; resolve(value); } };
          const request = dependencies.request(url, {
            method: "GET", agent: false, rejectUnauthorized: true, servername: url.hostname,
            family: pinned.family, maxHeaderSize: 16 * 1024,
            signal: controller.signal,
            lookup: (hostname, _options, callback) => {
              if (hostname !== url.hostname) { callback(new Error("transport_host_changed"), "", 0); return; }
              callback(null, pinned.address, pinned.family);
            },
            headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Encoding": "identity" },
          }, (response) => {
            const rejected = responsePolicy(response, input.maxBytes);
            if (rejected) { settle(rejected); response.destroy(); return; }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              if (settled) return;
              size += chunk.byteLength;
              if (size > input.maxBytes) { settle(terminal); response.destroy(); return; }
              chunks.push(Buffer.from(chunk));
            });
            response.once("end", () => {
              if (!response.complete) { settle(transient); return; }
              settle({ success: true, body: new Uint8Array(Buffer.concat(chunks, size)), status: 200, contentType: "text/html" });
            });
            response.once("error", () => settle(transient));
            response.once("aborted", () => settle(transient));
          });
          request.once("error", () => settle(controller.signal.aborted ? terminal : transient));
          request.end();
        });
      } catch { return controller.signal.aborted ? terminal : transient; }
      finally { globalThis.clearTimeout(timer); input.signal.removeEventListener("abort", cancel); }
    },
  };
}
