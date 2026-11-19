// Count a JSON document before stringifying it. Reports may reuse long target
// strings in thousands of projected rows. Keep temporary escaped strings small.
export function boundedJsonBytes(document, cap, reason) {
  let size = 1; // final newline
  function add(n) {
    size += n;
    if (size > cap) throw new Error(reason);
  }
  function string(text) {
    add(2);
    if (text.length > cap - size) throw new Error(reason);
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 4096, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      add(Buffer.byteLength(JSON.stringify(text.slice(start, end))) - 2);
      start = end;
    }
  }
  function count(value, depth) {
    if (depth > 128) throw new Error(reason);
    if (typeof value === "string") return string(value);
    if (value === null || typeof value !== "object") {
      return add(Buffer.byteLength(JSON.stringify(value ?? null)));
    }
    add(2);
    let first = true;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!first) add(1);
        first = false;
        count(item, depth + 1);
      }
    } else {
      for (const key of Object.keys(value)) {
        if (value[key] === undefined) continue;
        if (!first) add(1);
        first = false;
        string(key);
        add(1);
        count(value[key], depth + 1);
      }
    }
  }
  count(document, 0);
  const bytes = Buffer.from(JSON.stringify(document) + "\n");
  if (bytes.length !== size) throw new Error(reason);
  return bytes;
}
