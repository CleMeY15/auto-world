import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TEST_ONLY, completeOwnedGosuScratch, formatGosuPreparationFailure } from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";

const stages = [
  "online_go_version", "online_mod_download", "online_mod_verify", "offline_go_test",
  "offline_go_build", "offline_gosu_version", "offline_go_build_info", "offline_isolation",
];
const reasons = ["spawn", "timeout", "output_limit", "signal", "exit"];
const offlineStages = ["offline_go_test", "offline_go_build", "offline_gosu_version", "offline_go_build_info"];
const fixedChildCodes = [
  "gosu_command_stage_invalid", "gosu_command_result_invalid", "gosu_offline_environment_invalid",
  "gosu_offline_identity_invalid", "gosu_offline_network_invalid", "gosu_offline_privilege_invalid",
  "gosu_offline_evidence_invalid", "gosu_tests_invalid", "gosu_tests_failed", "gosu_source_mutated",
  "gosu_version_invalid", "gosu_build_info_invalid", "gosu_build_info_vcs_invalid", "gosu_sumdb_invalid",
  "gosu_lock_identity_invalid",
];
const childCodes = [...offlineStages.flatMap((stage) => reasons.map((reason) => `gosu_command_failed_${stage}_${reason}`)), ...fixedChildCodes];
const success = () => ({ error: undefined, signal: null, status: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) });
const failure = (reason) => {
  if (reason === "spawn") return { ...success(), error: Object.assign(new Error("secret-error"), { code: "EACCES" }), signal: "SIGKILL", status: 9 };
  if (reason === "timeout") return { ...success(), error: Object.assign(new Error("secret-error"), { code: "ETIMEDOUT" }), signal: "SIGKILL", status: 9 };
  if (reason === "output_limit") return { ...success(), error: Object.assign(new Error("secret-error"), { code: "ENOBUFS" }), signal: "SIGKILL", status: 9 };
  if (reason === "signal") return { ...success(), signal: "SIGKILL", status: 9 };
  return { ...success(), status: 9 };
};
const invoke = (stage, runner) => TEST_ONLY.runCommand(stage, "secret-command", ["secret-argument"], {
  cwd: "secret-cwd", env: { SECRET_ENV: "secret-environment" }, cap: 123, timeout: 456,
}, runner);

test("all eight command stages expose five closed failure reasons without private data", () => {
  assert.equal(stages.length, 8);
  for (const stage of stages) for (const reason of reasons) {
    const result = failure(reason); result.stdout = Buffer.from("secret-stdout"); result.stderr = Buffer.from("secret-stderr");
    assert.throws(() => invoke(stage, () => result), (error) => {
      assert.equal(error.message, `gosu_command_failed_${stage}_${reason}`);
      for (const secret of ["secret-command", "secret-argument", "secret-cwd", "secret-environment", "secret-stdout", "secret-stderr", "secret-error", "SIGKILL", "EACCES"]) assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
});

test("unknown stages fail before runner invocation and thrown runners classify as spawn", () => {
  let invoked = false;
  assert.throws(() => invoke("unknown", () => { invoked = true; return success(); }), /^Error: gosu_command_stage_invalid$/u);
  assert.equal(invoked, false);
  assert.throws(() => invoke("online_go_version", () => { throw new Error("secret-thrown"); }), /^Error: gosu_command_failed_online_go_version_spawn$/u);
});

test("error precedence is timeout then output limit then spawn before signal and exit", () => {
  for (const [code, reason] of [["ETIMEDOUT", "timeout"], ["ENOBUFS", "output_limit"], ["EACCES", "spawn"]]) {
    const error = Object.assign(new Error("secret"), { code });
    const results = [
      { error },
      { error, signal: undefined, status: undefined, stdout: null, stderr: null },
      { error, signal: null, status: null, stdout: null, stderr: null },
      { error, signal: { hostile: true }, status: "hostile", stdout: "malformed", stderr: 42 },
      { ...success(), error, signal: "SIGTERM", status: 17, stdout: "malformed", stderr: null },
    ];
    for (const result of results) assert.throws(() => invoke("online_mod_download", () => result), new RegExp(`^Error: gosu_command_failed_online_mod_download_${reason}$`, "u"));
  }
  assert.throws(() => invoke("online_mod_verify", () => ({ ...success(), signal: "SIGTERM", status: 17 })), /^Error: gosu_command_failed_online_mod_verify_signal$/u);
});

test("success and result shapes are strict and separate from command failure", () => {
  assert.deepEqual(invoke("online_go_version", success), { status: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) });
  const malformed = [
    undefined, null, [], {}, { ...success(), error: null }, { ...success(), error: "error" },
    { ...success(), signal: "" }, { ...success(), signal: 9 }, { ...success(), status: null },
    { ...success(), status: 1.5 }, { ...success(), stdout: "ok" }, { ...success(), stderr: new Uint8Array() },
  ];
  for (const result of malformed) assert.throws(() => invoke("online_go_version", () => result), /^Error: gosu_command_result_invalid$/u);
});

test("offline isolation propagates every and only exact allowlisted child line on ordinary exit", () => {
  assert.equal(childCodes.length, 35);
  for (const code of childCodes) {
    assert.throws(() => invoke("offline_isolation", () => ({ ...failure("exit"), stdout: Buffer.from("ignored-secret"), stderr: Buffer.from(`${code}\n`, "ascii") })), new RegExp(`^Error: ${code}$`, "u"));
  }
  const maximum = Math.max(...childCodes.map((code) => Buffer.byteLength(`${code}\n`, "ascii")));
  const hostile = [
    Buffer.from("gosu_unknown\n"), Buffer.from("gosu_\n"), Buffer.from(`${childCodes[0]}\ngosu_cleanup_failed\n`),
    Buffer.from(`${childCodes[0]}\r\n`), Buffer.from(`\x1b[31m${childCodes[0]}\n`), Buffer.from(`${childCodes[0]}\0\n`),
    Buffer.from(`${childCodes[0]}é\n`), Buffer.from(childCodes[0]), Buffer.from(`${childCodes[0]}\n\n`),
    Buffer.from(`x${childCodes[0]}\n`), Buffer.from(`${childCodes[0]}x\n`), Buffer.alloc(maximum + 1, 0x61),
  ];
  for (const stderr of hostile) assert.throws(() => invoke("offline_isolation", () => ({ ...failure("exit"), stderr })), /^Error: gosu_command_failed_offline_isolation_exit$/u);
  for (const reason of ["spawn", "timeout", "output_limit", "signal"]) {
    assert.throws(() => invoke("offline_isolation", () => ({ ...failure(reason), stderr: Buffer.from(`${childCodes[0]}\n`) })), new RegExp(`^Error: gosu_command_failed_offline_isolation_${reason}$`, "u"));
  }
});

test("cleanup formatting preserves one primary and adds one marker only for parent cleanup failure", async () => {
  const primary = new Error("gosu_command_failed_offline_isolation_exit");
  const cleanup = new Error("gosu_cleanup_failed");
  assert.equal(formatGosuPreparationFailure(primary), "gosu_command_failed_offline_isolation_exit\n");
  assert.equal(formatGosuPreparationFailure(new AggregateError([primary, cleanup], primary.message)), "gosu_command_failed_offline_isolation_exit\ngosu_cleanup_failed\n");
  await assert.rejects(completeOwnedGosuScratch(primary, "invalid", "invalid"), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(formatGosuPreparationFailure(error), "gosu_command_failed_offline_isolation_exit\ngosu_cleanup_failed\n");
    return true;
  });
});

test("production sites have eight exact labels and receipt helper closure remains three fixed files", async () => {
  const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url), "utf8");
  const labels = [...source.matchAll(/\brun\("([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(labels, stages);
  assert.equal(source.includes("allowFailure"), false);
  const controls = await readFile(new URL("../scripts/postgres-image/gosu-derivative-controls-v1.mjs", import.meta.url), "utf8");
  assert.match(controls, /helper: \{ build: await fileIdentity\(buildFile\), controls: await fileIdentity\(scriptFile\), archives: await fileIdentity\(archivesFile\) \}/u);
});
