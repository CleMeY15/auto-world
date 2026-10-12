import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { arch, cpus, totalmem } from "node:os";

const SAMPLE_COUNT = 10;
const LCP_BUDGET_MS = 2_500;
const CLS_BUDGET = 0.1;
const INTERACTION_BUDGET_MS = 200;
const EVENT_TIMING_FLOOR_MS = 16;

type BrowserMeasurements = {
  readonly cls: number;
  readonly favoriteFeedbackMs: number;
  readonly eventDurations: readonly number[];
  readonly eventTimingSupported: boolean;
  readonly lcp: number;
  readonly observersReady: boolean;
};

type Sample = {
  readonly cls: number;
  readonly favoriteFeedbackMs: number;
  readonly interactionDurationMs: number;
  readonly interactionEntryCount: number;
  readonly interactionMeasurement: "event-timing" | "event-timing-floor";
  readonly lcpMs: number;
  readonly sample: number;
};

function percentile75(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.75) - 1]!;
}

test("real loopback proxy meets the deterministic synthetic search latency budget", async ({ request, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "The HTTP benchmark is independent of browser engine and runs once");
  const durations: number[] = [];
  const states: Record<string, number> = {};
  for (let index = 0; index < 55; index += 1) {
    const started = performance.now();
    const response = await request.post("/api/demo/search", { data: { schemaVersion: 1, sort: "listing_asc" } });
    const elapsed = performance.now() - started;
    expect(response.status()).toBe(200);
    const payload = await response.json() as { schemaVersion: number; data: { dataMode: string; state: string } };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.data.dataMode).toBe("synthetic");
    expect(["complete", "partial", "stale"]).toContain(payload.data.state);
    if (index >= 5) {
      durations.push(elapsed);
      states[payload.data.state] = (states[payload.data.state] ?? 0) + 1;
    }
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  const report = {
    collectedAt: new Date().toISOString(),
    platform: process.platform,
    scenario: "Actual localhost HTTP through production Next proxy and separate development synthetic API;5 warmups,50 measured requests, no intercepted routes.",
    caveat: "Small synthetic loopback lab sample, without production load or scale. Stale projections remain stale.",
    sampleCount: durations.length,
    projectionStates: states,
    samplesMs: durations,
    p95Ms,
    budgetP95Ms: 500,
  };
  await testInfo.attach("demo-loopback-api-performance.json", { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: "application/json" });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "demo-loopback-api-performance.json"), JSON.stringify(report, null, 2) + "\n");
  }
  expect(p95Ms).toBeLessThanOrEqual(500);
});

test("real synthetic web flow stays within mobile lab and favorite feedback budgets", async ({ browser, browserName, context, page }, testInfo) => {
  test.skip(browserName !== "chromium", "CDP network and CPU throttling are Chromium-only");
  test.setTimeout(180_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((eventTimingFloorMs) => {
    const state = {
      cls: 0,
      favoriteFeedbackMs: -1,
      eventDurations: [] as number[],
      eventTimingSupported: false,
      lcp: 0,
      observersReady: false,
    };
    Object.defineProperty(window, "__awPerformance", { configurable: true, value: state });

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
    if (supported.includes("event")) {
      state.eventTimingSupported = true;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.eventDurations.push(entry.duration);
      }).observe({
        buffered: true,
        durationThreshold: eventTimingFloorMs,
        type: "event",
      } as PerformanceObserverInit & { durationThreshold: number });
    }
    localStorage.removeItem("auto-world.demo.favorites.v1");
    state.observersReady = true;
  }, EVENT_TIMING_FLOOR_MS);

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
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    await client.send("Network.clearBrowserCache");
    await page.goto(`/demo?performance-sample=${index + 1}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const measurement = (window as typeof window & { __awPerformance?: BrowserMeasurements }).__awPerformance;
      return measurement?.observersReady === true && measurement.lcp > 0;
    });

    const freeText = page.getByLabel("Recherche libre");
    await freeText.click();
    await page.keyboard.type("voyage");
    await freeText.fill("");
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    const favorite = page.locator(".demo-result-card").first().getByRole("button", { name: "Ajouter aux favoris" });
    await expect(favorite).toBeVisible();
    await favorite.evaluate((button) => {
      button.addEventListener("click", () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (button.getAttribute("aria-pressed") !== "true") return;
          observer.disconnect();
          requestAnimationFrame(() => {
            (window as typeof window & { __awPerformance: { favoriteFeedbackMs: number } }).__awPerformance.favoriteFeedbackMs = performance.now() - started;
          });
        });
        observer.observe(button, { attributes: true, attributeFilter: ["aria-pressed"] });
      }, { once: true });
    });
    await favorite.click();
    await expect(page.getByRole("button", { name: /Favoris \(1\)/ })).toBeVisible();
    await page.waitForFunction(() => (window as typeof window & { __awPerformance: { favoriteFeedbackMs: number } }).__awPerformance.favoriteFeedbackMs >= 0);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    const measurement = await page.evaluate(() => {
      return (window as typeof window & { __awPerformance: BrowserMeasurements }).__awPerformance;
    });
    const observedInteractionDuration = measurement.eventDurations.length > 0
      ? Math.max(...measurement.eventDurations)
      : undefined;
    samples.push({
      cls: measurement.cls,
      favoriteFeedbackMs: measurement.favoriteFeedbackMs,
      interactionDurationMs: Math.max(EVENT_TIMING_FLOOR_MS, observedInteractionDuration ?? 0),
      interactionEntryCount: measurement.eventDurations.length,
      interactionMeasurement: observedInteractionDuration === undefined ? "event-timing-floor" : "event-timing",
      lcpMs: measurement.lcp,
      sample: index + 1,
    });
    expect(measurement.eventTimingSupported).toBe(true);
  }

  const p75 = {
    cls: percentile75(samples.map((sample) => sample.cls)),
    favoriteFeedbackMs: percentile75(samples.map((sample) => sample.favoriteFeedbackMs)),
    interactionDurationMs: percentile75(samples.map((sample) => sample.interactionDurationMs)),
    lcpMs: percentile75(samples.map((sample) => sample.lcpMs)),
  };
  const report = {
    browserVersion: browser.version(),
    collectedAt: new Date().toISOString(),
    platform: process.platform,
    host: { architecture: arch(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
    scenario: "Actual separately started synthetic API; no UI route interception. Cold Search, real typing/submit, Results and persisted favorite DOM feedback through next animation frame.",
    budgets: {
      clsP75: CLS_BUDGET,
      favoriteFeedbackMaxMs: 100,
      interactionDurationP75Ms: INTERACTION_BUDGET_MS,
      lcpP75Ms: LCP_BUDGET_MS,
    },
    caveat: "The interaction value is bounded lab Event Timing evidence from real keyboard/click input; it is not a production INP claim.",
    profile: {
      cpuSlowdownMultiplier: 4,
      downloadBitsPerSecond: 1_600_000,
      latencyMs: 150,
      uploadBitsPerSecond: 750_000,
      viewport: { height: 844, width: 390 },
    },
    p75,
    sampleCount: SAMPLE_COUNT,
    samples,
  };
  await testInfo.attach("demo-mobile-performance-measurements.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });
  if (process.env.AW_SCREENSHOT_DIR) {
    await mkdir(process.env.AW_SCREENSHOT_DIR, { recursive: true });
    await writeFile(path.join(process.env.AW_SCREENSHOT_DIR, "demo-mobile-performance-measurements.json"), JSON.stringify(report, null, 2) + "\n");
  }

  expect(Math.max(...samples.map((sample) => sample.favoriteFeedbackMs)), "Every observed favorite update should commit by the next frame within100ms").toBeLessThanOrEqual(100);
  expect(p75.lcpMs, "LCP p75 should remain within the mobile lab budget").toBeLessThanOrEqual(LCP_BUDGET_MS);
  expect(p75.cls, "CLS p75 should remain within the mobile lab budget").toBeLessThanOrEqual(CLS_BUDGET);
  expect(p75.interactionDurationMs, "Event Timing p75 should remain responsive").toBeLessThanOrEqual(INTERACTION_BUDGET_MS);
});
