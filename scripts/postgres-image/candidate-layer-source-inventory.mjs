import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { validatePostgresCandidateArchiveLayerRanges } from "./candidate-proof.mjs";

const BLOCK = 512;
const PREFIX = "postgres_layer_source_inventory_";
const errors = new WeakSet();
const APK_PATH = "lib/apk/db/installed";
const LIMITS = Object.freeze({ membersPerLayer: 100_000, membersTotal: 250_000, pathBytes: 4096,
  pathComponents: 128, overlayWork: 16_000_000,
  extensionBytes: 64 * 1024, apkDatabaseBytes: 16 * 1024 ** 2, apkRecords: 10_000,
  apkLineBytes: 16 * 1024, noticeBytes: 4 * 1024 ** 2, inventoryBytes: 64 * 1024 ** 2 });
const TYPES = Object.freeze({ "0": "file", "1": "hardlink", "2": "symlink", "3": "character-device",
  "4": "block-device", "5": "directory", "6": "fifo" });
const NOTICE = /^(?:licen[cs]e|copying[23]?|notice|copyright|patents)(?:[._-].*)?$/iu;
const APK_FIELDS = new Set("PVTULADCSIpiomtc kFMRZrqasf".replaceAll(" ", ""));
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : v !== null && typeof v === "object"
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, value]) => [key, freeze(value)]))) : v;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function control(value, allowNewline = false) {
  for (const character of value) {
    const code = character.codePointAt(0); if (code === 127 || code < 32 && !(allowNewline && code === 10)) return true;
  }
  return false;
}
function fail(reason) { const error = new Error(PREFIX + reason); errors.add(error); throw error; }
function guarded(operation) {
  try { return operation(); } catch (error) { if (errors.has(error)) throw error; fail("input_invalid"); }
}
function data(value, depth = 0, budget = { left: 8_000_000 }) {
  if (--budget.left < 0 || depth > 32) fail("proof_invalid");
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) fail("proof_invalid"); return;
  }
  const array = Array.isArray(value);
  if (!array && (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    || array && Object.getPrototypeOf(value) !== Array.prototype) fail("proof_invalid");
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) fail("proof_invalid");
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
      || array && !/^(?:0|[1-9][0-9]*)$/u.test(key)) fail("proof_invalid");
    data(descriptor.value, depth + 1, budget);
  }
}
function utf8(bytes, reason) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { fail(reason); }
}
function text(block, start, length) {
  const bytes = block.subarray(start, start + length); const zero = bytes.indexOf(0);
  const value = zero < 0 ? bytes : bytes.subarray(0, zero);
  if (zero >= 0 && bytes.subarray(zero).some((byte) => byte !== 0)
    || value.some((byte) => byte < 32 || byte > 126)) fail("tar_header_invalid");
  return value.toString("ascii");
}
function octal(block, start, length, maximum = Number.MAX_SAFE_INTEGER, empty = false) {
  const bytes = block.subarray(start, start + length);
  if (bytes.some((byte) => byte > 127)) fail("tar_number_invalid");
  const value = bytes.toString("ascii").replace(/[\0 ]+$/u, "").trimStart();
  if (empty && value === "") return 0;
  if (!/^[0-7]+$/u.test(value)) fail("tar_number_invalid");
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number) || number > maximum) fail("tar_number_invalid");
  return number;
}
function pathValue(raw, directory = false) {
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > LIMITS.pathBytes
    || control(raw) || raw.includes("\\") || raw.startsWith("/") || raw.includes("//")) fail("tar_path_invalid");
  let value = raw.startsWith("./") ? raw.slice(2) : raw;
  if (directory && value.endsWith("/")) value = value.slice(0, -1);
  if (directory && (value === "" || value === ".")) return "";
  const parts = value.split("/");
  if (!value || parts.length > LIMITS.pathComponents || parts.some((part) => !part || part === "." || part === "..")) fail("tar_path_invalid");
  return value;
}
function linkTarget(member, raw, hardlink) {
  if (hardlink) return pathValue(raw);
  if (!raw || Buffer.byteLength(raw) > LIMITS.pathBytes || control(raw) || raw.includes("\\") || raw.includes("//")) fail("tar_link_invalid");
  const parts = raw.startsWith("/") ? [] : member.split("/").slice(0, -1);
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!parts.length) fail("tar_link_invalid"); parts.pop(); }
    else { if (part.startsWith(".wh.")) fail("tar_link_invalid"); parts.push(part); }
  }
  if (parts.length > LIMITS.pathComponents) fail("tar_link_invalid");
  return parts.join("/");
}
function paxRecords(bytes) {
  if (bytes.length === 0 || bytes.length > LIMITS.extensionBytes) fail("tar_extension_invalid");
  const result = Object.create(null); let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset); if (space < offset || space - offset > 8) fail("tar_extension_invalid");
    const digits = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(digits)) fail("tar_extension_invalid");
    const length = Number(digits); const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || end <= space + 2 || bytes[end - 1] !== 10) fail("tar_extension_invalid");
    const record = utf8(bytes.subarray(space + 1, end - 1), "tar_extension_invalid"); const equals = record.indexOf("=");
    const key = record.slice(0, equals); const value = record.slice(equals + 1);
    if (equals < 1 || key.length > 128 || Object.hasOwn(result, key) || control(value)
      || !["path", "linkpath", "size", "mtime", "atime", "ctime"].includes(key)
        && !/^SCHILY\.xattr\.[A-Za-z0-9._-]+$/u.test(key)) fail("tar_extension_invalid");
    if (["mtime", "atime", "ctime"].includes(key)
      && (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/u.test(value) || !Number.isFinite(Number(value))
        || Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER)) fail("tar_extension_invalid");
    if (key === "size" && (!/^(?:0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value)))) fail("tar_extension_invalid");
    result[key] = value; offset = end;
  }
  return Object.fromEntries(Object.entries(result));
}
function header(block, maximumBytes) {
  const checksum = octal(block, 148, 8, BLOCK * 256); const copy = Buffer.from(block); copy.fill(32, 148, 156);
  if (copy.reduce((sum, byte) => sum + byte, 0) !== checksum) fail("tar_checksum_invalid");
  if (!block.subarray(257, 263).equals(Buffer.from("ustar\0"))
    || !block.subarray(263, 265).equals(Buffer.from("00"))) fail("tar_format_unsupported");
  if (block.subarray(500).some((byte) => byte !== 0)) fail("tar_header_invalid");
  const prefix = text(block, 345, 155); const leaf = text(block, 0, 100);
  text(block, 265, 32); text(block, 297, 32);
  return { name: prefix ? `${prefix}/${leaf}` : leaf, flag: String.fromCharCode(block[156] || 48),
    size: octal(block, 124, 12, maximumBytes), mode: octal(block, 100, 8, 0o7777),
    uid: octal(block, 108, 8, 0x7fffffff), gid: octal(block, 116, 8, 0x7fffffff),
    mtime: String(octal(block, 136, 12)), linkname: text(block, 157, 100),
    deviceMajor: octal(block, 329, 8, 0x7fffffff, true), deviceMinor: octal(block, 337, 8, 0x7fffffff, true) };
}
function readLayer(buffer, total) {
  const members = []; const names = new Set(); let offset = 0; let zeros = 0; let pending = null; let headers = 0;
  while (offset < buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) { zeros += 1; offset += BLOCK; if (zeros === 2) break; continue; }
    if (zeros) fail("tar_end_invalid");
    if (++headers > LIMITS.membersPerLayer || ++total.headers > LIMITS.membersTotal) fail("member_limit");
    const item = header(block, buffer.length); const extension = item.flag === "x";
    if (extension && pending !== null) fail("tar_extension_invalid");
    if (!extension && !Object.hasOwn(TYPES, item.flag)) fail("tar_type_unsupported");
    const pax = extension ? {} : pending ?? {}; const size = extension ? item.size : Number(pax.size ?? item.size);
    const start = offset + BLOCK; const end = start + size; const next = start + Math.ceil(size / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(size) || size < 0 || end > buffer.length || next > buffer.length) fail("tar_truncated");
    if (buffer.subarray(end, next).some((byte) => byte !== 0)) fail("tar_padding_invalid");
    const bytes = buffer.subarray(start, end);
    if (extension) {
      pathValue(item.name); if (item.linkname || item.deviceMajor || item.deviceMinor) fail("tar_extension_invalid");
      pending = paxRecords(bytes); offset = next; continue;
    }
    pending = null;
    const type = TYPES[item.flag]; const path = pathValue(pax.path ?? item.name, type === "directory");
    if (names.has(path)) fail("tar_duplicate_path"); names.add(path);
    const linkname = pax.linkpath ?? item.linkname;
    if (type !== "file" && size !== 0 || !["hardlink", "symlink"].includes(type) && linkname
      || !["character-device", "block-device"].includes(type) && (item.deviceMajor || item.deviceMinor)) fail("tar_header_invalid");
    const target = ["hardlink", "symlink"].includes(type) ? linkTarget(path, linkname, type === "hardlink") : null;
    const parts = path.split("/"); const leaf = parts.at(-1); const parent = parts.slice(0, -1).join("/");
    if (parts.slice(0, -1).some((part) => part.startsWith(".wh."))) fail("whiteout_invalid");
    let operation = "ENTRY"; let whiteoutTarget = null;
    if (leaf.startsWith(".wh.")) {
      if (type !== "file" || size !== 0) fail("whiteout_invalid");
      operation = leaf === ".wh..wh..opq" ? "OPAQUE" : "WHITEOUT";
      const removed = leaf.slice(4);
      if (operation === "WHITEOUT" && (!removed || removed === "." || removed === ".." || removed.startsWith(".wh."))) fail("whiteout_invalid");
      whiteoutTarget = operation === "OPAQUE" ? parent : parent ? `${parent}/${removed}` : removed;
    }
    const entry = { path, type, size, sha256: type === "file" ? sha(bytes) : null, linkname: linkname || null,
      mode: item.mode, uid: item.uid, gid: item.gid, mtime: pax.mtime ?? item.mtime,
      deviceMajor: item.deviceMajor, deviceMinor: item.deviceMinor, pax };
    members.push({ entry, operation, target, whiteoutTarget, bytes }); offset = next;
  }
  if (zeros !== 2 || pending !== null || buffer.subarray(offset).some((byte) => byte !== 0)) fail("tar_end_invalid");
  return members;
}
function apkDatabase(bytes) {
  if (bytes.length > LIMITS.apkDatabaseBytes) fail("apk_database_limit");
  const value = utf8(bytes, "apk_database_invalid");
  if (control(value, true) || value && !value.endsWith("\n")) fail("apk_database_invalid");
  const packages = []; const names = new Set(); let start = 0;
  while (start < bytes.length) {
    const separator = bytes.indexOf(Buffer.from("\n\n"), start);
    const end = separator < 0 ? bytes.length : separator + 1; const raw = bytes.subarray(start, end);
    if (raw.length === 0 || raw.equals(Buffer.from("\n"))) fail("apk_database_invalid");
    const fields = new Map();
    for (const line of utf8(raw, "apk_database_invalid").slice(0, -1).split("\n")) {
      if (Buffer.byteLength(line) > LIMITS.apkLineBytes || !/^[A-Za-z]:/u.test(line) || !APK_FIELDS.has(line[0])) fail("apk_database_invalid");
      const key = line[0]; if ("PVoLD".includes(key) && fields.has(key)) fail("apk_database_invalid");
      if (!fields.has(key)) fields.set(key, line.slice(2));
    }
    const name = fields.get("P");
    if (typeof name !== "string" || !/^[A-Za-z0-9._+-]+$/u.test(name) || names.has(name)) fail("apk_database_invalid");
    names.add(name);
    packages.push({ name, versionPresent: fields.has("V"), version: fields.get("V") ?? null,
      originPresent: fields.has("o"), origin: fields.get("o") ?? null,
      licensePresent: fields.has("L"), license: fields.get("L") ?? null,
      dependenciesPresent: fields.has("D"), dependencies: fields.get("D")?.split(" ").filter(Boolean) ?? [],
      assessment: name === ".postgresql-rundeps" ? "SYNTHETIC_VIRTUAL_DEPENDENCIES_ONLY" : "DECLARED_APK_RECORD",
      recordBytes: raw.length, recordSha256: sha(raw), sourceBinding: "NOT_ESTABLISHED", noticeBinding: "NOT_ESTABLISHED" });
    if (packages.length > LIMITS.apkRecords) fail("apk_database_limit");
    start = separator < 0 ? bytes.length : separator + 2;
  }
  return { path: APK_PATH, size: bytes.length, sha256: sha(bytes), packages };
}
const sorted = (values) => [...values].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
function pathParents(path) {
  if (path === "") return [];
  const parts = path.split("/"); return ["", ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))];
}
function indexPath(prefixes, path, delta) {
  for (const parent of pathParents(path)) {
    const count = (prefixes.get(parent) ?? 0) + delta;
    if (count === 0) prefixes.delete(parent); else prefixes.set(parent, count);
  }
}
function remove(overlay, prefixes, work, target, childrenOnly = false) {
  if (!overlay.has(target) && !prefixes.has(target)) return;
  for (const name of overlay.keys()) {
    if (++work.steps > LIMITS.overlayWork) fail("overlay_limit");
    if ((!childrenOnly && name === target) || (target === "" ? name !== "" : name.startsWith(`${target}/`))) {
      overlay.delete(name); indexPath(prefixes, name, -1);
    }
  }
}
function ancestors(overlay, path, directoryReplacements = null) {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const name = parts.slice(0, index).join("/"); const parent = overlay.get(name);
    if (parent && parent.type !== "directory" && !directoryReplacements?.has(name)) fail("overlay_parent_invalid");
  }
}
function inspect(buffer, options) {
  data(options);
  const material = validatePostgresCandidateArchiveLayerRanges(buffer, options);
  const overlay = new Map(); const prefixes = new Map(); const work = { steps: 0 };
  const layers = []; const notices = []; const apkHistory = []; const total = { headers: 0 };
  for (const range of material.layers) {
    const bytes = buffer.subarray(range.offset, range.offset + range.size);
    const members = readLayer(bytes, total); const operations = []; let database = null;
    const directoryReplacements = new Set(members.filter((member) => member.operation === "ENTRY"
      && member.entry.type === "directory").map((member) => member.entry.path));
    for (const member of members) if (member.operation !== "ENTRY") ancestors(overlay, member.entry.path, directoryReplacements);
    for (const member of members) if (member.operation !== "ENTRY") {
      remove(overlay, prefixes, work, member.whiteoutTarget, member.operation === "OPAQUE");
      operations.push({ kind: member.operation, path: member.entry.path, target: member.whiteoutTarget });
    }
    for (const { entry, operation, target, bytes: content } of members) {
      if (operation !== "ENTRY") continue;
      ancestors(overlay, entry.path);
      const previous = overlay.get(entry.path);
      if (entry.type !== "directory" || previous && previous.type !== "directory") remove(overlay, prefixes, work, entry.path);
      if (entry.type === "hardlink" && (target === entry.path || overlay.get(target)?.type !== "file")) fail("tar_link_invalid");
      if (!overlay.has(entry.path)) indexPath(prefixes, entry.path, 1);
      overlay.set(entry.path, { ...entry, layerIndex: range.index, diffId: range.diffId });
      if (entry.path === APK_PATH) {
        if (entry.type !== "file") fail("apk_database_invalid");
        database = apkDatabase(content);
        apkHistory.push({ layerIndex: range.index, diffId: range.diffId, ...database });
      }
      if (NOTICE.test(entry.path.split("/").at(-1))) {
        if (entry.type === "file" && entry.size > LIMITS.noticeBytes) fail("notice_limit");
        notices.push({ layerIndex: range.index, diffId: range.diffId, path: entry.path, type: entry.type,
          size: entry.size, sha256: entry.sha256, linkname: entry.linkname,
          resolution: entry.type === "file" ? "REGULAR_FILE_BYTES_OBSERVED"
            : ["symlink", "hardlink"].includes(entry.type) ? "UNRESOLVED_NO_FOLLOW" : "NON_REGULAR_NO_CONTENT" });
      }
    }
    layers.push({ index: range.index, diffId: range.diffId, size: range.size, memberCount: members.length,
      entries: members.filter((member) => member.operation === "ENTRY").map(({ entry }) => entry), operations,
      apkDatabase: database === null ? null : { sha256: database.sha256, size: database.size, packageCount: database.packages.length } });
  }
  const finalDatabase = overlay.get(APK_PATH);
  const finalSnapshot = finalDatabase === undefined ? null : apkHistory.find((value) => value.layerIndex === finalDatabase.layerIndex);
  const finalEntries = sorted(overlay.values());
  const result = { kind: "POSTGRES_RETAINED_LAYER_SOURCE_INVENTORY_V1", state: "RETAINED_LAYER_INVENTORY_VERIFIED",
    scope: "TWELVE_AUTHENTICATED_UNCOMPRESSED_LAYER_CHANGESETS", authority: "LOCAL_DIAGNOSTIC",
    archiveProof: material.archiveProof, layers, finalEntries, apkHistory,
    finalApk: finalSnapshot === null ? { state: "ABSENT", layerIndex: null, sha256: null, packages: [] }
      : { state: "DECLARATIONS_OBSERVED", layerIndex: finalSnapshot.layerIndex, sha256: finalSnapshot.sha256, packages: finalSnapshot.packages },
    notices: notices.map((notice) => ({ ...notice, visibility: overlay.get(notice.path)?.layerIndex === notice.layerIndex ? "FINAL" : "REMOVED_OR_REPLACED" })),
    noticeDiscovery: "FILENAME_CANDIDATES_ONLY", linkHandling: "METADATA_ONLY_NO_FOLLOW",
    sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED", closure: "INCOMPLETE",
    currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.inventoryBytes) fail("inventory_limit");
  if (sha(buffer) !== material.archiveProof.archiveSha256) fail("archive_changed");
  return freeze(result);
}

export function inspectPostgresRetainedLayerSources(buffer, options) {
  return guarded(() => inspect(buffer, options));
}
// Authenticity is supplied by the independently expected archive options, never by receipt claims.
export function validatePostgresRetainedLayerSourceInventory(value, buffer, options) {
  return guarded(() => {
    data(value); const expected = inspect(buffer, options);
    if (!isDeepStrictEqual(value, expected)) fail("proof_invalid");
    return expected;
  });
}
export const postgresRetainedLayerSourceInventoryLimits = LIMITS;
