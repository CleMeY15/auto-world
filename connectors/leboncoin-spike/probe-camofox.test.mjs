import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { classifyCamofox, probeOnce, stopOwnedProcesses } from "./probe-camofox.mjs";

const URL = "https://www.leboncoin.fr/ad/voitures/3305814470";
const USER_ID = "autofindex-camofox-probe";

test("cleanup terminates a real detached descendant, not only the server process group", { timeout: 8000 }, async () => {
  const program = `const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    child.once('spawn', () => process.stdout.write(String(child.pid) + '\\n'));
    setInterval(() => {}, 1000);`;
  const parent = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "ignore"] });
  let childPid;
  try {
    const [chunk] = await once(parent.stdout, "data");
    childPid = Number(chunk.toString("utf8").trim());
    assert.ok(Number.isSafeInteger(childPid) && childPid > 1);
    const result = await stopOwnedProcesses(parent.pid);
    assert.equal(result.established, true);
    assert.equal(result.remaining, 0);
    assert.ok(result.tracked >= 2);
    const stat = await readFile(`/proc/${childPid}/stat`, "utf8").catch(() => null);
    assert.ok(stat === null || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z "));
  } finally {
    for (const pid of [childPid, parent.pid]) {
      if (Number.isSafeInteger(pid) && pid > 1) { try { process.kill(pid, "SIGKILL"); } catch { /* Fixture already gone. */ } }
    }
  }
});

// These records are fabricated contract examples, not captures or access evidence.
function listingRecord() {
  return {
    api_status: 200,
    navigation: { httpStatus: 200, url: URL, navigationOk: true },
    dom: {
      url: URL,
      title: "Annonce automobile de test",
      text: "Annonce automobile de test — 146 990 €",
      listing: { titles: ["Annonce automobile de test"], prices: ["146\u202f990\u00a0€"] },
      frames: [],
    },
    snapshot: { snapshot: "Annonce automobile de test — 146 990 €", truncated: false },
    stage: "complete",
  };
}

function fakeApi({ destinationStatus = 200, failAt = null } = {}) {
  const calls = [];
  const api = async (method, path, body, timeout) => {
    calls.push({ method, path, body, timeout });
    if (method === "POST" && path === "/tabs") {
      if (failAt === "create") throw new Error("synthetic_create_failure");
      return { status: 200, data: { ok: true, tabId: "test-tab", url: URL,
        httpStatus: destinationStatus, navigationOk: destinationStatus < 400 } };
    }
    if (method === "GET" && path.startsWith("/tabs/test-tab/snapshot")) {
      if (failAt === "snapshot") throw new Error("synthetic_snapshot_failure");
      return { status: 200, data: listingRecord().snapshot };
    }
    if (method === "POST" && path === "/tabs/test-tab/evaluate") {
      if (failAt === "evaluate") throw new Error("synthetic_evaluate_failure");
      return { status: 200, data: { ok: true, result: listingRecord().dom } };
    }
    throw new Error("unexpected_test_api_operation");
  };
  return { api, calls };
}

test("a destination 200 with exact URLs, one title and one EUR sale price qualifies only as a listing page", () => {
  assert.equal(classifyCamofox(listingRecord()), "listing_page_observed");
});

test("REST API 200 and navigationOk alone do not prove a successful destination response", () => {
  for (const status of [null, undefined]) {
    const record = listingRecord();
    record.navigation.httpStatus = status;
    assert.equal(classifyCamofox(record), "partial_or_unknown");
  }
  assert.notEqual(classifyCamofox({ api_status: 200, stage: "complete" }), "listing_page_observed");
});

test("missing or unsuccessful API status cannot certify an otherwise listing-like record", () => {
  for (const apiStatus of [null, 500]) {
    const record = listingRecord();
    record.api_status = apiStatus;
    assert.equal(classifyCamofox(record), "partial_or_unknown");
  }
});

test("snapshot completeness must be explicitly established", () => {
  for (const truncated of [true, undefined]) {
    const record = listingRecord();
    record.snapshot.truncated = truncated;
    assert.equal(classifyCamofox(record), "partial_or_unknown");
  }
});

test("destination 403 or 429 takes priority over stale listing fields and API success", () => {
  for (const status of [403, 429]) {
    const record = listingRecord();
    record.navigation.httpStatus = status;
    record.navigation.navigationOk = false;
    assert.equal(classifyCamofox(record), "source_refused");
  }
});

test("both the final navigation URL and observed DOM URL must match the expected listing", () => {
  for (const property of ["navigation", "dom"]) {
    const record = listingRecord();
    record[property].url = "https://www.leboncoin.fr/ad/voitures/3305814471";
    assert.equal(classifyCamofox(record), "partial_or_unknown");
  }
});

test("missing, empty or multiple titles cannot qualify as one observed listing", () => {
  for (const titles of [[], ["   "], ["Premier titre", "Autre titre"]]) {
    const record = listingRecord();
    record.dom.listing.titles = titles;
    assert.equal(classifyCamofox(record), "partial_or_unknown");
  }
});

test("missing or multiple prices are not a single observed sale price", () => {
  for (const prices of [[], [""], ["146 990 €", "119 900 €"]]) {
    const record = listingRecord();
    record.dom.listing.prices = prices;
    assert.equal(classifyCamofox(record), "partial_or_unknown");
  }
});

test("monthly payments, foreign currencies and malformed money are not EUR sale prices", () => {
  for (const price of ["990 €/mois", "990 € / mois", "146 990 $", "146 990", "-1 €", "12 34 €", "1,234 €"]) {
    const record = listingRecord();
    record.dom.listing.prices = [price];
    assert.equal(classifyCamofox(record), "partial_or_unknown", price);
  }
});

test("visible verification text takes priority over apparently valid listing fields", () => {
  const record = listingRecord();
  record.dom.text = "Please verify you are human before continuing.";
  assert.equal(classifyCamofox(record), "verification_present");
});

test("a visible challenge frame prevents a listing-page verdict", () => {
  const record = listingRecord();
  record.dom.frames = [{ title: "CAPTCHA verification", src: "https://geo.captcha-delivery.com/captcha/test", visible: true }];
  assert.equal(classifyCamofox(record), "verification_present");
});

test("an error before any navigation is an environment error, not a source refusal", () => {
  assert.equal(classifyCamofox({ api_status: null, navigation: null, dom: null, snapshot: null,
    stage: "create", error: "synthetic_create_failure" }), "environment_error");
});

test("probeOnce creates one fixed tab and reads that tab through snapshot and evaluate", async () => {
  const { api, calls } = fakeApi();
  const record = await probeOnce(api);
  const creations = calls.filter((call) => call.method === "POST" && call.path === "/tabs");
  assert.equal(creations.length, 1);
  assert.deepEqual(creations[0].body, { userId: USER_ID, sessionKey: "single", url: URL });
  assert.equal(calls.filter((call) => call.method === "GET" && call.path.startsWith("/tabs/test-tab/snapshot")).length, 1);
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/tabs/test-tab/evaluate").length, 1);
  assert.equal(calls.some((call) => /\/(?:navigate|refresh|back|forward)(?:\?|$)/u.test(call.path)), false);
  assert.equal(classifyCamofox(record), "listing_page_observed");
  for (const call of calls) assert.equal(Number.isFinite(call.timeout) && call.timeout > 0, true);
});

test("a 403 never triggers another tab creation even when the read endpoints return listing-like content", async () => {
  const { api, calls } = fakeApi({ destinationStatus: 403 });
  const record = await probeOnce(api);
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/tabs").length, 1);
  assert.equal(classifyCamofox(record), "source_refused");
});

test("a failed tab creation is returned as an environment error without a retry", async () => {
  const { api, calls } = fakeApi({ failAt: "create" });
  const record = await probeOnce(api);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/tabs");
  assert.equal(classifyCamofox(record), "environment_error");
});

test("probeOnce does not turn an omitted server truncation flag into a complete snapshot", async () => {
  const { api } = fakeApi();
  const record = await probeOnce(async (...args) => {
    const response = await api(...args);
    if (args[0] === "GET" && args[1].startsWith("/tabs/test-tab/snapshot")) delete response.data.truncated;
    return response;
  });
  assert.notEqual(classifyCamofox(record), "listing_page_observed");
});

test("snapshot or evaluate failure cannot trigger another navigation or claim a listing page", async () => {
  for (const failAt of ["snapshot", "evaluate"]) {
    const { api, calls } = fakeApi({ failAt });
    const record = await probeOnce(api);
    assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/tabs").length, 1);
    assert.equal(calls.some((call) => /\/(?:navigate|refresh|back|forward)(?:\?|$)/u.test(call.path)), false);
    assert.notEqual(classifyCamofox(record), "listing_page_observed");
  }
});
