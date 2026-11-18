import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const helper = "scripts/ci/playwright-apt-mirror.py";
const ec2 = "http://us-east-2.ec2.archive.ubuntu.com/ubuntu";
const official = "https://archive.ubuntu.com/ubuntu";

test("Noble mirror selection rewrites only exact apt URI tokens and is idempotent", {
  skip: process.platform !== "linux",
}, async (t) => {
  const apt = await mkdtemp(path.join(tmpdir(), "playwright-apt-"));
  t.after(() => rm(apt, { recursive: true, force: true }));
  await mkdir(path.join(apt, "sources.list.d"));
  const entries = [
    ["sources.list", `deb [arch=amd64 signed-by=/keys/archive] TARGET/ noble main # ${ec2}
# deb ${ec2} noble universe
deb-src TARGET noble-backports main
deb ${ec2}.example noble main
`],
    ["sources.list.d/ubuntu.sources", `Types: deb
URIs: TARGET
 https://azure.archive.ubuntu.com/ubuntu TARGET/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
Description: keep ${ec2}

Types: deb
URIs: http://security.ubuntu.com/ubuntu
Suites: noble-security
Components: main
`],
    ["sources.list.d/azure.list", "deb http://azure.archive.ubuntu.com/ubuntu noble main\n"],
    ["sources.list.d/old.sources.save", `URIs: ${ec2}\n`],
  ];
  for (const [name, fixture] of entries) {
    await writeFile(path.join(apt, name), fixture.replaceAll("TARGET", ec2));
  }
  const run = () => execFileSync("python3", ["-I", "-S", helper, apt], { encoding: "utf8" });
  assert.match(run(), /switched 2 source files/u);
  for (const [name, fixture] of entries) {
    assert.equal(await readFile(path.join(apt, name), "utf8"), fixture.replaceAll("TARGET", official));
  }
  assert.match(run(), /switched 0 source files/u);
});

test("both hosted install steps prepare the archive within their existing deadline", async () => {
  for (const name of ["ci", "prototype-web"]) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    assert.ok(workflow.includes([
      "        timeout-minutes: 25",
      "        run: |",
      `          sudo /usr/bin/python3.12 -I -S ${helper} /etc/apt`,
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
