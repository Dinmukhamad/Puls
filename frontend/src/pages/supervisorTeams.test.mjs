import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL("./supervisorTeams.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
const { activeTeamGroups, destinationGroupId, userTeamLabel, assignmentTransferUsers } = module.exports;

const owner = { id: 8, full_name: "Алия Садыкова", group: null };
const group = (id, extra = {}) => ({ id, code: `group-${id}`, name: `Группа ${id}`, is_active: true, supervisor: owner, member_count: 0, operator_count: 0, ...extra });
const team = (...groups) => ({ supervisor: { ...owner, login: "aliya", is_active: true }, group_id: groups.length === 1 ? groups[0].id : null, groups, operator_count: 0 });
const user = (id, currentGroup = null, extra = {}) => ({ id, login: `operator-${id}`, full_name: `Оператор ${id}`, phone: null, email: null, role: "operator", is_active: true, is_developer: false, hired_on: null, group: currentGroup && { id: currentGroup.id, name: currentGroup.name, code: currentGroup.code }, ...extra });

test("only the single active group is selected automatically, without touching archived history", () => {
  const archived = group(1, { is_active: false });
  const available = group(2);
  const source = team(archived, available);
  const before = structuredClone(source);
  assert.deepEqual(activeTeamGroups(source), [available]);
  assert.equal(destinationGroupId(source, ""), 2);
  assert.equal(destinationGroupId(source, "1", 1), 2);
  assert.deepEqual(source, before);
  assert.equal(destinationGroupId(team(archived), "1", 1), null);
  assert.equal(destinationGroupId(team(), ""), null);
});

test("several existing groups preserve district choice and require an explicit valid destination", () => {
  const source = team(group(10), group(20), group(30, { is_active: false }));
  assert.equal(destinationGroupId(source, ""), null);
  assert.equal(destinationGroupId(source, "", 20), 20);
  assert.equal(destinationGroupId(source, "10", 20), 10);
  assert.equal(destinationGroupId(source, " 20 "), 20);
  assert.equal(destinationGroupId(source, "", 30), null);
  assert.equal(destinationGroupId(source, "", 999), null);
  for (const selection of ["30", "999", "invalid", "10x", "2e1", "-10", "10.0"]) {
    assert.equal(destinationGroupId(source, selection, 20), null, `invalid ${selection} must not fall back to another district`);
  }
});

test("team labels distinguish ownership, unknown groups and archived groups", () => {
  const owned = group(1);
  const unowned = group(2, { supervisor: null });
  const archived = group(3, { is_active: false });
  const groups = [owned, unowned, archived];
  assert.equal(userTeamLabel(user(1), groups), "Без команды");
  assert.equal(userTeamLabel(user(1, owned), groups), "Алия Садыкова · Группа 1");
  assert.equal(userTeamLabel(user(1, unowned), groups), "Группа 2 · Супервайзер не назначен");
  assert.equal(userTeamLabel(user(1, archived), groups), "Алия Садыкова · Группа 3 (архив)");
  assert.equal(userTeamLabel(user(1, group(99)), groups), "Группа 99 · Супервайзер неизвестен");
});

test("transfer warning covers cross-group operators, including the same supervisor's other district", () => {
  const firstDistrict = group(1);
  const destination = group(2);
  const otherTeam = group(3, { supervisor: { ...owner, id: 9, full_name: "Другой супервайзер" } });
  const target = team(firstDistrict, destination);
  const people = [
    user(1), user(2, destination), user(3, firstDistrict), user(4, otherTeam),
    user(5, otherTeam, { role: "trainer" }), user(6, group(99)),
  ];
  const before = structuredClone(people);
  assert.deepEqual(assignmentTransferUsers(people, target, destination.id).map((item) => item.id), [3, 4, 6]);
  assert.deepEqual(people, before);
  assert.deepEqual(assignmentTransferUsers(people, target, null), []);
  assert.deepEqual(assignmentTransferUsers(people, target, otherTeam.id), []);
  assert.deepEqual(assignmentTransferUsers(people, team(group(2, { is_active: false })), 2), []);
});
