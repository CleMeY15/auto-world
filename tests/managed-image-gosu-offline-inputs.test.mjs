import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MANAGED_GOSU_SOURCE as PIN } from "../scripts/scanner/official-controls.mjs";

const root = path.resolve(import.meta.dirname, "..");
const script = readFileSync(path.join(root, "infra/managed-images/postgres/gosu-offline-reconstruction.sh"), "utf8");
const recipe = readFileSync(path.join(root, "infra/managed-images/Dockerfile.postgres"), "utf8");
const linux = process.platform === "linux";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (text) => `'${text.replaceAll("'", `'"'"'`)}'`;
const rows = ["github.com/moby/sys/user|v0.4.1", "golang.org/x/sys|v0.1.0"]
  .flatMap((item) => ["info", "mod", "zip"].map((kind) => [...item.split("|"), kind]));
const relative = ([module, version, kind]) => `${module}/@v/${version}.${kind}`;
const fixtureBinary = Buffer.from("fixture binary, never native compilation evidence\n");
const intrinsic = "/out/gosu: go1.27.3\n\tfixture metadata only\n";

// Only the fixed paths and authenticated fixture archive/binary identities are
// substituted. All production boundary, isolation and receipt logic executes.
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "aw-gosu-offline-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inputs = path.join(directory, "inputs"), references = path.join(directory, "references");
  const work = path.join(directory, "work"), source = path.join(directory, "archive-source");
  const reference = path.join(directory, "reference-gosu"), bin = path.join(directory, "bin");
  for (const folder of [inputs, references, source, bin]) mkdirSync(folder);
  for (const name of ["go.mod", "go.sum"]) {
    const bytes = readFileSync(path.join(root, "infra/managed-images/postgres", name));
    writeFileSync(path.join(references, name), bytes); writeFileSync(path.join(source, name), bytes);
  }
  writeFileSync(path.join(source, "main.go"), "package main\nfunc main() {}\n");
  const archive = path.join(inputs, "gosu-source.tar.gz");
  const tar = spawnSync("tar", ["-czf", archive, "-C", directory, "archive-source"], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  for (const row of rows) {
    const file = path.join(inputs, "proxy", relative(row));
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `fixture ${row.join(" ")}\n`);
  }
  const descriptor = () => Buffer.from(rows.map((row) => {
    const bytes = readFileSync(path.join(inputs, "proxy", relative(row)));
    return `${row.join("\t")}\t${bytes.length}\t${hash(bytes)}\n`;
  }).join(""));
  writeFileSync(path.join(references, "module-proxy-payloads.tsv"), descriptor());
  writeFileSync(reference, fixtureBinary);
  const archiveBytes = readFileSync(archive);
  const rewritten = script.replace("inputs=/offline-inputs", `inputs=${quote(inputs)}`)
    .replace("references=/offline-references", `references=${quote(references)}`)
    .replace("work=/gosu-offline", `work=${quote(work)}`)
    .replace("reference_binary=/reference-gosu", `reference_binary=${quote(reference)}`)
    .replaceAll("18160", String(archiveBytes.length))
    .replace(`source_sha=${PIN.sourceArchiveSha256}`, `source_sha=${hash(archiveBytes)}`)
    .replace(`binary_sha=${PIN.binarySha256}`, `binary_sha=${hash(fixtureBinary)}`)
    .replace(`build_info_sha=${PIN.buildInfoSha256}`, `build_info_sha=${hash(intrinsic)}`);
  assert.notEqual(rewritten, script);
  const runner = path.join(directory, "run.sh"); writeFileSync(runner, rewritten);
  const calls = path.join(directory, "calls.jsonl");
  const stub = path.join(bin, "go.mjs");
  writeFileSync(stub, `import fs from "node:fs";
import path from "node:path";
const args=process.argv.slice(2), env=process.env, mode=env.FIXTURE_MODE;
fs.appendFileSync(env.FIXTURE_CALLS, JSON.stringify({args,cwd:process.cwd(),proxy:env.GOPROXY,cache:env.GOMODCACHE,buildCache:env.GOCACHE,home:env.HOME,tmp:env.TMPDIR,toolchain:env.GOTOOLCHAIN,sumdb:env.GOSUMDB,flags:env.GOFLAGS,cacheEntries:env.GOMODCACHE&&fs.existsSync(env.GOMODCACHE)?fs.readdirSync(env.GOMODCACHE):null})+"\\n");
if(args.join(" ")==="version") {console.log("go version go1.27.3 linux/amd64"); process.exit(0);}
if(args[0]==="mod"&&args[1]==="download") {
  if(mode==="unrelated") {console.log("compiler unavailable"); process.exit(1);}
  const proxy=env.GOPROXY.slice("file://".length); let failed=false;
  for(const [module,version] of [["github.com/moby/sys/user","v0.4.1"],["golang.org/x/sys","v0.1.0"]]) {
    const zip=path.join(proxy,module,"@v",version+".zip");
    if(!fs.existsSync(zip)&&mode!=="accept-missing") {
      const object={Path:module,Version:version,Error:"reading file://"+zip+": open "+zip+": no such file or directory"};
      if(mode==="wrong-error") object.Error="permission denied";
      console.log(JSON.stringify(object,null,2));failed=true;
    }
  }
  fs.writeFileSync(path.join(env.GOMODCACHE,"fixture-used"),"stub cache only");
  if(mode==="mutate-input") fs.appendFileSync(env.FIXTURE_INPUT,"mutation");
  process.exit(failed?1:0);
}
if(args[0]==="mod"&&args[1]==="verify") {console.log("all modules verified");process.exit(0);}
if(args[0]==="test") {console.log('{"Action":"skip","Package":"github.com/tianon/gosu"}');process.exit(0);}
if(args[0]==="build") {
  const output=args[args.indexOf("-o")+1];
  fs.writeFileSync(output,mode==="wrong-binary"?"wrong":${JSON.stringify(fixtureBinary.toString())});process.exit(0);
}
if(args[0]==="version"&&args[1]==="-m") {
  console.log(args[2]+": go1.27.3");console.log("\\tfixture metadata only");process.exit(0);
}
process.exit(13);
`);
  writeFileSync(path.join(bin, "go"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(stub)} "$@"\n`);
  chmodSync(path.join(bin, "go"), 0o700);
  return { directory, inputs, references, archive, work, reference, descriptor,
    payload: (index) => path.join(inputs, "proxy", relative(rows[index])),
    run: (mode = "") => spawnSync("/bin/sh", [runner], { encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_MODE: mode, FIXTURE_CALLS: calls, FIXTURE_INPUT: path.join(inputs, "proxy", relative(rows[0])) } }),
    calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : [],
    receipt: () => path.join(work, "evidence/offline-reconstruction.json") };
}
function refused(f, mode) {
  const result = f.run(mode);
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.signal, null, "refusal must terminate rather than hang");
  assert.equal(existsSync(f.receipt()), false);
  return result;
}

test("offline recipe has a sibling pinned builder, only fixed copies, network denial and both target dependencies", () => {
  const section = recipe.split(" AS gosu-offline-reconstruction\n")[1].split("\nFROM ")[0];
  assert.equal(recipe.split("FROM golang@sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747").length - 1, 2);
  const copies = section.split("\n").filter((line) => line.startsWith("COPY --from=gosu-build"));
  assert.equal(copies.length, 8);
  assert.ok(copies.some((line) => line.endsWith("/tmp/gosu-source.tar.gz /offline-inputs/gosu-source.tar.gz")));
  for (const row of rows) assert.ok(copies.some((line) => line.endsWith(`/go/pkg/mod/cache/download/${relative(row)} /offline-inputs/proxy/${relative(row)}`)));
  assert.match(section, /RUN --network=none --mount=type=bind,from=gosu-build,source=\/out\/gosu,target=\/reference-gosu,readonly \/usr\/local\/bin\/gosu-offline-reconstruction/u);
  assert.doesNotMatch(section, /type=cache|COPY .*\*/u);
  const runtime = recipe.split("FROM postgres-base AS runtime")[1];
  assert.match(runtime, /--mount=type=bind,from=gosu-offline-reconstruction,source=\/gosu-offline\/evidence\/offline-reconstruction.json,target=\/tmp\/offline-reconstruction.json,readonly/u);
  assert.match(runtime, /test -s \/tmp\/offline-reconstruction.json/u);
  assert.doesNotMatch(runtime, /^COPY .*offline/mu);
  for (const [name, value] of [["source_sha", PIN.sourceArchiveSha256], ["mod_sha", PIN.goModSha256], ["sum_sha", PIN.goSumSha256], ["binary_sha", PIN.binarySha256], ["build_info_sha", PIN.buildInfoSha256]]) assert.ok(script.includes(`${name}=${value}\n`));
});

test("production helper with fixture compiler requires three isolated acquisitions before emitting canonical proof (not native compilation)", { skip: !linux }, (t) => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const bytes = readFileSync(f.receipt()), proof = JSON.parse(bytes);
  assert.equal(bytes.toString(), `${JSON.stringify(proof)}\n`);
  assert.equal(proof.modulePayloadsSha256, hash(f.descriptor()));
  assert.deepEqual(proof.missingZipRefusals, ["github.com/moby/sys/user@v0.4.1", "golang.org/x/sys@v0.1.0"]);
  const acquisitions = f.calls().filter(({ args }) => args[0] === "mod" && args[1] === "download");
  assert.equal(acquisitions.length, 3);
  assert.deepEqual(acquisitions.map(({ args }) => args), [
    ["mod", "download", "-json", "github.com/moby/sys/user@v0.4.1"],
    ["mod", "download", "-json", "golang.org/x/sys@v0.1.0"],
    ["mod", "download", "-json", "all"],
  ]);
  assert.equal(new Set(acquisitions.map(({ cache }) => cache)).size, 3);
  for (const call of acquisitions) {
    assert.deepEqual(call.cacheEntries, []); assert.equal(call.sumdb, "off"); assert.equal(call.toolchain, "local"); assert.equal(call.flags, "");
    assert.ok(call.proxy.startsWith(`file://${f.work}/`));
    for (const key of ["cwd", "cache", "buildCache", "home", "tmp"]) assert.ok(call[key].startsWith(`${f.work}/`));
  }
  assert.equal(f.calls().filter(({ args }) => args[0] === "build").length, 1);
  assert.match(result.stdout, /gosu_offline_upstream_go_test_cases=0/u);
});

test("production helper rejects malformed inputs before any compiler invocation", { skip: !linux }, async (t) => {
  const mutations = [
    ["missing ZIP", (f) => unlinkSync(f.payload(2))],
    ["extra payload", (f) => writeFileSync(`${f.payload(0)}.extra`, "x")],
    ["extra top-level input", (f) => writeFileSync(path.join(f.inputs, "unexpected"), "x")],
    ["extra directory", (f) => mkdirSync(path.join(f.inputs, "proxy/extra"))],
    ["symlink", (f) => { unlinkSync(f.payload(0)); symlinkSync(f.payload(1), f.payload(0)); }],
    ["hardlink", (f) => linkSync(f.payload(0), path.join(f.directory, "other-link"))],
    ["FIFO", (f) => { unlinkSync(f.payload(0)); assert.equal(spawnSync("mkfifo", [f.payload(0)]).status, 0); }],
    ["empty", (f) => writeFileSync(f.payload(0), "")],
    ["oversized", (f) => truncateSync(f.payload(0), 16777217)],
    ["aggregate", (f) => { for (let i = 0; i < 3; i++) truncateSync(f.payload(i), 11184811); }],
    ["wrong bytes", (f) => writeFileSync(f.payload(0), "substituted")],
    ["wrong archive", (f) => writeFileSync(f.archive, "wrong")],
    ["wrong module", (f) => writeFileSync(path.join(f.references, "go.mod"), "wrong")],
    ["missing checksum", (f) => writeFileSync(path.join(f.references, "go.sum"), "wrong")],
    ["reordered descriptor", (f) => writeFileSync(path.join(f.references, "module-proxy-payloads.tsv"), f.descriptor().toString().trimEnd().split("\n").reverse().join("\n") + "\n")],
    ["missing descriptor row", (f) => writeFileSync(path.join(f.references, "module-proxy-payloads.tsv"), f.descriptor().toString().split("\n").slice(1).join("\n"))],
    ["extra descriptor row", (f) => writeFileSync(path.join(f.references, "module-proxy-payloads.tsv"), Buffer.concat([f.descriptor(), Buffer.from("extra\n")]))],
    ["dirty cache root", (f) => { mkdirSync(f.work); mkdirSync(path.join(f.work, "positive")); }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, (child) => {
    const f = fixture(child); mutate(f); refused(f); assert.deepEqual(f.calls(), []);
  });
});

test("production helper rejects false refusals, comparison failures and post-consumption mutation", { skip: !linux }, async (t) => {
  for (const mode of ["accept-missing", "unrelated", "wrong-error", "wrong-binary", "mutate-input"]) await t.test(mode, (child) => refused(fixture(child), mode));
});
