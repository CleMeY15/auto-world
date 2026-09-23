import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { collectServerLogs, serverLogLimits } from "../scripts/seaweed/server-logs.mjs";

const WORK_NAME = "auto-world-seaweed-source-diagnostic";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-server-logs-"));
  const workRoot = path.join(root, WORK_NAME);
  const tmp = path.join(workRoot, "tmp");
  mkdirSync(tmp, { recursive: true });
  return { root, workRoot, tmp };
}

function server(tmp, suffix = "1") {
  const directory = path.join(tmp, `seaweedfs_volume_server_it_${suffix}`);
  const logs = path.join(directory, "logs");
  mkdirSync(logs, { recursive: true });
  return { directory, logs };
}

function collect(scope) {
  return collectServerLogs(scope.workRoot, { root: scope.root, groupAbsent: true });
}

test("collector returns deterministic direct server logs and ignores unrelated data", () => {
  const scope = fixture();
  try {
    const first = server(scope.tmp, "10"); const second = server(scope.tmp, "2");
    writeFileSync(path.join(first.logs, "volume1.log"), "volume-tail");
    writeFileSync(path.join(first.logs, "master.log"), "master-tail");
    writeFileSync(path.join(first.logs, "config.json"), "secret-config");
    mkdirSync(path.join(first.directory, "data")); writeFileSync(path.join(first.directory, "data", "needle"), "synthetic-data");
    writeFileSync(path.join(second.logs, "volume9.log"), "second-volume");
    const output = collect(scope).toString("utf8");
    assert.match(output, /^seaweed-server-logs:v1\nfiles=3\nsourceBytes=35\n/u);
    assert.ok(output.indexOf("seaweedfs_volume_server_it_10/logs/master.log") < output.indexOf("seaweedfs_volume_server_it_2/logs/volume9.log"));
    assert.match(output, /master-tail/u); assert.match(output, /volume-tail/u); assert.match(output, /second-volume/u);
    assert.doesNotMatch(output, /secret-config|synthetic-data|config\.json|\/data/u);
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});

test("collector reports missing server logs without reading other tmp entries", () => {
  const scope = fixture();
  try {
    mkdirSync(path.join(scope.tmp, "cache")); writeFileSync(path.join(scope.tmp, "cache", "private"), "ignored");
    const withoutLogs = path.join(scope.tmp, "seaweedfs_volume_server_it_1"); mkdirSync(withoutLogs);
    assert.equal(collect(scope).toString("utf8"), "seaweed-server-logs:v1\nfiles=0\nsourceBytes=0\n");
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});

test("collector refuses every filesystem access until group absence is explicit", () => {
  for (const groupAbsent of [false, undefined, null, "true"]) {
    assert.throws(() => collectServerLogs("Z:/does-not-exist", { root: "Z:/also-missing", groupAbsent }), /seaweed_server_logs_group_not_absent/u);
  }
});

test("collector rejects linked root, work, server, logs, and leaf boundaries without reading sentinels", () => {
  const cases = ["root", "work", "server", "logs", "leaf"];
  for (const boundary of cases) {
    const scope = fixture(); const external = mkdtempSync(path.join(tmpdir(), "seaweed-server-external-"));
    try {
      const sentinel = path.join(external, "sentinel"); writeFileSync(sentinel, "outside");
      if (boundary === "root") {
        const alias = `${scope.root}-alias`; symlinkSync(scope.root, alias, process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => collectServerLogs(path.join(alias, WORK_NAME), { root: alias, groupAbsent: true }), /seaweed_server_logs_path_invalid/u);
        rmSync(alias, { force: true });
      } else if (boundary === "work") {
        rmSync(scope.workRoot, { recursive: true }); symlinkSync(external, scope.workRoot, process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => collect(scope), /seaweed_server_logs_path_invalid/u);
      } else if (boundary === "server") {
        symlinkSync(external, path.join(scope.tmp, "seaweedfs_volume_server_it_1"), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => collect(scope), /seaweed_server_logs_path_invalid/u);
      } else if (boundary === "logs") {
        const directory = path.join(scope.tmp, "seaweedfs_volume_server_it_1"); mkdirSync(directory);
        symlinkSync(external, path.join(directory, "logs"), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => collect(scope), /seaweed_server_logs_path_invalid/u);
      } else {
        const target = server(scope.tmp).logs; symlinkSync(sentinel, path.join(target, "master.log"), "file");
        assert.throws(() => collect(scope), /seaweed_server_log_invalid/u);
      }
      assert.equal(readFileSync(sentinel, "utf8"), "outside");
    } finally { rmSync(scope.root, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
  }
});

test("collector rejects invalid server names, matching non-files, hardlinks, and file-count overflow", () => {
  const invalid = fixture();
  try {
    mkdirSync(path.join(invalid.tmp, `seaweedfs_volume_server_it_${"9".repeat(129)}`));
    assert.throws(() => collect(invalid), /seaweed_server_logs_entry_invalid/u);
  } finally { rmSync(invalid.root, { recursive: true, force: true }); }

  const invalidLog = fixture();
  try {
    const logs = server(invalidLog.tmp).logs; writeFileSync(path.join(logs, `volume${"9".repeat(129)}.log`), "not-read");
    assert.throws(() => collect(invalidLog), /seaweed_server_logs_entry_invalid/u);
  } finally { rmSync(invalidLog.root, { recursive: true, force: true }); }

  const nonregular = fixture();
  try {
    const logs = server(nonregular.tmp).logs; mkdirSync(path.join(logs, "master.log"));
    assert.throws(() => collect(nonregular), /seaweed_server_log_invalid/u);
  } finally { rmSync(nonregular.root, { recursive: true, force: true }); }

  const hardlinked = fixture();
  try {
    const logs = server(hardlinked.tmp).logs; const external = path.join(hardlinked.root, "external");
    writeFileSync(external, "outside"); linkSync(external, path.join(logs, "volume1.log"));
    assert.throws(() => collect(hardlinked), /seaweed_server_log_invalid/u);
    assert.equal(readFileSync(external, "utf8"), "outside");
  } finally { rmSync(hardlinked.root, { recursive: true, force: true }); }

  const overflow = fixture();
  try {
    const logs = server(overflow.tmp).logs;
    for (let index = 0; index <= serverLogLimits.files; index += 1) writeFileSync(path.join(logs, `volume${index}.log`), "x");
    assert.throws(() => collect(overflow), /seaweed_server_logs_file_limit_exceeded/u);
  } finally { rmSync(overflow.root, { recursive: true, force: true }); }
});

test("collector retains bounded tails with explicit per-file and aggregate truncation metadata", () => {
  const single = fixture();
  try {
    const logs = server(single.tmp).logs; const prefix = Buffer.alloc(32, 0x61); const tail = Buffer.alloc(serverLogLimits.perFileBytes, 0x7a);
    writeFileSync(path.join(logs, "master.log"), Buffer.concat([prefix, tail]));
    const output = collect(single);
    assert.ok(output.length <= serverLogLimits.outputBytes);
    assert.match(output.subarray(0, 200).toString("utf8"), /retainedBytes=1048576 truncated=true/u);
    assert.deepEqual(output.subarray(output.length - tail.length - 1, output.length - 1), tail);
  } finally { rmSync(single.root, { recursive: true, force: true }); }

  const aggregate = fixture();
  try {
    const logs = server(aggregate.tmp).logs;
    for (let index = 0; index < 9; index += 1) writeFileSync(path.join(logs, `volume${index}.log`), Buffer.alloc(serverLogLimits.perFileBytes, 0x30 + index));
    const output = collect(aggregate); const text = output.toString("utf8");
    assert.ok(output.length <= serverLogLimits.outputBytes);
    assert.equal((text.match(/truncated=true/g) ?? []).length, 9);
    for (let index = 0; index < 9; index += 1) assert.match(text, new RegExp(`volume${index}\\.log`, "u"));
  } finally { rmSync(aggregate.root, { recursive: true, force: true }); }
});
