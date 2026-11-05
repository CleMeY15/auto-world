import { createHash } from "node:crypto";

type SemanticValue = null | boolean | number | string | SemanticValue[] | { [key: string]: SemanticValue };

function canonical(value: unknown, seen: Set<object>, depth: number): SemanticValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || depth > 64 || seen.has(value)) throw new TypeError("invalid_semantic_command");
  if (value instanceof Uint8Array) throw new TypeError("bytes_require_explicit_framing");
  seen.add(value);
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length !== 0 || Object.keys(descriptors).length !== value.length + 1) {
      throw new TypeError("invalid_semantic_array");
    }
    const output = value.map((_, index) => {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid_semantic_array");
      return canonical(descriptor.value, seen, depth + 1);
    });
    seen.delete(value);
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("invalid_semantic_object");
  }
  const output: Record<string, SemanticValue> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
        key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new TypeError("invalid_semantic_object");
    }
    output[key] = canonical(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
  return output;
}

export function semanticCommand(input: object, omitBytes = false, rawBytes?: Uint8Array): { readonly text: string; readonly sha256: string } {
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const command: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors)) {
    if (key === "signal" || key === "leaseFence" || (omitBytes && key === "bytes")) continue;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("invalid_semantic_command");
    command[key] = descriptor.value;
  }
  const text = JSON.stringify(canonical(command, new Set(), 0));
  const hash = createHash("sha256").update("aw-semantic-v1\0").update(text);
  if (rawBytes !== undefined) {
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(rawBytes.byteLength));
    hash.update(Buffer.from([0])).update(length).update(rawBytes);
  }
  return { text, sha256: hash.digest("hex") };
}

export function referenceKey(prefix: string, kind: string, ...parts: readonly (string | number)[]): string {
  const frame = (part: string | number): Buffer => {
    const bytes = Buffer.from(String(part), "utf8");
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes, Buffer.from([0])]);
  };
  const bytes = Buffer.concat([Buffer.from("aw-connector-v1\0"), frame(kind), ...parts.map(frame)]);
  return prefix + createHash("sha256").update(bytes).digest("hex");
}

export function sameSemantic(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left, new Set(), 0)) === JSON.stringify(canonical(right, new Set(), 0));
}
