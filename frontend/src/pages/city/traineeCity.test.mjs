import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const { CitySkillsPanel } = await load("./CitySkillsPanel.tsx");
const { districtLabels } = await load("./cityDistricts.ts");
const { ofMissions } = await load("./citySkills.ts");
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const district = (id, name, extra = {}) => ({ id, name, subtitle: "", soon: false, ...extra });
const mission = (key, where, state, extra = {}) => ({ key, district: where, state, enabled: true, title: key, description: `О миссии ${key}`, objective: "Сделай это", pulsar: "Подсказка", current: 0, target: 1, prerequisite: null, xp: 0, coins: 0, path: `/go/${key}`, ...extra });
const data = { districts: [district("academy", "Академия"), district("driver", "Driver Simulator"), district("scenarios", "Сценарии ТП")],
  missions: [mission("welcome", "academy", "completed"), mission("driver_profile", "driver", "available"), mission("scenario_business_park", "scenarios", "available")], inspecting: false };
const actions = { action: () => React.createElement("button", { className: "city-action" }, "Перейти к заданию →"), opensTool: () => true, tool: () => null, guide: () => null, fine: () => "Миссия засчитается сама" };
const panel = props => renderToStaticMarkup(React.createElement(CitySkillsPanel, { data, labels: districtLabels(data.districts, data.missions), district: null, missionKey: null, completed: 1, total: 3, onDistrict: () => {}, onMission: () => {}, error: null, ...actions, ...props }));

test("missions are counted in Russian: «0 из 1 миссии», «1 из 3 миссий», «2 из 21 миссии»", () => {
  assert.deepEqual([[0, 1], [1, 3], [5, 5], [2, 21]].map(([d, t]) => ofMissions(d, t)), ["0 из 1 миссии", "1 из 3 миссий", "5 из 5 миссий", "2 из 21 миссии"]);
  assert.equal(districtLabels([district("scenarios", "Сценарии ТП")], [mission("s", "scenarios", "available")])[0].status, "0 из 1 миссии");
});

test("a trainee's «Навыки» speak of districts and missions, never of coins or XP", () => {
  const trainee = panel({ rewards: false });
  assert.match(trainee, /<span class="skills-count">1 из 3 миссий<\/span>/);
  assert.match(trainee, /Пройденные миссии растят здание района, а твой прогресс видит наставник\./);
  assert.doesNotMatch(trainee, /коин|XP|наград/i);
  const scenarios = panel({ rewards: false, district: data.districts[2], missionKey: "scenario_business_park" });
  assert.match(scenarios, /Учебные разговоры с водителем и практика в CRM и Диспетчерской\.<\/p>/);
  assert.doesNotMatch(scenarios, /коин|skills-rewards/i);
  // Operators keep their rewards.
  assert.match(panel({}), /Пройденные миссии дают опыт и коины/);
  const paid = panel({ data: { ...data, missions: data.missions.map(m => ({ ...m, xp: 40, coins: 50 })) }, district: data.districts[1], missionKey: "driver_profile" });
  assert.match(paid, /<div class="skills-rewards"><span>✦ 40 XP<\/span><span>◈ 50 коинов<\/span><small>за прохождение<\/small><\/div>/);
});

test("a trainee's «Обучение» is the learning city, full screen, asking only for what a trainee may read", () => {
  const app = read("../../App.tsx"), layout = read("../../components/AppLayout.tsx"), city = read("./TraineeCity.tsx"), map = read("./CityMap.tsx");
  assert.match(app, /<Route path="\/training\/city" element=\{user\.role === "trainee" \? <Suspense fallback=\{<div className="city-immersive city-immersive--empty" \/>\}><TraineeCity \/><\/Suspense> : <CityRoute \/>\} \/>/);
  assert.match(layout, /const immersive = location\.pathname === "\/training\/city";/);
  // Its own progress (the trainee route) and nothing of the team's land, the world's settings, seasons or the wallet.
  assert.match(city, /useTraineeLearning\(\)/);
  assert.doesNotMatch(city, /cityWorld|cityEstate|citySeasons|levelsSeen|progressKey|onLevelsSeen|city\.claim|CityEstateDock|CityTasks|CityWorldPanel|balance/);
  assert.match(city, /<CityMap key=\{mapAttempt\} learningOnly /);
  // The toolbar: progress, «Навыки» without rewards, and the map's tools.
  assert.deepEqual([...city.matchAll(/toolbarSlot="(\w+)"/g)].map(m => m[1]), ["level", "skills"]);
  assert.match(city, /compactLabel="Прогресс" icon=\{`\$\{summary\.percent\}%`\}/);
  assert.match(city, /rewards=\{false\}/);
  // The map's own tools and hint work full screen as for the operators.
  assert.match(map, /\{live && <span className="city-map-hint"/);
  assert.match(map, /\{!failed && <CityPeekPanel label="Управление картой"/);
  assert.doesNotMatch(map, /zoom\(1\.5\)/);
});

test("the trainee's cabinet names the districts as the city does and opens them there", () => {
  const page = read("../TraineePage.tsx"), nav = read("../../navigation.ts");
  assert.match(page, /<strong>\{district\.name\}<\/strong>/);
  assert.match(page, /DISTRICT_ICONS\[district\.id\]/);
  assert.match(page, /const inCity = \(district: DistrictId, mission\?: string\) => `\/training\/city\?district=\$\{district\}\$\{mission \? `&mission=\$\{mission\}` : ""\}`;/);
  assert.match(page, /<Link className="btn btn--plain btn--m" to=\{inCity\(current\.district, current\.key\)\}>Показать в городе<\/Link>/);
  assert.match(page, /title="Учебный город"/);
  assert.doesNotMatch(page, /CityMap|Показать карту|NAMES\[/);
  assert.match(nav, /section\("training", "Обучение", SparkIcon, \[tab\("\/training\/city", "Учебный город"\), tab\("\/training\/voice", "Голосовой тренажёр"\)\]\)/);
});
