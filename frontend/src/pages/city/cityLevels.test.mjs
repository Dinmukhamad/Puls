import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./cityLevels.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { districtLevel, grownDistricts, MAX_DISTRICT_LEVEL, DISTRICT_LEVEL_NAMES } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const labelsBuilt = await build({entryPoints:[fileURLToPath(new URL('./cityDistricts.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {districtLabels,DISTRICT_ICONS,DISTRICT_COLORS} = await import(`data:text/javascript;base64,${Buffer.from(labelsBuilt.outputFiles[0].text).toString('base64')}`);

test('each completed mission raises the building by one stage, up to five', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(n => districtLevel(n)), [1, 2, 3, 4, 5, 5, 5]);
  assert.equal(DISTRICT_LEVEL_NAMES.length, MAX_DISTRICT_LEVEL);
});

test('districts that are not open yet stay at their initial stage', () => {
  assert.equal(districtLevel(4, true), 1);
});

test('only districts that went up since the last visit celebrate', () => {
  assert.deepEqual(grownDistricts(null, { crm: 3 }), []);
  assert.deepEqual(grownDistricts({ crm: 2, driver: 4 }, { crm: 3, driver: 4, academy: 2 }), ['crm']);
  assert.deepEqual(grownDistricts({ crm: 4 }, { crm: 3 }), []);
});

test('the scenarios district is available immediately and follows server completion and reward state', () => {
  const districts = [{id:'scenarios',name:'Сценарии',subtitle:'Диалог и практика',soon:false}];
  const mission = {key:'scenario_business_park',district:'scenarios',enabled:true,state:'available'};
  const first = districtLabels(districts,[mission])[0];
  assert.equal(first.soon,false); assert.equal(first.reward,false); assert.equal(first.level,1);
  assert.equal(first.icon,DISTRICT_ICONS.scenarios); assert.equal(first.status,'0 из 1 миссий');
  assert.match(DISTRICT_COLORS.scenarios,/^#[0-9a-f]{6}$/i);
  assert.equal(districtLabels(districts,[{...mission,state:'ready'}])[0].reward,true);
  const completed = districtLabels(districts,[{...mission,state:'completed'}])[0];
  assert.equal(completed.level,2); assert.equal(completed.reward,false); assert.equal(completed.status,'✓ Район освоен');
  // Sales operators receive neither district nor mission; no client-side role guessing adds them back.
  assert.deepEqual(districtLabels([],[]),[]);
});
