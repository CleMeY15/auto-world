import { createHash } from "node:crypto";
import { addAbortSignal, Readable, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { seaweedArchiveLimits } from "./archive.mjs";

const BLOCK_BYTES = 512;
const MAX_RAW_BYTES = seaweedArchiveLimits.rawBytes;
const MAX_MEMBERS = seaweedArchiveLimits.members;
const MAX_CONTENT_CHUNK_BYTES = seaweedArchiveLimits.inputChunkBytes;
const MAX_MODE = 0o7777;
const MAX_ID = 0o7777777;
const MAX_TAR_NUMBER = 0o77777777777;
const SHA256 = /^[0-9a-f]{64}$/u;

function writerError(code, cause) {
  return cause === undefined ? new Error(code) : new Error(code, { cause });
}

function isWriterError(error) {
  return error instanceof Error && error.message.startsWith("seaweed_ustar_");
}

function failed(error, generatedBytes) {
  const normalized = isWriterError(error)
    ? error
    : writerError(error?.name === "AbortError" ? "seaweed_ustar_aborted" : "seaweed_ustar_stream_invalid", error);
  Object.defineProperties(normalized, {
    state: { value: "INCOMPLETE", enumerable: true },
    generatedBytes: { value: generatedBytes, enumerable: true },
  });
  return normalized;
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function printableAscii(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function canonicalPath(value) {
  if (!printableAscii(value) || value.startsWith("/") || value.endsWith("/")
    || value.includes("\\") || value.includes("//")) return false;
  return !value.split("/").some((part) => part === "" || part === "." || part === ".."
    || part === ".wh..wh..opq" || part.startsWith(".wh."));
}

function validateLinkTarget(path, linkname) {
  if (typeof linkname !== "string" || linkname.length > 100 || !printableAscii(linkname) || linkname.includes("\\")
    || linkname.includes("//") || linkname.endsWith("/")) return false;
  const stack = linkname.startsWith("/") ? [] : path.split("/").slice(0, -1);
  for (const part of linkname.split("/")) {
    if (part === "" && linkname.startsWith("/")) continue;
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return false;
      stack.pop();
      continue;
    }
    if (part === "" || part === ".wh..wh..opq" || part.startsWith(".wh.")) return false;
    stack.push(part);
  }
  return stack.length > 0;
}

function splitPath(path) {
  if (path.length <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index >= 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (prefix.length <= 155 && name.length <= 100) return { name, prefix };
  }
  throw writerError("seaweed_ustar_path_unrepresentable");
}

function cloneAndValidateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_MEMBERS) {
    throw writerError("seaweed_ustar_entries_invalid");
  }
  const copies = [];
  const paths = new Map();
  let offset = 0;
  for (const candidate of entries) {
    const type = candidate?.type;
    const keys = ["path", "type", "mode", "uid", "gid", "mtime", "size"];
    if (type === "file") keys.push("sha256");
    else if (type === "symlink") keys.push("linkname");
    else if (type !== "directory") throw writerError("seaweed_ustar_entry_invalid");
    if (typeof candidate?.path === "string" && candidate.path.length > 256) {
      throw writerError("seaweed_ustar_path_unrepresentable");
    }
    if (!exactObject(candidate, keys) || !canonicalPath(candidate.path)
      || !requireInteger(candidate.mode, MAX_MODE) || !requireInteger(candidate.uid, MAX_ID)
      || !requireInteger(candidate.gid, MAX_ID) || !requireInteger(candidate.mtime, MAX_TAR_NUMBER)
      || !requireInteger(candidate.size, MAX_RAW_BYTES)
      || (type !== "file" && candidate.size !== 0)
      || (type === "file" && (typeof candidate.sha256 !== "string" || !SHA256.test(candidate.sha256)))
      || (type === "symlink" && !validateLinkTarget(candidate.path, candidate.linkname))) {
      throw writerError("seaweed_ustar_entry_invalid");
    }
    const tarPath = splitPath(candidate.path);
    if (paths.has(candidate.path)) throw writerError("seaweed_ustar_duplicate_path");
    paths.set(candidate.path, type);
    const padding = type === "file" ? (BLOCK_BYTES - candidate.size % BLOCK_BYTES) % BLOCK_BYTES : 0;
    const nextOffset = offset + BLOCK_BYTES + candidate.size + padding;
    if (!Number.isSafeInteger(nextOffset) || nextOffset + 2 * BLOCK_BYTES > MAX_RAW_BYTES) {
      throw writerError("seaweed_ustar_raw_limit");
    }
    const entry = Object.freeze({ ...candidate });
    copies.push(Object.freeze({
      memberOrdinal: copies.length,
      uncompressedHeaderOffset: offset,
      uncompressedDataOffset: offset + BLOCK_BYTES,
      entry,
      tarPath: Object.freeze(tarPath),
      padding,
    }));
    offset = nextOffset;
  }
  for (const { entry } of copies) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parentType = paths.get(parts.slice(0, index).join("/"));
      if (parentType !== undefined && parentType !== "directory") {
        throw writerError("seaweed_ustar_ancestor_invalid");
      }
    }
  }
  return Object.freeze({ members: Object.freeze(copies), expectedRawSize: offset + 2 * BLOCK_BYTES });
}

function writeString(buffer, offset, length, value) {
  Buffer.from(value, "ascii").copy(buffer, offset, 0, length);
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function createHeader(member) {
  const { entry, tarPath } = member;
  const header = Buffer.alloc(BLOCK_BYTES);
  writeString(header, 0, 100, tarPath.name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, entry.uid);
  writeOctal(header, 116, 8, entry.gid);
  writeOctal(header, 124, 12, entry.type === "file" ? entry.size : 0);
  writeOctal(header, 136, 12, entry.mtime);
  header[156] = entry.type === "file" ? 0x30 : entry.type === "directory" ? 0x35 : 0x32;
  if (entry.type === "symlink") writeString(header, 157, 100, entry.linkname);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, tarPath.prefix);
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function requireSink(sink) {
  if (!(sink instanceof Writable) || sink.writableObjectMode) throw writerError("seaweed_ustar_sink_invalid");
}

function requireSignal(signal) {
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) {
    throw writerError("seaweed_ustar_signal_invalid");
  }
}

async function openFileContent(member, openContent, signal) {
  signal.throwIfAborted();
  const context = Object.freeze({ signal });
  const content = openContent(member.entry, context);
  if (content !== null && (typeof content === "object" || typeof content === "function")
    && typeof content.then === "function") {
    Promise.resolve(content).catch(() => undefined);
    throw writerError("seaweed_ustar_content_opener_async");
  }
  if (!(content instanceof Readable) || content.readableObjectMode) {
    if (content instanceof Readable) {
      content.destroy();
      await finished(content, { cleanup: true }).catch(() => undefined);
    }
    throw writerError("seaweed_ustar_content_invalid");
  }
  addAbortSignal(signal, content);
  return content;
}

async function* streamFile(member, content) {
  try {
    let size = 0;
    const hash = createHash("sha256");
    for await (const chunk of content) {
      if (!Buffer.isBuffer(chunk) || chunk.length > MAX_CONTENT_CHUNK_BYTES) {
        throw writerError("seaweed_ustar_content_chunk_invalid");
      }
      size += chunk.length;
      if (size > member.entry.size) throw writerError("seaweed_ustar_content_size_mismatch");
      hash.update(chunk);
      yield chunk;
    }
    if (size !== member.entry.size) throw writerError("seaweed_ustar_content_size_mismatch");
    if (hash.digest("hex") !== member.entry.sha256) throw writerError("seaweed_ustar_content_hash_mismatch");
  } catch (error) {
    if (isWriterError(error) || error?.name === "AbortError") throw error;
    throw writerError("seaweed_ustar_content_stream_invalid", error);
  }
}

async function closeContent(content, primaryError) {
  content.destroy();
  try {
    await finished(content, { cleanup: true });
  } catch (error) {
    if (primaryError === undefined) throw writerError("seaweed_ustar_content_stream_invalid", error);
  }
}

export async function writeUstarArchive({ entries, sink, openContent, signal } = {}) {
  let generatedBytes = 0;
  try {
    requireSink(sink);
    requireSignal(signal);
    if (typeof openContent !== "function") throw writerError("seaweed_ustar_content_opener_invalid");
    const plan = cloneAndValidateEntries(entries);
    signal?.throwIfAborted();
    const hash = createHash("sha256");
    const source = async function* ({ signal: pipelineSignal }) {
      for (const member of plan.members) {
        pipelineSignal.throwIfAborted();
        const header = createHeader(member);
        if (member.entry.type === "file") {
          const content = await openFileContent(member, openContent, pipelineSignal);
          let primaryError;
          try {
            generatedBytes += header.length;
            hash.update(header);
            yield header;
            for await (const chunk of streamFile(member, content)) {
              generatedBytes += chunk.length;
              hash.update(chunk);
              yield chunk;
            }
            if (member.padding > 0) {
              const padding = Buffer.alloc(member.padding);
              generatedBytes += padding.length;
              hash.update(padding);
              yield padding;
            }
          } catch (error) {
            primaryError = error;
            throw error;
          } finally {
            await closeContent(content, primaryError);
          }
        } else {
          generatedBytes += header.length;
          hash.update(header);
          yield header;
        }
      }
      const end = Buffer.alloc(2 * BLOCK_BYTES);
      generatedBytes += end.length;
      hash.update(end);
      yield end;
    };
    const options = signal === undefined ? {} : { signal };
    await pipeline(source, sink, options);
    if (generatedBytes !== plan.expectedRawSize) throw writerError("seaweed_ustar_generated_size_invalid");
    return {
      kind: "SEAWEED_USTAR_WRITE_RECEIPT_V1",
      authority: "PREPARATION_ONLY",
      state: "COMPLETE",
      rawSize: generatedBytes,
      expectedRawSize: plan.expectedRawSize,
      diffId: `sha256:${hash.digest("hex")}`,
      memberCount: plan.members.length,
      members: plan.members.map(({ memberOrdinal, uncompressedHeaderOffset, uncompressedDataOffset, entry }) => ({
        memberOrdinal, uncompressedHeaderOffset, uncompressedDataOffset, entry: { ...entry },
      })),
    };
  } catch (error) {
    throw failed(error, generatedBytes);
  }
}
