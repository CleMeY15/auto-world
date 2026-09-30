import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, readSync, realpathSync, readdirSync, rmdirSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";

const PREFIX = "postgres_private_evidence_source_bundle_";
const ROLES = ["head", "publication", "audit", "runtime", "retention", "copy", "cold", "sql"];
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const SOURCE = ["head", "workspace", "gitDirectory", "commonDirectory", "workspaceIdentity", "gitDirectoryIdentity", "commonDirectoryIdentity", "refsSha256", "files"];
const PROOF = ["kind", "state", "recipeRevision", "source", "file", "refs", "blobs", "zeroPrerequisites", "packVerification", "sourceUnchanged", "auxiliaryCleanup"];
const CAP = 512 * 1024 * 1024;
const STATIC_CAP = 16 * 1024 * 1024;
const MAX_DURATION = 15 * 60_000;
const GIT = "/usr/bin/git";
const ARGS = ["--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
const UPLOAD = "/usr/bin/git --no-replace-objects -c core.fsmonitor=false -c core.hooksPath=/dev/null -c uploadpack.allowAnySHA1InWant=true -c uploadpack.allowFilter=false upload-pack";
const ENV = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_ALLOW_PROTOCOL: "file", GIT_PROTOCOL_FROM_USER: "0", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
const REASONS = new Set(["arguments_invalid", "context_invalid", "deadline_exceeded", "aborted", "storage_invalid",
  "source_invalid", "source_changed", "file_invalid", "file_changed", "git_invalid", "git_failed", "git_output_exceeded",
  "git_cleanup_uncertain", "capacity_insufficient", "bundle_invalid", "blob_invalid", "proof_invalid", "cleanup_uncertain", "failed"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, fields) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...fields].sort());
const digest = (v) => createHash("sha256").update(v).digest("hex");
const rev = (v) => typeof v === "string" && /^[0-9a-f]{40}$/u.test(v);
const hex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, item]) => [key, freeze(item)]))) : v;
const fail = (v) => { throw new Error(`${PREFIX}${v}`); };
function present(file) { try { lstatSync(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
function reason(error) {
  try { const message = error instanceof Error ? error.message : "";
    const value = typeof message === "string" && message.startsWith(PREFIX) ? message.slice(PREFIX.length) : "";
    return REASONS.has(value) ? value : "failed";
  } catch { return "failed"; }
}
function absolute(v) {
  return typeof v === "string" && path.posix.isAbsolute(v) && path.posix.normalize(v) === v
    && !/[\0\r\n\\]/u.test(v) && v !== "/";
}
function relative(v) { return typeof v === "string" && /^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u.test(v)
  && v.split("/").every((part) => part !== "." && part !== ".." && part !== ".git"); }
function inputValid(input) {
  const fields = ["workspace", "directory", "recipeRevision", "recipes", "blobPins", "deadline", ...(Object.hasOwn(input ?? {}, "signal") ? ["signal"] : [])];
  if (!exact(input, fields) || !absolute(input.workspace) || !absolute(input.directory) || !rev(input.recipeRevision)
    || input.directory === input.workspace || input.directory.startsWith(`${input.workspace}/`)
    || input.workspace.startsWith(`${input.directory}/`) || !exact(input.recipes, ROLES.slice(1))
    || Object.values(input.recipes).some((v) => !rev(v)) || new Set([input.recipeRevision, ...Object.values(input.recipes)]).size !== 8
    || !Array.isArray(input.blobPins) || input.blobPins.length < 8 || input.blobPins.length > 64
    || !Number.isSafeInteger(input.deadline) || input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
  const revisions = new Set([input.recipeRevision, ...Object.values(input.recipes)]); const seen = new Set();
  for (const pin of input.blobPins) {
    if (!exact(pin, ["recipeRevision", "path", "sha256", "size"]) || !revisions.has(pin.recipeRevision)
      || !relative(pin.path) || !hex(pin.sha256) || !Number.isSafeInteger(pin.size) || pin.size < 1 || pin.size > STATIC_CAP
      || seen.has(`${pin.recipeRevision}:${pin.path}`)) fail("arguments_invalid");
    seen.add(`${pin.recipeRevision}:${pin.path}`);
  }
  if ([...revisions].some((v) => !input.blobPins.some((p) => p.recipeRevision === v))) fail("arguments_invalid");
  return input;
}
function check(input) {
  if (input.signal?.aborted) fail("aborted");
  if (input.deadline <= Date.now()) fail("deadline_exceeded");
}
function actor(input) {
  inputValid(input);
  if (process.platform !== "linux" || process.getuid?.() !== 1000 || process.getgid?.() !== 1000
    || process.geteuid?.() !== 1000 || process.getegid?.() !== 1000 || input.deadline - Date.now() > MAX_DURATION) fail("context_invalid");
  check(input);
}
function identity(s) { return { dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid),
  mode: Number(s.mode & 0o7777n), nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; }
function metadata(v, file = false) {
  return exact(v, META) && [v.dev, v.ino].every((n) => typeof n === "string" && /^[1-9][0-9]{0,29}$/u.test(n))
    && [v.mtimeNs, v.ctimeNs].every((n) => typeof n === "string" && /^[0-9]{1,30}$/u.test(n))
    && v.uid === 1000 && v.gid === 1000 && Number.isSafeInteger(v.mode) && (v.mode & 0o7022) === 0
    && Number.isSafeInteger(v.size) && v.size >= 0 && Number.isSafeInteger(v.nlink) && (file ? v.nlink === 1 : v.nlink >= 2);
}
function node(file, directory, privateMode = false) {
  if (!absolute(file)) fail("storage_invalid");
  const s = lstatSync(file, { bigint: true });
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) || realpathSync(file) !== file
    || s.uid !== 1000n || s.gid !== 1000n || (s.mode & 0o7022n) !== 0n || !directory && s.nlink !== 1n
    || privateMode && (s.mode & 0o7777n) !== (directory ? 0o700n : 0o600n)) fail("storage_invalid");
  return identity(s);
}
function directoryHeld(file, handles, privateMode = false) {
  const before = node(file, true, privateMode); const fd = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  handles.push(fd);
  if (!isDeepStrictEqual(before, identity(fstatSync(fd, { bigint: true })))) fail("storage_invalid");
  return { file, fd, before, directory: true, privateMode };
}
function verifyHeld(entry, full = true) {
  const current = node(entry.file, entry.directory, entry.privateMode);
  const held = identity(fstatSync(entry.fd, { bigint: true }));
  const fields = full ? META : ["dev", "ino", "uid", "gid", "mode"];
  if (fields.some((key) => current[key] !== entry.before[key] || held[key] !== current[key])) fail("source_changed");
  return current;
}
function readHeld(entry, cap) {
  const before = verifyHeld(entry); if (before.size > cap) fail("file_invalid");
  const bytes = Buffer.alloc(before.size); let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(entry.fd, bytes, offset, bytes.length - offset, offset);
    if (count < 1) fail("file_changed"); offset += count;
  }
  if (readSync(entry.fd, Buffer.alloc(1), 0, 1, offset) !== 0 || !isDeepStrictEqual(before, verifyHeld(entry))) fail("file_changed");
  return bytes;
}
function fileHeld(file, handles, cap, privateMode = false) {
  const before = node(file, false, privateMode);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(fd);
  const entry = { file, fd, before, directory: false, privateMode }; const bytes = readHeld(entry, cap);
  return { ...entry, bytes };
}
function streamHash(entry) {
  const before = verifyHeld(entry); if (before.size < 1 || before.size > CAP) fail("bundle_invalid");
  const hash = createHash("sha256"); const buffer = Buffer.alloc(1024 * 1024); let offset = 0;
  while (offset < before.size) {
    const count = readSync(entry.fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
    if (count < 1) fail("file_changed"); hash.update(buffer.subarray(0, count)); offset += count;
  }
  if (readSync(entry.fd, buffer, 0, 1, offset) !== 0 || !isDeepStrictEqual(before, verifyHeld(entry))) fail("file_changed");
  return { sha256: hash.digest("hex"), size: before.size };
}
function closeAll(handles) {
  let failed = false; for (const fd of handles.splice(0).reverse()) { try { closeSync(fd); } catch { failed = true; } }
  if (failed) fail("cleanup_uncertain");
}
function ancestors(file, handles) {
  const result = []; let current = path.dirname(file);
  for (;;) {
    const name = current;
    const s = lstatSync(current, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(current) !== current || ![0n, 1000n].includes(s.uid)
      || (s.mode & 0o0022n) !== 0n && (s.mode & 0o1000n) === 0n) fail("storage_invalid");
    const fd = openSync(current, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(fd);
    const fixed = [s.dev, s.ino, s.uid, s.gid, s.mode];
    result.push(() => { const a = fstatSync(fd, { bigint: true }); const b = lstatSync(name, { bigint: true });
      if (!b.isDirectory() || b.isSymbolicLink() || realpathSync(name) !== name
        || !isDeepStrictEqual(fixed, [a.dev, a.ino, a.uid, a.gid, a.mode])
        || !isDeepStrictEqual(fixed, [b.dev, b.ino, b.uid, b.gid, b.mode])) fail("source_changed"); });
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return () => result.forEach((verify) => verify());
}
function processProof(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8"); const end = text.lastIndexOf(")");
  const fields = text.slice(end + 2).trim().split(/\s+/u);
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const ids = [...status.matchAll(/^(?:Uid|Gid):\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/gmu)];
  if (end < 1 || fields.length < 20 || !/^[0-9]+$/u.test(fields[19]) || fields[2] !== String(pid)
    || ids.length !== 2 || ids.some((v) => v.slice(1).some((id) => id !== "1000"))) fail("git_cleanup_uncertain");
  return fields[19];
}
async function defaultCommand(request) {
  return await new Promise((resolve, reject) => {
    let child; let proof; let failure; let closed = false; let stdoutSize = 0; let stderrSize = 0;
    const output = []; const errors = []; let escalation; let cleanupDeadline; let settled = false;
    const stop = (value) => {
      failure ??= value;
      if (!child?.pid || closed) return;
      cleanupDeadline ??= setTimeout(() => { if (!closed && !settled) {
        settled = true; child.stdout.destroy(); child.stderr.destroy(); child.unref();
        request.signal?.removeEventListener("abort", abort); globalThis.clearTimeout(timer);
        if (diskTimer) globalThis.clearInterval(diskTimer);
        reject(new Error(`${PREFIX}git_cleanup_uncertain`));
      } }, 25_000);
      try {
        if (proof === undefined || processProof(child.pid) !== proof) throw new Error();
        process.kill(-child.pid, "SIGTERM");
        escalation ??= setTimeout(() => { if (!closed) {
          try { if (processProof(child.pid) !== proof) throw new Error(); process.kill(-child.pid, "SIGKILL"); }
          catch { failure = "git_cleanup_uncertain"; }
        } }, 1000);
      } catch { if (!closed) failure = "git_cleanup_uncertain"; }
    };
    try { child = spawn(GIT, request.args, { cwd: request.cwd, env: ENV, stdio: ["ignore", "pipe", "pipe"], detached: true, windowsHide: true });
    } catch { reject(new Error(`${PREFIX}git_failed`)); return; }
    try { if (child.pid) proof = processProof(child.pid); } catch { /* A fast command may already have exited; only its close event can confirm success. */ }
    const timer = setTimeout(() => stop("deadline_exceeded"), request.timeoutMs);
    const diskTimer = request.diskGuard ? globalThis.setInterval(() => { try { request.diskGuard(); } catch (error) { stop(reason(error)); } }, 100) : undefined;
    const abort = () => stop("aborted"); request.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () => { failure ??= "git_failed"; });
    child.stdout.on("data", (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > request.cap) { stop("git_output_exceeded"); return; }
      if (failure) return;
      try {
        if (request.stdoutFd === undefined) output.push(chunk);
        else { let offset = 0; while (offset < chunk.length) { const n = writeSync(request.stdoutFd, chunk, offset, chunk.length - offset); if (n < 1) throw new Error(); offset += n; } }
      } catch { stop("git_failed"); }
    });
    child.stderr.on("data", (chunk) => { stderrSize += chunk.length;
      if (stderrSize > 1024 * 1024) stop("git_output_exceeded"); else errors.push(chunk); });
    child.on("close", (status, signal) => {
      closed = true; globalThis.clearTimeout(timer); if (escalation) globalThis.clearTimeout(escalation);
      if (diskTimer) globalThis.clearInterval(diskTimer);
      if (cleanupDeadline) globalThis.clearTimeout(cleanupDeadline);
      request.signal?.removeEventListener("abort", abort);
      if (settled) return; settled = true;
      if (failure) reject(new Error(`${PREFIX}${failure}`));
      else resolve({ status, signal, stdout: Buffer.concat(output), stderr: Buffer.concat(errors), closed: true });
    });
    if (request.signal?.aborted) abort();
  });
}
function transport(input, dependencies) {
  if (!exact(dependencies, Object.hasOwn(dependencies, "commandRunner") ? ["commandRunner"] : [])
    || dependencies.commandRunner !== undefined && typeof dependencies.commandRunner !== "function") fail("arguments_invalid");
  let diskGuard; let sourceGuard;
  const run = async (args, cwd, cap = STATIC_CAP, stdoutFd) => {
    check(input); sourceGuard?.(); diskGuard?.(); const request = { args: [...ARGS, ...args], cwd, cap, timeoutMs: Math.min(90_000, input.deadline - Date.now()), signal: input.signal, stdoutFd, diskGuard };
    const r = await (dependencies.commandRunner ? dependencies.commandRunner(request, defaultCommand) : defaultCommand(request));
    check(input); sourceGuard?.(); diskGuard?.();
    if (!exact(r, ["status", "signal", "stdout", "stderr", "closed"]) || r.closed !== true || r.status !== 0 || r.signal !== null
      || !Buffer.isBuffer(r.stdout) || !Buffer.isBuffer(r.stderr) || r.stdout.length > cap || r.stderr.length > 1024 * 1024) fail("git_failed");
    return r.stdout;
  };
  run.guardDisk = (aux) => { diskGuard = aux ? () => diskBudget(aux) : undefined; };
  run.guardSource = (guard) => { sourceGuard = guard; }; return run;
}
function text(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
async function sourceSnapshot(input, run, handles) {
  const workspace = directoryHeld(input.workspace, handles); const guards = ancestors(input.workspace, handles);
  const gitDirectory = path.join(input.workspace, ".git");
  if (!lstatSync(gitDirectory).isDirectory() || present(path.join(gitDirectory, "commondir"))) fail("source_invalid");
  const gitDir = directoryHeld(gitDirectory, handles); const commonDirectory = gitDirectory; const contextFiles = [];
  const common = directoryHeld(commonDirectory, handles); const gitGuards = ancestors(gitDirectory, handles); const commonGuards = ancestors(commonDirectory, handles);
  const sourceTrees = ["objects", "refs"].map((name) => {
    const root = path.join(commonDirectory, name);
    try { return { root, before: tree(root) }; } catch { fail("source_invalid"); }
  });
  const binaryFd = openSync(GIT, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(binaryFd);
  const binary = fstatSync(binaryFd, { bigint: true });
  if (!binary.isFile() || binary.uid !== 0n || binary.gid !== 0n || binary.nlink !== 1n || (binary.mode & 0o7022n) !== 0n
    || (binary.mode & 0o111n) === 0n || realpathSync(GIT) !== GIT || !isDeepStrictEqual(identity(binary), identity(lstatSync(GIT, { bigint: true })))) fail("git_invalid");
  const binaryIdentity = identity(binary);
  const verifyBinary = () => { if (!isDeepStrictEqual(binaryIdentity, identity(fstatSync(binaryFd, { bigint: true })))
    || !isDeepStrictEqual(binaryIdentity, identity(lstatSync(GIT, { bigint: true }))) || realpathSync(GIT) !== GIT) fail("git_invalid"); };
  for (const root of [commonDirectory]) {
    for (const name of ["shallow", "info/grafts", "objects/info/alternates", "objects/info/http-alternates"])
      if (present(path.join(root, name))) fail("source_invalid");
    const replacements = path.join(root, "refs/replace"); if (present(replacements) && readdirSync(replacements).length) fail("source_invalid");
    const packed = path.join(root, "packed-refs"); if (present(packed)) {
      const held = fileHeld(packed, handles, STATIC_CAP); contextFiles.push(held);
      if (/\srefs\/replace\//u.test(text(held.bytes))) fail("source_invalid");
    }
    const packs = path.join(root, "objects/pack"); if (present(packs) && readdirSync(packs).some((v) => v.endsWith(".promisor"))) fail("source_invalid");
    for (const name of ["config", "config.worktree"]) {
      const file = path.join(root, name); if (!present(file)) continue;
      const held = fileHeld(file, handles, 65536); contextFiles.push(held);
      if (/^\s*\[\s*include(?:if)?\b/imu.test(text(held.bytes))) fail("source_invalid");
      const values = text(await run(["config", "--file", file, "--no-includes", "--null", "--list"], input.directory, 65536));
      for (const item of values.split("\0").filter(Boolean)) {
        const key = item.split("\n", 1)[0].toLowerCase();
        if (key.startsWith("filter.")) fail("source_invalid");
        if (/^(?:include(?:if)?\.|extensions\.(?:partialclone|objectformat|worktreeconfig)|remote\..*\.(?:promisor|partialclonefilter)|core\.repositoryformatversion$)/u.test(key)
          && !(key === "core.repositoryformatversion" && item === `${key}\n0`)) fail("source_invalid");
      }
    }
  }
  const safety = () => {
    guards(); gitGuards(); commonGuards(); verifyHeld(workspace); verifyHeld(gitDir); verifyHeld(common); verifyBinary();
    for (const item of sourceTrees) { let observed;
      try { observed = tree(item.root); } catch { fail("source_invalid"); }
      if (!isDeepStrictEqual(item.before, observed)) fail("source_changed");
    }
    if (present(path.join(gitDirectory, "commondir"))) fail("source_invalid");
    for (const name of ["shallow", "info/grafts", "objects/info/alternates", "objects/info/http-alternates"])
      if (present(path.join(commonDirectory, name))) fail("source_invalid");
    const replacements = path.join(commonDirectory, "refs/replace");
    if (present(replacements) && readdirSync(replacements).length) fail("source_invalid");
    const packs = path.join(commonDirectory, "objects/pack");
    if (present(packs) && readdirSync(packs).some((v) => v.endsWith(".promisor"))) fail("source_invalid");
    for (const held of contextFiles) if (!readHeld(held, STATIC_CAP).equals(held.bytes)) fail("source_changed");
  };
  run.guardSource(safety);
  if (text(await run(["--version"], input.directory, 1024)) !== "git version 2.43.0\n") fail("git_invalid");
  if (text(await run(["rev-parse", "--absolute-git-dir"], input.workspace, 4096)) !== `${gitDirectory}\n`
    || path.resolve(input.workspace, text(await run(["rev-parse", "--git-common-dir"], input.workspace, 4096)).trim()) !== commonDirectory
    || text(await run(["rev-parse", "--is-shallow-repository"], input.workspace, 1024)) !== "false\n") fail("source_invalid");
  const fixedFiles = [];
  for (const pin of input.blobPins.filter((v) => v.recipeRevision === input.recipeRevision)) {
    const file = fileHeld(path.join(input.workspace, pin.path), handles, pin.size); const fileGuards = ancestors(file.file, handles);
    if (file.bytes.length !== pin.size || digest(file.bytes) !== pin.sha256) fail("blob_invalid");
    fixedFiles.push({ pin, file, guards: fileGuards });
  }
  for (const name of ["HEAD", "index"]) { const file = path.join(gitDirectory, name);
    if (present(file)) contextFiles.push(fileHeld(file, handles, STATIC_CAP)); }
  const head = text(await run(["rev-parse", "--verify", "HEAD"], input.workspace, 1024)).trim();
  if (!rev(head) || input.recipeRevision !== undefined && head !== input.recipeRevision) fail("source_changed");
  const sourceRefs = await run(["for-each-ref", "--format=%(refname) %(objectname)"], input.workspace);
  const verify = async () => {
    guards(); gitGuards(); commonGuards(); verifyHeld(workspace); verifyHeld(gitDir); verifyHeld(common); verifyBinary();
    for (const held of contextFiles) if (!readHeld(held, STATIC_CAP).equals(held.bytes)) fail("source_changed");
    for (const { file, pin, guards: guard } of fixedFiles) { guard(); if (digest(readHeld(file, pin.size)) !== pin.sha256) fail("source_changed"); }
    if (text(await run(["rev-parse", "--verify", "HEAD"], input.workspace, 1024)) !== `${head}\n`
      || !(await run(["for-each-ref", "--format=%(refname) %(objectname)"], input.workspace)).equals(sourceRefs)
      || (await run(["status", "--porcelain=v1", "--untracked-files=all"], input.workspace)).length !== 0) fail("source_changed");
    guards(); verifyBinary();
  };
  await verify();
  return { verify, proof: { head, workspace: input.workspace, gitDirectory, commonDirectory, refsSha256: digest(sourceRefs),
    workspaceIdentity: workspace.before, gitDirectoryIdentity: gitDir.before, commonDirectoryIdentity: common.before,
    files: fixedFiles.map(({ pin, file }) => ({ path: pin.path, size: pin.size, sha256: pin.sha256, identity: file.before })) } };
}
function auxiliary(input, handles) {
  node(path.dirname(input.directory), true, true);
  const fs = statfsSync(input.directory, { bigint: true });
  if (fs.type !== 0xef53n) fail("storage_invalid");
  if (fs.bavail * fs.bsize < BigInt(2 * 1024 * 1024 * 1024)) fail("capacity_insufficient");
  const file = mkdtempSync(path.join(path.dirname(input.directory), ".postgres-source-bundle-work-"));
  const before = directoryHeld(file, handles, true); const template = path.join(file, "template"); mkdirSync(template, { mode: 0o700 });
  return { file, before, template };
}
function tree(root) {
  const result = new Map();
  const visit = (file) => {
    const s = lstatSync(file, { bigint: true });
    if (s.isSymbolicLink() || !s.isFile() && !s.isDirectory() || s.uid !== 1000n || s.gid !== 1000n
      || (s.mode & 0o7022n) !== 0n || s.isFile() && s.nlink !== 1n || realpathSync(file) !== file) fail("cleanup_uncertain");
    result.set(file, { identity: identity(s), directory: s.isDirectory() });
    if (s.isDirectory()) for (const name of readdirSync(file).sort()) visit(path.join(file, name));
  }; visit(root); return result;
}
function diskBudget(aux) {
  verifyHeld(aux.before, false); const inventory = tree(aux.file);
  if (inventory.size > 100000) fail("capacity_insufficient");
  for (const repo of ["collect.git", "verify.git"]) {
    const prefix = `${path.join(aux.file, repo)}/`; let total = 0;
    for (const [file, v] of inventory) if (file.startsWith(prefix) && !v.directory) total += v.identity.size;
    if (total > CAP) fail("capacity_insufficient");
  }
}
function allowedAuxiliary(file, root, directory) {
  const relative = path.posix.relative(root, file); if (relative === "") return directory;
  if (relative === "template") return directory;
  const match = /^(collect\.git|verify\.git)(?:\/(.*))?$/u.exec(relative); if (!match) return false;
  const leaf = match[2] ?? "";
  if (directory) return leaf === "" || /^(?:objects(?:\/(?:info|pack|[0-9a-f]{2}))?|refs(?:\/(?:heads|tags|archive))?)$/u.test(leaf);
  return ["HEAD", "config"].includes(leaf) || /^objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/u.test(leaf)
    || /^objects\/pack\/pack-[0-9a-f]{40}\.(?:pack|idx|rev)$/u.test(leaf)
    || /^refs\/archive\/(?:head|publication|audit|runtime|retention|copy|cold|sql)$/u.test(leaf);
}
function cleanup(aux) {
  verifyHeld(aux.before, false); const known = tree(aux.file); if (known.size > 100000) fail("cleanup_uncertain");
  for (const [file, v] of known) if (!allowedAuxiliary(file, aux.file, v.directory)) fail("cleanup_uncertain");
  if (!isDeepStrictEqual(known, tree(aux.file))) fail("cleanup_uncertain");
  for (const [file, expected] of [...known].reverse()) {
    const current = lstatSync(file, { bigint: true }); const fixed = ["dev", "ino", "uid", "gid", "mode"];
    if (current.isSymbolicLink() || current.isDirectory() !== expected.directory
      || fixed.some((v) => identity(current)[v] !== expected.identity[v]) || !expected.directory && current.nlink !== 1n) fail("cleanup_uncertain");
    if (expected.directory) { if (readdirSync(file).length !== 0) fail("cleanup_uncertain"); rmdirSync(file); }
    else unlinkSync(file);
  }
  if (present(aux.file)) fail("cleanup_uncertain");
}
const refs = (input) => ROLES.map((role) => ({ name: `refs/archive/${role}`, commit: role === "head" ? input.recipeRevision : input.recipes[role] }));
async function init(run, aux, name) {
  const directory = path.join(aux.file, name);
  await run(["init", "--quiet", "--bare", "--object-format=sha1", `--template=${aux.template}`, directory], aux.file);
  node(directory, true); return directory;
}
function header(entry, expected) {
  const buffer = Buffer.alloc(65536); const size = readSync(entry.fd, buffer, 0, buffer.length, 0); const bytes = buffer.subarray(0, size);
  const end = bytes.indexOf("\n\n"); if (end < 0) fail("bundle_invalid");
  const lines = text(bytes.subarray(0, end)).split("\n");
  if (lines.shift() !== "# v2 git bundle" || lines.length !== 8 || lines.some((v) => v.startsWith("-") || v.startsWith("@"))) fail("bundle_invalid");
  const entries = lines.map((line) => { const match = /^([0-9a-f]{40}) (refs\/archive\/[a-z]+)$/u.exec(line);
    if (!match) fail("bundle_invalid"); return { commit: match[1], name: match[2] }; });
  if (!isDeepStrictEqual(entries.sort((a, b) => a.name.localeCompare(b.name)), [...expected].sort((a, b) => a.name.localeCompare(b.name)))) fail("bundle_invalid");
}
async function verifyBundle(input, run, aux, entry) {
  const expected = refs(input); header(entry, expected); const directory = await init(run, aux, "verify.git");
  await run(["-C", directory, "bundle", "verify", "--quiet", entry.file], aux.file, 65536);
  const listed = text(await run(["bundle", "list-heads", entry.file], directory, 65536)).trim().split("\n").sort();
  if (!isDeepStrictEqual(listed, expected.map((v) => `${v.commit} ${v.name}`).sort())) fail("bundle_invalid");
  await run(["-C", directory, "-c", "fetch.fsckObjects=true", "fetch", "--quiet", "--atomic", "--no-tags", "--no-write-fetch-head",
    "--no-auto-maintenance", "--no-write-commit-graph", "--no-recurse-submodules", entry.file, ...expected.map((v) => `${v.name}:${v.name}`)], aux.file);
  await run(["-C", directory, "fsck", "--full", "--strict", "--no-reflogs", "--no-dangling", "--no-progress"], aux.file);
  const actual = text(await run(["-C", directory, "for-each-ref", "--format=%(objectname) %(refname)"], aux.file, 65536)).trim().split("\n").sort();
  if (!isDeepStrictEqual(actual, listed)) fail("bundle_invalid");
  for (const ref of expected) if (text(await run(["-C", directory, "cat-file", "-t", ref.commit], aux.file, 1024)) !== "commit\n") fail("bundle_invalid");
  const blobs = [];
  for (const pin of input.blobPins) {
    check(input); const blob = text(await run(["-C", directory, "rev-parse", "--verify", `${pin.recipeRevision}:${pin.path}`], aux.file, 1024)).trim();
    if (!rev(blob) || text(await run(["-C", directory, "cat-file", "-t", blob], aux.file, 1024)) !== "blob\n") fail("blob_invalid");
    const bytes = await run(["-C", directory, "cat-file", "blob", blob], aux.file, pin.size);
    if (bytes.length !== pin.size || digest(bytes) !== pin.sha256) fail("blob_invalid");
    blobs.push({ ...pin, blob });
  }
  return blobs;
}
export function validatePostgresPrivateEvidenceSourceBundleProof(proof, input) {
  try {
    inputValid(input); const expected = refs(input);
    if (!exact(proof, PROOF) || proof.kind !== "POSTGRES_PRIVATE_EVIDENCE_SOURCE_BUNDLE_V1" || proof.state !== "VERIFIED"
      || proof.recipeRevision !== input.recipeRevision || proof.zeroPrerequisites !== true || proof.packVerification !== "OFFLINE_FULL_FSCK"
      || proof.sourceUnchanged !== true || proof.auxiliaryCleanup !== "REMOVED" || !exact(proof.source, SOURCE)
      || proof.source.head !== input.recipeRevision || proof.source.workspace !== input.workspace || !absolute(proof.source.gitDirectory)
      || proof.source.gitDirectory !== `${input.workspace}/.git` || proof.source.commonDirectory !== proof.source.gitDirectory || !hex(proof.source.refsSha256)
      || ![proof.source.workspaceIdentity, proof.source.gitDirectoryIdentity, proof.source.commonDirectoryIdentity].every((v) => metadata(v))
      || !exact(proof.file, ["name", "size", "sha256", "identity"]) || proof.file.name !== "recipes.bundle"
      || !hex(proof.file.sha256) || !Number.isSafeInteger(proof.file.size) || proof.file.size < 1 || proof.file.size > CAP
      || !metadata(proof.file.identity, true) || proof.file.identity.mode !== 0o600 || proof.file.identity.size !== proof.file.size
      || !isDeepStrictEqual(proof.refs, expected) || !Array.isArray(proof.blobs) || proof.blobs.length !== input.blobPins.length
      || !Array.isArray(proof.source.files)) fail("proof_invalid");
    for (const [i, pin] of input.blobPins.entries()) { const blob = proof.blobs[i];
      if (!exact(blob, ["recipeRevision", "path", "sha256", "size", "blob"]) || !rev(blob.blob)
        || Object.keys(pin).some((key) => blob[key] !== pin[key])) fail("proof_invalid"); }
    const files = input.blobPins.filter((v) => v.recipeRevision === input.recipeRevision);
    if (proof.source.files.length !== files.length) fail("proof_invalid");
    for (const [i, pin] of files.entries()) { const file = proof.source.files[i];
      if (!exact(file, ["path", "size", "sha256", "identity"]) || file.path !== pin.path || file.size !== pin.size || file.sha256 !== pin.sha256
        || !metadata(file.identity, true) || file.identity.size !== pin.size) fail("proof_invalid"); }
    return freeze(globalThis.structuredClone(proof));
  } catch { fail("proof_invalid"); }
}
async function operate(input, dependencies, existing) {
  const handles = []; let result; let failure;
  try {
    actor(input); input = Object.freeze({ ...input, recipes: freeze({ ...input.recipes }), blobPins: freeze(input.blobPins.map((pin) => ({ ...pin }))) });
    const run = transport(input, dependencies); const output = directoryHeld(input.directory, handles, true);
    const outputGuards = ancestors(input.directory, handles);
    if (!isDeepStrictEqual(readdirSync(input.directory).sort(), existing ? ["recipes.bundle"] : [])) fail("storage_invalid");
    const source = await sourceSnapshot(input, run, handles); const aux = auxiliary(input, handles); run.guardDisk(aux);
    let entry;
    if (existing) { const file = path.join(input.directory, "recipes.bundle"); const before = node(file, false, true);
      const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(fd);
      entry = { file, fd, before, directory: false, privateMode: true }; verifyHeld(entry);
    } else {
      const collect = await init(run, aux, "collect.git");
      await run(["-C", collect, "-c", "fetch.fsckObjects=true", "fetch", "--quiet", "--atomic", "--no-tags", "--no-write-fetch-head",
        "--no-auto-maintenance", "--no-write-commit-graph", "--no-recurse-submodules", `--upload-pack=${UPLOAD}`,
        `file://${source.proof.commonDirectory}`, ...refs(input).map((v) => `${v.commit}:${v.name}`)], aux.file);
      const file = path.join(input.directory, "recipes.bundle");
      const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(fd); fchmodSync(fd, 0o600);
      const initial = node(file, false, true); if (initial.size !== 0 || !isDeepStrictEqual(initial, identity(fstatSync(fd, { bigint: true })))) fail("file_invalid");
      await run(["-C", collect, "bundle", "create", "--quiet", "--version=2", "-", ...refs(input).map((v) => v.name)], aux.file, CAP, fd);
      fsyncSync(fd); entry = { file, fd, before: node(file, false, true), directory: false, privateMode: true };
    }
    const file = streamHash(entry); if (existing && (!isDeepStrictEqual(entry.before, existing.file.identity)
      || file.sha256 !== existing.file.sha256 || file.size !== existing.file.size || !isDeepStrictEqual(source.proof, existing.source))) fail("proof_invalid");
    const blobs = await verifyBundle(input, run, aux, entry); outputGuards(); verifyHeld(output, false); await source.verify();
    if (!isDeepStrictEqual(file, streamHash(entry)) || !isDeepStrictEqual(readdirSync(input.directory), ["recipes.bundle"])) fail("file_changed");
    cleanup(aux); run.guardDisk(); await source.verify(); outputGuards(); verifyHeld(output, false);
    if (!isDeepStrictEqual(file, streamHash(entry))) fail("file_changed"); check(input);
    result = validatePostgresPrivateEvidenceSourceBundleProof({ kind: "POSTGRES_PRIVATE_EVIDENCE_SOURCE_BUNDLE_V1", state: "VERIFIED",
      recipeRevision: input.recipeRevision, source: source.proof, file: { name: "recipes.bundle", ...file, identity: entry.before },
      refs: refs(input), blobs, zeroPrerequisites: true, packVerification: "OFFLINE_FULL_FSCK", sourceUnchanged: true, auxiliaryCleanup: "REMOVED" }, input);
    if (existing && !isDeepStrictEqual(result, existing)) fail("proof_invalid");
  } catch (error) { failure = reason(error); }
  try { closeAll(handles); } catch { failure = "cleanup_uncertain"; }
  if (failure) fail(failure); return result;
}
export async function createPostgresPrivateEvidenceSourceBundle(input, dependencies = {}) { return await operate(input, dependencies); }
export async function validatePostgresPrivateEvidenceSourceBundle(proof, input, dependencies = {}) {
  const expected = validatePostgresPrivateEvidenceSourceBundleProof(proof, input); return await operate(input, dependencies, expected);
}
export async function inspectPostgresPrivateEvidenceSource(input, dependencies = {}) {
  const handles = []; let proof; let failure;
  try {
    if (!exact(input, ["workspace", "deadline", ...(Object.hasOwn(input ?? {}, "signal") ? ["signal"] : [])])
      || !absolute(input.workspace) || !Number.isSafeInteger(input.deadline)
      || input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
    if (process.platform !== "linux" || process.getuid?.() !== 1000 || process.getgid?.() !== 1000
      || process.geteuid?.() !== 1000 || process.getegid?.() !== 1000 || input.deadline - Date.now() > MAX_DURATION) fail("context_invalid");
    check(input); const expanded = { ...input, directory: input.workspace, blobPins: [] };
    const source = await sourceSnapshot(expanded, transport(expanded, dependencies), handles); await source.verify(); proof = freeze(source.proof);
  } catch (error) { failure = reason(error); }
  try { closeAll(handles); } catch { failure = "cleanup_uncertain"; }
  if (failure) fail(failure); return proof;
}
