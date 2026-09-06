import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand } from "../scripts/data-infra/cli.mjs";

test("infra CLI accepts only documented scoped commands and relevant options", () => {
  assert.equal(parseCommand(["migrate", "--direction", "down"]).direction, "down");
  assert.deepEqual(parseCommand(["stop", "--service", "redis"]).services, ["redis"]);
  for (const args of [[], ["prune"], ["up", "--file", "/other"], ["up", "--direction", "down"], ["stop", "--service", "unknown"], ["up", "--project"], ["restore-check"], ["reset", "--project", "aw-local-a", "--project", "aw-local-b"]]) {
    assert.throws(() => parseCommand(args));
  }
});
