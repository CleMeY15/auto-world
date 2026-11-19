import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const dossier = "/importation";
const title = "Préparer mon dossier d’importation";

test("le dossier conserve les pièces communes et distingue les justificatifs selon le vendeur", async ({ page }) => {
  for (const path of ["/", "/carte-grise"]) {
    await page.goto(path);
    await expect(page.locator(`a[href="${dossier}"]`)).toBeVisible();
  }
  await page.goto("/demo");
  const entry = page.getByRole("navigation", { name: "Outils" }).getByRole("link", { name: "Dossier d’importation" });
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/importation$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  const seller = page.getByRole("combobox", { name: "Type de vendeur" });
  const registration = page.getByRole("checkbox", { name: /Certificat d’immatriculation allemand/u });
  const invoice = page.getByRole("checkbox", { name: /Facture du professionnel/u });
  await seller.selectOption("professional");
  await registration.focus();
  await page.keyboard.press("Space");
  await expect(registration).toBeChecked();
  await invoice.check();
  await page.reload();
  await expect(seller).toHaveValue("professional");
  await expect(registration).toBeChecked();
  await expect(invoice).toBeChecked();
  await seller.selectOption("private");
  await expect(registration).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Certificat de cession du particulier/u })).not.toBeChecked();
  await expect(invoice).toHaveCount(0);
  for (const item of await page.getByRole("checkbox").all()) await item.check();
  await expect(page.getByText("Tous les préparatifs sont cochés.", { exact: false })).toBeVisible();
  expect(writes).toEqual([]);

  const reset = page.getByRole("button", { name: "Commencer un nouveau dossier" });
  page.once("dialog", dialog => dialog.dismiss());
  await reset.click();
  await expect(registration).toBeChecked();
  page.once("dialog", dialog => dialog.accept());
  await reset.click();
  await expect(seller).toBeFocused();
  await page.reload();
  await expect(seller).toHaveValue("unknown");
  await seller.selectOption("professional");
  await expect(invoice).not.toBeChecked();

  const audit = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(violation => violation.id)).toEqual([]);
});

test("le suivi reste utilisable sur la page lorsque le navigateur refuse le stockage", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", {
    get() { throw new DOMException("Accès refusé", "SecurityError"); },
  }));
  await page.goto(dossier);
  await expect(page.getByText("Le stockage est indisponible.", { exact: false })).toBeVisible();
  const registration = page.getByRole("checkbox", { name: /Certificat d’immatriculation allemand/u });
  await registration.check();
  await expect(registration).toBeChecked();
  await page.reload();
  await expect(registration).not.toBeChecked();
});

test.describe("sans JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("les pièces à préparer et les démarches officielles restent lisibles", async ({ page }) => {
    const response = await page.goto(dossier);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText("Certificat d’immatriculation allemand", { exact: true })).toBeVisible();
    for (const code of ["F179", "R49258"]) {
      const link = page.locator(`a[href="https://www.service-public.gouv.fr/particuliers/vosdroits/${code}"]`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("rel", /\bnoreferrer\b/u);
    }
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });
});
