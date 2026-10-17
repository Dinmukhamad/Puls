import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const require = createRequire(import.meta.url);
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const { teamTitles, teamOf, groupsWorthShowing, staffCount, operatorCount } = await load("./teamSection.ts");
const { ROLE_NAVIGATION } = await load("../navigation.ts");
const { TeamPersonRow } = await load("./UsersPage.tsx");
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const dana = { id: 7, full_name: "Дана Ахметова", login: "sv-dana", is_active: true };
const group = (id, name, extra = {}) => ({ id, code: `G${id}`, name, is_active: true, supervisor: dana, member_count: 0, operator_count: 0, ...extra });
const person = (id, extra = {}) => ({ id, login: `op${id}`, full_name: `Оператор ${id}`, phone: null, email: null, role: "operator", is_active: true, is_developer: false, hired_on: null, group: null, ...extra });
const brief = g => ({ id: g.id, code: g.code, name: g.name });

test("every page of «Команда» is titled as its tab in the menu", () => {
  for (const role of ["admin", "head", "supervisor"]) {
    const tabs = ROLE_NAVIGATION[role].find(item => item.id === "team").tabs.map(tab => tab.label);
    const titles = teamTitles(role);
    assert.deepEqual(tabs, [titles.users, titles.groups, titles.metrics], role);
  }
  assert.match(read("./UsersPage.tsx"), /<h1 className="page-title">\{titles\.users\}<\/h1>/);
  assert.equal(read("./GroupsPage.tsx").match(/<h1 className="page-title">\{titles\.groups\}<\/h1>/g).length, 2);
  assert.match(read("./AdminOperatorsPage.tsx"), /<h1 className="page-title">\{teamTitles\(\)\.metrics\}<\/h1>/);
  assert.match(read("./UserDetailPage.tsx"), /to="\/admin\/users">← \{teamTitles\(actor\?\.role\)\.users\}<\/Link>/);
});

test("people and operators are counted in Russian", () => {
  assert.deepEqual([1, 2, 5, 21, 29].map(staffCount), ["1 сотрудник", "2 сотрудника", "5 сотрудников", "21 сотрудник", "29 сотрудников"]);
  assert.deepEqual([0, 1, 4, 11].map(operatorCount), ["0 операторов", "1 оператор", "4 оператора", "11 операторов"]);
});

test("a person's team is named by its supervisor, without repeating it or warning a supervisor about other teams", () => {
  const own = group(1, "Дана Ахметова"), legacy = group(2, "Группа GCHK"), old = group(3, "Дана Ахметова", { is_active: false });
  const groups = [own, legacy, old], teams = [{ supervisor: dana, group_id: 1, groups: [own], operator_count: 1 }];
  assert.equal(teamOf(person(1, { group: brief(own) }), groups, teams, "admin"), "Дана Ахметова");
  assert.equal(teamOf(person(1, { group: brief(old) }), groups, teams, "admin"), "Дана Ахметова · команда в архиве");
  assert.equal(teamOf(person(1, { group: brief(legacy) }), groups, teams, "admin"), "Дана Ахметова · Группа GCHK");
  assert.equal(teamOf(person(1), groups, teams, "admin"), "Без команды");
  assert.equal(teamOf(person(7, { role: "supervisor" }), groups, teams, "admin"), "Своя команда · 1 оператор");
  // A supervisor sees only their own groups: another team is named as it is, an admin is told something is wrong.
  const other = { id: 9, code: "T9", name: "Марат Исмаилов" };
  assert.equal(teamOf(person(1, { group: other }), [own], teams, "supervisor"), "Марат Исмаилов");
  assert.equal(teamOf(person(1, { group: other }), [own], teams, "admin"), "Марат Исмаилов · Супервайзер неизвестен");
  for (const page of ["./UsersPage.tsx", "./UserDetailPage.tsx"]) assert.match(read(page), /teamOf\(/, page);
});

test("a supervisor's groups are listed only when they tell something", () => {
  const team = (...groups) => ({ supervisor: dana, group_id: null, groups, operator_count: 0 });
  assert.deepEqual(groupsWorthShowing(team(group(1, "Дана Ахметова"))), []);
  assert.deepEqual(groupsWorthShowing(team()), []);
  assert.equal(groupsWorthShowing(team(group(1, "Группа GCHK"))).length, 1);
  assert.equal(groupsWorthShowing(team(group(1, "Дана Ахметова", { is_active: false }))).length, 1);
  assert.equal(groupsWorthShowing(team(group(1, "Дана Ахметова"), group(2, "Вечерняя смена"))).length, 2);
});

test("a person is one row: the name opens the card, the role and team beside it, the actions above the link", () => {
  const row = props => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement("ul", null, React.createElement(TeamPersonRow, props))));
  const active = row({ person: person(5, { full_name: "Асель Омарова", hired_on: "2025-08-06" }), team: "Дана Ахметова", actions: React.createElement("button", null, "Изменить") });
  assert.match(active, /<li class="team-row"><a class="team-row__person" href="\/admin\/users\/5">/);
  assert.match(active, /<span class="team-row__name">Асель Омарова<\/span><span class="team-row__meta">op5 · дата приёма 06\.08\.2025<\/span>/);
  assert.match(active, /<span class="team-row__role">Оператор<\/span><span class="team-row__team">Дана Ахметова<\/span><span class="team-row__summary">Оператор · Дана Ахметова<\/span>/);
  assert.match(active, /<span class="team-row__actions"><button>Изменить<\/button><\/span><span class="team-row__go" aria-hidden="true">/);
  assert.doesNotMatch(active, /Активен|В архиве/);
  const archived = row({ person: person(6, { is_active: false }), role: false });
  assert.match(archived, /<li class="team-row is-archived">/);
  assert.match(archived, /Оператор 6<span class="badge[^"]*"[^>]*>(?:<[^>]+>)*В архиве/);
  assert.match(archived, /<span class="team-row__role"><\/span>/);
  assert.doesNotMatch(archived, /team-row__actions/);
});

test("«Пользователи» lists people as rows: «В архив» comes with the row, the card holds the rest on a phone", () => {
  const page = read("./UsersPage.tsx"), css = read("./team.css");
  assert.doesNotMatch(page, /<table|users-table|team-mobile-list|>Открыть<\/Link>/);
  assert.match(page, /<ul className="team-rows team-rows--people" aria-label="Сотрудники">/);
  assert.match(page, /<Button className="team-row__archive" size="s" variant="plain"/);
  assert.ok(page.indexOf('className="team-row__archive"') < page.indexOf(">Изменить</Button>"), "«Изменить» stays next to the arrow");
  assert.match(css, /@media \(hover: hover\) \{\n  \.team-row:not\(:hover\):not\(:focus-within\) \.team-row__archive \{ opacity: 0; \}/);
  assert.match(css, /\.team-row__person::after \{ content: ""; position: absolute; inset: 0; \}/);
  assert.match(css, /\.team-row \{ position: relative; grid-column: 1 \/ -1; display: grid; grid-template-columns: subgrid;/);
  assert.match(css, /  \.team-rows--people \.team-row__actions \{ display: none; \}/);
  assert.match(read("./UserDetailPage.tsx"), /\{data\.is_active \? "Архивировать" : "Восстановить"\}/);
});

test("«Супервайзеры» counts the teams and who is still without one; a supervisor's «Моя команда» lists their operators", () => {
  const page = read("./GroupsPage.tsx");
  assert.match(page, /return actor\?\.role === "head" \|\| actor\?\.role === "admin" \? <Supervisors \/> : <MyTeam \/>;/);
  assert.match(page, /team\.users\(\{ role: "operator", unassigned: true, is_active: true, page: 1, size: 1 \}, signal\)/);
  assert.match(page, /<Link to="\/admin\/users\?role=operator&supervisor=unassigned&status=active">Показать операторов<\/Link>/);
  assert.match(page, /<Link className="team-row__person" to=\{`\/admin\/users\?role=operator&supervisor=\$\{item\.supervisor\.id\}`\}>/);
  assert.match(page, /const shown = groupsWorthShowing\(item\);/);
  // Every action of a team stays: assign, remove, the team's settings, a supervisor for a group without one.
  for (const label of ["Назначить операторов", "Снять из команды", "Настройки", "Назначить супервайзера", "Создать супервайзера"]) assert.match(page, new RegExp(`>${label}</Button>`), label);
  assert.match(page, /team\.users\(\{ role: "operator", supervisor_id: own!\.supervisor\.id, is_active: true, page, size \}, signal\)/);
  assert.match(page, /<TeamPersonRow key=\{user\.id\} person=\{user\} role=\{false\}/);
  assert.match(page, /queryKey: \["team-users", "my-team"/);
});

test("«Показатели сотрудников» names the team, keeps a place only where there is one and opens the operator's card", () => {
  const page = read("./AdminOperatorsPage.tsx");
  assert.match(page, /<th>Команда<\/th>/);
  assert.equal(page.match(/\{row\.group_name \?\? "Без команды"\}/g).length, 2);
  assert.equal(page.match(/<Rank row=\{row\} available=\{!period \|\| !!row\.metrics_available\} \/>/g).length, 2);
  assert.match(page, /return available && row\.rank != null \? <span className="rank-badge">\{row\.rank\}<\/span> : <span className="muted"/);
  assert.equal(page.match(/<Link className="cell-person operators-person" to=\{`\/admin\/users\/\$\{row\.user_id\}`\}>/g).length, 2);
  assert.match(page, /<Card title="Операторы"/);
});
