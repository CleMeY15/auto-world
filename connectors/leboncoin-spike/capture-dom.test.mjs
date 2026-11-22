import assert from "node:assert/strict";
import { test } from "node:test";
import { readVisibleLeboncoinDom } from "./capture-dom.mjs";

test("DOM projection excludes hidden variants and criteria outside main", () => {
  const seen = [];
  const node = (props, visible = true) => ({
    ...props,
    checkVisibility(options) {
      assert.deepEqual(options, { checkOpacity: true, checkVisibilityCSS: true });
      return visible;
    },
  });
  const criteria = (value, visible = true, valueVisible = true) => node({
    getAttribute: () => "criteria_item_mileage",
    children: [node({ innerText: "Kilométrage" }), node({ innerText: value }, valueVisible)],
  }, visible);
  const elements = new Map([
    ['main h1[data-qa-id="adview_title"]', [node({ innerText: "Visible vehicle" }), node({ innerText: "Hidden stale vehicle" }, false)]],
    ['section[data-qa-id="adview_spotlight_description_container"] [data-qa-id="adview_price"]',
      [node({ innerText: "12 000 €" }), node({ innerText: "9 000 €" }, false)]],
    ['main [data-qa-id^="criteria_item_"]', [criteria("23000 km"), criteria("999 km", false), criteria("888 km", true, false)]],
    ['[data-qa-id^="criteria_item_"]', [criteria("999999 km")]],
    ["main img", [
      node({ alt: "Visible vehicle (image 1)", currentSrc: "https://img.leboncoin.fr/observed.jpg" }),
      node({ alt: "Visible vehicle (image 2)", src: "https://img.leboncoin.fr/hidden.jpg" }, false),
    ]],
    ["main time", []],
    ['section[data-qa-id="adview_spotlight_description_container"] a[href$="#map"]', []],
  ]);
  const previous = globalThis.document;
  try {
    globalThis.document = { querySelectorAll(selector) {
      seen.push(selector);
      assert.equal(elements.has(selector), true, `unexpected selector ${selector}`);
      return elements.get(selector);
    } };
    const snapshot = readVisibleLeboncoinDom();
    assert.deepEqual(snapshot.titles, ["Visible vehicle"]);
    assert.deepEqual(snapshot.prices, ["12 000 €"]);
    assert.deepEqual(snapshot.criteria, [{ key: "mileage", label: "Kilométrage", value: "23000 km" }]);
    assert.equal(snapshot.photos.length, 1);
    assert.equal(snapshot.photos[0].url, "https://img.leboncoin.fr/observed.jpg");
    assert.equal(seen.includes('[data-qa-id^="criteria_item_"]'), false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
