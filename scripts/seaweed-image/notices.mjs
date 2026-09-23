import { createHash } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import seaweedLock from "../../infra/seaweed/seaweed-lock.json" with { type: "json" };

const ROOT = "usr/share/auto-world/seaweedfs";
const INDEX_PATH = `${ROOT}/attribution-index.json`;
const DIGEST = /^[a-f0-9]{64}$/u;
const GO_SUM = /^h1:[A-Za-z0-9+/]{43}=$/u;

export const NOTICE_PLAN_LIMITS = Object.freeze({
  moduleClosureBytes: 64 * 1024 ** 2,
  modules: 2048,
  noticesPerModule: 64,
  notices: 16_384,
  noticeBytes: 1024 ** 2,
  totalNoticeBytes: 512 * 1024 ** 2,
  indexBytes: 32 * 1024 ** 2,
  baseEntries: 100_000,
});

const DERIVATIVE_NOTICE = Object.freeze({
  sourceMaterial: "materials/DERIVATIVE-NOTICE.txt",
  destination: `${ROOT}/DERIVATIVE-NOTICE.txt`,
  sha256: "10601ed9eb750bb381bbd01f822dde555c4f81e8f6ff2ea22f33c26fde33428a",
  size: 1049,
  kind: "project",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(reason = "invalid") {
  throw new Error(`seaweed_notice_plan_${reason}`);
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function safeText(value, maximum = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    [...value].every((character) => character.codePointAt(0) > 31 && character.codePointAt(0) !== 127);
}

function safePath(value) {
  if (!safeText(value, 4096) || value.includes("\\") || value.startsWith("/") || value.endsWith("/") || path.posix.normalize(value) !== value) return false;
  const parts = value.split("/");
  return parts.length <= 64 && !parts.some((part) => part === "" || part === "." || part === "..");
}

function descriptor(value, maximum = 256 * 1024 ** 2) {
  return exactKeys(value, ["sha256", "size"]) && DIGEST.test(value.sha256) && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= maximum;
}

function lockedContract() {
  const upstream = new Map((seaweedLock.upstreamMaterials ?? []).map((entry) => [entry.path, entry]));
  const license = upstream.get("LICENSE");
  const glog = upstream.get("weed/glog/LICENSE");
  if (seaweedLock.schemaVersion !== 1 || seaweedLock.source?.commit !== "c5073360007d28385a33426a42ac3e4ec504c5a3" ||
      seaweedLock.source?.tree !== "bce9e3f66721208f35888124183f80bd76d64f90" || seaweedLock.source?.commitUnixTime !== 1789349515 ||
      seaweedLock.build?.commitValue !== "c507336+aw.549ec92660ab" || seaweedLock.grpc?.version !== "v1.85.0-dev.0.20260915183914-4e49413dcab7" ||
      !descriptor(license && { sha256: license.sha256, size: license.size }) || !descriptor(glog && { sha256: glog.sha256, size: glog.size }) ||
      !GO_SUM.test(seaweedLock.grpc?.sum ?? "") || !GO_SUM.test(seaweedLock.grpc?.goModSum ?? "")) fail("lock_invalid");
  return {
    epoch: seaweedLock.source.commitUnixTime,
    source: {
      commit: seaweedLock.source.commit,
      tree: seaweedLock.source.tree,
      derivativeCommit: seaweedLock.build.commitValue,
      grpc: { version: seaweedLock.grpc.version, sum: seaweedLock.grpc.sum, goModSum: seaweedLock.grpc.goModSum },
    },
    fixed: [
      DERIVATIVE_NOTICE,
      { sourceMaterial: "materials/upstream/LICENSE", destination: `${ROOT}/upstream/LICENSE`, ...license, kind: "upstream" },
      { sourceMaterial: "materials/upstream/weed/glog/LICENSE", destination: `${ROOT}/upstream/weed/glog/LICENSE`, ...glog, kind: "upstream" },
    ],
  };
}

function parseClosure(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > NOTICE_PLAN_LIMITS.moduleClosureBytes) fail("closure_invalid");
  let modules;
  try {
    modules = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("closure_invalid");
  }
  if (!Array.isArray(modules) || modules.length < 1 || modules.length > NOTICE_PLAN_LIMITS.modules) fail("closure_invalid");
  return modules;
}

function normalizeModules(rawModules, grpc) {
  const modules = [];
  const moduleKeys = new Set(); const moduleIds = new Set();
  let totalNotices = 0;
  for (const raw of rawModules) {
    if (!exactKeys(raw, ["id", "path", "version", "sum", "goModSum", "files", "notices"]) || !safeText(raw.path, 1024) ||
        !safeText(raw.version, 512) || !GO_SUM.test(raw.sum) || !GO_SUM.test(raw.goModSum) || !DIGEST.test(raw.id) ||
        !exactKeys(raw.files, ["module.info", "module.mod", "source.zip"]) || !descriptor(raw.files["module.info"]) ||
        !descriptor(raw.files["module.mod"]) || !descriptor(raw.files["source.zip"]) || !Array.isArray(raw.notices) ||
        raw.notices.length > NOTICE_PLAN_LIMITS.noticesPerModule) fail("closure_invalid");
    const key = `${raw.path}@${raw.version}`;
    if (raw.id !== sha256(Buffer.from(key, "utf8")) || moduleKeys.has(key) || moduleIds.has(raw.id)) fail("closure_invalid");
    moduleKeys.add(key); moduleIds.add(raw.id);
    const notices = raw.notices.map((notice) => {
      if (!exactKeys(notice, ["archiveEntry", "file", "sha256", "size"]) || !safePath(notice.archiveEntry) ||
          !/^notice-[0-9]{3}\.txt$/u.test(notice.file) || !DIGEST.test(notice.sha256) || !Number.isSafeInteger(notice.size) ||
          notice.size < 1 || notice.size > NOTICE_PLAN_LIMITS.noticeBytes) fail("closure_invalid");
      return { archiveEntry: notice.archiveEntry, file: notice.file, sha256: notice.sha256, size: notice.size };
    }).sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
    if (new Set(notices.map((notice) => notice.file)).size !== notices.length || new Set(notices.map((notice) => notice.archiveEntry)).size !== notices.length ||
        notices.some((notice, index) => notice.file !== `notice-${String(index + 1).padStart(3, "0")}.txt`)) fail("closure_invalid");
    totalNotices += notices.length;
    if (totalNotices > NOTICE_PLAN_LIMITS.notices) fail("budget_exceeded");
    const files = {
      "module.info": { sha256: raw.files["module.info"].sha256, size: raw.files["module.info"].size },
      "module.mod": { sha256: raw.files["module.mod"].sha256, size: raw.files["module.mod"].size },
      "source.zip": { sha256: raw.files["source.zip"].sha256, size: raw.files["source.zip"].size },
    };
    modules.push({ id: raw.id, path: raw.path, version: raw.version, sum: raw.sum, goModSum: raw.goModSum, files, notices });
  }
  modules.sort((left, right) => {
    const leftKey = `${left.path}@${left.version}`; const rightKey = `${right.path}@${right.version}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const grpcModules = modules.filter((module) => module.path === "google.golang.org/grpc");
  if (grpcModules.length !== 1 || grpcModules[0].version !== grpc.version || grpcModules[0].sum !== grpc.sum || grpcModules[0].goModSum !== grpc.goModSum) fail("grpc_invalid");
  const grpcBasenames = new Set(grpcModules[0].notices.map((notice) => path.posix.basename(notice.archiveEntry).toLowerCase()));
  if (!grpcBasenames.has("license") || !grpcBasenames.has("notice.txt")) fail("grpc_invalid");
  return modules;
}

function materialBytes(materials, expected) {
  if (!(materials instanceof Map)) fail("material_invalid");
  const bytes = materials.get(expected.sourceMaterial);
  if (!Buffer.isBuffer(bytes) || bytes.length !== expected.size || sha256(bytes) !== expected.sha256) fail("material_invalid");
  return Buffer.from(bytes);
}

function baseInventory(baseEntries) {
  if (!Array.isArray(baseEntries) || baseEntries.length > NOTICE_PLAN_LIMITS.baseEntries) fail("base_invalid");
  const explicit = new Map();
  for (const entry of baseEntries) {
    if (!exactKeys(entry, ["path", "type"]) || !safePath(entry.path) || !["directory", "file", "symlink"].includes(entry.type) || explicit.has(entry.path)) fail("base_invalid");
    explicit.set(entry.path, entry.type);
  }
  const effective = new Map(explicit);
  for (const name of explicit.keys()) {
    let parent = path.posix.dirname(name);
    while (parent !== ".") {
      const type = effective.get(parent);
      if (type && type !== "directory") fail("base_invalid");
      if (!type) effective.set(parent, "directory");
      parent = path.posix.dirname(parent);
    }
  }
  return effective;
}

function lowerBound(values, target) {
  let low = 0; let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1; else high = middle;
  }
  return low;
}

function parents(name) {
  const values = [];
  let parent = path.posix.dirname(name);
  while (parent !== ".") { values.push(parent); parent = path.posix.dirname(parent); }
  return values;
}

function directoryEntry(name, epoch) {
  return { path: name, type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: epoch, size: 0 };
}

function fileEntry(name, bytes, epoch) {
  const content = Buffer.from(bytes);
  return { path: name, type: "file", mode: 0o644, uid: 0, gid: 0, mtime: epoch, size: content.length, sha256: sha256(content), content };
}

/**
 * Prepare ADR-0008's deterministic notice delta without reading, writing, executing or building anything.
 * Every returned Buffer is detached from the caller's material Buffers.
 */
export function createNoticePlan({ moduleClosureBytes, materials, baseEntries } = {}) {
  const contract = lockedContract();
  const modules = normalizeModules(parseClosure(moduleClosureBytes), contract.source.grpc);
  const expectedMaterialPaths = new Set(contract.fixed.map((entry) => entry.sourceMaterial));
  const files = [];
  const fixedIndex = contract.fixed.map((fixed) => {
    expectedMaterialPaths.add(fixed.sourceMaterial);
    const content = materialBytes(materials, fixed);
    files.push(fileEntry(fixed.destination, content, contract.epoch));
    return { kind: fixed.kind, sourceMaterial: fixed.sourceMaterial, destination: fixed.destination, sha256: fixed.sha256, size: fixed.size };
  });
  let totalNoticeBytes = 0;
  const moduleIndex = modules.map((module) => ({
    id: module.id,
    path: module.path,
    version: module.version,
    sum: module.sum,
    goModSum: module.goModSum,
    files: module.files,
    notices: module.notices.map((notice) => {
      const sourceMaterial = `materials/modules/${module.id}/${notice.file}`;
      const destination = `${ROOT}/modules/${module.id}/${notice.file}`;
      expectedMaterialPaths.add(sourceMaterial);
      const content = materialBytes(materials, { ...notice, sourceMaterial });
      totalNoticeBytes += content.length;
      if (totalNoticeBytes > NOTICE_PLAN_LIMITS.totalNoticeBytes) fail("budget_exceeded");
      files.push(fileEntry(destination, content, contract.epoch));
      return { archiveEntry: notice.archiveEntry, sourceMaterial, destination, sha256: notice.sha256, size: notice.size };
    }),
  }));
  if (!(materials instanceof Map) || materials.size !== expectedMaterialPaths.size || [...materials.keys()].some((name) => typeof name !== "string" || !expectedMaterialPaths.has(name))) fail("material_set_invalid");
  const index = {
    schemaVersion: 1,
    state: "PREPARATION_ONLY",
    scope: "retained_notices_only_not_legal_completeness",
    source: contract.source,
    materials: fixedIndex,
    modules: moduleIndex,
  };
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`, "utf8");
  if (indexBytes.length > NOTICE_PLAN_LIMITS.indexBytes) fail("budget_exceeded");
  files.push(fileEntry(INDEX_PATH, indexBytes, contract.epoch));
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (new Set(files.map((entry) => entry.path)).size !== files.length) fail("collision");

  const base = baseInventory(baseEntries);
  const basePaths = [...base.keys()].sort();
  const directories = new Set();
  for (const file of files) {
    const descendantPrefix = `${file.path}/`; const candidate = basePaths[lowerBound(basePaths, descendantPrefix)];
    if (base.has(file.path) || candidate?.startsWith(descendantPrefix)) fail("collision");
    for (const parent of parents(file.path)) {
      const type = base.get(parent);
      if (type && type !== "directory") fail("collision");
      if (!type) directories.add(parent);
    }
  }
  const directoryEntries = [...directories].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || (left < right ? -1 : left > right ? 1 : 0);
  }).map((name) => directoryEntry(name, contract.epoch));
  const entries = [...directoryEntries, ...files];
  return {
    schemaVersion: 1,
    state: "PREPARATION_ONLY",
    claims: { source: "NOT_EVALUATED", image: "NOT_CONSTRUCTED", admission: "NOT_ATTEMPTED" },
    root: ROOT,
    indexPath: INDEX_PATH,
    source: contract.source,
    limits: { ...NOTICE_PLAN_LIMITS },
    summary: {
      moduleCount: modules.length,
      noticeCount: modules.reduce((sum, module) => sum + module.notices.length, 0),
      fixedMaterialCount: fixedIndex.length,
      newDirectoryCount: directoryEntries.length,
      fileCount: files.length,
      totalFileBytes: files.reduce((sum, file) => sum + file.size, 0),
    },
    entries,
  };
}
