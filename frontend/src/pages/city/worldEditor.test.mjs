import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const requests = [];
let response;
const apiFixture = { request: async (path, options) => { requests.push({ path, ...options }); return response; } };
async function load(path, fixture = false) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
    plugins: fixture ? [{ name: "client-fixture", setup(plugin) { plugin.onResolve({ filter: /^\.\/client$/ }, () => ({ path: "fixture:client", external: true })); } }] : [],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(id => id === "fixture:client" ? apiFixture : require(id), module, module.exports);
  return module.exports;
}
const { cityWorld, worldSavePayload } = await load("../../api/cityWorld.ts", true);
const { canEditWorldCity, changeWorldCity, hasRevokedWorldChanges, refreshWorldDraft, supervisorAssignment, worldDraftState, WORLD_QUERY_KEYS } = await load("./worldEditor.ts");
const { WorldSettingsEditor } = await load("./CityWorldEditor.tsx");
const supervisor = (id, name, group_ids = [], group_names = [], operator_count = 0) => ({ id, name, group_ids, group_names, operator_count });
function settings(patch = {}) {
  return {
    revision: 4, can_edit: true, can_manage_heads: true, editable_city_ids: ["support", "sales"],
    heads: [{ id: 10, name: "Руководитель ТП" }, { id: 11, name: "Руководитель ОП" }],
    supervisors: [supervisor(20, "Анна", [1, 2], ["Смена А", "Смена Б"], 7), supervisor(21, "Борис", [3], ["Продажи"], 2), supervisor(22, "Будущая команда")],
    groups: [{ id: 1, name: "Смена А", supervisor_id: 20, supervisor_name: "Анна" }],
    cities: [
      { id: "support", name: "Техподдержка", head_id: 10, districts: [
        { id: "support-team-1", name: "Первый район", supervisor_id: 20, group_ids: [1, 2], construction: true },
        { id: "support-team-2", name: "Второй район", supervisor_id: null, group_ids: [], construction: false },
        { id: "support-team-3", name: "Будущая команда", supervisor_id: 22, group_ids: [], construction: false },
      ] },
      { id: "sales", name: "Отдел продаж", head_id: 11, districts: [{ id: "sales-team-1", name: "Район продаж", supervisor_id: 21, group_ids: [3], construction: false }] },
    ], ...patch,
  };
}
function render(data, isHead = false) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(WorldSettingsEditor, { data, isHead })));
  client.clear();
  return html;
}

// The same request boundary is exercised by the editor's mutation, including server-only metadata.
test("save allowlists editable fields, preserves both cities and consumes full current editor data", async () => {
  const data = settings();
  response = settings({ revision: 5, supervisors: [supervisor(30, "Новая команда")], can_edit: false, editable_city_ids: [] });
  const result = await cityWorld.save(data);
  const request = requests.at(-1);
  assert.equal(request.path, "/api/v1/admin/learning/city/world");
  assert.equal(request.method, "PUT");
  assert.deepEqual(request.json, {
    revision: 4,
    cities: data.cities.map(city => ({ id: city.id, name: city.name, head_id: city.head_id, districts: city.districts.map(district => ({ id: district.id, name: district.name, supervisor_id: district.supervisor_id, construction: district.construction })) })),
  });
  assert.doesNotMatch(JSON.stringify(request.json), /group_ids|can_edit|heads|supervisors|groups/);
  assert.equal(result, response);
  assert.equal(result.can_edit, false);
  assert.equal(result.supervisors[0].id, 30);
  assert.deepEqual(worldSavePayload(data), request.json);
});

test("supervisors occupy one district globally, and clearing the draft permits a swap before saving", () => {
  let state = worldDraftState(settings());
  assert.equal(supervisorAssignment(state.draft, 20, "support-team-1"), null);
  assert.equal(supervisorAssignment(state.draft, 20, "sales-team-1"), "Первый район · Техподдержка");
  assert.equal(supervisorAssignment(state.draft, 21, "support-team-1"), "Район продаж · Отдел продаж");
  state = changeWorldCity(state, "support", city => { city.districts[0].supervisor_id = null; });
  state = changeWorldCity(state, "sales", city => { city.districts[0].supervisor_id = null; });
  assert.equal(supervisorAssignment(state.draft, 20, "sales-team-1"), null);
  assert.equal(supervisorAssignment(state.draft, 21, "support-team-1"), null);
  state = changeWorldCity(state, "support", city => { city.districts[0].supervisor_id = 21; });
  state = changeWorldCity(state, "sales", city => { city.districts[0].supervisor_id = 20; });
  assert.equal(state.draft.cities[0].districts[0].supervisor_id, 21);
  assert.equal(state.draft.cities[1].districts[0].supervisor_id, 20);
  assert.equal(state.draft.revision, 4);
});

test("background refresh retains unfinished names and revision, while latest city rights revoke submission", () => {
  const initial = settings({ can_manage_heads: false, editable_city_ids: ["support"] });
  const pristine = worldDraftState(initial);
  const edited = changeWorldCity(pristine, "support", city => { city.name = "Мой черновик"; city.districts[0].construction = false; });
  const latest = settings({ revision: 5, can_manage_heads: false, editable_city_ids: ["sales"], supervisors: [] });
  assert.equal(refreshWorldDraft(edited, latest), edited);
  assert.equal(edited.draft.cities[0].name, "Мой черновик");
  assert.equal(edited.draft.revision, 4);
  assert.equal(canEditWorldCity(latest, "support"), false);
  assert.equal(canEditWorldCity(latest, "sales"), true);
  assert.equal(hasRevokedWorldChanges(edited, latest), true);
  assert.equal(hasRevokedWorldChanges(pristine, latest), false, "background changes to untouched cities are not draft edits");
  const reloaded = worldDraftState(latest);
  assert.equal(reloaded.draft.revision, 5);
  assert.equal(reloaded.dirty, false);
  assert.equal(reloaded.draft.cities[0].name, "Техподдержка");
  assert.equal(refreshWorldDraft(pristine, latest).draft.revision, 5);
  assert.equal(pristine.draft.cities[0].name, "Техподдержка", "editing never mutates the baseline");
});

test("restoring saved values clears dirty state, and owner changes require admin rights after refresh", () => {
  const initial = settings();
  const pristine = worldDraftState(initial);
  const edited = changeWorldCity(pristine, "support", city => { city.name = "Временное имя"; });
  assert.equal(edited.dirty, true);
  const reverted = changeWorldCity(edited, "support", city => { city.name = "Техподдержка"; });
  assert.equal(reverted.dirty, false);
  const ownerEdited = changeWorldCity(pristine, "support", city => { city.head_id = null; });
  assert.equal(hasRevokedWorldChanges(ownerEdited, initial), false);
  assert.equal(hasRevokedWorldChanges(ownerEdited, settings({ can_manage_heads: false })), true);
  assert.equal(canEditWorldCity(settings({ can_edit: false }), "support"), false);
});

test("editor shows admin owner controls, all supervisor groups and counts, and zero-group teams", () => {
  const html = render(settings());
  assert.equal((html.match(/>Руководитель города</g) ?? []).length, 2);
  assert.equal((html.match(/>Супервайзер района</g) ?? []).length, 4);
  assert.match(html, /Все группы района: Смена А, Смена Б/);
  assert.match(html, /Операторов: <strong>7<\/strong>/);
  assert.match(html, /Групп пока нет\. Когда команда появится/);
  assert.match(html, /<option value="21" disabled="">Борис · уже назначен: Район продаж · Отдел продаж<\/option>/);
  assert.doesNotMatch(html, /Добавить район|Группы района|type="checkbox"[^>]*value="[123]"/);
  assert.match(html, /aria-labelledby="world-city-support"/);
  assert.match(html, /aria-labelledby="world-city-sales"/);
});

test("HEAD edits only the owned city, and unassigned HEAD sees administrator setup guidance", () => {
  const data = settings({ can_manage_heads: false, editable_city_ids: ["support"] });
  const html = render(data, true);
  assert.doesNotMatch(html, />Руководитель города</);
  const support = html.match(/<section[^>]*aria-labelledby="world-city-support"[^>]*>(.*?)<section[^>]*aria-labelledby="world-city-sales"/s)?.[1];
  assert.ok(support);
  assert.doesNotMatch(support, /<fieldset class="city-world-editor__controls" disabled/);
  assert.match(html, /<fieldset class="city-world-editor__controls" disabled="">/);
  const unowned = render(settings({ can_edit: false, can_manage_heads: false, editable_city_ids: [] }), true);
  assert.match(unowned, /Администратор должен назначить вас руководителем города/);
  assert.doesNotMatch(unowned, /type="submit"/);
});

test("inactive selected supervisor remains visible and clearable; district without land cannot open construction", () => {
  const data = settings();
  data.cities[0].districts[0].supervisor_id = 999;
  data.cities[0].districts.push({ id: "support-team-4", name: "Старый резерв", supervisor_id: null, group_ids: [], construction: false });
  const html = render(data);
  assert.match(html, /<option value="999" disabled="" selected="">Супервайзер недоступен/);
  assert.match(html, /у этого района нет подготовленной земли/);
  assert.match(html, /type="checkbox" disabled=""/);
});

test("assignment changes refresh both cities, personal estate, and staff reports", () => {
  for (const key of ["city-world", "city-world-settings", "city-estate", "city-estates", "city-estates-report", "city", "city-groups", "city-participants"]) assert.ok(WORLD_QUERY_KEYS.includes(key), key);
});


test("unresolved legacy groups survive an unrelated edit until explicitly assigned or cleared", async () => {
  const data = settings();
  data.cities[0].districts[0].supervisor_id = null;
  data.cities[0].districts[0].group_ids = [1, 3];
  data.cities[1].districts[0].supervisor_id = null;
  data.cities[1].districts[0].group_ids = [];
  let state = worldDraftState(data);
  state = changeWorldCity(state, "support", city => { city.name = "Новое имя города"; });
  assert.equal("supervisor_id" in state.draft.cities[0].districts[0], false);
  assert.equal(supervisorAssignment(state.draft, 20, "sales-team-1", data), "Первый район · Новое имя города");
  assert.equal(supervisorAssignment(state.draft, 21, "sales-team-1", data), "Первый район · Новое имя города");
  await cityWorld.save(state.draft);
  assert.deepEqual(requests.at(-1).json.cities[0].districts[0], { id: "support-team-1", name: "Первый район", construction: true });
  assert.match(render(data), /Снять прежнее назначение/);
  state = changeWorldCity(state, "support", city => { city.districts[0].supervisor_id = null; });
  assert.equal(supervisorAssignment(state.draft, 20, "sales-team-1", data), null);
  await cityWorld.save(state.draft);
  assert.equal(requests.at(-1).json.cities[0].districts[0].supervisor_id, null);
  state = changeWorldCity(state, "support", city => { city.districts[0].supervisor_id = 20; });
  await cityWorld.save(state.draft);
  assert.equal(requests.at(-1).json.cities[0].districts[0].supervisor_id, 20);
  assert.doesNotMatch(JSON.stringify(requests.at(-1).json), /group_ids/);
});


test("legacy marker preserves unresolved raw assignments even when effective groups are all filtered", async () => {
  const data = settings();
  data.cities[0].districts[1].legacy_assignment = true;
  const state = changeWorldCity(worldDraftState(data), "support", city => { city.districts[1].name = "Сохранённый резерв"; });
  assert.equal("supervisor_id" in state.draft.cities[0].districts[1], false);
  await cityWorld.save(state.draft);
  const district = requests.at(-1).json.cities[0].districts[1];
  assert.deepEqual(district, { id: "support-team-2", name: "Сохранённый резерв", construction: false });
  assert.doesNotMatch(JSON.stringify(district), /legacy_assignment|group_ids/);
  assert.match(render(data), /В районе сохранено прежнее назначение групп/);
  const cleared = changeWorldCity(state, "support", city => { city.districts[1].supervisor_id = null; });
  assert.equal(worldSavePayload(cleared.draft).cities[0].districts[1].supervisor_id, null);
});
