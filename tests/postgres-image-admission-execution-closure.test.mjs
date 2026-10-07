import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import inventory from "../infra/postgres-image/admission-inventory.json" with { type: "json" };

const ORIGINAL_FILES_SHA256 = "ba6df81ae377d4d2e52ebf83d003ac57cd538f8423955696f62be020e5c1206d";
const GENERATION_THREE_ADDITIONS = Object.freeze([
  { path: "infra/seaweed-image/base-config.json", size: 13_676,
    sha256: "31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927" },
  { path: "infra/seaweed/required-tests.json", size: 7_120,
    sha256: "eb50caadd818336196a8e4d4f29ea82971c154140656b83569e6cf6b8808aa09" },
  { path: "tests/fixtures/seaweed-source/upstream/go.sum", size: 289_547,
    sha256: "d0da511e41d4013cbcc31d959d7533edb8312cfefa8722919085d5cbc6eb8fe2" },
]);
const ENTRYPOINTS = Object.freeze([
  "scripts/postgres-image/admitted-postgres.mjs",
  "scripts/postgres-image/admission-authority.mjs",
  "scripts/postgres-image/admission-archive-observation.mjs",
  "scripts/postgres-image/admission-observability.mjs",
]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Buffer.from(`${JSON.stringify(value)}\n`);

function materialize(root, pins) {
  for (const pin of pins) {
    const source = readFileSync(pin.path);
    assert.equal(source.length, pin.size, pin.path);
    assert.equal(sha256(source), pin.sha256, pin.path);
    const target = path.join(root, ...pin.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, { flag: "wx", mode: 0o600 });
    const copied = readFileSync(target);
    assert.equal(copied.length, pin.size, pin.path);
    assert.equal(sha256(copied), pin.sha256, pin.path);
  }
}

function listFiles(root, directory = root) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, absolute));
    else result.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return result.sort();
}

function importEntry(root, entry) {
  const source = [
    "import {pathToFileURL} from 'node:url';",
    "import path from 'node:path';",
    `const entry=${JSON.stringify(entry)};`,
    "await import(pathToFileURL(path.resolve(entry)).href);",
    "process.stdout.write(JSON.stringify({state:'LOADED',entry})+'\\n');",
  ].join("");
  return spawnSync(process.execPath,
    ["--no-warnings", "--disable-proto=throw", "--input-type=module", "--eval", source], {
      cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
      windowsHide: true, env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
    });
}

test("the authenticated generation-three execution closure loads each entry from only its 74 pinned files", t => {
  assert.equal(process.versions.node, "22.23.2");
  const pins = inventory.generationRoot.executionFiles;
  assert.equal(pins.length, 74);
  assert.deepEqual(pins.map(item => item.path), pins.map(item => item.path).sort());
  assert.equal(new Set(pins.map(item => item.path)).size, pins.length);
  assert.deepEqual(ENTRYPOINTS.every(entry => pins.some(pin => pin.path === entry)), true);
  for (const pin of GENERATION_THREE_ADDITIONS) {
    assert.deepEqual(pins.find(item => item.path === pin.path), pin);
  }

  const additions = new Set(GENERATION_THREE_ADDITIONS.map(item => item.path));
  const original = pins.filter(pin => !additions.has(pin.path));
  assert.equal(original.length, 71);
  assert.equal(sha256(canonical(original)), ORIGINAL_FILES_SHA256);

  const parent = mkdtempSync(path.join(os.tmpdir(), "postgres-admission-execution-closure-"));
  const resolvedParent = realpathSync(parent); const resolvedTemporaryRoot = realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolvedParent), resolvedTemporaryRoot);
  t.after(() => {
    assert.equal(realpathSync(parent), resolvedParent);
    assert.equal(path.dirname(resolvedParent), resolvedTemporaryRoot);
    rmSync(resolvedParent, { recursive: true, force: true });
  });
  const incomplete = path.join(parent, "original-71"); const complete = path.join(parent, "complete-74");
  mkdirSync(incomplete, { mode: 0o700 }); mkdirSync(complete, { mode: 0o700 });
  materialize(incomplete, original); materialize(complete, pins);

  const beforeIncomplete = listFiles(incomplete); const failed = importEntry(incomplete, ENTRYPOINTS[0]);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /(?:ENOENT|ERR_MODULE_NOT_FOUND)/u);
  assert.match(failed.stderr, /base-config\.json/u);
  assert.deepEqual(listFiles(incomplete), beforeIncomplete);

  for (const omitted of GENERATION_THREE_ADDITIONS) {
    const directory = path.join(parent, `without-${path.basename(omitted.path).replaceAll(".", "-")}`);
    mkdirSync(directory, { mode: 0o700 });
    materialize(directory, pins.filter(pin => pin.path !== omitted.path));
    const before = listFiles(directory); const missing = importEntry(directory, ENTRYPOINTS[0]);
    assert.notEqual(missing.status, 0, omitted.path);
    assert.match(missing.stderr, /(?:ENOENT|ERR_MODULE_NOT_FOUND)/u, omitted.path);
    assert.match(missing.stderr, new RegExp(path.basename(omitted.path).replaceAll(".", "\\."), "u"), omitted.path);
    assert.deepEqual(listFiles(directory), before);
  }

  const alteredDirectory = path.join(parent, "altered-pin"); mkdirSync(alteredDirectory, { mode: 0o700 });
  assert.throws(() => materialize(alteredDirectory, [
    { ...GENERATION_THREE_ADDITIONS[0], sha256: "0".repeat(64) },
  ]));
  assert.deepEqual(listFiles(alteredDirectory), []);

  for (const entry of ENTRYPOINTS) {
    const beforeComplete = listFiles(complete);
    const loaded = importEntry(complete, entry);
    assert.equal(loaded.signal, null);
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stderr, "");
    assert.deepEqual(JSON.parse(loaded.stdout), { state: "LOADED", entry });
    assert.deepEqual(listFiles(complete), beforeComplete);
  }
});
