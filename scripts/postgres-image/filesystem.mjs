import { createHash } from "node:crypto";
import { constants, createReadStream, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import policy from "../../infra/postgres-image/filesystem-policy.json" with { type: "json" };
import lock from "../../infra/postgres-image/lock.json" with { type: "json" };
import { scanRawUstar } from "../seaweed-image/archive.mjs";
import { validatePostgresGosuFilesystemDelta } from "./evidence.mjs";

const policyBytes = readFileSync(new URL("../../infra/postgres-image/filesystem-policy.json", import.meta.url));
const policyIdentity = Object.freeze({ size: policyBytes.length,
  sha256: createHash("sha256").update(policyBytes).digest("hex") });
const MAX_BYTES = 1024 ** 3;

function fail(check) {
  const error = new Error("postgres_gosu_filesystem_policy_invalid");
  error.diagnostic = { check }; throw error;
}
function withoutMtime(entry) { const value = { ...entry }; delete value.mtime; return value; }

export function verifyPostgresFilesystemInventories({ baseEntries, candidateEntries, baseConfig, candidateConfig,
  additionalLabels, parentImage, startedAt, completedAt }) {
  const start = Math.floor(Date.parse(startedAt) / 1000); const end = Math.floor(Date.parse(completedAt) / 1000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end ||
      policy.schemaVersion !== 1 || policy.baseConfigId !== lock.base.configId ||
      policy.recipeSha256 !== lock.recipe.sha256 || policy.apkSha256 !== lock.apk.sha256 ||
      !Array.isArray(baseEntries) || !Array.isArray(candidateEntries)) fail("context");
  const base = new Map(baseEntries.map((entry) => [entry.path, entry]));
  const candidate = new Map(candidateEntries.map((entry) => [entry.path, entry]));
  const inWindow = (mtime) => Number.isSafeInteger(mtime) && mtime >= start && mtime <= end;
  if (!isDeepStrictEqual(base.get(policy.oldExecutable.path), policy.oldExecutable) ||
      !isDeepStrictEqual(candidate.get(policy.newExecutable.path), policy.newExecutable)) fail("executables");
  const expectedApkChanges = policy.apkChanges.map(({ path, before: expectedBefore, after: expectedAfter }) => {
    const before = base.get(path); const after = candidate.get(path);
    if (!isDeepStrictEqual(before, expectedBefore) || !after ||
        !isDeepStrictEqual(withoutMtime(after), expectedAfter) || !inWindow(after.mtime)) fail("apk_bytes");
    return { path, before, after };
  });
  const expectedMtimeChanges = policy.mtimeOnly.map(({ entry, baseMtime, source }) => {
    const before = base.get(entry.path); const after = candidate.get(entry.path);
    if (!before || !after || !isDeepStrictEqual(withoutMtime(before), entry) ||
        !isDeepStrictEqual(withoutMtime(after), entry) || !inWindow(after.mtime) ||
        (source === "container-created" ? baseMtime !== null || !inWindow(before.mtime)
          : source !== "build-updated" || before.mtime !== baseMtime)) fail("mtime_metadata");
    return { path: entry.path, before, after };
  });
  const delta = validatePostgresGosuFilesystemDelta({ baseEntries, candidateEntries, baseConfig, candidateConfig,
    expectedAdditionalLabels: additionalLabels, expectedParentImage: parentImage, expectedApkChanges, expectedMtimeChanges });
  return Object.freeze({ ...delta, policy: policyIdentity, baseMembers: baseEntries.length,
    candidateMembers: candidateEntries.length });
}

export async function verifyPostgresFilesystem({ baseFile, candidateFile, baseIdentity, candidateIdentity, ...context }) {
  const parse = async (file, identity) => {
    if (!identity || !Number.isSafeInteger(identity.size) || identity.size <= 0 || identity.size > MAX_BYTES ||
        !/^[a-f0-9]{64}$/u.test(identity.sha256 ?? "")) fail("archive_identity");
    const result = await scanRawUstar({ input: createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }),
      diffId: `sha256:${identity.sha256}`, maxRawBytes: MAX_BYTES, maxMembers: 100_000, allowHardlinks: true });
    if (result.rawSize !== identity.size) fail("archive_size");
    return result.members.map(({ entry }) => entry);
  };
  const baseEntries = await parse(baseFile, baseIdentity);
  const candidateEntries = await parse(candidateFile, candidateIdentity);
  const result = verifyPostgresFilesystemInventories({ ...context, baseEntries, candidateEntries });
  return { result, inventories: { base: baseEntries, candidate: candidateEntries } };
}
