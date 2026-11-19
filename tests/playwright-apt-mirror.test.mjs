import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const helper = "scripts/ci/playwright-apt-mirror.py";
const ec2 = "http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n";
const azure = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n";
const fallbacks = "https://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n";

test("selects the official fallback from the hosted apt mirror list only on the affected runner", {
  skip: process.platform !== "linux",
}, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "playwright-apt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mirrors = path.join(dir, "apt-mirrors.txt");
  const run = () => execFileSync("python3", ["-I", "-S", helper, mirrors], { encoding: "utf8" });
  assert.match(run(), /unchanged/u);
  assert.equal(Buffer.byteLength(ec2 + fallbacks), 152);
  await writeFile(mirrors, ec2 + fallbacks);
  assert.match(run(), /removed slow EC2 priority:1/u);
  assert.equal(await readFile(mirrors, "utf8"), fallbacks);
  assert.match(run(), /unchanged/u);
  for (const fixture of [azure + fallbacks, ec2, "# " + ec2 + fallbacks]) {
    await writeFile(mirrors, fixture);
    assert.match(run(), /unchanged/u);
    assert.equal(await readFile(mirrors, "utf8"), fixture);
  }
});

test("both hosted install steps prepare the archive before installing the browser suites", async () => {
  for (const name of ["ci", "prototype-web"]) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    assert.ok(workflow.includes([
      "        run: |",
      `          sudo /usr/bin/python3.12 -I -S ${helper} /etc/apt/apt-mirrors.txt`,
      "          pnpm --filter @auto-world/web exec playwright install --with-deps chromium webkit",
    ].join("\n")));
    if (name === "prototype-web") {
      for (const section of [workflow.split("  pull_request:\n")[1].split("  push:\n")[0],
        workflow.split("  push:\n")[1].split("\npermissions:")[0]]) {
        for (const file of [helper, "tests/playwright-apt-mirror.test.mjs"]) {
          assert.ok(section.split("\n").includes(`      - ${file}`));
        }
      }
    }
  }
});
