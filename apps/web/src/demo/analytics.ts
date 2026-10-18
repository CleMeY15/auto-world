export type DemoAnalyticsEventName = "search_submitted" | "results_shown" | "detail_opened" | "favorite_added" | "favorite_removed" | "favorite_undone" | "saved_search_added" | "saved_search_restored" | "saved_search_removed" | "saved_search_undone" | "comparison_added" | "comparison_removed" | "comparison_opened" | "storage_failed" | "retry_clicked" | "search_link_created" | "search_link_copied" | "search_link_loaded";
export type DemoAnalyticsScreen = "search" | "results" | "detail" | "saved" | "compare" | "shared";
export type DemoAnalyticsOutcome = "success" | "empty" | "error" | "offline" | "partial" | "stale";
export interface DemoAnalyticsEvent { readonly eventName: DemoAnalyticsEventName; readonly screen: DemoAnalyticsScreen; readonly outcome: DemoAnalyticsOutcome }
export type DemoAnalyticsSink = (event: DemoAnalyticsEvent) => void;
const eventNames = new Set<DemoAnalyticsEventName>(["search_submitted", "results_shown", "detail_opened", "favorite_added", "favorite_removed", "favorite_undone", "saved_search_added", "saved_search_restored", "saved_search_removed", "saved_search_undone", "comparison_added", "comparison_removed", "comparison_opened", "storage_failed", "retry_clicked", "search_link_created", "search_link_copied", "search_link_loaded"]);
const screens = new Set<DemoAnalyticsScreen>(["search", "results", "detail", "saved", "compare", "shared"]);
const outcomes = new Set<DemoAnalyticsOutcome>(["success", "empty", "error", "offline", "partial", "stale"]);

export function parseAnalyticsEvent(input: unknown): DemoAnalyticsEvent | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).sort().join() !== "eventName,outcome,screen") return undefined;
    const value = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => {
      if (!("value" in descriptor) || descriptor.enumerable !== true) throw new TypeError("invalid analytics descriptor");
      return [key, descriptor.value];
    })) as Record<string, unknown>;
    if (!eventNames.has(value.eventName as DemoAnalyticsEventName) || !screens.has(value.screen as DemoAnalyticsScreen) || !outcomes.has(value.outcome as DemoAnalyticsOutcome)) return undefined;
    return Object.freeze({ eventName: value.eventName as DemoAnalyticsEventName, screen: value.screen as DemoAnalyticsScreen, outcome: value.outcome as DemoAnalyticsOutcome });
  } catch { return undefined; }
}

export function recordAnalyticsEvent(input: unknown, sink: DemoAnalyticsSink = () => {}): boolean {
  const event = parseAnalyticsEvent(input);
  if (event === undefined) return false;
  try { sink(event); } catch { /* analytics is non-authoritative */ }
  return true;
}
