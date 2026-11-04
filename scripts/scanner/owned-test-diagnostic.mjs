import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const MiB = 1024 ** 2;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const MAX_LINE_BYTES = 4 * 1024;
const MAX_PACKAGES = 8;
const MAX_TESTS = 16;
const PROCESS_CLASSES = new Set(["NONZERO_EXIT", "SIGNAL", "TIMEOUT", "OUTPUT_LIMIT", "SPAWN_ERROR", "UNKNOWN"]);
const CONTAINER_STATUSES = new Set(["created", "running", "paused", "restarting", "removing", "exited", "dead"]);
const PHASE_PREFIXES = Object.freeze([
  Object.freeze({ text: "SETUP\n", phase: "SETUP" }),
  Object.freeze({ text: "SETUP\nMAGE_INSTALL\n", phase: "MAGE_INSTALL" }),
  Object.freeze({ text: "SETUP\nMAGE_INSTALL\nUNIT_TESTS\n", phase: "UNIT_TESTS" }),
  Object.freeze({ text: "SETUP\nMAGE_INSTALL\nUNIT_TESTS\nCOMPLETE\n", phase: "COMPLETE" })
]);
const sourceAllowlists = new WeakMap();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const emptyOutput = (capture = "UNAVAILABLE") => Object.freeze({ capture, observedFailedPackages: [], observedFailedTopLevelTests: [], observedFixedTokens: [], truncated: false });
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function validateProcessDiagnostic(value) {
  if (!exactKeys(value, ["hostOperation", "process", "container"]) || value.hostOperation !== "DOCKER_START_ATTACH" ||
      !exactKeys(value.process, ["class", "status", "stdoutBytes", "stderrBytes"]) || !PROCESS_CLASSES.has(value.process.class) ||
      value.process.status !== null && (!Number.isSafeInteger(value.process.status) || value.process.status < 0 || value.process.status > 255) ||
      !Number.isSafeInteger(value.process.stdoutBytes) || value.process.stdoutBytes < 0 || value.process.stdoutBytes > 8 * MiB ||
      !Number.isSafeInteger(value.process.stderrBytes) || value.process.stderrBytes < 0 || value.process.stderrBytes > 8 * MiB ||
      !exactKeys(value.container, ["observation", "status", "exitCode", "oomKilled"])) return null;
  if (value.container.observation === "UNAVAILABLE") {
    if (value.container.status !== null || value.container.exitCode !== null || value.container.oomKilled !== null) return null;
  } else if (value.container.observation !== "OBSERVED" || !CONTAINER_STATUSES.has(value.container.status) ||
      !Number.isSafeInteger(value.container.exitCode) || value.container.exitCode < 0 || value.container.exitCode > 255 || typeof value.container.oomKilled !== "boolean") return null;
  return value;
}

export function readOwnedChildPhase(file) {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 128) return "UNKNOWN";
    const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
    return PHASE_PREFIXES.find(({ text: expected }) => expected === text)?.phase ?? "UNKNOWN";
  } catch { return "UNKNOWN"; }
}

function collectSourceAllowlist(sourceRoot) {
  const packages = new Set();
  const tests = new Set();
  let files = 0; let bytes = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const target = path.join(directory, entry.name);
      const info = lstatSync(target);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory() && entry.isDirectory()) { visit(target); continue; }
      if (!info.isFile() || !entry.isFile() || !entry.name.endsWith(".go")) continue;
      files += 1; bytes += info.size;
      if (files > 20_000 || bytes > 1024 * MiB) throw new Error("scanner_owned_diagnostic_source_limit");
      const relativeDirectory = path.relative(sourceRoot, directory).split(path.sep).join("/");
      packages.add(relativeDirectory ? `github.com/aquasecurity/trivy/${relativeDirectory}` : "github.com/aquasecurity/trivy");
      if (!entry.name.endsWith("_test.go") || info.size > 8 * MiB) continue;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(target)).replaceAll("\r\n", "\n");
      for (const match of text.matchAll(/^func (Test[A-Za-z0-9_]{1,127})\s*\(/gmu)) tests.add(match[1]);
    }
  };
  visit(sourceRoot);
  return { packages, tests };
}

export function createOwnedTestSourceAllowlist(sourceRoot) {
  const token = Object.freeze({});
  try { sourceAllowlists.set(token, collectSourceAllowlist(sourceRoot)); }
  catch { sourceAllowlists.set(token, null); }
  return token;
}

function parseFailureOutput(bytes, allowlist, processClass) {
  if (processClass === "OUTPUT_LIMIT") return emptyOutput("LIMIT_EXCEEDED");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return emptyOutput("MALFORMED"); }
  if (text.includes("\0") || /\r(?!\n)/u.test(text)) return emptyOutput("MALFORMED");
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (lines.some((line) => Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES)) return emptyOutput("MALFORMED");
  const packages = new Set(); const tests = new Set(); const tokens = new Set();
  for (const line of lines) {
    const test = /^--- FAIL: (Test[A-Za-z0-9_]{1,127})(?:\/[^\s()]*)? \([0-9]+(?:\.[0-9]+)?s\)$/u.exec(line);
    if (test && allowlist.tests.has(test[1])) tests.add(test[1]);
    const packageFailure = /^FAIL\t([^\s]+)(?:\t[0-9]+(?:\.[0-9]+)?s| \[(?:build|setup) failed\])$/u.exec(line);
    if (packageFailure && allowlist.packages.has(packageFailure[1])) packages.add(packageFailure[1]);
  }
  const fixed = [["NO_SPACE_LEFT_ON_DEVICE", "no space left on device"], ["EXECUTABLE_FILE_NOT_FOUND", "executable file not found"], ["SIGNAL_KILLED", "signal: killed"]];
  for (const [name, literal] of fixed) if (normalized.includes(literal)) tokens.add(name);
  const sortedPackages = [...packages].sort(); const sortedTests = [...tests].sort();
  const truncated = sortedPackages.length > MAX_PACKAGES || sortedTests.length > MAX_TESTS;
  return Object.freeze({ capture: truncated ? "TRUNCATED" : "COMPLETE", observedFailedPackages: sortedPackages.slice(0, MAX_PACKAGES),
    observedFailedTopLevelTests: sortedTests.slice(0, MAX_TESTS), observedFixedTokens: [...tokens].sort(), truncated });
}

function privateLogEvidence(file) {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 16 * MiB) return { evidence: { observed: false, bytes: null, sha256: null }, bytes: null };
    const bytes = readFileSync(file);
    return { evidence: { observed: true, bytes: bytes.length, sha256: sha256(bytes) }, bytes };
  } catch { return { evidence: { observed: false, bytes: null, sha256: null }, bytes: null }; }
}

export function buildOwnedTestFailureDiagnostic({ processDiagnostic, sourceAllowlist, phaseFile, logFile }) {
  const diagnostic = validateProcessDiagnostic(processDiagnostic);
  if (!diagnostic) return null;
  const privateLog = privateLogEvidence(logFile);
  let output = emptyOutput();
  if (diagnostic.process.class === "OUTPUT_LIMIT") output = emptyOutput("LIMIT_EXCEEDED");
  else if (privateLog.bytes) {
    try {
      const allowlist = sourceAllowlists.get(sourceAllowlist);
      output = allowlist ? parseFailureOutput(privateLog.bytes, allowlist, diagnostic.process.class) : emptyOutput("UNAVAILABLE");
    }
    catch { output = emptyOutput("UNAVAILABLE"); }
  }
  const value = Object.freeze({ schemaVersion: 1, kind: "OWNED_SCANNER_TEST_FAILURE_DIAGNOSTIC_V1", authority: "DIAGNOSTIC_ONLY",
    hostOperation: diagnostic.hostOperation, process: diagnostic.process, container: diagnostic.container,
    childPhase: readOwnedChildPhase(phaseFile), privateLog: Object.freeze(privateLog.evidence), output });
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_DIAGNOSTIC_BYTES) return null;
  return value;
}
