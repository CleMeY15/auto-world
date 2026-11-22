/* global document */
/**
 * Source-specific public DOM projection, established on three real detail pages.
 * Execute with page.evaluate(readVisibleLeboncoinDom) after visible criteria expansion.
 * No embedded state, cookies, scripts, seller contacts or network access.
 * The caller supplies requested/final URL, time and actual acquisition method.
 */
export function readVisibleLeboncoinDom() {
  // Rendering visibility, not intersection with the current viewport. Chromium
  // supports checkVisibility; opacity/visibility-hidden ancestors are excluded.
  const visible = (element) => element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const rendered = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible);
  return {
    schema_version: "leboncoin-dom-observation/v1",
    titles: rendered('main h1[data-qa-id="adview_title"]')
      .map((element) => element.innerText),
    prices: rendered(
      'section[data-qa-id="adview_spotlight_description_container"] [data-qa-id="adview_price"]',
    ).map((element) => element.innerText),
    criteria: rendered('main [data-qa-id^="criteria_item_"]')
      .flatMap((element) => {
        const [label, value] = element.children;
        if (!visible(label) || !visible(value)) return [];
        return [{
          key: element.getAttribute("data-qa-id").replace("criteria_item_", ""),
          label: label.innerText,
          value: value.innerText,
        }];
      }),
    photos: rendered("main img")
      .filter((element) => (element.alt || "").includes("(image "))
      .map((element) => ({ alt: element.alt, url: element.currentSrc || element.src })),
    times: rendered("main time")
      .map((element) => ({ text: element.innerText, datetime: element.getAttribute("datetime") })),
    location: rendered(
      'section[data-qa-id="adview_spotlight_description_container"] a[href$="#map"]',
    ).map((element) => element.innerText),
  };
}
