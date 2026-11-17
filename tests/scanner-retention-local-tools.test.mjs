import assert from "node:assert/strict";
import fs, { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SCANNER_RETENTION as P, sha256 } from "../scripts/scanner/retention-policy.mjs";
import { assertScannerRetentionToolFile } from "../scripts/scanner/retention-restore.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "scanner-tool-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "tool"); const alias = path.join(root, "alias");
  const bytes = Buffer.from("synthetic tool bytes\n"); writeFileSync(file, bytes);
  return { root, file, alias, bytes, expected: { bytes: bytes.length, sha256: sha256(bytes) } };
}

function replaceBuiltin(t, name, implementation) {
  t.mock.method(fs, name, implementation); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test("only the reviewed tar policy binds the second installed-tool name", () => {
  assert.equal(P.local.tar.path, "C:/Windows/System32/tar.exe");
  assert.equal(P.local.tar.hardlinkPath,
    "C:/Windows/WinSxS/amd64_bsdtar_31bf3856ad364e35_10.0.22621.3810_none_35e98cf4e7b7317f/tar.exe");
  for (const tool of [P.local.node, P.local.powershell, P.local.wrapper, P.local.helper]) {
    assert.equal(Object.hasOwn(tool, "hardlinkPath"), false);
  }
});

test("single-link tools pass; two real links require the explicitly bound second name", (t) => {
  const f = fixture(t);
  assertScannerRetentionToolFile(f.file, f.expected);
  linkSync(f.file, f.alias);
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected), /tool_identity/u);
  assertScannerRetentionToolFile(f.file, f.expected, f.alias);
});

test("missing, extra and duplicate normalized aliases refuse", (t) => {
  const f = fixture(t);
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, f.alias), /tool_identity/u);
  linkSync(f.file, f.alias);
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, f.file), /tool_unbound/u);
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected,
    path.join(f.root, "unused", "..", "tool")), /tool_unbound/u);
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, "relative"), /tool_unbound/u);
  linkSync(f.file, path.join(f.root, "unbound-third-name"));
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, f.alias), /tool_identity/u);
});

test("same-content distinct files are not the bound hardlink", (t) => {
  const f = fixture(t); linkSync(f.file, path.join(f.root, "actual-alias"));
  writeFileSync(f.alias, f.bytes); linkSync(f.alias, path.join(f.root, "impostor-alias"));
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, f.alias), /tool_identity/u);
});

test("wrong size, digest and nonregular tools refuse even with the approved link count", (t) => {
  const f = fixture(t); linkSync(f.file, f.alias);
  for (const expected of [{ ...f.expected, bytes: f.expected.bytes + 1 }, { ...f.expected, sha256: "0".repeat(64) }]) {
    assert.throws(() => assertScannerRetentionToolFile(f.file, expected, f.alias), /tool_identity/u);
  }
  assert.throws(() => assertScannerRetentionToolFile(f.root, f.expected), /tool_identity/u);
});

test("redirected ancestors refuse for either the primary name or second name", (t) => {
  const f = fixture(t); const real = path.join(f.root, "real"); const redirected = path.join(f.root, "redirected");
  mkdirSync(real); const alias = path.join(real, "alias"); linkSync(f.file, alias);
  symlinkSync(real, redirected, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, path.join(redirected, "alias")), /tool_identity/u);
  assert.throws(() => assertScannerRetentionToolFile(path.join(redirected, "alias"), f.expected, f.file), /tool_identity/u);
});

test("a real link-count mutation during hashing refuses", (t) => {
  const f = fixture(t); linkSync(f.file, f.alias); const read = fs.readFileSync;
  replaceBuiltin(t, "readFileSync", (...args) => {
    const value = read(...args);
    if (typeof args[0] === "number") linkSync(f.file, path.join(f.root, "created-during-hash"));
    return value;
  });
  assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, f.alias), /tool_identity/u);
});

test("late descriptor identity or link-count drift refuses after alias inspection", (t) => {
  const f = fixture(t); linkSync(f.file, f.alias); const stat = fs.fstatSync;
  let calls = 0; let field = "ino"; let changedCall = 4;
  replaceBuiltin(t, "fstatSync", (...args) => {
    const value = stat(...args); calls++;
    if (calls === changedCall) value[field]++;
    return value;
  });
  for (changedCall of [4, 5]) {
    for (field of ["ino", "dev", "size", "mtimeMs", "ctimeMs", "nlink"]) {
      calls = 0;
      assert.throws(() => assertScannerRetentionToolFile(f.file, f.expected, f.alias), /tool_identity/u);
      assert.equal(calls, changedCall);
    }
  }
});
