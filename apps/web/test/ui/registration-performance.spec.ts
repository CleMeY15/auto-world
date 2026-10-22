import { expect, test } from "@playwright/test";
import { arch, cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SAMPLE_COUNT = 10;
const LCP_BUDGET_MS = 2_500;
const CLS_BUDGET = 0.1;
const DISCLOSURE_BUDGET_MS = 100;

type BrowserMeasurements = {
  readonly cls: number;
  readonly lcp: number;
  readonly observersReady: boolean;
};

type Sample = {
  readonly cls: number;
  readonly disclosureMs: number;
  readonly lcpMs: number;
  readonly sample: number;
};

function percentile75(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.75) - 1]!;
}

test("the static registration guide meets cold-load and native disclosure budgets", async ({ browser, browserName, context, page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  if (browserName !== "chromium") {
    await page.goto("/carte-grise");
    const details = page.locator("details");
    const summary = details.locator("summary");
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(details).toHaveJSProperty("open", true);
    await page.keyboard.press("Space");
    await expect(details).toHaveJSProperty("open", false);
    return;
  }
  await page.addInitScript(() => {
    const state = { cls: 0, lcp: 0, observersReady: false };
    Object.defineProperty(window, "__awRegistrationPerformance", { configurable: true, value: state });
    const supported = PerformanceObserver.supportedEntryTypes;
    if (supported.includes("largest-contentful-paint")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp = entry.startTime;
      }).observe({ buffered: true, type: "largest-contentful-paint" });
    }
    if (supported.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) state.cls += shift.value ?? 0;
        }
      }).observe({ buffered: true, type: "layout-shift" });
    }
    state.observersReady = true;
  });

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    connectionType: "cellular3g",
    downloadThroughput: 1_600_000 / 8,
    latency: 150,
    offline: false,
    uploadThroughput: 750_000 / 8,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const samples: Sample[] = [];
  try {
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      await client.send("Network.clearBrowserCache");
      await page.goto(`/carte-grise?performance-sample=${index + 1}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => {
        const measurement = (window as typeof window & { __awRegistrationPerformance?: BrowserMeasurements }).__awRegistrationPerformance;
        return measurement?.observersReady === true && measurement.lcp > 0;
      });

      const details = page.locator("details");
      const summary = details.locator("summary");
      await page.evaluate(() => { Object.defineProperty(window, "__awRegistrationDisclosureMs", { configurable: true, writable: true, value: -1 }); });
      await summary.evaluate((element) => {
        const disclosure = element.parentElement as HTMLDetailsElement;
        element.addEventListener("click", () => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (!disclosure.open) return;
            observer.disconnect();
            requestAnimationFrame(() => {
              (window as typeof window & { __awRegistrationDisclosureMs: number }).__awRegistrationDisclosureMs = performance.now() - started;
            });
          });
          observer.observe(disclosure, { attributes: true, attributeFilter: ["open"] });
        }, { once: true });
      });
      await summary.click();
      await expect(details).toHaveJSProperty("open", true);
      await page.waitForFunction(() => (window as typeof window & { __awRegistrationDisclosureMs: number }).__awRegistrationDisclosureMs >= 0);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const measurement = await page.evaluate(() => ({
        ...((window as typeof window & { __awRegistrationPerformance: BrowserMeasurements }).__awRegistrationPerformance),
        disclosureMs: (window as typeof window & { __awRegistrationDisclosureMs: number }).__awRegistrationDisclosureMs,
      }));
      samples.push({ cls: measurement.cls, disclosureMs: measurement.disclosureMs, lcpMs: measurement.lcp, sample: index + 1 });
    }
  } finally {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await client.send("Network.emulateNetworkConditions", {
      downloadThroughput: -1,
      latency: 0,
      offline: false,
      uploadThroughput: -1,
    });
  }

  const p75 = {
    cls: percentile75(samples.map((sample) => sample.cls)),
    disclosureMs: percentile75(samples.map((sample) => sample.disclosureMs)),
    lcpMs: percentile75(samples.map((sample) => sample.lcpMs)),
  };
  const report = {
    browserVersion: browser.version(),
    budgets: { clsP75: CLS_BUDGET, disclosureMaxMs: DISCLOSURE_BUDGET_MS, lcpP75Ms: LCP_BUDGET_MS },
    caveat: "Bounded Chromium lab evidence for the local static route. The disclosure duration ends in the next animation-frame callback; it is not a physical-paint or production INP claim, and no remote official-service timing is measured.",
    collectedAt: new Date().toISOString(),
    host: { architecture: arch(), cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
    p75,
    platform: process.platform,
    profile: {
      cpuSlowdownMultiplier: 4,
      downloadBitsPerSecond: 1_600_000,
      latencyMs: 150,
      uploadBitsPerSecond: 750_000,
      viewport: { height: 844, width: 390 },
    },
    sampleCount: SAMPLE_COUNT,
    samples,
  };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  await testInfo.attach("registration-performance-measurements.json", {
    body: Buffer.from(serialized),
    contentType: "application/json",
  });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "registration-performance-measurements.json"), serialized);
  }

  expect(samples).toHaveLength(SAMPLE_COUNT);
  expect(p75.lcpMs, "LCP p75 should remain within the mobile lab budget").toBeLessThanOrEqual(LCP_BUDGET_MS);
  expect(p75.cls, "CLS p75 should remain within the mobile lab budget").toBeLessThanOrEqual(CLS_BUDGET);
  expect(Math.max(...samples.map((sample) => sample.disclosureMs)), "Every native details disclosure should reach the next animation-frame callback within 100ms").toBeLessThanOrEqual(DISCLOSURE_BUDGET_MS);
});
