import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { findHighConfidenceSecrets } from "../scripts/secret-patterns.mjs";

const root = process.cwd();
const secretlintBinary = fileURLToPath(new URL("../scripts/secretlint-files.mjs", import.meta.url));

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
      timeout: 10_000,
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

    assert.equal(result.status, 1, "Secretlint must report lint findings, not a fatal error.");
    for (const token of representativeTokens) {
      assert.ok(!`${result.stdout}\n${result.stderr}`.includes(token), "Diagnostic exposed a synthetic secret.");
    }
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

test("the reviewed public AWS example is exempt only in its exact immutable upstream fixture", () => {
  const file = "tests/fixtures/seaweed-source/upstream/weed/credential/credential_test.go";
  const contents = readFileSync(path.join(root, file), "utf8");
  assert.deepEqual(findHighConfidenceSecrets(contents, { file }), []);
  assert.deepEqual(findHighConfidenceSecrets(contents), ["aws-access-key"]);
  assert.deepEqual(findHighConfidenceSecrets(contents, { file: `other/${file}` }), ["aws-access-key"]);
  assert.deepEqual(findHighConfidenceSecrets(`${contents}\n`, { file }), ["aws-access-key"]);
  const anotherKey = ["AKIA", "G".repeat(16)].join("");
  assert.deepEqual(findHighConfidenceSecrets(`${contents}${anotherKey}`, { file }), ["aws-access-key"]);
  assert.deepEqual(findHighConfidenceSecrets(contents.replace(["AKIA", "IOSFODNN7EXAMPLE"].join(""), anotherKey), { file }), ["aws-access-key"]);
  assert.deepEqual(findHighConfidenceSecrets(`${contents}${["AKIA", "IOSFODNN7EXAMPLE"].join("")}`, { file }), ["aws-access-key"]);
  assert.deepEqual(findHighConfidenceSecrets(`${contents}${["ghp", "B".repeat(36)].join("_")}`, { file }).sort(), ["aws-access-key", "github-token"]);
  const result = runSecretlint(path.join(root, file));
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("runner preserves fatal config and missing-target exit status", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "auto-world-secretlint-"));
  try {
    const fixture = path.join(directory, "benign.txt");
    writeFileSync(fixture, "benign\n");
    for (const contents of ["{broken", JSON.stringify({ rules: [{ id: "nonexistent-secretlint-rule" }] })]) {
      const config = path.join(directory, "config.json");
      writeFileSync(config, contents);
      const result = spawnSync(process.execPath, [secretlintBinary, "--secretlintrc", config, fixture], { encoding: "utf8", timeout: 10_000 });
      assert.equal(result.status, 2, result.stdout || result.stderr);
    }
    assert.equal(runSecretlint(path.join(directory, "absent.txt")).status, 2);
    const missingConfig = spawnSync(process.execPath, [secretlintBinary, "--secretlintrc", path.join(directory, "absent.json"), fixture], { encoding: "utf8", timeout: 10_000 });
    assert.equal(missingConfig.status, 2);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("all-file high-confidence pass rejects a Git candidate excluded by recommended rules", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "auto-world-secretlint-"));
  const token = ["ghp", "Q".repeat(36)].join("_");
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    writeFileSync(path.join(directory, ".secretlintignore"), "ignored.txt\n");
    writeFileSync(path.join(directory, "ignored.txt"), token);
    const result = spawnSync(process.execPath, [path.join(root, "scripts/check-secrets.mjs")], { cwd: directory, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /High-confidence secret signatures detected/u);
    assert.match(result.stderr, /ignored\.txt: github-token/u);
    assert.ok(!`${result.stdout}\n${result.stderr}`.includes(token));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
