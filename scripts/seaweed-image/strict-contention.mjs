import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";

const HOST = "127.0.0.1:8333";
const PAYLOADS = ["auto-world-strict-contention-a", "auto-world-strict-contention-b"];
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEADLINE_MS = 45_000;

function fail(reason) { return Object.assign(new Error("seaweed_strict_contention_failed"), { reason }); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function hmac(key, value) { return createHmac("sha256", key).update(value).digest(); }

export function signedPutHeaders({ key, payload, accessKey, secretKey, now }) {
  if (!/^strict-[1-9][0-9]{0,19}$/u.test(key) || !/^[\x20-\x7e]+$/u.test(payload)
    || !/^[A-Za-z0-9]+$/u.test(accessKey) || typeof secretKey !== "string"
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw fail("STRICT_INPUT_INVALID");
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const day = stamp.slice(0, 8);
  const digest = sha256(payload);
  const uri = `/aw-raw/${key}`;
  const signedHeaders = "host;if-none-match;x-amz-content-sha256;x-amz-date";
  const canonical = ["PUT", uri, "", `host:${HOST}\nif-none-match:*\nx-amz-content-sha256:${digest}\nx-amz-date:${stamp}\n`,
    signedHeaders, digest].join("\n");
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`;
  let signingKey = hmac(`AWS4${secretKey}`, day);
  for (const part of ["us-east-1", "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return `PUT ${uri} HTTP/1.1\r\nHost: ${HOST}\r\nIf-None-Match: *\r\nExpect: 100-continue\r\n`
    + `Content-Length: ${Buffer.byteLength(payload)}\r\nx-amz-content-sha256: ${digest}\r\n`
    + `x-amz-date: ${stamp}\r\nAuthorization: AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}\r\nConnection: close\r\n\r\n`;
}

function defaultOpen({ name, options }) {
  return spawn("docker", ["container", "exec", "-i", name, "nc", "-w", "30", "127.0.0.1", "8333"],
    { cwd: options.cwd, env: options.env, signal: options.signal, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"] });
}

export function createStrictAttempt(child) {
  let pending = ""; let bytes = 0; let interim = false; let final;
  let error; let closed = false; const waiters = [];
  function wake() {
    for (const waiter of waiters.splice(0)) waiter();
  }
  function reject(reason) { if (error === undefined) { error = fail(reason); wake(); } }
  child.stdout.on("data", (chunk) => {
    if (error !== undefined || final !== undefined) return;
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) { reject("STRICT_RESPONSE_INVALID"); return; }
    pending += chunk.toString("latin1");
    for (let end; (end = pending.indexOf("\r\n\r\n")) !== -1;) {
      const block = pending.slice(0, end);
      pending = pending.slice(end + 4);
      const match = /^HTTP\/1\.1 ([0-9]{3})[^\r\n]*\r\n/u.exec(block + "\r\n");
      if (!match) { reject("STRICT_RESPONSE_INVALID"); return; }
      const status = Number(match[1]);
      if (status === 100 && !interim) { interim = true; wake(); continue; }
      if (status === 100 || !interim) { reject("STRICT_BARRIER_MISSING"); return; }
      final = status; wake(); return;
    }
  });
  child.stderr.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) reject("STRICT_RESPONSE_INVALID");
  });
  child.once("error", () => reject("STRICT_TRANSPORT_FAILURE"));
  child.once("close", () => { closed = true; if (final === undefined) reject("STRICT_TRANSPORT_FAILURE"); });
  child.stdin.on("error", () => reject("STRICT_TRANSPORT_FAILURE"));
  function waitFor(field) {
    if (error !== undefined) return Promise.reject(error);
    if (field === "interim" && interim || field === "final" && final !== undefined) {
      return Promise.resolve(field === "interim" ? true : final);
    }
    return new Promise((resolve, rejectPromise) => {
      const check = () => {
        if (error !== undefined) rejectPromise(error);
        else if (field === "interim" && interim || field === "final" && final !== undefined) {
          resolve(field === "interim" ? true : final);
        } else waiters.push(check);
      };
      waiters.push(check);
    });
  }
  return {
    write(value) {
      if (error !== undefined) throw error;
      child.stdin.write(value);
    },
    waitInterim: () => waitFor("interim"), waitFinal: () => waitFor("final"),
    get hasFinal() { return final !== undefined; },
    dispose() { if (!closed) child.kill("SIGKILL"); },
  };
}

async function dockerStatus(docker, args, options, reason = "STRICT_SIGNED_PROBE_FAILURE") {
  const result = await docker(args, options);
  if (result?.status !== 0 || typeof result.stdout !== "string" || result.stderr !== ""
    || result.stdout.length > 256) throw fail(reason);
  return result.stdout.trim();
}

export async function runStrictContentionProbe({ name, runId, options, docker, accessKey, secretKey },
  injected = {}) {
  if (!/^[1-9][0-9]{0,19}$/u.test(runId)
    || name !== `aw-seaweed-runtime-${runId}-attempt-1`
    || !/^[A-Za-z0-9]{1,64}$/u.test(accessKey)
    || !/^[A-Za-z0-9-]{1,128}$/u.test(secretKey)
    || typeof docker !== "function") throw fail("STRICT_INPUT_INVALID");
  if (options.signal?.aborted) throw fail("STRICT_TRANSPORT_FAILURE");
  const key = `strict-${runId}`;
  const url = `http://${HOST}/aw-raw/${key}`;
  const curlAuth = `--aws-sigv4 'aws:amz:us-east-1:s3' --user '${accessKey}:${secretKey}'`;
  const open = injected.open ?? defaultOpen;
  const now = (injected.now ?? (() => new Date()))();
  const deadlineMs = injected.deadlineMs ?? DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > DEADLINE_MS) {
    throw fail("STRICT_INPUT_INVALID");
  }
  const attempts = [];
  const controller = new globalThis.AbortController();
  const probeOptions = { ...options, signal: controller.signal,
    timeoutMs: Math.min(options.timeoutMs ?? DEADLINE_MS, deadlineMs) };
  const abort = () => {
    controller.abort();
    for (const attempt of attempts) attempt.dispose();
  };
  let timedOut = false;
  const timer = globalThis.setTimeout(() => { timedOut = true; abort(); }, deadlineMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) throw fail("STRICT_TRANSPORT_FAILURE");
    const absent = await dockerStatus(docker, ["container", "exec", name, "/bin/sh", "-c",
      `curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 ${curlAuth} '${url}'`],
    probeOptions);
    if (controller.signal.aborted) throw fail("STRICT_TRANSPORT_FAILURE");
    if (absent !== "404") throw fail("STRICT_PRECONDITION_UNEXPECTED");
    for (let i = 0; i < PAYLOADS.length; i++) {
      attempts.push(createStrictAttempt(open({ name, options: probeOptions })));
    }
    for (let i = 0; i < attempts.length; i++) {
      attempts[i].write(signedPutHeaders({ key, payload: PAYLOADS[i], accessKey, secretKey, now }));
    }
    await Promise.all(attempts.map((attempt) => attempt.waitInterim()));
    if (attempts.some((attempt) => attempt.hasFinal)) throw fail("STRICT_EARLY_FINAL");
    for (let i = 0; i < attempts.length; i++) attempts[i].write(PAYLOADS[i]);
    const statuses = await Promise.all(attempts.map((attempt) => attempt.waitFinal()));
    const winner = statuses[0] === 200 && statuses[1] === 412 ? 0
      : statuses[1] === 200 && statuses[0] === 412 ? 1 : -1;
    if (winner < 0) throw fail("STRICT_RESULT_UNEXPECTED");
    const expectedHash = sha256(PAYLOADS[winner]);
    const readback = `set -eu\nwork=$(mktemp /tmp/aw-strict.XXXXXXXX)\n`
      + `trap 'rm -f "$work"' EXIT\nstatus=$(curl --silent --output "$work" `
      + `--write-out '%{http_code}' --max-time 10 ${curlAuth} '${url}') || exit 1\n`
      + `test "$status" = 200 || exit 1\ntest "$(sha256sum "$work" | cut -d ' ' -f 1)" = '${expectedHash}'`
      + ` || exit 1\nprintf '%s\\n' 'SEAWEED_STRICT_READBACK_VERIFIED'`;
    const result = await dockerStatus(docker, ["container", "exec", name, "/bin/sh", "-c", readback],
      probeOptions, "STRICT_READBACK_MISMATCH");
    if (result !== "SEAWEED_STRICT_READBACK_VERIFIED") throw fail("STRICT_READBACK_MISMATCH");
    return { winner: winner === 0 ? "A" : "B" };
  } catch (error) {
    if (timedOut) throw fail("STRICT_TIMEOUT");
    if (error?.reason && /^STRICT_[A-Z_]+$/u.test(error.reason)) throw error;
    throw fail("STRICT_TRANSPORT_FAILURE");
  } finally {
    globalThis.clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
    for (const attempt of attempts) attempt.dispose();
  }
}
