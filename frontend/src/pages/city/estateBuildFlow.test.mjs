import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const built = await build({ entryPoints: [fileURLToPath(new URL("./CityEstateDock.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
const { CityEstateDock } = module.exports;
const noop = () => {};
const catalogue = [{ family: "square", name: "Сквер", icon: "🌳", ready: false, size: [1, 1], squares: null, levels: [{ level: 1, name: "Сквер", about: "Зелёный сквер", price: 20 }] }];
const land = { id: "support-team-1", name: "Район команды", number: 1, mine: true, managed: false, construction: true, land: { plots: 12, taken: 0, open_band: 1, bands: [{ band: 1, plots: 12, taken: 0 }] }, projects: [], objects: [], version: 1 };
const mine = { status: "ready", message: null, district: { id: land.id, name: land.name, city: "support" }, objects: [], catalogue, projects: [], land_prices: [100], economy_revision: 1, balance: 200, available: 200, legacy: { count: 0, paid: 0 }, managed: [] };
const overview = { district: land.id, area: "plots", placing: null, selected: null, plot: null, spot: null, project: false };
function render(patch = {}) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(CityEstateDock, { mine, land, build: overview, setBuild: noop, onClose: noop, onFocus: noop, onChooseFree: noop, ...patch })));
  client.clear();
  return html;
}

test("ready overview gives a visible first step and a large action to select actual free land", () => {
  const html = render();
  assert.match(html, /<h2 class="estate-step-title">1\. Выбери участок на карте<\/h2>/);
  assert.match(html, /<button type="button" class="city-action estate-choose-free">Выбрать свободный участок<\/button>/);
  const steps = html.match(/<ol class="estate-steps">(.*?)<\/ol>/s)?.[1];
  assert.equal((steps?.match(/<li>/g) ?? []).length, 3);
});

test("closed construction cannot select a purchase plot, and full land explains the next available action", () => {
  const closed = render({ mine: { ...mine, status: "closed", message: "Стройка в районе пока закрыта." } });
  assert.doesNotMatch(closed, /estate-choose-free/);
  assert.match(closed, /Стройка в районе пока закрыта/);
  const full = render({ land: { ...land, land: { ...land.land, taken: 12 } }, onChooseFree: undefined });
  assert.doesNotMatch(full, /estate-choose-free/);
  assert.match(full, /Все участки района заняты\. Открой свою постройку/);
});

test("selected purchase plot advances to choosing a building and keeps the full land plus building price", () => {
  const html = render({ build: { ...overview, plot: { block: 1, col: 0, row: 0, band: 1, problem: null } } });
  assert.match(html, /<h2>Свободный участок<\/h2>/);
  assert.match(html, /<h3 class="estate-step-title">2\. Выбери здание<\/h3>/);
  assert.match(html, /Можно выбрать другой участок на карте/);
  assert.match(html, /aria-label="Сквер на участке за 120 коинов">Купить · ◈ 120<\/button>/);
  assert.match(html, /3\. Нажми «Купить» у выбранного здания/);
  assert.doesNotMatch(html, /estate-choose-free/);
});

test("automatic purchase selection does not appear during inventory placement, project placement, or an owned building card", () => {
  const own = { id: 5, family: "square", level: 1, state: "placed", owner: "mine", district_id: land.id, source: "purchase", paid: 120, version: 1, squares: 1, module: 1, u: 0, v: 0, w: 1, h: 1, rotation: 0 };
  const inventory = render({ mine: { ...mine, objects: [{ ...own, state: "stored" }] }, build: { ...overview, placing: { family: "square", rotation: 0, moving: own.id } } });
  const owned = render({ mine: { ...mine, objects: [own] }, build: { ...overview, selected: own.id } });
  const project = render({ build: { ...overview, area: "public", project: true } });
  for (const html of [inventory, owned, project]) assert.doesNotMatch(html, /estate-choose-free/);
  assert.match(inventory, /бесплатно, вместе с землёй/);
  assert.match(owned, /твоя постройка/);
});

test("transfer to another ready district disables purchases and automatic selection in the previous dock", () => {
  const transferred = { ...mine, district: { id: "sales-team-2", name: "Новый район", city: "sales" } };
  const oldOverview = render({ mine: transferred });
  assert.doesNotMatch(oldOverview, /estate-choose-free/);
  const oldPlot = render({ mine: transferred, build: { ...overview, plot: { block: 1, col: 0, row: 0, band: 1, problem: null } } });
  const buy = oldPlot.match(/<button[^>]*aria-label="Сквер на участке за 120 коинов"[^>]*>/)?.[0];
  assert.ok(buy, "selected plot still displays its price while the previous dock is being closed");
  assert.match(buy, /disabled=""/);
});
