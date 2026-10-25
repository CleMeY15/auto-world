import assert from "node:assert/strict";
import test from "node:test";

import policy from "../infra/postgres-image/filesystem-policy.json" with { type: "json" };
import { verifyPostgresFilesystemInventories } from "../scripts/postgres-image/filesystem.mjs";

const clone = (value) => globalThis.structuredClone(value);
const start = 1790540721;
function fixture() {
  const baseEntries = [clone(policy.oldExecutable), ...policy.apkChanges.map(({ before }) => clone(before)),
    ...policy.mtimeOnly.map(({ entry, baseMtime }) => ({ ...clone(entry), mtime: baseMtime ?? start + 3 }))];
  const candidateEntries = [clone(policy.newExecutable), ...policy.apkChanges.map(({ after }) => ({ ...clone(after), mtime: start })),
    ...policy.mtimeOnly.map(({ entry, source }) => ({ ...clone(entry), mtime: source === "container-created" ? start + 5 : start }))];
  const regular = { path: "usr/share/zoneinfo/Africa/Abidjan", type: "file", mode: 0o644, uid: 0, gid: 0,
    mtime: 1789452771, size: 148, sha256: "a".repeat(64) };
  const link = { path: "usr/share/zoneinfo/Africa/Accra", type: "hardlink", mode: 0o644, uid: 0, gid: 0,
    mtime: regular.mtime, size: 0, linkname: regular.path };
  baseEntries.push(clone(regular), clone(link)); candidateEntries.push(clone(regular), clone(link));
  const baseConfig = { Image: "", User: "", Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"] };
  const parentImage = `sha256:${"b".repeat(64)}`;
  return { baseEntries, candidateEntries, baseConfig, parentImage,
    candidateConfig: { ...clone(baseConfig), Image: parentImage, Labels: { diagnostic: "run" } },
    additionalLabels: { diagnostic: "run" }, startedAt: new Date(start * 1000).toISOString(),
    completedAt: new Date((start + 8) * 1000).toISOString() };
}

test("the reviewed native filesystem policy accepts exact package bytes, export metadata and unchanged hardlinks", () => {
  const result = verifyPostgresFilesystemInventories(fixture());
  assert.equal(result.state, "VERIFIED_DIAGNOSTIC_DELTA");
  assert.deepEqual(result.apkChanged, ["etc/apk/world", "lib/apk/db/installed"]);
  assert.equal(result.exportMtimeOnly.length, 17);
  assert.match(result.policy.sha256, /^[a-f0-9]{64}$/u);
});

test("unexpected contents, paths, metadata, hardlinks or timestamp exceptions stop the native filesystem gate", () => {
  const candidate = (value, path) => value.candidateEntries.find((entry) => entry.path === path);
  const base = (value, path) => value.baseEntries.find((entry) => entry.path === path);
  for (const mutate of [
    (v) => { candidate(v, "etc/apk/world").sha256 = "b".repeat(64); },
    (v) => { candidate(v, "lib/apk/db/installed").mtime = start - 1; },
    (v) => { base(v, "etc/apk/world").mtime += 1; },
    (v) => { candidate(v, ".dockerenv").sha256 = "b".repeat(64); },
    (v) => { candidate(v, "etc/hosts").size = 1; },
    (v) => { candidate(v, "dev/console").mode = 0o777; },
    (v) => { candidate(v, "etc/mtab").linkname = "/etc/passwd"; },
    (v) => { candidate(v, "tmp").uid = 70; },
    (v) => { candidate(v, "usr/bin").mtime = start + 9; },
    (v) => { base(v, "etc/hostname").mtime = start - 1; },
    (v) => { candidate(v, "usr/bin/gosu").mtime += 1; },
    (v) => { base(v, "usr/local/bin/gosu").sha256 = "b".repeat(64); },
    (v) => { candidate(v, "usr/share/zoneinfo/Africa/Accra").linkname = "../Abidjan"; },
    (v) => { candidate(v, "usr/share/zoneinfo/Africa/Accra").mode = 0o755; },
    (v) => { v.candidateEntries.push({ ...clone(v.candidateEntries[0]), path: "usr/bin/unexpected" }); },
    (v) => { v.candidateEntries.push(clone(v.candidateEntries[0])); },
    (v) => { v.candidateConfig.Cmd = ["sh"]; },
    (v) => { v.candidateConfig.Image = `sha256:${"c".repeat(64)}`; },
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => verifyPostgresFilesystemInventories(value), /postgres_gosu_filesystem_(?:policy|delta)_invalid/u);
  }
});
