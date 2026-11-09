import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const recipe = readFileSync(path.join(repositoryRoot, "infra/managed-images/Dockerfile.postgres"), "utf8");
const linux = process.platform === "linux";
const outputLiteral = "/out/evidence/module-proxy-payloads.tsv";
const specifications = [
  ["github.com/moby/sys/user", "v0.4.1", "info", "cache/download/github.com/moby/sys/user/@v/v0.4.1.info"],
  ["github.com/moby/sys/user", "v0.4.1", "mod", "cache/download/github.com/moby/sys/user/@v/v0.4.1.mod"],
  ["github.com/moby/sys/user", "v0.4.1", "zip", "cache/download/github.com/moby/sys/user/@v/v0.4.1.zip"],
  ["golang.org/x/sys", "v0.1.0", "info", "cache/download/golang.org/x/sys/@v/v0.1.0.info"],
  ["golang.org/x/sys", "v0.1.0", "mod", "cache/download/golang.org/x/sys/@v/v0.1.0.mod"],
  ["golang.org/x/sys", "v0.1.0", "zip", "cache/download/golang.org/x/sys/@v/v0.1.0.zip"],
];

function measurementLeaf() {
  const runStart = recipe.indexOf("RUN set -eu;");
  const runEnd = recipe.indexOf("\n\nRUN --network=none", runStart);
  assert.ok(runStart >= 0 && runEnd > runStart, "the first Gosu RUN is present");
  const runShell = recipe.slice(runStart, runEnd)
    .replace(/^RUN /u, "")
    .replace(/ \\\r?\n\s+/gu, " ");
  const startMarker = `module_proxy_output=${outputLiteral};`;
  const endMarker = 'mv "$module_proxy_temporary" "$module_proxy_output";';
  const start = runShell.indexOf(startMarker);
  const end = runShell.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "the closed measurement leaf is present");
  return runShell.slice(start, end + endMarker.length);
}

const leaf = measurementLeaf();

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-gosu-module-payloads-"));
  for (const [module, version, kind, relative] of specifications) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(`actual proxy payload for ${module} ${version} ${kind}\n`));
  }
  return root;
}

function payloadPath(root, index) {
  return path.join(root, specifications[index][3]);
}

function runMeasurement(root, environment = {}) {
  const output = path.join(root, "module-proxy-payloads.tsv");
  assert.equal(leaf.split(outputLiteral).length - 1, 1, "only the fixed output path is rewritten by the test");
  const command = leaf.replace(outputLiteral, shellQuote(output));
  const result = spawnSync("/bin/sh", ["-eu", "-c", command], {
    encoding: "utf8",
    env: { ...process.env, GOMODCACHE: root, ...environment },
    timeout: 30_000,
  });
  return { output, result };
}

function expectedTsv(root) {
  return Buffer.from(specifications.map(([module, version, kind, relative]) => {
    const bytes = readFileSync(path.join(root, relative));
    return `${module}\t${version}\t${kind}\t${bytes.length}\t${createHash("sha256").update(bytes).digest("hex")}\n`;
  }).join(""), "ascii");
}

function assertRefused(root, environment = {}) {
  const { output, result } = runMeasurement(root, environment);
  assert.notEqual(result.status, 0, `measurement unexpectedly succeeded: ${result.stderr}`);
  assert.throws(() => readFileSync(output), { code: "ENOENT" });
}

test("the Gosu recipe measures one closed, ordered six-file proxy set between verified download and offline use", () => {
  assert.equal([...leaf.matchAll(/'(?:github\.com\/moby\/sys\/user|golang\.org\/x\/sys)\|v0\.(?:4\.1|1\.0)\|(?:info|mod|zip)\|cache\/download\//gu)].length, 6);
  assert.match(leaf, /stat -c '%F\|%h\|%d\|%i\|%s\|%y\|%z'/u);
  assert.doesNotMatch(leaf, /%x|atime/u);
  assert.match(leaf, /test "\$module_proxy_bytes" -le 16777216/u);
  assert.match(leaf, /test "\$module_proxy_total" -le 33554432/u);
  assert.match(leaf, /test "\$module_proxy_after" = "\$module_proxy_before"/u);
  assert.match(leaf, /printf '%s\\t%s\\t%s\\t%s\\t%s\\n'/u);
  const verify = recipe.indexOf("go mod verify");
  const inventory = recipe.indexOf("go list -m -json all");
  const measurement = recipe.indexOf("module_proxy_output=");
  const offline = recipe.indexOf("RUN --network=none");
  assert.ok(verify < inventory && inventory < measurement && measurement < offline);
  assert.equal(recipe.split(outputLiteral).length - 1, 1);
  assert.doesNotMatch(recipe, /COPY .*module-proxy-payloads\.tsv/u);
});

test("the extracted production leaf hashes the six actual files and emits exact canonical TSV bytes", { skip: !linux }, (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = expectedTsv(root);
  const { output, result } = runMeasurement(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(output), expected);
  assert.equal(expected.toString("ascii").split("\n").length, 7, "six rows and one final LF");
});

test("the extracted production leaf refuses missing, linked, non-regular and empty payloads", { skip: !linux }, async (context) => {
  const cases = [
    ["missing", (root) => unlinkSync(payloadPath(root, 0))],
    ["symlink", (root) => {
      unlinkSync(payloadPath(root, 0));
      symlinkSync(payloadPath(root, 1), payloadPath(root, 0));
    }],
    ["hard link", (root) => linkSync(payloadPath(root, 0), `${payloadPath(root, 0)}.second-link`)],
    ["FIFO", (root) => {
      unlinkSync(payloadPath(root, 0));
      const made = spawnSync("/usr/bin/mkfifo", [payloadPath(root, 0)], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
    }],
    ["empty", (root) => writeFileSync(payloadPath(root, 0), Buffer.alloc(0))],
  ];
  for (const [name, mutate] of cases) await context.test(name, (child) => {
    const root = makeFixture();
    child.after(() => rmSync(root, { recursive: true, force: true }));
    mutate(root);
    assertRefused(root);
  });
});

test("the extracted production leaf enforces both byte caps against actual sparse payloads", { skip: !linux }, async (context) => {
  await context.test("per-file cap", (child) => {
    const root = makeFixture();
    child.after(() => rmSync(root, { recursive: true, force: true }));
    truncateSync(payloadPath(root, 0), 16 * 1024 * 1024 + 1);
    assertRefused(root);
  });
  await context.test("aggregate cap", (child) => {
    const root = makeFixture();
    child.after(() => rmSync(root, { recursive: true, force: true }));
    for (let index = 0; index < 3; index += 1) truncateSync(payloadPath(root, index), 11_184_811);
    assertRefused(root);
  });
});

test("the extracted production leaf refuses a payload mutated after the real hash reaches EOF", { skip: !linux }, (context) => {
  const root = makeFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const marker = path.join(root, "mutation-done");
  const wrapper = path.join(bin, "sha256sum");
  mkdirSync(bin);
  writeFileSync(wrapper, [
    "#!/bin/sh",
    '"$REAL_SHA256SUM" "$@"',
    "status=$?",
    'if [ "$status" -eq 0 ] && [ ! -e "$MUTATION_MARKER" ]; then',
    '  : > "$MUTATION_MARKER"',
    '  printf x >> "$MUTATION_TARGET"',
    "fi",
    'exit "$status"',
    "",
  ].join("\n"));
  chmodSync(wrapper, 0o755);
  assertRefused(root, {
    MUTATION_MARKER: marker,
    MUTATION_TARGET: payloadPath(root, 0),
    PATH: `${bin}:/usr/bin:/bin`,
    REAL_SHA256SUM: "/usr/bin/sha256sum",
  });
});
