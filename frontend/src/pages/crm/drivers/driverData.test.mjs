import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./driverData.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const d = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
// The seeded fleet of «Диспетчерская»; the server test checks it is still what the server builds.
const fleet = JSON.parse(readFileSync(new URL('./fleet.fixture.json', import.meta.url), 'utf8'));
const drivers = d.fromFleet(fleet), first = drivers.find(x => x.lastName === 'Байбосынов');

test('CRM lists every fleet account under its CRM number, newest first, with the dispatch account ID', () => {
  assert.equal(drivers.length, fleet.drivers.length);
  assert.equal(new Set(drivers.map(x => x.id)).size, drivers.length);
  assert.deepEqual(drivers.map(x => x.account).sort(), fleet.drivers.map(x => x.id).sort());
  assert.ok(drivers.every((x, i) => !i || drivers[i - 1].id > x.id));
  assert.equal(drivers[0], first);
  assert.ok(drivers.some(x => x.type === 'СМЗ') && drivers.some(x => x.type === 'Физлицо'));
  assert.equal(first.id, 11046706); assert.equal(first.account, 'ddcd8d21379f4694aa01eff73e5aadc1');
  assert.equal(first.park, 'QAZAQ Алматы'); assert.equal(first.parkId, 'qazaq-ala'); assert.equal(first.status, 'Занят');
  assert.equal(first.type, 'Физлицо'); assert.equal(first.conditions, 'Для всех 2%'); assert.equal(first.rating, 'Нет данных');
  // A walking courier has no car in either work site.
  const walker = fleet.drivers.find(x => !x.car);
  assert.equal(drivers.find(x => x.account === walker.id).car, null);
  assert.equal(drivers.find(x => x.lastName === 'Сапарова').status, 'Нет данных', 'an account that does not work has no status');
});

test('the link to the driver is the dispatch one, and CRM search reads its ID', () => {
  const park = fleet.parks.find(p => p.id === first.parkId);
  assert.equal(d.fleetLink(first), `https://fleet.yandex.kz/contractors/${first.account}/details?park_id=${park.park_id}&lang=ru`);
  const find = q => drivers.filter(x => d.matchesDriver(x, q)).map(x => x.id);
  assert.deepEqual(find('Байбосынов'), [first.id]);
  assert.deepEqual(find('самат'), [first.id]);
  assert.deepEqual(find('8 705 560 77 94'), [first.id]);
  assert.deepEqual(find('803asd02'), [first.id]);
  assert.deepEqual(find('altynbek_op'), [first.id]);
  assert.deepEqual(find('11046706'), [first.id]);
  assert.deepEqual(find(`${d.fleetLink(first)}&theme=day`), [first.id]);
  // Every account of the dispatch is found by the ID from its link.
  for (const x of fleet.drivers) assert.equal(find(`https://fleet.yandex.kz/contractors/${x.id}/details?park_id=1`).length, 1, x.id);
  assert.deepEqual(find('nobody-here'), []);
  assert.equal(find('').length, drivers.length);
});

test('SMZ transfer needs an address and a 12-digit IIN', () => {
  assert.deepEqual(Object.keys(d.validateSmz({ address: '', iin: '123' })).sort(), ['address', 'iin']);
  assert.deepEqual(d.validateSmz({ address: 'г. Алматы, ул. Абая, 10', iin: '900101300123' }), {});
});

test('a new car needs all fields, a tariff and the plate copied into the callsign', () => {
  const car = { ...first.car, brand: 'Kia', model: 'Rio', color: 'Белый', year: 2022, plate: '555ABC02', callsign: 'altynbek_op' };
  assert.ok(d.replacesCar(first, car));
  assert.equal(d.validateCar(car).callsign, 'Скопируйте госномер в поле «Позывной».');
  assert.ok(d.validateCar({ ...car, plate: '5 55' }).plate);
  assert.ok(d.validateCar({ ...car, brand: '' }).brand);
  assert.ok(d.validateCar({ ...car, tariffs: [] }).tariffs);
  assert.deepEqual(d.validateCar({ ...car, callsign: '555ABC02' }), {});
  // Editing the current car keeps its callsign.
  assert.ok(!d.replacesCar(first, first.car));
  assert.deepEqual(d.validateCar({ ...first.car, color: 'Серый' }, false), {});
  assert.ok(d.replacesCar({ car: null }, car));
  assert.deepEqual(Object.keys(d.carInput(first.car)).sort(), ['body', 'brand', 'callsign', 'color', 'fuel', 'lightbox', 'model', 'owner', 'plate', 'status', 'sts', 'tariffs', 'transmission', 'vin', 'wrap', 'year']);
});

test('cabinet times are shown as they are', () => {
  assert.equal(d.fleetDate('2026-09-30T12:40:57'), '30.09.2026, 12:40');
  assert.equal(d.fleetDate('2026-09-19'), '19.09.2026');
  assert.equal(d.fleetDate(''), '—');
});
