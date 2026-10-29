import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedDockerCleanupRegistry, validateOwnedImageAbsence } from "../scripts/scanner/owned-cleanup.mjs";

const owner = "12345678-1234-1234-1234-123456789abc";
const name = "aw-official-12345678-1234-1234-1234-123456789abc";
const id = "a".repeat(64);
const imageId = `sha256:${id}`;
const tag = `auto-world-managed/postgres:${"b".repeat(40)}`;
const bytes = (value) => Buffer.from(value);
const missing = (kind, target) => ({ status: 1, signal: null, error: null, stdout: Buffer.alloc(0),
  stderr: bytes(`Error response from daemon: No such ${kind}: ${target}\n`) });
const ok = (value = "") => ({ status: 0, signal: null, error: null, stdout: bytes(value), stderr: Buffer.alloc(0) });
const budget = { cleanupCommandTimeoutMs: (cap) => cap };

test("expired cleanup budget still removes the exact owned live container and proves name plus ID absent", () => {
  let live = true; const calls = [];
  const deadline = new Error("scanner_owned_time_budget_refused");
  const registry = createOwnedDockerCleanupRegistry({ budget: { cleanupCommandTimeoutMs: () => { throw deadline; } },
    execute: (args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs }); const target = args.at(-1);
      if (args[0] === "container" && args[1] === "inspect") return live
        ? ok(`${JSON.stringify([{ Name: `/${name}`, Id: id, Config: { Labels: { "io.auto-world.scanner-official": owner } } }])}\n`)
        : missing("container", target);
      if (args[0] === "container" && args[1] === "rm") { live = false; return ok(`${id}\n`); }
      throw new Error("unexpected");
    } });
  registry.registerContainer({ name, owner, id });
  assert.throws(() => registry.cleanupContainer(name), (error) => error === deadline && !error.cleanupErrors?.includes(error));
  assert.equal(live, false); assert.ok(calls.every((call) => call.timeoutMs === 5_000));
  assert.deepEqual(registry.snapshot().containers[0], { name, owner, id, attempted: true, absent: true,
    failure: "scanner_owned_time_budget_refused", budgetFailure: true });
});

test("foreign container and image tag collisions are preserved", () => {
  let removals = 0;
  const registry = createOwnedDockerCleanupRegistry({ budget, execute: (args) => {
    if (args[1] === "inspect" && args[0] === "container") return ok(`${JSON.stringify([{ Name: `/${name}`, Id: id,
      Config: { Labels: { "io.auto-world.scanner-official": "ffffffff-ffff-ffff-ffff-ffffffffffff" } } }])}\n`);
    if (args[1] === "inspect" && args[0] === "image") return ok(`${JSON.stringify([{ Id: `sha256:${id}`, RepoTags: [tag],
      Config: { Labels: { "io.auto-world.scanner-official": "ffffffff-ffff-ffff-ffff-ffffffffffff" } } }])}\n`);
    if (args[1] === "rm") removals += 1;
    return ok();
  } });
  registry.registerContainer({ name, owner }); registry.registerImage({ tag, owner });
  assert.throws(() => registry.cleanupAll(), /scanner_owned_docker_cleanup_owner_mismatch/u);
  assert.equal(removals, 0);
  assert.equal(registry.snapshot().containers[0].absent, false); assert.equal(registry.snapshot().images[0].absent, false);
});

test("an owned image with an extra tag is preserved as potentially shared", () => {
  let removals = 0;
  const registry = createOwnedDockerCleanupRegistry({ budget, execute: (args) => {
    if (args[1] === "inspect") return ok(`${JSON.stringify([{ Id: imageId, RepoTags: [tag, "shared/example:latest"],
      Config: { Labels: { "io.auto-world.scanner-official": owner } } }])}\n`);
    removals += 1; return ok();
  } });
  registry.registerImage({ tag, owner, id: imageId });
  assert.throws(() => registry.cleanupAll(), /scanner_owned_docker_cleanup_owner_mismatch/u);
  assert.equal(removals, 0); assert.equal(registry.snapshot().images[0].absent, false);
});

test("owned image cleanup removes its unique tag and remaining ID then proves both absent", () => {
  let tagLive = true, idLive = true; const removals = [];
  const registry = createOwnedDockerCleanupRegistry({ budget, execute: (args) => {
    const target = args.at(-1);
    if (args[0] === "image" && args[1] === "inspect") {
      if (target === tag) return tagLive ? ok(`${JSON.stringify([{ Id: `sha256:${id}`, RepoTags: [tag],
        Config: { Labels: { "io.auto-world.scanner-official": owner } } }])}\n`) : missing("image", target);
      return idLive ? ok(`${JSON.stringify([{ Id: `sha256:${id}`, RepoTags: [],
        Config: { Labels: { "io.auto-world.scanner-official": owner } } }])}\n`) : missing("image", target);
    }
    if (args[0] === "image" && args[1] === "rm") {
      removals.push(target); if (target === tag) tagLive = false; else idLive = false; return ok();
    }
    throw new Error("unexpected");
  } });
  registry.registerImage({ tag, owner, id: imageId });
  const result = registry.cleanupAll();
  assert.deepEqual(removals, [tag, imageId]);
  assert.deepEqual(result.images[0], { tag, owner, id: imageId, attempted: true, absent: true, failure: null, budgetFailure: false });
  assert.equal(result.attempted, true); assert.equal(result.absent, true);
});

test("image absence accepts only an exact registered-style tag or digest message", () => {
  assert.equal(validateOwnedImageAbsence(missing("image", tag), tag), true);
  assert.equal(validateOwnedImageAbsence(missing("image", imageId), imageId), true);
  assert.equal(validateOwnedImageAbsence({ ...missing("image", tag), stderr: bytes("daemon unavailable\n") }, tag), false);
  assert.equal(validateOwnedImageAbsence(missing("image", `${tag}-other`), tag), false);
});

test("cleanupAll attempts every registered object and preserves the first failure", () => {
  const secondName = "aw-official-ffffffff-ffff-ffff-ffff-ffffffffffff";
  const secondTag = `auto-world-managed/opensearch:${"c".repeat(40)}`;
  const inspected = [];
  const registry = createOwnedDockerCleanupRegistry({ budget, execute: (args) => {
    if (args[1] === "inspect") { inspected.push(args.at(-1)); throw new Error(`inspect_failed:${args.at(-1)}`); }
    throw new Error("unexpected_remove");
  } });
  registry.registerContainer({ name, owner }); registry.registerContainer({ name: secondName, owner });
  registry.registerImage({ tag, owner }); registry.registerImage({ tag: secondTag, owner });
  assert.throws(() => registry.cleanupAll(), (error) => error.message === `inspect_failed:${secondName}` && error.cleanupErrors?.length >= 3 &&
    error.ownedCleanup.containers.length === 2 && error.ownedCleanup.images.length === 2);
  assert.deepEqual(new Set(inspected), new Set([name, secondName, tag, secondTag]));
});

test("historical profile cleanup is synchronous and accepts no budget controller", () => {
  const registry = createOwnedDockerCleanupRegistry({ execute: (args) => missing("container", args.at(-1)) });
  registry.registerContainer({ name, owner });
  const result = registry.cleanupContainer(name);
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(result, { name, owner, id: null, attempted: true, absent: true, failure: null, budgetFailure: false });
  const final = registry.cleanupAll();
  assert.equal(final instanceof Promise, false); assert.equal(final.absent, true);
});
