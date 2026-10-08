import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Banner,
  BookmarkIcon,
  Button,
  Card,
  Chip,
  Field,
  Skeleton,
} from "../dist/index.js";

test("Button retains its label and native disabled semantics while loading", () => {
  const html = renderToStaticMarkup(createElement(Button, { loading: true }, "Enregistrer"));

  assert.match(html, />Enregistrer<\/button>/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /type="button"/);
});

test("Field connects its required label, hint and error to the input", () => {
  const html = renderToStaticMarkup(createElement(Field, {
    error: "Saisissez une valeur valide",
    hint: "Marque ou modèle",
    id: "query",
    label: "Rechercher",
    name: "query",
  }));

  assert.match(html, /<label[^>]*for="query"[^>]*>Rechercher<\/label>/);
  assert.match(html, /id="query"/);
  assert.match(html, /aria-describedby="query-hint query-error"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /id="query-hint"/);
  assert.match(html, /id="query-error"/);
});

test("Chip is a native toggle button with an explicit pressed state", () => {
  const html = renderToStaticMarkup(createElement(Chip, { pressed: true }, "Électrique"));

  assert.match(html, /^<button/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /type="button"/);
});

test("non-interactive primitives preserve semantic attributes", () => {
  const card = renderToStaticMarkup(createElement(Card, { "aria-label": "Annonce" }, "Contenu"));
  const banner = renderToStaticMarkup(createElement(Banner, { tone: "danger" }, "Indisponible"));
  const skeleton = renderToStaticMarkup(createElement(Skeleton, { style: { height: 80 } }));

  assert.match(card, /aria-label="Annonce"/);
  assert.match(banner, /role="alert"/);
  assert.match(skeleton, /aria-hidden="true"/);
  assert.doesNotMatch(skeleton, />[^<]+<\/span>/);
});

test("icons are consistently decorative and cannot receive focus", () => {
  const html = renderToStaticMarkup(createElement(BookmarkIcon));

  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /focusable="false"/);
  assert.match(html, /viewBox="0 0 24 24"/);
});
