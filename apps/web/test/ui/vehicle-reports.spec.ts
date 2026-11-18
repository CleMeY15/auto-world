import { expect, test } from "@playwright/test";

const multiple = "lst_5696220ef97cf2af439e0279456ea36c70dd3df4e97b4455fc1577fa81aa8863";
const single = "lst_5b1bfbea35a7f70ba8a6358f2c1dca6e4a243af7e2e95df49d127fcaae748c09";
const empty = "lst_84b7ff767f88174f457564d86c2e36bcfaea6d1cef341b7c0b69645a25adbab4";

test("normal demo results open the supplied local documents and switch report sets with the listing", async ({ page, baseURL }) => {
  const external = new Set<string>();
  const documentRequests: string[] = [];
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== baseURL) external.add(url.origin);
    if (url.pathname.startsWith("/demo/rapports/")) documentRequests.push(url.pathname);
  });
  await page.goto("/demo");
  await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
  await page.getByLabel("Budget maximum (€)").fill("18000");
  await page.getByRole("button", { name: "Afficher les critères avancés" }).click();
  await page.getByLabel("Trier les résultats").selectOption("price_desc");
  const [search] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/demo/v2/search") && response.request().method() === "POST"),
    page.locator("form").getByRole("button", { name: "Rechercher", exact: true }).click(),
  ]);
  const { data } = await search.json() as { data: { results: { listingId: string }[] } };
  const ids = data.results.map((result) => result.listingId);
  expect(ids).toEqual(expect.arrayContaining([multiple, single, empty]));
  const openListing = (id: string) => page.locator(`#demo-result-open-${ids.indexOf(id)}`);
  const cards = page.locator(".demo-result-copy");
  await expect(cards).toHaveCount(ids.length);
  await expect(cards.nth(ids.indexOf(multiple))).toContainText("Modèle B2 fictif");
  const orderedCards = await cards.allTextContents();
  const criteria = page.locator("#demo-active-criteria-summary");
  const appliedCriteria = await criteria.innerText();
  await openListing(multiple).click();
  await expect(page).toHaveURL(new URL(`/demo#detail/${multiple}`, baseURL).href);
  const section = page.getByRole("region", { name: "Rapports du véhicule" });
  await expect(section.getByRole("link")).toHaveCount(2);
  expect(documentRequests).toEqual([]);

  async function readReport(provider: string, listingId: string, document: string) {
    const trigger = section.getByRole("link", { name: new RegExp(provider, "u") });
    const [reader] = await Promise.all([page.waitForEvent("popup"), trigger.click()]);
    const destination = `/demo/rapports/${listingId}/${document}#depuis-annonce`;
    await expect(reader).toHaveURL(new URL(destination, baseURL).href);
    await expect(reader.getByRole("heading", { level: 1 })).toContainText(provider);
    await Promise.all([
      reader.waitForEvent("close"),
      reader.getByRole("link", { name: "Retour à l’annonce" }).click(),
    ]);
    await expect(page).toHaveURL(new URL(`/demo#detail/${listingId}`, baseURL).href);
  }

  await readReport("HistoVec", multiple, "b2-parcours");
  await readReport("carVertical", multiple, "b2-kilometrage");
  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await expect(openListing(multiple)).toBeFocused();
  await expect(page.getByLabel("Trier ces résultats")).toHaveValue("price_desc");
  await expect(criteria).toHaveText(appliedCriteria);
  await expect.poll(() => cards.allTextContents()).toEqual(orderedCards);
  await openListing(single).click();
  await expect(section.getByRole("link")).toHaveCount(1);
  await readReport("CARFAX", single, "b1-entretien");
  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await openListing(empty).click();
  await expect(section.getByRole("link")).toHaveAttribute("href", "/historique-vehicule");
  expect(external.size).toBe(0);
});

test("the reader rejects swapped documents and disabled-demo access", async ({ page, request }, testInfo) => {
  await page.goto(`/demo/rapports/${multiple}/b2-parcours`);
  await page.getByRole("link", { name: "Retour à l’annonce" }).click();
  await expect(page.getByRole("region", { name: "Rapports du véhicule" }).getByRole("link")).toHaveCount(2);
  const wrong = await request.get(`/demo/rapports/${single}/b2-parcours`);
  expect(wrong.status()).toBe(404);
  const disabled = String(testInfo.config.metadata.demoDisabledBaseURL);
  expect((await request.get(`${disabled}/demo/rapports/${multiple}/b2-parcours`)).status()).toBe(404);
});
