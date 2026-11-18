const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const { chromium, webkit } = require("../../../apps/web/node_modules/@playwright/test");

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
    const timer = page.locator("[data-deadline]");
    assert.equal(await timer.locator("time").getAttribute("datetime"), "2027-01-13");
    assert.equal(await page.locator(".film img").evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const { default: AxeBuilder } = require("../../../apps/web/node_modules/@axe-core/playwright");
    const landingAudit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(landingAudit.violations.map(v => v.id), []);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".film img").evaluate(img => getComputedStyle(img).animationName), "none");
    if (await timer.getByRole("button", { name: "Figer" }).isVisible()) {
      await timer.getByRole("button", { name: "Figer" }).click();
      await timer.getByRole("button", { name: "Reprendre" }).click();
    }
    if (process.env.PRIVATE_WEB_EVIDENCE) {
      mkdirSync(process.env.PRIVATE_WEB_EVIDENCE, { recursive: true });
      await page.screenshot({ path: process.env.PRIVATE_WEB_EVIDENCE + (mobile ? "/accueil-mobile.png" : "/accueil-bureau.png") });
    }
    const roadmap = page.locator(".road details");
    const summary = roadmap.locator("summary");
    await summary.focus();
    await summary.press("Enter");
    await roadmap.locator('[aria-current="step"]').waitFor();
    assert.equal(await roadmap.locator("li").count(), 4);
    assert.equal(await roadmap.locator("li").first().evaluate(el => getComputedStyle(el).animationName), "none");
    if (process.env.PRIVATE_WEB_EVIDENCE) {
      await page.locator(".road").screenshot({ path: process.env.PRIVATE_WEB_EVIDENCE + (mobile ? "/etapes-mobile.png" : "/etapes-bureau.png") });
    }
    await summary.press("Space");
    assert.equal(await roadmap.getAttribute("open"), null);
    const expiryContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const expiry = await expiryContext.newPage();
    await expiry.clock.install({ time: new Date("2027-01-13T11:00:01Z") });
    await expiry.goto(base);
    await expiry.locator(".expired").waitFor();
    assert.equal(await expiry.locator(".clock").isVisible(), false);
    await expiryContext.close();
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
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("id"), "username");
    const evidence = process.env.PRIVATE_WEB_EVIDENCE;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: evidence + (mobile ? "/mobile.png" : "/bureau.png") });
    }
    const req = context.request;
    for (const path of ["/demo", "/carte-grise", "/historique-vehicule", "/icon.svg", "/api/demo/v2/catalog", "/_next/static/chunks/example.js", report]) {
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
    const runPython = (args) => assert.equal(spawnSync("python3", args, { stdio: "inherit" }).status, 0);
    runPython(["-m", "django", "shell", "-c", "from django.contrib.sessions.models import Session; from django.utils.timezone import now; Session.objects.update(expire_date=now())"]);
    assert.equal((await req.get(base + asset)).status(), 401);
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
