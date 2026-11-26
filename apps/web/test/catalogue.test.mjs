import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateCatalogEnabled } from "../.test-dist/src/catalogue/mode.js";
import { resolveDemoBackendMode } from "../.test-dist/src/demo/backend.js";
import { fetchDetail, fetchList, isListingId, pageWindow, readPublication, windowPath } from "../.test-dist/src/catalogue/reader.js";

const item = {
  source_listing_id: "42", source_url: "https://www.leboncoin.fr/ad/voitures/42", source_label: "Leboncoin",
  brand: "Constructeur de test", model: null, year: null, price_amount_minor: null, price_currency: null,
  mileage_km: 0, images: [], observed_at: "2026-01-02T14:00:00.000000+00:00",
};
test("private catalogue keeps the page window in detail and return links", () => {
  assert.equal(isListingId("001"), false);
  assert.equal(isListingId("1/2"), false);
  assert.deepEqual(pageWindow({ after: "10", limit: "100" }), { after: "10", limit: 100 });
  for (const bad of [{ limit: "-1" }, { limit: "0" }, { limit: "101" }, { after: ["10"] }]) assert.equal(pageWindow(bad), null);
  assert.equal(windowPath({ after: "10", limit: 3 }, "42"), "/catalogue/42?after=10&limit=3");
  assert.equal(pageWindow({ q: " A&B " }).q, "A&B");
  assert.equal(pageWindow({ q: " " }).q, undefined);
  assert.equal(pageWindow({ q: "é".repeat(80) }).q.length, 80);
  for (const q of [["duplicate"], "a".repeat(81), "a\nb", "a\0b"]) assert.equal(pageWindow({ q }), null);
  assert.equal(windowPath({ after: "10", limit: 3, q: "A&B / 20" }, "42"), "/catalogue/42?q=A%26B+%2F+20&after=10&limit=3");
});
test("catalogue criteria survive pagination and detail navigation, including zero bounds", () => {
  const query = {brand:"Citroën", priceMin:"0", priceMax:"012345", yearMin:"2000", yearMax:"2022", kmMax:"100000"};
  const criteria = pageWindow(query);
  assert.deepEqual(criteria, { after:undefined, limit:20, brand:"Citroën", priceMin:0, priceMax:12345, yearMin:2000, yearMax:2022, kmMax:100000 });
  const link = windowPath({...criteria, q:"C3", after:"10", limit:8}, "42");
  const url = new URL(link, "https://autofind.tech");
  assert.equal(url.pathname, "/catalogue/42");
  assert.deepEqual(pageWindow(Object.fromEntries(url.searchParams)), {...criteria, q:"C3", after:"10", limit:8});
  assert.equal(windowPath(pageWindow({brand:"", kmMax:"", priceMin:""})), "/catalogue");
  for (const invalid of [{priceMax:"2.50"}, {priceMin:"1&3"}, {priceMin:"2",priceMax:"1"}, {yearMin:"1885"},
    {yearMin:"2021", yearMax:"1999"}, {brand:["DS","Audi"]}, {brand:"<DS>"}, {kmMax:"9007199254740992"}]) {
    assert.equal(pageWindow(invalid), null);
  }
});
test("private catalogue retains unknowns and accepts only the matching Leboncoin source URL", () => {
  assert.equal(readPublication(item).price, null);
  assert.equal(readPublication(item).dateKind, "source_capture");
  assert.equal(readPublication({...item, observed_at_kind:"file_export"}).dateKind, "file_export");
  assert.equal(readPublication(item).km, 0);
  assert.deepEqual(readPublication(item).photos, []);
  const photo = "https://img.leboncoin.fr/api/v1/lbcpb1/images/aa/bb/cc/" + "a".repeat(40) + ".jpg?rule=large";
  assert.deepEqual(readPublication({...item, images:[photo]}).photos, [photo]);
  for (const image of [photo.replace("img.", "evil."), photo.replace("lbcpb1/images", "redirect"), photo + "&url=https://example.org"]) {
    assert.throws(() => readPublication({...item, images:[image]}));
  }
  for (const bad of [{source_url: "https://example.org"}, {source_url: "https://www.leboncoin.fr/ad/voitures/41"},
    {price_currency: "EUR"}, {images: ["javascript:void(0)"]}]) assert.throws(() => readPublication({...item, ...bad}));
});
test("private gallery accepts the three observed CDN paths with a single optional image rule", () => {
  const root = "https://img.leboncoin.fr/api/v1/lbcpb1/images/";
  const uuid = "78c4f2de-4ec6-45a2-8081-ab2e106ad504";
  const prefixed = "gh/4f/65/gh" + "c".repeat(38) + ".jpg";
  const uuidPath = "aa/bb/cc/" + uuid;
  for (const path of ["aa/bb/cc/" + "0".repeat(40) + ".jpg", prefixed, uuidPath]) {
    for (const query of ["", "?rule=ad-large_2"]) {
      const url = root + path + query;
      assert.deepEqual(readPublication({...item, images:[url]}).photos, [url]);
    }
  }
  for (const bad of [prefixed.replace("gh/", "gg/"), prefixed.replace("/gh", "/zz"),
    prefixed.replace(".jpg", ".jpeg"), prefixed.replace("cc.jpg", "c.jpg"), prefixed.toUpperCase(),
    uuidPath + ".jpg", uuidPath.toUpperCase(), uuidPath.replace("-", ""),
    uuidPath.replace("cc/", "../"), uuidPath + "?rule=ad?rule=other", prefixed + "?token=abc",
    uuidPath + "#abc", prefixed + "\n"]) {
    assert.throws(() => readPublication({...item, images:[root + bad]}));
  }
});
test("the private release uses the Unix reader and disables every demo backend", async t => {
  const environment = { NODE_ENV: "production", AUTOFIND_PRIVATE_CATALOG: "1", AUTO_WORLD_DEMO: "1" };
  assert.equal(privateCatalogEnabled({ ...environment, NODE_ENV: "development" }), false);
  assert.equal(privateCatalogEnabled({ ...environment, AUTOFIND_PRIVATE_CATALOG: "0" }), false);
  assert.equal(privateCatalogEnabled(environment), true);
  for (const backend of ["prototype", "offline"]) {
    assert.equal(resolveDemoBackendMode({ ...environment, AUTO_WORLD_WEB_BACKEND: backend }), "disabled");
  }

  const saved = { NODE_ENV: process.env.NODE_ENV, AUTOFIND_PRIVATE_CATALOG: process.env.AUTOFIND_PRIVATE_CATALOG };
  const temp = await mkdtemp(join(tmpdir(), "autofind-reader-test-"));
  const socket = join(temp, "reader.sock");
  let status = 200;
  let payload = { dataset: "autoworld/leboncoin", items: [item], brands: ["Citroën", "Tesla"], next_cursor: "42" };
  let request;
  const server = http.createServer((req, res) => {
    request = req;
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
  });
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(socket, resolve));
  const get = http.get;
  t.mock.method(http, "get", (options, callback) => {
    assert.equal(options.socketPath, "/run/aw-private-catalog/reader.sock");
    return get({ ...options, socketPath: socket }, callback);
  });
  process.env.NODE_ENV = "production";
  delete process.env.AUTOFIND_PRIVATE_CATALOG;
  await assert.rejects(fetchDetail("42"), /catalog_disabled/);
  assert.equal(request, undefined);
  process.env.AUTOFIND_PRIVATE_CATALOG = "1";
  const page = await fetchList({ after: "10", limit: 1, q: "é & 3", brand:"Tesla", priceMin:0, kmMax:30000 });
  assert.equal(page.next, "42");
  assert.equal(page.dataset, "autoworld/leboncoin");
  assert.deepEqual(page.brands, ["Citroën", "Tesla"]);
  const location = new URL(request.url, "http://localhost");
  assert.equal(location.pathname, "/internal/catalog");
  assert.deepEqual(Object.fromEntries(location.searchParams), { q:"é & 3", after:"10", limit:"1", brand:"Tesla", priceMin:"0", kmMax:"30000" });
  assert.equal(request.method, "GET");
  assert.equal(request.headers.host, "localhost");
  assert.equal(request.headers.cookie, undefined);
  payload.next_cursor = "401";
  await assert.rejects(fetchList({limit: 1}), /catalog_cursor_invalid/);
  payload = { dataset: "synthetic", items: [], next_cursor: null };
  await assert.rejects(fetchList({limit: 1}), /catalog_page_invalid/);
  payload = item;
  assert.equal((await fetchDetail("42")).id, "42");
  assert.equal(request.url, "/internal/catalog/42");
  await assert.rejects(fetchDetail("41"), /catalog_id_mismatch/);
  payload = null;
  await assert.rejects(fetchDetail("42"), /catalog_publication_invalid/);
  status = 404;
  assert.equal(await fetchDetail("404"), null);
  for (status of [302, 403, 503]) await assert.rejects(fetchDetail("42"), /catalog_read_failed/);
});
