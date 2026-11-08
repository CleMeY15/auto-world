import assert from "node:assert/strict";
import test from "node:test";
import { openWebApplication } from "./runtime.mjs";
import { WEB_PROJECTION, WEB_SEED_INVOCATION } from "./profile.mjs";

test("web composition uses fixed local mode and closes only owned web then API resources", async () => {
  const calls = [];
  const app = await openWebApplication({}, { seed: true }, {
    assertWebPortAvailable: async () => calls.push("port"),
    openApplication: async (_state, options) => {
      assert.equal(options.port, 3211); assert.equal(options.projectionV2, WEB_PROJECTION);
      assert.equal(options.webSeed.invocationKey, WEB_SEED_INVOCATION); assert.equal(options.seed, true);
      calls.push("api"); return { port: 3211, close: async () => calls.push("api:close") };
    }, startWebProcess: async () => { calls.push("web"); return { url: "http://127.0.0.1:3111/demo", close: async () => calls.push("web:close") }; },
  });
  assert.equal(app.webUrl, "http://127.0.0.1:3111/demo");
  const first = app.close(); assert.equal(app.close(), first); await first;
  assert.deepEqual(calls, ["port", "api", "web", "web:close", "api:close"]);
});

test("occupied web port fails before opening or seeding API; wrong fixed port is rejected", async () => {
  let opened = false;
  await assert.rejects(openWebApplication({}, {}, {
    assertWebPortAvailable: async () => { throw new Error("busy"); },
    openApplication: async () => { opened = true; },
  }), /busy/u);
  assert.equal(opened, false);
  await assert.rejects(openWebApplication({}, { port: 3210 }), /prototype_web_fixed_port_required/u);
});

test("Next startup failure closes the API without touching any project volumes", async () => {
  let closed = 0;
  await assert.rejects(openWebApplication({}, {}, {
    assertWebPortAvailable: async () => {},
    openApplication: async () => ({ close: async () => { closed += 1; } }),
    startWebProcess: async () => { throw new Error("web_failed"); },
  }), /web_failed/u);
  assert.equal(closed, 1);
});
