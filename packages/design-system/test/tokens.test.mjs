import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { tokens } from "../dist/tokens.js";

function relativeLuminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ["light", "dark"]) {
  test(`${theme} theme text and semantic pairs meet WCAG AA contrast`, () => {
    const colors = tokens.color[theme];
    const normalTextPairs = [
      ["text/canvas", colors.text, colors.canvas],
      ["text/surface", colors.text, colors.surface],
      ["muted/surface", colors.textMuted, colors.surface],
      ["action", colors.onAction, colors.action],
      ["success", colors.onSuccess, colors.success],
      ["warning", colors.onWarning, colors.warning],
      ["danger", colors.onDanger, colors.danger],
    ];

    for (const [name, foreground, background] of normalTextPairs) {
      assert.ok(contrast(foreground, background) >= 4.5, `${name} is below 4.5:1`);
    }
    assert.ok(contrast(colors.focus, colors.canvas) >= 3, "focus/canvas is below 3:1");
    assert.ok(contrast(colors.focus, colors.surface) >= 3, "focus/surface is below 3:1");
    assert.ok(contrast(colors.controlBorder, colors.canvas) >= 3, "control border/canvas is below 3:1");
    assert.ok(contrast(colors.controlBorder, colors.surface) >= 3, "control border/surface is below 3:1");
  });
}

test("generated CSS exposes scoped classes, themes and reduced-motion behavior", async () => {
  const css = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");

  for (const className of ["aw-button", "aw-field", "aw-chip", "aw-card", "aw-banner", "aw-skeleton", "aw-icon"]) {
    assert.match(css, new RegExp(`\\.${className}(?:[\\s:{.-])`));
  }
  assert.match(css, /\[data-aw-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /min-height: var\(--aw-size-touch\)/);
  assert.match(css, /--aw-layout-content-max:/);
  assert.match(css, /--aw-motion-skeleton: 1400ms/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});
