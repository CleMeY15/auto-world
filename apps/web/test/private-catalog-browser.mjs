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
const items = [
  ["100", "Peugeot", "208", 1950000, 38700],
  ["200", "Renault", "Clio", null, null],
  ["300", "Citroën", "C3", 1399900, 50200],
].map(([id, brand, model, price, km]) => ({
  source_listing_id: id, source_url: "https://www.leboncoin.fr/ad/voitures/" + id, source_label: "Leboncoin",
  brand, model, year: 2022, price_amount_minor: price, price_currency: price === null ? null : "EUR",
  mileage_km: km, observed_at: "2026-11-22T12:00:00+00:00", images: id === "300" ? [photo, secondPhoto] : id === "100" ? [photo] : [],
}));

let state = "healthy";
const reader = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let body;
  if (state === "unavailable") { res.writeHead(503).end(); return; }
  if (url.pathname === "/internal/catalog") {
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    const rows = state === "empty" ? [] : items.filter(item => item.source_listing_id > (url.searchParams.get("after") ?? "")
      && [item.brand, item.model, item.year, item.source_listing_id].join(" ").toLowerCase().includes(query));
    const limit = Number(url.searchParams.get("limit"));
    body = { dataset: "autoworld/leboncoin", items: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1].source_listing_id : null };
  } else {
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
const web = http.createServer(nextApp.getRequestHandler());
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
        const context = await browser.newContext({ viewport, locale: "fr-FR" });
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
        const firstImage = Promise.withResolvers();
        let outcome = "success";
        await context.route("**/*", async route => {
          const request = route.request();
          if (request.url().startsWith(base + "/")) return route.continue();
          external.push({ url: request.url(), referrer: (await request.allHeaders()).referer ?? "", type: request.resourceType() });
          if (![photo, secondPhoto].includes(request.url())) return route.abort();
          await firstImage.promise;
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
        await page.getByRole("link", {name:/Renault Clio/}).waitFor();
        assert.equal(await page.getByRole("link", {name:/Peugeot 208/}).count(), 0);
        const shared = await context.newPage();
        await shared.goto(page.url());
        await shared.getByRole("link", {name:/Renault Clio/}).waitFor();
        assert.equal(await shared.getByRole("searchbox").inputValue(), "Clio");
        await shared.close();
        await field.fill("2022");
        await submit.click();
        await page.getByRole("link", {name:"Page suivante"}).click();
        await page.getByRole("link", {name:/Citroën C3/}).click();
        await page.getByRole("heading", {name:"Citroën C3"}).waitFor();
        assert.equal(await page.getByRole("link", {name:"Voir l’annonce sur Leboncoin"}).getAttribute("href"), items[2].source_url);
        const photoLink = page.getByRole("link", {name:"Photo 1"});
        assert.equal(await photoLink.isVisible(), false);
        await page.getByText("Liens vers les photos (2)", {exact:true}).click();
        assert.equal(await photoLink.getAttribute("href"), photo);
        assert.equal(await photoLink.getAttribute("referrerpolicy"), "no-referrer");
        assert.match(await photoLink.getAttribute("rel"), /noreferrer/);
        const back = page.getByRole("link", {name:"Retour aux annonces"});
        assert.equal(await back.getAttribute("href"), "/catalogue?q=2022&after=200&limit=2");
        assert.equal(new URL(page.url()).searchParams.get("q"), "2022");
        await inspect(page, engine + "-" + size + "-detail");
        assert.deepEqual(external, []);
        assert.equal(await page.locator("main img").count(), 0);

        const show = page.getByRole("button", {name:"Afficher les photos de Leboncoin"});
        await show.focus();
        await show.press("Enter");
        await page.getByText("Chargement de la photo…").waitFor();
        const frame = page.locator(".catalogue-photo-frame");
        const initial = await frame.boundingBox();
        firstImage.resolve();
        const img = page.getByRole("img", {name:"Citroën C3, photo 1"});
        await img.waitFor();
        assert.equal(await img.evaluate(element => element.naturalWidth), 480);
        const ready = await frame.boundingBox();
        assert.equal(ready.width, initial.width);
        assert.equal(ready.height, initial.height);
        const next = page.getByRole("button", {name:"Suivante"});
        const prev = page.getByRole("button", {name:"Précédente"});
        assert.equal(await prev.isDisabled(), true);
        assert.equal(await page.locator("main img").count(), 1);
        const openOriginal = page.getByRole("link", {name:"Ouvrir cette photo sur Leboncoin"});
        assert.equal(await openOriginal.getAttribute("href"), photo);
        assert.equal(await openOriginal.getAttribute("referrerpolicy"), "no-referrer");
        assert.deepEqual(external, [{url:photo, referrer:"", type:"image"}]);
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
        await page.getByRole("img", {name:"Citroën C3, photo 2"}).waitFor();
        await prev.press("Enter");
        await img.waitFor();
        await page.getByRole("button", {name:"Masquer les photos de Leboncoin"}).click();
        assert.equal(await page.locator("main img").count(), 0);
        assert(external.every(hit => [photo, secondPhoto].includes(hit.url) && hit.referrer === "" && hit.type === "image"));
        const allowedHits = external.length;
        await back.click();
        await page.getByRole("link", {name:/Citroën C3/}).waitFor();
        assert.equal(external.length, allowedHits);
        assert.equal(await field.inputValue(), "2022");
        const firstPage = await page.getByRole("link", { name: "Premières annonces" }).getAttribute("href");
        assert.equal(firstPage, "/catalogue?q=2022&limit=2");
        await field.fill("100");
        await submit.click();
        await page.getByRole("link", {name:/Peugeot 208/}).waitFor();
        assert.equal(new URL(page.url()).searchParams.has("after"), false);
        await page.goto(base + "/catalogue/200");
        await page.getByRole("heading", {name:"Renault Clio"}).waitFor();
        assert.equal(await show.count(), 0);
        await page.goto(base + "/catalogue/100");
        await show.click();
        await page.getByRole("img", {name:"Peugeot 208, photo 1"}).waitFor();
        assert.equal(await page.getByRole("group", {name:"Navigation entre les photos"}).count(), 0);
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
} finally {
  web.closeAllConnections();
  reader.closeAllConnections();
  await Promise.all([new Promise(resolve => web.close(resolve)), new Promise(resolve => reader.close(resolve))]);
  await nextApp.close();
  transport.mock.restore();
  await rm(socketDir, { recursive: true, force: true });
}
