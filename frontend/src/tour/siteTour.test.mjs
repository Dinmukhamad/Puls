import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
const { SITE_TOUR, FINISH } = await load("./siteTour.ts");
const { ROLE_NAVIGATION } = await load("../navigation.ts");
const { Card } = await load("../components/ui.tsx");

const root = fileURLToPath(new URL("..", import.meta.url));
const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const site = walk(root).filter(path => path.endsWith(".tsx")).map(path => readFileSync(path, "utf8")).join("\n");
const selectors = step => [step.target, step.advanceWhen, step.when, step.skipWhen, ...(step.mistakes ?? []).map(m => m.when)].filter(Boolean);
const markers = step => selectors(step).flatMap(selector => [...selector.matchAll(/\[data-tour=([\w-]+)\]/g)].map(m => m[1]));
const operator = ROLE_NAVIGATION.operator;

test("every place Pulsar points at is marked on the real site, not on a copy of it", () => {
  const ids = new Set(SITE_TOUR.flatMap(markers));
  assert.ok(ids.size > 15);
  const layout = read("../components/AppLayout.tsx");
  for (const id of ids) {
    if (id === "nav" || id.startsWith("nav-") || id.startsWith("tab-")) continue;
    assert.match(site, new RegExp(`(?:data-tour|tour)="${id}"`), `${id} is marked on its page`);
  }
  // The menu is marked from the sections themselves: the sidebar, the phone's tab bar and its menu «Ещё».
  assert.equal((layout.match(/data-tour=\{`nav-\$\{item\.id\}`\}/g) ?? []).length, 3);
  assert.equal((layout.match(/data-tour="nav"/g) ?? []).length, 2);
  assert.match(layout, /<button type="button" data-tour="nav-more" data-sections=\{\[\.\.\.overflow\.map\(item => item\.id\), "profile"\]\.join\(" "\)\}/);
  assert.match(layout, /<Link to=\{ACCOUNT_SECTION\.to\} data-tour="nav-profile" className="mobile-account__profile"/);
  assert.match(layout, /data-tour=\{`tab-\$\{item\.to\.split\(\/\[\?#\]\/\)\[0\]\.slice\(1\)\}`\}/);
  for (const id of [...ids].filter(id => id.startsWith("nav-") && id !== "nav-more")) assert.ok(operator.some(item => `nav-${item.id}` === id), `${id} is an operator's section`);
  for (const id of [...ids].filter(id => id.startsWith("tab-"))) assert.ok(operator.some(item => item.tabs.some(tab => tab.to.split("?")[0] === `/${id.slice(4)}`)), `${id} is an operator's tab`);
  // The city's own panels and the build dock are found by what they already carry.
  assert.match(read("../pages/city/CityToolbar.tsx"), /data-city-panel=\{slot\}/);
  assert.match(read("../pages/city/CityBuildEntry.tsx"), /data-tour="build-open" onClick=\{onBuild\}>Строить в районе<\/button>/);
});

test("the tour walks every section of the operator's menu, then building, and ends with the reward", () => {
  const visits = SITE_TOUR.filter(step => step.action === "Нажми" && /^\[data-tour=nav-(?!more)/.test(step.target)).map(step => step.target.match(/nav-([\w-]+)/)[1]);
  assert.deepEqual(visits, ["home", "results", "wheel", "rewards", "profile", "training"]);
  assert.deepEqual([...visits].sort(), operator.map(item => item.id).sort(), "no section is left out");
  // Pressing a section waits until its page opened; nothing is pressed for the operator.
  for (const step of SITE_TOUR.filter(step => step.action)) assert.ok(step.advanceWhen || step.waitClick, `${step.title} waits for the operator`);
  // On a phone «Награды» and «Профиль» are in «Ещё»: opened first, skipped where the section is in view.
  const more = SITE_TOUR.filter(step => step.target === "[data-tour=nav-more]");
  assert.deepEqual(more.map(step => [step.when, step.skipWhen, step.advanceWhen]), [
    ["[data-tour=nav-more][data-sections~=rewards]", "[data-tour=nav-rewards]", ".mobile-menu [data-tour=nav-rewards]"],
    ["[data-tour=nav-more][data-sections~=profile]", "[data-tour=nav-profile]", ".mobile-account [data-tour=nav-profile]"],
  ]);
  // A section the operator has no access to is passed by, and so are the steps on its page.
  // The shell lists the sections there are: it stays in view while the menu «Ещё» closes and the next page loads.
  for (const step of SITE_TOUR.filter(step => /^\[data-tour=nav-(?!more)/.test(step.target) && step.action)) assert.equal(step.when, `.shell[data-sections~=${step.target.match(/nav-([\w-]+)/)[1]}]`);
  assert.match(read("../components/AppLayout.tsx"), /\$\{immersive \? " shell--immersive" : ""\}`\} data-sections=\{items\.map\(\(item\) => item\.id\)\.join\(" "\)\}>/);
  const pages = { "[data-tour=home-race]": 1, "[data-tour=rating-views]": 2, "[data-tour=progress-earn]": 1, "[data-tour=chest]": 1, "[data-tour=shop-wallet]": 2, "[data-tour=profile]": 1 };
  for (const [opened, count] of Object.entries(pages)) assert.equal(SITE_TOUR.filter(step => step.when === opened && !step.target.includes("nav-")).length, count, opened);
  // The home's cards come and go with the week (no moves without one's own metrics, no month in weekly contests): each of
  // its steps applies only while its own card is on screen, so a missing card is passed by instead of waited for.
  const home = SITE_TOUR.filter(step => /home-(race|moves|month|today)/.test(step.target));
  assert.deepEqual(home.map(step => step.target), ["race", "moves", "month", "today"].map(card => `[data-tour=home-${card}]`));
  for (const step of home) assert.equal(step.when, step.target);
  assert.equal(SITE_TOUR.find(step => step.target === "[data-tour=nav-home]").advanceWhen, "[data-tour=home]");
  // Building: what, where (the map is open to taps, a taken place or one's own building is explained), buy without buying.
  const where = SITE_TOUR.find(step => step.target === ".city-frame");
  assert.equal(where.allow, ".city-mount, .city-turn");
  assert.equal(where.advanceWhen, ".estate-dock .estate-where .estate-ok");
  assert.equal(where.mistakes.length, 2);
  const buy = SITE_TOUR.find(step => step.target === ".estate-dock .estate-buybar");
  assert.equal(buy.action, undefined, "Pulsar explains the purchase, he does not ask for it");
  // The tour counts as passed before «Навыки» open, so the reward is there to take; taking it is the last step.
  const finish = SITE_TOUR.map((step, i) => step.slot === FINISH ? i : -1).filter(i => i >= 0);
  assert.equal(finish.length, 2, "reached with the build dock open or without it");
  const last = SITE_TOUR.at(-1);
  assert.ok(finish.every(i => i < SITE_TOUR.length - 1));
  assert.equal(last.waitClick, true);
  assert.equal(last.target, ".skills-next[data-reward] .city-action, .skills-foot .city-action");
});

test("a card can carry the tour's marker", () => {
  assert.match(renderToStaticMarkup(React.createElement(Card, { title: "Кошелёк", tour: "cabinet-wallet" }, "2 835")), /<section class="card card--standard" data-tour="cabinet-wallet">/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Card, { title: "Кошелёк" }, "2 835")), /data-tour/);
});

test("operators start the tour from the Academy's mission; it lives across pages and tells the server once", () => {
  const city = read("../pages/city/CityPage.tsx"), host = read("./SiteTour.tsx"), coach = read("../pages/crm/PulsarCoach.tsx"), layout = read("../components/AppLayout.tsx");
  assert.match(city, /if \(m\.key === "site_tour" && actionable\(m\) && !data\.inspecting\) return <button className="city-action" disabled=\{!siteTour\.available \|\| siteTour\.running\} onClick=\{siteTour\.start\}>\{m\.state === "completed" \? "Пройти экскурсию ещё раз →" : "Начать экскурсию →"\}<\/button>;/);
  // A ready mission is still claimed first; the tour is not a district tool.
  assert.ok(city.indexOf('if (m.state === "ready" && data.can_claim)') < city.indexOf('if (m.key === "site_tour"'));
  assert.match(city, /m\.key !== "site_tour" && !data\.inspecting/);
  assert.match(layout, /return <SiteTourProvider><div className=\{`shell/);
  assert.match(host, /const available = user\?\.role === "operator";/);
  assert.match(host, /if \(step\.slot !== FINISH \|\| told\.current\) return;\n    told\.current = true; finish\.mutate\(\);/);
  assert.match(host, /mutationFn: city\.finishTour, onSuccess: \(\) => client\.invalidateQueries\(\{ queryKey: \["city"\] \}\)/);
  assert.match(host, /const SiteTourCoach = lazy\(\(\) => import\("\.\/SiteTourCoach"\)\);/);
  assert.match(coach, /useEffect\(\(\) => \{ if \(step\) reached\.current\?\.\(step\); \}, \[index\]\);/);
  // A step that does not apply never shows on the way: it is passed by before it is drawn.
  assert.match(coach, /useLayoutEffect\(\(\) => \{\n    if \(!step \|\| last \|\| !\(\(step\.when && !shown\(step\.when\)\) \|\| \(step\.skipWhen && shown\(step\.skipWhen\)\)\)\) return;\n    if \(direction\.current < 0 && back\(\)\) return;\n    forward\(\);\n  \}, \[step, index\]\);/);
  assert.match(read("./siteTour.css"), /\.site-tour \.coach \{ z-index:90; \}/);
});
