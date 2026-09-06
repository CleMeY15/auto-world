import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { findHighConfidenceSecrets } from "../scripts/secret-patterns.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const secretlintPackage = require.resolve("secretlint/package.json");
const secretlintBinary = path.join(
  path.dirname(secretlintPackage),
  "bin",
  "secretlint.js",
);

const runSecretlint = (file) =>
  spawnSync(
    process.execPath,
    [
      secretlintBinary,
      "--secretlintrc",
      path.join(root, ".secretlintrc.json"),
      file,
    ],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

test("recommended secret rules accept benign configuration", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "auto-world-secretlint-"));
  const fixture = path.join(directory, "benign.env");

  try {
    writeFileSync(fixture, "SERVICE_URL=http://localhost:3000\n", "utf8");
    const result = runSecretlint(fixture);

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("recommended secret rules reject representative provider tokens", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "auto-world-secretlint-"));
  const fixture = path.join(directory, "leaked.env");
  const representativeTokens = [
    ["sk", "proj", "A".repeat(48)].join("-"),
    ["ghp", "B".repeat(36)].join("_"),
    ["xoxb", "123456789012", "123456789012", "C".repeat(24)].join("-"),
  ];

  try {
    writeFileSync(fixture, representativeTokens.join("\n"), "utf8");
    const result = runSecretlint(fixture);

    assert.notEqual(result.status, 0, "Secretlint accepted representative tokens.");
    assert.match(`${result.stdout}\n${result.stderr}`, /leaked\.env/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("raw high-confidence signatures cover modern tokens in any text format", () => {
  const representativeTokens = [
    ["sk", "proj", "D".repeat(48)].join("-"),
    ["github", "pat", "E".repeat(40)].join("_"),
    ["xoxb", "123456789012", "F".repeat(32)].join("-"),
  ];

  assert.deepEqual(
    findHighConfidenceSecrets(representativeTokens.join("\n")).sort(),
    ["github-token", "openai-api-key", "slack-token"],
  );
  assert.deepEqual(
    findHighConfidenceSecrets("SERVICE_URL=http://localhost:3000\n"),
    [],
  );
});
