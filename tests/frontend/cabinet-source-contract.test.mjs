import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const levels = await readFile(
  new URL('../../js/src/views/operator-levels/10-levels-cabinet.view.js', import.meta.url),
  'utf8',
);
const cabinetSections = await readFile(
  new URL('../../js/src/views/operator-levels/15-cabinet-weekly-achievements.view.js', import.meta.url),
  'utf8',
);
const operatorWorkspace = await readFile(
  new URL('../../js/src/views/rating/99-operator-cabinet-rating-redesign.view.js', import.meta.url),
  'utf8',
);
const cabinetSources = `${levels}\n${cabinetSections}\n${operatorWorkspace}`;

test('cabinet has one renderer, one refresh action, and one shared loader', () => {
  assert.equal([...cabinetSources.matchAll(/\bfunction renderCabinet\s*\(/g)].length, 1);
  assert.equal([...cabinetSources.matchAll(/\bfunction reloadCabinet\s*\(/g)].length, 1);
  assert.equal([...cabinetSources.matchAll(/\bfunction loadCabinetSnapshot\s*\(/g)].length, 1);
  assert.doesNotMatch(cabinetSections, /_cabinetDataPromise/);
});

test('cabinet snapshot is scoped to the signed-in user and rejects stale responses', () => {
  assert.match(levels, /function cabinetSessionKey\(\)/);
  assert.match(levels, /function cabinetSnapshotForCurrentUser\(\)/);
  assert.match(levels, /_cabinetRequestVersion === requestVersion/);
  assert.match(operatorWorkspace, /cabinetSnapshotForCurrentUser\(\)/);
});

test('level management uses accessible dialogs instead of browser prompts', () => {
  assert.doesNotMatch(levels, /\bprompt\s*\(/);
  assert.match(levels, /id="manual-level-reason"/);
  assert.match(levels, /role="alert" aria-live="polite"/);
  assert.match(levels, /aria-controls="op-levels-tab-body"/);
});
