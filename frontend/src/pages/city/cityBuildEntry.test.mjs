import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const result = await build({ entryPoints: [fileURLToPath(new URL("./CityBuildEntry.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
const { CityBuildEntry, CityBuildSetupSteps } = module.exports;
const noop = () => {};
const base = { loading: false, failed: false, onRetry: noop, onBuild: noop };
const district = { id: "support-team-1", name: "Район команды Гаухар", city: "support" };
const ready = { status: "ready", message: null, district };
const render = props => renderToStaticMarkup(React.createElement(CityBuildEntry, { ...base, ...props }));

test("ready operators have a named district, visible text button and a short construction route", () => {
  const html = render({ mine: ready });
  assert.match(html, /<h2[^>]*>Застройка района<\/h2>/);
  assert.match(html, /Район команды Гаухар/);
  assert.match(html, /Выбери участок → выбери здание → построй/);
  assert.match(html, /<button[^>]+class="city-action city-build-entry__button">Строить в районе<\/button>/);
  assert.doesNotMatch(html, /disabled|city-hud__wide|Как открыть стройку|Проверяем/);
});

test("closed districts keep the entry button with an explicit purchasing restriction", () => {
  const html = render({ mine: { ...ready, status: "closed", message: "Стройка закрыта руководителем." } });
  assert.match(html, /Стройка закрыта руководителем\. Можно посмотреть участки/);
  assert.match(html, />Строить в районе<\/button>/);
  assert.doesNotMatch(html, /disabled|Как открыть стройку/);
});

test("operators without a group or supervisor district see their server reason and assignment help", () => {
  for (const message of ["Сначала руководитель должен добавить тебя в группу супервайзера.", "Руководитель ещё не назначил район супервайзеру твоей группы."]) {
    const html = render({ mine: { status: "no_team", message, district: null } });
    assert.ok(html.includes(message));
    assert.match(html, /Застройка района/);
    assert.match(html, />Как открыть стройку<\/button>/);
    assert.doesNotMatch(html, />Строить в районе<\/button>|disabled|href=/);
  }
});

test("unprepared land explains the problem without offering a purchase entry", () => {
  const html = render({ mine: { status: "no_land", message: "У района пока нет земли.", district } });
  assert.match(html, /Район команды Гаухар/);
  assert.match(html, /У района пока нет земли/);
  assert.match(html, />Как открыть стройку<\/button>/);
  assert.doesNotMatch(html, />Строить в районе<\/button>/);
  const fallback = render({ mine: { status: "no_land", message: null, district: null } });
  assert.match(fallback, /Для команды пока не назначен район с участками/);
});

test("first load and missing data keep a visible disabled entry instead of disappearing", () => {
  for (const props of [{ loading: true }, {}, { loading: true, mine: ready }]) {
    const html = render(props);
    assert.match(html, /Застройка района/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Проверяем твой район/);
    assert.match(html, /<button[^>]+disabled="">Загружаем стройку…<\/button>/);
    assert.doesNotMatch(html, /Как открыть стройку|Повторить загрузку|>Строить в районе<\/button>/);
  }
});

test("request failures show retry and never substitute permission or assignment errors", () => {
  for (const props of [{ failed: true }, { failed: true, mine: ready }, { failed: true, loading: true }]) {
    const html = render(props);
    assert.match(html, /role="alert">Не удалось проверить доступ к стройке/);
    assert.match(html, />Повторить загрузку<\/button>/);
    assert.doesNotMatch(html, /Проверяем твой район|Как открыть стройку|>Строить в районе<\/button>|disabled/);
  }
});

test("a district is required before offering the entry, even with inconsistent ready data", () => {
  const html = render({ mine: { ...ready, district: null } });
  assert.match(html, />Как открыть стройку<\/button>/);
  assert.doesNotMatch(html, />Строить в районе<\/button>/);
});

test("assignment help gives the responsible role and concrete setup steps, with no operator admin link", () => {
  const html = renderToStaticMarkup(React.createElement(CityBuildSetupSteps));
  assert.match(html, /Попроси руководителя или администратора/);
  assert.match(html, /Добавить тебя в активную группу супервайзера/);
  assert.match(html, /Города и районы.*назначить этого супервайзера району своего города/);
  assert.match(html, /Стройка открыта.*сохранить настройки/);
  assert.match(html, /Все свободные участки района команды будут доступны сразу/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /href=|<button|разрешение оператору/);
});
