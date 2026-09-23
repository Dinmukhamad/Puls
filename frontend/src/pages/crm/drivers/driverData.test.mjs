import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const built = await build({entryPoints:[fileURLToPath(new URL('./driverData.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const d = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const drivers = d.seedDrivers(), first = drivers[0];

test('the training base has 10–15 unique drivers with both cooperation types', () => {
  assert.ok(drivers.length >= 10 && drivers.length <= 15);
  assert.equal(new Set(drivers.map(x => x.id)).size, drivers.length);
  assert.equal(new Set(drivers.map(x => x.account)).size, drivers.length);
  assert.ok(drivers.every(x => /^[0-9a-f]{32}$/.test(x.account)));
  assert.ok(drivers.some(x => x.type === 'СМЗ') && drivers.some(x => x.type === 'Физлицо'));
});

test('search finds a driver by name, phone, car, callsign, ID and a pasted fleet link', () => {
  const find = q => drivers.filter(x => d.matchesDriver(x, q)).map(x => x.id);
  assert.deepEqual(find('Байбосынов'), [first.id]);
  assert.deepEqual(find('самат'), [first.id]);
  assert.deepEqual(find('8 705 560 77 94'), [first.id]);
  assert.deepEqual(find('803asd02'), [first.id]);
  assert.deepEqual(find('altynbek_op'), [first.id]);
  assert.deepEqual(find('11046706'), [first.id]);
  assert.deepEqual(find(`https://fleet.yandex.kz/contractors/${first.account}/details?park_id=e5d80625ccef48bd92f677511109e019&lang=ru&theme=day`), [first.id]);
  assert.deepEqual(find('nobody-here'), []);
  assert.equal(find('').length, drivers.length);
});

test('SMZ transfer needs an address and a 12-digit IIN, then switches the type and logs a reminder', () => {
  const input = { lastName: first.lastName, firstName: first.firstName, middleName: first.middleName, address: '', iin: '123', conditions: 'Для всех 2%', balanceLimit: -50 };
  assert.deepEqual(Object.keys(d.validateSmz(input)).sort(), ['address', 'iin']);
  assert.throws(() => d.transferToSmz(first, input));
  const done = d.transferToSmz(first, { ...input, address: 'г. Алматы, ул. Абая, 10', iin: '900101300123' }, '2026-09-23T12:00:00Z');
  assert.equal(done.type, 'СМЗ'); assert.equal(done.iin, '900101300123');
  assert.match(done.history[0].text, /выйти из аккаунта/);
  assert.throws(() => d.transferToSmz(done, { ...input, address: 'г. Алматы', iin: '900101300123' }));
  assert.equal(d.returnToIndividual(done).type, 'Физлицо');
});

test('the cash limit toggles on and off and only logs real changes', () => {
  const on = d.setCashLimit(first, true);
  assert.equal(on.cashLimit, true); assert.match(on.history[0].text, /500\s000/);
  assert.equal(d.setCashLimit(on, true), on);
  assert.equal(d.setCashLimit(on, false).cashLimit, false);
});

test('a new car needs all fields and the plate copied into the callsign, and then requires photo control', () => {
  const car = { ...first.car, brand: 'Kia', model: 'Rio', color: 'Белый', year: 2022, plate: '555ABC02', callsign: 'altynbek_op' };
  assert.equal(d.validateCar(car).callsign, 'Скопируйте госномер в поле «Позывной».');
  assert.ok(d.validateCar({ ...car, plate: '5 55' }).plate);
  assert.ok(d.validateCar({ ...car, brand: '' }).brand);
  assert.throws(() => d.changeCar(first, car));
  const changed = d.changeCar(first, { ...car, callsign: '555ABC02' });
  assert.equal(changed.car.plate, '555ABC02'); assert.equal(changed.callsign, '555ABC02'); assert.equal(changed.photoControl, 'Требуется');
  assert.match(changed.history[0].text, /фотоконтроль/);
  // Editing the current car keeps its callsign rules relaxed.
  assert.doesNotThrow(() => d.changeCar(first, { ...first.car, color: 'Серый' }));
});

test('sending a code is logged with the driver phone', () => {
  const sent = d.sendCode(first);
  assert.equal(sent.codes, 1); assert.ok(sent.history[0].text.includes(first.phone));
});
