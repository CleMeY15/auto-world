import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { selectSecretlintFiles } from "../scripts/secretlint-file-selection.mjs";

const runner = fileURLToPath(new URL("../scripts/secretlint-files.mjs", import.meta.url));
const config = fileURLToPath(new URL("../.secretlintrc.json", import.meta.url));
const posix = (file) => path.sep === "\\" ? file.replaceAll("\\", "/") : file;
function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "auto-world-secret-selection-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (name, content = "benign\n") => {
    const file = path.join(cwd, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  return { cwd, write };
}
const run = (cwd, files, configPath = config) => spawnSync(process.execPath,
  [runner, "--secretlintrc", configPath, ...files], { cwd, encoding: "utf8", timeout: 10_000 });

test("literal selector preserves captured upstream cascade membership with stable input order", async (t) => {
  const { cwd, write } = fixture(t);
  // Expected membership captured from the original 13.0.5 CLI on base f630339b.
  // Upstream asynchronous completion order varied on repeat; ours follows input.
  write(".secretlintignore", "*.secret\n!same.txt\nnode_modules\nignored/\n.secretlintrc.json\n");
  write(".gitignore", "same.txt\n!root.secret\n!.secretlintrc.json\n");
  write("nested/.secretlintignore", "!keep.secret\n*.txt\n");
  write("nested/.gitignore", "!nested.txt\n/anchored\n\\#hash\n\\!bang\nspace\\ \n");
  write("ignored/.secretlintignore", "!keep.txt\n");
  write("..config/.secretlintignore", "local.txt\n");
  const files = ["root.secret", "same.txt", "node_modules/a.txt", "ordinary.txt",
    "nested/drop.secret", "nested/keep.secret", "nested/nested.txt", "nested/anchored",
    "nested/#hash", "nested/!bang", "nested/space ", "nested/deep/anchored", "ignored/keep.txt",
    "ignored/drop.txt", "..config/local.txt", "[param].txt", "(group).txt", "{brace}.txt",
    "space name.txt", "unicodé.txt", "!literal.txt", ".dot.txt", "binary.dat"];
  // Windows does not represent trailing spaces faithfully; separate portable
  // corpus excludes that filename while retaining escaped-space rules above.
  const nativeFiles = process.platform === "win32" ? files.filter((file) => file !== "nested/space ") : files;
  for (const file of nativeFiles) write(file, file === "binary.dat" ? Buffer.from([0, 1, 2]) : "benign\n");
  write(".secretlintrc.json");
  const selected = await selectSecretlintFiles([".secretlintrc.json", ...nativeFiles], { cwd });
  const expected = [".secretlintrc.json", "root.secret", "ordinary.txt", "nested/keep.secret",
    "nested/nested.txt", "nested/deep/anchored", "ignored/keep.txt", "..config/local.txt",
    "[param].txt", "(group).txt", "{brace}.txt", "space name.txt", "unicodé.txt",
    "!literal.txt", ".dot.txt", "binary.dat"];
  assert.deepEqual(selected, { ok: true, items: expected.map((file) => posix(path.join(cwd, file))) });
});

test("duplicates, external paths, glob-shaped names and native separators remain literal", async (t) => {
  const { cwd, write } = fixture(t);
  const names = ["[param].txt", "(group).txt", "{brace}.txt", "!literal.txt", "--option.txt", "nested/file.txt"];
  if (process.platform !== "win32") names.push("what?.txt", "star*.txt", "back\\slash.txt");
  names.forEach((file) => write(file));
  const input = names.map((name) => path.join(cwd, name));
  const result = await selectSecretlintFiles([...input, ...input, config], { cwd });
  assert.deepEqual(result, { ok: true, items: [...input.map(posix), posix(config)] });
  assert.equal(run(cwd, names).status, 0);
});

test("file ignores suppress empty-target errors, default ignores and missing targets do not", async (t) => {
  const { cwd, write } = fixture(t);
  write(".secretlintignore", "ignored.txt\n");
  write("ignored.txt");
  write("node_modules/file.txt");
  assert.deepEqual(await selectSecretlintFiles(["ignored.txt"], { cwd }), { ok: true, items: [] });
  for (const files of [["node_modules/file.txt"], ["absent.txt"], []]) {
    assert.deepEqual(await selectSecretlintFiles(files, { cwd }), { ok: false, items: [] });
    assert.equal(run(cwd, files).status, 2);
  }
  assert.equal(run(cwd, ["ignored.txt"]).status, 0);
  assert.equal(run(cwd, ["ignored.txt"], path.join(cwd, "absent.json")).status, 2);
});

test("nested negation overrides defaults and CRLF ignore rules keep their semantics", async (t) => {
  const { cwd, write } = fixture(t);
  write(".gitignore", "*.tmp\r\n# comment\r\n\\!bang\r\n\\#hash\r\n");
  write("nested/.gitignore", "!.secretlintrc.json\r\n!keep.tmp\r\n");
  const files = ["drop.tmp", "!bang", "#hash", "nested/keep.tmp", "nested/.secretlintrc.json"];
  files.forEach((file) => write(file));
  assert.deepEqual((await selectSecretlintFiles(files, { cwd })).items,
    files.slice(3).map((file) => posix(path.join(cwd, file))));
});

test("selector follows file symlinks lexically and fails closed on non-file targets or unreadable ignore structures", async (t) => {
  const { cwd, write } = fixture(t);
  write("target.txt");
  write(".secretlintignore", "target.txt\n");
  // File symlinks require Windows developer mode/admin privileges. Linux runs
  // exercise them; both platforms exercise the non-file fail-closed boundary.
  if (process.platform !== "win32") {
    symlinkSync("target.txt", path.join(cwd, "linked.txt"));
    symlinkSync("absent.txt", path.join(cwd, "broken.txt"));
    assert.deepEqual(await selectSecretlintFiles(["linked.txt", "broken.txt"], { cwd }),
      { ok: true, items: [posix(path.join(cwd, "linked.txt"))] });
  }
  mkdirSync(path.join(cwd, "directory"));
  await assert.rejects(selectSecretlintFiles(["directory"], { cwd }), /not a regular file/u);
  assert.equal(run(cwd, ["directory"]).status, 2);
  rmSync(path.join(cwd, ".secretlintignore"));
  mkdirSync(path.join(cwd, ".secretlintignore"));
  await assert.rejects(selectSecretlintFiles(["target.txt"], { cwd }), /Failed to read ignore file/u);
  assert.equal(run(cwd, ["target.txt"]).status, 2);
});
