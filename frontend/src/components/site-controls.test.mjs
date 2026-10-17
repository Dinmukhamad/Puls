import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const { AVATAR_OUTPUT, ZOOM_MAX, displayed, clampFrame, drawRect } = await load("./avatarCrop.ts");
const { monthOptions } = await load("./dateRange.ts");
const { DatePicker, DateTimePicker, HALF_HOURS } = await load("./DateRangePicker.tsx");
const { FileDrop } = await load("./FileDrop.tsx");
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const src = fileURLToPath(new URL("..", import.meta.url));
const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });

test("a photo always covers the avatar's circle and the saved square is what the circle showed", () => {
  const landscape = { width: 4000, height: 2000, zoom: 1, x: 0, y: 0 };
  assert.deepEqual(displayed(landscape, 240), { w: 480, h: 240 });
  // It moves only as far as it is larger than the circle, and zooms between 1 and ZOOM_MAX.
  assert.deepEqual(clampFrame({ ...landscape, x: 500, y: 40 }, 240), { ...landscape, x: 120, y: 0 });
  assert.equal(clampFrame({ ...landscape, zoom: 9 }, 240).zoom, ZOOM_MAX);
  assert.equal(clampFrame({ ...landscape, zoom: .2 }, 240).zoom, 1);
  // Centred: the square is the middle of the photo; moved right by the whole margin: its left edge.
  assert.deepEqual(drawRect(landscape, 240), { x: -AVATAR_OUTPUT / 2, y: 0, w: AVATAR_OUTPUT * 2, h: AVATAR_OUTPUT });
  assert.deepEqual(drawRect({ ...landscape, x: 120 }, 240), { x: 0, y: 0, w: AVATAR_OUTPUT * 2, h: AVATAR_OUTPUT });
  assert.equal(AVATAR_OUTPUT, 512);
});

test("the photo editor takes any photo, frames it and sends only the small square", () => {
  const editor = read("./AvatarEditor.tsx");
  assert.match(editor, /type="file" accept="image\/\*"/);
  assert.match(editor, /if \(!file\.size \|\| file\.size > MAX_SOURCE_BYTES\)/);
  assert.match(editor, /return avatars\.save\(staff \? userId : null, await framed\(picked, frame\)\);/);
  assert.match(editor, /let blob = await encode\("image\/webp", \.9\);\n  if \(!blob \|\| blob\.type !== "image\/webp"\) blob = await encode\("image\/jpeg", \.92\);/);
  // Drop on the circle, tap the empty circle, drag and zoom the photo.
  for (const handler of ["onDrop={onDrop}", "onPointerDown={onPointerDown}", "onClick={() => input.current?.click()}", 'type="range" min={1} max={ZOOM_MAX}']) assert.ok(editor.includes(handler), handler);
  const profile = read("../pages/ProfilePage.tsx");
  assert.match(profile, /<button type="button" className="profile-identity__photo" aria-label="Изменить фото профиля" onClick=\{\(\) => open\("avatar"\)\}>/);
});

test("the account's avatar stands in the sidebar's icon column", () => {
  assert.match(read("../styles/app.css"), /\.sidebar__user \{\n  display: flex;\n  align-items: center;\n  gap: var\(--sp-3\);\n  padding: var\(--sp-2\) var\(--sp-2\) var\(--sp-2\) 2px;/);
});

test("one date in the site's calendar: the field shows it, an optional one can be cleared", () => {
  const html = value => renderToStaticMarkup(React.createElement(DatePicker, { value, onChange: () => {}, placeholder: "Не указана", clearable: true, ariaLabel: "Дата приёма" }));
  assert.match(html("2026-10-08"), /<div class="date-range-picker date-picker">/);
  assert.match(html("2026-10-08"), /<span>08\.10\.2026<\/span>/);
  assert.match(html(""), /<span>Не указана<\/span>/);
  assert.match(html(""), /aria-label="Дата приёма: Не указана\. Открыть календарь"/);
  const picker = read("./DateRangePicker.tsx");
  assert.match(picker, /if \(single\) \{ onChange\(\{ date_from: key, date_to: key \}\); close\(true\); return; \}/);
  assert.match(picker, /\{onClear && validDateRange\(effective\) \? <Button onClick=\{\(\) => \{ onClear\(\); close\(true\); \}\}>Очистить<\/Button> : <Button onClick=\{\(\) => pickDate\(today\)\}>Сегодня<\/Button>\}/);
  // Date and time: the calendar and the half hours.
  assert.equal(HALF_HOURS.length, 48);
  assert.deepEqual([HALF_HOURS[0], HALF_HOURS[1], HALF_HOURS.at(-1)], ["00:00", "00:30", "23:30"]);
  const both = renderToStaticMarkup(React.createElement(DateTimePicker, { value: "2026-10-20T18:00", onChange: () => {}, ariaLabel: "Срок" }));
  assert.match(both, /<div class="date-time-picker">/);
  assert.match(both, /<span>20\.10\.2026<\/span>/);
  assert.match(both, /18:00/);
});

test("months are a list of the site, newest first", () => {
  assert.deepEqual(monthOptions("2026-10-17", 2, 1), [
    { value: "2026-11", label: "Ноябрь 2026" }, { value: "2026-10", label: "Октябрь 2026" },
    { value: "2026-09", label: "Сентябрь 2026" }, { value: "2026-08", label: "Август 2026" },
  ]);
  assert.equal(monthOptions("2026-01-05", 1, 0)[1].value, "2025-12");
});

test("files are dropped or chosen with the site's button, and their names are listed", () => {
  const html = renderToStaticMarkup(React.createElement(FileDrop, { accept: ".xlsx", multiple: true, title: "Перетащите файлы", hint: "XLSX", files: [{ name: "report_10.xlsx", size: 1 }], onFiles: () => {} }));
  assert.match(html, /<input id="[^"]+" class="file-drop__input" type="file" accept="\.xlsx" multiple=""/);
  assert.match(html, /class="btn btn--secondary btn--m file-drop__button">Выбрать файлы<\/label>/);
  assert.match(html, /<ul class="file-drop__files" aria-label="Выбранные файлы"><li>report_10\.xlsx<\/li><\/ul>/);
  assert.match(read("../pages/ReportsUpload.tsx"), /options=\{\[\{ value: "", label: "Из названий файлов" \}, \.\.\.monthOptions\(\)\]\}/);
  assert.match(read("../pages/PeriodsPage.tsx"), /<DatePicker ariaLabel="Любой день недели" value=\{date\} onChange=\{setDate\}/);
});

test("the site's own pages use the site's controls, not the browser's", () => {
  // Training copies of other systems keep their originals' look: CRM, the dispatch, the driver's app and its simulator.
  const copies = /^(pages\/(crm|dispatch|scenarios)\/|pages\/Driver(Workspace|WorkViews|NavigationOrders)\.tsx$|pages\/SimulatorPage\.tsx$)/;
  const offenders = walk(src).filter(path => path.endsWith(".tsx")).map(path => [relative(src, path).replaceAll("\\", "/"), readFileSync(path, "utf8")])
    .filter(([path]) => !copies.test(path) && path !== "components/Select.tsx")
    .flatMap(([path, text]) => [...text.matchAll(/<select\b|type="(date|month|datetime-local|time|week)"|<input\b[^>]*type="file"[^>]*>/g)]
      // The site's own pickers hide the browser's file field behind their button.
      .filter(m => !/className="(avatar-editor__input|file-drop__input)"/.test(m[0])).map(m => `${path}: ${m[0].slice(0, 60)}`));
  assert.deepEqual(offenders, []);
});

test("the trainer's home is titled as its tab and shows the simulator's numbers and the trainer's places", () => {
  const page = read("../pages/TrainingTools.tsx"), nav = read("../navigation.ts");
  assert.match(nav, /section\("home", "Главная", HomeIcon, \[tab\("\/trainer", "Учебная сводка"\)\]\)/);
  assert.match(page, /<h1 className="page-title">Учебная сводка<\/h1>/);
  assert.match(page, /queryFn: \(\{ signal \}\) => getDriverAnalytics\(new URLSearchParams\(\), signal\)/);
  for (const label of ["Операторов", "Выполнили цель", "Смены в процессе", "Нужен разбор"]) assert.match(page, new RegExp(`<KPI label="${label}"`), label);
  const places = [...page.matchAll(/\{ title: "([^"]+)", text: "[^"]+", to: "([^"]+)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(places, [["Операторы", "/admin/users"], ["Сценарии Driver Simulator", "/admin/learning?kind=simulator"], ["Тестовый запуск", "/training/city?district=driver"], ["Миссии города", "/admin/learning/city"], ["Аналитика симулятора", "/admin/learning-analytics"]]);
  assert.doesNotMatch(page, /training-home-links/);
});
