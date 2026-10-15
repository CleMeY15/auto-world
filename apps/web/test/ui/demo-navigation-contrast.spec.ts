import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type ContrastSample = {
  label: string;
  fraction: number;
  foreground: string;
  background: string;
  ratio: number;
};
type ContrastReport = { samples: ContrastSample[]; error?: string };
type ContrastWindow = Window & { navigationContrast?: Promise<ContrastReport> };

async function expectReadableChange(page: Page, testInfo: TestInfo, name: string, action: () => Promise<unknown>) {
  // Capture in the mutation microtask: waiting for a Playwright round trip can miss
  // the beginning of a short CSS transition, even when its midpoint is readable.
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("nav[aria-label='Sections principales'] button"));
    if (buttons.length !== 2) throw new Error("Contrast harness: expected both navigation buttons");
    if (typeof CSSTransition === "undefined" || buttons.some((button) => typeof button.getAnimations !== "function")) {
      throw new Error("Contrast harness: transition inspection unavailable");
    }
    const fractions = [0, 0.1, 0.25, 0.5, 0.75, 1];
    function luminance(value: string) {
      const rgb = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/u.exec(value);
      const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/u.exec(value);
      const match = rgb ?? srgb;
      if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) {
        throw new Error(`Contrast harness: unparseable or transparent rendered color ${value}`);
      }
      const channels = match.slice(1, 4).map((channel) => {
        const encoded = Number(channel) / (rgb ? 255 : 1);
        if (!Number.isFinite(encoded) || encoded < 0 || encoded > 1) throw new Error("Contrast harness: invalid rendered channel");
        return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    }
    (window as ContrastWindow).navigationContrast = new Promise<ContrastReport>((resolve) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve({ samples: [], error: "Contrast harness: expected navigation/theme mutation missing" });
      }, 10_000);
      const observer = new MutationObserver(() => {
        observer.disconnect();
        window.clearTimeout(timeout);
        const transitions: CSSTransition[] = [];
        try {
          // The html theme mutation triggers inspection of EACH button, not html.
          const animations = buttons.map((button) => {
            const backgroundTransitions = button.getAnimations().filter((animation): animation is CSSTransition =>
              animation instanceof CSSTransition && animation.transitionProperty === "background-color");
            for (const animation of backgroundTransitions) {
              animation.pause();
              transitions.push(animation);
            }
            return backgroundTransitions;
          });
          const samples: ContrastSample[] = [];
          for (const [index, button] of buttons.entries()) {
            for (const fraction of fractions) {
              for (const animation of animations[index]!) {
                const timing = animation.effect?.getComputedTiming();
                if (!timing || typeof timing.delay !== "number" || !Number.isFinite(timing.delay)
                  || typeof timing.activeDuration !== "number" || !Number.isFinite(timing.activeDuration)) {
                  throw new Error("Contrast harness: uninspectable transition timing");
                }
                animation.currentTime = timing.delay + fraction * timing.activeDuration;
              }
              const style = getComputedStyle(button);
              if (style.opacity !== "1" || style.visibility !== "visible") throw new Error("Contrast harness: obscured navigation text");
              const foreground = style.color;
              const background = style.backgroundColor;
              const front = luminance(foreground);
              const back = luminance(background);
              samples.push({ label: button.textContent!.trim(), fraction, foreground, background, ratio: (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05) });
            }
          }
          resolve({ samples });
        } catch (error) {
          resolve({ samples: [], error: error instanceof Error ? error.message : "Contrast harness: inspection failed" });
        } finally {
          for (const animation of transitions) animation.finish();
        }
      });
      for (const button of buttons) observer.observe(button, { attributes: true, attributeFilter: ["class"] });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-aw-theme"] });
    });
  });
  await action();
  const report = await page.evaluate(async () => {
    const pending = (window as ContrastWindow).navigationContrast;
    if (!pending) throw new Error("Contrast harness: observation not armed");
    const result = await pending;
    delete (window as ContrastWindow).navigationContrast;
    return result;
  });
  const reportPath = testInfo.outputPath(`${name}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await testInfo.attach(name, { path: reportPath, contentType: "application/json" });
  expect(report.error, name).toBeUndefined();
  expect(report.samples, name).toHaveLength(12);
  for (const sample of report.samples) {
    expect(sample.ratio, `${name}: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5);
  }
}

for (const [width, height] of [[320, 780], [390, 844], [768, 1024], [1440, 900]] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`navigation labels remain readable during real changes at ${width}px with ${reducedMotion} motion`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion });
      await page.goto("/demo");
      await expect(page.locator("main")).toHaveAttribute("data-demo-hydrated", "true");
      const navigation = page.getByRole("navigation", { name: "Sections principales" });
      const search = navigation.getByRole("button", { name: "Recherche", exact: true });
      const saved = navigation.getByRole("button", { name: "Enregistrés", exact: true });
      const appearance = page.getByLabel("Apparence");
      // These use the real loopback synthetic API started by the existing config.
      await appearance.selectOption("light");
      await expect(page.locator("html")).toHaveAttribute("data-aw-theme", "light");
      await page.getByRole("button", { name: "Rechercher", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
      const card = page.locator(".demo-result-card").first();
      await card.getByRole("button", { name: "Ajouter aux favoris" }).click();

      for (const theme of ["light", "dark"] as const) {
        await expectReadableChange(page, testInfo, `${theme}-results-to-detail`, () => card.getByRole("button", { name: "Voir le détail" }).click());
        await expect(page.getByRole("heading", { name: "Historique des observations" })).toBeVisible();
        await expectReadableChange(page, testInfo, `${theme}-detail-to-results`, () => search.click());
        await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
        await expectReadableChange(page, testInfo, `${theme}-results-to-saved`, () => saved.click());
        await expect(page.getByRole("heading", { name: "Mes listes" })).toBeVisible();
        await expectReadableChange(page, testInfo, `${theme}-saved-to-results`, () => search.click());
        await expect(page.getByRole("heading", { name: "Résultats de la démo" })).toBeVisible();
        const nextTheme = theme === "light" ? "dark" : "light";
        await expectReadableChange(page, testInfo, `${theme}-to-${nextTheme}`, () => appearance.selectOption(nextTheme));
        await expect(page.locator("html")).toHaveAttribute("data-aw-theme", nextTheme);
      }

      await search.focus();
      await page.keyboard.press("Tab");
      await expect(saved).toBeFocused();
      const focus = await saved.evaluate((button) => {
        const style = getComputedStyle(button);
        return { visible: button.matches(":focus-visible"), kind: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
      });
      expect(focus.visible).toBe(true);
      expect(focus.kind).toBe("solid");
      expect(focus.width).toBeGreaterThanOrEqual(2);
      expect(focus.offset).toBeGreaterThanOrEqual(0);
      await expectReadableChange(page, testInfo, "keyboard-to-saved", () => page.keyboard.press("Enter"));
      await expect(page.getByRole("heading", { name: "Mes listes" })).toBeFocused();
      const targets = await navigation.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }));
      expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
    });
  }
}
