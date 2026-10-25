import { createHash } from "node:crypto";

export const digestBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function rawKey(sourceId, runId, snapshotId) {
  for (const [value, prefix] of [[sourceId, "src_"], [runId, "run_"], [snapshotId, "raw_"]]) {
    if (typeof value !== "string" || !value.startsWith(prefix) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value.slice(prefix.length))) throw new Error("infra_invalid_raw_address");
  }
  return `v1/raw/${sourceId}/${runId}/${snapshotId}`;
}

// TASK-0005 probe protocol only. A successful result is not a distributed SDK receipt.
export async function conditionalRawWrite({ bytes, put, get, timeoutMs = 15000 }) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1048576 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new Error("infra_invalid_raw_write");
  const deadline = Date.now() + timeoutMs;
  const sha256 = digestBytes(bytes);
  let attempts = 0;
  try {
    while (attempts < 3 && Date.now() < deadline) {
      attempts += 1;
      const response = await put(Math.max(1, deadline - Date.now()));
      if (Date.now() >= deadline) return { status: "indeterminate" };
      if (response === "conflict409") continue;
      if (!["created", "precondition412"].includes(response)) return { status: "indeterminate" };
      const stored = await get(Math.max(1, deadline - Date.now()));
      if (Date.now() >= deadline || !Buffer.isBuffer(stored)) return { status: "indeterminate" };
      if (stored.length !== bytes.length || digestBytes(stored) !== sha256) return { status: response === "precondition412" ? "conflict" : "indeterminate" };
      return { status: response === "created" ? "created" : "replay", sha256, byteLength: bytes.length };
    }
  } catch {
    return { status: "indeterminate" };
  }
  return { status: "indeterminate" };
}
