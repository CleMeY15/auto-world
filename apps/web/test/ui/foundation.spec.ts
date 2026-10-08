import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("keyboard, validation, selection, reset and recovery work through the controls", async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aperçu de l’interface");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const budget = page.getByLabel("Budget maximum (€)");
  await page.getByRole("button", { name: "Valider l’exemple" }).click();
  await expect(budget).toBeFocused();
  await expect(budget).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Saisissez un montant supérieur à zéro.")).toBeVisible();
  for (const invalid of ["-1", "abc"]) {
    await budget.fill(invalid); await budget.press("Enter");
    await expect(budget).toHaveAttribute("aria-invalid", "true");
  }
  await budget.fill("45000"); await budget.press("Enter");
  await expect(page.getByText("Le montant est valide. L’exemple est prêt.")).toBeVisible();
  const chip = page.getByRole("button", { name: "Critère sélectionnable" });
  await chip.click(); await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click(); await expect(chip).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Réinitialiser" }).click();
  await expect(budget).toHaveValue(""); await expect(budget).toBeFocused();
  await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toBeDisabled();
  await page.getByLabel("Apparence").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-aw-theme", "dark");
  await page.getByLabel("Apparence").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-aw-theme", "light");
  await page.getByLabel("Apparence").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-aw-theme");
  await page.getByLabel("État de l’aperçu").selectOption("error");
  await expect(page.locator("#states").getByRole("alert")).toHaveText("Le chargement de l’aperçu a échoué.");
  await page.getByRole("button", { name: "Réessayer" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("L’aperçu est prêt.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Effacer l’exemple" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Aucun contenu pour le moment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Afficher un exemple" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("L’aperçu est prêt.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Effacer l’exemple" })).toBeFocused();
  await page.getByLabel("État de l’aperçu").selectOption("loading");
  await expect(page.getByRole("button", { name: "Préparation de l’aperçu" })).toBeDisabled();
  await expect(page.locator(".aw-skeleton").first()).toHaveAttribute("aria-hidden", "true");
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test("phone, tablet, desktop and dense states fit and pass automated accessibility", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "shared screenshot/a11y matrix is recorded once");
  test.setTimeout(120000);
  const directory = process.env.AW_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width: width!, height: height! });
    for (const theme of ["light", "dark"]) {
      await page.goto("/");
      await page.getByLabel("Apparence").selectOption(theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const primary = await page.getByRole("button", { name: "Valider l’exemple" }).boundingBox();
      expect(primary!.y + primary!.height + 5, "initial primary action and focus outline fit").toBeLessThanOrEqual(height!);
      const targets = await page.locator("button, input, select, header a").evaluateAll((elements) => elements.map((element) => { const bounds = element.getBoundingClientRect(); return { width: bounds.width, height: bounds.height }; }));
      expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
      const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(a11y.violations).toEqual([]);
      const name = `${width}-${theme}.png`;
      await page.screenshot({ path: directory ? path.join(directory, name) : testInfo.outputPath(name), scale: "css" });
      if (width === 390) for (const state of ["loading", "error", "success"]) {
        await page.getByLabel("État de l’aperçu").selectOption(state);
        await page.locator("#states").scrollIntoViewIfNeeded();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        const stateName = `${width}-${theme}-${state}.png`;
        await page.screenshot({ path: directory ? path.join(directory, stateName) : testInfo.outputPath(stateName), scale: "css" });
      }
    }
  }
});

test("selected chips retain readable contrast on hover and active press", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.goto("/");
    await page.getByLabel("Apparence").selectOption(theme);
    const chip = page.getByRole("button", { name: "Critère sélectionnable" });
    await chip.click();
    await chip.hover();
    expect((await new AxeBuilder({ page }).withTags(["wcag2aa"]).analyze()).violations).toEqual([]);
    await page.mouse.down();
    const activeContrast = await chip.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        // Canvas normalizes color-mix's computed srgb form to byte RGB channels.
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((byte) => {
          const value = byte / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
      };
      const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => a - b);
      return (values[1]! + 0.05) / (values[0]! + 0.05);
    });
    await page.mouse.move(0, 0); await page.mouse.up();
    expect(activeContrast).toBeGreaterThanOrEqual(4.5);
  }
});

test("narrow startup remains usable with wider platform font metrics", async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 });
  for (const font of ["Arial", "Verdana"]) for (const theme of ["light", "dark"]) {
    await page.goto("/");
    // Different system faces wrap differently; keep the production stack intact.
    await page.addStyleTag({ content: `:root { --aw-font-family: ${font}, sans-serif; }` });
    await page.getByLabel("Apparence").selectOption(theme);
    const primary = await page.getByRole("button", { name: "Valider l’exemple" }).boundingBox();
    expect(primary!.y + primary!.height + 5, `${font} primary action and outline fit`).toBeLessThanOrEqual(780);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (font === "Verdana" && browserName === "chromium") {
      const name = `320-${theme}-wide-font.png`;
      await page.screenshot({ path: process.env.AW_SCREENSHOT_DIR ? path.join(process.env.AW_SCREENSHOT_DIR, name) : testInfo.outputPath(name), scale: "css" });
    }
  }
});

test("system dark preference, reduced motion and 200% text remain usable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByLabel("Apparence")).toHaveValue("system");
  const colors = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(colors).toBe("rgb(21, 24, 21)");
  await page.getByLabel("État de l’aperçu").selectOption("loading");
  expect(await page.locator(".aw-skeleton").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("État de l’aperçu").selectOption("error");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByText("L’aperçu est prêt.", { exact: true })).toBeVisible();
});
