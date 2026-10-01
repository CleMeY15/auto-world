import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fsyncSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, readSync, realpathSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { loadPostgresSourceClosureManifest, validatePostgresSourceClosureManifest,
  allowedSourceHosts } from "./source-closure-manifest.mjs";

const PREFIX = "postgres_source_closure_";
export const postgresSourceClosureLimits = Object.freeze({ objectBytes: 1024 ** 3, totalBytes: 4 * 1024 ** 3,
  reservedDiskBytes: 1024 ** 3, objectMs: 10 * 60 * 1000, operationMs: 60 * 60 * 1000, redirects: 4,
  recordBytes: 1024 ** 2, directoryEntries: 20000 });
const fail = (reason) => { throw new Error(PREFIX + reason); };
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const identity = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid),
  mode: Number(s.mode & 0o7777n), nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const directoryIdentity = (s) => { const { dev, ino, uid, gid, mode } = identity(s); return { dev, ino, uid, gid, mode }; };
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const redirectHosts = Object.freeze(["codeload.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
// abuild's DISTFILES_MIRROR convention preserves the APKBUILD checksum. These
// seven endpoints are recovery routes, never additional caller URL authority.
const MIRROR_ELIGIBILITY = Symbol("closed mirror eligibility");
const alpineMirrors = Object.freeze({
  "material-apk-tools-apk-tools-v3.0.8.tar.gz": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/edge/apk-tools-v3.0.8.tar.gz", trigger: "HTTP_406", reason: PREFIX + "response_406_invalid" }),
  "material-ca-certificates-ca-certificates-20260909.tar.bz2": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/edge/ca-certificates-20260909.tar.bz2", trigger: "HTTP_406", reason: PREFIX + "response_406_invalid" }),
  "material-krb5-krb5-1.22.2.tar.gz": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/edge/krb5-1.22.2.tar.gz", trigger: "CONTENT_ENCODING", reason: PREFIX + "response_200_invalid" }),
  "material-ncurses-ncurses-6.6-20260516.tgz": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/edge/ncurses-6.6-20260516.tgz", trigger: "HTTP_404", reason: PREFIX + "response_404_invalid" }),
  "material-readline-readline-8.3.tar.gz": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/v3.24/readline-8.3.tar.gz", trigger: "TRANSPORT", reason: PREFIX + "download_failed" }),
  "material-tzdata-tzcode2026d.tar.gz": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/edge/tzcode2026d.tar.gz", trigger: "IANA_REDIRECT", reason: PREFIX + "url_invalid",
    redirectUrl: "https://data.iana.org/time-zones/releases/tzcode2026d.tar.gz" }),
  "material-tzdata-tzdata2026d.tar.gz": Object.freeze({
    url: "https://distfiles.alpinelinux.org/distfiles/edge/tzdata2026d.tar.gz", trigger: "IANA_REDIRECT", reason: PREFIX + "url_invalid",
    redirectUrl: "https://data.iana.org/time-zones/releases/tzdata2026d.tar.gz" }),
});
function mirrorFor(material) {
  const mirror = alpineMirrors[material.id];
  if (!mirror || !isDeepStrictEqual(material, loadPostgresSourceClosureManifest().materials.find(v => v.id === material.id))) return null;
  return mirror;
}
function responseFailure(reason, eligibility) {
  const error = new Error(PREFIX + reason);
  Object.defineProperty(error, MIRROR_ELIGIBILITY, { value: eligibility });
  return error;
}
function snapshotRecord(value, keys, reason) {
  if (!plain(value)) fail(reason);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) fail(reason);
  const result = {};
  for (const key of keys) {
    const d = descriptors[key]; if (!d?.enumerable || !Object.hasOwn(d, "value")) fail(reason);
    result[key] = d.value;
  }
  return result;
}
const CLAIMS = Object.freeze({ sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED",
  layerCoverage: "NOT_ESTABLISHED", admission: "NOT_AUTHORIZED", runtimePermission: "NOT_GRANTED",
  supportStartedAt: null, supportEndsAt: null, archiveUntil: null, authority: "NONE" });
const ENV = Object.freeze({ PATH: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin:/usr/sbin:/usr/bin:/bin",
  HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
const FAILURE_CODES = new Set(["material_invalid", "url_invalid", "storage_invalid", "storage_changed", "size_invalid",
  "digest_invalid", "capacity_invalid", "write_failed", "redirect_invalid", "download_failed", "collection_locked",
  "record_invalid", "context_invalid", "proof_invalid", "cleanup_uncertain"].map(value => PREFIX + value));
function failureReason(error) {
  try {
    const message = Object.getOwnPropertyDescriptor(error, "message")?.value;
    return typeof message === "string" && (FAILURE_CODES.has(message) || /^postgres_source_closure_response_[1-5][0-9]{2}_invalid$/u.test(message))
      ? message : PREFIX + "download_failed";
  } catch { return PREFIX + "download_failed"; }
}
function freeze(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function closeAll(operations) {
  let uncertain = false;
  for (const operation of operations) { try { operation?.(); } catch { uncertain = true; } }
  if (uncertain) fail("cleanup_uncertain");
}

function validateMaterial(material) {
  material = snapshotRecord(material, ["id", "role", "origin", "commit", "path", "url", "expected"], "material_invalid");
  material.expected = snapshotRecord(material.expected, ["sha256", "sha512", "gitBlobSha1", "size", "gitMode", "gitType"], "material_invalid");
  if (typeof material.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,191}$/u.test(material.id)) fail("material_invalid");
  if (typeof material.role !== "string" || !["APORTS_RECIPE", "SOURCE_ARCHIVE", "SOURCE_PATCH", "SOURCE_AUX",
    "INSTALL_HOOK", "TRIGGER", "GO_STDLIB_SOURCE"].includes(material.role)
    || typeof material.path !== "string" || material.path.length > 255 || /[\0\r\n\\]/u.test(material.path)
    || material.origin !== null && typeof material.origin !== "string"
    || material.commit !== null && (typeof material.commit !== "string" || !/^[a-f0-9]{40}$/u.test(material.commit))) fail("material_invalid");
  const pin = material.expected;
  for (const [name, length] of [["sha256", 64], ["sha512", 128], ["gitBlobSha1", 40]]) {
    if (pin[name] !== null && (typeof pin[name] !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`, "u").test(pin[name]))) fail("material_invalid");
  }
  if (![pin.sha256, pin.sha512, pin.gitBlobSha1].some(Boolean) || pin.size !== null &&
    (!Number.isSafeInteger(pin.size) || pin.size < 1 || pin.size > postgresSourceClosureLimits.objectBytes) ||
    pin.gitBlobSha1 !== null && (pin.size === null || pin.gitType !== "blob" || !["100644", "100755", "120000"].includes(pin.gitMode)) ||
    pin.gitBlobSha1 === null && (pin.gitMode !== null || pin.gitType !== null)) fail("material_invalid");
  sourceUrl(material.url);
  return Object.freeze({ ...material, expected: Object.freeze({ ...pin }) });
}

function sourceUrl(value, redirect = false) {
  if (typeof value !== "string" || value.length > 2048 || !/^[!-~]+$/u.test(value) || /\\/u.test(value)
    || !redirect && value.includes("%")) fail("url_invalid");
  let url; try { url = new URL(value); } catch { fail("url_invalid"); }
  if (url.href !== value || url.protocol !== "https:" ||
    url.username || url.password || url.port || url.hash ||
    ![...allowedSourceHosts, ...(redirect ? redirectHosts : [])].includes(url.hostname)) fail("url_invalid");
  return url;
}

function privateDirectory(directory, { create = false } = {}) {
  if (process.platform !== "linux" || typeof directory !== "string" || !path.isAbsolute(directory) ||
    path.normalize(directory) !== directory || directory === "/" || /[\0\r\n\\]/u.test(directory)) fail("storage_invalid");
  const held = [];
  const hold = (file, leaf) => {
    const before = lstatSync(file, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || realpathSync(file) !== file ||
      ![0n, BigInt(process.getuid())].includes(before.uid) || (before.mode & 0o6000n) !== 0n ||
      (before.mode & 0o0022n) !== 0n && !(before.uid === 0n && (before.mode & 0o1000n) !== 0n) ||
      leaf && (before.uid !== BigInt(process.getuid()) || before.gid !== BigInt(process.getgid()) || (before.mode & 0o7777n) !== 0o700n)) fail("storage_invalid");
    const fd = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const expected = directoryIdentity(before);
    held.push({ file, fd, expected });
    if (!isDeepStrictEqual(directoryIdentity(fstatSync(fd, { bigint: true })), expected)) fail("storage_changed");
  };
  try {
    let current = "/"; hold(current, false);
    for (const component of path.dirname(directory).split("/").filter(Boolean)) { current = path.join(current, component); hold(current, false); }
    if (create) { try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
    hold(directory, true);
    const check = () => {
      for (const v of held) {
        const named = lstatSync(v.file, { bigint: true });
        if (!named.isDirectory() || named.isSymbolicLink() || realpathSync(v.file) !== v.file ||
          !isDeepStrictEqual(directoryIdentity(named), v.expected) ||
          !isDeepStrictEqual(directoryIdentity(fstatSync(v.fd, { bigint: true })), v.expected)) fail("storage_changed");
      }
    };
    check();
    return { check, fd: held.at(-1).fd, close: () => closeAll(held.reverse().map(v => () => closeSync(v.fd))) };
  } catch (error) { closeAll(held.reverse().map(v => () => closeSync(v.fd))); throw error; }
}

function fileIdentity(fd, file) {
  const opened = fstatSync(fd, { bigint: true }); const named = lstatSync(file, { bigint: true });
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.uid !== BigInt(process.getuid()) ||
    opened.gid !== BigInt(process.getgid()) || (opened.mode & 0o7777n) !== 0o600n || opened.nlink !== 1n ||
    !isDeepStrictEqual(identity(opened), identity(named))) fail("storage_invalid");
  return identity(opened);
}

function digestState(expected) {
  const sha256 = createHash("sha256"); const sha512 = createHash("sha512");
  const git = expected.gitBlobSha1 === null ? null : createHash("sha1").update(`blob ${expected.size}\0`);
  let size = 0;
  return {
    update(bytes) {
      size += bytes.length;
      if (size > postgresSourceClosureLimits.objectBytes || expected.size !== null && size > expected.size) fail("size_invalid");
      sha256.update(bytes); sha512.update(bytes); git?.update(bytes);
    },
    finish() {
      const value = { size, sha256: sha256.digest("hex"), sha512: sha512.digest("hex"), gitBlobSha1: git?.digest("hex") ?? null };
      if (size < 1 || expected.size !== null && size !== expected.size ||
        ["sha256", "sha512", "gitBlobSha1"].some((key) => expected[key] !== null && expected[key] !== value[key])) fail("digest_invalid");
      return value;
    },
  };
}

function checkCapacity(directory, remaining, held) {
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > postgresSourceClosureLimits.totalBytes) fail("capacity_invalid");
  held?.check();
  const stat = statfsSync(held ? `/proc/self/fd/${held.fd}` : directory, { bigint: true });
  if (stat.type !== 0xef53n || stat.bavail * stat.bsize < BigInt(remaining + postgresSourceClosureLimits.reservedDiskBytes)) fail("capacity_invalid");
  held?.check();
}

function blobName(material) {
  const pin = material.expected;
  return pin.sha256 !== null ? `sha256-${pin.sha256}.blob` : pin.sha512 !== null ? `sha512-${pin.sha512}.blob` : `gitsha1-${pin.gitBlobSha1}.blob`;
}

function storedBytes(directory) {
  let total = 0;
  const count = (at, nested) => {
    // Anchor before listing, then recheck both the anchor and inventory afterwards.
    const held = privateDirectory(at);
    try {
      held.check(); const names = readdirSync(at).sort();
      if (names.length > postgresSourceClosureLimits.directoryEntries) fail("storage_invalid");
      for (const name of names) {
        held.check(); const file = path.join(at, name); const named = lstatSync(file, { bigint: true });
        if (!nested && ["blobs", "attempts"].includes(name)) { count(file, true); continue; }
        if (!named.isFile() || named.isSymbolicLink()) fail("storage_invalid");
        const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
        try {
          const before = fileIdentity(fd, file);
          if (before.size > postgresSourceClosureLimits.objectBytes) fail("storage_invalid");
          total += before.size;
          if (total > postgresSourceClosureLimits.totalBytes) fail("size_invalid");
          if (!isDeepStrictEqual(before, fileIdentity(fd, file))) fail("storage_changed");
        } finally { closeAll([() => closeSync(fd)]); }
      }
      if (!isDeepStrictEqual(names, readdirSync(at).sort())) fail("storage_changed");
      held.check();
    } finally { held.close(); }
  };
  count(directory, false); return total;
}

async function verifyExisting(file, material, signal) {
  let fd;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  try {
    const before = fileIdentity(fd, file); const state = digestState(material.expected); const bytes = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (true) {
      signal.throwIfAborted(); const count = readSync(fd, bytes, 0, bytes.length, offset);
      if (count === 0) break;
      state.update(bytes.subarray(0, count)); offset += count;
    }
    const result = state.finish();
    if (!isDeepStrictEqual(before, fileIdentity(fd, file))) fail("storage_changed");
    return { ...result, identity: before, eof: true, acquisition: "EXISTING_BYTES_REVERIFIED" };
  } finally { closeAll([() => closeSync(fd)]); }
}

async function requestResponse(material, signal, fetchImplementation, startUrl, mirror, fromMirror = false) {
  let url = fromMirror ? mirror.url : sourceUrl(startUrl).href;
  for (let redirects = 0; redirects <= postgresSourceClosureLimits.redirects; redirects++) {
    signal.throwIfAborted();
    let response;
    try {
      response = await fetchImplementation(url, { method: "GET", redirect: "manual", signal,
        headers: { Accept: "application/octet-stream", "Accept-Encoding": "identity" } });
    } catch (error) {
      signal.throwIfAborted();
      if (failureReason(error) === PREFIX + "cleanup_uncertain") fail("cleanup_uncertain");
      throw responseFailure("download_failed", url === material.url ? "TRANSPORT" : null);
    }
    if (signal.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (fromMirror || !location || redirects === postgresSourceClosureLimits.redirects) fail("redirect_invalid");
      const redirected = new URL(location, url).href;
      // IANA's observed exact redirect remains outside the general redirect policy.
      if (url === material.url && mirror?.redirectUrl === redirected) throw responseFailure("url_invalid", "IANA_REDIRECT");
      url = sourceUrl(redirected, true).href; continue;
    }
    const encoding = response.headers.get("content-encoding");
    if (response.status !== 200 || !response.body || encoding && encoding !== "identity") {
      await response.body?.cancel();
      const eligibility = url !== material.url ? null : response.status === 200 && response.body && encoding && encoding !== "identity"
        ? "CONTENT_ENCODING" : [404, 406].includes(response.status) ? `HTTP_${response.status}` : null;
      throw responseFailure(`response_${response.status}_invalid`, eligibility);
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || !Number.isSafeInteger(Number(length)) ||
      Number(length) > postgresSourceClosureLimits.objectBytes || material.expected.size !== null && Number(length) !== material.expected.size)) {
      await response.body.cancel(); fail("size_invalid");
    }
    // This is a descriptive URL; request queries can contain temporary access capabilities.
    const descriptiveUrl = new URL(url); descriptiveUrl.search = ""; descriptiveUrl.hash = "";
    return { response, finalUrl: descriptiveUrl.href, declaredLength: length === null ? null : Number(length) };
  }
  fail("redirect_invalid");
}

async function responseFor(material, signal, fetchImplementation) {
  const mirror = mirrorFor(material);
  try {
    return { ...await requestResponse(material, signal, fetchImplementation, material.url, mirror), acquisition: "HTTPS_BYTES_VERIFIED" };
  } catch (error) {
    signal.throwIfAborted();
    if (!mirror || Object.getOwnPropertyDescriptor(error, MIRROR_ELIGIBILITY)?.value !== mirror.trigger
      || failureReason(error) !== mirror.reason) throw error;
    // Only header/transport refusal reaches here: no response reader was created,
    // and streamed failures and digest failures cannot invoke this single fallback.
    return { ...await requestResponse(material, signal, fetchImplementation, mirror.url, mirror, true),
      acquisition: "HTTPS_MIRROR_BYTES_VERIFIED", primaryFailure: mirror.reason };
  }
}

function readRecord(fd, file, expectedBytes) {
  const before = fileIdentity(fd, file);
  if (before.size > postgresSourceClosureLimits.recordBytes || expectedBytes && before.size !== expectedBytes.length) fail("record_invalid");
  const chunks = []; const bytes = Buffer.alloc(64 * 1024); let offset = 0;
  while (true) {
    const count = readSync(fd, bytes, 0, bytes.length, offset);
    if (!count) break;
    offset += count; if (offset > postgresSourceClosureLimits.recordBytes) fail("record_invalid");
    chunks.push(Buffer.from(bytes.subarray(0, count)));
  }
  const result = Buffer.concat(chunks);
  if (offset !== before.size || expectedBytes && !result.equals(expectedBytes)
    || !isDeepStrictEqual(before, fileIdentity(fd, file))) fail("storage_changed");
  return { bytes: result, identity: before, eof: true };
}

function holdRecord(fd, file, name, expectedBytes) {
  let current = readRecord(fd, file, expectedBytes);
  const expected = current.identity;
  return {
    reference: freeze({ name, size: expectedBytes.length, sha256: hash("sha256", expectedBytes), identity: expected, eof: true }),
    check() {
      current = readRecord(fd, file, expectedBytes);
      if (!isDeepStrictEqual(current.identity, expected)) fail("storage_changed");
    },
    close() { closeAll([() => closeSync(fd)]); },
  };
}

function writeRecord(directory, root, name, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > postgresSourceClosureLimits.recordBytes) fail("record_invalid");
  const file = path.join(directory, name);
  const pending = path.join(directory, `.record-${randomBytes(12).toString("hex")}.pending`);
  const fd = openSync(pending, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NONBLOCK | constants.O_NOFOLLOW, 0o600);
  try {
    fileIdentity(fd, pending); let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset);
      if (count < 1) fail("write_failed"); offset += count;
    }
    fsyncSync(fd); readRecord(fd, pending, bytes); root.check();
    linkSync(pending, file);
    const opened = fstatSync(fd, { bigint: true });
    const temporary = lstatSync(pending, { bigint: true }); const published = lstatSync(file, { bigint: true });
    if (opened.nlink !== 2n || !opened.isFile() || !temporary.isFile() || !published.isFile()
      || !isDeepStrictEqual(identity(opened), identity(temporary)) || !isDeepStrictEqual(identity(opened), identity(published))) fail("storage_changed");
    root.check(); unlinkSync(pending); fsyncSync(root.fd); root.check();
    return holdRecord(fd, file, name, bytes);
  } catch (error) {
    // Any failed temporary/publication is retained for diagnosis, never acknowledged.
    closeAll([() => closeSync(fd)]); throw error;
  }
}

function collectionLock(directory, root) {
  root.check(); const file = path.join(directory, ".collection-lock"); let fd;
  try { fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NONBLOCK | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code === "EEXIST") fail("collection_locked"); throw error; }
  try {
    const bytes = Buffer.from(JSON.stringify({ kind: "POSTGRES_SOURCE_COLLECTION_LOCK_V1", nonce: randomBytes(12).toString("hex"), pid: process.pid }) + "\n");
    let offset = 0;
    while (offset < bytes.length) { const count = writeSync(fd, bytes, offset, bytes.length - offset); if (!count) fail("write_failed"); offset += count; }
    fsyncSync(fd); fsyncSync(root.fd); const keeper = holdRecord(fd, file, ".collection-lock", bytes);
    return {
      check() { root.check(); keeper.check(); },
      close() {
        try { root.check(); keeper.check(); unlinkSync(file); fsyncSync(root.fd); root.check(); }
        catch { closeAll([() => keeper.close()]); fail("cleanup_uncertain"); }
        keeper.close();
      },
    };
  } catch (error) { closeAll([() => closeSync(fd)]); throw error; }
}

async function retainMaterial(material, { directory, signal, fetchImplementation, maxBytes }, lease) {
  material = validateMaterial(material);
  if (!(signal instanceof globalThis.AbortSignal) || typeof fetchImplementation !== "function" ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > postgresSourceClosureLimits.objectBytes) fail("arguments_invalid");
  const root = privateDirectory(directory); let blobs; let attempts; let fd;
  try {
    lease.check(); root.check(); blobs = privateDirectory(path.join(directory, "blobs"), { create: true });
    attempts = privateDirectory(path.join(directory, "attempts"), { create: true });
    const destination = path.join(directory, "blobs", blobName(material));
    const existing = await verifyExisting(destination, material, signal);
    if (existing) { lease.check(); root.check(); blobs.check(); return { id: material.id, name: blobName(material), ...existing }; }
    if (maxBytes === 0) fail("capacity_invalid");
    if (material.expected.size !== null && material.expected.size > maxBytes) fail("size_invalid");
    signal.throwIfAborted(); checkCapacity(directory, material.expected.size ?? maxBytes, root);
    const pending = path.join(directory, "attempts", `${material.id}-${randomBytes(12).toString("hex")}.part`);
    fd = openSync(pending, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fileIdentity(fd, pending);
    const { response, finalUrl, declaredLength, acquisition, primaryFailure } = await responseFor(material, signal, fetchImplementation);
    const state = digestState(material.expected); let written = 0; let eof = false;
    const reader = response.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted(); lease.check(); const chunk = await reader.read(); lease.check();
        if (chunk.done) { eof = true; break; }
        const bytes = Buffer.from(chunk.value); written += bytes.length;
        if (written > maxBytes) fail("size_invalid"); state.update(bytes);
        let offset = 0;
        while (offset < bytes.length) { signal.throwIfAborted(); const count = writeSync(fd, bytes, offset, bytes.length - offset); if (count < 1) fail("write_failed"); offset += count; }
      }
    } finally { if (!eof) await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!eof || declaredLength !== null && written !== declaredLength) fail("size_invalid");
    const result = state.finish(); fsyncSync(fd); const saved = fileIdentity(fd, pending);
    if (saved.size !== result.size) fail("storage_invalid");
    lease.check(); root.check(); blobs.check(); attempts.check(); signal.throwIfAborted();
    // link is an atomic no-replace publication. The retained partial/failure history is never accepted as a blob.
    linkSync(pending, destination); unlinkSync(pending); fsyncSync(blobs.fd); fsyncSync(attempts.fd);
    const published = fileIdentity(fd, destination);
    const reread = await verifyExisting(destination, material, signal);
    if (!reread || !isDeepStrictEqual(published, reread.identity) ||
      ["size", "sha256", "sha512", "gitBlobSha1"].some((key) => reread[key] !== result[key])) fail("storage_changed");
    lease.check(); root.check(); blobs.check(); attempts.check();
    return { id: material.id, name: blobName(material), ...result, identity: published, eof: true,
      acquisition, finalUrl, ...(primaryFailure ? { primaryFailure } : {}) };
  } finally { closeAll([fd === undefined ? null : () => closeSync(fd),
    () => attempts?.close(), () => blobs?.close(), () => root.close()]); }
}

// The reusable byte operation has no admission authority. It shares the batch writer lock.
export async function retainPostgresSourceMaterial(material, { directory, signal, fetchImplementation = globalThis.fetch,
  maxBytes = postgresSourceClosureLimits.objectBytes } = {}) {
  material = validateMaterial(material);
  if (!(signal instanceof globalThis.AbortSignal) || typeof fetchImplementation !== "function"
    || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > postgresSourceClosureLimits.objectBytes) fail("arguments_invalid");
  const root = privateDirectory(directory); let lease;
  try {
    lease = collectionLock(directory, root);
    const remaining = postgresSourceClosureLimits.totalBytes - storedBytes(directory);
    return await retainMaterial(material, { directory, signal, fetchImplementation, maxBytes: Math.min(maxBytes, remaining) }, lease);
  } finally { closeAll([() => lease?.close(), () => root.close()]); }
}

function actor() {
  if (process.platform !== "linux" || process.getuid() !== 1000 || process.getgid() !== 1000 || process.geteuid() !== 1000 ||
    process.getegid() !== 1000 || !isDeepStrictEqual(process.getgroups(), [1000]) || process.versions.node !== "22.23.2") fail("actor_invalid");
  const status = readFileSync("/proc/self/status", "utf8");
  if (["Uid", "Gid"].some(key => !new RegExp(`^${key}:[ \\t]+1000[ \\t]+1000[ \\t]+1000[ \\t]+1000$`, "mu").test(status))
    || ["CapInh", "CapPrm", "CapEff", "CapAmb"].some((key) => !new RegExp(`^${key}:[ \\t]+0{16}$`, "mu").test(status)) ||
    !/^NoNewPrivs:[ \t]+1$/mu.test(status) || !/^Groups:[ \t]*$/mu.test(status)) fail("actor_invalid");
  if (!isDeepStrictEqual(Object.keys(process.env).sort(), Object.keys(ENV).sort())
    || Object.keys(ENV).some(key => process.env[key] !== ENV[key])) fail("environment_invalid");
  return { uid: 1000, gid: 1000, kernelSupplementaryGroups: [], capabilitySets: "INHERITABLE_PERMITTED_EFFECTIVE_AMBIENT_ZERO", noNewPrivs: 1 };
}

function sourceSession() {
  const sourceNames = ["scripts/postgres-image/source-closure.mjs", "scripts/postgres-image/source-closure-manifest.mjs",
    "infra/postgres-image/source-closure-materials.json"];
  const sourcePaths = [fileURLToPath(import.meta.url), fileURLToPath(new URL("./source-closure-manifest.mjs", import.meta.url)),
    fileURLToPath(new URL("../../infra/postgres-image/source-closure-materials.json", import.meta.url))];
  const directories = new Map(); const files = [];
  const holdDirectory = file => {
    if (directories.has(file)) return;
    const s = lstatSync(file, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(file) !== file || ![0n, 1000n].includes(s.uid)
      || (s.mode & 0o6000n) || (s.mode & 0o0022n) && !(s.uid === 0n && (s.mode & 0o1000n))) fail("context_invalid");
    const fd = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const expected = directoryIdentity(s); directories.set(file, { fd, expected });
    if (!isDeepStrictEqual(directoryIdentity(fstatSync(fd, { bigint: true })), expected)) fail("context_invalid");
  };
  const checkFile = entry => {
    const s = fstatSync(entry.fd, { bigint: true }); const named = lstatSync(entry.file, { bigint: true });
    const mode = Number(s.mode & 0o7777n);
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || s.nlink !== 1n || ![0n, 1000n].includes(s.uid)
      || ![0n, 1000n].includes(s.gid) || ![0o440, 0o600, 0o644].includes(mode) || realpathSync(entry.file) !== entry.file
      || s.size > BigInt(postgresSourceClosureLimits.recordBytes) || !isDeepStrictEqual(identity(s), identity(named))
      || statfsSync(`/proc/self/fd/${entry.fd}`, { bigint: true }).type !== 0xef53n) fail("context_invalid");
    if (entry.identity && !isDeepStrictEqual(entry.identity, identity(s))) fail("context_invalid");
    return identity(s);
  };
  const readSource = entry => {
    const before = checkFile(entry); const state = createHash("sha256"); const chunks = []; const buffer = Buffer.alloc(64 * 1024); let size = 0;
    while (true) {
      const count = readSync(entry.fd, buffer, 0, buffer.length, size); if (!count) break;
      size += count; if (size > postgresSourceClosureLimits.recordBytes) fail("context_invalid");
      const bytes = buffer.subarray(0, count); state.update(bytes); chunks.push(Buffer.from(bytes));
    }
    const sha256 = state.digest("hex");
    if (size !== before.size || !isDeepStrictEqual(before, checkFile(entry)) || entry.sha256 && sha256 !== entry.sha256) fail("context_invalid");
    return { size, sha256, bytes: Buffer.concat(chunks) };
  };
  const check = (full = false) => {
    for (const [file, entry] of directories) {
      const s = lstatSync(file, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(file) !== file
        || !isDeepStrictEqual(directoryIdentity(s), entry.expected)
        || !isDeepStrictEqual(directoryIdentity(fstatSync(entry.fd, { bigint: true })), entry.expected)) fail("context_invalid");
    }
    for (const entry of files) { if (full) readSource(entry); else checkFile(entry); }
  };
  const close = () => closeAll([...files.map(entry => () => closeSync(entry.fd)), ...[...directories.values()].reverse().map(entry => () => closeSync(entry.fd))]);
  try {
    for (let index = 0; index < sourcePaths.length; index++) {
      const file = sourcePaths[index]; let at = "/"; holdDirectory(at);
      for (const component of path.dirname(file).split("/").filter(Boolean)) { at = path.join(at, component); holdDirectory(at); }
      const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
      const entry = { fd, file, source: sourceNames[index] }; files.push(entry);
      entry.identity = checkFile(entry); const read = readSource(entry); entry.sha256 = read.sha256; entry.size = read.size;
      if (index === 2) validatePostgresSourceClosureManifest(JSON.parse(read.bytes.toString("utf8")));
    }
    check(true);
    return { check, close, references: files.map(({ source, size, sha256, identity }) => freeze({ source, size, sha256, identity, eof: true })) };
  } catch (error) { close(); throw error; }
}

function dataArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("proof_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value); const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) fail("proof_invalid");
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[index]; if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("proof_invalid");
    return descriptor.value;
  });
}

// A pure comparison of caller facts. Native source/byte/publication checks remain mandatory in collect().
export function finalizePostgresSourceClosureMaterials(value) {
  try {
    value = snapshotRecord(value, ["expectedMaterials", "materials", "failures", "observedNames"], "proof_invalid");
    const expected = dataArray(value.expectedMaterials, 323).map(validateMaterial);
    if (!expected.length || new Set(expected.map(v => v.id)).size !== expected.length) fail("proof_invalid");
    const byId = new Map(expected.map(v => [v.id, v])); const seen = new Set(); let totalBytes = 0;
    const materials = dataArray(value.materials, 323).map(entry => {
      const keys = ["id", "name", "size", "sha256", "sha512", "gitBlobSha1", "identity", "eof", "acquisition"];
      if (entry && Object.getOwnPropertyDescriptor(entry, "acquisition")?.value === "HTTPS_BYTES_VERIFIED") keys.push("finalUrl");
      if (entry && Object.getOwnPropertyDescriptor(entry, "acquisition")?.value === "HTTPS_MIRROR_BYTES_VERIFIED") keys.push("finalUrl", "primaryFailure");
      entry = snapshotRecord(entry, keys, "proof_invalid");
      if (typeof entry.id !== "string" || !byId.has(entry.id) || seen.has(entry.id)) fail("proof_invalid");
      const pin = byId.get(entry.id); seen.add(entry.id);
      if (entry.name !== blobName(pin) || entry.eof !== true || !Number.isSafeInteger(entry.size) || entry.size < 1
        || entry.size > postgresSourceClosureLimits.objectBytes || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)
        || typeof entry.sha512 !== "string" || !/^[0-9a-f]{128}$/u.test(entry.sha512)
        || pin.expected.gitBlobSha1 === null && entry.gitBlobSha1 !== null
        || ["size", "sha256", "sha512", "gitBlobSha1"].some(key => pin.expected[key] !== null && pin.expected[key] !== entry[key])
        || !["EXISTING_BYTES_REVERIFIED", "HTTPS_BYTES_VERIFIED", "HTTPS_MIRROR_BYTES_VERIFIED"].includes(entry.acquisition)) fail("proof_invalid");
      if (entry.acquisition === "HTTPS_BYTES_VERIFIED" && sourceUrl(entry.finalUrl, true).search) fail("proof_invalid");
      if (entry.acquisition === "HTTPS_MIRROR_BYTES_VERIFIED") {
        const mirror = mirrorFor(pin);
        if (!mirror || entry.finalUrl !== mirror.url || entry.primaryFailure !== mirror.reason) fail("proof_invalid");
      }
      const native = snapshotRecord(entry.identity, ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"], "proof_invalid");
      if (["dev", "ino", "mtimeNs", "ctimeNs"].some(key => typeof native[key] !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(native[key]))
        || native.uid !== 1000 || native.gid !== 1000 || native.mode !== 0o600 || native.nlink !== 1 || native.size !== entry.size) fail("proof_invalid");
      totalBytes += entry.size; if (totalBytes > postgresSourceClosureLimits.totalBytes) fail("proof_invalid");
      return { ...entry, identity: { ...native } };
    });
    const failures = dataArray(value.failures, 323).map(entry => {
      entry = snapshotRecord(entry, ["id", "reason"], "proof_invalid");
      if (typeof entry.id !== "string" || !byId.has(entry.id) || seen.has(entry.id)
        || typeof entry.reason !== "string" || failureReason(new Error(entry.reason)) !== entry.reason
        || entry.reason === PREFIX + "cleanup_uncertain") fail("proof_invalid");
      seen.add(entry.id); return { ...entry };
    });
    const names = dataArray(value.observedNames, postgresSourceClosureLimits.directoryEntries);
    if (names.some(name => typeof name !== "string" || !/^(?:sha256-[0-9a-f]{64}|sha512-[0-9a-f]{128}|gitsha1-[0-9a-f]{40})\.blob$/u.test(name))
      || new Set(names).size !== names.length) fail("proof_invalid");
    const expectedNames = [...new Set(expected.map(blobName))].sort();
    const complete = !failures.length && materials.length === expected.length && isDeepStrictEqual([...names].sort(), expectedNames);
    return freeze({ state: complete ? "BYTES_VERIFIED_UNADMITTED" : "INCOMPLETE",
      counts: { expected: expected.length, verified: materials.length, failed: failures.length, totalBytes },
      materials, failures, claims: { ...CLAIMS } });
  } catch { fail("proof_invalid"); }
}

export async function collectPostgresSourceClosure({ directory, signal, onProgress = () => {} } = {}) {
  const nativeActor = actor(); const manifest = loadPostgresSourceClosureManifest();
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal) || typeof onProgress !== "function") fail("arguments_invalid");
  const operationSignal = globalThis.AbortSignal.any([globalThis.AbortSignal.timeout(postgresSourceClosureLimits.operationMs), ...(signal ? [signal] : [])]);
  const sources = sourceSession(); let root; let lease; let contextRecord; let receiptRecord; let ack;
  const run = randomBytes(12).toString("hex"); const materials = []; const failures = [];
  try {
    root = privateDirectory(directory, { create: true }); lease = collectionLock(directory, root);
    const context = { kind: "POSTGRES_PUBLIC_SOURCE_COLLECTION_CONTEXT_V1", subject: manifest.subject,
      manifestSha256: hash("sha256", Buffer.from(JSON.stringify(manifest) + "\n")),
      sources: sources.references.map(({ source, size, sha256 }) => ({ source, size, sha256 })),
      nodeVersion: process.versions.node, sourceObservation: "SELF_OBSERVED_DISK_BYTES",
      executedCodeAuthentication: "REQUIRES_EXTERNAL_READONLY_SNAPSHOT", authority: "NONE" };
    checkCapacity(directory, postgresSourceClosureLimits.totalBytes - storedBytes(directory), root);
    const contextBytes = Buffer.from(JSON.stringify(context) + "\n");
    // A code change can resume immutable blobs without rewriting prior run context.
    contextRecord = writeRecord(directory, root, `context-${run}.json`, contextBytes);
    for (const material of manifest.materials) {
      operationSignal.throwIfAborted(); lease.check(); sources.check(); contextRecord.check();
      const objectSignal = globalThis.AbortSignal.any([operationSignal, globalThis.AbortSignal.timeout(postgresSourceClosureLimits.objectMs)]);
      let progress;
      try {
        const remaining = postgresSourceClosureLimits.totalBytes - storedBytes(directory);
        checkCapacity(directory, remaining, root);
        const retained = await retainMaterial(material, { directory, signal: objectSignal, fetchImplementation: globalThis.fetch,
          maxBytes: Math.min(postgresSourceClosureLimits.objectBytes, remaining) }, lease);
        materials.push(retained);
        progress = { id: material.id, state: "BYTES_VERIFIED", bytes: retained.size, completed: materials.length, expected: manifest.materials.length };
      } catch (error) {
        const reason = failureReason(error);
        if (operationSignal.aborted || reason === PREFIX + "cleanup_uncertain") throw error;
        failures.push({ id: material.id, reason }); progress = { id: material.id, state: "INCOMPLETE", reason };
      }
      onProgress(Object.freeze(progress));
    }
    lease.check(); sources.check(true); contextRecord.check();
    const blobs = privateDirectory(path.join(directory, "blobs")); let observedNames;
    try { blobs.check(); observedNames = readdirSync(path.join(directory, "blobs")).sort(); blobs.check(); }
    finally { blobs.close(); }
    for (const material of materials) {
      const pin = manifest.materials.find(value => value.id === material.id);
      const reread = await verifyExisting(path.join(directory, "blobs", material.name), pin, operationSignal);
      if (!reread || !isDeepStrictEqual(reread.identity, material.identity)) fail("storage_changed");
    }
    const finalized = finalizePostgresSourceClosureMaterials({ expectedMaterials: manifest.materials, materials, failures, observedNames });
    const receipt = { kind: "POSTGRES_PUBLIC_SOURCE_BYTES_RECEIPT_V1", ...finalized,
      subject: manifest.subject, context, run, actor: nativeActor, sourceFiles: sources.references };
    operationSignal.throwIfAborted(); receiptRecord = writeRecord(directory, root, `collection-${run}.json`, Buffer.from(JSON.stringify(receipt) + "\n"));
    sources.check(true); contextRecord.check(); receiptRecord.check(); lease.check();
    if (storedBytes(directory) > postgresSourceClosureLimits.totalBytes) fail("size_invalid");
    ack = freeze({ kind: "POSTGRES_PUBLIC_SOURCE_BYTES_ACK_V1", state: receipt.state, subject: manifest.subject,
      run, counts: receipt.counts, context: contextRecord.reference, receipt: receiptRecord.reference, admission: "NOT_AUTHORIZED" });
  } finally { closeAll([() => receiptRecord?.close(), () => contextRecord?.close(), () => lease?.close(),
    () => root?.close(), () => sources.close()]); }
  return ack;
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--directory") fail("arguments_invalid");
  const result = await collectPostgresSourceClosure({ directory: process.argv[3] });
  let broken = false;
  await new Promise((resolve, reject) => {
    process.stdout.on("error", () => { broken = true; process.exitCode = 1; reject(new Error(PREFIX + "output_failed")); });
    process.stdout.end(JSON.stringify(result) + "\n", error => error || broken || !process.stdout.writableFinished ? reject(new Error(PREFIX + "output_failed")) : resolve());
  });
  if (broken) fail("output_failed");
  if (result.state !== "BYTES_VERIFIED_UNADMITTED") process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write(PREFIX + "operation_failed\n"); process.exitCode = 1; });
}
