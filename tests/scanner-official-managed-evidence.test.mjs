import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { exportManagedTextEvidence } from "../scripts/scanner/official-audit.mjs";

const MiB = 1024 ** 2;
const error = /^scanner_managed_evidence_invalid$/u;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const parent = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(path.join(parent, "aw-managed-text-test-")));
  const source = path.join(directory, "source");
  const destination = path.join(directory, "public");
  mkdirSync(source);
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith("aw-managed-text-test-"));
    const writable = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const file = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) writable(file);
        else chmodSync(file, 0o600);
      }
    };
    writable(directory);
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 5 });
  });
  return { directory, source, destination };
}

function put(directory, relative, bytes) {
  const file = path.join(directory, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes, { flag: "wx" });
  return file;
}

function refuses(source, destination) {
  assert.throws(() => exportManagedTextEvidence(source, destination), (failure) => error.test(failure.message));
  assert.equal(existsSync(destination), false, "no public output is created after a validation refusal");
}

test("managed evidence exports exact original bytes and independently computed hashes with portable relative paths", (t) => {
  const { source, destination } = fixture(t);
  const originals = new Map([
    ["inventory.json", Buffer.from('\ufeff{"name":"été","result":"passed"}\r\n', "utf8")],
    ["junit/suite.xml", Buffer.from('<testsuite tests="2" failures="0"/>\n')],
    ["logs/build.log", Buffer.from("compiler: go1.27.3\nmodule verification passed\n")],
  ]);
  const before = new Map();
  for (const [relative, bytes] of originals) {
    const file = put(source, relative, bytes);
    before.set(relative, { bytes: readFileSync(file), stat: statSync(file) });
  }
  const exported = exportManagedTextEvidence(source, destination);
  assert.deepEqual([...exported].sort((left, right) => left.path.localeCompare(right.path)), [...originals]
    .map(([relative, bytes]) => ({ path: relative, size: bytes.length, sha256: sha256(bytes) }))
    .sort((left, right) => left.path.localeCompare(right.path)));
  for (const { path: relative, size, sha256: digest } of exported) {
    assert.equal(relative.includes("\\"), false);
    assert.equal(path.isAbsolute(relative), false);
    const output = path.join(destination, ...relative.split("/"));
    assert.deepEqual(readFileSync(output), originals.get(relative));
    assert.equal(statSync(output).size, size);
    assert.equal(sha256(readFileSync(output)), digest);
    const original = path.join(source, ...relative.split("/"));
    assert.deepEqual(readFileSync(original), before.get(relative).bytes);
    assert.equal(statSync(original).mtimeMs, before.get(relative).stat.mtimeMs);
    assert.equal(statSync(original).mode, before.get(relative).stat.mode);
    assert.notEqual(statSync(original).ino, statSync(output).ino, "exports are copies, not hardlinks");
    if (process.platform === "linux") assert.equal(statSync(output).mode & 0o777, 0o400);
  }
});

test("managed evidence accepts real prefixed licence basenames, Go manifests, statuses and allowed text extensions", (t) => {
  const { source, destination } = fixture(t);
  const names = [
    "licenses/go-LICENSE", "licenses/x-sys-PATENTS", "licenses/gosu-LICENSE", "licenses/moby-sys-LICENSE",
    "licenses/NOTICE", "LICENSE", "PATENTS", "go.mod", "go.sum", "checks/result.status",
    "result.txt", "report.json", "junit.xml", "packages.tsv", "test.log",
  ];
  for (const name of names) put(source, name, `original text: ${name}\n`);
  const exported = exportManagedTextEvidence(source, destination);
  assert.deepEqual(exported.map((entry) => entry.path).sort(), [...names].sort());
  for (const name of names) assert.deepEqual(readFileSync(path.join(source, name)), readFileSync(path.join(destination, name)));
});

test("managed evidence validates the complete source before writing any output", (t) => {
  const { source, destination } = fixture(t);
  const original = Buffer.from("valid proof first\n");
  put(source, "a-valid.txt", original);
  put(source, "z-binary.json", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
  refuses(source, destination);
  assert.deepEqual(readFileSync(path.join(source, "a-valid.txt")), original);
});

test("managed evidence refuses binary content disguised with a permitted extension", (t) => {
  const { source, destination } = fixture(t);
  const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff]);
  const file = put(source, "build.json", binary);
  refuses(source, destination);
  assert.deepEqual(readFileSync(file), binary);
});

test("managed evidence refuses invalid UTF-8 even when no NUL byte is present", (t) => {
  const { source, destination } = fixture(t);
  const bytes = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
  assert.equal(bytes.includes(0), false);
  put(source, "invalid.json", bytes);
  refuses(source, destination);
});

test("managed evidence refuses UTF-16 or embedded NUL text instead of silently transcoding it", (t) => {
  const { source, destination } = fixture(t);
  const bytes = Buffer.from('{"result":"passed"}\n', "utf16le");
  put(source, "result.json", bytes);
  refuses(source, destination);
});

for (const name of ["candidate.tar", "gosu", "report.json.exe", "private.env", "LICENSE.bin", "unsafe name.txt"]) {
  test(`managed evidence refuses the unapproved basename ${name}`, (t) => {
    const { source, destination } = fixture(t);
    put(source, name, "plain UTF-8 is insufficient without an allowed public name\n");
    refuses(source, destination);
  });
}

test("managed evidence refuses recognizable GitHub, AWS and Authorization credentials", async (t) => {
  const secrets = [
    ...["o", "p", "r", "s", "u"].map((kind) => `gh${kind}_${"a".repeat(24)}`),
    `github_pat_${"b".repeat(30)}`,
    `AKIA${"A1".repeat(8)}`,
    ["Authorization:", "Bearer", "synthetic-bearer"].join(" "),
    ["authorization:", "basic", "synthetic-basic"].join(" "),
  ];
  for (const [index, secret] of secrets.entries()) {
    await t.test(`credential pattern ${index + 1}`, (child) => {
      const { source, destination } = fixture(child);
      const original = Buffer.from(`ordinary build output\n${secret}\n`);
      put(source, "output.log", original);
      refuses(source, destination);
      assert.deepEqual(readFileSync(path.join(source, "output.log")), original);
    });
  }
});

test("managed evidence refuses an occupied directory or file without changing it", (t) => {
  const { directory, source, destination } = fixture(t);
  put(source, "report.txt", "valid\n");
  mkdirSync(destination);
  const existing = put(destination, "keep.txt", "preserve existing output\n");
  assert.throws(() => exportManagedTextEvidence(source, destination), (failure) => error.test(failure.message));
  assert.equal(readFileSync(existing, "utf8"), "preserve existing output\n");
  assert.deepEqual(readdirSync(destination), ["keep.txt"]);
  const fileDestination = put(directory, "already-there.txt", "preserve file\n");
  assert.throws(() => exportManagedTextEvidence(source, fileDestination), (failure) => error.test(failure.message));
  assert.equal(readFileSync(fileDestination, "utf8"), "preserve file\n");
});

test("managed evidence refuses relative, aliased and malformed native paths", (t) => {
  const { directory, source, destination } = fixture(t);
  put(source, "report.txt", "valid\n");
  const invalid = [
    [path.relative(process.cwd(), source), destination],
    [source, "relative-output"],
    [`${source}${path.sep}..${path.sep}source`, destination],
    [source, `${directory}${path.sep}source${path.sep}..${path.sep}public`],
    [`${source},suffix`, destination],
    [source, `${destination}\n`],
    [source, `${destination}\0`],
  ];
  for (const [input, output] of invalid) {
    assert.throws(() => exportManagedTextEvidence(input, output), (failure) => error.test(failure.message));
  }
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(source), ["report.txt"]);
});

test("managed evidence refuses an empty source", (t) => {
  const { source, destination } = fixture(t);
  refuses(source, destination);
});

test("managed evidence refuses actual multiply linked files, including on Windows", (t) => {
  const { directory, source, destination } = fixture(t);
  const original = Buffer.from("hardlink evidence\n");
  const file = put(source, "report.txt", original);
  const alias = path.join(directory, "hardlink.txt");
  linkSync(file, alias);
  assert.equal(statSync(file).nlink, 2, "the fixture really is a hardlink");
  refuses(source, destination);
  assert.deepEqual(readFileSync(file), original);
  assert.deepEqual(readFileSync(alias), original);
});

const linuxOnly = { skip: process.platform !== "linux" && "Linux symlink semantics are exercised in Linux CI; this platform is not counted as a passing symlink test" };

test("managed evidence refuses source or destination-parent directory symlink aliases", linuxOnly, (t) => {
  const { directory, source, destination } = fixture(t);
  put(source, "report.txt", "valid\n");
  const alias = path.join(directory, "source-alias");
  symlinkSync(source, alias, "dir");
  assert.equal(lstatSync(alias).isSymbolicLink(), true);
  refuses(alias, destination);
  const publicParent = path.join(directory, "actual-parent");
  mkdirSync(publicParent);
  const publicAlias = path.join(directory, "parent-alias");
  symlinkSync(publicParent, publicAlias, "dir");
  refuses(source, path.join(publicAlias, "public"));
  assert.deepEqual(readdirSync(publicParent), []);
});

test("managed evidence refuses nested symlink files and symlink directories before copying", linuxOnly, (t) => {
  const { directory, source, destination } = fixture(t);
  const outside = put(directory, "outside.txt", "must not be exported\n");
  const symlink = path.join(source, "linked.json");
  symlinkSync(outside, symlink, "file");
  refuses(source, destination);
  rmSync(symlink);
  const outsideDirectory = path.join(directory, "outside");
  mkdirSync(outsideDirectory);
  put(outsideDirectory, "report.txt", "outside directory\n");
  symlinkSync(outsideDirectory, path.join(source, "linked-directory"), "dir");
  refuses(source, destination);
  assert.equal(readFileSync(outside, "utf8"), "must not be exported\n");
});

test("managed evidence accepts exactly 4 MiB and refuses the next byte before exporting", (t) => {
  const { source, destination } = fixture(t);
  const bytes = Buffer.alloc(4 * MiB, 0x61);
  const file = put(source, "boundary.log", bytes);
  const exported = exportManagedTextEvidence(source, destination);
  assert.deepEqual(exported, [{ path: "boundary.log", size: bytes.length, sha256: sha256(bytes) }]);
  assert.deepEqual(readFileSync(path.join(destination, "boundary.log")), bytes);
  writeFileSync(file, Buffer.alloc(4 * MiB + 1, 0x61));
  refuses(source, path.join(path.dirname(destination), "oversized-public"));
  assert.equal(statSync(file).size, 4 * MiB + 1);
});
