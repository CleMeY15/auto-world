const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { chromium, expect, webkit } = require("../../../apps/web/node_modules/@playwright/test");

async function main() {
  const mobile = process.argv[2] === "webkit";
  const browser = await (mobile ? webkit : chromium).launch();
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const base = process.env.TEST_URL;
    const listing = "lst_5696220ef97cf2af439e0279456ea36c70dd3df4e97b4455fc1577fa81aa8863";
    const target = "/demo?source=test#detail/" + listing;
    const report = "/demo/rapports/" + listing + "/b2-parcours";
    const landing = await page.goto(base + "/");
    assert.equal(landing.status(), 200);
    const signIn = page.getByRole("link", { name: "Se connecter" });
    await signIn.waitFor();
    await page.getByRole("heading", {level: 1, name: /Le marché auto mondial/}).waitFor();
    for (const selector of [".hero-art img", ".site-head .brand img"]) {
      await page.locator(selector).evaluate(img => img.decode());
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.getByRole("link", {name:"Accéder au catalogue"}).getAttribute("href"), "/acces/connexion");
    const { default: AxeBuilder } = require("../../../apps/web/node_modules/@axe-core/playwright");
    const landingAudit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(landingAudit.violations.map(v => v.id), []);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".hero-art img").evaluate(img => getComputedStyle(img).animationName), "none");
    if (process.env.PRIVATE_WEB_EVIDENCE) {
      mkdirSync(process.env.PRIVATE_WEB_EVIDENCE, { recursive: true });
      await page.screenshot({ path: process.env.PRIVATE_WEB_EVIDENCE + (mobile ? "/accueil-mobile.png" : "/accueil-bureau.png") });
    }
    await page.getByRole("link", {name: "Découvrir le projet"}).click();
    const roadmap = page.locator("#deploiement");
    const tabs = roadmap.getByRole("tab");
    const panel = roadmap.getByRole("tabpanel");
    assert.equal(await tabs.count(), 6);
    await expect(roadmap.getByRole("tab", {selected:true})).toHaveText("P1Catalogue privé");
    await expect(panel.getByRole("heading")).toHaveText("Parcourir le premier catalogue privé.");
    const current = roadmap.getByRole("tab", {name:/P1/});
    await current.focus();
    await current.press("ArrowRight");
    await expect(panel.getByRole("heading")).toHaveText("Relier la France, l’Allemagne et la Corée.");
    await roadmap.getByRole("button", {name:/Précédente/}).click();
    await expect(current).toHaveAttribute("aria-selected", "true");
    await current.press("End");
    await expect(panel.getByRole("heading")).toHaveText("Explorer le marché mondial.");
    await expect(roadmap.getByRole("button", {name:/Suivante/})).toHaveAttribute("aria-disabled", "true");
    await tabs.last().press("Home");
    await expect(roadmap.getByRole("button", {name:/Précédente/})).toHaveAttribute("aria-disabled", "true");
    await current.click();
    if (process.env.PRIVATE_WEB_EVIDENCE) {
      await roadmap.screenshot({ path: process.env.PRIVATE_WEB_EVIDENCE + (mobile ? "/etapes-mobile.png" : "/etapes-bureau.png") });
    }
    const plain = await browser.newContext({
      ignoreHTTPSErrors: true, javaScriptEnabled: false, viewport: { width: 320, height: 740 },
    });
    const plainPage = await plain.newPage();
    await plainPage.route(base + "/", async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace("</head>", "<style>:root { font-size: 200% }</style></head>");
      await route.fulfill({ response, body });
    });
    await plainPage.goto(base);
    assert.ok(await plainPage.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize) >= 32));
    assert.equal(await plainPage.locator(".phase:visible").count(), 6);
    await plainPage.getByRole("link", {name: /P5/}).click();
    assert.equal(new URL(plainPage.url()).hash, "#phase-5");
    assert.ok(await plainPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await plain.close();
    await signIn.click();
    await page.getByLabel("Identifiant").waitFor();
    assert.equal(new URL(page.url()).pathname, "/acces/connexion");
    const entry = await page.goto(base + target);
    assert.equal(entry.status(), 401);
    assert.match(entry.headers()["cache-control"], /no-store/);
    assert.equal(await page.locator("[name=next]").inputValue(), target);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(a11y.violations.map(v => v.id), []);
    const timing = await page.evaluate(() => performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd);
    assert.ok(timing > 0 && timing < 2000, "login DOM ready outside 2 s local budget");
    console.log("Login DOM ready (ms):", Math.round(timing));
    await page.getByRole("link", {name: "AutoFindex, accueil"}).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("id"), "username");
    const evidence = process.env.PRIVATE_WEB_EVIDENCE;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: evidence + (mobile ? "/mobile.png" : "/bureau.png") });
    }
    const req = context.request;
    for (const path of ["/demo", "/carte-grise", "/historique-vehicule", "/importation", "/icon.svg", "/api/demo/v2/catalog", "/_next/static/chunks/example.js", report]) {
      const response = await req.get(base + path, { headers: { "X-Original-URI": "/demo", "X-Forwarded-User": "invite" } });
      assert.equal(response.status(), 401, path);
      assert.match(response.headers()["cache-control"], /no-store/);
    }
    const login = () => page.getByRole("button", { name: "Se connecter" }).click();
    await page.getByLabel("Identifiant").fill("invite");
    await page.getByLabel("Mot de passe").fill("incorrect");
    await login();
    await page.getByRole("alert").waitFor();
    await page.getByLabel("Mot de passe").fill(process.env.TEST_PASSWORD);
    await login();
    await page.waitForURL(base + target);
    const logoutLink = page.getByRole("link", { name: "Se déconnecter" });
    await logoutLink.waitFor();
    const auth = (await context.cookies()).find(c => c.name === "__Host-aw-session");
    assert.ok(auth.secure && auth.httpOnly && auth.sameSite === "Lax");
    const asset = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
    const assetResponse = await req.get(base + asset);
    assert.equal(assetResponse.status(), 200);
    assert.match(assetResponse.headers()["cache-control"], /no-store/);
    assert.equal((await req.get(base + "/admin")).status(), 403);
    const dossier = await context.newPage();
    assert.equal((await dossier.goto(base + "/importation")).status(), 200);
    await dossier.getByRole("combobox", { name: "Type de vendeur" }).selectOption(mobile ? "professional" : "private");
    await dossier.getByRole("checkbox", { name: "Certificat d’immatriculation allemand" }).check();
    if (evidence) {
      await dossier.locator("h1").scrollIntoViewIfNeeded();
      await dossier.screenshot({ path: evidence + (mobile ? "/importation-mobile.png" : "/importation-bureau.png"), fullPage: true });
    }
    await dossier.close();
    assert.equal((await req.post(base + "/api/demo/v2/search", { headers: { Origin: "https://example.org" } })).status(), 403);
    assert.equal((await req.post(base + "/acces/deconnexion", { headers: { Origin: base } })).status(), 403);
    assert.equal((await req.get(base + "/api/demo/v2/catalog")).status(), 200);
    const search = await req.post(base + "/api/demo/v2/search", {
      headers: { Origin: base }, data: { schemaVersion: 2, sort: "listing_asc" },
    });
    assert.equal(search.status(), 200);
    assert.equal((await req.get(base + "/api/demo/v2/listings/" + listing)).status(), 200);
    const expectedReports = process.env.PRIVATE_WEB_REQUIRE_REPORTS === "1";
    if (expectedReports) {
      const doc = await req.get(base + report);
      assert.equal(doc.status(), 200);
      assert.match(await doc.text(), /Exemple de rapport/);
    }
    const history = await context.newPage();
    await history.goto(base + (expectedReports ? report : "/historique-vehicule"));
    await history.getByRole("link", { name: "Se déconnecter" }).waitFor();
    await history.goto(base + "/acces/deconnexion");
    await page.evaluate(() => localStorage.setItem("auto-world.demo.favorites.v1", "fixture"));
    await logoutLink.click();
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await page.getByRole("button", { name: "Se connecter" }).waitFor();
    await page.waitForFunction(() => localStorage.getItem("auto-world.demo.favorites.v1") === null);
    await history.goBack();
    await history.getByRole("button", { name: "Se connecter" }).waitFor();
    assert.equal(await history.getByRole("link", { name: "Se déconnecter" }).count(), 0);
    await context.addCookies([auth]); // replay the old opaque identifier after server-side logout
    assert.equal((await req.get(base + asset)).status(), 401);
    await page.goto(base + "/acces/connexion?next=https%3A%2F%2Fexample.org");
    assert.equal(await page.locator("[name=next]").inputValue(), "/demo");
    await page.locator("[name=next]").evaluate(el => { el.value = "https://example.org/"; });
    await page.getByLabel("Identifiant").fill("invite");
    await page.getByLabel("Mot de passe").fill(process.env.TEST_PASSWORD);
    await login();
    await logoutLink.waitFor();
    assert.equal(page.url(), base + "/demo");
    await page.getByRole("link", { name: "AutoFindex, accueil" }).waitFor();
    const scene = page.locator(".demo-search-scene img");
    await scene.scrollIntoViewIfNeeded();
    await scene.evaluate(img => img.decode());
    const illustration = new URL(await scene.getAttribute("src"), base);
    assert.equal(illustration.origin, base);
    assert.match(illustration.pathname, /^\/_next\/static\/media\/.+\.webp$/);
    const runPython = (args) => assert.equal(spawnSync("python3", args, { stdio: "inherit" }).status, 0);
    runPython(["-m", "django", "shell", "-c", "from django.contrib.sessions.models import Session; from django.utils.timezone import now; Session.objects.update(expire_date=now())"]);
    assert.equal((await req.get(base + asset)).status(), 401);
    assert.equal((await req.get(illustration.href)).status(), 401);
    await page.goto(base + "/acces/connexion");
    await page.getByLabel("Identifiant").fill("invite");
    await page.getByLabel("Mot de passe").fill(process.env.TEST_PASSWORD);
    await login();
    await logoutLink.waitFor();
    runPython(["accounts.py", "remove", "invite"]);
    assert.equal((await req.get(base + asset)).status(), 401);
    runPython(["-m", "django", "shell", "-c", "import os; from django.contrib.auth.models import User; User.objects.create_user('invite', password=os.environ['TEST_PASSWORD'])"]);
    assert.equal((await req.get(base + asset)).status(), 401);
    if (mobile) {
      let status;
      for (let count = 0; count < 20 && status !== 429; count++) {
        status = (await req.post(base + "/acces/connexion", { headers: { Origin: base } })).status();
        assert.ok(status === 403 || status === 429);
      }
      assert.equal(status, 429);
      assert.equal((await req.get(base + "/acces/deconnexion")).status(), 200);
    }
    console.log("PASS", process.argv[2], "login, deep link, asset, CSRF, logout and account revocation");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
