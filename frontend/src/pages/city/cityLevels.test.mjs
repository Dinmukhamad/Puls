import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./cityLevels.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { districtLevel, grownDistricts, MAX_DISTRICT_LEVEL, DISTRICT_LEVEL_NAMES } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

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
