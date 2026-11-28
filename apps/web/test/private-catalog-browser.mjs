// Run after NEXT_PUBLIC_PRIVATE_WEB=1 pnpm --filter @auto-world/web build.
// Both servers belong to this process and see synthetic fixtures only.
import http from "node:http";
import { mock as nodeMock } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import next from "next";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { chromium, webkit } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const socketDir = await mkdtemp(join(tmpdir(), "catalogue-browser-"));
const socket = join(socketDir, "reader.sock");
process.env.NODE_ENV = "production";
process.env.AUTOFIND_PRIVATE_CATALOG = "1";
const nextApp = next({ dir: fileURLToPath(new URL("../", import.meta.url)), dev: false, hostname: "127.0.0.1" });
const directory = new URL("../test-results/catalogue-prive/", import.meta.url);
await mkdir(directory, { recursive: true });
const mediaRoot = "https://img.leboncoin.fr/api/v1/lbcpb1/images/";
const photo = mediaRoot + "gh/bb/cc/gh" + "a".repeat(38) + ".jpg?rule=large";
const secondPhoto = mediaRoot + "aa/bb/cc/78c4f2de-4ec6-45a2-8081-ab2e106ad504";
const peugeotPhoto = mediaRoot + "aa/bb/cc/" + "d".repeat(40) + ".jpg";
const modelsByBrand = { "Citroën": ["C3", "C4"], Peugeot: ["208", "308"], Renault: ["Clio"] };
const filterOptions = {
  fuel: ["Diesel", "Essence"], gearbox: ["Automatique", "Manuelle"], body: ["Berline"],
  color: ["Gris", "Noir"], upholstery: ["Tissu"],
};
const vehicleFacts = {
  "100": {fuel:"Diesel", gearbox:"Manuelle", body:"Berline", color:"Gris", upholstery:"Tissu",
    seats:5, doors:3, firstOwner:null, inspectionValid:true, serviceBook:null},
  "300": {fuel:"Diesel", gearbox:"Automatique", body:"Berline", color:"Noir", upholstery:"Tissu",
    seats:5, doors:5, firstOwner:true, inspectionValid:true, serviceBook:true},
};
const items = [
  ["100", "Peugeot", "208", 1950000, 38700],
  ["200", "Renault", "Clio", null, null],
  ["300", "Citroën", "C3", 1399900, 50200],
].map(([id, brand, model, price, km]) => ({
  source_listing_id: id, source_url: "https://www.leboncoin.fr/ad/voitures/" + id, source_label: "Leboncoin",
  brand, model, year: 2022, price_amount_minor: price, price_currency: price === null ? null : "EUR",
  observed_at_kind: id === "200" ? "file_export" : "source_capture",
  mileage_km: km, observed_at: "2026-11-22T12:00:00+00:00", images: id === "300" ? [photo, secondPhoto] : id === "100" ? [peugeotPhoto] : [],
  ...vehicleFacts[id],
}));

let state = "healthy";
const firstScope = "a".repeat(64);
let sessionScope = firstScope;
let holdLookup;
const reader = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let body;
  if (state === "unavailable") { res.writeHead(503).end(); return; }
  if (url.pathname === "/internal/catalog") {
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    const values = url.searchParams;
    function inRange(value, min, max) {
      return (!url.searchParams.has(min) || value !== null && value >= Number(url.searchParams.get(min)))
        && (!url.searchParams.has(max) || value !== null && value <= Number(url.searchParams.get(max)));
    }
    let rows = state === "empty" ? [] : items.filter(item =>
      ["brand","model",...Object.keys(filterOptions)].every(key =>
        !values.get(key) || item[key]?.toLowerCase() === values.get(key).toLowerCase())
      && ["firstOwner", "inspectionValid", "serviceBook"].every(key => values.get(key) !== "1" || item[key] === true)
      && (!values.get("doors") || item.doors === Number(values.get("doors")))
      && inRange(item.seats ?? null, "seatsMin", "seatsMax")
      && (values.get("hasPhotos") !== "1" || item.images.length > 0)
      && (url.searchParams.get("hasPrice") !== "1" || item.price_amount_minor !== null)
      && inRange(item.price_amount_minor === null ? null : item.price_amount_minor / 100, "priceMin", "priceMax")
      && inRange(item.year, "yearMin", "yearMax")
      && inRange(item.mileage_km, "kmMin", "kmMax")
      && [item.brand, item.model, item.year, item.source_listing_id].join(" ").toLowerCase().includes(query));
    const sort = values.get("sort") ?? "default";
    function key(item) {
      if (sort.startsWith("price-")) return item.price_amount_minor;
      if (sort.startsWith("km-")) return item.mileage_km;
      if (sort.startsWith("year-")) return item.year;
      return Date.parse(item.observed_at) * 1000;
    }
    function cursor(item) {
      return sort === "default" ? item.source_listing_id : [sort, key(item) ?? "x", item.source_listing_id].join("~");
    }
    if (sort === "default") {
      rows = rows.filter(item => item.source_listing_id > (values.get("after") ?? ""));
    } else {
      rows.sort((left, right) => {
        const a = key(left), b = key(right);
        if (a === b) return Number(left.source_listing_id) - Number(right.source_listing_id);
        if (a === null) return 1;
        if (b === null) return -1;
        return sort.endsWith("-desc") ? b - a : a - b;
      });
      if (values.has("after")) {
        const index = rows.findIndex(item => cursor(item) === values.get("after"));
        assert.ok(index >= 0);
        rows = rows.slice(index + 1);
      }
    }
    const limit = Number(url.searchParams.get("limit"));
    body = { dataset: "autoworld/leboncoin", brands: Object.keys(modelsByBrand), modelsByBrand, filterOptions,
      items: rows.slice(0, limit), next_cursor: rows.length > limit ? cursor(rows[limit - 1]) : null };
  } else {
    if (state === "revoked" && url.pathname === "/internal/catalog/100") { res.writeHead(404).end(); return; }
    if (state === "partial" && url.pathname.endsWith("/100")) { res.writeHead(503).end(); return; }
    body = items.find(item => "/internal/catalog/" + item.source_listing_id === url.pathname);
    if (!body) { res.writeHead(404).end(); return; }
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
});
await new Promise((resolve, reject) => reader.once("error", reject).listen(socket, resolve));
const get = http.get;
const transport = nodeMock.method(http, "get", (options, ...args) => {
  if (options.socketPath === "/run/aw-private-catalog/reader.sock") return get({ ...options, socketPath: socket }, ...args);
  return get(options, ...args);
});
await nextApp.prepare();
const handle = nextApp.getRequestHandler();
const web = http.createServer(async (req, res) => {
  delete req.headers["x-aw-favorites-scope"];
  if (sessionScope) req.headers["x-aw-favorites-scope"] = sessionScope;
  if (holdLookup && req.url === "/catalogue/favoris/lecture") await holdLookup.promise;
  await handle(req, res);
});
await new Promise((resolve, reject) => web.once("error", reject).listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + web.address().port;

const checks = [];
const performanceSamples = [];
async function inspect(page, name) {
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  const axe = await new AxeBuilder({ page }).exclude("nextjs-portal").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  assert.deepEqual(axe.violations.map(v => v.id), []);
  const target = name.endsWith("-gallery") ? page.locator(".catalogue-gallery figure") : page;
  await target.screenshot({ style: "nextjs-portal { display: none !important; }", path: new URL(name + ".png", directory).pathname });
  if (name.startsWith("chromium") && !name.endsWith("gallery")) {
    const metrics = await page.evaluate(() => globalThis.__catalogPerformance);
    assert(metrics.lcp > 0 && metrics.lcp < 2500, JSON.stringify(metrics));
    assert(metrics.cls <= 0.1, JSON.stringify(metrics));
    performanceSamples.push({ name, ...metrics });
  }
  checks.push(name);
}
try {
  for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await type.launch();
    try {
      for (const [size, viewport] of [["mobile", {width:390, height:844}], ["desktop", {width:1280, height:900}]]) {
        const context = await browser.newContext({ viewport, hasTouch: size === "mobile", locale: "fr-FR" });
        if (engine === "chromium") await context.addInitScript(() => {
          const sample = globalThis.__catalogPerformance = { lcp: 0, cls: 0 };
          new globalThis.PerformanceObserver(list => {
            for (const entry of list.getEntries()) sample.lcp = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new globalThis.PerformanceObserver(list => {
            for (const entry of list.getEntries()) if (!entry.hadRecentInput) sample.cls += entry.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        const page = await context.newPage();
        const external = [];
        const fixtureImage = await page.evaluate(() => {
          const canvas = globalThis.document.createElement("canvas");
          canvas.width = 480;
          canvas.height = 360;
          const brush = canvas.getContext("2d");
          brush.fillStyle = "#c3d1d4";
          brush.fillRect(0, 0, 480, 360);
          brush.fillStyle = "#2d4249";
          brush.font = "22px sans-serif";
          brush.textAlign = "center";
          brush.fillText("Photo de test", 240, 187);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        const detailImage = Promise.withResolvers();
        let outcome = "success";
        await context.route("**/*", async route => {
          const request = route.request();
          if (request.url().startsWith(base + "/")) return route.continue();
          external.push({ url: request.url(), referrer: (await request.allHeaders()).referer ?? "", type: request.resourceType() });
          if (![photo, secondPhoto, peugeotPhoto].includes(request.url())) return route.abort();
          if (request.url() === photo && new URL(request.frame().url()).pathname === "/catalogue/300") await detailImage.promise;
          if (outcome === "failure") return route.abort("failed");
          if (outcome === "offline") return route.abort("internetdisconnected");
          return route.fulfill({ contentType: "image/png", headers: { "Cache-Control": "no-store" }, body: Buffer.from(fixtureImage, "base64") });
        });
        for (const legacy of ["/", "/demo"]) {
          await page.goto(base + legacy);
          await page.waitForURL(base + "/catalogue");
        }
        const response = await page.goto(base + "/catalogue?limit=2");
        assert.match(response.headers()["content-security-policy"], /img-src 'self' https:\/\/img\.leboncoin\.fr\/api\/v1\/lbcpb1\/images\//);
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        assert.match(await page.locator('meta[name="robots"]').first().getAttribute("content"), /noindex/);
        assert.equal(await page.getByRole("link", {name: "Se déconnecter"}).getAttribute("href"), "/acces/deconnexion");
        assert.equal(await page.getByRole("list", {name:"Annonces Leboncoin"}).getAttribute("data-catalog-dataset"), "autoworld/leboncoin");
        const photoToggle = page.getByRole("button", {name:/^(Afficher|Masquer) les photos/});
        assert.equal(await photoToggle.count(), 0);
        const peugeot = page.getByRole("link", {name:/Peugeot 208/});
        const renault = page.getByRole("link", {name:/Renault Clio/});
        const thumbnail = peugeot.locator("img");
        await thumbnail.scrollIntoViewIfNeeded();
        assert.equal(await thumbnail.getAttribute("src"), peugeotPhoto);
        assert.equal(await thumbnail.getAttribute("alt"), "");
        assert.equal(await thumbnail.getAttribute("loading"), "lazy");
        assert.equal(await thumbnail.getAttribute("referrerpolicy"), "no-referrer");
        assert.equal(await thumbnail.evaluate(async element => { await element.decode(); return element.naturalWidth; }), 480);
        const thumbnailBox = await thumbnail.boundingBox();
        assert(thumbnailBox && thumbnailBox.width > 0 && Math.abs(thumbnailBox.width * 0.75 - thumbnailBox.height) < 1);
        await renault.getByText("Sans photo", {exact:true}).waitFor();
        await renault.getByText("Prix à confirmer", {exact:true}).waitFor();
        assert.equal(await renault.locator("img").count(), 0);
        await inspect(page, engine + "-" + size + "-list");
        const field = page.getByRole("searchbox", {name:"Marque, modèle, année ou numéro d’annonce"});
        const submit = page.getByRole("button", {name:"Rechercher", exact: true});
        await field.fill("Voiture introuvable");
        await submit.click();
        await page.getByRole("heading", {name:"Aucune annonce pour cette recherche"}).waitFor();
        assert.equal(new URL(page.url()).searchParams.get("q"), "Voiture introuvable");
        await page.getByRole("link", {name:"Effacer la recherche"}).click();
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        await field.fill("Clio");
        await field.press("Enter");
        await page.waitForURL(url => url.searchParams.get("q") === "Clio");
        await page.getByRole("link", {name:/Renault Clio/}).waitFor();
        assert.equal(await page.getByRole("link", {name:/Peugeot 208/}).count(), 0);
        const shared = await context.newPage();
        await shared.goto(page.url());
        await shared.getByRole("link", {name:/Renault Clio/}).waitFor();
        assert.equal(await shared.getByRole("searchbox").inputValue(), "Clio");
        await shared.close();
        await field.fill("2022");
        await submit.click();
        await page.waitForURL(url => url.searchParams.get("q") === "2022");
        await page.getByRole("link", {name:"Page suivante"}).click();
        const citroen = page.getByRole("link", {name:/Citroën C3/});
        const leadImage = citroen.locator("img");
        await leadImage.scrollIntoViewIfNeeded();
        assert.equal(await leadImage.evaluate(async element => { await element.decode(); return element.naturalWidth; }), 480);
        assert.equal(await leadImage.getAttribute("src"), photo);
        assert(external.every(hit => [peugeotPhoto, photo].includes(hit.url) && hit.referrer === "" && hit.type === "image"));
        const cardGallery = page.getByRole("group", {name:"Photos de Citroën C3"});
        const nextOnCard = cardGallery.getByRole("button", {name:"Photo suivante"});
        const previousOnCard = cardGallery.getByRole("button", {name:"Photo précédente"});
        const cardUrl = page.url();
        const cardBox = await leadImage.boundingBox();
        assert(await previousOnCard.isDisabled());
        const buttonBox = await nextOnCard.boundingBox();
        assert(buttonBox.width >= 44 && buttonBox.height >= 44);
        await nextOnCard.click();
        await cardGallery.getByText("Photo 2 sur 2").waitFor();
        assert(await nextOnCard.isDisabled());
        await leadImage.evaluate(image => image.decode());
        assert.equal(await leadImage.getAttribute("src"), secondPhoto);
        assert.equal(await leadImage.count(), 1);
        assert.deepEqual(await leadImage.boundingBox(), cardBox);
        assert.deepEqual(external.at(-1), {url:secondPhoto, referrer:"", type:"image"});
        await inspect(page, engine + "-" + size + "-card-photos");
        await nextOnCard.press("ArrowLeft");
        await cardGallery.getByText("Photo 1 sur 2").waitFor();
        if (size === "mobile") {
          const media = citroen.locator(".catalogue-card-media");
          const {x, y, width, height} = await media.boundingBox();
          const startX = x + width * .7, endX = x + width * .3, middle = y + height / 2;
          if (engine === "chromium") {
            const cdp = await context.newCDPSession(page);
            for (const [type, touchPoints] of [
              ["touchStart", [{x:startX,y:middle}]], ["touchMove", [{x:endX,y:middle}]], ["touchEnd", []],
            ]) await cdp.send("Input.dispatchTouchEvent", {type, touchPoints});
            await cdp.detach();
          } else {
            const pointer = {bubbles:true, isPrimary:true, pointerId:1, pointerType:"touch", clientY:middle};
            await media.dispatchEvent("pointerdown", {...pointer, clientX:startX});
            await media.dispatchEvent("pointerup", {...pointer, clientX:endX});
            await media.dispatchEvent("click");
          }
          await cardGallery.getByText("Photo 2 sur 2").waitFor();
          await previousOnCard.press("Enter");
        }
        assert.equal(page.url(), cardUrl);
        await leadImage.evaluate(image => image.decode());
        assert.equal(await leadImage.getAttribute("src"), photo);
        const beforeDetail = external.length;
        await citroen.click({noWaitAfter:true});
        await page.getByRole("heading", {name:"Citroën C3"}).waitFor();
        assert.equal(await page.getByRole("link", {name:"Voir l’annonce sur Leboncoin"}).getAttribute("href"), items[2].source_url);
        assert.equal(await photoToggle.count(), 0);
        const frame = page.locator(".catalogue-photo-frame");
        await page.getByText("Chargement de la photo…").waitFor();
        const initial = await frame.boundingBox();
        detailImage.resolve();
        const img = page.getByRole("img", {name:"Citroën C3, photo 1"});
        assert.equal(await img.evaluate(async element => { await element.decode(); return element.naturalWidth; }), 480);
        const ready = await frame.boundingBox();
        assert.equal(ready.width, initial.width);
        assert.equal(ready.height, initial.height);
        await inspect(page, engine + "-" + size + "-detail");
        const photoLink = page.getByRole("link", {name:"Photo 1"});
        assert.equal(await photoLink.isVisible(), false);
        await page.getByText("Liens vers les photos (2)", {exact:true}).click();
        assert.equal(await photoLink.getAttribute("href"), photo);
        assert.equal(await photoLink.getAttribute("referrerpolicy"), "no-referrer");
        assert.match(await photoLink.getAttribute("rel"), /noreferrer/);
        const back = page.getByRole("link", {name:"Retour aux annonces"});
        assert.equal(await back.getAttribute("href"), "/catalogue?q=2022&after=200&limit=2");
        assert.equal(new URL(page.url()).searchParams.get("q"), "2022");
        const next = page.getByRole("button", {name:"Suivante"});
        const prev = page.getByRole("button", {name:"Précédente"});
        assert.equal(await prev.isDisabled(), true);
        assert.equal(await page.locator("main img").count(), 1);
        const openOriginal = page.getByRole("link", {name:"Ouvrir cette photo sur Leboncoin"});
        assert.equal(await openOriginal.getAttribute("href"), photo);
        assert.equal(await openOriginal.getAttribute("referrerpolicy"), "no-referrer");
        assert.deepEqual(external.slice(beforeDetail), [{url:photo, referrer:"", type:"image"}]);
        await img.scrollIntoViewIfNeeded();
        await inspect(page, engine + "-" + size + "-gallery");

        outcome = "failure";
        await next.press("Enter");
        await page.getByText("Cette photo est indisponible.").waitFor();
        assert.equal(await next.isDisabled(), true);
        assert.equal(await openOriginal.getAttribute("href"), secondPhoto);
        outcome = "offline";
        await context.setOffline(true);
        await page.getByRole("button", {name:"Réessayer"}).click();
        await page.getByText("Vous êtes hors connexion.").waitFor();
        await context.setOffline(false);
        outcome = "success";
        await page.getByRole("button", {name:"Réessayer"}).click();
        await page.getByRole("img", {name:"Citroën C3, photo 2"}).evaluate(element => element.decode());
        await prev.press("Enter");
        await img.evaluate(element => element.decode());
        assert(external.every(hit => [peugeotPhoto, photo, secondPhoto].includes(hit.url) && hit.referrer === "" && hit.type === "image"));
        const beforeReturn = external.length;
        outcome = "failure";
        await back.click();
        await citroen.getByText("Photo indisponible", {exact:true}).waitFor();
        assert.deepEqual(external.slice(beforeReturn), [{url:photo, referrer:"", type:"image"}]);
        assert.equal(await field.inputValue(), "2022");
        assert.equal(await page.getByRole("link", {name:"Premières annonces"}).getAttribute("href"), "/catalogue?q=2022&limit=2");
        outcome = "success";
        await page.getByRole("link", {name:"Premières annonces"}).click();
        await thumbnail.scrollIntoViewIfNeeded();
        assert.equal(await thumbnail.evaluate(async element => { await element.decode(); return element.naturalWidth; }), 480);
        await inspect(page, engine + "-" + size + "-list-photos");
        await field.fill("100");
        await submit.click();
        await page.waitForURL(url => url.searchParams.get("q") === "100");
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        assert.equal(new URL(page.url()).searchParams.has("after"), false);
        await page.goto(base + "/catalogue?q=2022&limit=2");
        const filters = page.locator(".catalogue-filters > summary");
        const brandSelect = page.getByRole("combobox", {name:"Marque", exact:true});
        const modelSelect = page.getByRole("combobox", {name:"Modèle", exact:true});
        await brandSelect.waitFor();
        assert.equal(await modelSelect.isDisabled(), true);
        await brandSelect.selectOption("Citroën");
        await modelSelect.selectOption("C3");
        await brandSelect.selectOption("Peugeot");
        assert.equal(await modelSelect.inputValue(), "");
        assert.equal(await modelSelect.locator("option", {hasText:"C3"}).count(), 0);
        await modelSelect.selectOption("208");
        await brandSelect.selectOption("Citroën");
        await modelSelect.selectOption("C3");
        await filters.waitFor({state:"visible"});
        await filters.focus();
        await filters.press("Enter");
        await page.locator(".catalogue-filters[open]").waitFor();
        const priceMin = page.getByRole("spinbutton", {name:"Prix en euros minimum"});
        const priceMax = page.getByRole("spinbutton", {name:"Prix en euros maximum"});
        const priceOnly = page.getByRole("checkbox", {name:"Prix de vente renseigné", exact:true});
        const apply = page.getByRole("button", {name:"Appliquer les filtres"});
        await priceMin.fill("20000");
        await priceMax.fill("15000");
        await apply.click();
        assert.equal(await priceMin.evaluate(el => el.validity.valid), false);
        assert.equal(new URL(page.url()).searchParams.has("priceMax"), false);
        await priceMin.fill("");
        await page.getByRole("spinbutton", {name:"Année minimum"}).fill("2020");
        await page.getByRole("spinbutton", {name:"Kilométrage maximal"}).fill("60000");
        await page.getByRole("spinbutton", {name:"Kilométrage minimal"}).fill("50000");
        await page.getByRole("combobox", {name:"Énergie", exact:true}).selectOption("Diesel");
        const gearbox = page.getByRole("combobox", {name:"Boîte de vitesses", exact:true});
        await gearbox.selectOption("Automatique");
        await page.getByRole("combobox", {name:"Carrosserie", exact:true}).selectOption("Berline");
        await page.getByRole("checkbox", {name:"Avec photos", exact:true}).check();
        await page.getByRole("checkbox", {name:"Première main", exact:true}).check();
        await page.getByRole("checkbox", {name:"Contrôle technique valide", exact:true}).check();
        await page.getByRole("checkbox", {name:"Carnet d’entretien", exact:true}).check();
        const refinements = page.locator(".catalogue-refinements > summary");
        await refinements.focus();
        await refinements.press("Enter");
        await page.getByRole("combobox", {name:"Couleur extérieure", exact:true}).selectOption("Noir");
        await page.getByRole("combobox", {name:"Sellerie", exact:true}).selectOption("Tissu");
        const doors = page.getByRole("spinbutton", {name:"Nombre de portes", exact:true});
        await doors.fill("10");
        await refinements.click();
        await filters.click();
        const beforeInvalidDoorCount = page.url();
        await apply.click();
        await doors.waitFor({state:"visible"});
        assert.equal(await doors.evaluate(el => el.validity.rangeOverflow), true);
        assert.equal(page.url(), beforeInvalidDoorCount);
        await doors.fill("5");
        await page.getByRole("spinbutton", {name:"Nombre de places minimum"}).fill("5");
        await page.getByRole("spinbutton", {name:"Nombre de places maximum"}).fill("5");
        await refinements.scrollIntoViewIfNeeded();
        await inspect(page, engine + "-" + size + "-habitacle");
        await priceOnly.check();
        await page.evaluate(() => globalThis.scrollTo({ top: 0, behavior: "instant" }));
        await inspect(page, engine + "-" + size + "-filtres");
        await apply.click();
        await citroen.waitFor();
        assert.equal(await page.locator(".catalogue-row").count(), 1);
        await citroen.click();
        const backPath = new URL(await back.getAttribute("href"), base);
        const combined = {q:"2022", brand:"Citroën", model:"C3", fuel:"Diesel", gearbox:"Automatique", body:"Berline",
          color:"Noir", upholstery:"Tissu", doors:"5", seatsMin:"5", seatsMax:"5", firstOwner:"1", inspectionValid:"1",
          serviceBook:"1", hasPhotos:"1", hasPrice:"1", priceMax:"15000", yearMin:"2020", kmMin:"50000", kmMax:"60000"};
        for (const [k,v] of Object.entries(combined)) {
          assert.equal(backPath.searchParams.get(k),v);
        }
        await back.click();
        assert.equal(await modelSelect.inputValue(), "C3");
        await filters.click();
        await gearbox.selectOption("Manuelle");
        await apply.click();
        await page.getByRole("heading", {name:"Aucune annonce pour cette recherche"}).waitFor();
        await page.getByRole("link", {name:/Retirer le filtre .*Manuelle/i}).click();
        await citroen.waitFor();
        const recovered = new URL(page.url()).searchParams;
        assert.equal(recovered.has("gearbox"), false);
        for (const [key, value] of Object.entries(combined)) {
          if (key !== "gearbox") assert.equal(recovered.get(key), value);
        }
        await page.getByRole("link", {name:"Retirer le filtre Citroën"}).click();
        assert.equal(new URL(page.url()).searchParams.has("brand"), false);
        assert.equal(new URL(page.url()).searchParams.has("model"), false);
        assert.equal(new URL(page.url()).searchParams.get("priceMax"), "15000");
        assert.equal(new URL(page.url()).searchParams.get("hasPrice"), "1");
        await page.getByRole("link", {name:"Effacer les filtres"}).click();
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        assert.equal(new URL(page.url()).searchParams.get("q"), "2022");
        assert.equal(new URL(page.url()).searchParams.has("priceMax"), false);
        assert.equal(new URL(page.url()).searchParams.has("hasPrice"), false);
        await page.goto(base + "/catalogue?limit=1");
        await filters.click();
        assert.equal(await priceOnly.isChecked(), false);
        await priceOnly.focus();
        await priceOnly.press("Space");
        assert.equal(await priceOnly.isChecked(), true);
        await priceOnly.scrollIntoViewIfNeeded();
        await inspect(page, engine + "-" + size + "-prix-renseigne");
        await apply.click();
        await page.waitForURL(url => url.searchParams.get("hasPrice") === "1");
        await peugeot.waitFor();
        await page.getByRole("link", {name:"Page suivante"}).click();
        await citroen.waitFor();
        assert.equal(new URL(page.url()).searchParams.get("after"), "100");
        assert.equal(new URL(page.url()).searchParams.get("hasPrice"), "1");
        assert.equal(await page.getByRole("link", {name:"Page suivante"}).count(), 0);
        await filters.click();
        assert.equal(await priceOnly.isChecked(), true);
        await field.fill("Clio");
        await submit.click();
        await page.getByRole("heading", {name:"Aucune annonce pour cette recherche"}).waitFor();
        assert.equal(new URL(page.url()).searchParams.get("hasPrice"), "1");
        assert.equal(new URL(page.url()).searchParams.has("after"), false);
        await page.getByRole("link", {name:"Retirer le filtre Prix de vente renseigné"}).click();
        await renault.getByText("Prix à confirmer", {exact:true}).waitFor();
        assert.equal(new URL(page.url()).searchParams.get("q"), "Clio");
        assert.equal(new URL(page.url()).searchParams.has("hasPrice"), false);
        await page.goto(base + "/catalogue?fuel=Diesel&hasPhotos=1&limit=1");
        await peugeot.waitFor();
        await page.getByRole("link", {name:"Page suivante"}).click();
        await citroen.waitFor();
        await citroen.click();
        const paginatedBack = new URL(await back.getAttribute("href"), base);
        assert.equal(paginatedBack.searchParams.get("fuel"), "Diesel");
        assert.equal(paginatedBack.searchParams.get("hasPhotos"), "1");
        assert.equal(paginatedBack.searchParams.get("after"), "100");
        await back.click();
        assert.equal(await page.getByRole("link", {name:"Page suivante"}).count(), 0);
        await page.goto(base + "/catalogue?yearMin=2022&limit=1");
        await page.getByRole("link", {name:"Page suivante"}).click();
        await page.getByRole("link", {name:/Renault Clio/}).waitFor();
        assert.equal(new URL(page.url()).searchParams.get("yearMin"), "2022");
        assert.equal(new URL(page.url()).searchParams.get("after"), "100");
        await filters.click();
        await brandSelect.selectOption("Peugeot");
        await apply.click();
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        assert.equal(new URL(page.url()).searchParams.has("after"), false);
        await page.goto(base + "/catalogue?yearMin=2022&limit=1&after=100");
        const sortControl = page.getByLabel("Trier par", {exact:true});
        const applySort = page.getByRole("button", {name:"Appliquer le tri"});
        if (engine === "chromium" && size === "desktop") {
          const beforeSort = page.url();
          await sortControl.focus();
          await sortControl.press("ArrowDown");
          await sortControl.press("ArrowDown");
          assert.equal(await sortControl.inputValue(), "price-desc");
          assert.equal(await sortControl.evaluate(el => el === el.ownerDocument.activeElement), true);
          assert.equal(page.url(), beforeSort);
        }
        await sortControl.selectOption("price-asc");
        await applySort.click();
        await page.getByRole("link", {name:/Citroën C3/}).waitFor();
        assert.equal(new URL(page.url()).searchParams.has("after"), false);
        assert.equal(new URL(page.url()).searchParams.get("yearMin"), "2022");
        await page.getByRole("link", {name:"Page suivante"}).click();
        await page.getByRole("link", {name:/Peugeot 208/}).click();
        await page.getByRole("link", {name:"Retour aux annonces"}).click();
        assert.equal(await page.getByLabel("Trier par", {exact:true}).inputValue(), "price-asc");
        await page.getByRole("link", {name:"Page suivante"}).click();
        await page.getByRole("link", {name:/Renault Clio/}).waitFor();
        await sortControl.selectOption("price-desc");
        await applySort.click();
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        for (const [requested, expected] of [["citroën", "Citroën"], ["Marque inconnue", "Marque inconnue"]]) {
          await page.goto(base + "/catalogue?brand=" + encodeURIComponent(requested));
          await filters.click();
          assert.equal(await brandSelect.inputValue(), expected);
          await priceMax.fill("20000");
          await apply.click();
          await page.waitForURL(url => url.searchParams.get("priceMax") === "20000");
          assert.equal(new URL(page.url()).searchParams.get("brand"), expected);
          if (expected === "Citroën") {
            await page.getByRole("link", {name:/Citroën C3/}).waitFor();
            assert.equal(await page.locator("a.catalogue-row").count(), 1);
          } else {
            await page.getByRole("heading", {name:"Aucune annonce pour cette recherche"}).waitFor();
          }
        }
        await page.goto(base + "/catalogue/200");
        await page.getByRole("heading", {name:"Renault Clio"}).waitFor();
        await page.getByText("Prix à confirmer", {exact:true}).waitFor();
        assert.equal(await page.locator(".catalogue-gallery img").count(), 0);
        await page.goto(base + "/catalogue/100");
        await page.getByRole("img", {name:"Peugeot 208, photo 1"}).waitFor();
        assert.equal(await page.getByRole("group", {name:"Navigation entre les photos"}).count(), 0);
        const listPath = "/catalogue?sort=price-asc&q=2022&limit=2";
        await page.goto(base + listPath);
        const favorite = page.getByRole("button", {name:"Favori · Peugeot 208"});
        await favorite.focus();
        await favorite.press("Space");
        await page.getByRole("button", { name: "Favori · Peugeot 208", pressed: true }).waitFor();
        const box = await favorite.boundingBox();
        assert(box.height >= 44 && box.width >= 44);
        await page.getByRole("link", {name:/Peugeot 208/}).click();
        await page.getByRole("button", {name:"Favori · Peugeot 208", pressed:true}).click();
        await page.getByRole("button", {name:"Favori · Peugeot 208", pressed:false}).click();
        const key = "autofindex.catalogue.favoris.v1." + sessionScope;
        assert.equal(await page.evaluate(k => globalThis.sessionStorage.getItem(k), key), '["100"]');
        holdLookup = Promise.withResolvers();
        await page.getByRole("link", {name:"Favoris", exact:true}).click();
        await page.getByText("Chargement des favoris…").waitFor();
        holdLookup.resolve();
        holdLookup = undefined;
        const saved = page.getByRole("list", {name:"Favoris"});
        await saved.getByRole("link", {name:"Peugeot 208"}).waitFor();
        await inspect(page, engine + "-" + size + "-favoris");
        await saved.getByRole("link").click();
        await page.getByRole("link", {name:"Retour aux favoris"}).click();
        await saved.getByRole("link").waitFor();
        await page.getByRole("link", {name:"Retour aux annonces"}).click();
        assert.equal(page.url(), base + listPath);
        await page.getByRole("link", {name:"Favoris", exact:true}).click();
        await saved.getByRole("link").waitFor();
        state = "revoked";
        await page.reload();
        await saved.getByText("Annonce indisponible").waitFor();
        assert.equal(await saved.getByRole("link").count(), 0);
        assert.doesNotMatch(await saved.innerText(), /100|Peugeot|19.500/u);
        assert.equal(await saved.locator("img").count(), 0);
        state = "partial";
        await page.evaluate(k => globalThis.sessionStorage.setItem(k, '["100","200","987654"]'), key);
        await page.reload();
        await page.getByText("Certains favoris ne peuvent pas être chargés.", {exact:false}).waitFor();
        await saved.getByRole("link", {name:"Renault Clio"}).waitFor();
        await saved.getByText("Annonce indisponible").waitFor();
        assert.equal((await page.locator("body").innerText()).includes("987654"), false);
        assert.equal(await saved.getByRole("link", {name:"Peugeot 208"}).count(), 0);
        state = "unavailable";
        await page.getByRole("button", {name:"Réessayer"}).click();
        await page.getByText("Vos favoris ne peuvent pas être chargés.", {exact:false}).waitFor();
        state = "healthy";
        await page.getByRole("button", {name:"Réessayer"}).click();
        await saved.getByRole("link", {name:"Peugeot 208"}).waitFor();
        await saved.getByRole("button", {name:"Retirer des favoris · Annonce indisponible"}).click();
        await saved.getByRole("button", {name:/Retirer des favoris · Renault/}).click();
        await saved.getByRole("button", {name:/Retirer des favoris · Peugeot/}).click();
        await page.getByRole("heading", {name:"Aucun favori"}).waitFor();
        assert.equal(await page.evaluate(() => globalThis.document.activeElement.tagName), "H1");
        await page.evaluate(k => globalThis.sessionStorage.setItem(k, "future"), key);
        await page.reload();
        await page.getByText("Impossible de lire les favoris de cet onglet.").waitFor();
        assert.equal(await page.evaluate(k => globalThis.sessionStorage.getItem(k), key), "future");
        sessionScope = "b".repeat(64);
        await page.reload();
        await page.getByRole("heading", {name:"Aucun favori"}).waitFor();
        assert.equal(await page.evaluate(k => globalThis.sessionStorage.getItem(k), key), null);
        const lookup = base + "/catalogue/favoris/lecture";
        assert.equal((await context.request.post(lookup, {data:{ scope:firstScope, ids:["100"] }})).status(), 403);
        assert.equal((await context.request.post(lookup, {data:{ scope:sessionScope, ids:["100","100"] }})).status(), 400);
        sessionScope = null;
        await page.reload();
        await page.getByText("Favoris indisponibles pour cette session.").waitFor();
        assert.equal((await context.request.post(lookup, {data:{scope:firstScope, ids:["100"]}})).status(), 403);
        sessionScope = firstScope;
        await page.goto(base + "/catalogue/100");
        const full = Array.from({length:12}, (_, index) => String(index + 1));
        await page.evaluate(([k, ids]) => globalThis.sessionStorage.setItem(k, JSON.stringify(ids)), [key, full]);
        await page.reload();
        await page.getByRole("button", {name:"Favori · Peugeot 208"}).click();
        await page.getByRole("status").filter({hasText:"Limite de 12 favoris atteinte"}).waitFor();
        assert.equal(await page.evaluate(k => globalThis.sessionStorage.getItem(k), key), JSON.stringify(full));
        await page.evaluate(k => globalThis.sessionStorage.removeItem(k), key);
        await page.reload();
        await page.evaluate(() => { globalThis.Storage.prototype.setItem = () => { throw new Error("quota"); }; });
        await page.getByRole("button", {name:"Favori · Peugeot 208", pressed:false}).click();
        await page.getByRole("status").filter({hasText:"Modification impossible"}).waitFor();
        assert.equal(await page.getByRole("button", {name:"Favori · Peugeot 208", pressed:true}).count(), 0);
        await context.close();
      }
      const page = await browser.newPage();
      for (const [mode, message] of [["empty", "Aucune annonce disponible"], ["unavailable", "Le catalogue est momentanément indisponible."]]) {
        state = mode;
        await page.goto(base + "/catalogue");
        await page.getByText(message, {exact:true}).waitFor();
        assert.equal(await page.locator('[data-catalog-dataset="autoworld/leboncoin"]').count(), mode === "empty" ? 1 : 0);
        state = "healthy";
      }
      state = "unavailable";
      await page.goto(base + "/catalogue?q=2022&after=200&limit=2");
      assert.equal(await page.getByRole("link", {name:"Réessayer"}).getAttribute("href"), "/catalogue?q=2022&after=200&limit=2");
      await page.goto(base + "/catalogue/300?q=2022&after=200&limit=2");
      assert.equal(await page.getByRole("link", {name:"Réessayer"}).getAttribute("href"), "/catalogue/300?q=2022&after=200&limit=2");
      state = "healthy";
      assert.equal((await page.goto(base + "/catalogue/999")).status(), 404);
      assert.equal((await page.goto(base + "/catalogue?after=abc")).status(), 404);
    } finally { await browser.close(); }
  }
  console.log({ checks, performanceSamples });
  await writeFile(new URL("checks.json", directory), JSON.stringify({ checks, performanceSamples }));
} catch (error) {
  // Next installs process-level exception handlers. Preserve a failing CI exit status.
  process.exitCode = 1;
  console.error(error);
} finally {
  web.closeAllConnections();
  reader.closeAllConnections();
  await Promise.all([new Promise(resolve => web.close(resolve)), new Promise(resolve => reader.close(resolve))]);
  await nextApp.close();
  transport.mock.restore();
  await rm(socketDir, { recursive: true, force: true });
}
