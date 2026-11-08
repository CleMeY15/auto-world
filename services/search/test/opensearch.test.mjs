import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE, SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE } from "@auto-world/synthetic-connector/demo";
import { createOpenSearch } from "../.prototype-dist/opensearch.js";

const INDEX = `aw-v1-search-${"a".repeat(32)}`;
const listingId = (digit) => `lst_${digit.repeat(64)}`;
const evidenceId = (digit) => `ev_${digit.repeat(64)}`;

function result(digit = "1", mileage = 12.5) {
  return {
    listingId: listingId(digit),
    availability: "active",
    price: { status: "observed", value: { amountMinor: 12_345, currency: "EUR" }, evidenceId: evidenceId(digit) },
    mileage: { status: "observed", value: { amount: mileage, unit: "km" }, evidenceId: evidenceId(digit === "1" ? "2" : "3") },
    evidence: [
      { evidenceId: evidenceId(digit), field: "price", observedAt: "2026-01-01T00:00:00.000Z", confidenceBps: 9_000, value: { amountMinor: 12_345, currency: "EUR" } },
      { evidenceId: evidenceId(digit === "1" ? "2" : "3"), field: "mileage", observedAt: "2026-01-01T00:00:01.000Z", confidenceBps: 9_000, value: { amount: mileage, unit: "km" } },
    ],
  };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    await run(address.port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function indexed(document) {
  return {
    publicDto: document,
    listingId: document.listingId,
    availability: document.availability,
    ...(document.price.status === "observed" && document.price.value.currency === "EUR" ? { priceEUR: document.price.value.amountMinor } : {}),
    ...(document.mileage.status === "observed" && document.mileage.value.unit === "km" ? { mileageKm: document.mileage.value.amount } : {}),
  };
}

function searchResponse(documents, alter = (source) => source) {
  return {
    timed_out: false,
    _shards: { failed: 0 },
    hits: { total: { value: documents.length, relation: "eq" }, hits: documents.map((document) => ({ _id: document.listingId, _source: alter(indexed(document)) })) },
  };
}

function resultV2() {
  const base = result();
  const make = SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.makes[0];
  const model = SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.models.find((candidate) => candidate.makeId === make.makeId);
  const value = { release: SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE, makeId: make.makeId, modelId: model.modelId,
    firstRegistrationYear: 2024, attribution: { kind: "synthetic_fixture", fixtureRef: "prototype-web/page-0001.json" } };
  const id = `de_${"4".repeat(64)}`;
  return { ...base, description: { status: "authored_synthetic", value, evidenceId: id },
    descriptionEvidence: [{ evidenceId: id, capturedAt: "2026-01-01T00:00:00.000Z", value }] };
}

function indexedV2(document) {
  return { ...indexed(document), publicDto: document, makeId: document.description.value.makeId,
    modelId: document.description.value.modelId, firstRegistrationYear: document.description.value.firstRegistrationYear };
}

test("build uses a strict versioned mapping, bounded bulk DTOs, refresh and full verification", async () => {
  const document = result();
  const seen = [];
  await withServer(async (request, response) => {
    const requestBody = await body(request);
    seen.push({ url: request.url, method: request.method, body: requestBody });
    response.setHeader("content-type", "application/json");
    if (request.url === `/${INDEX}`) response.end(JSON.stringify({ acknowledged: true }));
    else if (request.url === `/${INDEX}/_bulk`) response.end(JSON.stringify({ errors: false, items: [{ index: { status: 201 } }] }));
    else if (request.url === `/${INDEX}/_refresh`) response.end(JSON.stringify({ _shards: { failed: 0 } }));
    else if (request.url === `/${INDEX}/_settings` && request.method === "PUT") response.end(JSON.stringify({ acknowledged: true }));
    else if (request.url === `/${INDEX}/_settings?flat_settings=true`) response.end(JSON.stringify({ [INDEX]: { settings: { "index.blocks.write": "true", "index.number_of_shards": "1" } } }));
    else response.end(JSON.stringify(searchResponse([document])));
  }, async (port) => {
    await createOpenSearch({ port }).build(INDEX, [document], new globalThis.AbortController().signal);
  });

  const mapping = JSON.parse(seen[0].body);
  assert.equal(mapping.mappings.dynamic, "strict");
  assert.deepEqual(mapping.mappings._meta, { mappingVersion: 1, projectionProfile: "synthetic-search-v1", generation: INDEX });
  assert.equal(mapping.mappings.properties.publicDto.enabled, false);
  const bulk = seen.find((entry) => entry.url.endsWith("/_bulk"));
  assert.ok(Buffer.byteLength(bulk.body) <= 1024 * 1024);
  const source = JSON.parse(bulk.body.trim().split("\n")[1]);
  assert.deepEqual(Object.keys(source).sort(), ["availability", "listingId", "mileageKm", "priceEUR", "publicDto"]);
  assert.equal(source.mileageKm, 12.5);
  assert.ok(seen.some((entry) => entry.url.endsWith("/_refresh")));
  const block = seen.find((entry) => entry.url.endsWith("/_settings") && entry.method === "PUT");
  assert.deepEqual(JSON.parse(block.body), { "index.blocks.write": true });
  assert.ok(seen.some((entry) => entry.url.includes("allow_partial_search_results=false")));
});

test("search sends exact-count active filters and missing-last deterministic sort", async () => {
  const document = result();
  let sent;
  await withServer(async (request, response) => {
    sent = JSON.parse(await body(request));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(searchResponse([document])));
  }, async (port) => {
    const found = await createOpenSearch({ port }).search(INDEX, { schemaVersion: 1, sort: "mileage_desc", priceMaxMinor: 20_000, mileageMaxKm: 50.5 }, 0, new globalThis.AbortController().signal);
    assert.equal(found.total, 1);
    assert.equal(found.results[0].listingId, document.listingId);
  });
  assert.equal(sent.track_total_hits, true);
  assert.deepEqual(sent.query.bool.filter, [
    { term: { availability: "active" } },
    { range: { priceEUR: { lte: 20_000 } } },
    { range: { mileageKm: { lte: 50.5 } } },
  ]);
  assert.deepEqual(sent.sort, [{ mileageKm: { order: "desc", missing: "_last" } }, { listingId: { order: "asc" } }]);
});

test("V2 search validates exact derived taxonomy fields and sends all public filters", async () => {
  const index = `aw-v2-search-${"b".repeat(32)}`;
  const document = resultV2();
  let sent;
  await withServer(async (request, response) => {
    sent = JSON.parse(await body(request));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ timed_out: false, _shards: { failed: 0 }, hits: { total: { value: 1, relation: "eq" },
      hits: [{ _id: document.listingId, _source: indexedV2(document) }] } }));
  }, async (port) => {
    const found = await createOpenSearch({ port }).searchV2(index, { schemaVersion: 2, sort: "price_asc",
      makeId: document.description.value.makeId, modelId: document.description.value.modelId,
      firstRegistrationYear: 2024 }, 0, new globalThis.AbortController().signal);
    assert.equal(found.total, 1);
  });
  assert.deepEqual(sent.query.bool.filter.slice(-3), [{ term: { makeId: document.description.value.makeId } },
    { term: { modelId: document.description.value.modelId } }, { term: { firstRegistrationYear: 2024 } }]);
});

test("V2 build seals a distinct mapping with exact profile and derived taxonomy fields", async () => {
  const index = `aw-v2-search-${"b".repeat(32)}`;
  const profile = `prf_${"c".repeat(64)}`;
  const document = resultV2();
  const seen = [];
  await withServer(async (request, response) => {
    const requestBody = await body(request);
    seen.push({ url: request.url, method: request.method, body: requestBody });
    response.setHeader("content-type", "application/json");
    if (request.url === `/${index}`) response.end(JSON.stringify({ acknowledged: true }));
    else if (request.url === `/${index}/_bulk`) response.end(JSON.stringify({ errors: false, items: [{ index: { status: 201 } }] }));
    else if (request.url === `/${index}/_refresh`) response.end(JSON.stringify({ _shards: { failed: 0 } }));
    else if (request.url === `/${index}/_settings` && request.method === "PUT") response.end(JSON.stringify({ acknowledged: true }));
    else if (request.url === `/${index}/_settings?flat_settings=true`) response.end(JSON.stringify({ [index]: { settings: { "index.blocks.write": "true" } } }));
    else if (request.url === `/${index}/_mapping?filter_path=*.mappings._meta`) response.end(JSON.stringify({ [index]: { mappings: {
      _meta: { mappingVersion: 2, profileFingerprint: profile, generation: index },
    } } }));
    else response.end(JSON.stringify({ timed_out: false, _shards: { failed: 0 }, hits: { total: { value: 1, relation: "eq" },
      hits: [{ _id: document.listingId, _source: indexedV2(document) }] } }));
  }, async (port) => createOpenSearch({ port }).buildV2(index, [document], profile, new globalThis.AbortController().signal));
  const mapping = JSON.parse(seen[0].body).mappings;
  assert.deepEqual(mapping._meta, { mappingVersion: 2, profileFingerprint: profile, generation: index });
  assert.deepEqual(Object.keys(mapping.properties).sort(), ["availability", "firstRegistrationYear", "listingId", "makeId", "mileageKm", "modelId", "priceEUR", "publicDto"]);
  const source = JSON.parse(seen.find((entry) => entry.url.endsWith("/_bulk")).body.trim().split("\n")[1]);
  assert.deepEqual(source, indexedV2(document));
});

test("V2 verification refuses absent, mismatched or extra ownership metadata", async () => {
  const index = `aw-v2-search-${"b".repeat(32)}`;
  const profile = `prf_${"c".repeat(64)}`;
  const document = resultV2();
  for (const meta of [undefined,
    { mappingVersion: 2, profileFingerprint: `prf_${"d".repeat(64)}`, generation: index },
    { mappingVersion: 2, profileFingerprint: profile, generation: index, extra: true }]) {
    await withServer(async (request, response) => {
      await body(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ [index]: { mappings: meta === undefined ? {} : { _meta: meta } } }));
    }, async (port) => {
      assert.equal(await createOpenSearch({ port }).verifyV2(index, [document], profile, new globalThis.AbortController().signal), false);
    });
  }
});

test("detail rejects inconsistent totals and a different listing instead of inventing absence", async () => {
  for (const returned of [
    { ...searchResponse([]), hits: { total: { value: 1, relation: "eq" }, hits: [] } },
    searchResponse([result("2")]),
  ]) {
    await withServer(async (request, response) => {
      await body(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(returned));
    }, async (port) => {
      await assert.rejects(createOpenSearch({ port }).detail(INDEX, listingId("1"), new globalThis.AbortController().signal),
        (error) => error?.code === "search_unavailable");
    });
  }
});

test("partial shard and timeout results fail closed", async () => {
  await withServer(async (request, response) => {
    await body(request);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ timed_out: true, _shards: { failed: 1 }, hits: { total: { value: 0, relation: "eq" }, hits: [] } }));
  }, async (port) => {
    await assert.rejects(
      createOpenSearch({ port }).search(INDEX, { schemaVersion: 1, sort: "listing_asc" }, 0, new globalThis.AbortController().signal),
      (error) => error?.code === "search_unavailable",
    );
  });
});

test("verification reports a confirmed derived-field corruption as a repairable mismatch", async () => {
  const document = result();
  await withServer(async (request, response) => {
    await body(request);
    response.setHeader("content-type", "application/json");
    if (request.url === `/${INDEX}/_settings?flat_settings=true`) response.end(JSON.stringify({ [INDEX]: { settings: { "index.blocks.write": "true", "index.number_of_shards": "1" } } }));
    else response.end(JSON.stringify(searchResponse([document], (source) => ({ ...source, priceEUR: source.priceEUR + 1 }))));
  }, async (port) => {
    assert.equal(await createOpenSearch({ port }).verify(INDEX, [document], new globalThis.AbortController().signal), false);
  });
});

test("verification still throws for a malformed search transport response", async () => {
  const document = result();
  await withServer(async (request, response) => {
    await body(request);
    response.setHeader("content-type", "application/json");
    if (request.url === `/${INDEX}/_settings?flat_settings=true`) response.end(JSON.stringify({ [INDEX]: { settings: { "index.blocks.write": "true" } } }));
    else response.end(JSON.stringify({ timed_out: false, _shards: { failed: 0 }, hits: { total: { value: 1, relation: "eq" }, hits: [{ _id: document.listingId, _source: null }] } }));
  }, async (port) => {
    await assert.rejects(
      createOpenSearch({ port }).verify(INDEX, [document], new globalThis.AbortController().signal),
      (error) => error?.code === "search_unavailable",
    );
  });
});

test("verify distinguishes an acknowledged missing index from unavailable or malformed state", async (t) => {
  await t.test("missing", async () => {
    await withServer(async (request, response) => {
      await body(request);
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "index_not_found_exception" }, status: 404 }));
    }, async (port) => {
      assert.equal(await createOpenSearch({ port }).verify(INDEX, [], new globalThis.AbortController().signal), false);
    });
  });
  await t.test("malformed 404", async () => {
    await withServer(async (request, response) => {
      await body(request);
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "other" }, status: 404 }));
    }, async (port) => {
      await assert.rejects(createOpenSearch({ port }).verify(INDEX, [], new globalThis.AbortController().signal), (error) => error?.code === "search_unavailable");
    });
  });
});

test("remove is explicit, acknowledged and idempotent only for index-not-found", async (t) => {
  await t.test("acknowledged delete", async () => {
    const methods = [];
    await withServer(async (request, response) => {
      methods.push(request.method);
      await body(request);
      response.setHeader("content-type", "application/json");
      if (request.url.includes("/_mapping?")) response.end(JSON.stringify({ [INDEX]: { mappings: { _meta: { mappingVersion: 1, projectionProfile: "synthetic-search-v1", generation: INDEX } } } }));
      else response.end(JSON.stringify({ acknowledged: true }));
    }, async (port) => createOpenSearch({ port }).remove(INDEX, new globalThis.AbortController().signal));
    assert.deepEqual(methods, ["GET", "DELETE"]);
  });
  await t.test("already absent", async () => {
    await withServer(async (request, response) => {
      await body(request);
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { type: "index_not_found_exception" }, status: 404 }));
    }, async (port) => createOpenSearch({ port }).remove(INDEX, new globalThis.AbortController().signal));
  });
  await t.test("foreign mapping refused", async () => {
    const methods = [];
    await withServer(async (request, response) => {
      methods.push(request.method);
      await body(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ [INDEX]: { mappings: { _meta: { mappingVersion: 1, projectionProfile: "other", generation: INDEX } } } }));
    }, async (port) => {
      await assert.rejects(createOpenSearch({ port }).remove(INDEX, new globalThis.AbortController().signal), (error) => error?.code === "search_unavailable");
    });
    assert.deepEqual(methods, ["GET"]);
  });
});

test("bulk item failures, redirects and oversized responses fail closed", async (t) => {
  const document = result();
  await t.test("bulk error", async () => {
    await withServer(async (request, response) => {
      await body(request);
      response.setHeader("content-type", "application/json");
      if (request.url === `/${INDEX}`) response.end(JSON.stringify({ acknowledged: true }));
      else response.end(JSON.stringify({ errors: true, items: [{ index: { status: 400, error: { type: "mapper" } } }] }));
    }, async (port) => {
      await assert.rejects(createOpenSearch({ port }).build(INDEX, [document], new globalThis.AbortController().signal));
    });
  });
  await t.test("redirect", async () => {
    await withServer(async (request, response) => {
      await body(request);
      response.writeHead(302, { location: `/${INDEX}/_search` });
      response.end();
    }, async (port) => {
      await assert.rejects(createOpenSearch({ port }).search(INDEX, { schemaVersion: 1, sort: "listing_asc" }, 0, new globalThis.AbortController().signal));
    });
  });
  await t.test("oversized response", async () => {
    await withServer(async (request, response) => {
      await body(request);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ padding: "a".repeat(1024 * 1024) }));
    }, async (port) => {
      await assert.rejects(createOpenSearch({ port }).build(INDEX, [], new globalThis.AbortController().signal));
    });
  });
});
