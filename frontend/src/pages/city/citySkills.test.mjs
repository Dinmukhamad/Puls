import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({ entryPoints: [fileURLToPath(new URL('./citySkills.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { districtProgress, missionNote, continueMission, openMission } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const district = (id, extra = {}) => ({ id, name: id, subtitle: '', soon: false, ...extra });
const mission = (key, district, state, extra = {}) => ({ key, district, state, enabled: true, title: key, objective: '', current: 0, target: 1, prerequisite: null, ...extra });

test('a district counts its curriculum: passed of all, mastered, a reward waiting', () => {
  const crm = district('crm');
  assert.deepEqual(districtProgress(crm, [mission('a', 'crm', 'completed'), mission('b', 'crm', 'ready'), mission('c', 'crm', 'locked'), mission('x', 'dispatch', 'completed')]),
    { done: 1, total: 3, mastered: false, reward: true });
  assert.equal(districtProgress(crm, [mission('a', 'crm', 'completed'), mission('b', 'crm', 'completed')]).mastered, true);
  // A paused mission not passed is not counted; a passed one still is.
  assert.deepEqual(districtProgress(crm, [mission('a', 'crm', 'completed', { enabled: false }), mission('b', 'crm', 'unavailable', { enabled: false })]),
    { done: 1, total: 1, mastered: true, reward: false });
  // Deferred lessons keep their stages; a district coming soon is never mastered.
  assert.deepEqual(districtProgress(district('oktell', { completed_missions: 4 }), []), { done: 4, total: 4, mastered: true, reward: false });
  assert.equal(districtProgress(district('future', { soon: true }), []).mastered, false);
});

test('each mission says in a few words what it waits for', () => {
  const first = mission('first', 'crm', 'available', { title: 'Первое обращение' });
  const all = [first];
  assert.equal(missionNote(mission('a', 'crm', 'completed'), all), 'Пройдено');
  assert.equal(missionNote(mission('a', 'crm', 'ready'), all), 'Готово — забери награду');
  assert.equal(missionNote(mission('a', 'crm', 'in_progress', { current: 2, target: 5 }), all), 'В процессе · 2 из 5');
  assert.equal(missionNote(first, all), 'Можно начать');
  assert.equal(missionNote(mission('a', 'crm', 'locked', { prerequisite: 'first' }), all), 'Сначала «Первое обращение»');
  assert.equal(missionNote(mission('a', 'crm', 'locked'), all), 'Впереди');
  assert.equal(missionNote(mission('a', 'crm', 'unavailable'), all), 'На паузе');
});

test('the next mission: a reward first, then one in progress, then one to start, never in a district to come', () => {
  const districts = [district('academy'), district('crm'), district('soon', { soon: true })];
  const base = [mission('welcome', 'academy', 'completed'), mission('crm_a', 'crm', 'available'), mission('crm_b', 'crm', 'in_progress'), mission('later', 'soon', 'ready')];
  assert.equal(continueMission(districts, base).key, 'crm_b');
  assert.equal(continueMission(districts, [...base, mission('crm_c', 'crm', 'ready')]).key, 'crm_c');
  assert.equal(continueMission(districts, [mission('crm_a', 'crm', 'available'), mission('p', 'crm', 'ready', { enabled: false })]).key, 'crm_a', 'a paused mission is not offered');
  assert.equal(continueMission(districts, [mission('welcome', 'academy', 'completed'), mission('crm_a', 'crm', 'locked')]), null);
});

test('a district opens the mission asked for, else the one to do; a mastered one opens none', () => {
  const missions = [mission('a', 'crm', 'completed'), mission('b', 'crm', 'locked'), mission('c', 'crm', 'available')];
  assert.equal(openMission(missions, null, false).key, 'c');
  assert.equal(openMission(missions, 'a', false).key, 'a');
  assert.equal(openMission(missions, 'missing', false).key, 'c');
  assert.equal(openMission([mission('a', 'crm', 'completed'), mission('b', 'crm', 'locked')], null, false).key, 'b', 'what is ahead, not what is passed');
  assert.equal(openMission([mission('a', 'crm', 'completed')], null, true), null);
  assert.equal(openMission([mission('a', 'crm', 'completed')], 'a', true).key, 'a');
  assert.equal(openMission([], null, false), null);
});
