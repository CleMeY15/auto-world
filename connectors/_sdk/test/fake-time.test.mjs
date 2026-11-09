import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers";
import { test } from "node:test";
import { fakeTime, NOW } from "../test-support/fixtures.mjs";

test("the fixture driver allows native work beyond 20000 event-loop turns", async () => {
  const time = fakeTime();
  let turns = 0;
  const pending = new Promise((resolve) => {
    function step() {
      turns += 1;
      if (turns === 20_001) resolve("native work completed");
      else nextTurn(step);
    }
    nextTurn(step);
  });
  assert.equal(await time.drive(pending), "native work completed");
  assert.equal(turns, 20_001);
  assert.equal(time.clock.nowMs(), NOW);
});

test("the fixture driver times out a pending promise without advancing virtual time", async () => {
  const time = fakeTime();
  let called = false;
  time.scheduler.schedule(1, () => { called = true; });
  await assert.rejects(time.drive(new Promise(() => {}), { autoAdvance: false, timeoutMs: 10 }),
    /synthetic run did not settle within the fixture driver timeout/u);
  assert.equal(time.clock.nowMs(), NOW);
  assert.equal(called, false);
  assert.equal(time.timers.size, 1);
});

test("the fixture driver preserves virtual timer advancement and cancellation", async () => {
  const time = fakeTime();
  const cancelled = time.scheduler.schedule(1, () => { assert.fail("cancelled timer ran"); });
  cancelled.cancel();
  const pending = new Promise((resolve) => time.scheduler.schedule(500, () => resolve("due")));
  assert.equal(await time.drive(pending), "due");
  assert.equal(time.clock.nowMs(), NOW + 500);
  assert.equal(time.timers.size, 0);
});

test("the fixture driver propagates the original rejection", async () => {
  const time = fakeTime();
  const error = new Error("native work failed");
  await assert.rejects(time.drive(Promise.reject(error)), (actual) => actual === error);
});

test("the fixture driver refuses invalid or unbounded wait budgets", async () => {
  for (const timeoutMs of [0, -1, 0.5, 10_001, Infinity, NaN, "10"]) {
    await assert.rejects(fakeTime().drive(Promise.resolve(), { timeoutMs }),
      /invalid fixture driver timeout/u);
  }
});
