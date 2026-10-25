export function buildDemoBaseUrl(pageUrl: unknown): string | undefined {
  if (typeof pageUrl !== "string") return undefined;
  let current: URL;
  try { current = new URL(pageUrl); }
  catch { return undefined; }
  if ((current.protocol !== "http:" && current.protocol !== "https:") || current.username !== "" || current.password !== "" || current.hostname === "") return undefined;
  return new URL("/demo", current.origin).href;
}
