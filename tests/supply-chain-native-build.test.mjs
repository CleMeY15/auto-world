import assert from "node:assert/strict";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { orasModuleDiagnostics, parseLockUpdateArgs, parseTrivyFormattingCapture, trivyFormattingArguments, validateGitTree, withRestoredOrasModules } from "../scripts/supply-chain/lock-update.mjs";
import { buildNativeCandidate, parseNativeBuildArgs, withOrasModuleSnapshot, withOrasUpstreamIntegrity } from "../scripts/supply-chain/native-build.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = path.join(root, "infra/supply-chain/native-materials.lock.json");

test("Trivy formatter captures only fixed public source arguments and preserves the actual failure status", () => {
  const args = trivyFormattingArguments(path.join(root, "go ' $()"), path.join(root, "source ' $()"));
  assert.deepEqual(args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
  assert.equal(args[3], '"$1" -d "$2" "$3"; code=$?; printf "\\nAUTOWORLD_GOFMT_EXIT=%s\\n" "$code"');
  assert.ok(args[5].endsWith(path.join("go ' $()", "bin/gofmt")));
  assert.ok(args[6].endsWith(path.join("internal/gittest/testdata", "fixture.go")));
  assert.ok(args[7].endsWith(path.join("pkg/fanal/analyzer/pkg/rpm/testdata", "fixture.go")));
  assert.deepEqual(parseTrivyFormattingCapture(Buffer.from("\nAUTOWORLD_GOFMT_EXIT=0\n"), Buffer.alloc(0)), { exitCode: 0, diff: "", stderr: "" });
  assert.deepEqual(parseTrivyFormattingCapture(Buffer.from("\nAUTOWORLD_GOFMT_EXIT=2\n"), Buffer.from("public syntax error")), {
    exitCode: 2, diff: "", stderr: "public syntax error",
  });
  const injected = parseTrivyFormattingCapture(Buffer.from("+AUTOWORLD_GOFMT_EXIT=0\n\nAUTOWORLD_GOFMT_EXIT=2\n"), Buffer.alloc(0));
  assert.equal(injected.exitCode, 2);
  assert.equal(injected.diff, "+AUTOWORLD_GOFMT_EXIT=0\n");
  assert.throws(() => parseTrivyFormattingCapture(Buffer.alloc(1024 * 1024 + 1), Buffer.alloc(0)), /trivy_formatter_output_invalid/u);
  for (const invalid of ["", "AUTOWORLD_GOFMT_EXIT=0", "\nAUTOWORLD_GOFMT_EXIT=256\n", "\nAUTOWORLD_GOFMT_EXIT=0\nextra"]) {
    assert.throws(() => parseTrivyFormattingCapture(Buffer.from(invalid), Buffer.alloc(0)), /trivy_formatter_status_invalid/u);
  }
});

test("ORAS diagnostics distinguish download side effects from source changes without accepting either", () => {
  const original = { "go.mod": Buffer.from("module example.invalid\n"), "go.sum": Buffer.from("original sum\n") };
  const downloaded = { ...original, "go.sum": Buffer.from("original sum\nextra sum\n") };
  const restored = orasModuleDiagnostics(original, downloaded, original);
  assert.equal(restored.downloadChangedSource, true);
  assert.equal(restored.tidyChangedDownload, true);
  assert.equal(restored.tidyMatchesOriginal, true);
  assert.equal(restored.state, "diagnostic_only");
  assert.equal(restored.states.downloaded["go.sum"].text, "original sum\nextra sum\n");
  assert.equal(orasModuleDiagnostics(original, downloaded, downloaded).tidyMatchesOriginal, false);
  for (const bad of [
    { ...original, "other.txt": Buffer.from("unexpected") },
    { ...original, "go.mod": Buffer.alloc(64 * 1024 + 1) },
    { ...original, "go.sum": Buffer.from([255]) },
  ]) assert.throws(() => orasModuleDiagnostics(original, bad, original), /oras_module_diagnostic_/u);
});

test("ORAS diagnostic failure restores source bytes and never publishes an incomplete receipt", async () => {
  const owned = await createOwnedDirectory();
  const original = { "go.mod": Buffer.from("original module\n"), "go.sum": Buffer.from("original checksum\n") };
  const primary = new Error("injected tidy failure");
  let checked = false;
  const verifyRestored = async () => {
    for (const file of Object.keys(original)) assert.deepEqual(await readFile(path.join(owned.path, file)), original[file]);
    checked = true;
  };
  try {
    const mutate = async () => {
      for (const file of Object.keys(original)) await writeFile(path.join(owned.path, file), "mutated");
      throw primary;
    };
    const collect = async (verify) => {
      await withRestoredOrasModules(owned.path, original, mutate, verify);
      await writeFile(path.join(owned.path, "module-diagnostics.json"), "never published");
    };
    await assert.rejects(collect(verifyRestored), (error) => error === primary);
    assert.equal(checked, true);
    assert.deepEqual((await readdir(owned.path)).sort(), ["go.mod", "go.sum"]);
    await assert.rejects(collect(async () => { throw new Error("injected restore check failure"); }), (error) => {
      assert.equal(error.message, "material_contract:oras_module_diagnostic_restore_failed");
      assert.equal(error.primaryError, primary);
      assert.equal(error.cause.message, "injected restore check failure");
      return true;
    });
  } finally {
    await removeOwnedDirectory(owned);
  }
});

test("ORAS module verification isolates downloaded sums and refuses source or workspace mutations", async () => {
  const owned = await createOwnedDirectory();
  const source = path.join(owned.path, "source");
  const original = { "go.mod": Buffer.from("module example.invalid\n"), "go.sum": Buffer.from("original sum\n") };
  await mkdir(source);
  const reset = async () => {
    for (const [file, bytes] of Object.entries(original)) await writeFile(path.join(source, file), bytes);
  };
  const assertClean = async () => {
    assert.deepEqual(await readdir(owned.path), ["source"]);
    assert.deepEqual((await readdir(source)).sort(), ["go.mod", "go.sum"]);
    for (const [file, bytes] of Object.entries(original)) assert.deepEqual(await readFile(path.join(source, file)), bytes);
  };
  try {
    await reset();
    assert.equal(await withOrasModuleSnapshot(source, owned.path, async (modfile) => {
      assert.equal(path.dirname(path.dirname(modfile)), owned.path);
      assert.notEqual(path.dirname(modfile), source);
      assert.deepEqual(await readFile(modfile), original["go.mod"]);
      const sumfile = modfile.replace(/\.mod$/u, ".sum");
      assert.deepEqual(await readFile(sumfile), original["go.sum"]);
      await writeFile(sumfile, "original sum\nextra downloaded sum\n");
      return "verified closure";
    }), "verified closure");
    await assertClean();
    const failure = new Error("module closure mismatch");
    await assert.rejects(withOrasModuleSnapshot(source, owned.path, async () => { throw failure; }), (error) => error === failure);
    await assertClean();
    for (const file of ["go.mod", "go.sum"]) {
      await assert.rejects(withOrasModuleSnapshot(source, owned.path, async () => {
        await writeFile(path.join(source, file), "mutated source");
      }), /oras_module_verification_changed_source/u);
      await reset();
      await assertClean();
    }
    for (const file of ["go.work", "go.work.sum"]) {
      await assert.rejects(withOrasModuleSnapshot(source, owned.path, async () => {
        await writeFile(path.join(source, file), "unexpected workspace");
      }), /oras_module_workspace_refused/u);
      await assert.rejects(withOrasModuleSnapshot(source, owned.path, async () => {
        assert.fail("existing workspace must refuse before operation");
      }), /oras_module_workspace_refused/u);
      await unlink(path.join(source, file));
      await assertClean();
    }
    for (const file of ["go.work", "go.work.sum"]) {
      await assert.rejects(withOrasModuleSnapshot(source, owned.path, async () => {
        await writeFile(path.join(owned.path, file), "unexpected ancestor workspace");
      }), /oras_module_workspace_refused/u);
      await assert.rejects(withOrasUpstreamIntegrity(source, async () => {
        assert.fail("ancestor workspace must refuse before make");
      }), /oras_module_workspace_refused/u);
      await unlink(path.join(owned.path, file));
      await assertClean();
      for (const fails of [false, true]) {
        await assert.rejects(withOrasUpstreamIntegrity(source, async () => {
          await writeFile(path.join(owned.path, file), "unexpected ancestor workspace");
          if (fails) throw new Error("make failed");
        }), /oras_module_workspace_refused/u);
        await unlink(path.join(owned.path, file));
        await assertClean();
      }
    }
  } finally {
    await removeOwnedDirectory(owned);
  }
});

test("ORAS upstream integrity refuses new workspaces or module edits even after a failed make", async () => {
  const owned = await createOwnedDirectory();
  const original = { "go.mod": "module example.invalid\n", "go.sum": "original sum\n" };
  const failure = new Error("make failed");
  const reset = async () => {
    for (const [file, bytes] of Object.entries(original)) await writeFile(path.join(owned.path, file), bytes);
  };
  try {
    await reset();
    assert.equal(await withOrasUpstreamIntegrity(owned.path, async () => "make passed"), "make passed");
    await assert.rejects(withOrasUpstreamIntegrity(owned.path, async () => { throw failure; }), (error) => error === failure);
    for (const fails of [false, true]) {
      for (const file of ["go.work", "go.work.sum", "go.mod", "go.sum"]) {
        const workspaceFile = file.startsWith("go.work");
        await assert.rejects(withOrasUpstreamIntegrity(owned.path, async () => {
          await writeFile(path.join(owned.path, file), "unexpected module input\n");
          if (fails) throw failure;
        }), workspaceFile ? /oras_module_workspace_refused/u : /oras_upstream_test_changed_module_lock/u);
        if (workspaceFile) {
          await assert.rejects(withOrasUpstreamIntegrity(owned.path, async () => {
            assert.fail("workspace present before make");
          }), /oras_module_workspace_refused/u);
          await unlink(path.join(owned.path, file));
        }
        await reset();
      }
    }
  } finally {
    await removeOwnedDirectory(owned);
  }
});

test("lock proposal CLI accepts only the bounded explicit contract", () => {
  const parsed = parseLockUpdateArgs([
    "propose", "--tool", "cosign", "--workspace", path.join(root, ".tmp-proposal"),
    "--output", path.join(root, ".tmp-proposal.json"),
  ]);
  assert.equal(parsed.command, "propose");
  assert.equal(parsed.tool, "cosign");
  assert.throws(() => parseLockUpdateArgs([
    "propose", "--tool", "cosign", "--workspace", path.join(root, ".tmp"),
    "--output", path.join(root, ".tmp.json"), "--token", "SENTINEL",
  ]), (error) => {
    assert.equal(error.message.includes("SENTINEL"), false);
    assert.equal(error.message.includes("token"), false);
    return true;
  });
});

test("lock merge requires three explicit absolute proposal paths", () => {
  const output = path.join(root, ".tmp-lock.json");
  assert.doesNotThrow(() => parseLockUpdateArgs([
    "merge", "--proposal", path.join(root, "oras.json"), "--proposal", path.join(root, "cosign.json"),
    "--proposal", path.join(root, "trivy.json"), "--output", output,
  ]));
  assert.throws(() => parseLockUpdateArgs(["merge", "--proposal", path.join(root, "oras.json"), "--output", output]), /merge_arguments_invalid/u);
});

test("Git source inventory refuses traversal, links, gitlinks and duplicates before checkout", () => {
  const blob = `100644 blob ${"a".repeat(40)}      12\tcmd/main.go\0`;
  assert.doesNotThrow(() => validateGitTree(Buffer.from(blob)));
  for (const hostile of [
    `100644 blob ${"a".repeat(40)} 12\t../outside\0`,
    `120000 blob ${"a".repeat(40)} 12\tlinked\0`,
    `160000 commit ${"a".repeat(40)} -\tsubmodule\0`,
    `${blob}${blob}`,
    `100644 blob ${"a".repeat(40)} 12\tline\nbreak\0`,
  ]) assert.throws(() => validateGitTree(Buffer.from(hostile)), /source_git_tree_(entry|path|symlink)_refused/u);
  assert.throws(() => validateGitTree(Buffer.from([0xff, 0x00])), /encoding_invalid/u);
});

test("Git source inventory accepts only an exact reviewed symlink identity", () => {
  const link = { path: "pkg/testdata/symlink", target: "foo", blob: "b".repeat(40), size: 3 };
  const record = `120000 blob ${link.blob}       3\t${link.path}\0`;
  assert.doesNotThrow(() => validateGitTree(Buffer.from(record), [link]));
  assert.throws(() => validateGitTree(Buffer.from(record)), /symlink_refused/u);
  assert.throws(() => validateGitTree(Buffer.from(record), [{ ...link, blob: "c".repeat(40) }]), /symlink_refused/u);
  assert.throws(() => validateGitTree(Buffer.from(`100644 blob ${"a".repeat(40)} 1\tregular\0`), [link]), /symlink_missing/u);
});

test("native build CLI has no target, activation, registry or credential input", () => {
  const args = parseNativeBuildArgs([
    "build", "--tool", "cosign", "--lock", lock, "--workspace", path.join(root, ".tmp-build"),
    "--output", path.join(root, ".tmp-build.json"), "--repeat", "2",
  ]);
  assert.equal(args.tool, "cosign");
  assert.equal(args.repeat, 2);
  for (const forbidden of ["target", "activate", "registry", "token", "key"]) {
    assert.throws(() => parseNativeBuildArgs([
      "build", "--tool", "oras", "--lock", lock, "--workspace", path.join(root, ".tmp-build"),
      "--output", path.join(root, ".tmp-build.json"), "--repeat", "1", `--${forbidden}`, "SENTINEL",
    ]), (error) => {
      assert.equal(error.message.includes("SENTINEL"), false);
      assert.equal(error.message.includes(forbidden), false);
      return true;
    });
  }
});

test("native candidate execution refuses a non-owned workspace before reading inputs", async () => {
  const expected = process.platform === "linux" && process.env.GITHUB_ACTIONS === "true" && process.env.ImageVersion
    ? /native_build_owned_path_invalid/u
    : /requires_secret_free_github_actions_linux/u;
  await assert.rejects(
    buildNativeCandidate({ tool: "oras", lock, workspace: path.join(root, ".tmp-build"), output: path.join(root, ".tmp-build.json"), repeat: 1 }),
    expected,
  );
});
