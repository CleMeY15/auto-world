import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm,
  symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";

import {
  TEST_ONLY_CHILD_OPERATIONS as childOperations,
  TEST_ONLY_LIMITS as limits,
  TEST_ONLY_assessHelp as assessHelp,
  TEST_ONLY_canonicalJson as canonicalJson,
  TEST_ONLY_cleanupOwnedState as cleanupOwnedState,
  TEST_ONLY_downloadBytes as downloadBytes,
  TEST_ONLY_executeActor as rawExecuteActor,
  TEST_ONLY_materializeObservation as rawMaterializeObservation,
  TEST_ONLY_main as run,
  TEST_ONLY_notRunEvidence as notRunEvidence,
  TEST_ONLY_parseKeyManifest as parseKeyManifest,
  TEST_ONLY_parseQuery as parseQuery,
  TEST_ONLY_parseRegularManifest as parseRegularManifest,
  TEST_ONLY_parseSecdb as parseSecdb,
  TEST_ONLY_parseTransaction as parseTransaction,
  TEST_ONLY_privateTreeBytes as privateTreeBytes,
  TEST_ONLY_publicFailure as publicFailure,
  TEST_ONLY_readFailureMarker as readFailureMarker,
  TEST_ONLY_requireContext as requireContext,
  TEST_ONLY_runCarrier as runCarrier,
  TEST_ONLY_runCommand as runCommand,
  TEST_ONLY_validateCanonicalUrl as validateCanonicalUrl,
  TEST_ONLY_validateCommandResult as validateCommandResult,
  TEST_ONLY_validateEvidence as validateEvidence,
  TEST_ONLY_writeFailureMarker as writeFailureMarker,
} from "../scripts/diagnostics/task005-git-materials-v11.mjs";

const workflowPath = new URL("../.github/workflows/task005-git-materials-v11.yml", import.meta.url);
const actorPath = new URL("../scripts/diagnostics/task005-git-materials-v11.mjs", import.meta.url);
const BASE = "31d6891f6f646737897d9e9dad59a975a73bb9fd";
const HISTORICAL_V9_BASE = "4517b120f1e126dff15e710a34d950694e20eae5";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const MERGE = "89abcdef0123456789abcdef0123456789abcdef";
const FIXTURE_UID = 20_001;
const FIXTURE_GID = 20_002;
const PRIVATE_DIRECTORY_MODE = 0o040700;

// V11_ADDITIONS_HELPERS_BEGIN
const HISTORICAL_V10_BASE = "07922f89a07f1440f30d3564594e02ba2ce22895";

const V11_RAW_LOG_ONLY_GATES = Object.freeze([
  "EVIDENCE_ROOT_SCHEMA", "EVIDENCE_NOT_RUN_SCHEMA", "EVIDENCE_RECEIPT_SCHEMA",
  "EVIDENCE_BOUNDARIES", "EVIDENCE_EXECUTION", "EVIDENCE_SECURITY", "EVIDENCE_INDEX",
  "EVIDENCE_CARRIER", "EVIDENCE_SECDB", "EVIDENCE_MANIFEST_SCHEMA",
  "EVIDENCE_PACKAGE_CARDINALITY", "EVIDENCE_PACKAGE_UNIQUENESS", "EVIDENCE_PACKAGE_VERDICTS",
  "EVIDENCE_PACKAGE_BINDING", "EVIDENCE_PRIVACY",
]);

const V11_BLOCKED_CAPABLE_GATES = Object.freeze([
  "PRIVATE_TREE_SYMLINK", "PRIVATE_TREE_ENTRY_TYPE",
  "KEYS_UTF8", "KEYS_COUNT", "KEYS_RECORD_SCHEMA", "KEYS_DUPLICATE",
  "INSTALLED_BEFORE_UTF8", "INSTALLED_BEFORE_HASH_SCHEMA",
  "INSTALLED_AFTER_UTF8", "INSTALLED_AFTER_HASH_SCHEMA",
  "APK_INDEX_BINDING_UTF8", "APK_INDEX_BINDING_HASH_SCHEMA",
  "QUERY_UTF8", "QUERY_JSON_SYNTAX", "QUERY_ROOT_SCHEMA", "QUERY_CARDINALITY",
  "QUERY_RECORD_STRUCTURE", "QUERY_NAME_TYPE", "QUERY_VERSION_TYPE", "QUERY_ARCHITECTURE",
  "QUERY_FILE_SIZE", "QUERY_INSTALLED_SIZE", "QUERY_LICENSE", "QUERY_ORIGIN",
  "QUERY_MAINTAINER", "QUERY_COMMIT", "QUERY_DEPENDS_SCHEMA", "QUERY_INSTALL_IF_SCHEMA",
  "QUERY_NAME_VERSION_BINDING", "QUERY_DUPLICATE_NAME",
  "APK_MANIFEST_UTF8", "APK_MANIFEST_LINE_GRAMMAR", "APK_MANIFEST_DIGEST_LENGTH",
  "APK_MANIFEST_PATH_SCHEMA", "APK_MANIFEST_EMPTY", "APK_MANIFEST_DUPLICATE_PATH",
  "APK_FILENAME", "APK_DOWNLOAD_SIZE", "APK_INDEX_BINDING_MISMATCH",
  "KEYS_STDERR", "INSTALLED_BEFORE_STDERR", "INDEX_VERIFY_STDERR", "SIMULATE_FIRST_STDERR",
  "QUERY_STDERR", "APK_VERIFY_STDERR", "APK_INDEX_BINDING_STDERR", "APK_MANIFEST_STDERR",
  "SIMULATE_SECOND_STDERR", "INSTALLED_AFTER_STDERR", "VERSION_COMPARE_STDERR",
]);

const V11_PUBLIC_MATERIAL_GATES = Object.freeze([
  ...V11_BLOCKED_CAPABLE_GATES, ...V11_RAW_LOG_ONLY_GATES,
]);

function replaceExact(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one exact anchor, got ${count}`);
  return source.replace(before, after);
}

function reverseV11ActorChanges(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = (values) => values.join(eol);
  const replace = (before, after, label) => {
    source = replaceExact(source, lines(before), lines(after), label);
  };

  replace([
    "const MANIFEST_ALGORITHMS = Object.freeze({ SHA1: \"SHA1\", sha1: \"SHA1\", SHA256: \"SHA256\", sha256: \"SHA256\" });",
    "",
  ], [], "manifest algorithm table");

  replace([
    "const MATERIAL_STDERR_GATES = Object.freeze({",
    "  MATERIAL_KEYS: \"KEYS_STDERR\",",
    "  MATERIAL_INSTALLED_BEFORE: \"INSTALLED_BEFORE_STDERR\",",
    "  MATERIAL_INDEX_VERIFY: \"INDEX_VERIFY_STDERR\",",
    "  MATERIAL_SIMULATE_FIRST: \"SIMULATE_FIRST_STDERR\",",
    "  MATERIAL_QUERY: \"QUERY_STDERR\",",
    "  MATERIAL_APK_VERIFY: \"APK_VERIFY_STDERR\",",
    "  MATERIAL_APK_INDEX_BINDING: \"APK_INDEX_BINDING_STDERR\",",
    "  MATERIAL_APK_MANIFEST: \"APK_MANIFEST_STDERR\",",
    "  MATERIAL_SIMULATE_SECOND: \"SIMULATE_SECOND_STDERR\",",
    "  MATERIAL_INSTALLED_AFTER: \"INSTALLED_AFTER_STDERR\",",
    "  MATERIAL_VERSION_COMPARE: \"VERSION_COMPARE_STDERR\",",
    "});",
    "const MATERIAL_GATES = new Set([",
    "  \"PRIVATE_TREE_SYMLINK\", \"PRIVATE_TREE_ENTRY_TYPE\",",
    "  \"KEYS_UTF8\", \"KEYS_COUNT\", \"KEYS_RECORD_SCHEMA\", \"KEYS_DUPLICATE\",",
    "  \"INSTALLED_BEFORE_UTF8\", \"INSTALLED_BEFORE_HASH_SCHEMA\",",
    "  \"INSTALLED_AFTER_UTF8\", \"INSTALLED_AFTER_HASH_SCHEMA\",",
    "  \"APK_INDEX_BINDING_UTF8\", \"APK_INDEX_BINDING_HASH_SCHEMA\",",
    "  \"QUERY_UTF8\", \"QUERY_JSON_SYNTAX\", \"QUERY_ROOT_SCHEMA\", \"QUERY_CARDINALITY\",",
    "  \"QUERY_RECORD_STRUCTURE\", \"QUERY_NAME_TYPE\", \"QUERY_VERSION_TYPE\", \"QUERY_ARCHITECTURE\",",
    "  \"QUERY_FILE_SIZE\", \"QUERY_INSTALLED_SIZE\", \"QUERY_LICENSE\", \"QUERY_ORIGIN\",",
    "  \"QUERY_MAINTAINER\", \"QUERY_COMMIT\", \"QUERY_DEPENDS_SCHEMA\", \"QUERY_INSTALL_IF_SCHEMA\",",
    "  \"QUERY_NAME_VERSION_BINDING\", \"QUERY_DUPLICATE_NAME\",",
    "  \"APK_MANIFEST_UTF8\", \"APK_MANIFEST_LINE_GRAMMAR\", \"APK_MANIFEST_DIGEST_LENGTH\",",
    "  \"APK_MANIFEST_PATH_SCHEMA\", \"APK_MANIFEST_EMPTY\", \"APK_MANIFEST_DUPLICATE_PATH\",",
    "  \"APK_FILENAME\", \"APK_DOWNLOAD_SIZE\", \"APK_INDEX_BINDING_MISMATCH\",",
    "  \"EVIDENCE_ROOT_SCHEMA\", \"EVIDENCE_NOT_RUN_SCHEMA\", \"EVIDENCE_RECEIPT_SCHEMA\",",
    "  \"EVIDENCE_BOUNDARIES\", \"EVIDENCE_EXECUTION\", \"EVIDENCE_SECURITY\", \"EVIDENCE_INDEX\",",
    "  \"EVIDENCE_CARRIER\", \"EVIDENCE_SECDB\", \"EVIDENCE_MANIFEST_SCHEMA\",",
    "  \"EVIDENCE_PACKAGE_CARDINALITY\", \"EVIDENCE_PACKAGE_UNIQUENESS\", \"EVIDENCE_PACKAGE_VERDICTS\",",
    "  \"EVIDENCE_PACKAGE_BINDING\", \"EVIDENCE_PRIVACY\",",
    "  ...Object.values(MATERIAL_STDERR_GATES),",
    "]);",
    "const BLOCKED_CAPABLE_MATERIAL_GATES = new Set([",
    "  \"PRIVATE_TREE_SYMLINK\", \"PRIVATE_TREE_ENTRY_TYPE\",",
    "  \"KEYS_UTF8\", \"KEYS_COUNT\", \"KEYS_RECORD_SCHEMA\", \"KEYS_DUPLICATE\",",
    "  \"INSTALLED_BEFORE_UTF8\", \"INSTALLED_BEFORE_HASH_SCHEMA\",",
    "  \"INSTALLED_AFTER_UTF8\", \"INSTALLED_AFTER_HASH_SCHEMA\",",
    "  \"APK_INDEX_BINDING_UTF8\", \"APK_INDEX_BINDING_HASH_SCHEMA\",",
    "  \"QUERY_UTF8\", \"QUERY_JSON_SYNTAX\", \"QUERY_ROOT_SCHEMA\", \"QUERY_CARDINALITY\",",
    "  \"QUERY_RECORD_STRUCTURE\", \"QUERY_NAME_TYPE\", \"QUERY_VERSION_TYPE\", \"QUERY_ARCHITECTURE\",",
    "  \"QUERY_FILE_SIZE\", \"QUERY_INSTALLED_SIZE\", \"QUERY_LICENSE\", \"QUERY_ORIGIN\",",
    "  \"QUERY_MAINTAINER\", \"QUERY_COMMIT\", \"QUERY_DEPENDS_SCHEMA\", \"QUERY_INSTALL_IF_SCHEMA\",",
    "  \"QUERY_NAME_VERSION_BINDING\", \"QUERY_DUPLICATE_NAME\",",
    "  \"APK_MANIFEST_UTF8\", \"APK_MANIFEST_LINE_GRAMMAR\", \"APK_MANIFEST_DIGEST_LENGTH\",",
    "  \"APK_MANIFEST_PATH_SCHEMA\", \"APK_MANIFEST_EMPTY\", \"APK_MANIFEST_DUPLICATE_PATH\",",
    "  \"APK_FILENAME\", \"APK_DOWNLOAD_SIZE\", \"APK_INDEX_BINDING_MISMATCH\",",
    "  ...Object.values(MATERIAL_STDERR_GATES),",
    "]);",
    "const materialOperations = CHILD_OPERATIONS.filter((operation) => operation.startsWith(\"MATERIAL_\"));",
    "if (MATERIAL_GATES.size !== 65 || BLOCKED_CAPABLE_MATERIAL_GATES.size !== 50",
    "  || Object.keys(MATERIAL_STDERR_GATES).length !== materialOperations.length",
    "  || materialOperations.some((operation) => !Object.hasOwn(MATERIAL_STDERR_GATES, operation))) {",
    "  throw new Error(\"task005_git_materials_material_gate_contract_invalid\");",
    "}",
    "",
  ], [], "material gate constants");

  replace(["const TRUSTED_MATERIAL_GATES = new WeakMap();", ""], [], "material gate WeakMap");
  replace([
    "function materialFailure(gate) {",
    "  if (!MATERIAL_GATES.has(gate)) throw failure(\"task005_git_materials_cleanup_failed\");",
    "  const error = failure(\"task005_git_materials_material_invalid\");",
    "  TRUSTED_MATERIAL_GATES.set(error, gate);",
    "  return error;",
    "}",
    "",
    "",
  ], [], "material failure helper");
  replace([
    "function trustedMaterialGate(value) {",
    "  if (value === null || typeof value !== \"object\" && typeof value !== \"function\") return undefined;",
    "  return TRUSTED_MATERIAL_GATES.get(value);",
    "}",
    "",
    "function createSafeMaterialRecord(gate) {",
    "  const record = { code: \"task005_git_materials_material_invalid\", materialGate: gate };",
    "  TRUSTED_MATERIAL_GATES.set(record, gate);",
    "  return record;",
    "}",
    "",
    "",
  ], [], "material projection helpers");
  replace([
    "  const materialGate = trustedMaterialGate(error);",
    "  if (code === \"task005_git_materials_material_invalid\" && MATERIAL_GATES.has(materialGate)) {",
    "    return createSafeMaterialRecord(materialGate);",
    "  }",
    "",
  ], [], "safe failure material projection");

  replace(["      if (info.isSymbolicLink()) throw materialFailure(\"PRIVATE_TREE_SYMLINK\");"],
    ["      if (info.isSymbolicLink()) throw failure(\"task005_git_materials_material_invalid\");"],
    "private tree symlink gate");
  replace(["      else throw materialFailure(\"PRIVATE_TREE_ENTRY_TYPE\");"],
    ["      else throw failure(\"task005_git_materials_material_invalid\");"],
    "private tree entry gate");

  replace([
    "function blockedEvidence(error) {",
    "  const record = safeFailureRecord(error);",
    "  if (record.materialGate !== undefined && !BLOCKED_CAPABLE_MATERIAL_GATES.has(record.materialGate)) {",
    "    throw failure(\"task005_git_materials_cleanup_failed\");",
    "  }",
  ], [
    "function blockedEvidence(error) {",
    "  const record = safeFailureRecord(error);",
  ], "blocked evidence persistence guard");
  replace([
    "  const record = safeFailureRecord(error);",
    "  if (record.materialGate !== undefined && !BLOCKED_CAPABLE_MATERIAL_GATES.has(record.materialGate)) {",
    "    throw failure(\"task005_git_materials_cleanup_failed\");",
    "  }",
    "  const value = Buffer.from(canonicalJson(record));",
  ], ["  const value = Buffer.from(canonicalJson(safeFailureRecord(error)));"], "failure marker writer guard");
  replace([
    "    || keys.some((key) => ![\"code\", \"childDiagnostic\", \"nativeErrorCategory\", \"materialGate\"].includes(key))",
  ], [
    "    || keys.some((key) => ![\"code\", \"childDiagnostic\", \"nativeErrorCategory\"].includes(key))",
  ], "failure marker allowed keys");
  replace([
    "    if (keys.includes(\"materialGate\")) {",
    "      const materialGate = ownValue(value, \"materialGate\");",
    "      if (keys.length !== 2 || code !== \"task005_git_materials_material_invalid\"",
    "        || !BLOCKED_CAPABLE_MATERIAL_GATES.has(materialGate)) {",
    "        throw failure(\"task005_git_materials_cleanup_failed\");",
    "      }",
    "      return createSafeMaterialRecord(materialGate);",
    "    }",
    "",
  ], [], "failure marker material decoder");
  replace([
    "  if (keys.includes(\"materialGate\")) throw failure(\"task005_git_materials_cleanup_failed\");",
    "",
  ], [], "failure marker diagnostic exclusion");

  replace([
    "function strictUtf8(bytes, code = \"task005_git_materials_material_invalid\", materialGate) {",
  ], [
    "function strictUtf8(bytes, code = \"task005_git_materials_material_invalid\") {",
  ], "strict UTF-8 signature");
  replace([
    "    if (code === \"task005_git_materials_material_invalid\") throw materialFailure(materialGate);",
    "",
  ], [], "strict UTF-8 material provenance");

  replace([
    "  const lines = strictUtf8(bytes, \"task005_git_materials_material_invalid\", \"KEYS_UTF8\")",
    "    .trim().split(/\\r?\\n/u).filter(Boolean);",
    "  if (lines.length < 1 || lines.length > 32) throw materialFailure(\"KEYS_COUNT\");",
  ], [
    "  const lines = strictUtf8(bytes).trim().split(/\\r?\\n/u).filter(Boolean);",
    "  if (lines.length < 1 || lines.length > 32) throw failure(\"task005_git_materials_material_invalid\");",
  ], "key manifest decode and count");
  replace(["      throw materialFailure(\"KEYS_RECORD_SCHEMA\");"],
    ["      throw failure(\"task005_git_materials_material_invalid\");"], "key manifest record gate");
  replace(["    throw materialFailure(\"KEYS_DUPLICATE\");"],
    ["    throw failure(\"task005_git_materials_material_invalid\");"], "key manifest duplicate gate");

  replace([
    "function parseInstalledHash(bytes, utf8Gate, schemaGate) {",
    "  const match = strictUtf8(bytes, \"task005_git_materials_material_invalid\", utf8Gate)",
    "    .trim().match(/^([0-9a-f]{64}) {2}\\/lib\\/apk\\/db\\/installed$/u);",
    "  if (!match) throw materialFailure(schemaGate);",
  ], [
    "function parseInstalledHash(bytes) {",
    "  const match = strictUtf8(bytes).trim().match(/^([0-9a-f]{64}) {2}\\/lib\\/apk\\/db\\/installed$/u);",
    "  if (!match) throw failure(\"task005_git_materials_material_invalid\");",
  ], "installed hash parser gates");
  replace([
    "  const match = strictUtf8(bytes, \"task005_git_materials_material_invalid\", \"APK_INDEX_BINDING_UTF8\")",
    "    .trim().match(/^([0-9a-f]{64}) {2}-$/u);",
    "  if (!match) throw materialFailure(\"APK_INDEX_BINDING_HASH_SCHEMA\");",
  ], [
    "  const match = strictUtf8(bytes).trim().match(/^([0-9a-f]{64}) {2}-$/u);",
    "  if (!match) throw failure(\"task005_git_materials_material_invalid\");",
  ], "stdin hash parser gates");

  replace(["function stringArray(value, gate, maximum = 256) {"],
    ["function stringArray(value, maximum = 256) {"], "string array signature");
  replace(["    || hasControl(entry))) throw materialFailure(gate);"],
    ["    || hasControl(entry))) throw failure(\"task005_git_materials_material_invalid\");"],
    "string array gate");

  replace([
    "  const text = strictUtf8(bytes, \"task005_git_materials_material_invalid\", \"QUERY_UTF8\");",
    "",
  ], [], "query UTF-8 gate");
  replace(["    value = JSON.parse(text);"], ["    value = JSON.parse(strictUtf8(bytes));"], "query JSON input");
  replace(["    throw materialFailure(\"QUERY_JSON_SYNTAX\");"],
    ["    throw failure(\"task005_git_materials_material_invalid\");"], "query JSON syntax gate");
  replace([
    "  const records = Array.isArray(value) ? value",
    "    : value !== null && typeof value === \"object\" && Array.isArray(value.packages) ? value.packages : undefined;",
    "  if (records === undefined) throw materialFailure(\"QUERY_ROOT_SCHEMA\");",
    "  if (records.length !== transaction.length) throw materialFailure(\"QUERY_CARDINALITY\");",
  ], [
    "  const records = Array.isArray(value) ? value : value?.packages;",
    "  if (!Array.isArray(records) || records.length !== transaction.length) {",
    "    throw failure(\"task005_git_materials_material_invalid\");",
    "  }",
  ], "query root and cardinality gates");
  replace([
    "    if (record === null || typeof record !== \"object\" || Array.isArray(record)) {",
    "      throw materialFailure(\"QUERY_RECORD_STRUCTURE\");",
    "    }",
    "",
  ], [], "query record structure gate");
  replace([
    "    if (typeof record?.name !== \"string\") throw materialFailure(\"QUERY_NAME_TYPE\");",
    "    if (typeof record?.version !== \"string\") throw materialFailure(\"QUERY_VERSION_TYPE\");",
    "    if (typeof record?.arch !== \"string\" || record.arch !== \"x86_64\") throw materialFailure(\"QUERY_ARCHITECTURE\");",
    "    if (!Number.isSafeInteger(size) || size < 1 || size > LIMITS.apkBytes) throw materialFailure(\"QUERY_FILE_SIZE\");",
    "    if (!Number.isSafeInteger(installedSize) || installedSize < 1",
    "      || installedSize > LIMITS.expandedEvidenceBytes) throw materialFailure(\"QUERY_INSTALLED_SIZE\");",
    "    if (typeof record?.license !== \"string\" || record.license.length < 1 || record.license.length > 512",
    "      || hasControl(record.license)) throw materialFailure(\"QUERY_LICENSE\");",
    "    if (typeof record?.origin !== \"string\" || !VERSION.test(record.origin)) throw materialFailure(\"QUERY_ORIGIN\");",
    "    if (typeof record?.maintainer !== \"string\" || record.maintainer.length < 1 || record.maintainer.length > 512",
    "      || hasControl(record.maintainer)) throw materialFailure(\"QUERY_MAINTAINER\");",
    "    if (typeof record?.commit !== \"string\" || !/^[0-9a-f]{40}$/u.test(record.commit)) {",
    "      throw materialFailure(\"QUERY_COMMIT\");",
    "    }",
  ], [
    "    if (typeof record?.name !== \"string\" || typeof record?.version !== \"string\"",
    "      || typeof record?.arch !== \"string\" || record.arch !== \"x86_64\"",
    "      || !Number.isSafeInteger(size) || size < 1 || size > LIMITS.apkBytes",
    "      || !Number.isSafeInteger(installedSize) || installedSize < 1 || installedSize > LIMITS.expandedEvidenceBytes",
    "      || typeof record?.license !== \"string\" || record.license.length < 1 || record.license.length > 512",
    "      || hasControl(record.license)",
    "      || typeof record?.origin !== \"string\" || !VERSION.test(record.origin)",
    "      || typeof record?.maintainer !== \"string\" || record.maintainer.length < 1 || record.maintainer.length > 512",
    "      || hasControl(record.maintainer)",
    "      || typeof record?.commit !== \"string\" || !/^[0-9a-f]{40}$/u.test(record.commit)) {",
    "      throw failure(\"task005_git_materials_material_invalid\");",
    "    }",
  ], "query scalar gate decomposition");
  replace([
    "    if (!expected || expected.version !== record.version) throw materialFailure(\"QUERY_NAME_VERSION_BINDING\");",
    "    const dependencies = stringArray(record.depends, \"QUERY_DEPENDS_SCHEMA\");",
    "    const installIf = stringArray(record[\"install-if\"], \"QUERY_INSTALL_IF_SCHEMA\");",
  ], [
    "    if (!expected || expected.version !== record.version) throw failure(\"task005_git_materials_material_invalid\");",
  ], "query binding and arrays gates");
  replace([
    "      dependencies,",
    "      installIf,",
  ], [
    "      dependencies: stringArray(record.depends),",
    "      installIf: stringArray(record[\"install-if\"]),",
  ], "query normalized arrays");
  replace(["    throw materialFailure(\"QUERY_DUPLICATE_NAME\");"],
    ["    throw failure(\"task005_git_materials_material_invalid\");"], "query duplicate gate");

  replace([
    "  const text = strictUtf8(bytes, \"task005_git_materials_material_invalid\", \"APK_MANIFEST_UTF8\");",
  ], ["  const text = strictUtf8(bytes);"], "manifest UTF-8 gate");
  replace([
    "    const match = line.match(/^(SHA1|sha1|SHA256|sha256):([0-9a-f]+) {2}(.+)$/u);",
    "    if (!match) throw materialFailure(\"APK_MANIFEST_LINE_GRAMMAR\");",
    "    const algorithm = MANIFEST_ALGORITHMS[match[1]];",
    "    if (algorithm === \"SHA1\" && match[2].length !== 40",
    "      || algorithm === \"SHA256\" && match[2].length !== 64) throw materialFailure(\"APK_MANIFEST_DIGEST_LENGTH\");",
    "    if (match[3].length > 4096 || match[3].startsWith(\"/\") || match[3].includes(\"\\\\\")",
    "      || match[3].split(\"/\").some((part) => part === \"\" || part === \".\" || part === \"..\")",
    "      || hasControl(match[3])) throw materialFailure(\"APK_MANIFEST_PATH_SCHEMA\");",
    "    return { algorithm, digest: match[2], path: match[3] };",
  ], [
    "    const match = line.match(/^(SHA1|SHA256):([0-9a-f]+) {2}(.+)$/u);",
    "    if (!match || match[1] === \"SHA1\" && match[2].length !== 40 || match[1] === \"SHA256\" && match[2].length !== 64",
    "      || match[3].length > 4096 || match[3].startsWith(\"/\") || match[3].includes(\"\\\\\")",
    "      || match[3].split(\"/\").some((part) => part === \"\" || part === \".\" || part === \"..\")",
    "      || hasControl(match[3])) throw failure(\"task005_git_materials_material_invalid\");",
    "    return { algorithm: match[1], digest: match[2], path: match[3] };",
  ], "manifest grammar and canonicalization");
  replace([
    "  if (entries.length < 1) throw materialFailure(\"APK_MANIFEST_EMPTY\");",
    "  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {",
    "    throw materialFailure(\"APK_MANIFEST_DUPLICATE_PATH\");",
    "  }",
  ], [
    "  if (entries.length < 1 || new Set(entries.map((entry) => entry.path)).size !== entries.length) {",
    "    throw failure(\"task005_git_materials_material_invalid\");",
    "  }",
  ], "manifest empty and duplicate gates");

  replace(["    throw materialFailure(\"EVIDENCE_ROOT_SCHEMA\");"],
    ["    throw failure(\"task005_git_materials_material_invalid\");"], "evidence root gate");
  replace(["      throw materialFailure(\"EVIDENCE_NOT_RUN_SCHEMA\");"],
    ["      throw failure(\"task005_git_materials_material_invalid\");"], "evidence not-run gate");
  replace([
    "    if (receipt.actor !== \"OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1\"",
    "      || receipt.state !== \"MATERIAL_OBSERVATION_ONLY\" || receipt.authority !== \"DIAGNOSTIC_ONLY\"",
    "      || receipt.installationAuthority !== false || Object.keys(receipt).sort().join(\"|\") !== top.sort().join(\"|\")) {",
    "      throw materialFailure(\"EVIDENCE_RECEIPT_SCHEMA\");",
    "    }",
    "    if (Object.keys(receipt.boundaries ?? {}).sort().join(\"|\") !== boundaryKeys.sort().join(\"|\")",
    "      || receipt.boundaries.indexMetadata !== \"OBSERVED\" || receipt.boundaries.regularFileManifest !== \"OBSERVED\"",
    "      || receipt.boundaries.hookContent !== \"NOT_INSPECTED\"",
    "      || receipt.boundaries.nonregularFileMetadata !== \"NOT_INSPECTED\"",
    "      || receipt.boundaries.repoCommitMeaning !== \"SIGNED_INDEX_DECLARATION_ONLY\") {",
    "      throw materialFailure(\"EVIDENCE_BOUNDARIES\");",
    "    }",
    "    if (receipt.execution?.gitExecuted !== false || receipt.execution?.packageInstalled !== false",
    "      || receipt.execution?.packagePayloadExecuted !== false) throw materialFailure(\"EVIDENCE_EXECUTION\");",
    "    if (receipt.security?.stage2 !== \"BLOCKED\"",
    "      || receipt.security?.exhaustiveCoverage !== false || receipt.security?.severityAvailable !== false",
    "      || receipt.security?.stillUnfixedStateAvailable !== false) throw materialFailure(\"EVIDENCE_SECURITY\");",
    "    if (receipt.index?.genericVerification !== \"PASSED\"",
    "      || receipt.index?.repositoryAcceptance !== \"SOLE_LOCAL_REPOSITORY_SOLVE_PASSED\") {",
    "      throw materialFailure(\"EVIDENCE_INDEX\");",
    "    }",
    "    if (!/^sha256:[0-9a-f]{64}$/u.test(receipt.carrier?.imageId ?? \"\")) {",
    "      throw materialFailure(\"EVIDENCE_CARRIER\");",
    "    }",
    "    if (![\"WITHIN_48_HOURS_NONAUTHORITATIVE\", \"STALE_BLOCKING_STAGE2\"].includes(receipt.secdb?.freshness)",
    "      || !Number.isFinite(receipt.secdb?.acquisitionToUseMs) || receipt.secdb.acquisitionToUseMs < 0",
    "      || receipt.secdb.acquisitionToUseMs > 48 * 60 * 60_000",
    "      || !Number.isFinite(receipt.secdb?.snapshotAgeMs) || receipt.secdb.snapshotAgeMs < 0) {",
    "      throw materialFailure(\"EVIDENCE_SECDB\");",
    "    }",
    "    if (manifest.actor !== \"TASK005_GIT_MATERIALS_MANIFEST_V1\"",
    "      || manifest.state !== \"MATERIAL_OBSERVATION_ONLY\" || manifest.installationAuthorization !== false) {",
    "      throw materialFailure(\"EVIDENCE_MANIFEST_SCHEMA\");",
    "    }",
    "    if (receiptPackages.length < 1 || manifestPackages.length !== receiptPackages.length) {",
    "      throw materialFailure(\"EVIDENCE_PACKAGE_CARDINALITY\");",
    "    }",
    "    if (new Set(receiptPackages.map((pkg) => pkg?.name)).size !== receiptPackages.length",
    "      || new Set(manifestPackages.map((pkg) => pkg?.filename)).size !== manifestPackages.length) {",
    "      throw materialFailure(\"EVIDENCE_PACKAGE_UNIQUENESS\");",
    "    }",
    "    if (manifestPackages.some((pkg) => pkg?.indexBinding !== \"VERIFIED_BY_APK_FETCH\"",
    "      || pkg?.localSignature !== \"VERIFIED_BY_APK_VERIFY\")) {",
    "      throw materialFailure(\"EVIDENCE_PACKAGE_VERDICTS\");",
    "    }",
  ], [
    "    if (receipt.actor !== \"OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1\"",
    "      || receipt.state !== \"MATERIAL_OBSERVATION_ONLY\" || receipt.authority !== \"DIAGNOSTIC_ONLY\"",
    "      || receipt.installationAuthority !== false || Object.keys(receipt).sort().join(\"|\") !== top.sort().join(\"|\")",
    "      || Object.keys(receipt.boundaries ?? {}).sort().join(\"|\") !== boundaryKeys.sort().join(\"|\")",
    "      || receipt.boundaries.indexMetadata !== \"OBSERVED\" || receipt.boundaries.regularFileManifest !== \"OBSERVED\"",
    "      || receipt.boundaries.hookContent !== \"NOT_INSPECTED\"",
    "      || receipt.boundaries.nonregularFileMetadata !== \"NOT_INSPECTED\"",
    "      || receipt.boundaries.repoCommitMeaning !== \"SIGNED_INDEX_DECLARATION_ONLY\"",
    "      || receipt.execution?.gitExecuted !== false || receipt.execution?.packageInstalled !== false",
    "      || receipt.execution?.packagePayloadExecuted !== false || receipt.security?.stage2 !== \"BLOCKED\"",
    "      || receipt.security?.exhaustiveCoverage !== false || receipt.security?.severityAvailable !== false",
    "      || receipt.security?.stillUnfixedStateAvailable !== false",
    "      || receipt.index?.genericVerification !== \"PASSED\"",
    "      || receipt.index?.repositoryAcceptance !== \"SOLE_LOCAL_REPOSITORY_SOLVE_PASSED\"",
    "      || !/^sha256:[0-9a-f]{64}$/u.test(receipt.carrier?.imageId ?? \"\")",
    "      || ![\"WITHIN_48_HOURS_NONAUTHORITATIVE\", \"STALE_BLOCKING_STAGE2\"].includes(receipt.secdb?.freshness)",
    "      || !Number.isFinite(receipt.secdb?.acquisitionToUseMs) || receipt.secdb.acquisitionToUseMs < 0",
    "      || receipt.secdb.acquisitionToUseMs > 48 * 60 * 60_000",
    "      || !Number.isFinite(receipt.secdb?.snapshotAgeMs) || receipt.secdb.snapshotAgeMs < 0",
    "      || manifest.actor !== \"TASK005_GIT_MATERIALS_MANIFEST_V1\"",
    "      || manifest.state !== \"MATERIAL_OBSERVATION_ONLY\" || manifest.installationAuthorization !== false",
    "      || receiptPackages.length < 1 || manifestPackages.length !== receiptPackages.length",
    "      || new Set(receiptPackages.map((pkg) => pkg?.name)).size !== receiptPackages.length",
    "      || new Set(manifestPackages.map((pkg) => pkg?.filename)).size !== manifestPackages.length",
    "      || manifestPackages.some((pkg) => pkg?.indexBinding !== \"VERIFIED_BY_APK_FETCH\"",
    "        || pkg?.localSignature !== \"VERIFIED_BY_APK_VERIFY\")) {",
    "      throw failure(\"task005_git_materials_material_invalid\");",
    "    }",
  ], "evidence observed gate decomposition");
  replace(["        throw materialFailure(\"EVIDENCE_PACKAGE_BINDING\");"],
    ["        throw failure(\"task005_git_materials_material_invalid\");"], "evidence package binding gate");
  replace(["    throw materialFailure(\"EVIDENCE_PRIVACY\");"],
    ["    throw failure(\"task005_git_materials_material_invalid\");"], "evidence privacy gate");

  replace([
    "    if (result.stderr.length !== 0) throw materialFailure(MATERIAL_STDERR_GATES[operation]);",
  ], [
    "    if (result.stderr.length !== 0) throw failure(\"task005_git_materials_material_invalid\");",
  ], "material stderr operation gate");
  replace([
    "  const installedBefore = parseInstalledHash(carrier(\"MATERIAL_INSTALLED_BEFORE\", \"/bin/busybox\",",
    "    [\"sha256sum\", \"/lib/apk/db/installed\"]), \"INSTALLED_BEFORE_UTF8\", \"INSTALLED_BEFORE_HASH_SCHEMA\");",
  ], [
    "  const installedBefore = parseInstalledHash(carrier(\"MATERIAL_INSTALLED_BEFORE\", \"/bin/busybox\",",
    "    [\"sha256sum\", \"/lib/apk/db/installed\"]));",
  ], "installed-before call gates");
  replace(["    if (!APK_FILENAME.test(filename)) throw materialFailure(\"APK_FILENAME\");"],
    ["    if (!APK_FILENAME.test(filename)) throw failure(\"task005_git_materials_material_invalid\");"],
    "APK filename gate");
  replace(["    if (downloaded.bytes.length !== pkg.size) throw materialFailure(\"APK_DOWNLOAD_SIZE\");"],
    ["    if (downloaded.bytes.length !== pkg.size) throw failure(\"task005_git_materials_material_invalid\");"],
    "APK download size gate");
  replace(["    if (repositoryHash !== sha256(downloaded.bytes)) throw materialFailure(\"APK_INDEX_BINDING_MISMATCH\");"],
    ["    if (repositoryHash !== sha256(downloaded.bytes)) throw failure(\"task005_git_materials_material_invalid\");"],
    "APK index binding gate");
  replace([
    "  const installedAfter = parseInstalledHash(carrier(\"MATERIAL_INSTALLED_AFTER\", \"/bin/busybox\",",
    "    [\"sha256sum\", \"/lib/apk/db/installed\"]), \"INSTALLED_AFTER_UTF8\", \"INSTALLED_AFTER_HASH_SCHEMA\");",
  ], [
    "  const installedAfter = parseInstalledHash(carrier(\"MATERIAL_INSTALLED_AFTER\", \"/bin/busybox\",",
    "    [\"sha256sum\", \"/lib/apk/db/installed\"]));",
  ], "installed-after call gates");

  return source;
}

function reverseV11ActorToFrozenV10(source) {
  source = reverseV11ActorChanges(source);
  const exact = (before, after, label) => {
    source = replaceExact(source, before, after, label);
  };
  exact(
    "const ACCEPTED_BASE = \"31d6891f6f646737897d9e9dad59a975a73bb9fd\";",
    "const ACCEPTED_BASE = \"07922f89a07f1440f30d3564594e02ba2ce22895\";",
    "accepted base",
  );
  exact(
    "const HEAD_BRANCH = \"codex/task-0005-git-materials-v11\";",
    "const HEAD_BRANCH = \"codex/task-0005-git-materials-v10\";",
    "head branch namespace",
  );
  exact(
    "const WORKFLOW = \".github/workflows/task005-git-materials-v11.yml\";",
    "const WORKFLOW = \".github/workflows/task005-git-materials-v10.yml\";",
    "workflow namespace",
  );
  exact(
    "const PRIVATE_NAME = \"task005-git-materials-v11-private\";",
    "const PRIVATE_NAME = \"task005-git-materials-v10-private\";",
    "private root namespace",
  );
  exact(
    "const PUBLIC_NAME = \"task005-git-materials-v11-public\";",
    "const PUBLIC_NAME = \"task005-git-materials-v10-public\";",
    "public root namespace",
  );
  exact(
    "    \"--name\", name, \"--label\", \"com.auto-world.task005.git-materials-v11=true\",",
    "    \"--name\", name, \"--label\", \"com.auto-world.task005.git-materials-v10=true\",",
    "Docker run label namespace",
  );
  exact(
    "        headers: { \"user-agent\": \"auto-world-task005-git-materials-v11\" } }), aborted]);",
    "        headers: { \"user-agent\": \"auto-world-task005-git-materials-v10\" } }), aborted]);",
    "download user-agent namespace",
  );
  exact(
    "    \"{{.Names}}|{{.Label \\\"com.auto-world.task005.git-materials-v11\\\"}}|{{.Label \\\"com.auto-world.github-run-id\\\"}}\"], {",
    "    \"{{.Names}}|{{.Label \\\"com.auto-world.task005.git-materials-v10\\\"}}|{{.Label \\\"com.auto-world.github-run-id\\\"}}\"], {",
    "container list label namespace",
  );
  exact(
    '    "label=com.auto-world.task005.git-materials-v11=true", "--filter", `label=com.auto-world.github-run-id=${context.runId}`,',
    '    "label=com.auto-world.task005.git-materials-v10=true", "--filter", `label=com.auto-world.github-run-id=${context.runId}`,',
    "container discovery label namespace",
  );
  return source;
}

function observationFixtureV11({
  installedOutputs,
  keyOutput,
  queryOutput,
  manifestOutput,
  simulationOutput,
  ...options
} = {}) {
  const observed = observationFixture(options);
  let installedCalls = 0;
  const command = (executable, args, commandOptions) => {
    const result = observed.command(executable, args, commandOptions);
    if (result.status !== 0) return result;
    const entrypointAt = args.indexOf("--entrypoint");
    const entrypoint = entrypointAt === -1 ? undefined : args[entrypointAt + 1];
    const carrierArgs = entrypointAt === -1 ? [] : args.slice(entrypointAt + 3);
    let stdout;
    if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("find /etc/apk/keys")) {
      stdout = keyOutput;
    } else if (entrypoint === "/bin/busybox") {
      stdout = installedOutputs?.[installedCalls++];
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("add")) {
      stdout = simulationOutput;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("query")) {
      stdout = queryOutput;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("manifest")) {
      stdout = manifestOutput;
    }
    return stdout === undefined ? result : { ...result, stdout: Buffer.from(stdout) };
  };
  return { ...observed, command };
}

async function captureV11MaterialGate(options) {
  const fixture = await fixtureContext();
  const observed = observationFixtureV11(options);
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    return await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2, context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command, fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0), resources: freshCarrierResources(),
    }));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function collectV11Evidence() {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const evidence = await materializeObservation({
      availableBytes: 30 * 1024 ** 2, context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command, fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0), resources: freshCarrierResources(),
    });
    return { context: { runnerTemp: context.runnerTemp }, evidence: globalThis.structuredClone(evidence) };
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

function tenPackageObservationFixtureV11({ failAt = -1, failResult, ...options } = {}) {
  const observed = tenPackageObservationFixture(options);
  const command = (executable, args, commandOptions) => {
    const result = observed.command(executable, args, commandOptions);
    if (observed.records.length - 1 !== failAt) return result;
    return failResult ?? {
      status: 0, stdout: Buffer.alloc(0), stderr: Buffer.from("PRIVATE_TEN_PACKAGE_STDERR"),
    };
  };
  return { ...observed, command };
}

async function captureV11TenPackageRefusal(options) {
  const fixture = await fixtureContext();
  const observed = tenPackageObservationFixtureV11(options);
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }));
    return { error, fetchCalls: observed.fetchCalls, records: observed.records };
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

function rawLogOnlyEvidenceCases(validEvidence, context) {
  const observed = (mutate) => {
    const value = globalThis.structuredClone(validEvidence);
    return mutate(value);
  };
  return [
    ["EVIDENCE_ROOT_SCHEMA", () => null],
    ["EVIDENCE_NOT_RUN_SCHEMA", () => {
      const value = notRunEvidence(context, "apk-tools 3.0.0", completeHelp(),
        { missing: ["manifest:manifest"] },
        { containersAbsent: true, privateFilesAbsent: true },
        FIXTURE_IMAGE_ID, 30 * 1024 ** 2);
      value.receipt.materialsAcquired = true;
      return value;
    }],
    ["EVIDENCE_RECEIPT_SCHEMA", () => observed((value) => {
      value.receipt.actor = "OTHER"; return value;
    })],
    ["EVIDENCE_BOUNDARIES", () => observed((value) => {
      value.receipt.boundaries.hookContent = "OBSERVED"; return value;
    })],
    ["EVIDENCE_EXECUTION", () => observed((value) => {
      value.receipt.execution.gitExecuted = true; return value;
    })],
    ["EVIDENCE_SECURITY", () => observed((value) => {
      value.receipt.security.stage2 = "COMPLETE"; return value;
    })],
    ["EVIDENCE_INDEX", () => observed((value) => {
      value.receipt.index.genericVerification = "FAILED"; return value;
    })],
    ["EVIDENCE_CARRIER", () => observed((value) => {
      value.receipt.carrier.imageId = "invalid"; return value;
    })],
    ["EVIDENCE_SECDB", () => observed((value) => {
      value.receipt.secdb.freshness = "UNKNOWN"; return value;
    })],
    ["EVIDENCE_MANIFEST_SCHEMA", () => observed((value) => {
      value.manifest.actor = "OTHER"; return value;
    })],
    ["EVIDENCE_PACKAGE_CARDINALITY", () => observed((value) => {
      value.manifest.packages = []; return value;
    })],
    ["EVIDENCE_PACKAGE_UNIQUENESS", () => observed((value) => {
      value.receipt.packages = [value.receipt.packages[0], globalThis.structuredClone(value.receipt.packages[0])];
      value.manifest.packages = [value.manifest.packages[0],
        { ...globalThis.structuredClone(value.manifest.packages[0]), filename: "other-1-r0.apk" }];
      return value;
    })],
    ["EVIDENCE_PACKAGE_VERDICTS", () => observed((value) => {
      value.manifest.packages[0].localSignature = "FAILED"; return value;
    })],
    ["EVIDENCE_PACKAGE_BINDING", () => observed((value) => {
      value.manifest.packages[0].bytes += 1; return value;
    })],
    ["EVIDENCE_PRIVACY", () => observed((value) => {
      value.receipt.packages[0].license = "/materials/PRIVATE_SENTINEL"; return value;
    })],
  ];
}

function trustedRawLogOnlyErrors(validEvidence, context) {
  const cases = rawLogOnlyEvidenceCases(validEvidence, context);
  assert.deepEqual(cases.map(([gate]) => gate), V11_RAW_LOG_ONLY_GATES);
  return cases.map(([gate, makeInvalid]) => {
    const error = captureThrown(() => validateEvidence(makeInvalid(), context));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    const projected = projectedFailure(error);
    assert.equal(projected.code, "task005_git_materials_material_invalid");
    assert.equal(projected.materialGate, gate);
    return [gate, error];
  });
}

async function runExecuteWithSafeFailureLog(env, options) {
  const lines = [];
  let error;
  try {
    await run(["execute"], env, { ...options, log: (line) => lines.push(line) });
  } catch (caught) {
    error = caught;
    lines.push(publicFailure(caught).trimEnd());
  }
  assert.ok(error instanceof Error);
  return { error, lines };
}

function withLowercaseManifestStdout(observed) {
  let manifestTransforms = 0;
  const command = (executable, args, options) => {
    const result = observed.command(executable, args, options);
    const entrypointAt = args.indexOf("--entrypoint");
    const carrierArgs = entrypointAt === -1 ? [] : args.slice(entrypointAt + 3);
    const isManifest = entrypointAt !== -1 && args[entrypointAt + 1] === "/sbin/apk"
      && carrierArgs.includes("manifest");
    if (!isManifest) return result;
    assert.equal(result.status, 0);
    assert.ok(Buffer.isBuffer(result.stdout));
    const uppercase = result.stdout.toString("utf8");
    assert.match(uppercase, /^SHA(?:1|256):/u);
    const lowercase = uppercase.replace(/^SHA1:/u, "sha1:").replace(/^SHA256:/u, "sha256:");
    assert.notEqual(lowercase, uppercase);
    manifestTransforms += 1;
    return { ...result, stdout: Buffer.from(lowercase) };
  };
  return { ...observed, command, manifestTransforms: () => manifestTransforms };
}

function normalizedOwnerIdentity(calls, context) {
  const normalizeTarget = (target) => target.replaceAll(context.runnerTemp, "<RUNNER_TEMP>")
    .replaceAll("\\", "/");
  return { getuid: calls.getuid, getgid: calls.getgid, lstat: calls.lstat,
    targets: calls.targets.map(normalizeTarget) };
}

async function collectFullManifestExecution(createObserved) {
  const fixture = await fixtureContext();
  const observed = createObserved();
  const owner = ownerIdentityFixture();
  let cleanupCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const evidence = await executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.",
        help: completeHelp(), imageId: FIXTURE_IMAGE_ID }),
      command: observed.command, fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      cleanup: async () => { cleanupCalls += 1; await cleanupPrivate(context); },
      identityIo: owner.identityIo,
    });
    const persisted = await readPublicEvidence(context);
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    return {
      canonical: { receipt: canonicalJson(evidence.receipt), manifest: canonicalJson(evidence.manifest),
        transaction: canonicalJson(evidence.receipt.transaction) },
      cleanup: { calls: cleanupCalls, privateFilesAbsent: true,
        receipt: globalThis.structuredClone(evidence.receipt.cleanup) },
      evidence: globalThis.structuredClone(evidence), fetchCalls: [...observed.fetchCalls],
      manifestTransforms: observed.manifestTransforms?.() ?? 0,
      owner: normalizedOwnerIdentity(owner.calls, context), persisted,
      transcript: observed.records.map((record) => normalizedCommandRecord(record, context)),
    };
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}


const V11_TEST_REVERSALS = [
  [
    "  symlink, writeFile } from \"node:fs/promises\";",
    "  writeFile } from \"node:fs/promises\";",
    "frozen V10 test lines 5-5"
  ],
  [
    "} from \"../scripts/diagnostics/task005-git-materials-v11.mjs\";",
    "} from \"../scripts/diagnostics/task005-git-materials-v10.mjs\";",
    "frozen V10 test lines 37-37"
  ],
  [
    "const workflowPath = new URL(\"../.github/workflows/task005-git-materials-v11.yml\", import.meta.url);\nconst actorPath = new URL(\"../scripts/diagnostics/task005-git-materials-v11.mjs\", import.meta.url);\nconst BASE = \"31d6891f6f646737897d9e9dad59a975a73bb9fd\";",
    "const workflowPath = new URL(\"../.github/workflows/task005-git-materials-v10.yml\", import.meta.url);\nconst actorPath = new URL(\"../scripts/diagnostics/task005-git-materials-v10.mjs\", import.meta.url);\nconst BASE = \"07922f89a07f1440f30d3564594e02ba2ce22895\";",
    "frozen V10 test lines 39-41"
  ],
  [
    "      head: { ref: \"codex/task-0005-git-materials-v11\", sha: HEAD,",
    "      head: { ref: \"codex/task-0005-git-materials-v10\", sha: HEAD,",
    "frozen V10 test lines 98-98"
  ],
  [
    "    GITHUB_HEAD_REF: \"codex/task-0005-git-materials-v11\",",
    "    GITHUB_HEAD_REF: \"codex/task-0005-git-materials-v10\",",
    "frozen V10 test lines 110-110"
  ],
  [
    "    GITHUB_WORKFLOW_REF: \"CleMeY15/auto-world/.github/workflows/task005-git-materials-v11.yml@refs/pull/205/merge\",",
    "    GITHUB_WORKFLOW_REF: \"CleMeY15/auto-world/.github/workflows/task005-git-materials-v10.yml@refs/pull/205/merge\",",
    "frozen V10 test lines 117-117"
  ],
  [
    "      .replaceAll(\"git-materials-v11\", \"git-materials-v6\")",
    "      .replaceAll(\"git-materials-v10\", \"git-materials-v6\")",
    "frozen V10 test lines 692-692"
  ],
  [
    "        \"--label\", \"com.auto-world.task005.git-materials-v11=true\",",
    "        \"--label\", \"com.auto-world.task005.git-materials-v10=true\",",
    "frozen V10 test lines 801-801"
  ],
  [
    "        \"label=com.auto-world.task005.git-materials-v11=true\", \"--filter\",",
    "        \"label=com.auto-world.task005.git-materials-v10=true\", \"--filter\",",
    "frozen V10 test lines 844-844"
  ],
  [
    "        \"{{.Names}}|{{.Label \\\"com.auto-world.task005.git-materials-v11\\\"}}|{{.Label \\\"com.auto-world.github-run-id\\\"}}\"]);",
    "        \"{{.Names}}|{{.Label \\\"com.auto-world.task005.git-materials-v10\\\"}}|{{.Label \\\"com.auto-world.github-run-id\\\"}}\"]);",
    "frozen V10 test lines 849-849"
  ],
  [
    "  assert.match(bytes, /github\\.head_ref == 'codex\\/task-0005-git-materials-v11'/u);",
    "  assert.match(bytes, /github\\.head_ref == 'codex\\/task-0005-git-materials-v10'/u);",
    "frozen V10 test lines 1216-1216"
  ],
  [
    "  assert.match(bytes, /Run the focused actor contract tests before acquisition\\n {8}timeout-minutes: 2\\n {8}run: node --test tests\\/task005-git-materials-v11\\.test\\.mjs/u);",
    "  assert.match(bytes, /Run the focused actor contract tests before acquisition\\n {8}timeout-minutes: 2\\n {8}run: node --test tests\\/task005-git-materials-v10\\.test\\.mjs/u);",
    "frozen V10 test lines 1219-1219"
  ],
  [
    "  assert.match(bytes, /\\.github\\/workflows\\/task005-git-materials-v11\\.yml\\n {6}- scripts\\/diagnostics\\/task005-git-materials-v11\\.mjs\\n {6}- tests\\/task005-git-materials-v11\\.test\\.mjs/u);",
    "  assert.match(bytes, /\\.github\\/workflows\\/task005-git-materials-v10\\.yml\\n {6}- scripts\\/diagnostics\\/task005-git-materials-v10\\.mjs\\n {6}- tests\\/task005-git-materials-v10\\.test\\.mjs/u);",
    "frozen V10 test lines 1230-1230"
  ],
  [
    "    assert.equal(options.headers[\"user-agent\"], \"auto-world-task005-git-materials-v11\");",
    "    assert.equal(options.headers[\"user-agent\"], \"auto-world-task005-git-materials-v10\");",
    "frozen V10 test lines 1329-1329"
  ],
  [
    "  const source = await readFile(new URL(\"../scripts/diagnostics/task005-git-materials-v11.mjs\", import.meta.url), \"utf8\");",
    "  const source = await readFile(new URL(\"../scripts/diagnostics/task005-git-materials-v10.mjs\", import.meta.url), \"utf8\");",
    "frozen V10 test lines 2099-2099"
  ],
  [
    "  const publicRoot = path.join(fixture.runnerTemp, \"task005-git-materials-v11-public\");",
    "  const publicRoot = path.join(fixture.runnerTemp, \"task005-git-materials-v10-public\");",
    "frozen V10 test lines 2116-2116"
  ],
  [
    "test(\"actor source outside parseTransaction equals the immutable V9 actor after namespace normalization\", async () => {\n  const source = reverseV11ActorChanges(await readFile(actorPath, \"utf8\"));",
    "test(\"actor source outside parseTransaction equals the immutable V9 actor after namespace normalization\", async () => {\n  const source = await readFile(actorPath, \"utf8\");",
    "frozen V10 test lines 2503-2504"
  ],
  [
    "      .replaceAll(\"task005-git-materials-v11\", \"task005-git-materials-v9\")\n      .replaceAll(\"task-0005-git-materials-v11\", \"task-0005-git-materials-v9\")\n      .replaceAll(\"task005.git-materials-v11\", \"task005.git-materials-v9\");",
    "      .replaceAll(\"task005-git-materials-v10\", \"task005-git-materials-v9\")\n      .replaceAll(\"task-0005-git-materials-v10\", \"task-0005-git-materials-v9\")\n      .replaceAll(\"task005.git-materials-v10\", \"task005.git-materials-v9\");",
    "frozen V10 test lines 2521-2523"
  ],
  [
    "    .replaceAll(\"task005-git-materials-v11\", \"task005-git-materials-v9\")\n    .replaceAll(\"task-0005-git-materials-v11\", \"task-0005-git-materials-v9\")\n    .replaceAll(\"diagnostic V11\", \"diagnostic V9\"));",
    "    .replaceAll(\"task005-git-materials-v10\", \"task005-git-materials-v9\")\n    .replaceAll(\"task-0005-git-materials-v10\", \"task-0005-git-materials-v9\")\n    .replaceAll(\"diagnostic V10\", \"diagnostic V9\"));",
    "frozen V10 test lines 2539-2541"
  ],
  [
    "    .replaceAll(\"task005-git-materials-v11\", \"task005-git-materials-v8\")\n    .replaceAll(\"task-0005-git-materials-v11\", \"task-0005-git-materials-v8\")\n    .replaceAll(\"diagnostic V11\", \"diagnostic V8\"));",
    "    .replaceAll(\"task005-git-materials-v10\", \"task005-git-materials-v8\")\n    .replaceAll(\"task-0005-git-materials-v10\", \"task-0005-git-materials-v8\")\n    .replaceAll(\"diagnostic V10\", \"diagnostic V8\"));",
    "frozen V10 test lines 2549-2551"
  ],
  [
    "    .replaceAll(\"task005-git-materials-v11\", \"task005-git-materials-v7\")\n    .replaceAll(\"task-0005-git-materials-v11\", \"task-0005-git-materials-v7\")\n    .replaceAll(\"diagnostic V11\", \"diagnostic V7\"));",
    "    .replaceAll(\"task005-git-materials-v10\", \"task005-git-materials-v7\")\n    .replaceAll(\"task-0005-git-materials-v10\", \"task-0005-git-materials-v7\")\n    .replaceAll(\"diagnostic V10\", \"diagnostic V7\"));",
    "frozen V10 test lines 2559-2561"
  ],
  [
    "    .replaceAll(\"task005-git-materials-v11\", \"task005-git-materials-v6\")\n    .replaceAll(\"task-0005-git-materials-v11\", \"task-0005-git-materials-v6\")\n    .replaceAll(\"diagnostic V11\", \"diagnostic V6\"));",
    "    .replaceAll(\"task005-git-materials-v10\", \"task005-git-materials-v6\")\n    .replaceAll(\"task-0005-git-materials-v10\", \"task-0005-git-materials-v6\")\n    .replaceAll(\"diagnostic V10\", \"diagnostic V6\"));",
    "frozen V10 test lines 2569-2571"
  ]
];
const V11_WORKFLOW_REVERSALS = [
  [
    "name: TASK-0005 Git material diagnostic V11",
    "name: TASK-0005 Git material diagnostic V10",
    "workflow namespace line 1"
  ],
  [
    "      - .github/workflows/task005-git-materials-v11.yml",
    "      - .github/workflows/task005-git-materials-v10.yml",
    "workflow namespace line 2"
  ],
  [
    "      - scripts/diagnostics/task005-git-materials-v11.mjs",
    "      - scripts/diagnostics/task005-git-materials-v10.mjs",
    "workflow namespace line 3"
  ],
  [
    "      - tests/task005-git-materials-v11.test.mjs",
    "      - tests/task005-git-materials-v10.test.mjs",
    "workflow namespace line 4"
  ],
  [
    "  group: task005-git-materials-v11",
    "  group: task005-git-materials-v10",
    "workflow namespace line 5"
  ],
  [
    "    if: ${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'pull_request' && github.event.action == 'opened' && github.event.pull_request.draft == true && github.base_ref == 'main' && github.head_ref == 'codex/task-0005-git-materials-v11' && github.run_number == 1 && github.run_attempt == 1 }}",
    "    if: ${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'pull_request' && github.event.action == 'opened' && github.event.pull_request.draft == true && github.base_ref == 'main' && github.head_ref == 'codex/task-0005-git-materials-v10' && github.run_number == 1 && github.run_attempt == 1 }}",
    "workflow namespace line 6"
  ],
  [
    "          test \"$GITHUB_HEAD_REF\" = 'codex/task-0005-git-materials-v11'",
    "          test \"$GITHUB_HEAD_REF\" = 'codex/task-0005-git-materials-v10'",
    "workflow namespace line 7"
  ],
  [
    "          test \"$GITHUB_WORKFLOW_REF\" = 'CleMeY15/auto-world/.github/workflows/task005-git-materials-v11.yml@refs/pull/'\"${{ github.event.pull_request.number }}\"'/merge'",
    "          test \"$GITHUB_WORKFLOW_REF\" = 'CleMeY15/auto-world/.github/workflows/task005-git-materials-v10.yml@refs/pull/'\"${{ github.event.pull_request.number }}\"'/merge'",
    "workflow namespace line 8"
  ],
  [
    "        run: node --test tests/task005-git-materials-v11.test.mjs",
    "        run: node --test tests/task005-git-materials-v10.test.mjs",
    "workflow namespace line 9"
  ],
  [
    "        run: node scripts/diagnostics/task005-git-materials-v11.mjs execute",
    "        run: node scripts/diagnostics/task005-git-materials-v10.mjs execute",
    "workflow namespace line 10"
  ],
  [
    "        run: node scripts/diagnostics/task005-git-materials-v11.mjs cleanup",
    "        run: node scripts/diagnostics/task005-git-materials-v10.mjs cleanup",
    "workflow namespace line 11"
  ],
  [
    "          name: task005-git-materials-v11",
    "          name: task005-git-materials-v10",
    "workflow namespace line 12"
  ],
  [
    "          path: ${{ runner.temp }}/task005-git-materials-v11-public",
    "          path: ${{ runner.temp }}/task005-git-materials-v10-public",
    "workflow namespace line 13"
  ],
  [
    "        run: node scripts/diagnostics/task005-git-materials-v11.mjs dispose-public",
    "        run: node scripts/diagnostics/task005-git-materials-v10.mjs dispose-public",
    "workflow namespace line 14"
  ]
];

function removeV11NamedTestBlock(source, name) {
  const begin = `\n// V11_ADDITIONS_${name}_BEGIN\n`;
  const end = `\n// V11_ADDITIONS_${name}_END\n`;
  assert.equal(source.split(begin).length - 1, 1, `${name} unique begin`);
  assert.equal(source.split(end).length - 1, 1, `${name} unique end`);
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  assert.ok(finish > start);
  return source.slice(0, start) + source.slice(finish + end.length);
}

function reverseV11TestsToFrozenV10(source) {
  source = removeV11NamedTestBlock(source, "HELPERS");
  source = removeV11NamedTestBlock(source, "TESTS");
  for (const [before, after, label] of V11_TEST_REVERSALS) {
    source = replaceExact(source, before, after, label);
  }
  return source;
}

function reverseV11WorkflowToFrozenV10(source) {
  for (const [before, after, label] of V11_WORKFLOW_REVERSALS) {
    source = replaceExact(source, before, after, label);
  }
  return source;
}

// V11_ADDITIONS_HELPERS_END

function ownerIdentityFixture({
  uid = FIXTURE_UID,
  gid = FIXTURE_GID,
  statUid = uid,
  statGid = gid,
  mode = PRIVATE_DIRECTORY_MODE,
  getuid,
  getgid,
  stat,
  lstat: lstatOverride,
} = {}) {
  const calls = { getuid: 0, getgid: 0, lstat: 0, targets: [] };
  const ownerStat = stat ?? { uid: statUid, gid: statGid, mode };
  const identityIo = {
    getuid: getuid ?? (() => { calls.getuid += 1; return uid; }),
    getgid: getgid ?? (() => { calls.getgid += 1; return gid; }),
    lstat: lstatOverride ?? (async (target) => {
      calls.lstat += 1;
      calls.targets.push(target);
      return ownerStat;
    }),
  };
  return { calls, identityIo, ownerStat, pair: `${uid}:${gid}` };
}

function defaultFixtureIdentityIo() {
  return ownerIdentityFixture().identityIo;
}

function materializeObservation(options) {
  return rawMaterializeObservation({ identityIo: defaultFixtureIdentityIo(), ...options });
}

function executeActor(context, options = {}) {
  return rawExecuteActor(context, { identityIo: defaultFixtureIdentityIo(), ...options });
}

async function fixtureContext({ base = BASE } = {}) {
  const created = await mkdtemp(path.join(os.tmpdir(), "task005-git-materials-"));
  const runnerTemp = await realpath(created);
  const eventPath = path.join(runnerTemp, "event.json");
  const event = {
    action: "opened",
    number: 205,
    repository: { full_name: "CleMeY15/auto-world" },
    pull_request: {
      draft: true,
      state: "open",
      base: { ref: "main", sha: base, repo: { full_name: "CleMeY15/auto-world" } },
      head: { ref: "codex/task-0005-git-materials-v11", sha: HEAD,
        repo: { full_name: "CleMeY15/auto-world" } },
    },
  };
  await writeFile(eventPath, JSON.stringify(event), { mode: 0o600 });
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_ACTION: "opened",
    GITHUB_BASE_REF: "main",
    GITHUB_HEAD_REF: "codex/task-0005-git-materials-v11",
    GITHUB_HEAD_SHA: HEAD,
    GITHUB_SHA: MERGE,
    GITHUB_RUN_NUMBER: "1",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "40999999999",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/task005-git-materials-v11.yml@refs/pull/205/merge",
    RUNNER_TEMP: runnerTemp,
    PATH: process.env.PATH ?? "",
  };
  return { runnerTemp, eventPath, env };
}

function completeHelp() {
  return {
    root: Buffer.from("apk-tools command summary"),
    add: Buffer.from("add --simulate --keys-dir --repositories-file --root --root-tmpfs[=AUTO] --network[=BOOL]"),
    fetch: Buffer.from("fetch --output --stdout"),
    verify: Buffer.from("verify"),
    query: Buffer.from("query --format --fields --from --recursive"),
    manifest: Buffer.from("manifest"),
    version: Buffer.from("version --test"),
  };
}

const GLOBAL_HELP_TOKENS = Object.freeze(["--keys-dir", "--repositories-file", "--root"]);
const NETWORK_BOOL_TOKEN = "--network[=BOOL]";
const NETWORK_ALIAS_TOKEN = "--no-network";
const ASCII_HELP_DELIMITERS = Object.freeze([
  ["space", " "], ["tab", "\t"], ["LF", "\n"], ["VT", "\v"], ["FF", "\f"], ["CR", "\r"],
]);

function helpWithAdd(add, root = completeHelp().root) {
  return { ...completeHelp(), root: Buffer.isBuffer(root) ? root : Buffer.from(root),
    add: Buffer.isBuffer(add) ? add : Buffer.from(add) };
}

function canonicalAddTokens(network = NETWORK_BOOL_TOKEN) {
  return ["add", "--simulate", ...GLOBAL_HELP_TOKENS, "--root-tmpfs[=AUTO]", network];
}

function addTokensWithoutBareRoot(network = NETWORK_BOOL_TOKEN) {
  return canonicalAddTokens(network).filter((token) => token !== "--root");
}

function sourceDerivedHelp() {
  const tokens = canonicalAddTokens();
  const rootAt = tokens.indexOf("--root");
  assert.notEqual(rootAt, -1);
  tokens.splice(rootAt, 1, "--root,", "-p", "ROOT");
  return helpWithAdd(tokens.join(" "));
}

function helpWithRootPresentation(tokens, position = "end") {
  const base = addTokensWithoutBareRoot();
  return helpWithAdd((position === "start" ? [...tokens, ...base] : [...base, ...tokens]).join(" "));
}

function helpWithoutExactAddToken(token, decoys = []) {
  const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
  const tokens = canonicalAddTokens(network).filter((value) => value !== token);
  return helpWithAdd([...tokens, ...decoys].join(" "), `${token} ${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`);
}

function helpWithoutManifestCapability() {
  return { ...completeHelp(), manifest: Buffer.from("unsupported operation") };
}

function enoughCapacity() {
  return { bavail: BigInt(30 * 1024 ** 2), bsize: 1024n };
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const INSTALLED_PATH = "/lib/apk/db/installed";
const CHECKSUM_ENTRYPOINT = "/bin/busybox";
const CHECKSUM_ARGS = Object.freeze(["sha256sum", INSTALLED_PATH]);
const LEGACY_CHECKSUM_ENTRYPOINT = "/bin/sha256sum";
const V6_FETCH_SCRIPT = "set -eu; set -o pipefail; /sbin/apk --keys-dir /etc/apk/keys --repositories-file /materials/repositories \"$1\" fetch --stdout \"$2\" | /bin/sha256sum";
const V7_FETCH_SCRIPT = V6_FETCH_SCRIPT.replace("| /bin/sha256sum", "| /bin/busybox sha256sum");
// The private native stderr was not retained. This models its measured byte count only.
const syntheticObservedStderr = () => Buffer.alloc(329, 0x78);
const INDEX_VERIFY_OPERATION = "MATERIAL_INDEX_VERIFY";
const INDEX_VERIFY_ENTRYPOINT = "/sbin/apk";
const INDEX_VERIFY_ARGS = Object.freeze([
  "--keys-dir", "/etc/apk/keys", "verify", "/materials/repo/APKINDEX.tar.gz",
]);
const INDEX_VERIFY_PREFIX = "/materials/repo/APKINDEX.tar.gz: ";
const INDEX_VERIFY_UNKNOWN = "APK_INDEX_VERIFY_UNKNOWN";
const OMIT_STREAM = Symbol("OMIT_STREAM");
const INDEX_VERIFY_KNOWN = Object.freeze([
  Object.freeze(["UNTRUSTED signature", "APKE_SIGNATURE_UNTRUSTED"]),
  Object.freeze(["BAD signature", "APKE_SIGNATURE_INVALID"]),
  Object.freeze(["crypto error", "APKE_CRYPTO_ERROR"]),
  Object.freeze(["cryptographic algorithm not supported", "APKE_CRYPTO_NOT_SUPPORTED"]),
  Object.freeze(["cryptographic key format not recognized", "APKE_CRYPTO_KEY_FORMAT"]),
  Object.freeze(["unexpected end of file", "APKE_EOF"]),
  Object.freeze(["file format is invalid or inconsistent", "APKE_FORMAT_INVALID"]),
  Object.freeze(["file format is obsolete (e.g. missing embedded checksum)", "APKE_FORMAT_OBSOLETE"]),
  Object.freeze(["file format not supported (in this applet)", "APKE_FORMAT_NOT_SUPPORTED"]),
  Object.freeze(["v2 index format error", "APKE_V2NDX_FORMAT"]),
  Object.freeze(["v2 package format error", "APKE_V2PKG_FORMAT"]),
  Object.freeze(["v2 package integrity error", "APKE_V2PKG_INTEGRITY"]),
  Object.freeze(["file integrity error", "APKE_FILE_INTEGRITY"]),
  Object.freeze(["Permission denied", "EACCES"]),
]);

function indexVerifyLine(literal) {
  return Buffer.from(`${INDEX_VERIFY_PREFIX}${literal}\n`);
}

function projectedFailure(error) {
  return JSON.parse(publicFailure(error));
}

function indexVerifierFailure(stdout, stderr = Buffer.alloc(0), overrides = {}) {
  const result = { status: 1, ...overrides };
  if (stdout !== OMIT_STREAM) result.stdout = stdout;
  if (stderr !== OMIT_STREAM) result.stderr = stderr;
  return captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
    INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
}

function indexDiagnostic(stdoutBytes, stderrBytes = 0, overrides = {}) {
  return expectedDiagnostic(INDEX_VERIFY_OPERATION, "EXIT_STATUS", {
    status: 1, stdoutBytes, stderrBytes, ...overrides,
  });
}

async function readMarkerBytes(bytes) {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  return readFailureMarker(context, {
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
      nlink: 1, mode: 0o100600, size: bytes.length }),
    readFile: async () => bytes,
  });
}

function response(bytes, headers = {}) {
  return new globalThis.Response(bytes, { status: 200, headers: { "content-length": String(bytes.length), ...headers } });
}

function observationFixture({
  repositoryHash,
  secfixes = { "0": ["CVE-2021-29468"] },
  failAt = -1,
  failResult,
  installedBeforeHash = "b".repeat(64),
  installedAfterHash = installedBeforeHash,
  installedOutput,
  bindingOutput,
} = {}) {
  const index = Buffer.from("signed-index-fixture");
  const apk = Buffer.from("signed-git-apk-fixture");
  const secdb = Buffer.from(JSON.stringify({
    distroversion: "v3.24",
    reponame: "main",
    packages: [{ pkg: { name: "git", secfixes } }],
  }));
  const calls = [];
  const fetchCalls = [];
  const records = [];
  let installedCalls = 0;
  const command = (executable, args, options) => {
    assert.equal(executable, "docker");
    calls.push([...args]);
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    if (records.length - 1 === failAt) {
      return failResult ?? { status: 23, stdout: Buffer.from("PRIVATE_STDOUT_SENTINEL"),
        stderr: Buffer.from("PRIVATE_STDERR_SENTINEL") };
    }
    const entrypointAt = args.indexOf("--entrypoint");
    assert.notEqual(entrypointAt, -1);
    const entrypoint = args[entrypointAt + 1];
    const carrierArgs = args.slice(entrypointAt + 3);
    let stdout;
    if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("find /etc/apk/keys")) {
      stdout = `alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub\t451\t${"a".repeat(64)}\n`;
    } else if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("fetch --stdout")) {
      assert.match(carrierArgs.at(1), /\| \/bin\/busybox sha256sum$/u);
      stdout = bindingOutput ?? `${repositoryHash ?? hash(apk)}  -\n`;
    } else if (entrypoint === "/bin/busybox") {
      assert.deepEqual(carrierArgs, ["sha256sum", "/lib/apk/db/installed"]);
      const digest = installedCalls++ === 0 ? installedBeforeHash : installedAfterHash;
      stdout = installedOutput ?? `${digest}  /lib/apk/db/installed\n`;
    } else if (entrypoint === "/bin/sha256sum") {
      return { status: 127, stdout: Buffer.alloc(0), stderr: syntheticObservedStderr() };
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("verify")) {
      stdout = "";
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("add")) {
      stdout = "(1/1) Installing git (2.54.0-r0)\nOK: 12 MiB in 15 packages\n";
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("query")) {
      const queryAt = carrierArgs.indexOf("query");
      assert.deepEqual(carrierArgs.slice(queryAt + 1, queryAt + 3), ["--from", "repositories"]);
      const fieldsAt = carrierArgs.indexOf("--fields");
      assert.equal(carrierArgs[fieldsAt + 1],
        "name,version,arch,file-size,installed-size,license,origin,maintainer,commit,depends,install-if");
      stdout = JSON.stringify([{ name: "git", version: "2.54.0-r0", arch: "x86_64",
        "file-size": apk.length, "installed-size": 1024, license: "GPL-2.0-only",
        origin: "git", maintainer: "Alpine Developers <alpine-devel@lists.alpinelinux.org>",
        commit: "c".repeat(40), depends: ["so:libc.musl-x86_64.so.1"], "install-if": [] }]);
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("manifest")) {
      stdout = `SHA256:${"d".repeat(64)}  usr/bin/git\n`;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("version")) {
      stdout = ">\n";
    } else {
      assert.fail(`unexpected injected command: ${entrypoint} ${carrierArgs.join(" ")}`);
    }
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url.endsWith("APKINDEX.tar.gz")) return response(index);
    if (url.endsWith("git-2.54.0-r0.apk")) return response(apk);
    if (url.endsWith("main.json")) return response(secdb, {
      etag: '"secdb-fixture"', "last-modified": "Wed, 28 Oct 2026 20:00:00 GMT",
    });
    assert.fail(`unexpected injected URL: ${url}`);
  };
  return { apk, calls, command, fetchCalls, fetchImpl, records };
}

function transactionEntries(total, gitOrder = total) {
  assert.ok(Number.isSafeInteger(total) && total > 0);
  assert.ok(Number.isSafeInteger(gitOrder) && gitOrder >= 1 && gitOrder <= total);
  return Array.from({ length: total }, (_, index) => {
    const order = index + 1;
    return order === gitOrder
      ? { action: "ADD", name: "git", order, version: "2.54.0-r0" }
      : { action: "ADD", name: `fixture-${String(order).padStart(2, "0")}`, order, version: `1.${order}-r0` };
  });
}

function transactionText(entries, { canonical = false, lineEnding = "\n", informational = false } = {}) {
  const total = entries.length;
  const width = String(total).length;
  const rows = entries.map((entry) => {
    const ordinal = canonical ? String(entry.order).padStart(width, " ") : String(entry.order);
    return `(${ordinal}/${total}) Installing ${entry.name} (${entry.version})`;
  });
  if (informational) rows.unshift("fetching local signed index");
  rows.push(`OK: ${total + 12} MiB in ${total + 20} packages`);
  return `${rows.join(lineEnding)}${lineEnding}`;
}

function insertHostileRow(text, hostile, position, lineEnding = "\n") {
  const rows = text.split(lineEnding);
  assert.equal(rows.at(-1), "");
  rows.pop();
  const summaryAt = rows.length - 1;
  const insertionAt = position === "first" ? 0 : position === "middle" ? Math.floor(summaryAt / 2) : summaryAt;
  rows.splice(insertionAt, 0, hostile);
  return `${rows.join(lineEnding)}${lineEnding}`;
}

function assertSolverInvalid(text) {
  assert.throws(() => parseTransaction(Buffer.from(text)), { code: "task005_git_materials_solver_invalid" });
}

function tenPackageObservationFixture({ canonical = false, firstOutput, secondOutput,
  installedBeforeHash = "b".repeat(64), installedAfterHash = installedBeforeHash } = {}) {
  const entries = transactionEntries(10, 6);
  const defaultOutput = transactionText(entries, { canonical, informational: true });
  const outputs = [firstOutput ?? defaultOutput, secondOutput ?? defaultOutput];
  const index = Buffer.from("signed-index-fixture");
  const packageBytes = new Map(entries.map((entry) => [entry.name,
    Buffer.from(`signed-${entry.name}-apk-fixture`)]));
  const secdb = Buffer.from(JSON.stringify({
    distroversion: "v3.24",
    reponame: "main",
    packages: [{ pkg: { name: "git", secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } } }],
  }));
  const fetchCalls = [];
  const records = [];
  let installedCalls = 0;
  let simulationCalls = 0;
  const command = (executable, args, options) => {
    assert.equal(executable, "docker");
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    const entrypointAt = args.indexOf("--entrypoint");
    assert.notEqual(entrypointAt, -1);
    const entrypoint = args[entrypointAt + 1];
    const carrierArgs = args.slice(entrypointAt + 3);
    let stdout;
    if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("find /etc/apk/keys")) {
      stdout = `alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub\t451\t${"a".repeat(64)}\n`;
    } else if (entrypoint === "/bin/sh" && carrierArgs.at(1)?.includes("fetch --stdout")) {
      const selector = carrierArgs.at(-1);
      const name = selector.slice(0, selector.indexOf("="));
      stdout = `${hash(packageBytes.get(name))}  -\n`;
    } else if (entrypoint === "/bin/busybox") {
      const digest = installedCalls++ === 0 ? installedBeforeHash : installedAfterHash;
      stdout = `${digest}  /lib/apk/db/installed\n`;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("verify")) {
      stdout = "";
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("add")) {
      stdout = outputs[simulationCalls++];
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("query")) {
      stdout = JSON.stringify(entries.map((entry) => ({
        name: entry.name,
        version: entry.version,
        arch: "x86_64",
        "file-size": packageBytes.get(entry.name).length,
        "installed-size": 1024,
        license: "GPL-2.0-only",
        origin: entry.name,
        maintainer: "Alpine Developers <alpine-devel@lists.alpinelinux.org>",
        commit: "c".repeat(40),
        depends: [],
        "install-if": [],
      })));
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("manifest")) {
      const filename = carrierArgs.at(-1).split("/").at(-1);
      stdout = `SHA256:${"d".repeat(64)}  usr/share/${filename}.txt\n`;
    } else if (entrypoint === "/sbin/apk" && carrierArgs.includes("version")) {
      stdout = ">\n";
    } else {
      assert.fail(`unexpected injected command: ${entrypoint} ${carrierArgs.join(" ")}`);
    }
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url.endsWith("APKINDEX.tar.gz")) return response(index);
    if (url.endsWith("main.json")) return response(secdb, {
      etag: '"secdb-fixture"', "last-modified": "Wed, 28 Oct 2026 20:00:00 GMT",
    });
    for (const entry of entries) {
      if (url.endsWith(`${entry.name}-${entry.version}.apk`)) return response(packageBytes.get(entry.name));
    }
    assert.fail(`unexpected injected URL: ${url}`);
  };
  return { command, entries, fetchCalls, fetchImpl, records };
}

async function collectTenPackageObservation(options = {}) {
  const fixture = await fixtureContext();
  const observed = tenPackageObservationFixture(options);
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const evidence = await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const transcript = observed.records.map((record) => normalizedCommandRecord(record, context));
    return { entries: observed.entries, evidence, fetchCalls: observed.fetchCalls, transcript };
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function captureTenPackageRefusal(options) {
  const fixture = await fixtureContext();
  const observed = tenPackageObservationFixture(options);
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }));
    return { error, fetchCalls: observed.fetchCalls, records: observed.records };
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

function recordedCarrierArgs(record) {
  const entrypointAt = record.args.indexOf("--entrypoint");
  assert.notEqual(entrypointAt, -1);
  return { entrypoint: record.args[entrypointAt + 1], args: record.args.slice(entrypointAt + 3) };
}

function recordedOwnerPair(record) {
  const userIndexes = record.args.flatMap((value, index) => value === "--user" ? [index] : []);
  assert.deepEqual(userIndexes, [6]);
  assert.deepEqual(record.args.slice(4, 10), ["--platform", "linux/amd64", "--user",
    record.args[7], "--network", "none"]);
  return record.args[7];
}

function reverseOwnerBindingToV8(records, expectedPair) {
  assert.equal(records.length, 11);
  const reversed = globalThis.structuredClone(records);
  const changed = [];
  for (const [index, record] of records.entries()) {
    assert.equal(recordedOwnerPair(record), expectedPair);
    const userAt = reversed[index].args.indexOf("--user");
    assert.equal(userAt, 6);
    reversed[index].args.splice(userAt, 2);
    if (!isDeepStrictEqual(record, reversed[index])) changed.push(index);
  }
  assert.deepEqual(changed, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  return reversed;
}

function recordedNetworkArguments(records) {
  assert.equal(records.length, 11);
  const firstSimulation = recordedCarrierArgs(records[3]);
  const query = recordedCarrierArgs(records[4]);
  const binding = recordedCarrierArgs(records[6]);
  const secondSimulation = recordedCarrierArgs(records[8]);
  assert.equal(firstSimulation.entrypoint, "/sbin/apk");
  assert.equal(query.entrypoint, "/sbin/apk");
  assert.equal(binding.entrypoint, "/bin/sh");
  assert.equal(secondSimulation.entrypoint, "/sbin/apk");
  const selectApkNetwork = ({ args }) => args.find((value) => value === "--network=no" || value === "--no-network");
  assert.equal(binding.args[2], "actor");
  return [selectApkNetwork(firstSimulation), selectApkNetwork(query), binding.args[3],
    selectApkNetwork(secondSimulation)];
}

async function materialNetworkArguments(help) {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help, imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    return recordedNetworkArguments(observed.records);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function assertMaterialNetworkRefusal(help) {
  const fixture = await fixtureContext();
  let childCalls = 0;
  let fetchCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    const before = { ...resources, containerNames: [...resources.containerNames] };
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help, imageId: FIXTURE_IMAGE_ID },
      command: () => { childCalls += 1; assert.fail("network refusal must precede child execution"); },
      fetchImpl: () => { fetchCalls += 1; assert.fail("network refusal must precede fetch"); },
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
    }));
    assert.equal(error.code, "task005_git_materials_probe_not_run");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    assert.equal(childCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(resources, before);
    assert.deepEqual(await readdir(context.privateRoot), []);
    await assert.rejects(lstat(path.join(context.privateRoot, "repo")), { code: "ENOENT" });
    await assert.rejects(lstat(path.join(context.privateRoot, "repositories")), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function assertIdentityRefusal(identityIo, verify = () => {}) {
  const fixture = await fixtureContext();
  let childCalls = 0;
  let fetchCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    const before = globalThis.structuredClone(resources);
    const error = await captureRejected(() => rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: () => { childCalls += 1; assert.fail("identity refusal must precede child execution"); },
      fetchImpl: () => { fetchCalls += 1; assert.fail("identity refusal must precede fetch"); },
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
      identityIo,
    }));
    assert.equal(error.code, "task005_git_materials_private_root_invalid");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
    assert.equal(childCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(resources, before);
    assert.deepEqual(await readdir(context.privateRoot), []);
    await assert.rejects(lstat(path.join(context.privateRoot, "repo")), { code: "ENOENT" });
    await assert.rejects(lstat(path.join(context.privateRoot, "repositories")), { code: "ENOENT" });
    verify(error, context);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function withBoundMaterialOwner(callback, {
  uid = FIXTURE_UID, gid = FIXTURE_GID, identityIo,
} = {}) {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  const owner = identityIo === undefined ? ownerIdentityFixture({ uid, gid })
    : { calls: undefined, identityIo, pair: `${uid}:${gid}` };
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    await rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
      identityIo: owner.identityIo,
    });
    await callback({ context, fixture, observed, owner, resources });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
}

async function cleanupPrivate(context) {
  await rm(context.privateRoot, { recursive: true });
}

async function readPublicEvidence(context) {
  return {
    receipt: JSON.parse(await readFile(path.join(context.publicRoot, "receipt.json"), "utf8")),
    manifest: JSON.parse(await readFile(path.join(context.publicRoot, "manifest.json"), "utf8")),
  };
}

function captureThrown(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail("expected callback to throw");
}

async function captureRejected(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  assert.fail("expected callback to reject");
}

function expectedDiagnostic(operation, reason, {
  status = null, signal = null, stdoutBytes = 0, stderrBytes = 0,
} = {}) {
  return { operation, reason, status, signal, stdoutBytes, stderrBytes };
}

function childFailure(operation, result = { status: 23, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) {
  return captureThrown(() => validateCommandResult(result, [0], operation));
}

function normalizedCommandRecord(record, context) {
  const normalize = (value) => typeof value === "string"
    ? value.replaceAll(context.runnerTemp, "<RUNNER_TEMP>")
      .replace(/aw-task005-git-materials-[0-9]+-[0-9]{3}/gu, "aw-task005-git-materials-<RUN_ID>-<ORDINAL>")
      .replaceAll(context.runId, "<RUN_ID>")
      .replaceAll("git-materials-v11", "git-materials-v6")
      .replaceAll("git-materials-v6", "git-materials-v5")
      .replaceAll("git-materials-v5", "git-materials-v4")
      .replaceAll("git-materials-v4", "git-materials-v3")
      .replaceAll("\\", "/")
    : value;
  return {
    executable: record.executable,
    args: record.args.map(normalize),
    cwd: normalize(record.options.cwd),
    env: Object.fromEntries(Object.entries(record.options.env).sort().map(([key, value]) => [key,
      key === "PATH" ? "<PATH>" : key === "DOCKER_CONFIG" && value !== "" ? "<DOCKER_CONFIG>" : normalize(value)])),
    timeoutMs: record.options.timeoutMs,
  };
}

function reverseChecksumInvocationsToV6(records) {
  assert.equal(records.length, 11);
  const reversed = globalThis.structuredClone(records);
  const directIndexes = [1, 9];
  for (const index of directIndexes) {
    const current = recordedCarrierArgs(records[index]);
    assert.equal(current.entrypoint, CHECKSUM_ENTRYPOINT);
    assert.deepEqual(current.args, CHECKSUM_ARGS);
    const entrypointAt = reversed[index].args.indexOf("--entrypoint");
    reversed[index].args[entrypointAt + 1] = LEGACY_CHECKSUM_ENTRYPOINT;
    reversed[index].args.splice(entrypointAt + 3, 1);
    assert.deepEqual(recordedCarrierArgs(reversed[index]), {
      entrypoint: LEGACY_CHECKSUM_ENTRYPOINT, args: [INSTALLED_PATH],
    });
  }
  const binding = recordedCarrierArgs(records[6]);
  assert.equal(binding.entrypoint, "/bin/sh");
  assert.deepEqual(binding.args.slice(0, 3), ["-ceu", V7_FETCH_SCRIPT, "actor"]);
  const bindingEntrypointAt = reversed[6].args.indexOf("--entrypoint");
  assert.equal(reversed[6].args[bindingEntrypointAt + 4], V7_FETCH_SCRIPT);
  reversed[6].args[bindingEntrypointAt + 4] = V6_FETCH_SCRIPT;
  assert.equal(recordedCarrierArgs(reversed[6]).args[1], V6_FETCH_SCRIPT);
  const changed = records.map((record, index) => ({ record, reversed: reversed[index], index }))
    .filter(({ record, reversed: value }) => !isDeepStrictEqual(record, value))
    .map(({ index }) => index);
  assert.deepEqual(changed, [1, 6, 9]);
  return reversed;
}

const CARRIER_DIGEST = "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747";
const CARRIER_REFERENCE = `golang@${CARRIER_DIGEST}`;
const FIXTURE_IMAGE_ID = `sha256:${"e".repeat(64)}`;
const HELP_CASES = Object.freeze([
  Object.freeze({ operation: "PROBE_HELP_ROOT", args: Object.freeze(["--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_ADD", args: Object.freeze(["add", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_VERIFY", args: Object.freeze(["verify", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_QUERY", args: Object.freeze(["query", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_MANIFEST", args: Object.freeze(["manifest", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_FETCH", args: Object.freeze(["fetch", "--help"]) }),
  Object.freeze({ operation: "PROBE_HELP_VERSION", args: Object.freeze(["version", "--help"]) }),
]);

const MATERIAL_OPERATIONS = Object.freeze([
  "MATERIAL_KEYS", "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST",
  "MATERIAL_QUERY", "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST",
  "MATERIAL_SIMULATE_SECOND", "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE",
]);

const DIRECT_OPERATIONS = Object.freeze([
  "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "CLEANUP_CONTAINER_DISCOVER",
  "CLEANUP_CONTAINER_LIST", "CLEANUP_CONTAINER_REMOVE", "CLEANUP_IMAGE_LIST", "CLEANUP_IMAGE_REMOVE",
]);

function freshCarrierResources() {
  return { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 };
}

function carrierContext() {
  return { runId: "40999999999", privateRoot: "C:/private" };
}

function probeCommandFixture(context, failAt = -1, help = completeHelp()) {
  const records = [];
  const command = (executable, args, options) => {
    const index = records.length;
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    assert.equal(executable, "docker");
    assert.deepEqual(Object.keys(options.env).sort(), ["DOCKER_CONFIG", "LANG", "LC_ALL", "PATH"]);
    if (index === 0) {
      assert.deepEqual(args, ["image", "ls", "--all", "--digests", "--no-trunc", "--format",
        "{{.Repository}}@{{.Digest}}|{{.ID}}"]);
      assert.equal(options.cwd, context.runnerTemp);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
    } else if (index === 1) {
      assert.deepEqual(args, ["pull", "--platform", "linux/amd64", CARRIER_REFERENCE]);
      assert.equal(options.cwd, context.privateRoot);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= limits.transferMs);
    } else if (index === 2) {
      assert.deepEqual(args, ["image", "inspect", "--format", "{{json .RepoDigests}}|{{.Id}}", CARRIER_REFERENCE]);
      assert.equal(options.cwd, context.privateRoot);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
    } else {
      const expectedCarrierArgs = [
        ["/sbin/apk", ["--version"]], ["/sbin/apk", ["--help"]], ["/sbin/apk", ["add", "--help"]],
        ["/sbin/apk", ["verify", "--help"]], ["/sbin/apk", ["query", "--help"]],
        ["/sbin/apk", ["manifest", "--help"]], ["/sbin/apk", ["fetch", "--help"]],
        ["/sbin/apk", ["version", "--help"]],
      ][index - 3];
      const name = `aw-task005-git-materials-${context.runId}-${String(index - 2).padStart(3, "0")}`;
      assert.deepEqual(args, ["run", "--rm", "--pull", "never", "--platform", "linux/amd64", "--network", "none",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pids-limit", "64",
        "--memory", "256m", "--memory-swap", "256m", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m", "--name", name,
        "--label", "com.auto-world.task005.git-materials-v11=true",
        "--label", `com.auto-world.github-run-id=${context.runId}`,
        "--entrypoint", expectedCarrierArgs[0], CARRIER_REFERENCE, ...expectedCarrierArgs[1]]);
      assert.equal(options.cwd, context.privateRoot);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= limits.childMs);
    }
    if (index === failAt) return { status: 23, stdout: Buffer.alloc(0), stderr: Buffer.from("PRIVATE_PROBE") };
    let stdout = "";
    if (index === 0) stdout = "";
    else if (index === 1) stdout = "pulled\n";
    else if (index === 2) stdout = `${JSON.stringify([CARRIER_REFERENCE])}|${FIXTURE_IMAGE_ID}\n`;
    else {
      const entrypointAt = args.indexOf("--entrypoint");
      const entrypoint = args[entrypointAt + 1];
      const carrierArgs = args.slice(entrypointAt + 3);
      if (entrypoint === "/sbin/apk" && carrierArgs.length === 1 && carrierArgs[0] === "--version") {
        stdout = "apk-tools 3.0.0, compiled for x86_64.\n";
      } else if (entrypoint === "/sbin/apk") {
        const key = carrierArgs[0] === "--help" ? "root" : carrierArgs[0];
        stdout = help[key].toString("utf8");
      } else assert.fail(`unexpected probe command ${args.join(" ")}`);
    }
    return { status: index >= 4 ? 1 : 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  return { command, records };
}

async function cleanupFaultFixture(context, failAt) {
  await mkdir(context.privateRoot, { mode: 0o700 });
  await writeFile(path.join(context.privateRoot, "carrier-initially-absent"), "INITIAL_ABSENT\n", { mode: 0o600 });
  await writeFile(path.join(context.privateRoot, "carrier-image-id"), `${FIXTURE_IMAGE_ID}\n`, { mode: 0o600 });
  const name = `aw-task005-git-materials-${context.runId}-001`;
  const records = [];
  let containerRemoved = false;
  let imageRemoved = false;
  const command = (executable, args, options) => {
    const index = records.length;
    records.push({ executable, args: [...args], options: { ...options, env: { ...options.env } } });
    assert.equal(executable, "docker");
    assert.deepEqual(Object.keys(options.env).sort(), ["DOCKER_CONFIG", "LANG", "LC_ALL", "PATH"]);
    assert.equal(options.cwd, context.runnerTemp);
    if (index === 0) {
      assert.deepEqual(args, ["container", "ls", "--all", "--filter",
        "label=com.auto-world.task005.git-materials-v11=true", "--filter",
        `label=com.auto-world.github-run-id=${context.runId}`, "--format", "{{.Names}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 1 || index === 3) {
      assert.deepEqual(args, ["container", "ls", "--all", "--format",
        "{{.Names}}|{{.Label \"com.auto-world.task005.git-materials-v11\"}}|{{.Label \"com.auto-world.github-run-id\"}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 2) {
      assert.deepEqual(args, ["container", "rm", "--force", name]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 4 || index === 6) {
      assert.deepEqual(args, ["image", "ls", "--all", "--digests", "--no-trunc", "--format",
        "{{.Repository}}@{{.Digest}}|{{.ID}}"]);
      assert.equal(options.timeoutMs, 30_000);
    } else if (index === 5) {
      assert.deepEqual(args, ["image", "rm", CARRIER_REFERENCE]);
      assert.equal(options.timeoutMs, 60_000);
    }
    if (index === failAt) return { status: 23, stdout: Buffer.alloc(0), stderr: Buffer.from("PRIVATE_CLEANUP") };
    let stdout = "";
    if (args[0] === "container" && args[1] === "ls" && args.includes("--filter")) stdout = `${name}\n`;
    else if (args[0] === "container" && args[1] === "ls") {
      stdout = containerRemoved ? "" : `${name}|true|${context.runId}\n`;
    } else if (args[0] === "container" && args[1] === "rm") containerRemoved = true;
    else if (args[0] === "image" && args[1] === "ls") {
      stdout = imageRemoved ? "" : `${CARRIER_REFERENCE}|${FIXTURE_IMAGE_ID}\n`;
    } else if (args[0] === "image" && args[1] === "rm") imageRemoved = true;
    else assert.fail(`unexpected cleanup command ${args.join(" ")}`);
    return { status: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) };
  };
  return { command, records };
}

test("supported partial collection emits a non-authoritative material observation", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const evidence = await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: `sha256:${"e".repeat(64)}` },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
    });
    validateEvidence(evidence, context);
    assert.equal(evidence.receipt.state, "MATERIAL_OBSERVATION_ONLY");
    assert.equal(evidence.receipt.source.acceptedBase, BASE);
    assert.equal(evidence.receipt.installationAuthority, false);
    assert.deepEqual(evidence.receipt.boundaries, {
      hookContent: "NOT_INSPECTED",
      indexMetadata: "OBSERVED",
      nonregularFileMetadata: "NOT_INSPECTED",
      regularFileManifest: "OBSERVED",
      repoCommitMeaning: "SIGNED_INDEX_DECLARATION_ONLY",
    });
    assert.deepEqual(evidence.receipt.execution, {
      gitExecuted: false, packageInstalled: false, packagePayloadExecuted: false,
    });
    assert.equal(evidence.receipt.security.stage2, "BLOCKED");
    assert.equal(evidence.manifest.packages[0].indexBinding, "VERIFIED_BY_APK_FETCH");
    assert.equal(evidence.manifest.packages[0].localSignature, "VERIFIED_BY_APK_VERIFY");
    assert.ok(observed.calls.every((args) => !args.includes("git")));
    assert.ok(observed.calls.filter((args) => args.includes("add")).every((args) => args.includes("--simulate")));
    assert.equal((await lstat(context.privateRoot)).isDirectory(), true);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("representative legacy checksum entrypoint retains the observed closed child diagnostic", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const legacy = globalThis.structuredClone(observed.records[1]);
    const entrypointAt = legacy.args.indexOf("--entrypoint");
    legacy.args[entrypointAt + 1] = LEGACY_CHECKSUM_ENTRYPOINT;
    legacy.args.splice(entrypointAt + 3, 1);
    const result = observed.command(legacy.executable, legacy.args, legacy.options);
    const error = captureThrown(() => validateCommandResult(result, [0], "MATERIAL_INSTALLED_BEFORE"));
    assert.equal(error.code, "task005_git_materials_child_failed");
    assert.deepEqual(error.childDiagnostic, expectedDiagnostic("MATERIAL_INSTALLED_BEFORE", "EXIT_STATUS", {
      status: 127, stdoutBytes: 0, stderrBytes: 329,
    }));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("representative checksum fixture rejects altered BusyBox invocation vectors", async (t) => {
  const fixture = await fixtureContext();
  const observed = observationFixture();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const valid = observed.records[1];
    const cases = [
      ["different multiplexer path", (args, at) => { args[at + 1] = "/usr/bin/busybox"; }],
      ["missing applet", (args, at) => { args.splice(at + 3, 1); }],
      ["different installed path", (args, at) => { args[at + 4] = "/tmp/installed"; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, () => {
        const args = [...valid.args];
        const entrypointAt = args.indexOf("--entrypoint");
        mutate(args, entrypointAt);
        assert.throws(() => observed.command(valid.executable, args, valid.options), /unexpected injected command|deep-equal/u);
      });
    }
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("installed checksum parser rejects noncanonical native output", async (t) => {
  const cases = [
    ["single separator space", `${"b".repeat(64)} ${INSTALLED_PATH}\n`],
    ["uppercase digest", `${"B".repeat(64)}  ${INSTALLED_PATH}\n`],
    ["short digest", `${"b".repeat(63)}  ${INSTALLED_PATH}\n`],
    ["missing filename marker", `${"b".repeat(64)}\n`],
  ];
  for (const [name, installedOutput] of cases) {
    await t.test(name, async () => {
      const fixture = await fixtureContext();
      const observed = observationFixture({ installedOutput });
      try {
        const context = await requireContext(fixture.env, "linux");
        await mkdir(context.privateRoot, { mode: 0o700 });
        await assert.rejects(materializeObservation({
          availableBytes: 30 * 1024 ** 2,
          context,
          probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
            imageId: FIXTURE_IMAGE_ID },
          command: observed.command,
          fetchImpl: observed.fetchImpl,
          now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
          resources: freshCarrierResources(),
        }), { code: "task005_git_materials_material_invalid" });
        assert.equal(observed.records.length, 2);
        assert.equal(observed.fetchCalls.length, 0);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("stdin checksum parser rejects a missing dash marker", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ bindingOutput: `${hash(Buffer.from("signed-git-apk-fixture"))}  stdin\n` });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await assert.rejects(materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }), { code: "task005_git_materials_material_invalid" });
    assert.equal(observed.records.length, 7);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("successful checksum status with stderr remains a material refusal", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 1,
    failResult: { status: 0, stdout: Buffer.from(`${"b".repeat(64)}  ${INSTALLED_PATH}\n`),
      stderr: Buffer.from("PRIVATE_NATIVE_STDERR") } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    assert.equal(observed.fetchCalls.length, 0);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("installed-before native failure stops and publishes through the full actor lifecycle", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 1,
    failResult: { status: 127, stdout: Buffer.alloc(0), stderr: syntheticObservedStderr() } });
  let privateSnapshot;
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      cleanup: async () => {
        privateSnapshot = {
          repo: await readdir(path.join(context.privateRoot, "repo")),
          repositories: await readFile(path.join(context.privateRoot, "repositories"), "utf8"),
        };
        await cleanupPrivate(context);
      },
    }));
    assert.equal(error.code, "task005_git_materials_child_failed");
    assert.deepEqual(error.childDiagnostic, expectedDiagnostic("MATERIAL_INSTALLED_BEFORE", "EXIT_STATUS", {
      status: 127, stdoutBytes: 0, stderrBytes: 329,
    }));
    assert.equal(observed.records.length, 2);
    assert.deepEqual(recordedCarrierArgs(observed.records[1]), {
      entrypoint: CHECKSUM_ENTRYPOINT, args: CHECKSUM_ARGS,
    });
    assert.equal(observed.fetchCalls.length, 0);
    assert.deepEqual(privateSnapshot, {
      repo: [], repositories: "ndx file:///materials/repo/APKINDEX.tar.gz\n",
    });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const { receipt } = await readPublicEvidence(context);
    assert.equal(receipt.code, "task005_git_materials_child_failed");
    assert.deepEqual(receipt.childDiagnostic, error.childDiagnostic);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("installed database mismatch refuses after the second checksum and before SecDB acquisition", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ installedBeforeHash: "b".repeat(64), installedAfterHash: "c".repeat(64) });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await assert.rejects(materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }), { code: "task005_git_materials_solver_invalid" });
    assert.equal(observed.records.length, 10);
    assert.deepEqual(recordedCarrierArgs(observed.records[1]),
      { entrypoint: CHECKSUM_ENTRYPOINT, args: CHECKSUM_ARGS });
    assert.deepEqual(recordedCarrierArgs(observed.records[9]),
      { entrypoint: CHECKSUM_ENTRYPOINT, args: CHECKSUM_ARGS });
    assert.equal(observed.fetchCalls.length, 2);
    assert.equal(observed.fetchCalls.some((url) => url.endsWith("main.json")), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("signed-index repository bytes must match the downloaded APK", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ repositoryHash: "f".repeat(64) });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await assert.rejects(materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: `sha256:${"e".repeat(64)}` },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
    }), { code: "task005_git_materials_material_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("material observation stops when the actor deadline is exhausted", async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    let call = 0;
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: `sha256:${"e".repeat(64)}` },
      command: () => assert.fail("deadline must stop before the first command"),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
      fetchImpl: () => assert.fail("deadline must stop before acquisition"),
      now: () => call++ === 0 ? 0 : limits.actorMs,
    }));
    assert.equal(error.code, "task005_git_materials_child_timeout");
    assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("private evidence rejects hard-linked material", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "task005-git-hardlink-"));
  try {
    const first = path.join(root, "first.apk");
    await writeFile(first, "fixture", { mode: 0o600 });
    await link(first, path.join(root, "second.apk"));
    await assert.rejects(privateTreeBytes(root), { code: "task005_git_materials_material_invalid" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup distinguishes a Docker daemon error from confirmed absence", async () => {
  const fixture = await fixtureContext();
  const context = await requireContext(fixture.env, "linux");
  try {
    await assert.rejects(cleanupOwnedState(context, () => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("daemon unavailable") })),
      { code: "task005_git_materials_child_failed" });
    await cleanupOwnedState(context, (_command, args) => {
      assert.deepEqual(args.slice(0, 3), ["container", "ls", "--all"]);
      return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("workflow is a one-shot draft PR actor with read-only permission and exact paths", async () => {
  const bytes = await readFile(workflowPath, "utf8");
  assert.match(bytes, /pull_request:\n {4}types: \[opened\]\n {4}branches: \[main\]/u);
  assert.doesNotMatch(bytes, /workflow_dispatch:|\bpush:|schedule:/u);
  assert.equal([...bytes.matchAll(/^permissions:/gmu)].length, 1);
  assert.match(bytes, /^permissions:\n {2}contents: read$/mu);
  assert.match(bytes, /github\.event\.pull_request\.draft == true/u);
  assert.match(bytes, /github\.head_ref == 'codex\/task-0005-git-materials-v11'/u);
  assert.match(bytes, /github\.run_number == 1 && github\.run_attempt == 1/u);
  assert.match(bytes, /runs-on: ubuntu-24\.04\n {4}timeout-minutes: 45/u);
  assert.match(bytes, /Run the focused actor contract tests before acquisition\n {8}timeout-minutes: 2\n {8}run: node --test tests\/task005-git-materials-v11\.test\.mjs/u);
  assert.match(bytes, /id: diagnose\n {8}timeout-minutes: 22/u);
  assert.match(bytes, /id: cleanup\n {8}if: \$\{\{ always\(\) \}\}\n {8}timeout-minutes: 10/u);
  const stepTimeouts = [...bytes.matchAll(/^ {8}timeout-minutes: ([0-9]+)$/gmu)]
    .map((match) => Number(match[1]));
  assert.equal(stepTimeouts.reduce((total, value) => total + value, 0), 44);
  assert.match(bytes, /node-version: 22\.23\.2/u);
  assert.match(bytes, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(bytes, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(bytes, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.doesNotMatch(bytes, /secrets\.|github\.token|actions\/cache|packages:\s*write|contents:\s*write|environment:/u);
  assert.match(bytes, /\.github\/workflows\/task005-git-materials-v11\.yml\n {6}- scripts\/diagnostics\/task005-git-materials-v11\.mjs\n {6}- tests\/task005-git-materials-v11\.test\.mjs/u);
  assert.match(bytes, /if-no-files-found: error/u);
  assert.match(bytes, /compression-level: 0/u);
  assert.match(bytes, /steps\.diagnose\.outcome != 'success'.*steps\.cleanup\.outcome != 'success'.*steps\.retain\.outcome != 'success'.*steps\.dispose\.outcome != 'success'/u);
  assert.ok(bytes.indexOf("Run the focused actor contract tests before acquisition")
    < bytes.indexOf("Probe and diagnose exact Alpine materials"));
});

test("context accepts only the exact opened draft PR and accepted base", async () => {
  const fixture = await fixtureContext();
  try {
    const accepted = await requireContext(fixture.env, "linux");
    assert.equal(accepted.eventNumber, 205);
    assert.equal(accepted.headSha, HEAD);
    for (const changed of [
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_EVENT_ACTION: "synchronize" },
      { GITHUB_HEAD_REF: "other" },
      { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_RUN_ATTEMPT: "2" },
      { RUNNER_ENVIRONMENT: "self-hosted" },
      { GITHUB_WORKFLOW_REF: "other" },
    ]) {
      await assert.rejects(requireContext({ ...fixture.env, ...changed }, "linux"),
        { code: "task005_git_materials_context_invalid" });
    }
    await assert.rejects(requireContext(fixture.env, "win32"),
      { code: "task005_git_materials_context_invalid" });
    const event = JSON.parse(await readFile(fixture.eventPath, "utf8"));
    event.pull_request.base.sha = "f".repeat(40);
    await writeFile(fixture.eventPath, JSON.stringify(event));
    await assert.rejects(requireContext(fixture.env, "linux"),
      { code: "task005_git_materials_context_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("context rejects the historical V9 base after accepted-main reconciliation", async () => {
  const fixture = await fixtureContext({ base: HISTORICAL_V9_BASE });
  try {
    await assert.rejects(requireContext(fixture.env, "linux"),
      { code: "task005_git_materials_context_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("context rejects an unrelated well-formed base after accepted-main reconciliation", async () => {
  const fixture = await fixtureContext({ base: "f".repeat(40) });
  try {
    await assert.rejects(requireContext(fixture.env, "linux"),
      { code: "task005_git_materials_context_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("canonical URL boundary rejects alternate hosts, mutable paths and query data", () => {
  assert.equal(validateCanonicalUrl("https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz", "index"),
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz");
  assert.equal(validateCanonicalUrl("https://secdb.alpinelinux.org/v3.24/main.json", "secdb"),
    "https://secdb.alpinelinux.org/v3.24/main.json");
  assert.equal(validateCanonicalUrl("https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk", "apk"),
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk");
  for (const value of [
    "http://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk",
    "https://example.invalid/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk",
    "https://dl-cdn.alpinelinux.org/alpine/edge/main/x86_64/git-2.54.0-r0.apk",
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/../secret.apk",
    "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk?mirror=x",
  ]) assert.throws(() => validateCanonicalUrl(value, "apk"), { code: "task005_git_materials_url_invalid" });
  assert.throws(() => validateCanonicalUrl("https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/../secret.apk", "any"),
    { code: "task005_git_materials_url_invalid" });
  assert.throws(() => validateCanonicalUrl("https://secdb.alpinelinux.org/v3.24/main.json", "unknown"),
    { code: "task005_git_materials_url_invalid" });
});

test("bounded downloader uses a signal for a successful body", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  let signal;
  const headers = new globalThis.Headers({ "content-length": "2", etag: '"fixture"',
    "last-modified": "Wed, 28 Oct 2026 20:00:00 GMT" });
  const body = () => ({
    getReader: () => {
      let sent = false;
      return {
        read: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: new Uint8Array([123, 125]) };
        },
        cancel: async () => {},
      };
    },
  });
  const fetched = await downloadBytes(url, 4, async (observed, options) => {
    assert.equal(observed, url);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["user-agent"], "auto-world-task005-git-materials-v11");
    signal = options.signal;
    return { ok: true, status: 200, url, headers, body: body() };
  }, 2_000, () => 1_000);
  assert.ok(signal instanceof globalThis.AbortSignal);
  assert.equal(fetched.bytes.toString("utf8"), "{}");
});

test("bounded downloader rejects a body that exceeds its cap after successful headers", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  const headers = new globalThis.Headers();
  const body = { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array([1, 2]) }),
    cancel: async () => {},
  }) };
  await assert.rejects(downloadBytes(url, 1, async () => ({ ok: true, status: 200, url,
    headers, body }), 2_000, () => 1_000), { code: "task005_git_materials_material_limit_exceeded" });
});

test("bounded downloader rejects a body that stalls after successful headers", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  const headers = new globalThis.Headers();
  await assert.rejects(downloadBytes(url, 4, async (_observed, options) => ({
    ok: true,
    status: 200,
    url,
    headers,
    body: { getReader: () => ({
      read: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
      cancel: async () => {},
    }) },
  }), 20, () => 0), { code: "task005_git_materials_download_failed" });
});

test("bounded downloader aborts when response headers never arrive without an unhandled rejection", { timeout: 1_000 }, async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    await assert.rejects(downloadBytes(url, 4, () => new Promise(() => {}), 20, () => 0),
      { code: "task005_git_materials_download_failed" });
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("bounded downloader rejects a redirect outside the canonical origin", async () => {
  const url = "https://secdb.alpinelinux.org/v3.24/main.json";
  await assert.rejects(downloadBytes(url, 4, async () => ({ ok: false, status: 302, url,
    headers: new globalThis.Headers({ location: "https://example.invalid/private" }) }), 2_000, () => 1_000),
  { code: "task005_git_materials_url_invalid" });
});

test("capability assessment is exact and missing capability yields bounded NOT_RUN before material acquisition", async () => {
  const help = completeHelp();
  assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  help.query = Buffer.from("query --format --fields --from");
  assert.deepEqual(assessHelp(help), { complete: false, missing: ["query:--recursive"] });
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = notRunEvidence(context, "apk-tools 3.0.0, compiled for x86_64.", help,
      assessHelp(help), { containersAbsent: true, privateFilesAbsent: true },
      `sha256:${"e".repeat(64)}`, 30 * 1024 ** 2);
    validateEvidence(observed, context);
    assert.equal(observed.receipt.state, "NOT_RUN");
    assert.equal(observed.receipt.source.acceptedBase, BASE);
    assert.equal(observed.receipt.materialsAcquired, false);
    assert.equal(observed.receipt.installationAuthorization, false);
    assert.equal(observed.receipt.packageInstalled, false);
    assert.equal(observed.receipt.gitExecuted, false);
    assert.deepEqual(observed.receipt.missingCapabilities, ["query:--recursive"]);
    const receiptBytes = Buffer.from(canonicalJson(observed.receipt));
    assert.ok(receiptBytes.length <= limits.publicFileBytes);
    assert.doesNotMatch(receiptBytes.toString("utf8"), new RegExp(fixture.runnerTemp.replaceAll("\\", "\\\\"), "u"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("global capabilities are bound to exact add-help tokens", async (t) => {
  const cases = [
    ["--keys-dir", ["prefix--keys-dir", "--keys-dir-suffix"]],
    ["--repositories-file", ["prefix--repositories-file", "--repositories-file-suffix"]],
    ["--root", ["--root-tmpfs[=AUTO]", "prefix--root", "--root-suffix"]],
  ];
  for (const [token, decoys] of cases) {
    await t.test(token, () => {
      const help = helpWithoutExactAddToken(token, decoys);
      help.verify = Buffer.from(`verify ${token}`);
      assert.deepEqual(assessHelp(help), { complete: false, missing: [`add:${token}`] });
    });
  }
  await t.test("exact tokens coexist with official and hostile decoys", () => {
    const help = helpWithAdd([...canonicalAddTokens(), "prefix--keys-dir", "--repositories-file-suffix",
      "prefix--root", "--root-suffix"].join(" "));
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
});

test("documented root presentation satisfies the existing root capability", async (t) => {
  await t.test("source-derived fixture", () => {
    assert.deepEqual(assessHelp(sourceDerivedHelp()), { complete: true, missing: [] });
  });
  await t.test("triple at stream start", () => {
    assert.deepEqual(assessHelp(helpWithRootPresentation(["--root,", "-p", "ROOT"], "start")), {
      complete: true, missing: [],
    });
  });
  await t.test("triple at stream end", () => {
    assert.deepEqual(assessHelp(helpWithRootPresentation(["--root,", "-p", "ROOT"])), {
      complete: true, missing: [],
    });
  });
  for (const [name, delimiter] of ASCII_HELP_DELIMITERS) {
    await t.test(`${name} between triple members`, () => {
      const add = `${addTokensWithoutBareRoot().join(" ")} --root,${delimiter}-p${delimiter}ROOT`;
      assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: true, missing: [] });
    });
  }
  await t.test("repeated approved whitespace", () => {
    const add = `${addTokensWithoutBareRoot().join(" ")} --root,  \t-p\n\rROOT`;
    assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: true, missing: [] });
  });
  await t.test("mixed approved whitespace", () => {
    const add = `${addTokensWithoutBareRoot().join(" ")} --root,\t\n-p\v\f\rROOT`;
    assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: true, missing: [] });
  });
  await t.test("duplicates coexist with decoys", () => {
    const help = helpWithRootPresentation(["prefix--root,", "--root-tmpfs[=AUTO]", "--root,", "-p", "ROOT",
      "--root,suffix", "--root,", "-p", "ROOT", "--networking"]);
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
  await t.test("bare root remains independently valid beside a malformed triple", () => {
    const help = helpWithAdd([...canonicalAddTokens(), "--root,", "intervening", "-p", "ROOT"].join(" "));
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
});

test("documented root presentation requires the exact adjacent ordered triple", async (t) => {
  const cases = [
    ["missing comma token", ["-p", "ROOT"]],
    ["missing alias", ["--root,", "ROOT"]],
    ["missing placeholder", ["--root,", "-p"]],
    ["alias before comma token", ["-p", "--root,", "ROOT"]],
    ["placeholder before tuple", ["ROOT", "--root,", "-p"]],
    ["placeholder before alias", ["--root,", "ROOT", "-p"]],
    ["intervening before alias", ["--root,", "intervening", "-p", "ROOT"]],
    ["intervening before placeholder", ["--root,", "-p", "intervening", "ROOT"]],
    ["altered short alias", ["--root,", "-r", "ROOT"]],
    ["long alias substitute", ["--root,", "--root-alias", "ROOT"]],
    ["lowercase placeholder", ["--root,", "-p", "root"]],
    ["placeholder suffix", ["--root,", "-p", "ROOTS"]],
    ["comma token case", ["--Root,", "-p", "ROOT"]],
    ["alias case", ["--root,", "-P", "ROOT"]],
    ["placeholder case", ["--root,", "-p", "Root"]],
    ["extra comma", ["--root,,", "-p", "ROOT"]],
    ["comma token prefix", ["prefix--root,", "-p", "ROOT"]],
    ["comma token suffix", ["--root,suffix", "-p", "ROOT"]],
    ["alias punctuation", ["--root,", "-p,", "ROOT"]],
    ["placeholder punctuation", ["--root,", "-p", "ROOT,"]],
    ["comma token alone", ["--root,"]],
    ["alias and placeholder alone", ["-p", "ROOT"]],
    ["comma token and alias only", ["--root,", "-p"]],
    ["comma token and placeholder only", ["--root,", "ROOT"]],
  ];
  for (const [name, tokens] of cases) {
    await t.test(name, () => {
      assert.deepEqual(assessHelp(helpWithRootPresentation(tokens)), {
        complete: false, missing: ["add:--root"],
      });
    });
  }
  for (const [name, delimiter] of [["NBSP", "\u00a0"], ["EM SPACE", "\u2003"]]) {
    await t.test(`${name} between comma token and alias`, () => {
      const add = `${addTokensWithoutBareRoot().join(" ")} --root,${delimiter}-p ROOT`;
      assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: false, missing: ["add:--root"] });
    });
    await t.test(`${name} between alias and placeholder`, () => {
      const add = `${addTokensWithoutBareRoot().join(" ")} --root, -p${delimiter}ROOT`;
      assert.deepEqual(assessHelp(helpWithAdd(add)), { complete: false, missing: ["add:--root"] });
    });
  }
  await t.test("tokens in other streams cannot complete the add tuple", () => {
    const help = helpWithRootPresentation([]);
    help.root = Buffer.from("--root,");
    help.verify = Buffer.from("verify -p ROOT");
    assert.deepEqual(assessHelp(help), { complete: false, missing: ["add:--root"] });
  });
});

test("exact add-help tokens accept only the six ASCII whitespace delimiters", async (t) => {
  const tokens = [...GLOBAL_HELP_TOKENS, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN];
  for (const token of tokens) {
    for (const [name, delimiter] of ASCII_HELP_DELIMITERS) {
      await t.test(`${token} with ${name}`, () => {
        const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
        const values = canonicalAddTokens(network);
        assert.ok(values.includes(token));
        assert.deepEqual(assessHelp(helpWithAdd(values.join(delimiter))), { complete: true, missing: [] });
      });
    }
  }
});

test("exact add-help tokens are accepted at stream edges", async (t) => {
  for (const token of [...GLOBAL_HELP_TOKENS, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN]) {
    const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
    const remainder = canonicalAddTokens(network).filter((value) => value !== token);
    await t.test(`${token} at start`, () => {
      assert.deepEqual(assessHelp(helpWithAdd([token, ...remainder].join(" "))), { complete: true, missing: [] });
    });
    await t.test(`${token} at end`, () => {
      assert.deepEqual(assessHelp(helpWithAdd([...remainder, token].join(" "))), { complete: true, missing: [] });
    });
  }
});

test("case punctuation and Unicode whitespace cannot manufacture exact add-help tokens", async (t) => {
  for (const token of [...GLOBAL_HELP_TOKENS, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN]) {
    const expected = token.startsWith("--network") || token === NETWORK_ALIAS_TOKEN
      ? "add:network-denial" : `add:${token}`;
    const network = token === NETWORK_ALIAS_TOKEN ? NETWORK_ALIAS_TOKEN : NETWORK_BOOL_TOKEN;
    const base = canonicalAddTokens(network).filter((value) => value !== token);
    const variants = [
      ["case", token.toUpperCase()],
      ["punctuation", `${token},`],
      ["NBSP", `prefix\u00a0${token}\u00a0suffix`],
      ["EM SPACE", `prefix\u2003${token}\u2003suffix`],
    ];
    for (const [name, variant] of variants) {
      await t.test(`${token} ${name}`, () => {
        assert.deepEqual(assessHelp(helpWithAdd([...base, variant].join(" "))), {
          complete: false, missing: [expected],
        });
      });
    }
  }
});

test("add-help tokenization is closed for malformed and absent streams", async (t) => {
  await t.test("malformed UTF-8", () => {
    const help = completeHelp();
    help.add = Buffer.from([0xff]);
    assert.throws(() => assessHelp(help), { code: "task005_git_materials_probe_not_run" });
  });
  await t.test("absent add stream", () => {
    const help = completeHelp();
    delete help.add;
    assert.deepEqual(assessHelp(help), {
      complete: false,
      missing: ["add:--keys-dir", "add:--repositories-file", "add:--root", "add:--simulate",
        "add:network-denial"],
    });
  });
});

test("network capability accepts only exact add-help presentations", async (t) => {
  for (const token of [NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN]) {
    await t.test(token, () => {
      assert.deepEqual(assessHelp(helpWithAdd(canonicalAddTokens(token).join(" "))), {
        complete: true, missing: [],
      });
    });
  }
  const rejected = [
    ["missing", ""], ["MODE", "--network=MODE"], ["spaced MODE", "--network MODE"],
    ["bare", "--network"], ["affirmative", "--network=yes"], ["loose alias", "--offline"],
    ["networking", "--networking"], ["BOOL suffix", "--network[=BOOL]suffix"],
    ["alias prefix", "prefix--no-network"],
  ];
  for (const [name, presentation] of rejected) {
    await t.test(name, () => {
      const add = [...canonicalAddTokens().filter((value) => value !== NETWORK_BOOL_TOKEN), presentation]
        .filter(Boolean).join(" ");
      const help = helpWithAdd(add, `${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`);
      help.verify = Buffer.from(`verify ${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`);
      assert.deepEqual(assessHelp(help), { complete: false, missing: ["add:network-denial"] });
    });
  }
  await t.test("both exact forms duplicate and coexist with decoys", () => {
    const help = helpWithAdd([...canonicalAddTokens(), NETWORK_ALIAS_TOKEN, NETWORK_BOOL_TOKEN,
      NETWORK_ALIAS_TOKEN, "--networking", "--network[=BOOL]suffix", "prefix--no-network"].join(" "));
    assert.deepEqual(assessHelp(help), { complete: true, missing: [] });
  });
});

test("add simulate and existing applet capability requirements remain binding", async (t) => {
  const cases = [
    ["add", "--simulate", "add:--simulate"],
    ["verify", "verify", "verify:verify"],
    ["query", "--recursive", "query:--recursive"],
    ["manifest", "manifest", "manifest:manifest"],
    ["fetch", "--stdout", "fetch:--stdout"],
    ["version", "--test", "version:--test"],
  ];
  for (const [stream, token, expected] of cases) {
    await t.test(expected, () => {
      const help = completeHelp();
      help[stream] = Buffer.from(help[stream].toString("utf8").replace(token, "missing"));
      assert.deepEqual(assessHelp(help), { complete: false, missing: [expected] });
    });
  }
});

test("capability assessment requires fetch stdout support from measured help", () => {
  const help = completeHelp();
  help.fetch = Buffer.from("fetch --output");
  assert.deepEqual(assessHelp(help), { complete: false, missing: ["fetch:--stdout"] });
});

test("public disposal fixture is provably missing the manifest capability", () => {
  assert.deepEqual(assessHelp(helpWithoutManifestCapability()), {
    complete: false,
    missing: ["manifest:manifest"],
  });
});

test("complete capability set rejects an observation that grants installation authority", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await assert.rejects(executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: () => assert.fail("container cleanup command is not expected without a created name"),
      cleanup: cleanupPrivate,
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), names: [] }),
      materialize: async () => ({
        receipt: { actor: "OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1", state: "MATERIAL_OBSERVATION_ONLY",
          installationAuthority: true },
        manifest: { actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", state: "MATERIAL_OBSERVATION_ONLY",
          installationAuthorization: false },
      }),
    }), { code: "task005_git_materials_material_invalid" });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("cleanup failure does not replace the first material failure", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await assert.rejects(executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw Object.assign(new Error("first"), { code: "task005_git_materials_download_failed" }); },
      command: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
      cleanup: async () => { throw Object.assign(new Error("cleanup"), { code: "task005_git_materials_cleanup_failed" }); },
    }), { code: "task005_git_materials_download_failed" });
    assert.equal((await lstat(context.privateRoot)).isDirectory(), true);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("public errors and canonical JSON do not expose arbitrary fields or paths", () => {
  const safe = JSON.parse(publicFailure({ code: "task005_git_materials_child_timeout", path: "C:/private/material.apk" }));
  assert.deepEqual(safe, {
    actor: "TASK005_GIT_MATERIALS_V1",
    authority: "DIAGNOSTIC_ONLY",
    code: "task005_git_materials_child_timeout",
    installationAuthorization: false,
    state: "FAILED",
  });
  const unsafe = publicFailure({ code: "unsafe /private/path", stack: "secret" });
  assert.equal(JSON.parse(unsafe).code, "task005_git_materials_failed");
  assert.doesNotMatch(unsafe, /private|secret/u);
  const brandedSecret = publicFailure({ code: "task005_git_materials_secret_stolen" });
  assert.equal(JSON.parse(brandedSecret).code, "task005_git_materials_failed");
  assert.equal(canonicalJson({ z: 1, a: { z: 2, a: 1 } }), '{"a":{"a":1,"z":2},"z":1}\n');
});

test("solver parser accepts additions only and requires the exact Git root", () => {
  const observed = parseTransaction(Buffer.from("(1/2) Installing pcre2 (10.49-r0)\n(2/2) Installing git (2.54.0-r0)\nOK: 42 MiB in 31 packages\n"));
  assert.deepEqual(observed, [
    { action: "ADD", name: "pcre2", order: 1, version: "10.49-r0" },
    { action: "ADD", name: "git", order: 2, version: "2.54.0-r0" },
  ]);
  assert.throws(() => parseTransaction(Buffer.from("(1/1) Upgrading git (2.54.0-r0)\n")),
    { code: "task005_git_materials_solver_invalid" });
  assert.throws(() => parseTransaction(Buffer.from("(1/1) Installing pcre2 (10.49-r0)\n")),
    { code: "task005_git_materials_solver_invalid" });
});

test("solver parser accepts exact legacy and source-canonical ordinal forms at every supported width", async (t) => {
  const cases = [
    [1, 1], [9, 1], [10, 5], [11, 11], [64, 32],
  ];
  for (const [total, gitOrder] of cases) {
    for (const canonical of [false, true]) {
      await t.test(`${canonical ? "canonical" : "legacy"} total ${total}`, () => {
        const expected = transactionEntries(total, gitOrder);
        const text = transactionText(expected, { canonical, informational: true });
        assert.deepEqual(parseTransaction(Buffer.from(text)), expected);
      });
    }
  }
});

test("solver parser accepts equivalent LF and CRLF transactions", async (t) => {
  const expected = transactionEntries(10, 5);
  for (const canonical of [false, true]) {
    for (const lineEnding of ["\n", "\r\n"]) {
      await t.test(`${canonical ? "canonical" : "legacy"} ${lineEnding === "\n" ? "LF" : "CRLF"}`, () => {
        assert.deepEqual(parseTransaction(Buffer.from(transactionText(expected, { canonical, lineEnding }))), expected);
      });
    }
  }
});

test("solver parser rejects the unchanged 65-package bound in both presentations", async (t) => {
  const entries = transactionEntries(65, 65);
  for (const canonical of [false, true]) {
    await t.test(canonical ? "canonical" : "legacy", () => {
      assertSolverInvalid(transactionText(entries, { canonical }));
    });
  }
});

test("solver parser rejects noncanonical ASCII padding widths", async (t) => {
  const entries = transactionEntries(10, 10);
  const canonical = transactionText(entries, { canonical: true });
  const cases = [
    ["extra width on short ordinal", canonical.replace("( 1/10)", "(  1/10)")],
    ["padding on full-width ordinal", canonical.replace("(10/10)", "( 10/10)")],
    ["missing canonical padding", canonical.replace("( 1/10)", "(1/10)")],
  ];
  for (const [name, text] of cases) await t.test(name, () => assertSolverInvalid(text));
});

test("solver parser rejects mixed canonical and legacy short ordinal presentations", async (t) => {
  const entries = transactionEntries(10, 10);
  const legacy = transactionText(entries);
  const canonical = transactionText(entries, { canonical: true });
  const cases = [
    ["canonical row in legacy transaction", legacy.replace("(1/10)", "( 1/10)")],
    ["legacy row in canonical transaction", canonical.replace("( 1/10)", "(1/10)")],
  ];
  for (const [name, text] of cases) await t.test(name, () => assertSolverInvalid(text));
});

test("solver parser rejects non-ASCII ordinal padding inserted into a complete aggregate", async (t) => {
  const base = transactionText(transactionEntries(10, 10), { canonical: true });
  const cases = [
    ["tab", "\t", "first"], ["vertical tab", "\v", "middle"], ["form feed", "\f", "last"],
    ["carriage return", "\r", "first"], ["line feed", "\n", "middle"], ["NBSP", "\u00a0", "last"],
    ["EM SPACE", "\u2003", "first"], ["NARROW NBSP", "\u202f", "middle"],
  ];
  for (const [name, whitespace, position] of cases) {
    await t.test(name, () => {
      const hostile = `(${whitespace}1/10) Installing hostile (1-r0)`;
      assertSolverInvalid(insertHostileRow(base, hostile, position));
    });
  }
});

test("solver parser rejects whitespace outside the canonical ordinal field", async (t) => {
  const base = transactionText(transactionEntries(10, 10), { canonical: true });
  const cases = [
    ["before opening parenthesis", " ( 1/10) Installing hostile (1-r0)", "first"],
    ["padded denominator", "( 1/ 10) Installing hostile (1-r0)", "middle"],
    ["extra separator after prefix", "( 1/10)  Installing hostile (1-r0)", "last"],
    ["tab separator after prefix", "( 1/10)\tInstalling hostile (1-r0)", "middle"],
  ];
  for (const [name, hostile, position] of cases) {
    await t.test(name, () => assertSolverInvalid(insertHostileRow(base, hostile, position)));
  }
});

test("solver parser rejects malformed numeric lexemes without silently ignoring their rows", async (t) => {
  const tokens = [
    ["zero", "0"], ["above package cap", "65"], ["MAX_SAFE_INTEGER", "9007199254740991"],
    ["MAX_SAFE_INTEGER plus one", "9007199254740992"], ["Infinity", "Infinity"],
    ["64 digit decimal", "9".repeat(64)], ["4096 digit decimal", "9".repeat(4096)],
    ["leading zero", "01"], ["plus sign", "+1"], ["minus sign", "-1"], ["decimal", "1.5"],
    ["exponent", "1e1"], ["empty", ""],
  ];
  const positions = ["first", "middle", "last"];
  let caseIndex = 0;
  for (const [tokenName, token] of tokens) {
    for (const field of ["ordinal", "denominator"]) {
      for (const padded of [false, true]) {
        const position = positions[caseIndex++ % positions.length];
        await t.test(`${padded ? "padded" : "legacy"} ${field} ${tokenName} at ${position}`, () => {
          const base = transactionText(transactionEntries(10, 10), { canonical: padded });
          const padding = padded ? " " : "";
          const hostile = field === "ordinal"
            ? `(${padding}${token}/10) Installing hostile (1-r0)`
            : `(${padding}1/${token}) Installing hostile (1-r0)`;
          assertSolverInvalid(insertHostileRow(base, hostile, position));
        });
      }
    }
  }
});

test("solver parser rejects every unsupported action inserted into a complete aggregate", async (t) => {
  const actions = ["Upgrading", "Downgrading", "Purging", "Reinstalling", "Updating pinning", "Replacing"];
  const positions = ["first", "middle", "last"];
  let caseIndex = 0;
  for (const action of actions) {
    for (const canonical of [false, true]) {
      const position = positions[caseIndex++ % positions.length];
      await t.test(`${canonical ? "padded" : "legacy"} ${action} at ${position}`, () => {
        const base = transactionText(transactionEntries(10, 10), { canonical });
        const ordinal = canonical ? " 1" : "1";
        const hostile = `(${ordinal}/10) ${action} hostile (1-r0)`;
        assertSolverInvalid(insertHostileRow(base, hostile, position));
      });
    }
  }
});

test("solver parser refuses an ignored padded non-add row at every aggregate position", async (t) => {
  const base = transactionText(transactionEntries(10, 10), { canonical: true });
  for (const position of ["first", "middle", "last"]) {
    await t.test(position, () => {
      const hostile = "( 1/10) Replacing hostile (1-r0)";
      assertSolverInvalid(insertHostileRow(base, hostile, position));
    });
  }
});

test("solver parser rejects malformed numbered Installing rows inserted into a complete aggregate", async (t) => {
  const cases = [
    ["repository tag", "( 1/10) Installing hostile@edge (1-r0)"],
    ["invalid name", "( 1/10) Installing _hostile (1-r0)"],
    ["invalid version", "( 1/10) Installing hostile (_1-r0)"],
    ["lowercase action", "( 1/10) installing hostile (1-r0)"],
    ["extra suffix", "( 1/10) Installing hostile (1-r0) extra"],
    ["missing close", "( 1/10) Installing hostile (1-r0"],
    ["unknown action", "( 1/10) Superseding hostile (1-r0)"],
    ["missing separator before Replacing", "( 1/10)Replacing hostile (1-r0)"],
    ["missing separator before Installing", "( 1/10)Installing hostile (1-r0)"],
    ["missing separator before unknown action", "(1/10)Superseding hostile (1-r0)"],
    ["missing separator before numbered text", "(1/10)2 additional numbered text"],
    ["unavailable reinstall prefix", "( 1/10) [APK unavailable, skipped] Reinstalling hostile (1-r0)"],
    ["additional numbered text", "( 1/10) 2 additional numbered text"],
  ];
  const positions = ["first", "middle", "last"];
  for (const [index, [name, hostile]] of cases.entries()) {
    await t.test(`${name} at ${positions[index % positions.length]}`, () => {
      const base = transactionText(transactionEntries(10, 10), { canonical: true });
      assertSolverInvalid(insertHostileRow(base, hostile, positions[index % positions.length]));
    });
  }
});

test("solver parser preserves count order uniqueness and Git pin invariants in both presentations", async (t) => {
  for (const canonical of [false, true]) {
    const entries = transactionEntries(10, 10);
    const valid = transactionText(entries, { canonical });
    const prefix = canonical ? " " : "";
    const rows = valid.split("\n");
    [rows[0], rows[1]] = [rows[1], rows[0]];
    const cases = [
      ["duplicate package", valid.replace("fixture-02", "fixture-01")],
      ["duplicate ordinal", valid.replace(`(${prefix}2/10)`, `(${prefix}1/10)`) ],
      ["skipped ordinal", valid.replace(`(${prefix}2/10)`, `(${prefix}3/10)`) ],
      ["reversed rows", rows.join("\n")],
      ["first ordinal is not one", valid.replace(`(${prefix}1/10)`, `(${prefix}2/10)`) ],
      ["wrong common total", valid.replace(`(${prefix}1/10)`, `(${prefix}1/9)`) ],
      ["total smaller than count", canonical
        ? valid.replaceAll("( ", "(").replaceAll("/10)", "/9)")
        : valid.replaceAll("/10)", "/9)")],
      ["total larger than count", valid.replaceAll("/10)", "/11)")],
      ["missing Git", valid.replace("git (2.54.0-r0)", "fixture-git (2.54.0-r0)")],
      ["wrong Git", valid.replace("git (2.54.0-r0)", "git (2.54.1-r0)")],
      ["duplicate Git", valid.replace("fixture-01 (1.1-r0)", "git (2.54.0-r0)")],
      ["tagged Git display", valid.replace("git (2.54.0-r0)", "git@edge (2.54.0-r0)")],
    ];
    for (const [name, text] of cases) {
      await t.test(`${canonical ? "canonical" : "legacy"} ${name}`, () => assertSolverInvalid(text));
    }
  }
  await t.test("empty transaction", () => assertSolverInvalid("OK: 1 MiB in 1 packages\n"));
});

test("solver parser keeps benign parenthetical informational lines ignorable", async (t) => {
  const entries = transactionEntries(10, 10);
  const cases = [
    ["plain parenthetical", "(Information only)"],
    ["leading whitespace", "   (Information only)"],
    ["slash text", "(note: a/b)"],
    ["space inside parenthesis", "( Information only)"],
    ["numeric informational prefix", "(0 warnings)"],
    ["Infinity informational prefix", "(Infinity note)"],
    ["numeric informational prefix with slash", "(0 warnings/errors)"],
    ["Infinity informational prefix with slash", "(Infinity note/info)"],
    ["dot path", "(./path)"],
    ["minus status", "(-/status)"],
    ["exponent-like error", "(e/error)"],
    ["plus summary", "(+/summary)"],
    ["decimal information", "(1.5/info)"],
  ];
  for (const [name, informational] of cases) {
    await t.test(name, () => {
      const text = `${informational}\n${transactionText(entries, { canonical: true })}`;
      assert.deepEqual(parseTransaction(Buffer.from(text)), entries);
    });
  }
});

test("solver parser rejects source-like transaction rows split across line endings", async (t) => {
  const base = transactionText(transactionEntries(10, 10), { canonical: true });
  const cases = [
    ["LF after opening parenthesis", "(\n1/10) Installing hostile (1-r0)"],
    ["CRLF after opening parenthesis", "(\r\n1/10) Installing hostile (1-r0)"],
    ["space before LF after opening parenthesis", "( \n1/10) Installing hostile (1-r0)"],
    ["tab before CRLF after opening parenthesis", "(\t\r\n1/10) Installing hostile (1-r0)"],
    ["LF inside ordinal", "(1\n/10) Installing hostile (1-r0)"],
    ["space before CRLF inside ordinal", "(1 \r\n/10) Installing hostile (1-r0)"],
    ["LF after denominator slash", "(1/\n10) Installing hostile (1-r0)"],
    ["tab before CRLF inside denominator", "(1/1\t\r\n0) Installing hostile (1-r0)"],
    ["LF before closing ordinal parenthesis", "(1/10\n) Installing hostile (1-r0)"],
    ["space before CRLF before closing ordinal parenthesis", "(1/10 \r\n) Installing hostile (1-r0)"],
    ["LF between ordinal and action", "(1/10)\nInstalling hostile (1-r0)"],
    ["tab before CRLF between ordinal and action", "(1/10)\t\r\n Installing hostile (1-r0)"],
  ];
  for (const [name, hostile] of cases) {
    await t.test(name, () => assertSolverInvalid(insertHostileRow(base, hostile, "middle")));
  }
});

test("solver parser rejects malformed numeric lexemes split inside source-like rows", async (t) => {
  const base = transactionText(transactionEntries(10, 10), { canonical: true });
  const cases = [
    ["plus ordinal", "(+\n1/10) Installing hostile (1-r0)"],
    ["Infinity ordinal", "(Infinity\n/10) Installing hostile (1-r0)"],
    ["decimal ordinal", "(1.\n5/10) Installing hostile (1-r0)"],
    ["empty ordinal", "(\n/10) Installing hostile (1-r0)"],
    ["minus denominator", "(1/-\n1) Installing hostile (1-r0)"],
    ["Infinity denominator", "(1/Infinity\n) Installing hostile (1-r0)"],
    ["decimal denominator", "(1/1.\n5) Installing hostile (1-r0)"],
    ["empty denominator", "(1/\n) Installing hostile (1-r0)"],
  ];
  for (const [name, hostile] of cases) {
    await t.test(name, () => assertSolverInvalid(insertHostileRow(base, hostile, "middle")));
  }
});

test("solver parser rejects standalone malformed numeric tokens in complete source-like rows", async (t) => {
  const base = transactionText(transactionEntries(10, 10), { canonical: true });
  for (const token of ["+", "-", ".", "e"]) {
    await t.test(`ordinal ${token}`, () => {
      assertSolverInvalid(insertHostileRow(base, `(${token}/10) Installing hostile (1-r0)`, "middle"));
    });
    await t.test(`denominator ${token}`, () => {
      assertSolverInvalid(insertHostileRow(base, `(1/${token}) Installing hostile (1-r0)`, "middle"));
    });
  }
});

test("solver parser handles large benign and hostile prefixes within a hard subprocess deadline", { timeout: 7_000 }, () => {
  const source = `
    import assert from "node:assert/strict";
    import { TEST_ONLY_parseTransaction as parseTransaction } from ${JSON.stringify(actorPath.href)};
    const largePadding = " ".repeat(1024 * 1024);
    const informational = \`(\${largePadding}benign informational prefix)\`;
    const transaction = \`\${informational}\\n(1/1) Installing git (2.54.0-r0)\\nOK: 13 MiB in 21 packages\\n\`;
    assert.deepEqual(parseTransaction(Buffer.from(transaction)), [
      { action: "ADD", name: "git", order: 1, version: "2.54.0-r0" },
    ]);
    const malformed = \`(\${largePadding}\\n1/1) Installing hostile (1-r0)\\n\${transaction}\`;
    assert.throws(() => parseTransaction(Buffer.from(malformed)), {
      code: "task005_git_materials_solver_invalid",
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test("regular-file manifest rejects noncanonical paths and invalid UTF-8", () => {
  const observed = parseRegularManifest(Buffer.from(`SHA256:${"a".repeat(64)}  usr/bin/git\nSHA1:${"b".repeat(40)}  usr/libexec/git-core/git-add\n`));
  assert.equal(observed.entries.length, 2);
  assert.match(observed.sha256, /^[0-9a-f]{64}$/u);
  assert.throws(() => parseRegularManifest(Buffer.from(`SHA256:${"a".repeat(64)}  ../escape\n`)),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseRegularManifest(Buffer.from([0xc3, 0x28])),
    { code: "task005_git_materials_material_invalid" });
});

test("key manifest rejects duplicate, malformed and non-key entries", () => {
  const digest = "a".repeat(64);
  assert.throws(() => parseKeyManifest(Buffer.from(`alpine.rsa.pub\t42\t${digest}\nalpine.rsa.pub\t42\t${digest}\n`)),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseKeyManifest(Buffer.from(`not-a-key\t42\t${digest}\n`)),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseKeyManifest(Buffer.from([0xc3, 0x28])),
    { code: "task005_git_materials_material_invalid" });
});

test("query parser rejects malformed UTF-8 and malformed JSON", () => {
  const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
  assert.throws(() => parseQuery(Buffer.from([0xc3, 0x28]), transaction),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => parseQuery(Buffer.from("{"), transaction),
    { code: "task005_git_materials_material_invalid" });
});

test("query parser rejects legacy field names that apk query does not expose", () => {
  const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
  const legacy = [{ name: "git", version: "2.54.0-r0", architecture: "x86_64",
    checksum: "Q1fixture", size: 19, "installed-size": 1024, license: "GPL-2.0-only",
    origin: "git", maintainer: "Alpine Developers", commit: "c".repeat(40), depends: [], "install-if": [] }];
  assert.throws(() => parseQuery(Buffer.from(JSON.stringify(legacy)), transaction),
    { code: "task005_git_materials_material_invalid" });
});

test("SecDB zero sentinels stay unresolved and are never version-compared", () => {
  const compared = [];
  const secdb = Buffer.from(JSON.stringify({
    distroversion: "v3.24",
    reponame: "main",
    packages: [{ pkg: { name: "git", secfixes: {
      "0": ["CVE-2021-29468", "CVE-2021-46101"],
      "2.50.1-r0": ["CVE-2025-0001"],
    } } }],
  }));
  const result = parseSecdb(secdb, [{ name: "git", origin: "git", version: "2.54.0-r0" }], (left, right) => {
    compared.push([left, right]); return ">";
  });
  assert.deepEqual(compared, [["2.54.0-r0", "2.50.1-r0"]]);
  assert.equal(result[0].fixes.filter((item) => item.state === "SECDB_ZERO_SENTINEL_UNRESOLVED").length, 2);
  assert.equal(result[0].fixes.find((item) => item.cve === "CVE-2025-0001").state, "AT_OR_ABOVE_RECORDED_FIX");
  const absent = parseSecdb(secdb, [{ name: "libcurl", origin: "curl", version: "8.23.0-r0" }], () => assert.fail());
  assert.equal(absent[0].state, "UNKNOWN");
});

test("observation schema keeps both metadata gaps and every execution authority false", () => {
  const context = { runnerTemp: "/runner-temp" };
  const receipt = {
    actor: "OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1", authority: "DIAGNOSTIC_ONLY",
    boundaries: { hookContent: "NOT_INSPECTED", indexMetadata: "OBSERVED",
      nonregularFileMetadata: "NOT_INSPECTED", regularFileManifest: "OBSERVED",
      repoCommitMeaning: "SIGNED_INDEX_DECLARATION_ONLY" },
    carrier: { imageId: `sha256:${"e".repeat(64)}` }, cleanup: {}, closure: {},
    execution: { gitExecuted: false, packageInstalled: false, packagePayloadExecuted: false },
    index: { genericVerification: "PASSED", repositoryAcceptance: "SOLE_LOCAL_REPOSITORY_SOLVE_PASSED" },
    installationAuthority: false, keyManifest: {},
    packages: [{ name: "git", size: 19, version: "2.54.0-r0" }], resources: {},
    secdb: { acquisitionToUseMs: 0, freshness: "WITHIN_48_HOURS_NONAUTHORITATIVE", snapshotAgeMs: 0 },
    security: { exhaustiveCoverage: false, severityAvailable: false, stage2: "BLOCKED", stillUnfixedStateAvailable: false },
    source: {}, state: "MATERIAL_OBSERVATION_ONLY", transaction: {},
  };
  const manifest = { actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", installationAuthorization: false,
    packages: [{ bytes: 19, filename: "git-2.54.0-r0.apk", indexBinding: "VERIFIED_BY_APK_FETCH",
      localSignature: "VERIFIED_BY_APK_VERIFY", sha256: "f".repeat(64),
      url: "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/git-2.54.0-r0.apk" }],
    state: "MATERIAL_OBSERVATION_ONLY" };
  assert.equal(validateEvidence({ receipt, manifest }, context).receipt.installationAuthority, false);
  assert.throws(() => validateEvidence({ receipt: { ...receipt, installationAuthority: true }, manifest }, context),
    { code: "task005_git_materials_material_invalid" });
  assert.throws(() => validateEvidence({ receipt: { ...receipt,
    boundaries: { ...receipt.boundaries, hookContent: "OBSERVED" } }, manifest }, context),
  { code: "task005_git_materials_material_invalid" });
});

test("actor source contains no extraction, v2 dump, installation or Git execution command", async () => {
  const source = await readFile(new URL("../scripts/diagnostics/task005-git-materials-v11.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["'](?:extract|adbdump)["']/u);
  assert.doesNotMatch(source, /["']git["']\s*,\s*\[/u);
  assert.match(source, /"add", "--simulate", "git=2\.54\.0-r0"/u);
  assert.doesNotMatch(source, /"add", "git=/u);
  assert.match(source, /packageInstalled: false/u);
  assert.match(source, /packagePayloadExecuted: false/u);
  assert.match(source, /gitExecuted: false/u);
  assert.match(source, /find \/etc\/apk\/keys -mindepth 1 -maxdepth 1/u);
  assert.doesNotMatch(source, /\/etc\/apk\/keys\/\*\.rsa\.pub/u);
  assert.match(source, /writeFile\(repositories, "ndx file:\/\/\/materials\/repo\/APKINDEX\.tar\.gz\\n"/u);
  assert.match(source, /const queryFields = "name,version,arch,file-size,installed-size,license,origin,maintainer,commit,depends,install-if"/u);
  assert.doesNotMatch(source, /const queryFields = "[^"]*(?:architecture|checksum|(?:^|,)size(?:,|$))/u);
});

test("public disposal refuses unknown entries instead of broad deletion", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  const publicRoot = path.join(fixture.runnerTemp, "task005-git-materials-v11-public");
  const incompleteHelp = helpWithoutManifestCapability();
  assert.deepEqual(assessHelp(incompleteHelp), {
    complete: false,
    missing: ["manifest:manifest"],
  });
  try {
    await run(["execute"], fixture.env, {
      platform: "linux",
      statfs: async () => enoughCapacity(),
      command: () => assert.fail("container cleanup command is not expected without a created name"),
      cleanup: cleanupPrivate,
      probe: async () => ({
        version: "apk-tools 3.0.0, compiled for x86_64.",
        help: incompleteHelp,
        names: [],
      }),
      log: () => {},
    });
    await writeFile(path.join(publicRoot, "unknown"), "retain", { mode: 0o600 });
    await assert.rejects(run(["dispose-public"], fixture.env, { platform: "linux", log: () => {} }),
      { code: "task005_git_materials_public_cleanup_failed" });
    assert.equal((await lstat(path.join(publicRoot, "unknown"))).isFile(), true);
    await rm(path.join(publicRoot, "unknown"));
    await chmod(path.join(publicRoot, "receipt.json"), 0o600);
    await run(["dispose-public"], fixture.env, { platform: "linux", log: () => {} });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("child result classification preserves only closed diagnostics across direct and carrier operations", async (t) => {
  const overflow = Buffer.alloc(limits.childOutputBytes + 1, 0x78);
  const cases = [
    { name: "timeout", result: { error: { code: "ETIMEDOUT" } }, code: "task005_git_materials_child_timeout",
      diagnostic: expectedDiagnostic(null, "TIMEOUT") },
    { name: "native output cap", result: { error: { code: "ENOBUFS" } }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "OUTPUT_CAP") },
    { name: "measured output cap", result: { status: 0, stdout: overflow, stderr: Buffer.alloc(0) },
      code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "OUTPUT_CAP", { stdoutBytes: limits.childOutputBytes + 1 }) },
    { name: "spawn error", result: { error: { code: "EACCES" } }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "SPAWN_ERROR") },
    { name: "signal", result: { signal: "SIGKILL" }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "SIGNAL", { signal: "SIGKILL" }) },
    { name: "exit status", result: { status: 23 }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "EXIT_STATUS", { status: 23 }) },
    { name: "invalid result", result: { status: 256 }, code: "task005_git_materials_child_failed",
      diagnostic: expectedDiagnostic(null, "RESULT_INVALID") },
  ];
  for (const operation of ["PROBE_IMAGE_PULL", "MATERIAL_QUERY"]) {
    for (const item of cases) {
      await t.test(`${operation} ${item.name}`, () => {
        const error = captureThrown(() => validateCommandResult(item.result, [0], operation));
        assert.equal(error.code, item.code);
        assert.deepEqual(error.childDiagnostic, { ...item.diagnostic, operation });
        const serialized = JSON.stringify(error.childDiagnostic);
        assert.doesNotMatch(serialized, /PRIVATE|EACCES|ETIMEDOUT|ENOBUFS/u);
      });
    }
  }
});

test("child result classification applies the approved precedence without relaxing successful status", () => {
  const timedOut = captureThrown(() => validateCommandResult({
    error: { code: "ETIMEDOUT" }, signal: "SIGKILL", status: 23,
    stdout: Buffer.alloc(limits.childOutputBytes + 1),
  }, [0], "PROBE_IMAGE_PULL"));
  assert.deepEqual(timedOut.childDiagnostic, expectedDiagnostic("PROBE_IMAGE_PULL", "TIMEOUT",
    { stdoutBytes: limits.childOutputBytes + 1 }));

  const spawnError = captureThrown(() => validateCommandResult({ error: { code: "EACCES" }, signal: "SIGKILL", status: 23 },
    [0], "PROBE_IMAGE_PULL"));
  assert.deepEqual(spawnError.childDiagnostic, expectedDiagnostic("PROBE_IMAGE_PULL", "SPAWN_ERROR"));

  const signalled = captureThrown(() => validateCommandResult({ signal: "SIGKILL", status: 23 },
    [0], "PROBE_IMAGE_PULL"));
  assert.deepEqual(signalled.childDiagnostic, expectedDiagnostic("PROBE_IMAGE_PULL", "SIGNAL", { signal: "SIGKILL" }));

  const stdout = Buffer.from("ok");
  const stderr = Buffer.alloc(0);
  assert.deepEqual(validateCommandResult({ status: 0, stdout, stderr }, [0], "PROBE_IMAGE_PULL"),
    { status: 0, stdout, stderr });
});

test("signal projection preserves only the native allowlist", async (t) => {
  for (const signal of ["SIGABRT", "SIGALRM", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL",
    "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP", "SIGUSR1", "SIGUSR2"]) {
    await t.test(signal, () => {
      const error = captureThrown(() => validateCommandResult({ signal }, [0], "MATERIAL_QUERY"));
      assert.equal(error.childDiagnostic.signal, signal);
    });
  }
  const other = captureThrown(() => validateCommandResult({ signal: "SIGPRIVATE" }, [0], "MATERIAL_QUERY"));
  assert.equal(other.childDiagnostic.signal, "OTHER");
});

test("hostile child results cannot invoke accessors or expose inherited and private data", () => {
  let getterCalls = 0;
  const result = Object.create({ status: 23, stdout: Buffer.from("INHERITED_PRIVATE") });
  Object.defineProperty(result, "error", { get() { getterCalls += 1; throw new Error("PRIVATE_GETTER"); } });
  Object.defineProperty(result, "stderr", { get() { getterCalls += 1; return Buffer.from("PRIVATE_STDERR"); } });
  const error = captureThrown(() => validateCommandResult(result, [0], "MATERIAL_QUERY"));
  assert.equal(getterCalls, 0);
  assert.deepEqual(error.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "RESULT_INVALID"));
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE/u);

  const trapped = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("PRIVATE_PROXY"); } });
  const trappedError = captureThrown(() => validateCommandResult(trapped, [0], "MATERIAL_QUERY"));
  assert.deepEqual(trappedError.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "RESULT_INVALID"));
});

test("child byte counts ignore non-Buffers and clamp each stream independently", () => {
  const nonBuffers = captureThrown(() => validateCommandResult({ status: 23, stdout: "PRIVATE", stderr: new Uint8Array(9) },
    [0], "MATERIAL_QUERY"));
  assert.deepEqual(nonBuffers.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23 }));

  const oversized = captureThrown(() => validateCommandResult({ status: 0,
    stdout: Buffer.alloc(limits.childOutputBytes + 2), stderr: Buffer.alloc(limits.childOutputBytes + 3) },
  [0], "MATERIAL_QUERY"));
  assert.deepEqual(oversized.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "OUTPUT_CAP", {
    stdoutBytes: limits.childOutputBytes + 1, stderrBytes: limits.childOutputBytes + 1,
  }));
});

test("invalid operations reject before command invocation and carrier resource mutation", () => {
  let calls = 0;
  const command = () => { calls += 1; return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; };
  assert.throws(() => runCommand("MATERIAL_git=2.54.0-r0", command, "docker", ["version"], {
    cwd: "C:/private", env: {}, timeoutMs: 1,
  }), { code: "task005_git_materials_child_failed" });
  assert.equal(calls, 0);

  const resources = { nextOrdinal: 4, containerNames: ["retained"] };
  assert.throws(() => runCarrier({ runId: "40999999999", privateRoot: "C:/private" }, resources, command,
    "UNKNOWN_OPERATION", "/sbin/apk", ["--version"]), { code: "task005_git_materials_child_failed" });
  assert.equal(calls, 0);
  assert.deepEqual(resources, { nextOrdinal: 4, containerNames: ["retained"] });
});

test("the child operation set is exact, unique and immutable", () => {
  const expected = [
    "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "PROBE_APK_VERSION",
    "PROBE_HELP_ROOT", "PROBE_HELP_ADD", "PROBE_HELP_VERIFY", "PROBE_HELP_QUERY",
    "PROBE_HELP_MANIFEST", "PROBE_HELP_FETCH", "PROBE_HELP_VERSION", "MATERIAL_KEYS",
    "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST", "MATERIAL_QUERY",
    "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST", "MATERIAL_SIMULATE_SECOND",
    "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE", "CLEANUP_CONTAINER_DISCOVER",
    "CLEANUP_CONTAINER_LIST", "CLEANUP_CONTAINER_REMOVE", "CLEANUP_IMAGE_LIST", "CLEANUP_IMAGE_REMOVE",
  ];
  assert.deepEqual([...childOperations], expected);
  assert.equal(new Set(childOperations).size, 27);
  assert.ok(childOperations.every((operation) => /^[A-Z][A-Z0-9_]*$/u.test(operation)));
  assert.equal(Object.isFrozen(childOperations), true);
});

test("public failure projection accepts only a complete closed diagnostic", () => {
  const error = childFailure("MATERIAL_QUERY", {
    status: 23, stdout: Buffer.from("PRIVATE_STDOUT_SENTINEL"), stderr: Buffer.from("PRIVATE_STDERR_SENTINEL"),
  });
  error.path = "C:/PRIVATE/material.apk";
  error.stack = "PRIVATE_STACK";
  const projected = JSON.parse(publicFailure(error));
  assert.deepEqual(projected, {
    actor: "TASK005_GIT_MATERIALS_V1",
    authority: "DIAGNOSTIC_ONLY",
    childDiagnostic: expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", {
      status: 23, stdoutBytes: 23, stderrBytes: 23,
    }),
    code: "task005_git_materials_child_failed",
    installationAuthorization: false,
    state: "FAILED",
  });
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|material\.apk/u);

  for (const diagnostic of [
    { ...error.childDiagnostic, extra: "PRIVATE" },
    Object.create({ operation: "MATERIAL_QUERY" }, Object.fromEntries(Object.entries(error.childDiagnostic)
      .filter(([key]) => key !== "operation").map(([key, value]) => [key, { value, enumerable: true }]))),
    Object.assign(Object.create({ inherited: "PRIVATE" }), error.childDiagnostic),
    { ...error.childDiagnostic, status: 22.5 },
    { ...error.childDiagnostic, reason: "TIMEOUT" },
  ]) {
    const safe = JSON.parse(publicFailure({ code: error.code, childDiagnostic: diagnostic }));
    assert.equal(safe.code, error.code);
    assert.equal(Object.hasOwn(safe, "childDiagnostic"), false);
    assert.doesNotMatch(JSON.stringify(safe), /PRIVATE/u);
  }
});

test("public failure projection never invokes code or diagnostic accessors", () => {
  let calls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "code", { get() { calls += 1; throw new Error("PRIVATE_CODE"); } });
  Object.defineProperty(hostile, "childDiagnostic", { get() { calls += 1; throw new Error("PRIVATE_DIAGNOSTIC"); } });
  assert.equal(JSON.parse(publicFailure(hostile)).code, "task005_git_materials_failed");
  assert.equal(calls, 0);
});

test("the seven exact help tuples accept status one", async (t) => {
  for (const helpCase of HELP_CASES) {
    await t.test(helpCase.operation, () => {
      let calls = 0;
      const resources = freshCarrierResources();
      const result = runCarrier(carrierContext(), resources, () => {
        calls += 1;
        return { status: 1, stdout: Buffer.from("valid help"), stderr: Buffer.alloc(0) };
      }, helpCase.operation, "/sbin/apk", [...helpCase.args]);
      assert.equal(result.status, 1);
      assert.equal(result.stdout.toString("utf8"), "valid help");
      assert.equal(calls, 1);
      assert.deepEqual(resources, {
        carrierMayBeOwned: false,
        containerNames: ["aw-task005-git-materials-40999999999-001"],
        nextOrdinal: 1,
      });
    });
  }
});

test("the seven exact help tuples reject every alternate exit status", async (t) => {
  for (const helpCase of HELP_CASES) {
    for (const status of [0, 2, 23, 125, 126, 127]) {
      await t.test(`${helpCase.operation} status ${status}`, () => {
        const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
          status, stdout: Buffer.from("valid help"), stderr: Buffer.alloc(0),
        }), helpCase.operation, "/sbin/apk", [...helpCase.args]));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(helpCase.operation,
          status === 0 ? "RESULT_INVALID" : "EXIT_STATUS", { status: status === 0 ? null : status,
            stdoutBytes: 10 }));
      });
    }
  }
});

test("help status one does not override child failure precedence", async (t) => {
  const cases = [
    ["spawn error", { status: 1, error: Object.assign(new Error("private"), { code: "EACCES" }),
      stdout: Buffer.from("help"), stderr: Buffer.alloc(0) }, "SPAWN_ERROR", { stdoutBytes: 4 }],
    ["signal", { status: 1, signal: "SIGKILL", stdout: Buffer.from("help"), stderr: Buffer.alloc(0) },
      "SIGNAL", { signal: "SIGKILL", stdoutBytes: 4 }],
    ["output cap", { status: 1, stdout: Buffer.alloc(limits.childOutputBytes + 1), stderr: Buffer.alloc(0) },
      "OUTPUT_CAP", { stdoutBytes: limits.childOutputBytes + 1 }],
  ];
  for (const [name, result, reason, diagnostic] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
        "PROBE_HELP_ROOT", "/sbin/apk", ["--help"]));
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, expectedDiagnostic("PROBE_HELP_ROOT", reason, diagnostic));
    });
  }
});

test("help stream shape is closed after status validation", async (t) => {
  const refused = [
    ["empty stdout", { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }],
    ["malformed UTF-8 stdout", { status: 1, stdout: Buffer.from([0xff]), stderr: Buffer.alloc(0) }],
    ["nonempty stderr", { status: 1, stdout: Buffer.from("help"), stderr: Buffer.from("private") }],
    ["non-Buffer stdout", { status: 1, stdout: "help", stderr: Buffer.alloc(0) }],
    ["non-Buffer stderr", { status: 1, stdout: Buffer.from("help"), stderr: "PRIVATE_STDERR" }],
  ];
  for (const [name, result] of refused) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
        "PROBE_HELP_ROOT", "/sbin/apk", ["--help"]));
      assert.equal(error.code, "task005_git_materials_probe_not_run");
      assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
    });
  }
  await t.test("valid whitespace remains a stream-shape success", () => {
    const result = runCarrier(carrierContext(), freshCarrierResources(), () => ({
      status: 1, stdout: Buffer.from(" "), stderr: Buffer.alloc(0),
    }), "PROBE_HELP_ROOT", "/sbin/apk", ["--help"]);
    assert.equal(result.stdout.toString("utf8"), " ");
  });
});

test("wrong help tuples refuse before command or resource mutation", async (t) => {
  for (const helpCase of HELP_CASES) {
    const sparseArgs = new Array(helpCase.args.length);
    for (let index = 1; index < helpCase.args.length; index += 1) sparseArgs[index] = helpCase.args[index];
    const mutations = [
      ["entrypoint", "/bin/sh", [...helpCase.args], []],
      ["args", "/sbin/apk", [...helpCase.args, "--private"], []],
      ["sparse args", "/sbin/apk", sparseArgs, []],
      ["mounts", "/sbin/apk", [...helpCase.args], [{ source: "C:/private", target: "/materials" }]],
    ];
    for (const [name, entrypoint, args, mounts] of mutations) {
      await t.test(`${helpCase.operation} ${name}`, () => {
        let calls = 0;
        const command = () => { calls += 1; return { status: 1, stdout: Buffer.from("help"),
          stderr: Buffer.alloc(0) }; };
        const resources = { carrierMayBeOwned: false, containerNames: ["retained"], nextOrdinal: 4 };
        const before = { ...resources, containerNames: [...resources.containerNames] };
        const error = captureThrown(() => runCarrier(carrierContext(), resources, command, helpCase.operation,
          entrypoint, args, mounts));
        assert.equal(error.code, "task005_git_materials_probe_not_run");
        assert.equal(Object.hasOwn(error, "childDiagnostic"), false);
        assert.equal(calls, 0);
        assert.deepEqual(resources, before);
      });
    }
  }
});

test("status one remains rejected by every non-help carrier operation", async (t) => {
  for (const operation of ["PROBE_APK_VERSION", ...MATERIAL_OPERATIONS]) {
    await t.test(operation, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
        status: 1, stdout: Buffer.from("output"), stderr: Buffer.alloc(0),
      }), operation, "/sbin/apk", ["--version"]));
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
        status: 1, stdoutBytes: 6,
      }));
    });
  }
});

test("status one remains rejected by every direct child operation", async (t) => {
  for (const operation of DIRECT_OPERATIONS) {
    await t.test(operation, () => {
      const error = captureThrown(() => runCommand(operation, () => ({
        status: 1, stdout: Buffer.from("output"), stderr: Buffer.alloc(0),
      }), "docker", ["version"], { cwd: "C:/private", env: {}, timeoutMs: 1 }));
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
        status: 1, stdoutBytes: 6,
      }));
    });
  }
});

test("status zero remains accepted by every non-help child operation", async (t) => {
  for (const operation of ["PROBE_APK_VERSION", ...MATERIAL_OPERATIONS, ...DIRECT_OPERATIONS]) {
    await t.test(operation, () => {
      const command = () => ({ status: 0, stdout: Buffer.from("output"), stderr: Buffer.alloc(0) });
      const result = DIRECT_OPERATIONS.includes(operation)
        ? runCommand(operation, command, "docker", ["version"], { cwd: "C:/private", env: {}, timeoutMs: 1 })
        : runCarrier(carrierContext(), freshCarrierResources(), command, operation, "/sbin/apk", ["--version"]);
      assert.equal(result.status, 0);
    });
  }
});

test("material commands use only the network denial selected from exact add-help tokens", async (t) => {
  const cases = [
    ["BOOL", helpWithAdd(canonicalAddTokens(NETWORK_BOOL_TOKEN).join(" ")), "--network=no"],
    ["alias", helpWithAdd(canonicalAddTokens(NETWORK_ALIAS_TOKEN).join(" ")), "--no-network"],
    ["add BOOL overrides root alias", helpWithAdd(canonicalAddTokens(NETWORK_BOOL_TOKEN).join(" "),
      NETWORK_ALIAS_TOKEN), "--network=no"],
    ["add alias overrides root BOOL", helpWithAdd(canonicalAddTokens(NETWORK_ALIAS_TOKEN).join(" "),
      NETWORK_BOOL_TOKEN), "--no-network"],
    ["BOOL precedes alias duplicates and decoys", helpWithAdd([...canonicalAddTokens(NETWORK_BOOL_TOKEN),
      NETWORK_ALIAS_TOKEN, NETWORK_BOOL_TOKEN, NETWORK_ALIAS_TOKEN, "--networking",
      "--network[=BOOL]suffix", "prefix--no-network"].join(" ")), "--network=no"],
  ];
  for (const [name, help, expected] of cases) {
    await t.test(name, async () => {
      assert.deepEqual(await materialNetworkArguments(help), Array(4).fill(expected));
    });
  }
});

test("unsupported add-help network forms refuse before child fetch or material filesystem effects", async (t) => {
  const cases = [
    ["missing", ""], ["MODE", "--network=MODE"], ["spaced MODE", "--network MODE"],
    ["bare", "--network"], ["affirmative", "--network=yes"], ["loose alias", "--offline"],
    ["networking", "--networking"], ["BOOL suffix", "--network[=BOOL]suffix"],
    ["alias prefix", "prefix--no-network"],
  ];
  for (const [name, presentation] of cases) {
    await t.test(name, async () => {
      const add = [...canonicalAddTokens().filter((value) => value !== NETWORK_BOOL_TOKEN), presentation]
        .filter(Boolean).join(" ");
      await assertMaterialNetworkRefusal(helpWithAdd(add, `${NETWORK_BOOL_TOKEN} ${NETWORK_ALIAS_TOKEN}`));
    });
  }
  await t.test("malformed UTF-8", async () => {
    const help = completeHelp();
    help.add = Buffer.from([0xff]);
    await assertMaterialNetworkRefusal(help);
  });
});

test("actor source outside parseTransaction equals the immutable V9 actor after namespace normalization", async () => {
  const source = reverseV11ActorChanges(await readFile(actorPath, "utf8"));
  const currentDeclaration = `const ACCEPTED_BASE = "${BASE}";`;
  const historicalDeclaration = `const ACCEPTED_BASE = "${HISTORICAL_V9_BASE}";`;
  assert.equal(source.split(currentDeclaration).length - 1, 1);
  assert.equal(source.split(historicalDeclaration).length - 1, 0);

  const normalize = (candidate) => {
    assert.equal(candidate.split(currentDeclaration).length - 1, 1);
    assert.equal(candidate.split(historicalDeclaration).length - 1, 0);
    const historical = candidate.replace(currentDeclaration, historicalDeclaration);
    assert.equal(historical.split(currentDeclaration).length - 1, 0);
    assert.equal(historical.split(historicalDeclaration).length - 1, 1);
    const start = historical.indexOf("function parseTransaction(bytes) {");
    const end = historical.indexOf("function stringArray(", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return `${historical.slice(0, start)}/* PARSE_TRANSACTION_V10_BOUNDARY */\n\n${historical.slice(end)}`
      .replaceAll("task005-git-materials-v11", "task005-git-materials-v9")
      .replaceAll("task-0005-git-materials-v11", "task-0005-git-materials-v9")
      .replaceAll("task005.git-materials-v11", "task005.git-materials-v9");
  };

  const bounded = normalize(source);
  assert.equal(Buffer.byteLength(bounded), 80323);
  assert.equal(hash(Buffer.from(bounded)), "7d0a92a5f709ecadda54d07d803eea71d6b5ea7725afe08df21582d1e9a675d7");

  const unrelatedMutation = source.replace("const KiB = 1024;", "const KiB = 1025;");
  assert.notEqual(unrelatedMutation, source);
  assert.notEqual(hash(Buffer.from(normalize(unrelatedMutation))),
    "7d0a92a5f709ecadda54d07d803eea71d6b5ea7725afe08df21582d1e9a675d7");
});

test("workflow bytes equal the frozen V9 workflow after approved namespace normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v11", "task005-git-materials-v9")
    .replaceAll("task-0005-git-materials-v11", "task-0005-git-materials-v9")
    .replaceAll("diagnostic V11", "diagnostic V9"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "2ced4f54571e11589406df9e1e5f52de21a91d29a8841ebfab06c3f659f44d29");
});

test("workflow bytes equal the frozen V8 workflow after approved namespace normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v11", "task005-git-materials-v8")
    .replaceAll("task-0005-git-materials-v11", "task-0005-git-materials-v8")
    .replaceAll("diagnostic V11", "diagnostic V8"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "dfdf1135fdd42da3c7893ada8e74194f879ffcab3b13725980bfcbfd30522290");
});

test("workflow bytes retain the frozen V7 workflow seal through V8 normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v11", "task005-git-materials-v7")
    .replaceAll("task-0005-git-materials-v11", "task-0005-git-materials-v7")
    .replaceAll("diagnostic V11", "diagnostic V7"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "9ce94988e64f2bd886570c397d95317d2f2a969ac3365e7e76a4d8536d2d4a7b");
});

test("workflow bytes retain the frozen V6 workflow seal through V7 normalization", async () => {
  const bytes = await readFile(workflowPath);
  const normalized = Buffer.from(bytes.toString("utf8")
    .replaceAll("task005-git-materials-v11", "task005-git-materials-v6")
    .replaceAll("task-0005-git-materials-v11", "task-0005-git-materials-v6")
    .replaceAll("diagnostic V11", "diagnostic V6"));
  assert.equal(normalized.length, 3934);
  assert.equal(hash(normalized), "3a24853a41d2ca8697d1ca9925108726a99b6c6b386e5f51ea012215ccf71757");
});

test("material child commands remain byte-equivalent to the frozen V2 transcript", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 },
    });
    const v8Records = reverseOwnerBindingToV8(observed.records, `${FIXTURE_UID}:${FIXTURE_GID}`);
    const v6Records = reverseChecksumInvocationsToV6(v8Records);
    const transcript = v6Records.map((record) => normalizedCommandRecord(record, context));
    assert.equal(transcript.length, 11);
    assert.deepEqual(transcript.map((record) => record.executable), Array(11).fill("docker"));
    assert.equal(hash(Buffer.from(canonicalJson(transcript))),
      "0b7a76654e5ecb38a2369b0d2140ec5504db18ad664af41fa9c62f1f42930dde");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("legacy-ten and canonical-ten full observations use identical commands and normalized transactions", async () => {
  const legacy = await collectTenPackageObservation({ canonical: false });
  const canonical = await collectTenPackageObservation({ canonical: true });
  assert.equal(legacy.transcript.length, 38);
  assert.deepEqual(canonical.transcript, legacy.transcript);
  assert.deepEqual(legacy.evidence.receipt.transaction.entries, legacy.entries);
  assert.deepEqual(canonical.evidence.receipt.transaction.entries, legacy.entries);
  assert.deepEqual(canonical.evidence.receipt.transaction, legacy.evidence.receipt.transaction);
  assert.equal(legacy.fetchCalls.length, 12);
  assert.equal(canonical.fetchCalls.length, 12);
});

test("ten-package observation rejects malformed padding in the first simulation", async () => {
  const entries = transactionEntries(10, 6);
  const malformed = transactionText(entries, { canonical: true }).replace("( 1/10)", "(  1/10)");
  const observed = await captureTenPackageRefusal({ canonical: true, firstOutput: malformed });
  assert.equal(observed.error.code, "task005_git_materials_solver_invalid");
  assert.equal(observed.records.length, 4);
  assert.equal(observed.fetchCalls.length, 1);
});

test("ten-package observation rejects malformed padding in the second simulation", async () => {
  const entries = transactionEntries(10, 6);
  const malformed = transactionText(entries, { canonical: true }).replace("( 1/10)", "(  1/10)");
  const observed = await captureTenPackageRefusal({ canonical: true, secondOutput: malformed });
  assert.equal(observed.error.code, "task005_git_materials_solver_invalid");
  assert.equal(observed.records.length, 36);
  assert.equal(observed.fetchCalls.length, 11);
  assert.equal(observed.fetchCalls.some((url) => url.endsWith("main.json")), false);
});

test("ten-package observation rejects a normalized transaction mismatch", async () => {
  const entries = transactionEntries(10, 6);
  const second = transactionText(entries.map((entry) => entry.order === 1
    ? { ...entry, version: "1.99-r0" }
    : entry), { canonical: true });
  const observed = await captureTenPackageRefusal({ canonical: true, secondOutput: second });
  assert.equal(observed.error.code, "task005_git_materials_solver_invalid");
  assert.equal(observed.records.length, 36);
  assert.equal(observed.fetchCalls.some((url) => url.endsWith("main.json")), false);
});

test("ten-package observation preserves installed-database mismatch refusal", async () => {
  const observed = await captureTenPackageRefusal({
    canonical: true,
    installedBeforeHash: "b".repeat(64),
    installedAfterHash: "c".repeat(64),
  });
  assert.equal(observed.error.code, "task005_git_materials_solver_invalid");
  assert.equal(observed.records.length, 37);
  assert.equal(observed.fetchCalls.some((url) => url.endsWith("main.json")), false);
});

test("source-derived root presentation preserves the frozen material transcript", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: sourceDerivedHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    const v8Records = reverseOwnerBindingToV8(observed.records, `${FIXTURE_UID}:${FIXTURE_GID}`);
    const v6Records = reverseChecksumInvocationsToV6(v8Records);
    const transcript = v6Records.map((record) => normalizedCommandRecord(record, context));
    assert.equal(transcript.length, 11);
    assert.deepEqual(recordedNetworkArguments(observed.records), Array(4).fill("--network=no"));
    assert.equal(hash(Buffer.from(canonicalJson(transcript))),
      "0b7a76654e5ecb38a2369b0d2140ec5504db18ad664af41fa9c62f1f42930dde");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("source contains only the three reviewed checksum invocation changes", async () => {
  const source = await readFile(actorPath, "utf8");
  assert.equal(source.match(/"\/bin\/busybox",\s*\["sha256sum", "\/lib\/apk\/db\/installed"\]/gu)?.length, 2);
  assert.equal(source.match(/\| \/bin\/busybox sha256sum/gu)?.length, 1);
  assert.equal(source.match(/"\/bin\/sha256sum"/gu)?.length ?? 0, 0);
  assert.equal(source.match(/\| \/bin\/sha256sum/gu)?.length ?? 0, 0);
  const keyScript = source.match(/const keyScript = (".*");\r?\n/u);
  assert.ok(keyScript);
  assert.equal(JSON.parse(keyScript[1]),
    "set -eu; find /etc/apk/keys -mindepth 1 -maxdepth 1 -exec /bin/sh -ceu 'for f do [ -f \"$f\" ] && [ ! -L \"$f\" ] && [ \"$(stat -c %h \"$f\")\" = 1 ] || exit 41; n=$(basename \"$f\"); b=$(wc -c < \"$f\"); h=$(sha256sum \"$f\" | cut -d\" \" -f1); printf \"%s\\t%s\\t%s\\n\" \"$n\" \"$b\" \"$h\"; done' actor {} +");
});

test("default probe accepts seven status-one help results and reaches materialization", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  let materializeCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = probeCommandFixture(context);
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: cleanupPrivate,
      materialize: () => {
        materializeCalls += 1;
        throw Object.assign(new Error("controlled boundary"), { code: "task005_git_materials_material_invalid" });
      },
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(materializeCalls, 1);
    assert.equal(observed.records.length, 11);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default probe accepts the source-derived root presentation and reaches materialization", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  let materializeCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = probeCommandFixture(context, -1, sourceDerivedHelp());
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: cleanupPrivate,
      materialize: () => {
        materializeCalls += 1;
        throw Object.assign(new Error("controlled boundary"), { code: "task005_git_materials_material_invalid" });
      },
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(materializeCalls, 1);
    assert.equal(observed.records.length, 11);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default probe refuses incomplete source-derived root presentations before materialization", {
  skip: process.platform !== "linux",
}, async (t) => {
  const unicodeAdd = `${addTokensWithoutBareRoot().join(" ")} --root,\u00a0-p ROOT`;
  const cases = [
    ["missing alias", helpWithRootPresentation(["--root,", "ROOT"])],
    ["intervening token", helpWithRootPresentation(["--root,", "intervening", "-p", "ROOT"])],
    ["Unicode-only separation", helpWithAdd(unicodeAdd)],
  ];
  for (const [name, help] of cases) {
    await t.test(name, async () => {
      const fixture = await fixtureContext();
      let materializeCalls = 0;
      let fetchCalls = 0;
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = probeCommandFixture(context, -1, help);
        const evidence = await executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          fetchImpl: () => { fetchCalls += 1; assert.fail("NOT_RUN must precede material fetch"); },
          materialize: () => { materializeCalls += 1; return undefined; },
        });
        assert.equal(evidence.receipt.state, "NOT_RUN");
        assert.deepEqual(evidence.receipt.missingCapabilities, ["add:--root"]);
        assert.equal(materializeCalls, 0);
        assert.equal(fetchCalls, 0);
        assert.equal(observed.records.length, 11);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("default probe keeps incomplete status-one help at NOT_RUN before materialization", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  let materializeCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const observed = probeCommandFixture(context, -1, helpWithoutManifestCapability());
    const evidence = await executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: cleanupPrivate,
      materialize: () => { materializeCalls += 1; return undefined; },
    });
    assert.equal(evidence.receipt.state, "NOT_RUN");
    assert.deepEqual(evidence.receipt.missingCapabilities, ["manifest:manifest"]);
    assert.equal(materializeCalls, 0);
    assert.equal(observed.records.length, 11);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default probe keeps incomplete add-global evidence at NOT_RUN before materialization", {
  skip: process.platform !== "linux",
}, async (t) => {
  const cases = [
    ["missing exact global token", helpWithoutExactAddToken("--repositories-file",
      ["prefix--repositories-file", "--repositories-file-suffix"]), ["add:--repositories-file"]],
    ["missing exact network presentation", helpWithAdd(canonicalAddTokens()
      .filter((value) => value !== NETWORK_BOOL_TOKEN).join(" "), NETWORK_BOOL_TOKEN), ["add:network-denial"]],
  ];
  for (const [name, help, missing] of cases) {
    await t.test(name, async () => {
      const fixture = await fixtureContext();
      let materializeCalls = 0;
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = probeCommandFixture(context, -1, help);
        const evidence = await executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          materialize: () => { materializeCalls += 1; return undefined; },
        });
        assert.equal(evidence.receipt.state, "NOT_RUN");
        assert.deepEqual(evidence.receipt.missingCapabilities, missing);
        assert.equal(materializeCalls, 0);
        assert.equal(observed.records.length, 11);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("every probe operation is wired to the real failing child call", { skip: process.platform !== "linux" }, async (t) => {
  const operations = [
    "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "PROBE_APK_VERSION",
    "PROBE_HELP_ROOT", "PROBE_HELP_ADD", "PROBE_HELP_VERIFY", "PROBE_HELP_QUERY",
    "PROBE_HELP_MANIFEST", "PROBE_HELP_FETCH", "PROBE_HELP_VERSION",
  ];
  for (const [failAt, operation] of operations.entries()) {
    await t.test(operation, async () => {
      const fixture = await fixtureContext();
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = probeCommandFixture(context, failAt);
        const error = await captureRejected(() => executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          materialize: () => assert.fail("probe failure must stop before material collection"),
        }));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
          status: 23, stderrBytes: 13,
        }));
        assert.equal(observed.records.length, failAt + 1);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("every material operation is wired to the real failing carrier call", { skip: process.platform !== "linux" }, async (t) => {
  const operations = [
    "MATERIAL_KEYS", "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST",
    "MATERIAL_QUERY", "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST",
    "MATERIAL_SIMULATE_SECOND", "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE",
  ];
  for (const [failAt, operation] of operations.entries()) {
    await t.test(operation, async () => {
      const fixture = await fixtureContext();
      const observed = observationFixture({ failAt, secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
      try {
        const context = await requireContext(fixture.env, "linux");
        const error = await captureRejected(() => executeActor(context, {
          statfs: async () => enoughCapacity(),
          command: observed.command,
          cleanup: cleanupPrivate,
          probe: async () => ({
            version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(), imageId: FIXTURE_IMAGE_ID,
          }),
          fetchImpl: observed.fetchImpl,
          now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
        }));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
          status: 23, stdoutBytes: 23, stderrBytes: 23,
        }));
        assert.equal(observed.records.length, failAt + 1);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("every cleanup operation is wired to the real failing child call", { skip: process.platform !== "linux" }, async (t) => {
  const cases = [
    [0, "CLEANUP_CONTAINER_DISCOVER"],
    [1, "CLEANUP_CONTAINER_LIST"],
    [2, "CLEANUP_CONTAINER_REMOVE"],
    [4, "CLEANUP_IMAGE_LIST"],
    [5, "CLEANUP_IMAGE_REMOVE"],
  ];
  for (const [failAt, operation] of cases) {
    await t.test(operation, async () => {
      const fixture = await fixtureContext();
      try {
        const context = await requireContext(fixture.env, "linux");
        const observed = await cleanupFaultFixture(context, failAt);
        const error = await captureRejected(() => cleanupOwnedState(context, observed.command));
        assert.equal(error.code, "task005_git_materials_child_failed");
        assert.deepEqual(error.childDiagnostic, expectedDiagnostic(operation, "EXIT_STATUS", {
          status: 23, stderrBytes: 15,
        }));
        assert.equal(observed.records.length, failAt + 1);
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("failure marker metadata is rejected before any unsafe read", async (t) => {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  const valid = Buffer.from('{"code":"task005_git_materials_child_failed"}\n');
  const base = { isFile: () => true, isSymbolicLink: () => false, nlink: 1, mode: 0o100600, size: valid.length };
  const cases = [
    ["directory", { isFile: () => false }],
    ["symlink", { isSymbolicLink: () => true }],
    ["hardlink", { nlink: 2 }],
    ["unsafe mode", { mode: 0o100644 }],
    ["too small", { size: 2 }],
    ["oversize", { size: 1025 }],
    ["noninteger size", { size: 4.5 }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      let reads = 0;
      const info = { ...base, ...override };
      await assert.rejects(readFailureMarker(context, {
        lstat: async () => info,
        readFile: async () => { reads += 1; throw new Error("PRIVATE_READ"); },
      }), { code: "task005_git_materials_cleanup_failed" });
      assert.equal(reads, 0);
    });
  }
});

test("failure marker accepts only canonical bounded UTF-8 records", async (t) => {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  const validDiagnostic = expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23, stderrBytes: 4 });
  const validRecords = [
    { code: "task005_git_materials_child_timeout" },
    { code: "task005_git_materials_child_failed" },
    { code: "task005_git_materials_download_failed" },
    { code: "task005_git_materials_child_failed", childDiagnostic: validDiagnostic },
  ];
  for (const record of validRecords) {
    await t.test(`accepts ${record.code}${record.childDiagnostic ? " with diagnostic" : " without diagnostic"}`, async () => {
      const bytes = Buffer.from(canonicalJson(record));
      let reads = 0;
      const observed = await readFailureMarker(context, {
        lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
          nlink: 1, mode: 0o100600, size: bytes.length }),
        readFile: async () => { reads += 1; return bytes; },
      });
      assert.deepEqual(observed, record);
      assert.equal(reads, 1);
    });
  }

  const invalid = [
    ["missing newline", Buffer.from('{"code":"task005_git_materials_child_failed"}')],
    ["leading whitespace", Buffer.from(' {"code":"task005_git_materials_child_failed"}\n')],
    ["duplicate key", Buffer.from('{"code":"task005_git_materials_child_failed","code":"task005_git_materials_child_failed"}\n')],
    ["malformed JSON", Buffer.from('{"code":\n')],
    ["invalid UTF-8", Buffer.from([0xff, 0xfe, 0xfd])],
    ["array root", Buffer.from('["task005_git_materials_child_failed"]\n')],
    ["null root", Buffer.from('null\n')],
    ["unexpected field", Buffer.from('{"code":"task005_git_materials_child_failed","private":"secret"}\n')],
    ["generic code with diagnostic", Buffer.from(canonicalJson({
      code: "task005_git_materials_download_failed", childDiagnostic: validDiagnostic,
    }))],
    ["timeout code with exit diagnostic", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_timeout", childDiagnostic: validDiagnostic,
    }))],
    ["child code with timeout diagnostic", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: expectedDiagnostic("MATERIAL_QUERY", "TIMEOUT"),
    }))],
    ["unknown operation", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, operation: "MATERIAL_PRIVATE" },
    }))],
    ["unknown reason", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, reason: "PRIVATE_REASON" },
    }))],
    ["unknown signal", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, reason: "SIGNAL", status: null, signal: "SIGPRIVATE" },
    }))],
    ["out of range exit status", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, status: 256 },
    }))],
    ["out of range byte count", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, stderrBytes: limits.childOutputBytes + 2 },
    }))],
    ["missing diagnostic key", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: Object.fromEntries(Object.entries(validDiagnostic).filter(([key]) => key !== "signal")),
    }))],
    ["fractional byte count", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, stderrBytes: 1.5 },
    }))],
    ["extra diagnostic field", Buffer.from(canonicalJson({
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...validDiagnostic, private: "secret" },
    }))],
  ];
  for (const [name, bytes] of invalid) {
    await t.test(`rejects ${name}`, async () => {
      await assert.rejects(readFailureMarker(context, {
        lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
          nlink: 1, mode: 0o100600, size: bytes.length }),
        readFile: async () => bytes,
      }), { code: "task005_git_materials_cleanup_failed" });
    });
  }
});

test("failure marker rejects a post-lstat size change", async () => {
  const context = { privateRoot: path.join(os.tmpdir(), "marker-fixture") };
  const bytes = Buffer.from('{"code":"task005_git_materials_child_failed"}\n');
  await assert.rejects(readFailureMarker(context, {
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false,
      nlink: 1, mode: 0o100600, size: bytes.length + 1 }),
    readFile: async () => bytes,
  }), { code: "task005_git_materials_cleanup_failed" });
});

test("the first child diagnostic survives cleanup failure and deferred publication", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const first = childFailure("MATERIAL_QUERY");
    const cleanup = childFailure("CLEANUP_CONTAINER_REMOVE");
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw first; },
      cleanup: async () => { throw cleanup; },
    }));
    assert.equal(observed, first);
    assert.deepEqual(observed.childDiagnostic, expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23 }));
    const marker = await readFailureMarker(context);
    assert.deepEqual(marker, { code: first.code, childDiagnostic: first.childDiagnostic });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });

    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const evidence = await readPublicEvidence(context);
    assert.deepEqual(evidence.receipt, {
      actor: "TASK005_GIT_MATERIALS_V1",
      authority: "DIAGNOSTIC_ONLY",
      childDiagnostic: first.childDiagnostic,
      cleanup: { containersAbsent: true, privateFilesAbsent: true },
      code: "task005_git_materials_child_failed",
      installationAuthorization: false,
      state: "BLOCKED",
    });
    assert.deepEqual(evidence.manifest, {
      actor: "TASK005_GIT_MATERIALS_MANIFEST_V1",
      authority: "DIAGNOSTIC_ONLY",
      files: [],
      installationAuthorization: false,
      state: "EMPTY_BLOCKED",
    });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("a cleanup-first child failure retains its own closed diagnostic", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const cleanup = childFailure("CLEANUP_CONTAINER_REMOVE");
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.",
        help: helpWithoutManifestCapability(), imageId: FIXTURE_IMAGE_ID }),
      cleanup: async () => { throw cleanup; },
    }));
    assert.equal(observed, cleanup);
    assert.deepEqual(await readFailureMarker(context), { code: cleanup.code, childDiagnostic: cleanup.childDiagnostic });
    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    const { receipt } = await readPublicEvidence(context);
    assert.deepEqual(receipt.childDiagnostic, cleanup.childDiagnostic);
    assert.equal(receipt.code, cleanup.code);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("immediate cleanup publishes the actor child diagnostic exactly once", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const first = childFailure("MATERIAL_QUERY");
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw first; },
      cleanup: cleanupPrivate,
    }));
    assert.equal(observed, first);
    const before = await readPublicEvidence(context);
    assert.deepEqual(before.receipt.childDiagnostic, first.childDiagnostic);
    await run(["cleanup"], fixture.env, { platform: "linux",
      command: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }), log: () => {} });
    assert.deepEqual(await readPublicEvidence(context), before);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("a pre-child internal timeout publishes no invented diagnostic", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const deadline = Object.assign(new Error("deadline"), { code: "task005_git_materials_child_timeout" });
    let childCalls = 0;
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: () => { childCalls += 1; throw new Error("must not run"); },
      probe: async () => { throw deadline; },
      cleanup: cleanupPrivate,
    }));
    assert.equal(observed, deadline);
    assert.equal(childCalls, 0);
    assert.equal(Object.hasOwn(observed, "childDiagnostic"), false);
    const { receipt } = await readPublicEvidence(context);
    assert.equal(receipt.code, "task005_git_materials_child_timeout");
    assert.equal(Object.hasOwn(receipt, "childDiagnostic"), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("an invalid deferred marker cannot suppress cleanup or publish forged evidence", { skip: process.platform !== "linux" }, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    await writeFile(path.join(context.privateRoot, "failure-code"),
      '{"code":"task005_git_materials_child_failed","private":"forged"}\n', { mode: 0o600 });
    let cleanupCalls = 0;
    await assert.rejects(run(["cleanup"], fixture.env, {
      platform: "linux",
      cleanup: async () => { cleanupCalls += 1; await cleanupPrivate(context); },
      log: () => {},
    }), { code: "task005_git_materials_cleanup_failed" });
    assert.equal(cleanupCalls, 1);
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("index verifier maps every exact reviewed native line to its closed category", async (t) => {
  for (const [literal, category] of INDEX_VERIFY_KNOWN) {
    await t.test(category, () => {
      const stdout = indexVerifyLine(literal);
      const error = indexVerifierFailure(stdout);
      const projected = projectedFailure(error);
      assert.equal(error.code, "task005_git_materials_child_failed");
      assert.deepEqual(error.childDiagnostic, indexDiagnostic(stdout.length));
      assert.deepEqual(Object.keys(error.childDiagnostic).sort(),
        ["operation", "reason", "signal", "status", "stderrBytes", "stdoutBytes"]);
      assert.equal(projected.nativeErrorCategory, category);
      assert.deepEqual(projected.childDiagnostic, error.childDiagnostic);
      assert.doesNotMatch(JSON.stringify(projected), new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    });
  }
  assert.equal(indexVerifyLine("Permission denied").length, 51);
  assert.equal(indexVerifyLine("crypto error").length, 46);
});

test("index verifier classifies unmatched validator-valid stream shapes as unknown", async (t) => {
  const known = indexVerifyLine(INDEX_VERIFY_KNOWN[0][0]);
  const cases = [
    ["synthetic 51 bytes", Buffer.alloc(51, 0x78), Buffer.alloc(0)],
    ["one byte", Buffer.from("x"), Buffer.alloc(0)],
    ["256 bytes", Buffer.alloc(256, 0x78), Buffer.alloc(0)],
    ["257 bytes", Buffer.alloc(257, 0x78), Buffer.alloc(0)],
    ["empty stdout", Buffer.alloc(0), Buffer.alloc(0)],
    ["missing stdout", OMIT_STREAM, Buffer.alloc(0)],
    ["non-Buffer stdout", "PRIVATE", Buffer.alloc(0)],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28]), Buffer.alloc(0)],
    ["UTF-8 BOM prefix", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), known]), Buffer.alloc(0)],
    ["prefix", Buffer.concat([Buffer.from("prefix"), known]), Buffer.alloc(0)],
    ["suffix", Buffer.concat([known, Buffer.from("suffix")]), Buffer.alloc(0)],
    ["case change", Buffer.from(known.toString("utf8").toLowerCase()), Buffer.alloc(0)],
    ["punctuation change", Buffer.from(known.toString("utf8").replace(": ", ":")), Buffer.alloc(0)],
    ["multiple lines", Buffer.concat([known, known]), Buffer.alloc(0)],
    ["embedded NUL", Buffer.from(known.toString("utf8").replace("UNTRUSTED", "UNTRUSTED\0")), Buffer.alloc(0)],
    ["CRLF", Buffer.from(known.toString("utf8").replace("\n", "\r\n")), Buffer.alloc(0)],
    ["ANSI", Buffer.from(`\u001b[31m${known.toString("utf8")}\u001b[0m`), Buffer.alloc(0)],
    ["known line with stderr", known, Buffer.from("x")],
    ["missing stderr", known, OMIT_STREAM],
    ["non-Buffer stderr", known, "PRIVATE"],
  ];
  for (const [name, stdout, stderr] of cases) {
    await t.test(name, () => {
      const error = indexVerifierFailure(stdout, stderr);
      const projected = projectedFailure(error);
      assert.equal(error.childDiagnostic.reason, "EXIT_STATUS");
      assert.equal(error.childDiagnostic.status, 1);
      assert.equal(projected.nativeErrorCategory, INDEX_VERIFY_UNKNOWN);
      assert.equal(projected.childDiagnostic.stdoutBytes, Buffer.isBuffer(stdout) ? stdout.length : 0);
      assert.equal(projected.childDiagnostic.stderrBytes, Buffer.isBuffer(stderr) ? stderr.length : 0);
    });
  }
});

test("index verifier category never overrides validator precedence", async (t) => {
  const stdout = indexVerifyLine("Permission denied");
  const cases = [
    ["status two", { status: 2, stdout, stderr: Buffer.alloc(0) }],
    ["timeout", { status: 1, error: { code: "ETIMEDOUT" }, stdout, stderr: Buffer.alloc(0) }],
    ["spawn error", { status: 1, error: { code: "EACCES" }, stdout, stderr: Buffer.alloc(0) }],
    ["signal", { status: 1, signal: "SIGKILL", stdout, stderr: Buffer.alloc(0) }],
    ["output cap", { status: 1, stdout: Buffer.alloc(limits.childOutputBytes + 1), stderr: Buffer.alloc(0) }],
  ];
  for (const [name, result] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
        INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
      assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
    });
  }
  await t.test("status zero remains success", () => {
    const result = runCarrier(carrierContext(), freshCarrierResources(), () => ({
      status: 0, stdout, stderr: Buffer.alloc(0),
    }), INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]);
    assert.equal(result.status, 0);
  });
});

test("index verifier category is bound to the exact operation and command tuple", async (t) => {
  const stdout = indexVerifyLine("Permission denied");
  const cases = [
    ["wrong operation", "MATERIAL_APK_VERIFY", INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]],
    ["wrong entrypoint", INDEX_VERIFY_OPERATION, "/bin/sh", [...INDEX_VERIFY_ARGS]],
    ["wrong subject", INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT,
      [...INDEX_VERIFY_ARGS.slice(0, -1), "/materials/repo/private.tar.gz"]],
    ["extra argument", INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS, "PRIVATE"]],
  ];
  for (const [name, operation, entrypoint, args] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
        status: 1, stdout, stderr: Buffer.alloc(0),
      }), operation, entrypoint, args));
      assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
    });
  }
  await t.test("sparse argv keeps existing invocation behavior without category", () => {
    const sparse = new Array(INDEX_VERIFY_ARGS.length);
    for (let index = 1; index < sparse.length; index += 1) sparse[index] = INDEX_VERIFY_ARGS[index];
    let calls = 0;
    const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => {
      calls += 1;
      return { status: 1, stdout, stderr: Buffer.alloc(0) };
    }, INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, sparse));
    assert.equal(calls, 1);
    assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
  });
});

test("index verifier snapshots hostile argv once before invocation", () => {
  const target = [...INDEX_VERIFY_ARGS];
  const descriptorReads = new Map();
  const args = new Proxy(target, {
    getOwnPropertyDescriptor(value, key) {
      descriptorReads.set(String(key), (descriptorReads.get(String(key)) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
  });
  let invokedCarrierArgs;
  const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), (_executable, dockerArgs) => {
    invokedCarrierArgs = [...dockerArgs];
    target[3] = "/materials/repo/PRIVATE.tar.gz";
    return { status: 1, stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0) };
  }, INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, args));
  const entrypointAt = invokedCarrierArgs.indexOf("--entrypoint");
  assert.deepEqual(invokedCarrierArgs.slice(entrypointAt + 3), INDEX_VERIFY_ARGS);
  assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
  assert.equal(descriptorReads.get("length"), 1);
  for (let index = 0; index < INDEX_VERIFY_ARGS.length; index += 1) {
    assert.equal(descriptorReads.get(String(index)), 1);
  }
});

test("index verifier snapshots each hostile result field once for validator and classifier", () => {
  const first = {
    stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0), error: undefined, signal: null, status: 1,
  };
  const descriptorReads = new Map();
  const result = new Proxy(first, {
    getOwnPropertyDescriptor(value, key) {
      const name = String(key);
      const count = (descriptorReads.get(name) ?? 0) + 1;
      descriptorReads.set(name, count);
      if (count > 1) return { configurable: true, enumerable: true, writable: true,
        value: name === "status" ? 0 : name === "stdout" ? Buffer.from("PRIVATE") : value[name] };
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
  });
  const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
    INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
  assert.deepEqual(error.childDiagnostic, indexDiagnostic(first.stdout.length));
  for (const field of ["stdout", "stderr", "error", "signal", "status"]) {
    assert.equal(descriptorReads.get(field), 1);
  }
});

test("index verifier result snapshot invokes no accessors", () => {
  let getterCalls = 0;
  const result = { stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0) };
  Object.defineProperty(result, "status", {
    get() { getterCalls += 1; throw new Error("PRIVATE_STATUS"); },
  });
  const error = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => result,
    INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(getterCalls, 0);
  assert.deepEqual(error.childDiagnostic, expectedDiagnostic(INDEX_VERIFY_OPERATION, "RESULT_INVALID", {
    stdoutBytes: 51,
  }));
  assert.equal(Object.hasOwn(projectedFailure(error), "nativeErrorCategory"), false);
});

test("classifier failure keeps the validator error primary and falls back to unknown", () => {
  const OriginalTextDecoder = globalThis.TextDecoder;
  const classifierFailure = new Error("PRIVATE_CLASSIFIER");
  globalThis.TextDecoder = class {
    decode() { throw classifierFailure; }
  };
  try {
    const error = indexVerifierFailure(indexVerifyLine("Permission denied"));
    assert.notEqual(error, classifierFailure);
    assert.deepEqual(error.childDiagnostic, indexDiagnostic(51));
    assert.equal(projectedFailure(error).nativeErrorCategory, INDEX_VERIFY_UNKNOWN);
  } finally {
    globalThis.TextDecoder = OriginalTextDecoder;
  }
});

test("foreign validator errors with forged diagnostics remain ineligible and preserve identity", () => {
  const line = indexVerifyLine("Permission denied");
  const foreign = Object.assign(new Error("PRIVATE_FOREIGN"), {
    code: "task005_git_materials_child_failed",
    childDiagnostic: indexDiagnostic(line.length),
    nativeErrorCategory: "EACCES",
  });
  const hostile = new Proxy(line, {
    get(target, key) {
      if (key === "length") throw foreign;
      return Reflect.get(target, key, target);
    },
  });
  const observed = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
    status: 1, stdout: hostile, stderr: Buffer.alloc(0),
  }), INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(observed, foreign);
  assert.equal(Object.hasOwn(projectedFailure(observed), "nativeErrorCategory"), false);
});

test("a validator error from an earlier call cannot gain a category from a later hostile snapshot", () => {
  const line = indexVerifyLine("Permission denied");
  const earlier = captureThrown(() => validateCommandResult({
    status: 1, stdout: line, stderr: Buffer.alloc(0),
  }, [0], INDEX_VERIFY_OPERATION));
  const hostile = new Proxy(line, {
    get(target, key) {
      if (key === "length") throw earlier;
      return Reflect.get(target, key, target);
    },
  });
  const observed = captureThrown(() => runCarrier(carrierContext(), freshCarrierResources(), () => ({
    status: 1, stdout: hostile, stderr: Buffer.alloc(0),
  }), INDEX_VERIFY_OPERATION, INDEX_VERIFY_ENTRYPOINT, [...INDEX_VERIFY_ARGS]));
  assert.equal(observed, earlier);
  assert.equal(Object.hasOwn(projectedFailure(observed), "nativeErrorCategory"), false);
});

test("trusted native categories survive safe projection while forged clones and accessors do not", () => {
  const trusted = indexVerifierFailure(indexVerifyLine("Permission denied"));
  assert.equal(projectedFailure(trusted).nativeErrorCategory, "EACCES");

  const forged = {
    code: trusted.code,
    childDiagnostic: { ...trusted.childDiagnostic },
    nativeErrorCategory: "EACCES",
  };
  assert.equal(Object.hasOwn(projectedFailure(forged), "nativeErrorCategory"), false);

  let getterCalls = 0;
  Object.defineProperty(forged, "nativeErrorCategory", {
    configurable: true,
    get() { getterCalls += 1; throw new Error("PRIVATE_CATEGORY"); },
  });
  forged[Symbol("PRIVATE_CATEGORY")] = "EACCES";
  assert.equal(Object.hasOwn(projectedFailure(forged), "nativeErrorCategory"), false);
  assert.equal(getterCalls, 0);
});

test("failure markers realize every known category only at its exact native byte length", async (t) => {
  for (const [literal, category] of INDEX_VERIFY_KNOWN) {
    await t.test(category, async (known) => {
      const length = indexVerifyLine(literal).length;
      const valid = { code: "task005_git_materials_child_failed",
        childDiagnostic: indexDiagnostic(length), nativeErrorCategory: category };
      const observed = await readMarkerBytes(Buffer.from(canonicalJson(valid)));
      assert.deepEqual(observed, valid);
      assert.equal(projectedFailure(observed).nativeErrorCategory, category);
      for (const [name, diagnostic] of [
        ["length minus one", indexDiagnostic(length - 1)],
        ["length plus one", indexDiagnostic(length + 1)],
        ["nonempty stderr", indexDiagnostic(length, 1)],
      ]) {
        await known.test(`rejects ${name}`, async () => {
          const bytes = Buffer.from(canonicalJson({ ...valid, childDiagnostic: diagnostic }));
          await assert.rejects(readMarkerBytes(bytes), { code: "task005_git_materials_cleanup_failed" });
        });
      }
    });
  }
});

test("unknown category markers enforce the aggregate child output cap", async (t) => {
  const accepted = [
    ["zero bytes", 0, 0],
    ["257 stdout bytes", 257, 0],
    ["nonempty stderr", 0, 1],
    ["exact aggregate cap", limits.childOutputBytes - 1, 1],
  ];
  for (const [name, stdoutBytes, stderrBytes] of accepted) {
    await t.test(name, async () => {
      const record = { code: "task005_git_materials_child_failed",
        childDiagnostic: indexDiagnostic(stdoutBytes, stderrBytes), nativeErrorCategory: INDEX_VERIFY_UNKNOWN };
      const observed = await readMarkerBytes(Buffer.from(canonicalJson(record)));
      assert.equal(projectedFailure(observed).nativeErrorCategory, INDEX_VERIFY_UNKNOWN);
    });
  }
  await t.test("aggregate cap plus one", async () => {
    const record = { code: "task005_git_materials_child_failed",
      childDiagnostic: indexDiagnostic(limits.childOutputBytes, 1), nativeErrorCategory: INDEX_VERIFY_UNKNOWN };
    await assert.rejects(readMarkerBytes(Buffer.from(canonicalJson(record))),
      { code: "task005_git_materials_cleanup_failed" });
  });
});

test("category-bearing markers reject every unbound or noncanonical shape", async (t) => {
  const length = indexVerifyLine("Permission denied").length;
  const valid = { code: "task005_git_materials_child_failed",
    childDiagnostic: indexDiagnostic(length), nativeErrorCategory: "EACCES" };
  const invalid = [
    ["missing diagnostic", { code: valid.code, nativeErrorCategory: "EACCES" }],
    ["generic code", { ...valid, code: "task005_git_materials_download_failed" }],
    ["wrong operation", { ...valid, childDiagnostic: { ...valid.childDiagnostic, operation: "MATERIAL_APK_VERIFY" } }],
    ["wrong reason", { ...valid, childDiagnostic: { ...valid.childDiagnostic,
      reason: "SIGNAL", status: null, signal: "SIGKILL" } }],
    ["wrong status", { ...valid, childDiagnostic: { ...valid.childDiagnostic, status: 2 } }],
    ["non-null signal", { ...valid, childDiagnostic: { ...valid.childDiagnostic, signal: "SIGKILL" } }],
    ["unknown category", { ...valid, nativeErrorCategory: "APKE_PRIVATE" }],
    ["case-changed category", { ...valid, nativeErrorCategory: "eacces" }],
    ["extra field", { ...valid, private: "PRIVATE" }],
  ];
  for (const [name, record] of invalid) {
    await t.test(name, async () => {
      await assert.rejects(readMarkerBytes(Buffer.from(canonicalJson(record))),
        { code: "task005_git_materials_cleanup_failed" });
    });
  }
  await t.test("noncanonical key order", async () => {
    const bytes = Buffer.from(`${JSON.stringify({ nativeErrorCategory: "EACCES", code: valid.code,
      childDiagnostic: valid.childDiagnostic })}\n`);
    await assert.rejects(readMarkerBytes(bytes), { code: "task005_git_materials_cleanup_failed" });
  });
});

test("failure marker writer preserves a trusted category and ignores symbol metadata", {
  skip: process.platform !== "linux",
}, async () => {
  const created = await mkdtemp(path.join(os.tmpdir(), "task005-git-marker-v10-"));
  const privateRoot = await realpath(created);
  try {
    const trusted = indexVerifierFailure(indexVerifyLine("Permission denied"));
    trusted[Symbol("PRIVATE_CATEGORY")] = "PRIVATE";
    await writeFailureMarker({ privateRoot }, trusted);
    const bytes = await readFile(path.join(privateRoot, "failure-code"));
    assert.doesNotMatch(bytes.toString("utf8"), /PRIVATE/u);
    const observed = await readFailureMarker({ privateRoot });
    assert.equal(projectedFailure(observed).nativeErrorCategory, "EACCES");
  } finally {
    await rm(privateRoot, { recursive: true, force: true });
  }
});

test("immediate cleanup publishes the exact verifier category without raw streams", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 2, failResult: {
    status: 1, stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0),
  } });
  let indexPresentBeforeCleanup = false;
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      command: observed.command,
      cleanup: async (ownedContext) => {
        indexPresentBeforeCleanup = (await lstat(path.join(ownedContext.privateRoot, "repo", "APKINDEX.tar.gz"))).isFile();
        await cleanupPrivate(ownedContext);
      },
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
    }));
    assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
    assert.equal(indexPresentBeforeCleanup, true);
    assert.equal(observed.records.length, 3);
    assert.equal(observed.fetchCalls.length, 1);
    assert.match(observed.fetchCalls[0], /APKINDEX\.tar\.gz$/u);
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.nativeErrorCategory, "EACCES");
    assert.deepEqual(evidence.receipt.childDiagnostic, indexDiagnostic(51));
    assert.deepEqual(evidence.manifest, {
      actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", authority: "DIAGNOSTIC_ONLY", files: [],
      installationAuthorization: false, state: "EMPTY_BLOCKED",
    });
    assert.doesNotMatch(JSON.stringify(evidence), /Permission denied|PRIVATE/u);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("deferred cleanup revalidates marker provenance and publishes the same verifier category", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 2, failResult: {
    status: 1, stdout: indexVerifyLine("Permission denied"), stderr: Buffer.alloc(0),
  } });
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(), command: observed.command,
      cleanup: async () => { throw Object.assign(new Error("PRIVATE_CLEANUP"),
        { code: "task005_git_materials_cleanup_failed" }); },
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
    }));
    assert.equal(projectedFailure(error).nativeErrorCategory, "EACCES");
    const marker = await readFailureMarker(context);
    assert.equal(marker.nativeErrorCategory, "EACCES");
    assert.equal(projectedFailure(marker).nativeErrorCategory, "EACCES");
    const forged = globalThis.structuredClone(marker);
    assert.equal(Object.hasOwn(projectedFailure(forged), "nativeErrorCategory"), false);

    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.nativeErrorCategory, "EACCES");
    assert.deepEqual(evidence.receipt.childDiagnostic, indexDiagnostic(51));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("cleanup failure never replaces a trusted verifier error or its category", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const first = indexVerifierFailure(indexVerifyLine("Permission denied"));
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => { throw first; },
      cleanup: async () => { throw Object.assign(new Error("PRIVATE_CLEANUP"),
        { code: "task005_git_materials_cleanup_failed" }); },
    }));
    assert.equal(observed, first);
    assert.equal(projectedFailure(observed).nativeErrorCategory, "EACCES");
    assert.equal(projectedFailure(await readFailureMarker(context)).nativeErrorCategory, "EACCES");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("an invalid category marker still runs cleanup and publishes no evidence", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const forged = {
      code: "task005_git_materials_child_failed",
      childDiagnostic: { ...indexDiagnostic(51), operation: "MATERIAL_APK_VERIFY" },
      nativeErrorCategory: "EACCES",
    };
    await writeFile(path.join(context.privateRoot, "failure-code"), canonicalJson(forged), { mode: 0o600 });
    let cleanupCalls = 0;
    await assert.rejects(run(["cleanup"], fixture.env, {
      platform: "linux",
      cleanup: async () => { cleanupCalls += 1; await cleanupPrivate(context); },
      log: () => {},
    }), { code: "task005_git_materials_cleanup_failed" });
    assert.equal(cleanupCalls, 1);
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("material owner identity is captured once and frozen across all eleven commands", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  const owner = ownerIdentityFixture();
  let mutated = false;
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const resources = freshCarrierResources();
    const command = (...args) => {
      if (!mutated) {
        mutated = true;
        owner.ownerStat.uid = 99_001;
        owner.ownerStat.gid = 99_002;
      }
      return observed.command(...args);
    };
    await rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources,
      identityIo: owner.identityIo,
    });
    assert.deepEqual(owner.calls, { getuid: 1, getgid: 1, lstat: 1, targets: [context.privateRoot] });
    assert.equal(observed.records.length, 11);
    assert.deepEqual(observed.records.map(recordedOwnerPair), Array(11).fill(owner.pair));
    assert.deepEqual(Object.keys(resources).sort(), ["carrierMayBeOwned", "containerNames", "nextOrdinal"]);
    assert.doesNotMatch(JSON.stringify(resources), new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}`, "u"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("material owner binding accepts zero mixed-zero and upper-bound identities", async (t) => {
  const cases = [
    ["zero owner", 0, 0],
    ["zero UID", 0, 37],
    ["zero GID", 41, 0],
    ["common upper bound", 2_147_483_647, 2_147_483_647],
  ];
  for (const [name, uid, gid] of cases) {
    await t.test(name, async () => {
      await withBoundMaterialOwner(({ observed, owner }) => {
        assert.deepEqual(observed.records.map(recordedOwnerPair), Array(11).fill(`${uid}:${gid}`));
        assert.deepEqual(owner.calls.getuid, 1);
        assert.deepEqual(owner.calls.getgid, 1);
        assert.deepEqual(owner.calls.lstat, 1);
      }, { uid, gid });
    });
  }
});

test("identity I/O rejects missing throwing accessor-backed and proxied capabilities before effects", async (t) => {
  let accessorCalls = 0;
  const accessorIo = { getgid: () => FIXTURE_GID, lstat: async () => (
    { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) };
  Object.defineProperty(accessorIo, "getuid", { get() { accessorCalls += 1; return () => FIXTURE_UID; } });
  const getgidAccessorIo = { getuid: () => FIXTURE_UID, lstat: async () => (
    { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) };
  Object.defineProperty(getgidAccessorIo, "getgid", { get() { accessorCalls += 1; return () => FIXTURE_GID; } });
  const lstatAccessorIo = { getuid: () => FIXTURE_UID, getgid: () => FIXTURE_GID };
  Object.defineProperty(lstatAccessorIo, "lstat", { get() { accessorCalls += 1; return async () => (
    { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }); } });
  const cases = [
    ["missing getuid", { getgid: () => FIXTURE_GID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["missing getgid", { getuid: () => FIXTURE_UID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["missing lstat", { getuid: () => FIXTURE_UID, getgid: () => FIXTURE_GID }],
    ["non-function getuid", { getuid: FIXTURE_UID, getgid: () => FIXTURE_GID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["non-function getgid", { getuid: () => FIXTURE_UID, getgid: FIXTURE_GID, lstat: async () => (
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }) }],
    ["accessor getuid", accessorIo],
    ["accessor getgid", getgidAccessorIo],
    ["accessor lstat", lstatAccessorIo],
    ["throwing getuid", ownerIdentityFixture({ getuid: () => { throw new Error("PRIVATE_UID"); } }).identityIo],
    ["throwing getgid", ownerIdentityFixture({ getgid: () => { throw new Error("PRIVATE_GID"); } }).identityIo],
    ["non-function lstat", { getuid: () => FIXTURE_UID, getgid: () => FIXTURE_GID, lstat: 1 }],
    ["throwing lstat", ownerIdentityFixture({ lstat: async () => { throw new Error("PRIVATE_STAT"); } }).identityIo],
    ["proxied identity object", new Proxy(ownerIdentityFixture().identityIo, {})],
    ["proxied getuid function", ownerIdentityFixture({ getuid: new Proxy(() => FIXTURE_UID, {}) }).identityIo],
  ];
  for (const [name, identityIo] of cases) {
    await t.test(name, () => assertIdentityRefusal(identityIo));
  }
  assert.equal(accessorCalls, 0);
});

test("owner IDs reject every noncanonical numeric shape and cap overflow before effects", async (t) => {
  const values = [
    ["string", "20001"], ["boolean", true], ["NaN", Number.NaN], ["positive infinity", Number.POSITIVE_INFINITY],
    ["fraction", 1.5], ["negative", -1], ["cap plus one", 2_147_483_648],
  ];
  for (const [valueName, value] of values) {
    const cases = [
      [`process UID ${valueName}`, ownerIdentityFixture({ uid: value, statUid: value }).identityIo],
      [`process GID ${valueName}`, ownerIdentityFixture({ gid: value, statGid: value }).identityIo],
      [`owner UID ${valueName}`, ownerIdentityFixture({ statUid: value }).identityIo],
      [`owner GID ${valueName}`, ownerIdentityFixture({ statGid: value }).identityIo],
    ];
    for (const [name, identityIo] of cases) {
      await t.test(name, () => assertIdentityRefusal(identityIo));
    }
  }
});

test("private-root stat rejects owner mismatches unsafe descriptors and invalid mode bits", async (t) => {
  let uidAccessorCalls = 0;
  const accessorStat = { gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE };
  Object.defineProperty(accessorStat, "uid", { get() { uidAccessorCalls += 1; return FIXTURE_UID; } });
  const gidAccessorStat = { uid: FIXTURE_UID, mode: PRIVATE_DIRECTORY_MODE };
  Object.defineProperty(gidAccessorStat, "gid", { get() { uidAccessorCalls += 1; return FIXTURE_GID; } });
  const modeAccessorStat = { uid: FIXTURE_UID, gid: FIXTURE_GID };
  Object.defineProperty(modeAccessorStat, "mode", {
    get() { uidAccessorCalls += 1; return PRIVATE_DIRECTORY_MODE; },
  });
  const cases = [
    ["missing UID", ownerIdentityFixture({ stat: { gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE } }).identityIo],
    ["missing GID", ownerIdentityFixture({ stat: { uid: FIXTURE_UID, mode: PRIVATE_DIRECTORY_MODE } }).identityIo],
    ["missing mode", ownerIdentityFixture({ stat: { uid: FIXTURE_UID, gid: FIXTURE_GID } }).identityIo],
    ["UID accessor", ownerIdentityFixture({ stat: accessorStat }).identityIo],
    ["GID accessor", ownerIdentityFixture({ stat: gidAccessorStat }).identityIo],
    ["mode accessor", ownerIdentityFixture({ stat: modeAccessorStat }).identityIo],
    ["proxied stat", ownerIdentityFixture({ stat: new Proxy(
      { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE }, {}) }).identityIo],
    ["UID mismatch", ownerIdentityFixture({ statUid: FIXTURE_UID + 1 }).identityIo],
    ["GID mismatch", ownerIdentityFixture({ statGid: FIXTURE_GID + 1 }).identityIo],
    ["regular file", ownerIdentityFixture({ mode: 0o100700 }).identityIo],
    ["symbolic link", ownerIdentityFixture({ mode: 0o120700 }).identityIo],
    ["missing directory type", ownerIdentityFixture({ mode: 0o700 }).identityIo],
    ["group-readable directory", ownerIdentityFixture({ mode: 0o040750 }).identityIo],
    ["world-readable directory", ownerIdentityFixture({ mode: 0o040705 }).identityIo],
    ["nonnumeric mode", ownerIdentityFixture({ mode: "040700" }).identityIo],
    ["mode cap overflow", ownerIdentityFixture({ mode: 0x1_0000_0000 }).identityIo],
  ];
  for (const [name, identityIo] of cases) {
    await t.test(name, () => assertIdentityRefusal(identityIo));
  }
  assert.equal(uidAccessorCalls, 0);
});

test("poisoned environment identity cannot alter the captured owner pair", async (t) => {
  const original = new Map(["UID", "GID", "USER", "LOGNAME"].map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.UID = "91001";
  process.env.GID = "91002";
  process.env.USER = "PRIVATE_USER_SENTINEL";
  process.env.LOGNAME = "PRIVATE_LOGNAME_SENTINEL";
  await withBoundMaterialOwner(({ observed, owner }) => {
    const serialized = JSON.stringify(observed.records);
    assert.deepEqual(observed.records.map(recordedOwnerPair), Array(11).fill(owner.pair));
    assert.doesNotMatch(serialized, /91001|91002|PRIVATE_USER_SENTINEL|PRIVATE_LOGNAME_SENTINEL/u);
  });
});

test("private-root directory validation uses numeric mode bits without invoking stat methods", async () => {
  let methodAccesses = 0;
  const stat = { uid: FIXTURE_UID, gid: FIXTURE_GID, mode: PRIVATE_DIRECTORY_MODE };
  Object.defineProperties(stat, {
    isDirectory: { get() { methodAccesses += 1; throw new Error("PRIVATE_METHOD"); } },
    isSymbolicLink: { get() { methodAccesses += 1; throw new Error("PRIVATE_METHOD"); } },
  });
  const owner = ownerIdentityFixture({ stat });
  await withBoundMaterialOwner(({ observed }) => {
    assert.equal(observed.records.length, 11);
  }, { uid: FIXTURE_UID, gid: FIXTURE_GID, identityIo: owner.identityIo });
  assert.equal(methodAccesses, 0);
});

test("an exact private material mount dispatches with the frozen owner and immutable mount", async () => {
  await withBoundMaterialOwner(({ context, resources, owner }) => {
    const mount = { source: context.privateRoot, target: "/materials" };
    let record;
    const result = runCarrier(context, resources, (executable, args, options) => {
      record = { executable, args: [...args], options };
      mount.source = "C:/PRIVATE_MUTATION";
      mount.target = "/PRIVATE_MUTATION";
      mount.readonly = false;
      return { status: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) };
    }, "MATERIAL_QUERY", "/sbin/apk", ["query"], [mount]);
    assert.equal(result.stdout.toString("utf8"), "ok");
    assert.equal(record.executable, "docker");
    assert.equal(recordedOwnerPair(record), owner.pair);
    assert.ok(record.args.includes(`type=bind,src=${context.privateRoot},dst=/materials,readonly`));
    assert.doesNotMatch(record.args.join(" "), /PRIVATE_MUTATION/u);
  });
});

test("private owner binding cannot be forged on public resources or context properties", () => {
  const context = carrierContext();
  const resources = { ...freshCarrierResources(), materialUser: `${FIXTURE_UID}:${FIXTURE_GID}`,
    ownerBinding: { privateRoot: context.privateRoot, uid: FIXTURE_UID, gid: FIXTURE_GID } };
  const before = globalThis.structuredClone(resources);
  let calls = 0;
  assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "MATERIAL_QUERY", "/sbin/apk",
    ["query"], [{ source: context.privateRoot, target: "/materials" }]),
  { code: "task005_git_materials_private_root_invalid" });
  assert.equal(calls, 0);
  assert.deepEqual(resources, before);
});

test("proxied resources cannot acquire a material owner binding", () => {
  const context = carrierContext();
  const resources = new Proxy(freshCarrierResources(), {});
  let calls = 0;
  assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "MATERIAL_QUERY", "/sbin/apk",
    ["query"], [{ source: context.privateRoot, target: "/materials" }]),
  { code: "task005_git_materials_private_root_invalid" });
  assert.equal(calls, 0);
});

test("a material owner binding cannot be reused for another private root", async () => {
  await withBoundMaterialOwner(({ context, resources }) => {
    const foreignContext = { ...context, privateRoot: `${context.privateRoot}-foreign` };
    const before = globalThis.structuredClone(resources);
    let calls = 0;
    assert.throws(() => runCarrier(foreignContext, resources, () => { calls += 1; }, "MATERIAL_QUERY",
      "/sbin/apk", ["query"], [{ source: foreignContext.privateRoot, target: "/materials" }]),
    { code: "task005_git_materials_private_root_invalid" });
    assert.equal(calls, 0);
    assert.deepEqual(resources, before);
  });
});

test("an accessor-backed context root cannot reuse a private owner binding", async () => {
  await withBoundMaterialOwner(({ context, resources }) => {
    let accessorCalls = 0;
    const hostileContext = { ...context };
    Object.defineProperty(hostileContext, "privateRoot", {
      get() { accessorCalls += 1; return context.privateRoot; }, enumerable: true,
    });
    const before = globalThis.structuredClone(resources);
    let calls = 0;
    assert.throws(() => runCarrier(hostileContext, resources, () => { calls += 1; }, "MATERIAL_QUERY",
      "/sbin/apk", ["query"], [{ source: context.privateRoot, target: "/materials" }]),
    { code: "task005_git_materials_private_root_invalid" });
    assert.equal(accessorCalls, 0);
    assert.equal(calls, 0);
    assert.deepEqual(resources, before);
  });
});

test("non-material operations cannot consume a private material mount binding", async () => {
  await withBoundMaterialOwner(({ context, resources }) => {
    const before = globalThis.structuredClone(resources);
    let calls = 0;
    assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "PROBE_APK_VERSION",
      "/sbin/apk", ["--version"], [{ source: context.privateRoot, target: "/materials" }]),
    { code: "task005_git_materials_private_root_invalid" });
    assert.equal(calls, 0);
    assert.deepEqual(resources, before);
  });
});

test("bound resources do not leak the owner pair to an unmounted probe", async () => {
  await withBoundMaterialOwner(({ context, resources, owner }) => {
    let record;
    runCarrier(context, resources, (executable, args, options) => {
      record = { executable, args: [...args], options };
      return { status: 0, stdout: Buffer.from("apk-tools 3.0.0, compiled for x86_64."), stderr: Buffer.alloc(0) };
    }, "PROBE_APK_VERSION", "/sbin/apk", ["--version"]);
    assert.equal(record.args.includes("--user"), false);
    assert.equal(record.args.includes(owner.pair), false);
  });
});

test("material mounts reject foreign extra writable accessor-backed and proxied shapes", async (t) => {
  await withBoundMaterialOwner(async ({ context, resources }) => {
    const accessorMount = { source: context.privateRoot, target: "/materials" };
    let readonlyAccessorCalls = 0;
    Object.defineProperty(accessorMount, "readonly", {
      get() { readonlyAccessorCalls += 1; return true; }, enumerable: true,
    });
    const symbolMount = { source: context.privateRoot, target: "/materials" };
    symbolMount[Symbol("PRIVATE")] = true;
    const cases = [
      ["foreign source", [{ source: `${context.privateRoot}-foreign`, target: "/materials" }]],
      ["foreign target", [{ source: context.privateRoot, target: "/private-materials" }]],
      ["explicit writable", [{ source: context.privateRoot, target: "/materials", readonly: false }]],
      ["extra mount", [{ source: context.privateRoot, target: "/materials" },
        { source: context.privateRoot, target: "/other" }]],
      ["extra property", [{ source: context.privateRoot, target: "/materials", privateUser: "forged" }]],
      ["symbol property", [symbolMount]],
      ["readonly accessor", [accessorMount]],
      ["proxied mount", [new Proxy({ source: context.privateRoot, target: "/materials" }, {})]],
      ["proxied mount array", new Proxy([{ source: context.privateRoot, target: "/materials" }], {})],
    ];
    for (const [name, mounts] of cases) {
      await t.test(name, () => {
        const before = globalThis.structuredClone(resources);
        let calls = 0;
        assert.throws(() => runCarrier(context, resources, () => { calls += 1; }, "MATERIAL_QUERY",
          "/sbin/apk", ["query"], mounts), { code: "task005_git_materials_private_root_invalid" });
        assert.equal(calls, 0);
        assert.deepEqual(resources, before);
      });
    }
    assert.equal(readonlyAccessorCalls, 0);
  });
});

test("executeActor forwards explicit identity I/O and publishes no owner identity on immediate refusal", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const owner = ownerIdentityFixture({ statUid: FIXTURE_UID + 1 });
  let childCalls = 0;
  let fetchCalls = 0;
  try {
    const context = await requireContext(fixture.env, "linux");
    const error = await captureRejected(() => rawExecuteActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      identityIo: owner.identityIo,
      command: () => { childCalls += 1; assert.fail("owner refusal must precede material child execution"); },
      fetchImpl: () => { fetchCalls += 1; assert.fail("owner refusal must precede material fetch"); },
      cleanup: cleanupPrivate,
    }));
    assert.equal(error.code, "task005_git_materials_private_root_invalid");
    assert.deepEqual(owner.calls, { getuid: 1, getgid: 1, lstat: 1, targets: [context.privateRoot] });
    assert.equal(childCalls, 0);
    assert.equal(fetchCalls, 0);
    const evidence = await readPublicEvidence(context);
    const serialized = JSON.stringify(evidence);
    assert.equal(evidence.receipt.code, "task005_git_materials_private_root_invalid");
    assert.equal(Object.hasOwn(evidence.receipt, "childDiagnostic"), false);
    assert.doesNotMatch(serialized, new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}|uid|gid|user`, "iu"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("deferred owner refusal marker and cleanup receipt contain no owner identity", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const owner = ownerIdentityFixture({ statGid: FIXTURE_GID + 1 });
  try {
    const context = await requireContext(fixture.env, "linux");
    await assert.rejects(rawExecuteActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID }),
      identityIo: owner.identityIo,
      command: () => assert.fail("owner refusal must precede material child execution"),
      fetchImpl: () => assert.fail("owner refusal must precede material fetch"),
      cleanup: async () => { throw Object.assign(new Error("PRIVATE_CLEANUP"),
        { code: "task005_git_materials_cleanup_failed" }); },
    }), { code: "task005_git_materials_private_root_invalid" });
    const marker = await readFile(path.join(context.privateRoot, "failure-code"), "utf8");
    assert.doesNotMatch(marker, new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}|uid|gid|user`, "iu"));
    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.code, "task005_git_materials_private_root_invalid");
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(`${FIXTURE_UID}|${FIXTURE_GID}|uid|gid|user`, "iu"));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("default Linux identity binds material commands to the actual private-root owner", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const info = await lstat(context.privateRoot);
    assert.equal(info.uid, process.getuid());
    assert.equal(info.gid, process.getgid());
    assert.equal(info.mode & 0o170000, 0o040000);
    assert.equal(info.mode & 0o777, 0o700);
    await rawMaterializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    });
    assert.deepEqual(observed.records.map(recordedOwnerPair),
      Array(11).fill(`${process.getuid()}:${process.getgid()}`));
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

// V11_ADDITIONS_TESTS_BEGIN
test("V11 material gate delivery classes form the exact closed 65/50/15 partition", () => {
  assert.equal(V11_PUBLIC_MATERIAL_GATES.length, 65);
  assert.equal(V11_BLOCKED_CAPABLE_GATES.length, 50);
  assert.equal(V11_RAW_LOG_ONLY_GATES.length, 15);
  assert.equal(new Set(V11_PUBLIC_MATERIAL_GATES).size, 65);
  assert.deepEqual(new Set(V11_BLOCKED_CAPABLE_GATES).intersection(
    new Set(V11_RAW_LOG_ONLY_GATES)), new Set());
  assert.deepEqual(new Set(V11_PUBLIC_MATERIAL_GATES),
    new Set([...V11_BLOCKED_CAPABLE_GATES, ...V11_RAW_LOG_ONLY_GATES]));
  assert.deepEqual(V11_RAW_LOG_ONLY_GATES, [
    "EVIDENCE_ROOT_SCHEMA", "EVIDENCE_NOT_RUN_SCHEMA", "EVIDENCE_RECEIPT_SCHEMA",
    "EVIDENCE_BOUNDARIES", "EVIDENCE_EXECUTION", "EVIDENCE_SECURITY", "EVIDENCE_INDEX",
    "EVIDENCE_CARRIER", "EVIDENCE_SECDB", "EVIDENCE_MANIFEST_SCHEMA",
    "EVIDENCE_PACKAGE_CARDINALITY", "EVIDENCE_PACKAGE_UNIQUENESS", "EVIDENCE_PACKAGE_VERDICTS",
    "EVIDENCE_PACKAGE_BINDING", "EVIDENCE_PRIVACY",
  ]);
});

test("V11 material gate literals are fixed identity-free uppercase ASCII", () => {
  for (const gate of V11_PUBLIC_MATERIAL_GATES) {
    assert.match(gate, /^[A-Z][A-Z0-9_]*$/u);
    assert.ok(gate.length <= 40);
    assert.doesNotMatch(gate, /(?:2\.54|usr\/|https?:|[0-9a-f]{16})/u);
  }
});

test("V11 ignores every foreign materialGate representation without invoking accessors", () => {
  let accessorCalls = 0;
  const forged = Object.assign(new Error("private sentinel"), {
    code: "task005_git_materials_material_invalid",
  });
  Object.defineProperty(forged, "materialGate", {
    enumerable: true,
    get() { accessorCalls += 1; throw new Error("accessor sentinel"); },
  });
  assert.equal(projectedFailure(forged).code, "task005_git_materials_material_invalid");
  assert.equal(Object.hasOwn(projectedFailure(forged), "materialGate"), false);
  assert.equal(accessorCalls, 0);
  for (const candidate of [
    { code: forged.code, materialGate: "QUERY_UTF8" },
    Object.assign(Object.create({ materialGate: "QUERY_UTF8" }), { code: forged.code }),
    { code: forged.code, [Symbol("materialGate")]: "QUERY_UTF8" },
    { code: forged.code, materialGate: "query_utf8" },
    { code: forged.code, materialGate: " QUERY_UTF8" },
    { code: forged.code, materialGate: 7 },
  ]) {
    const projected = projectedFailure(candidate);
    assert.equal(projected.code, "task005_git_materials_material_invalid");
    assert.equal(Object.hasOwn(projected, "materialGate"), false);
  }
});

test("V11 non-material primary families never project a forged material gate", () => {
  for (const code of [
    "task005_git_materials_solver_invalid", "task005_git_materials_child_failed",
    "task005_git_materials_child_timeout", "task005_git_materials_material_limit_exceeded",
    "task005_git_materials_download_failed", "task005_git_materials_secdb_invalid",
    "task005_git_materials_url_invalid", "task005_git_materials_cleanup_failed",
    "task005_git_materials_failed",
  ]) {
    const projected = projectedFailure({ code, materialGate: "QUERY_UTF8" });
    assert.equal(projected.code, code);
    assert.equal(Object.hasOwn(projected, "materialGate"), false);
  }
});

test("V11 every trusted raw-log-only validator error refuses marker writing before file creation", async (t) => {
  const collected = await collectV11Evidence();
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    for (const [gate, trusted] of trustedRawLogOnlyErrors(collected.evidence, context)) {
      await t.test(gate, async () => {
        const privateRoot = await mkdtemp(path.join(os.tmpdir(), "task005-v11-raw-writer-"));
        try {
          await assert.rejects(writeFailureMarker({ privateRoot }, trusted),
            { code: "task005_git_materials_cleanup_failed" });
          assert.deepEqual(await readdir(privateRoot), []);
          await assert.rejects(access(path.join(privateRoot, "failure-code")), { code: "ENOENT" });
        } finally {
          await rm(privateRoot, { recursive: true, force: true });
        }
      });
    }
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 every deliberately misrouted raw-log-only error is refused after cleanup without artifact", {
  skip: process.platform !== "linux",
}, async (t) => {
  const collected = await collectV11Evidence();
  for (const gate of V11_RAW_LOG_ONLY_GATES) await t.test(gate, async () => {
    const fixture = await fixtureContext();
    try {
      const context = await requireContext(fixture.env, "linux");
      const trusted = new Map(trustedRawLogOnlyErrors(collected.evidence, context)).get(gate);
      let cleanupCalls = 0;
      const error = await captureRejected(() => executeActor(context, {
        statfs: async () => enoughCapacity(),
        probe: async () => ({
          version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID,
        }),
        materialize: async () => { throw trusted; },
        cleanup: async (ownedContext) => {
          cleanupCalls += 1;
          await cleanupPrivate(ownedContext);
        },
      }));
      assert.notEqual(error, trusted);
      assert.equal(error.code, "task005_git_materials_cleanup_failed");
      assert.equal(cleanupCalls, 1);
      const projected = projectedFailure(trusted);
      assert.equal(projected.code, "task005_git_materials_material_invalid");
      assert.equal(projected.materialGate, gate);
      await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
      await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
    } finally {
      await rm(fixture.runnerTemp, { recursive: true, force: true });
    }
  });
});

test("V11 every canonical raw-log-only marker is refused by deferred cleanup without artifact", {
  skip: process.platform !== "linux",
}, async (t) => {
  for (const materialGate of V11_RAW_LOG_ONLY_GATES) await t.test(materialGate, async () => {
    const fixture = await fixtureContext();
    try {
      const context = await requireContext(fixture.env, "linux");
      await mkdir(context.privateRoot, { mode: 0o700 });
      await writeFile(path.join(context.privateRoot, "failure-code"), canonicalJson({
        code: "task005_git_materials_material_invalid", materialGate,
      }), { mode: 0o600 });
      let cleanupCalls = 0;
      const logs = [];
      await assert.rejects(run(["cleanup"], fixture.env, {
        platform: "linux",
        cleanup: async (ownedContext) => {
          cleanupCalls += 1;
          await cleanupPrivate(ownedContext);
        },
        log: (line) => logs.push(line),
      }), { code: "task005_git_materials_cleanup_failed" });
      assert.equal(cleanupCalls, 1);
      assert.deepEqual(logs, []);
      await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
      await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
    } finally {
      await rm(fixture.runnerTemp, { recursive: true, force: true });
    }
  });
});

test("V11 copied and foreign material gates never inherit trusted provenance", async (t) => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const trusted = captureThrown(() => validateEvidence(null, context));
    const visible = projectedFailure(trusted);
    const representations = [
      ["plain clone", Object.assign({}, visible)],
      ["spread", { ...visible }],
      ["structured clone", globalThis.structuredClone(visible)],
      ["JSON round trip", JSON.parse(JSON.stringify(visible))],
      ["separate error", Object.assign(new Error("PRIVATE_SEPARATE"), visible)],
      ["prototype gate", Object.assign(Object.create({ materialGate: visible.materialGate }), {
        code: visible.code,
      })],
      ["symbol gate", { code: visible.code, [Symbol("materialGate")]: visible.materialGate }],
    ];
    const nonenumerable = { code: visible.code };
    Object.defineProperty(nonenumerable, "materialGate", { value: visible.materialGate });
    representations.push(["nonenumerable gate", nonenumerable]);
    let getterCalls = 0;
    const accessor = { code: visible.code };
    Object.defineProperty(accessor, "materialGate", {
      enumerable: true,
      get() { getterCalls += 1; throw new Error("PRIVATE_GETTER"); },
    });
    representations.push(["getter gate", accessor]);

    for (const [name, candidate] of representations) await t.test(name, () => {
      const projected = projectedFailure(candidate);
      assert.equal(projected.code, "task005_git_materials_material_invalid");
      assert.equal(Object.hasOwn(projected, "materialGate"), false);
      assert.doesNotMatch(JSON.stringify(projected), /PRIVATE/u);
    });
    assert.equal(getterCalls, 0);

    await t.test("foreign own gate writes only the legacy code marker", async () => {
      const privateRoot = await mkdtemp(path.join(os.tmpdir(), "task005-v11-foreign-gate-"));
      try {
        await writeFailureMarker({ privateRoot }, { ...visible });
        assert.equal(await readFile(path.join(privateRoot, "failure-code"), "utf8"),
          canonicalJson({ code: visible.code }));
        if (process.platform === "linux") {
          assert.deepEqual(await readFailureMarker({ privateRoot }), { code: visible.code });
        }
      } finally {
        await rm(privateRoot, { recursive: true, force: true });
      }
    });

    await t.test("trusted error loses its gate when its primary code is mutated", () => {
      trusted.code = "task005_git_materials_solver_invalid";
      assert.deepEqual(projectedFailure(trusted), {
        actor: "TASK005_GIT_MATERIALS_V1",
        authority: "DIAGNOSTIC_ONLY",
        code: "task005_git_materials_solver_invalid",
        installationAuthorization: false,
        state: "FAILED",
      });
    });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 proxy traps cannot forge or leak a material gate", async (t) => {
  const visible = { code: "task005_git_materials_material_invalid", materialGate: "EVIDENCE_ROOT_SCHEMA" };
  await t.test("unneeded traps remain untouched", () => {
    const calls = { get: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, getPrototypeOf: 0 };
    const proxy = new Proxy(visible, {
      get() { calls.get += 1; throw new Error("PRIVATE_GET"); },
      getOwnPropertyDescriptor(target, key) {
        calls.getOwnPropertyDescriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      ownKeys() { calls.ownKeys += 1; throw new Error("PRIVATE_KEYS"); },
      getPrototypeOf() { calls.getPrototypeOf += 1; throw new Error("PRIVATE_PROTO"); },
    });
    const projected = projectedFailure(proxy);
    assert.deepEqual(projected, {
      actor: "TASK005_GIT_MATERIALS_V1",
      authority: "DIAGNOSTIC_ONLY",
      code: "task005_git_materials_material_invalid",
      installationAuthorization: false,
      state: "FAILED",
    });
    assert.deepEqual(calls, { get: 0, getOwnPropertyDescriptor: 2, ownKeys: 0, getPrototypeOf: 0 });
  });
  await t.test("hostile descriptor traps degrade to a generic safe failure", () => {
    let descriptorCalls = 0;
    const proxy = new Proxy(visible, {
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        throw new Error("PRIVATE_DESCRIPTOR");
      },
    });
    const serialized = publicFailure(proxy);
    assert.deepEqual(JSON.parse(serialized), {
      actor: "TASK005_GIT_MATERIALS_V1",
      authority: "DIAGNOSTIC_ONLY",
      code: "task005_git_materials_failed",
      installationAuthorization: false,
      state: "FAILED",
    });
    assert.equal(descriptorCalls, 2);
    assert.doesNotMatch(serialized, /PRIVATE/u);
  });
});

test("V11 run API logs every real post-cleanup evidence failure as FAILED without artifact", {
  skip: process.platform !== "linux",
}, async (t) => {
  const collected = await collectV11Evidence();
  for (const [gate, makeInvalidFromCollected] of rawLogOnlyEvidenceCases(
    collected.evidence, { runnerTemp: collected.context.runnerTemp })) {
    await t.test(gate, async () => {
      const fixture = await fixtureContext();
      try {
        const context = await requireContext(fixture.env, "linux");
        const currentCase = new Map(rawLogOnlyEvidenceCases(collected.evidence, context)).get(gate);
        const invalid = gate === "EVIDENCE_NOT_RUN_SCHEMA" ? currentCase() : makeInvalidFromCollected();
        let cleanupCalls = 0;
        const observed = await runExecuteWithSafeFailureLog(fixture.env, {
          platform: "linux",
          statfs: async () => enoughCapacity(),
          probe: async () => ({
            version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID,
          }),
          materialize: async () => invalid,
          cleanup: async (ownedContext) => {
            cleanupCalls += 1;
            await cleanupPrivate(ownedContext);
          },
        });
        assert.equal(cleanupCalls, 1);
        const projected = projectedFailure(observed.error);
        assert.equal(projected.code, "task005_git_materials_material_invalid");
        assert.equal(projected.materialGate, gate);
        assert.deepEqual(observed.lines, [publicFailure(observed.error).trimEnd()]);
        assert.deepEqual(JSON.parse(observed.lines[0]), {
          actor: "TASK005_GIT_MATERIALS_V1",
          authority: "DIAGNOSTIC_ONLY",
          code: "task005_git_materials_material_invalid",
          installationAuthorization: false,
          materialGate: gate,
          state: "FAILED",
        });
        assert.doesNotMatch(observed.lines[0], /PRIVATE_SENTINEL|\/materials\/|OTHER|OBSERVED|COMPLETE/u);
        await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
        await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});

test("V11 one-package lowercase manifest preserves the complete uppercase execution", {
  skip: process.platform !== "linux" && "requires POSIX private-root ownership semantics",
}, async () => {
  const uppercase = await collectFullManifestExecution(() => observationFixture());
  const lowercase = await collectFullManifestExecution(() => withLowercaseManifestStdout(observationFixture()));
  assert.equal(uppercase.transcript.length, 10);
  assert.equal(uppercase.manifestTransforms, 0);
  assert.equal(lowercase.manifestTransforms, 1);
  assert.deepEqual(lowercase.transcript, uppercase.transcript);
  assert.deepEqual(lowercase.fetchCalls, uppercase.fetchCalls);
  assert.deepEqual(lowercase.owner, uppercase.owner);
  assert.deepEqual(lowercase.cleanup, uppercase.cleanup);
  assert.deepEqual(lowercase.evidence, uppercase.evidence);
  assert.deepEqual(lowercase.persisted, uppercase.persisted);
  assert.deepEqual(lowercase.canonical, uppercase.canonical);
});

test("V11 ten-package lowercase manifests preserve the complete uppercase execution", {
  skip: process.platform !== "linux" && "requires POSIX private-root ownership semantics",
}, async () => {
  const uppercase = await collectFullManifestExecution(() => tenPackageObservationFixture({ canonical: true }));
  const lowercase = await collectFullManifestExecution(() =>
    withLowercaseManifestStdout(tenPackageObservationFixture({ canonical: true })));
  assert.equal(uppercase.transcript.length, 38);
  assert.equal(uppercase.evidence.manifest.packages.length, 10);
  assert.equal(uppercase.manifestTransforms, 0);
  assert.equal(lowercase.manifestTransforms, 10);
  assert.deepEqual(lowercase.transcript, uppercase.transcript);
  assert.deepEqual(lowercase.fetchCalls, uppercase.fetchCalls);
  assert.deepEqual(lowercase.owner, uppercase.owner);
  assert.deepEqual(lowercase.cleanup, uppercase.cleanup);
  assert.deepEqual(lowercase.evidence, uppercase.evidence);
  assert.deepEqual(lowercase.persisted, uppercase.persisted);
  assert.deepEqual(lowercase.canonical, uppercase.canonical);
});

test("V11 rejects the historical V10 base after accepted-main reconciliation", async () => {
  const fixture = await fixtureContext({ base: HISTORICAL_V10_BASE });
  try {
    await assert.rejects(requireContext(fixture.env, "linux"),
      { code: "task005_git_materials_context_invalid" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 accepts exact lowercase sha1 and projects canonical SHA1", () => {
  const digest = "b".repeat(40);
  const observed = parseRegularManifest(Buffer.from(`sha1:${digest}  usr/libexec/git-core/git-add\n`));
  assert.deepEqual(observed.entries, [{ algorithm: "SHA1", digest, path: "usr/libexec/git-core/git-add" }]);
});

test("V11 accepts exact lowercase sha256 and projects canonical SHA256", () => {
  const digest = "a".repeat(64);
  const observed = parseRegularManifest(Buffer.from(`sha256:${digest}  usr/bin/git\n`));
  assert.deepEqual(observed.entries, [{ algorithm: "SHA256", digest, path: "usr/bin/git" }]);
});

test("V11 lowercase and legacy manifests have canonical parity", () => {
  const sha256Digest = "a".repeat(64);
  const sha1Digest = "b".repeat(40);
  const uppercase = parseRegularManifest(Buffer.from(
    `SHA256:${sha256Digest}  usr/bin/git\nSHA1:${sha1Digest}  usr/libexec/git-core/git-add\n`));
  const lowercase = parseRegularManifest(Buffer.from(
    `sha256:${sha256Digest}  usr/bin/git\nsha1:${sha1Digest}  usr/libexec/git-core/git-add\n`));
  assert.deepEqual(lowercase, uppercase);
});

test("V11 ten-line lowercase and legacy manifests have canonical parity", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    algorithm: index % 2 === 0 ? "SHA256" : "SHA1",
    digest: (index % 2 === 0 ? "a" : "b").repeat(index % 2 === 0 ? 64 : 40),
    path: `usr/lib/git/item-${String(index).padStart(2, "0")}`,
  }));
  const render = (lowercase) => Buffer.from(rows.map(({ algorithm, digest, path: entryPath }) =>
    `${lowercase ? algorithm.toLowerCase() : algorithm}:${digest}  ${entryPath}`).join("\n") + "\n");
  const expectedEntries = rows.map(({ algorithm, digest, path: entryPath }) =>
    ({ algorithm, digest, path: entryPath }));
  const uppercase = parseRegularManifest(render(false));
  const lowercase = parseRegularManifest(render(true));
  assert.deepEqual(uppercase.entries, expectedEntries);
  assert.deepEqual(lowercase, uppercase);
});

test("V11 exact manifest algorithm allowlist rejects mixed-case and unsupported tokens", async (t) => {
  const cases = [
    ["mixed SHA1", "Sha1", 40], ["mixed SHA256", "Sha256", 64],
    ["sha256-160", "sha256-160", 40], ["sha512", "sha512", 128],
    ["none", "none", 40], ["md5", "md5", 40], ["unknown", "blake3", 64],
    ["empty", "", 40], ["spaced", "SHA 1", 40], ["lookalike", "SHА1", 40],
  ];
  for (const [name, algorithm, length] of cases) {
    await t.test(name, () => {
      const error = captureThrown(() => parseRegularManifest(
        Buffer.from(`${algorithm}:${"a".repeat(length)}  usr/bin/git\n`)));
      assert.equal(error.code, "task005_git_materials_material_invalid");
      assert.equal(projectedFailure(error).materialGate, "APK_MANIFEST_LINE_GRAMMAR");
    });
  }
});

test("V11 accepted manifest algorithms reject noncanonical digest lengths", async (t) => {
  for (const [algorithm, length] of [["SHA1", 39], ["sha1", 41], ["SHA256", 63], ["sha256", 65]]) {
    await t.test(`${algorithm} length ${length}`, () => {
      const error = captureThrown(() => parseRegularManifest(
        Buffer.from(`${algorithm}:${"a".repeat(length)}  usr/bin/git\n`)));
      assert.equal(error.code, "task005_git_materials_material_invalid");
      assert.equal(projectedFailure(error).materialGate, "APK_MANIFEST_DIGEST_LENGTH");
    });
  }
});

test("V11 lowercase manifest keeps the inherited delimiter and path grammar", () => {
  const digest = "a".repeat(64);
  assert.equal(parseRegularManifest(Buffer.from(`sha256:${digest}   usr/bin/git\n`)).entries[0].path,
    " usr/bin/git");
  assert.equal(parseRegularManifest(Buffer.from(`sha256:${digest}  usr/bin/git suffix\n`)).entries[0].path,
    "usr/bin/git suffix");
  assert.deepEqual(
    parseRegularManifest(Buffer.from(` \nsha256:${digest}  usr/bin/git\n \n`)).entries,
    [{ algorithm: "SHA256", digest, path: "usr/bin/git" }]);
});

test("V11 lowercase and legacy duplicate paths reach the same duplicate gate", () => {
  const digest = "a".repeat(64);
  const error = captureThrown(() => parseRegularManifest(Buffer.from(
    `SHA256:${digest}  usr/bin/git\nsha256:${digest}  usr/bin/git\n`)));
  assert.equal(error.code, "task005_git_materials_material_invalid");
  assert.equal(projectedFailure(error).materialGate, "APK_MANIFEST_DUPLICATE_PATH");
});

test("V11 query UTF-8 failure projects its exact trusted material gate", () => {
  const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
  const invalidUtf8 = captureThrown(() => parseQuery(Buffer.from([0xc3, 0x28]), transaction));
  assert.equal(invalidUtf8.code, "task005_git_materials_material_invalid");
  assert.equal(projectedFailure(invalidUtf8).materialGate, "QUERY_UTF8");
});

test("V11 exact algorithm and digest grammar refuses every forbidden spelling", async (t) => {
  const cases = [
    ...["sHA1", "sha256-160", "SHA256-160", "Sha256-160", "sha512", "SHA512", "Sha512",
      "none", "NONE", "None", "md5", "MD5", "Md5", "unknown", "", "SHA 1", "SHA1 ",
      "SHA\t1", "SHА1"].map((algorithm) =>
      [JSON.stringify(algorithm), `${algorithm}:${"a".repeat(40)}  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"]),
    ["upper hex", `sha256:${"A".repeat(64)}  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["mixed hex", `sha1:${"a".repeat(39)}B  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["nonhex", `SHA1:${"g".repeat(40)}  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["empty digest", "sha1:  usr/bin/git", "APK_MANIFEST_LINE_GRAMMAR"],
    ["prefixed digest", `sha1:0x${"a".repeat(40)}  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["missing colon", `SHA1${"a".repeat(40)}  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["one space", `sha1:${"a".repeat(40)} usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["tab delimiter", `SHA1:${"a".repeat(40)}\t usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["NBSP delimiter", `sha1:${"a".repeat(40)}\u00a0 usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["em-space delimiter", `SHA1:${"a".repeat(40)}\u2003 usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["filename prefix", `localv2.apk: sha1:${"a".repeat(40)}  usr/bin/git`, "APK_MANIFEST_LINE_GRAMMAR"],
    ["empty path", `sha256:${"a".repeat(64)}  `, "APK_MANIFEST_LINE_GRAMMAR"],
    ["empty manifest", "", "APK_MANIFEST_EMPTY"],
    ["whitespace-only manifest", " \t\r\n ", "APK_MANIFEST_EMPTY"],
  ];
  for (const [name, text, gate] of cases) await t.test(name, () => {
    const error = captureThrown(() => parseRegularManifest(Buffer.from(`${text}\n`)));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, gate);
  });
});

test("V11 all four exact manifest tokens preserve digest and line-ending boundaries", async (t) => {
  for (const [algorithm, length, canonical] of [
    ["SHA1", 40, "SHA1"], ["sha1", 40, "SHA1"],
    ["SHA256", 64, "SHA256"], ["sha256", 64, "SHA256"],
  ]) {
    for (const delta of [-1, 1]) await t.test(`${algorithm} refused length ${length + delta}`, () => {
      const error = captureThrown(() => parseRegularManifest(
        Buffer.from(`${algorithm}:${"a".repeat(length + delta)}  usr/bin/git\n`)));
      assert.equal(error.code, "task005_git_materials_material_invalid");
      assert.equal(projectedFailure(error).materialGate, "APK_MANIFEST_DIGEST_LENGTH");
    });
    for (const separator of ["\n", "\r\n"]) await t.test(`${algorithm} ${JSON.stringify(separator)}`, () => {
      const digest = "a".repeat(length);
      const observed = parseRegularManifest(Buffer.from(`${algorithm}:${digest}  usr/bin/git${separator}`));
      const legacy = parseRegularManifest(Buffer.from(`${canonical}:${digest}  usr/bin/git\n`));
      assert.deepEqual(observed, legacy);
      assert.deepEqual(observed.entries, [{ algorithm: canonical, digest, path: "usr/bin/git" }]);
    });
  }
});

test("V11 lowercase and uppercase preserve every inherited path boundary", async (t) => {
  const paths = [
    ["absolute", "/usr/bin/git"], ["backslash", "usr\\bin\\git"],
    ["empty segment", "usr//bin/git"], ["dot segment", "usr/./git"],
    ["parent segment", "usr/../git"], ["trailing slash", "usr/bin/git/"],
    ["control", "usr/\u0000/git"], ["DEL", "usr/\u007f/git"],
    ["tab inside path", "usr/\t/git"], ["oversize", "p".repeat(4097)],
  ];
  for (const algorithm of ["SHA1", "sha1", "SHA256", "sha256"]) {
    const digest = "a".repeat(algorithm.endsWith("256") ? 64 : 40);
    for (const [name, entryPath] of paths) await t.test(`${algorithm} ${name}`, () => {
      const error = captureThrown(() => parseRegularManifest(Buffer.from(`${algorithm}:${digest}  ${entryPath}\n`)));
      assert.equal(error.code, "task005_git_materials_material_invalid");
      assert.equal(projectedFailure(error).materialGate, "APK_MANIFEST_PATH_SCHEMA");
    });
    await t.test(`${algorithm} exact path bound`, () => {
      assert.equal(parseRegularManifest(Buffer.from(`${algorithm}:${digest}  ${"p".repeat(4096)}\n`))
        .entries[0].path.length, 4096);
    });
  }
});

test("V11 late manifest grammar failure projects its exact trusted material gate", () => {
  const invalidManifest = captureThrown(() => parseRegularManifest(
    Buffer.from(`sha512:${"a".repeat(128)}  usr/bin/git\n`)));
  assert.equal(invalidManifest.code, "task005_git_materials_material_invalid");
  assert.equal(projectedFailure(invalidManifest).materialGate, "APK_MANIFEST_LINE_GRAMMAR");
});

test("V11 installed-before stderr failure projects its operation gate", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ failAt: 1,
    failResult: { status: 0, stdout: Buffer.from(`${"b".repeat(64)}  ${INSTALLED_PATH}\n`),
      stderr: Buffer.from("PRIVATE_NATIVE_STDERR") } });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const upstream = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2,
      context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command,
      fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0),
      resources: freshCarrierResources(),
    }));
    assert.equal(upstream.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(upstream).materialGate, "INSTALLED_BEFORE_STDERR");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 installed-before schema failure projects its parser gate", async () => {
  const fixture = await fixtureContext();
  const observed = observationFixture({ installedOutput: `${"b".repeat(63)}  ${INSTALLED_PATH}\n` });
  try {
    const context = await requireContext(fixture.env, "linux");
    await mkdir(context.privateRoot, { mode: 0o700 });
    const error = await captureRejected(() => materializeObservation({
      availableBytes: 30 * 1024 ** 2, context,
      probe: { version: "apk-tools 3.0.0, compiled for x86_64.", help: completeHelp(),
        imageId: FIXTURE_IMAGE_ID },
      command: observed.command, fetchImpl: observed.fetchImpl,
      now: () => Date.UTC(2026, 9, 29, 20, 0, 0), resources: freshCarrierResources(),
    }));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, "INSTALLED_BEFORE_HASH_SCHEMA");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 post-cleanup evidence root failure projects its raw-log-only gate", async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const evidence = captureThrown(() => validateEvidence({}, context));
    assert.equal(evidence.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(evidence).materialGate, "EVIDENCE_ROOT_SCHEMA");
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 query producer matrix projects every reviewed gate", async (t) => {
  const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
  const valid = () => ({ name: "git", version: "2.54.0-r0", arch: "x86_64",
    "file-size": 19, "installed-size": 1024, license: "GPL-2.0-only", origin: "git",
    maintainer: "Alpine Developers", commit: "c".repeat(40), depends: [], "install-if": [] });
  const cases = [
    ["QUERY_UTF8", () => Buffer.from([0xc3, 0x28])],
    ["QUERY_JSON_SYNTAX", () => Buffer.from("{")],
    ["QUERY_ROOT_SCHEMA", () => Buffer.from("42")],
    ["QUERY_CARDINALITY", () => Buffer.from(JSON.stringify([]))],
    ["QUERY_RECORD_STRUCTURE", () => Buffer.from(JSON.stringify([null]))],
    ["QUERY_NAME_TYPE", () => Buffer.from(JSON.stringify([{ ...valid(), name: 7 }]))],
    ["QUERY_VERSION_TYPE", () => Buffer.from(JSON.stringify([{ ...valid(), version: 7 }]))],
    ["QUERY_ARCHITECTURE", () => Buffer.from(JSON.stringify([{ ...valid(), arch: "noarch" }]))],
    ["QUERY_FILE_SIZE", () => Buffer.from(JSON.stringify([{ ...valid(), "file-size": -1 }]))],
    ["QUERY_INSTALLED_SIZE", () => Buffer.from(JSON.stringify([{ ...valid(), "installed-size": -1 }]))],
    ["QUERY_LICENSE", () => Buffer.from(JSON.stringify([{ ...valid(), license: "" }]))],
    ["QUERY_ORIGIN", () => Buffer.from(JSON.stringify([{ ...valid(), origin: "" }]))],
    ["QUERY_MAINTAINER", () => Buffer.from(JSON.stringify([{ ...valid(), maintainer: 7 }]))],
    ["QUERY_COMMIT", () => Buffer.from(JSON.stringify([{ ...valid(), commit: "z".repeat(40) }]))],
    ["QUERY_NAME_VERSION_BINDING", () => Buffer.from(JSON.stringify([{ ...valid(), version: "2.54.1-r0" }]))],
    ["QUERY_DEPENDS_SCHEMA", () => Buffer.from(JSON.stringify([{ ...valid(), depends: [7] }]))],
    ["QUERY_INSTALL_IF_SCHEMA", () => Buffer.from(JSON.stringify([{ ...valid(), "install-if": [7] }]))],
    ["QUERY_DUPLICATE_NAME", () => Buffer.from(JSON.stringify([valid(), valid()])),
      [{ ...transaction[0] }, { ...transaction[0], order: 2 }]],
  ];
  for (const [gate, bytes, tx = transaction] of cases) {
    await t.test(gate, () => {
      const error = captureThrown(() => parseQuery(bytes(), tx));
      assert.equal(error.code, "task005_git_materials_material_invalid");
      assert.equal(projectedFailure(error).materialGate, gate);
    });
  }
});

test("V11 key and manifest producer matrices project every reviewed parser gate", async (t) => {
  const keyDigest = "a".repeat(64);
  const keyCases = [
    ["KEYS_UTF8", Buffer.from([0xc3, 0x28])],
    ["KEYS_COUNT", Buffer.alloc(0)],
    ["KEYS_RECORD_SCHEMA", Buffer.from(`invalid\t451\t${keyDigest}\n`)],
    ["KEYS_DUPLICATE", Buffer.from(`alpine.rsa.pub\t451\t${keyDigest}\nalpine.rsa.pub\t451\t${keyDigest}\n`)],
  ];
  for (const [gate, bytes] of keyCases) await t.test(gate, () => {
    const error = captureThrown(() => parseKeyManifest(bytes));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, gate);
  });

  const manifestCases = [
    ["APK_MANIFEST_UTF8", Buffer.from([0xc3, 0x28])],
    ["APK_MANIFEST_LINE_GRAMMAR", Buffer.from(`sha512:${"a".repeat(128)}  usr/bin/git\n`)],
    ["APK_MANIFEST_DIGEST_LENGTH", Buffer.from(`sha256:${"a".repeat(63)}  usr/bin/git\n`)],
    ["APK_MANIFEST_PATH_SCHEMA", Buffer.from(`sha256:${"a".repeat(64)}  ../git\n`)],
    ["APK_MANIFEST_EMPTY", Buffer.from(" \n")],
    ["APK_MANIFEST_DUPLICATE_PATH", Buffer.from(
      `SHA256:${"a".repeat(64)}  usr/bin/git\nsha256:${"b".repeat(64)}  usr/bin/git\n`)],
  ];
  for (const [gate, bytes] of manifestCases) await t.test(gate, () => {
    const error = captureThrown(() => parseRegularManifest(bytes));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, gate);
  });
});

test("V11 private-tree producer matrix projects both reviewed gates", {
  skip: process.platform !== "linux",
}, async (t) => {
  await t.test("PRIVATE_TREE_SYMLINK", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "task005-v11-tree-link-"));
    try {
      await writeFile(path.join(root, "target"), "fixture", { mode: 0o600 });
      await symlink("target", path.join(root, "link"));
      const error = await captureRejected(() => privateTreeBytes(root));
      assert.equal(projectedFailure(error).materialGate, "PRIVATE_TREE_SYMLINK");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await t.test("PRIVATE_TREE_ENTRY_TYPE", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "task005-v11-tree-hardlink-"));
    try {
      const first = path.join(root, "first");
      await writeFile(first, "fixture", { mode: 0o600 });
      await link(first, path.join(root, "second"));
      const error = await captureRejected(() => privateTreeBytes(root));
      assert.equal(projectedFailure(error).materialGate, "PRIVATE_TREE_ENTRY_TYPE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("V11 installed and APK binding producer matrix projects all reviewed gates", async (t) => {
  const validInstalled = Buffer.from(`${"b".repeat(64)}  ${INSTALLED_PATH}\n`);
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  const invalidSchema = Buffer.from(`${"b".repeat(63)}  ${INSTALLED_PATH}\n`);
  const cases = [
    ["INSTALLED_BEFORE_UTF8", { installedOutputs: [invalidUtf8] }],
    ["INSTALLED_BEFORE_HASH_SCHEMA", { installedOutputs: [invalidSchema] }],
    ["INSTALLED_AFTER_UTF8", { installedOutputs: [validInstalled, invalidUtf8] }],
    ["INSTALLED_AFTER_HASH_SCHEMA", { installedOutputs: [validInstalled, invalidSchema] }],
    ["APK_INDEX_BINDING_UTF8", { bindingOutput: invalidUtf8 }],
    ["APK_INDEX_BINDING_HASH_SCHEMA", { bindingOutput: Buffer.from(`${"a".repeat(63)}  -\n`) }],
    ["APK_INDEX_BINDING_MISMATCH", { repositoryHash: "f".repeat(64) }],
  ];
  for (const [gate, options] of cases) await t.test(gate, async () => {
    const error = await captureV11MaterialGate(options);
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, gate);
  });
});

test("V11 APK filename and download-size producers project their reviewed gates", async (t) => {
  await t.test("APK_DOWNLOAD_SIZE", async () => {
    const query = [{ name: "git", version: "2.54.0-r0", arch: "x86_64", "file-size": 1,
      "installed-size": 1024, license: "GPL-2.0-only", origin: "git", maintainer: "Alpine Developers",
      commit: "c".repeat(40), depends: [], "install-if": [] }];
    const error = await captureV11MaterialGate({ queryOutput: JSON.stringify(query) });
    assert.equal(projectedFailure(error).materialGate, "APK_DOWNLOAD_SIZE");
  });
  await t.test("APK_FILENAME", async () => {
    const longName = "a".repeat(128);
    const longVersion = "1".repeat(128);
    const simulationOutput = `(1/2) Installing ${longName} (${longVersion})\n`
      + "(2/2) Installing git (2.54.0-r0)\nOK: 12 MiB in 15 packages\n";
    const query = [
      { name: longName, version: longVersion, arch: "x86_64", "file-size": 1, "installed-size": 1,
        license: "MIT", origin: longName, maintainer: "Fixture", commit: "a".repeat(40),
        depends: [], "install-if": [] },
      { name: "git", version: "2.54.0-r0", arch: "x86_64", "file-size": 19, "installed-size": 1024,
        license: "GPL-2.0-only", origin: "git", maintainer: "Alpine Developers", commit: "c".repeat(40),
        depends: [], "install-if": [] },
    ];
    const error = await captureV11MaterialGate({ simulationOutput, queryOutput: JSON.stringify(query) });
    assert.equal(projectedFailure(error).materialGate, "APK_FILENAME");
  });
});

test("V11 repeated package operations reuse one identity-free static gate", async (t) => {
  for (const [name, failAt] of [["first package", 7], ["later package", 10]]) {
    await t.test(name, async () => {
      const { error, records } = await captureV11TenPackageRefusal({ failAt });
      const projected = projectedFailure(error);
      assert.equal(projected.materialGate, "APK_MANIFEST_STDERR");
      assert.equal(records.length, failAt + 1);
      assert.doesNotMatch(JSON.stringify(projected), /fixture-01|fixture-02|PRIVATE_TEN_PACKAGE_STDERR|usr\//u);
    });
  }
});

test("V11 all eleven material stderr operations project their frozen gates", async (t) => {
  const gates = [
    "KEYS_STDERR", "INSTALLED_BEFORE_STDERR", "INDEX_VERIFY_STDERR", "SIMULATE_FIRST_STDERR",
    "QUERY_STDERR", "APK_VERIFY_STDERR", "APK_INDEX_BINDING_STDERR", "APK_MANIFEST_STDERR",
    "SIMULATE_SECOND_STDERR", "INSTALLED_AFTER_STDERR", "VERSION_COMPARE_STDERR",
  ];
  for (const [failAt, gate] of gates.entries()) await t.test(gate, async () => {
    const error = await captureV11MaterialGate({ failAt,
      ...(gate === "VERSION_COMPARE_STDERR" ? { secfixes: { "2.54.1-r0": ["CVE-2026-0001"] } } : {}),
      failResult: { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.from("PRIVATE_STDERR_SENTINEL") } });
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, gate);
    assert.doesNotMatch(JSON.stringify(projectedFailure(error)), /PRIVATE_STDERR_SENTINEL/u);
  });
});

test("V11 direct evidence validator projects all fifteen raw-log-only gates", async (t) => {
  const collected = await collectV11Evidence();
  const { context } = collected;
  const cases = [
    ["EVIDENCE_ROOT_SCHEMA", () => null],
    ["EVIDENCE_RECEIPT_SCHEMA", (value) => { value.receipt.actor = "OTHER"; return value; }],
    ["EVIDENCE_BOUNDARIES", (value) => {
      value.receipt.boundaries.hookContent = "OBSERVED"; return value;
    }],
    ["EVIDENCE_EXECUTION", (value) => { value.receipt.execution.gitExecuted = true; return value; }],
    ["EVIDENCE_SECURITY", (value) => { value.receipt.security.stage2 = "COMPLETE"; return value; }],
    ["EVIDENCE_INDEX", (value) => { value.receipt.index.genericVerification = "FAILED"; return value; }],
    ["EVIDENCE_CARRIER", (value) => { value.receipt.carrier.imageId = "invalid"; return value; }],
    ["EVIDENCE_SECDB", (value) => { value.receipt.secdb.freshness = "UNKNOWN"; return value; }],
    ["EVIDENCE_MANIFEST_SCHEMA", (value) => { value.manifest.actor = "OTHER"; return value; }],
    ["EVIDENCE_PACKAGE_CARDINALITY", (value) => { value.manifest.packages = []; return value; }],
    ["EVIDENCE_PACKAGE_UNIQUENESS", (value) => {
      value.receipt.packages = [value.receipt.packages[0], globalThis.structuredClone(value.receipt.packages[0])];
      value.manifest.packages = [value.manifest.packages[0],
        { ...globalThis.structuredClone(value.manifest.packages[0]), filename: "other-1-r0.apk" }];
      return value;
    }],
    ["EVIDENCE_PACKAGE_VERDICTS", (value) => {
      value.manifest.packages[0].localSignature = "FAILED"; return value;
    }],
    ["EVIDENCE_PACKAGE_BINDING", (value) => { value.manifest.packages[0].bytes += 1; return value; }],
    ["EVIDENCE_PRIVACY", (value) => {
      value.receipt.packages[0].license = "/materials/private-sentinel"; return value;
    }],
  ];
  for (const [gate, mutate] of cases) await t.test(gate, () => {
    const invalid = mutate(globalThis.structuredClone(collected.evidence));
    const error = captureThrown(() => validateEvidence(invalid, context));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, gate);
  });

  await t.test("EVIDENCE_NOT_RUN_SCHEMA", () => {
    const notRunContext = { ...context, headSha: HEAD, mergeSha: MERGE, eventNumber: 205,
      runId: "40999999999" };
    const invalid = notRunEvidence(notRunContext, "apk-tools 3.0.0", completeHelp(),
      { missing: ["manifest:manifest"] }, { containersAbsent: true, privateFilesAbsent: true },
      FIXTURE_IMAGE_ID, 30 * 1024 ** 2);
    invalid.receipt.materialsAcquired = true;
    const error = captureThrown(() => validateEvidence(invalid, context));
    assert.equal(error.code, "task005_git_materials_material_invalid");
    assert.equal(projectedFailure(error).materialGate, "EVIDENCE_NOT_RUN_SCHEMA");
  });
});

test("V11 real actor keeps every evidence gate raw-log-only after cleanup", {
  skip: process.platform !== "linux",
}, async (t) => {
  const collected = await collectV11Evidence();
  const mutators = [
    ["EVIDENCE_ROOT_SCHEMA", () => null],
    ["EVIDENCE_RECEIPT_SCHEMA", (value) => { value.receipt.actor = "OTHER"; return value; }],
    ["EVIDENCE_BOUNDARIES", (value) => { value.receipt.boundaries.hookContent = "OBSERVED"; return value; }],
    ["EVIDENCE_EXECUTION", (value) => { value.receipt.execution.gitExecuted = true; return value; }],
    ["EVIDENCE_SECURITY", (value) => { value.receipt.security.stage2 = "COMPLETE"; return value; }],
    ["EVIDENCE_INDEX", (value) => { value.receipt.index.genericVerification = "FAILED"; return value; }],
    ["EVIDENCE_CARRIER", (value) => { value.receipt.carrier.imageId = "invalid"; return value; }],
    ["EVIDENCE_SECDB", (value) => { value.receipt.secdb.freshness = "UNKNOWN"; return value; }],
    ["EVIDENCE_MANIFEST_SCHEMA", (value) => { value.manifest.actor = "OTHER"; return value; }],
    ["EVIDENCE_PACKAGE_CARDINALITY", (value) => { value.manifest.packages = []; return value; }],
    ["EVIDENCE_PACKAGE_UNIQUENESS", (value) => {
      value.receipt.packages = [value.receipt.packages[0], globalThis.structuredClone(value.receipt.packages[0])];
      value.manifest.packages = [value.manifest.packages[0],
        { ...globalThis.structuredClone(value.manifest.packages[0]), filename: "other-1-r0.apk" }];
      return value;
    }],
    ["EVIDENCE_PACKAGE_VERDICTS", (value) => { value.manifest.packages[0].indexBinding = "FAILED"; return value; }],
    ["EVIDENCE_PACKAGE_BINDING", (value) => { value.manifest.packages[0].bytes += 1; return value; }],
  ];
  for (const [gate, mutate] of mutators) await t.test(gate, async () => {
    const fixture = await fixtureContext();
    try {
      const context = await requireContext(fixture.env, "linux");
      const invalid = mutate(globalThis.structuredClone(collected.evidence));
      const error = await captureRejected(() => executeActor(context, {
        statfs: async () => enoughCapacity(),
        probe: async () => ({ version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID }),
        materialize: async () => invalid,
        cleanup: cleanupPrivate,
      }));
      assert.equal(error.code, "task005_git_materials_material_invalid");
      assert.equal(projectedFailure(error).materialGate, gate);
      await assert.rejects(access(context.privateRoot));
      await assert.rejects(access(context.publicRoot));
    } finally {
      await rm(fixture.runnerTemp, { recursive: true, force: true });
    }
  });

  for (const [gate, makeInvalid] of [
    ["EVIDENCE_NOT_RUN_SCHEMA", (context) => {
      const value = notRunEvidence(context, "apk-tools 3.0.0", completeHelp(),
        { missing: ["manifest:manifest"] }, { containersAbsent: true, privateFilesAbsent: true },
        FIXTURE_IMAGE_ID, 30 * 1024 ** 2);
      value.receipt.materialsAcquired = true;
      return value;
    }],
    ["EVIDENCE_PRIVACY", () => {
      const value = globalThis.structuredClone(collected.evidence);
      value.receipt.packages[0].license = "/materials/private-sentinel";
      return value;
    }],
  ]) await t.test(gate, async () => {
    const fixture = await fixtureContext();
    try {
      const context = await requireContext(fixture.env, "linux");
      const error = await captureRejected(() => executeActor(context, {
        statfs: async () => enoughCapacity(),
        probe: async () => ({ version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID }),
        materialize: async () => makeInvalid(context), cleanup: cleanupPrivate,
      }));
      assert.equal(projectedFailure(error).materialGate, gate);
      await assert.rejects(access(context.privateRoot));
      await assert.rejects(access(context.publicRoot));
    } finally {
      await rm(fixture.runnerTemp, { recursive: true, force: true });
    }
  });
});

test("V11 blocked-capable first error reaches receipt without changing the empty manifest", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
    const trusted = captureThrown(() => parseQuery(Buffer.from([0xc3, 0x28]), transaction));
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID }),
      materialize: async () => { throw trusted; }, cleanup: cleanupPrivate,
    }));
    assert.equal(error, trusted);
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.code, "task005_git_materials_material_invalid");
    assert.equal(evidence.receipt.materialGate, "QUERY_UTF8");
    assert.deepEqual(evidence.manifest, {
      actor: "TASK005_GIT_MATERIALS_MANIFEST_V1",
      authority: "DIAGNOSTIC_ONLY", files: [], installationAuthorization: false, state: "EMPTY_BLOCKED",
    });
    assert.equal(Object.hasOwn(evidence.manifest, "materialGate"), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 failure marker rejects all fifteen raw-log-only gate literals", async (t) => {
  for (const materialGate of V11_RAW_LOG_ONLY_GATES) await t.test(materialGate, async () => {
    const bytes = Buffer.from(canonicalJson({
      code: "task005_git_materials_material_invalid", materialGate,
    }));
    await assert.rejects(readMarkerBytes(bytes), { code: "task005_git_materials_cleanup_failed" });
  });
});

test("V11 failure marker rejects bad code and gate pairings", async (t) => {
  const cases = [
    ["non-material code", { code: "task005_git_materials_download_failed", materialGate: "QUERY_UTF8" }],
    ["unknown gate", { code: "task005_git_materials_material_invalid", materialGate: "QUERY_UNKNOWN" }],
    ["diagnostic plus gate", { code: "task005_git_materials_material_invalid", materialGate: "QUERY_UTF8",
      childDiagnostic: expectedDiagnostic("MATERIAL_QUERY", "EXIT_STATUS", { status: 23 }) }],
    ["native category plus gate", { code: "task005_git_materials_material_invalid", materialGate: "QUERY_UTF8",
      nativeErrorCategory: "EACCES" }],
  ];
  for (const [name, record] of cases) await t.test(name, async () => {
    await assert.rejects(readMarkerBytes(Buffer.from(canonicalJson(record))),
      { code: "task005_git_materials_cleanup_failed" });
  });
});

test("V11 marker writer refuses a trusted raw-log-only gate before file creation", async () => {
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), "task005-v11-raw-writer-"));
  try {
    const trusted = captureThrown(() => validateEvidence(null, { runnerTemp: privateRoot }));
    await assert.rejects(writeFailureMarker({ privateRoot }, trusted),
      { code: "task005_git_materials_cleanup_failed" });
    assert.deepEqual(await readdir(privateRoot), []);
  } finally {
    await rm(privateRoot, { recursive: true, force: true });
  }
});

test("V11 blocked evidence refuses a deliberately misrouted trusted raw-log-only gate", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const trusted = captureThrown(() => validateEvidence(null, context));
    const error = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(),
      probe: async () => ({ version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID }),
      materialize: async () => { throw trusted; }, cleanup: cleanupPrivate,
    }));
    assert.equal(error.code, "task005_git_materials_cleanup_failed");
    await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 deferred cleanup preserves the first trusted material gate", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await fixtureContext();
  try {
    const context = await requireContext(fixture.env, "linux");
    const transaction = [{ action: "ADD", name: "git", order: 1, version: "2.54.0-r0" }];
    const first = captureThrown(() => parseQuery(Buffer.from([0xc3, 0x28]), transaction));
    const observed = await captureRejected(() => executeActor(context, {
      statfs: async () => enoughCapacity(), probe: async () => { throw first; },
      cleanup: async () => { throw Object.assign(new Error("cleanup"),
        { code: "task005_git_materials_cleanup_failed" }); },
    }));
    assert.equal(observed, first);
    assert.equal(projectedFailure(await readFailureMarker(context)).materialGate, "QUERY_UTF8");
    await assert.rejects(access(context.publicRoot), { code: "ENOENT" });

    await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
    const evidence = await readPublicEvidence(context);
    assert.equal(evidence.receipt.code, "task005_git_materials_material_invalid");
    assert.equal(evidence.receipt.materialGate, "QUERY_UTF8");
    assert.equal(Object.hasOwn(evidence.manifest, "materialGate"), false);
  } finally {
    await rm(fixture.runnerTemp, { recursive: true, force: true });
  }
});

test("V11 actor changes reverse exactly to the frozen V10 source", async () => {
  const source = reverseV11ActorToFrozenV10(await readFile(actorPath, "utf8"));
  assert.equal(Buffer.byteLength(source), 84_491);
  assert.equal(hash(Buffer.from(source)), "f66e7ab94e96e90ac60dcc4d2c5de18aed28e877119c4dab91b33da9c48ead75");
});

test("V11 every blocked-capable gate round-trips through the canonical marker decoder", async (t) => {
  for (const materialGate of V11_BLOCKED_CAPABLE_GATES) await t.test(materialGate, async () => {
    const record = { code: "task005_git_materials_material_invalid", materialGate };
    const decoded = await readMarkerBytes(Buffer.from(canonicalJson(record)));
    assert.deepEqual(decoded, record);
    assert.equal(projectedFailure(decoded).materialGate, materialGate);
    assert.equal(Object.hasOwn(projectedFailure({ ...decoded }), "materialGate"), false);
  });
});

test("V11 a foreign raw-log gate remains a legacy code-only marker", async () => {
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), "task005-v11-foreign-raw-"));
  try {
    await writeFailureMarker({ privateRoot }, {
      code: "task005_git_materials_material_invalid", materialGate: "EVIDENCE_ROOT_SCHEMA",
    });
    assert.equal(await readFile(path.join(privateRoot, "failure-code"), "utf8"),
      canonicalJson({ code: "task005_git_materials_material_invalid" }));
  } finally {
    await rm(privateRoot, { recursive: true, force: true });
  }
});

test("V11 early and late first gates survive immediate and second-material deferred cleanup", {
  skip: process.platform !== "linux" && "requires POSIX private-root ownership semantics",
}, async (t) => {
  const makeFirst = [
    ["QUERY_UTF8", () => captureThrown(() => parseQuery(Buffer.from([0xc3, 0x28]), []))],
    ["APK_MANIFEST_DUPLICATE_PATH", () => captureThrown(() => parseRegularManifest(Buffer.from(
      `SHA1:${"a".repeat(40)}  usr/bin/git\nsha256:${"b".repeat(64)}  usr/bin/git\n`)))],
  ];
  for (const [gate, makeError] of makeFirst) for (const deferred of [false, true]) {
    await t.test(`${gate} ${deferred ? "deferred" : "immediate"}`, async () => {
      const fixture = await fixtureContext();
      try {
        const context = await requireContext(fixture.env, "linux");
        const first = makeError();
        const second = captureThrown(() => parseQuery(Buffer.from("{"), []));
        assert.equal(projectedFailure(second).materialGate, "QUERY_JSON_SYNTAX");
        let cleanupCalls = 0;
        const observed = await captureRejected(() => executeActor(context, {
          statfs: async () => enoughCapacity(),
          probe: async () => ({ version: "apk-tools 3.0.0", help: completeHelp(), imageId: FIXTURE_IMAGE_ID }),
          materialize: async () => { throw first; },
          cleanup: async () => {
            cleanupCalls += 1;
            assert.equal(projectedFailure(await readFailureMarker(context)).materialGate, gate);
            if (deferred) throw second;
            await cleanupPrivate(context);
          },
        }));
        assert.equal(observed, first);
        assert.equal(projectedFailure(observed).materialGate, gate);
        assert.equal(cleanupCalls, 1);
        if (deferred) {
          assert.equal(projectedFailure(await readFailureMarker(context)).materialGate, gate);
          await assert.rejects(access(context.publicRoot), { code: "ENOENT" });
          await run(["cleanup"], fixture.env, { platform: "linux", cleanup: cleanupPrivate, log: () => {} });
        }
        const evidence = await readPublicEvidence(context);
        assert.equal(evidence.receipt.code, "task005_git_materials_material_invalid");
        assert.equal(evidence.receipt.materialGate, gate);
        assert.deepEqual(evidence.manifest, {
          actor: "TASK005_GIT_MATERIALS_MANIFEST_V1", authority: "DIAGNOSTIC_ONLY", files: [],
          installationAuthorization: false, state: "EMPTY_BLOCKED",
        });
        await assert.rejects(access(context.privateRoot), { code: "ENOENT" });
      } finally {
        await rm(fixture.runnerTemp, { recursive: true, force: true });
      }
    });
  }
});


test("V11 test additions reverse to every frozen V10 byte and assertion", async () => {
  const current = await readFile(new URL(import.meta.url), "utf8");
  const reversed = reverseV11TestsToFrozenV10(current);
  assert.equal(Buffer.byteLength(reversed), 198925);
  assert.equal(hash(Buffer.from(reversed)), "21faf575c1c61d7987a0a63a8d04156b0a3d550ba9bded7bc1de843ced5eb1ea");
  const changed = replaceExact(current,
    '\nconst HEAD = "0123456789abcdef0123456789abcdef01234567";\n',
    '\nconst HEAD = "1123456789abcdef0123456789abcdef01234567";\n', "unrelated historical test byte");
  assert.notEqual(hash(Buffer.from(reverseV11TestsToFrozenV10(changed))),
    "21faf575c1c61d7987a0a63a8d04156b0a3d550ba9bded7bc1de843ced5eb1ea");
});

test("V11 workflow namespace reverses to the exact frozen V10 workflow", async () => {
  const current = await readFile(workflowPath, "utf8");
  const reversed = reverseV11WorkflowToFrozenV10(current);
  assert.equal(Buffer.byteLength(reversed), 3948);
  assert.equal(hash(Buffer.from(reversed)), "f40618e075176270966b632b7d8fd963c5504ec096863f3705c1e1d947909b40");
  const changed = replaceExact(current, "    timeout-minutes: 45\n", "    timeout-minutes: 44\n",
    "unrelated workflow timeout");
  assert.notEqual(hash(Buffer.from(reverseV11WorkflowToFrozenV10(changed))),
    "f40618e075176270966b632b7d8fd963c5504ec096863f3705c1e1d947909b40");
});

test("V11 full actor reversal still detects an unrelated actor byte", async () => {
  const current = await readFile(actorPath, "utf8");
  const changed = replaceExact(current, "const KiB = 1024;", "const KiB = 1025;", "unrelated actor byte");
  assert.notEqual(hash(Buffer.from(reverseV11ActorToFrozenV10(changed))),
    "f66e7ab94e96e90ac60dcc4d2c5de18aed28e877119c4dab91b33da9c48ead75");
});

// V11_ADDITIONS_TESTS_END
