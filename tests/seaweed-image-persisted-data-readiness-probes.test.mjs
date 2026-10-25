import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { TEST_ONLY_persistedDataReadinessScripts } from
  "../scripts/seaweed-image/persisted-data-readiness.mjs";

const fid = "7,0100000000";
const objectPath = "/buckets/aw-raw/restart-proof";
const scripts = TEST_ONLY_persistedDataReadinessScripts(objectPath, fid);
const linuxTest = process.platform === "linux" ? test : test.skip;

const curlShim = `#!/bin/sh
set -eu
printf '%s\\n' "$@" > "$AW_CURL_ARGUMENTS"
output=''
while test "$#" -gt 0; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --write-out|--connect-timeout|--max-time|--proto|--max-redirs|--max-filesize) shift 2 ;;
    --silent) shift ;;
    --*) exit 97 ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$output" > "$AW_CURL_OUTPUT_PATH"
printf '%s\\n' "$url" > "$AW_CURL_URL"
case "$AW_CURL_MODE" in
  success)
    printf '%s' "$AW_CURL_BODY" > "$output"
    printf '%s' "\${AW_CURL_STATUS:-200}"
    ;;
  stderr)
    printf '%s' "$AW_CURL_BODY" > "$output"
    printf '%s\\n' 'curl diagnostic that must stay private' >&2
    printf '%s' '200'
    ;;
  transport)
    : > "$output"
    printf '%s' '000'
    exit 7
    ;;
  oversized)
    head -c 65537 /dev/zero | tr '\\000' x > "$output"
    printf '%s' '200'
    ;;
  *) exit 98 ;;
esac
`;

function executeProbe(script, { mode = "success", body = "", status = "200" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aw-readiness-probe-test-"));
  const shim = join(root, "curl");
  const argumentsPath = join(root, "arguments");
  const outputPath = join(root, "output-path");
  const urlPath = join(root, "url");
  writeFileSync(shim, curlShim, { mode: 0o700 });
  chmodSync(shim, 0o700);
  const result = spawnSync("/bin/sh", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH ?? ""}`,
      AW_CURL_ARGUMENTS: argumentsPath,
      AW_CURL_BODY: body,
      AW_CURL_MODE: mode,
      AW_CURL_OUTPUT_PATH: outputPath,
      AW_CURL_STATUS: status,
      AW_CURL_URL: urlPath,
    },
  });
  const evidence = {
    arguments: readFileSync(argumentsPath, "utf8").trimEnd().split("\n"),
    outputPath: readFileSync(outputPath, "utf8").trim(),
    url: readFileSync(urlPath, "utf8").trim(),
  };
  return { cleanup: () => rmSync(root, { recursive: true, force: true }), evidence, result };
}

linuxTest("metadata probe emits the exact response framing and body", (context) => {
  const body = '{"FileSize":14,"Content":null,"chunks":[]}';
  const execution = executeProbe(scripts[0], { body });
  context.after(execution.cleanup);
  assert.equal(execution.result.status, 0);
  assert.equal(execution.result.stderr, "");
  assert.equal(execution.result.stdout, `AW_METADATA_V1\n0\n200\n${body}`);
});

linuxTest("lookup probe emits the exact response framing and body", (context) => {
  const body = '{"volumeOrFileId":"7","locations":[]}';
  const execution = executeProbe(scripts[1], { body });
  context.after(execution.cleanup);
  assert.equal(execution.result.status, 0);
  assert.equal(execution.result.stderr, "");
  assert.equal(execution.result.stdout, `AW_LOOKUP_V1\n0\n200\n${body}`);
});

linuxTest("direct probe reports the exact byte count and SHA-256 of downloaded data", (context) => {
  const body = "persisted-data";
  const digest = createHash("sha256").update(body).digest("hex");
  const execution = executeProbe(scripts[2], { body });
  context.after(execution.cleanup);
  assert.equal(execution.result.status, 0);
  assert.equal(execution.result.stderr, "");
  assert.equal(execution.result.stdout, `AW_DIRECT_V1\n0\n200\n${Buffer.byteLength(body)}\n${digest}\n`);
});

linuxTest("probe suppresses curl diagnostics without changing successful framing", (context) => {
  const body = "metadata";
  const execution = executeProbe(scripts[0], { body, mode: "stderr" });
  context.after(execution.cleanup);
  assert.equal(execution.result.status, 0);
  assert.equal(execution.result.stderr, "");
  assert.equal(execution.result.stdout, `AW_METADATA_V1\n0\n200\n${body}`);
});

linuxTest("probe frames a failed transport without losing the curl exit code", (context) => {
  const transport = executeProbe(scripts[0], { mode: "transport" });
  context.after(transport.cleanup);
  assert.equal(transport.result.status, 0);
  assert.equal(transport.result.stdout, "AW_METADATA_V1\n7\n000\n");
});

linuxTest("probe frames a failed HTTP status independently from transport success", (context) => {
  const status = executeProbe(scripts[0], { body: "unavailable", status: "503" });
  context.after(status.cleanup);
  assert.equal(status.result.status, 0);
  assert.equal(status.result.stdout, "AW_METADATA_V1\n0\n503\nunavailable");
});

linuxTest("probe replaces an over-limit response with the bounded marker", (context) => {
  const execution = executeProbe(scripts[1], { mode: "oversized" });
  context.after(execution.cleanup);
  assert.equal(execution.result.status, 0);
  assert.equal(execution.result.stderr, "");
  assert.equal(execution.result.stdout, "AW_OVERSIZED_V1\n");
});

linuxTest("probes invoke curl only for their fixed loopback destinations without redirects", (context) => {
  const expectedUrls = [
    "http://127.0.0.1:8888/buckets/aw-raw/restart-proof?metadata=true",
    "http://127.0.0.1:9333/dir/lookup?volumeId=7&read=yes",
    "http://127.0.0.1:8080/7,0100000000",
  ];
  const executions = scripts.map((script) => executeProbe(script, { body: "data" }));
  for (const execution of executions) context.after(execution.cleanup);
  assert.deepEqual(executions.map(({ evidence }) => evidence.url), expectedUrls);
  for (const { arguments: arguments_ } of executions.map(({ evidence }) => evidence)) {
    assert.equal(arguments_.filter((argument) => argument.startsWith("http://")).length, 1);
    assert.equal(arguments_.includes("--location"), false);
    assert.deepEqual(arguments_.slice(arguments_.indexOf("--proto"), arguments_.indexOf("--proto") + 2),
      ["--proto", "=http"]);
    assert.deepEqual(arguments_.slice(arguments_.indexOf("--max-redirs"), arguments_.indexOf("--max-redirs") + 2),
      ["--max-redirs", "0"]);
  }
});

linuxTest("probe removes its private temporary directory after execution", (context) => {
  const execution = executeProbe(scripts[2], { body: "data" });
  context.after(execution.cleanup);
  assert.equal(execution.result.status, 0);
  assert.equal(existsSync(dirname(execution.evidence.outputPath)), false);
});
