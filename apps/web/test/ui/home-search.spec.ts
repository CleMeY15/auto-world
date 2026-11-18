import { expect, test } from "@playwright/test";

for (const enabled of [true, false]) {
  test(`home serves the French preview with demo search ${enabled ? "enabled" : "disabled"}`, async ({ page }, testInfo) => {
    const demoRequests: string[] = [];
    page.on("request", (request) => {
      if (/^\/(?:api\/)?demo(?:\/|$)/u.test(new URL(request.url()).pathname)) demoRequests.push(request.url());
    });
    const response = await page.goto(enabled ? "/" : String(testInfo.config.metadata.demoDisabledBaseURL));
    expect(response?.status()).toBe(200);
    const html = await response!.text();
    expect(html).toMatch(/lang="fr"/u);
    expect(html).toContain("Aperçu de l’interface");
    expect(html).toContain("Aucune annonce ni recherche réelle");
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)|<img(?:\s|>)|sourceListingId|connectorRunId|snapshotId|legalStatus/u);
    await expect(page.getByRole("link", { name: "Voir les états" })).toHaveAttribute("href", "#states");
    const guides = page.getByRole("navigation", { name: "Outils" });
    await expect(guides.getByRole("link", { name: "Carte grise" })).toHaveAttribute("href", "/carte-grise");
    await expect(guides.getByRole("link", { name: "Historique du véhicule" })).toHaveAttribute("href", "/historique-vehicule");
    expect(demoRequests).toEqual([]);
    if (enabled) {
      const search = page.getByRole("link", { name: "Essayer la recherche démo" });
      await expect(search).toBeInViewport();
      await expect(search).toHaveAttribute("href", "/demo");
      await page.getByRole("link", { name: "Voir les états" }).focus();
      await page.keyboard.press("Tab");
      await expect(search).toBeFocused();
      const bounds = await search.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/demo$/u);
      await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toBeEnabled();
    } else {
      await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
      await page.getByLabel("Budget maximum (€)").fill("45000");
      await page.getByRole("button", { name: "Valider l’exemple" }).click();
      await expect(page.getByText("Le montant est valide. L’exemple est prêt.")).toBeVisible();
      expect(demoRequests).toEqual([]);
    }
  });
}
