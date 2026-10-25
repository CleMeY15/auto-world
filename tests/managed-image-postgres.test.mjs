import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const materialsRoot = path.join(root, "infra/managed-images/postgres");
const recipe = await readFile(path.join(root, "infra/managed-images/Dockerfile.postgres"), "utf8");
const functional = await readFile(path.join(root, "infra/managed-images/gosu-functional-tests.sh"), "utf8");
const lock = JSON.parse(await readFile(path.join(root, "infra/managed-images/lock.json"), "utf8"));
const upstream = await readFile(path.join(materialsRoot, "Dockerfile.test-alpine.upstream"));
const goMod = await readFile(path.join(materialsRoot, "go.mod"));
const goSum = await readFile(path.join(materialsRoot, "go.sum"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stage = (source, name) => {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.endsWith(` AS ${name}`));
  assert.notEqual(start, -1, `stage ${name} exists`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("FROM "));
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
};

function assertMaterialBoundary(source, metadata = lock, moduleBytes = goMod, sumBytes = goSum) {
  const compiler = metadata.buildTools.find((entry) => entry.role === "go-builder");
  const base = metadata.candidates.find((entry) => entry.role === "postgres");
  assert.equal(metadata.state, "DIAGNOSTIC_ONLY_NOT_ADMITTED");
  assert.equal(metadata.platform, "linux/amd64");
  assert.match(source, new RegExp(`^FROM golang@${compiler.platform.digest} AS gosu-build$`, "mu"));
  assert.match(source, new RegExp(`^FROM postgres@${base.baseDigest} AS postgres-base$`, "mu"));
  assert.ok(source.includes(`ADD --checksum=sha256:${metadata.gosu.archiveSha256} https://codeload.github.com/tianon/gosu/tar.gz/${metadata.gosu.sourceCommit} /tmp/gosu-source.tar.gz`));
  assert.ok(source.includes(`test "$(wc -c < /tmp/gosu-source.tar.gz)" = ${metadata.gosu.archiveBytes};`));
  assert.equal(sha256(moduleBytes), metadata.gosu.goModSha256);
  assert.equal(sha256(sumBytes), metadata.gosu.goSumSha256);
  assert.equal([...source.matchAll(/^FROM /gmu)].length, 5);
  assert.doesNotMatch(source, /^ARG |FROM .*:(?:latest|[0-9])/mu);
  const build = stage(source, "gosu-build");
  const download = build.indexOf("go mod download -json all");
  const verify = build.indexOf("go mod verify");
  const offline = build.indexOf("RUN --network=none");
  const compile = build.indexOf("go build -mod=readonly");
  assert.ok(download > 0 && verify > download && offline > verify && compile > offline);
  assert.equal([...build.matchAll(/cmp \/materials\/go\.mod go\.mod/gu)].length, 3);
  assert.equal([...build.matchAll(/cmp \/materials\/go\.sum go\.sum/gu)].length, 3);
  assert.match(build, /GOPROXY=https:\/\/proxy\.golang\.org GOSUMDB=sum\.golang\.org/u);
  assert.match(build, /export GOPROXY=off GOSUMDB=off/u);
  assert.match(build, /GOENV=off GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=amd64/u);
  assert.match(build, /go build -mod=readonly -trimpath -buildvcs=false '-ldflags=-d -w -buildid='/u);
  assert.match(build, /go version -m \/out\/gosu > \/out\/evidence\/build-info\.txt/u);
  assert.match(build, /github\.com\/tianon\/gosu\\t\(devel\)\\t/u);
  assert.match(build, /test "\$\(grep -c .*" = 2;/u);
  assert.match(build, /if grep -q .*\\tbuild\\tvcs.*then exit 1; fi/u);
  assert.doesNotMatch(build, /fake-git|git init|go get|go mod tidy|govulncheck|GOSUMDB=off.*go mod download/u);
}

function assertRuntimeBoundary(source) {
  const base = stage(source, "postgres-base").split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  assert.deepEqual(base, [`FROM postgres@${lock.candidates.find((entry) => entry.role === "postgres").baseDigest} AS postgres-base`]);
  const runtime = stage(source, "runtime");
  assert.match(runtime, /^FROM postgres-base AS runtime\n/u);
  const copies = runtime.split("\n").filter((line) => line.startsWith("COPY "));
  assert.deepEqual(copies, [
    "COPY --from=gosu-functional --chown=0:0 --chmod=0755 /usr/local/bin/gosu /usr/local/bin/gosu",
    "COPY --from=gosu-build --chown=0:0 /out/evidence/licenses/ /usr/share/licenses/auto-world-gosu/",
    "COPY --from=gosu-build --chown=0:0 /out/evidence/DERIVATIVE-NOTICE.txt /usr/share/licenses/auto-world-gosu/DERIVATIVE-NOTICE.txt",
  ]);
  assert.doesNotMatch(runtime, /^(?:USER|ENTRYPOINT|CMD|VOLUME|ADD) /mu);
  assert.doesNotMatch(runtime, /chmod \+s|gosu-functional-tests|^ENV HOME|^ENV GOSU_PLEASE/mu);
  assert.match(runtime, /ENV GOSU_VERSION=1\.20 AUTO_WORLD_GOSU_COMPONENT=auto-world-gosu\/1\.20-go1\.27\.3-r1/u);
  assert.match(runtime, /io\.auto-world\.gosu\.authority="diagnostic-only-not-admitted"/u);
  assert.match(runtime, /--mount=type=bind,from=gosu-build,source=\/out\/gosu,target=\/tmp\/expected-gosu,readonly/u);
  assert.match(runtime, /cmp \/usr\/local\/bin\/gosu \/tmp\/expected-gosu/u);
  assert.match(runtime, /test "\$\(stat -c '%u:%g:%a' \/usr\/local\/bin\/gosu\)" = '0:0:755'/u);
  assert.match(runtime, /test -z "\$\{GOSU_PLEASE_LET_ME_BE_COMPLETELY_INSECURE_I_GET_TO_KEEP_ALL_THE_PIECES\+x\}"/u);
  assert.match(runtime, /test "\$\(id -u postgres\):\$\(id -g postgres\)" = '70:70'/u);
  assert.match(runtime, /gosu postgres sh -ec 'test "\$\(id -u\):\$\(id -g\)" = "70:70"; test "\$HOME" = \/var\/lib\/postgresql'/u);
}

function upstreamCommands(bytes) {
  return bytes.toString("utf8").split("\n")
    .filter((line) => /^RUN (?:gosu-t |\[ |! gosu )/u.test(line))
    .map((line) => line.slice(4));
}

function functionalCommands(source) {
  return source.split("\n").map((line) => line.trim())
    .filter((line) => /^(?:gosu-t |\[ "\$\(gosu |! gosu )/u.test(line))
    .map((line) => line.replace(/ \|\| exit 1$/u, ""));
}

test("PostgreSQL recipe binds locked exact source, builder, base and standard authenticated/offline Go phases", () => {
  assertMaterialBoundary(recipe);
});

test("material contract refuses source, archive, builder, base and module substitutions", () => {
  assertMaterialBoundary(recipe);
  const mutations = [
    recipe.replace(lock.gosu.sourceCommit, "0".repeat(40)),
    recipe.replace(`--checksum=sha256:${lock.gosu.archiveSha256}`, `--checksum=sha256:${"0".repeat(64)}`),
    recipe.replace(lock.buildTools[0].platform.digest, `sha256:${"1".repeat(64)}`),
    recipe.replace(lock.candidates[0].baseDigest, `sha256:${"2".repeat(64)}`),
    recipe.replace("go mod verify", "printf verification-skipped"),
    recipe.replace("RUN --network=none set -eu", "RUN set -eu"),
    recipe.replace("-buildvcs=false '-ldflags=-d -w -buildid='", "-buildvcs=true '-ldflags=-d -w -buildid='"),
  ];
  for (const changed of mutations) assert.throws(() => assertMaterialBoundary(changed));
  assert.throws(() => assertMaterialBoundary(recipe, lock, Buffer.concat([goMod, Buffer.from("\nrequire example.com/extra v1.0.0\n")])));
  assert.throws(() => assertMaterialBoundary(recipe, lock, goMod, Buffer.from(goSum.toString("utf8").replace("v0.4.1", "v0.4.2"))));
});

test("runtime retains the original entrypoint contract and imports only a normalized binary and notices", () => {
  assertRuntimeBoundary(recipe);
});

test("runtime isolation refuses fixture inheritance, unsafe mode, wrong IDs and extra fixture copies", () => {
  assertRuntimeBoundary(recipe);
  const mutations = [
    recipe.replace("FROM postgres-base AS runtime", "FROM gosu-functional AS runtime"),
    recipe.replace(" AS postgres-base\n", " AS postgres-base\nENV HOME=/fixture\n"),
    recipe.replace("COPY --from=gosu-functional --chown=0:0 --chmod=0755 /usr/local/bin/gosu /usr/local/bin/gosu", "COPY --from=gosu-functional /usr/local/bin/gosu /usr/local/bin/gosu"),
    recipe.replace("FROM postgres-base AS runtime", "FROM postgres-base AS runtime\nENV HOME=/omg/really/gosu/nowhere"),
    recipe.replace("FROM postgres-base AS runtime", "FROM postgres-base AS runtime\nCOPY --from=gosu-functional /usr/local/bin/gosu-t /usr/local/bin/gosu-t"),
    recipe.replace("= '70:70'", "= '999:999'"),
    recipe.replace("cmp /usr/local/bin/gosu /tmp/expected-gosu", "printf comparison-skipped"),
    recipe.replace("FROM postgres-base AS runtime", "FROM postgres-base AS runtime\nENTRYPOINT [\"sh\"]"),
  ];
  for (const changed of mutations) assert.throws(() => assertRuntimeBoundary(changed));
});

test("the transformed Alpine script preserves all 34 original assertion commands", () => {
  assert.equal(sha256(upstream), "3dbc00875d98a1ab2ca733b8c176839a5f855e479339d90293ed4abf2751a5ca");
  const original = upstreamCommands(upstream);
  assert.equal(original.filter((line) => line.startsWith("gosu-t ")).length, 17);
  assert.equal(original.filter((line) => line.startsWith("[ ")).length, 13);
  assert.equal(original.filter((line) => line.startsWith("! gosu ")).length, 4);
  assert.deepEqual(functionalCommands(functional), original);
  for (const refusal of original.filter((line) => line.startsWith("! gosu "))) {
    assert.ok(functional.includes(`${refusal} || exit 1`), "a negated pipeline must terminate this combined script on unexpected success");
  }
  assert.match(functional, /real="\$\(gosu "\$spec" id -un\):\$\(gosu "\$spec" id -gn\):\$\(gosu "\$spec" id -Gn\)" \|\| true/u);
  assert.match(functional, /GOSU_TEST_EXPECTED_PID=\$\$/u);
  assert.match(functional, /exec gosu root sh -ec 'test "\$\$" = "\$GOSU_TEST_EXPECTED_PID"/u);
  const fixture = stage(recipe, "gosu-functional");
  assert.match(fixture, /^FROM postgres-base AS gosu-functional/u);
  assert.match(fixture, /COPY --from=gosu-build .* \/out\/gosu \/usr\/local\/bin\/gosu/u);
  assert.match(fixture, /chmod \+s \/usr\/local\/bin\/gosu/u);
  assert.match(fixture, /USER nobody/u);
  assert.match(fixture, /RUN --network=none .* assertions > \/evidence\/upstream-alpine-tests\.txt/u);
  assert.match(fixture, /RUN --network=none .* exec-check > \/evidence\/process-replacement\.txt/u);
});

test("Go's zero upstream cases stay explicit and the evidence export cannot include binaries or archives", () => {
  const build = stage(recipe, "gosu-build");
  assert.match(build, /go test -mod=readonly -trimpath -buildvcs=false -json \.\/\.\.\./u);
  assert.match(build, /upstream-go-test-cases=0/u);
  const evidence = stage(recipe, "evidence");
  assert.deepEqual(evidence.split("\n").filter((line) => line !== "" && !line.startsWith("#")), [
    "FROM scratch AS evidence",
    "COPY --from=gosu-build /out/evidence/ /",
    "COPY --from=gosu-functional /evidence/ /",
  ]);
  assert.doesNotMatch(build, /(?:cp|mv|ln)\s+(?:[^;]*\s)?(?:\/out\/gosu|\/tmp\/gosu-source\.tar\.gz)\s+\/out\/evidence/u);
  assert.doesNotMatch(build, /cp .*\/materials\/licenses\/\*/u);
});

test("all selected licence bytes are original and checked against actual compiler/module material", async () => {
  const identities = {
    "gosu-LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "moby-sys-LICENSE": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "x-sys-LICENSE": "2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067",
    "x-sys-PATENTS": "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc",
    "go-LICENSE": "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad",
    "go-PATENTS": "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc",
  };
  for (const [name, expected] of Object.entries(identities)) {
    assert.equal(sha256(await readFile(path.join(materialsRoot, "licenses", name))), expected, name);
    assert.ok(recipe.includes(`cmp /materials/licenses/${name} `), `${name} is compared with the consumed source, module or compiler bytes`);
  }
  const notice = await readFile(path.join(materialsRoot, "DERIVATIVE-NOTICE.txt"), "utf8");
  assert.match(notice, /internally compiled derivative/u);
  assert.match(notice, /truthful \(devel\) version/u);
  assert.match(notice, /no image admission/u);
});
