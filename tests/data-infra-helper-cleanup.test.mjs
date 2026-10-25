import assert from "node:assert/strict";
import { test } from "node:test";
import { removeOwnedHelper } from "../scripts/data-infra/helper-cleanup.mjs";

test("helper cleanup observes stable absence and removes a late materialized owned container", async () => {
  const states = ["", "a".repeat(64), "", ""];
  const calls = [];
  let pauses = 0;
  await removeOwnedHelper("aw-helper-synthetic", "owner", {
    pause: async () => { pauses += 1; },
    runProcess: async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: args[0] === "container" ? states.shift() : args[0] === "inspect" ? "owner" : "", stderr: "" };
    },
  });
  assert.equal(states.length, 0);
  assert.equal(pauses, 2);
  assert.deepEqual(calls.filter((args) => args[0] === "rm"), [["rm", "-f", "a".repeat(64)]]);
});

test("helper cleanup refuses foreign ownership and failed absence queries", async () => {
  for (const queryFailure of [false, true]) {
    const calls = [];
    await assert.rejects(removeOwnedHelper("aw-helper-synthetic", "owner", {
      pause: async () => {},
      runProcess: async (_command, args) => {
        calls.push(args);
        return { code: queryFailure ? 1 : 0, stdout: args[0] === "container" ? "a".repeat(64) : "different-owner", stderr: "private" };
      },
    }), /infra_helper_cleanup_unowned|infra_helper_cleanup_unverified/u);
    assert.equal(calls.some((args) => args[0] === "rm"), false);
  }
});
