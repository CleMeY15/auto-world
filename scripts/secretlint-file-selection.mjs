/*
 * Cascade adapted from @secretlint/walker 13.0.5 (MIT):
 * Copyright (c) 2026 azu
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

// Literal-file subset of Secretlint 13.0.5's search/ignore cascade. The caller
// already enumerates Git files; interpreting these names as globs loses files.
// Upstream: https://github.com/secretlint/secretlint (MIT, Copyright azu).
const defaults = [
  "**/.git", "**/node_modules", "**/.secretlintrc", "**/.secretlintrc.json",
  "**/.secretlintrc.yaml", "**/.secretlintrc.yml", "**/.secretlintrc.js",
  "**/.secretlintignore*",
];
const toPosix = (file) => path.sep === "\\" ? file.replaceAll("\\", "/") : file;
const outside = (relative) => relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

async function readIgnore(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") return "";
    throw new Error(`Failed to read ignore file: ${file}`, { cause: error });
  }
}

async function select(files, cwd, withIgnoreFiles) {
  const root = { dir: cwd, matcher: ignore().add(defaults), parent: null };
  const levels = new Map();
  async function extend(parent, dir) {
    if (!withIgnoreFiles) return parent;
    if (levels.has(dir)) return levels.get(dir);
    // Both files share one matcher: later .gitignore rules win at this level.
    const contents = [await readIgnore(path.join(dir, ".secretlintignore")), await readIgnore(path.join(dir, ".gitignore"))];
    const rules = contents.filter((content) => content.trim().length > 0);
    const matcher = ignore();
    for (const content of rules) matcher.add(content);
    const level = rules.length ? { dir, matcher, parent } : parent;
    levels.set(dir, level);
    return level;
  }
  const selected = new Set();
  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    let chain = await extend(root, cwd);
    const parent = path.relative(cwd, path.dirname(absolute));
    // Preserve upstream's ancestor-seeding behavior for names like ..config.
    if (parent && !parent.startsWith("..") && !path.isAbsolute(parent)) {
      let dir = cwd;
      for (const segment of parent.split(path.sep)) {
        dir = path.join(dir, segment);
        chain = await extend(chain, dir);
      }
    }
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EACCES") continue;
      throw error;
    }
    // This internal API takes Git files, never directory/glob requests. Fail
    // closed if a tracked symlink targets a directory instead of omitting it.
    if (!info.isFile()) throw new Error(`Secret scan target is not a regular file: ${file}`);
    let ignored = false;
    for (let level = chain; level; level = level.parent) {
      const relative = path.relative(level.dir, absolute);
      if (!relative || outside(relative)) continue;
      const verdict = level.matcher.test(toPosix(relative));
      if (verdict.ignored || verdict.unignored) {
        ignored = verdict.ignored;
        break;
      }
    }
    if (!ignored) selected.add(toPosix(absolute));
  }
  // Upstream inserted asynchronous completion order; stable literal input order
  // changes no coverage and makes diagnostics reproducible within each batch.
  return [...selected];
}

export async function selectSecretlintFiles(files, { cwd = process.cwd() } = {}) {
  cwd = path.resolve(cwd);
  const items = await select(files, cwd, true);
  if (items.length) return { ok: true, items };
  // File-based ignores may intentionally exclude a whole batch; defaults alone
  // excluding everything (or absent inputs) must still be a fatal target error.
  return { ok: (await select(files, cwd, false)).length > 0, items: [] };
}
