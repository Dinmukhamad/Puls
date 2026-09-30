import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: `export * from './promoData.ts'; export * from './registrationData.ts'; export * from './edoData.ts'; export * from './sectionsStore.ts'; export { seedDrivers } from '../drivers/driverData.ts';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const kit = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const drivers = kit.seedDrivers(), now = '2026-09-30T08:00:00.000Z', today = '2026-09-30';
const byName = last => drivers.find(d => d.lastName === last);

test('a driver is found by account ID, numeric ID or a pasted link', () => {
  const d = byName('Сапарова');
  assert.equal(kit.findDriver(drivers, d.account), d);
  assert.equal(kit.findDriver(drivers, String(d.id)), d);
  assert.equal(kit.findDriver(drivers, `https://fleet.yandex.kz/contractors/${d.account}/details?park_id=1`), d);
  assert.equal(kit.findDriver(drivers, 'ffffffffffffffffffffffffffffffff'), undefined);
});

test('available promotions depend on the park, the driver\'s trips and profession', () => {
  const ids = d => kit.availablePromos(d, [], now).map(p => p.id);
  assert.deepEqual(ids(byName('Сапарова')), ['fast-start', 'tenge-2000', 'invite', 'priority']);
  // QAZAQ is not in «Быстрый старт»; «Честный» parks have nothing — as on the screenshot.
  assert.deepEqual(ids(byName('Байбосынов')), ['tenge-2000', 'priority']);
  assert.deepEqual(ids(byName('Ахметова')), []);
  assert.ok(ids(byName('Серикбаева')).includes('courier-week'));
  assert.equal(kit.promoProblem(kit.promoById('no-commission'), byName('Ахметова')), 'Парк «Честный Алматы» не участвует в акции «Неделя без комиссии».');
});

test('connecting twice is refused and «Пополнить» works only for a confirmed or failed payout', () => {
  const d = byName('Сапарова'), row = kit.connect([], d, 'fast-start', 'Оператор', now, 1);
  assert.equal(row.status, 'Ожидает первой поездки'); assert.equal(row.payout, 'waiting'); assert.equal(row.source, 'CRM');
  assert.throws(() => kit.connect([row], d, 'fast-start', 'Оператор', now, 2), /уже участвует/);
  assert.throws(() => kit.payOut(row, now), /Выплата недоступна/);
  assert.throws(() => kit.payOut({ ...row, payout: 'review' }, now), /Требует проверки/);
  const paid = kit.payOut({ ...row, payout: 'ready' }, now);
  assert.equal(paid.payout, 'paid'); assert.equal(paid.amount, 5000); assert.equal(paid.paidAt, now);
  assert.equal(kit.payOut({ ...row, payout: 'error' }, now).payout, 'paid');
  assert.ok(kit.connect([{ ...row, until: '2026-09-01T00:00:00.000Z' }], d, 'fast-start', 'Оператор', now, 3), 'a finished participation does not block a new one');
});

test('the registry seed shows every payout status and only known promotions', () => {
  const rows = kit.seedParticipants(drivers);
  for (const payout of Object.keys(kit.PAYOUT)) assert.ok(rows.some(r => r.payout === payout), payout);
  assert.ok(rows.every(r => kit.promoById(r.promo) && /^[0-9a-f]{32}$/.test(r.account)));
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  assert.ok(rows.some(r => r.account === byName('Омаров').account), 'training drivers have their own history');
});

test('a condition promotion changes the terms and refuses parks that do not take part', () => {
  const omarov = byName('Омаров');
  const { row, add, terms } = kit.addToConditionPromo([], omarov, 'no-commission', 'Оператор', now, 7);
  assert.equal(terms, 'Акция парк 0%'); assert.equal(row.payout, 'none'); assert.equal(row.before, omarov.conditions); assert.equal(add.until.slice(0, 10), '2026-10-07');
  assert.throws(() => kit.addToConditionPromo([row], omarov, 'no-commission', 'Оператор', now, 8), /уже в акции «Неделя без комиссии» до 07\.10\.2026/);
  assert.throws(() => kit.addToConditionPromo([], byName('Ахметова'), 'no-commission', 'Оператор', now, 9), /Парк «Честный Алматы» не участвует/);
  assert.throws(() => kit.addToConditionPromo([], omarov, 'courier-month', 'Оператор', now, 9), /только для курьеров/);
});

test('backdated requests: the form checks the basics, the head answers after two minutes', () => {
  const d = byName('Сапарова');
  const empty = kit.backdatedErrors({ promo: '', account: '', since: '', reason: '', files: [] }, drivers, [], now);
  assert.deepEqual(Object.keys(empty).sort(), ['account', 'files', 'promo', 'reason', 'since']);
  assert.match(kit.backdatedErrors({ promo: 'no-commission', account: d.account, since: '2026-09-25', reason: 'Водитель писал в WhatsApp 25.09', files: ['chat.png'] }, drivers, [], now).promo, /денежные/);
  assert.match(kit.backdatedErrors({ promo: 'fast-start', account: d.account, since: '2026-10-05', reason: 'Водитель писал в WhatsApp 25.09', files: ['chat.png'] }, drivers, [], now).since, /будущем/);
  const good = { promo: 'fast-start', account: d.account, since: '2026-09-25', reason: 'Водитель писал в WhatsApp 25.09, сообщение не обработали', files: ['chat.png'] };
  assert.deepEqual(kit.backdatedErrors(good, drivers, [], now), {});
  const request = kit.submitBackdated(good, d, 'Оператор', now, 11);
  assert.equal(kit.backdatedStatus(request, now), 'На рассмотрении');
  const later = new Date(Date.parse(now) + kit.DECISION_AFTER).toISOString();
  assert.equal(kit.backdatedStatus(request, later), 'Одобрена');
  let id = 50;
  const early = kit.settleBackdated([request], [], drivers, now, () => id++);
  assert.equal(early.added.length, 0); assert.equal(early.requests[0].applied, false);
  const settled = kit.settleBackdated([request], [], drivers, later, () => id++);
  assert.equal(settled.added.length, 1); assert.equal(settled.added[0].source, 'Задним числом'); assert.equal(settled.added[0].connectedAt.slice(0, 10), '2026-09-25');
  assert.equal(kit.settleBackdated(settled.requests, settled.added, drivers, later, () => id++).added.length, 0, 'applied once');
  const late = kit.submitBackdated({ ...good, since: '2026-09-01' }, d, 'Оператор', now, 12);
  assert.equal(kit.backdatedStatus(late, later), 'Отклонена');
  assert.equal(kit.settleBackdated([late], [], drivers, later, () => id++).added.length, 0);
});

test('registration: fields depend on the type and profession, the IIN carries the birth date', () => {
  const form = { ...kit.emptyForm(), type: 'Регистрация нового СМЗ', park: 'iTaxi Алматы', profession: 'Водитель', lastName: 'Учебный', firstName: 'Тест', phone: '87001112233', iin: '950312300517',
    license: 'an898706', licenseIssued: '2020-01-10', licenseExpires: '2030-01-09', car: { brand: 'Kia', model: 'Rio', color: 'Белый', year: 2020, plate: '803ASD02' } };
  assert.deepEqual(kit.regErrors(form, today), { address: 'Укажите адрес прописки.' });
  assert.deepEqual(kit.regErrors({ ...form, address: 'г. Алматы, ул. Учебная, 1' }, today), {});
  assert.match(kit.regErrors({ ...form, licenseExpires: '2026-09-01' }, today).licenseExpires, /истёк/);
  assert.equal(kit.iinProblem('951332300517'), 'Первые 6 цифр ИИН — дата рождения ГГММДД.');
  assert.equal(kit.iinProblem('950312900517'), 'Седьмая цифра ИИН — век и пол, от 1 до 6.');
  assert.match(kit.regErrors({ ...form, iin: '100312500517' }, today).iin, /18 лет/);
  const courier = { ...kit.emptyForm(), type: 'Регистрация нового физического лица', park: 'iTaxi (Доставка) Алматы', profession: kit.PROFESSIONS[2], lastName: 'Курьер', firstName: 'Тест', phone: '+77001112244', iin: '010517500123', birthday: '2001-05-18' };
  assert.equal(kit.regErrors(courier, today).iin, 'Дата рождения не совпадает с ИИН.');
  assert.deepEqual(kit.regErrors({ ...courier, birthday: '2001-05-17' }, today), {}, 'walking couriers need no licence or car');
  assert.equal(kit.normalizePhone('8 700 111 22 33'), '+77001112233');
});

test('«Проверить водителя» finds an existing driver; saving creates the training account', () => {
  const taken = { ...kit.emptyForm(), type: 'Регистрация нового физического лица', profession: 'Водитель', phone: byName('Омаров').phone, iin: '950312300517', license: 'AN898706' };
  const found = kit.checkDriver(taken, drivers, []);
  assert.equal(found.ok, false); assert.match(found.text, /Омаров Ерлан, парк «iTaxi Алматы»/);
  const fresh = { ...taken, park: 'iTaxi Алматы', lastName: 'Новый', firstName: 'Водитель', phone: '+77001112233', address: '', licenseIssued: '2020-01-10', licenseExpires: '2030-01-09', car: { brand: 'Kia', model: 'Rio', color: 'Белый', year: 2020, plate: '803ASD02' } };
  const check = kit.checkDriver(fresh, drivers, []);
  assert.equal(check.ok, true); assert.equal(check.key, kit.checkKey(fresh));
  const { registration, driver } = kit.registerDriver(fresh, drivers, 'Оператор', now, 9001);
  assert.equal(registration.status, 'Зарегистрирован'); assert.equal(registration.result, 'Через CRM'); assert.equal(registration.account, driver.account);
  assert.equal(driver.type, 'Физлицо'); assert.equal(driver.balanceLimit, -50); assert.equal(driver.car.plate, '803ASD02'); assert.ok(driver.id > Math.max(...drivers.map(d => d.id)));
  assert.equal(kit.checkDriver(fresh, [...drivers, driver], []).ok, false, 'the new driver is found next time');
  assert.equal(kit.draftProblem({ ...kit.emptyForm(), type: 'Регистрация нового СМЗ' }), 'Для черновика укажите фамилию или номер телефона.');
});

test('seeded registrations and ЭДО rows hold valid fictional documents', () => {
  for (const r of kit.seedRegistrations()) { assert.equal(kit.iinProblem(r.iin, r.birthday), null, r.lastName); assert.match(r.phone, /^\+7700\d{7}$/); }
  const edo = kit.seedEdo(), provider = kit.seedProvider();
  for (const r of edo) assert.equal(kit.iinProblem(r.iin), null, r.name);
  assert.equal(new Set(edo.map(r => r.account)).size, edo.length);
  for (const status of kit.DOC_STATUSES) assert.ok(edo.some(r => r.avrYandex === status), status);
  assert.ok(provider.every(r => r.ecp === 'Нет ЭЦП'));
});

test('ЭДО: a call can promise the signature, and «Обновить статус» then finds the documents signed', () => {
  const row = kit.seedEdo().find(r => r.docs === 'Да' && !kit.allSigned(r));
  assert.throws(() => kit.logEdoCall(row, { reach: '—', office: '—', comment: '' }, 'Оператор', now), /статус дозвона/);
  assert.throws(() => kit.logEdoCall(row, { reach: 'Дозвонились', office: '—', comment: '' }, 'Оператор', now), /договорились/);
  const unchanged = kit.refreshEdo(row, now);
  assert.equal(unchanged.changed, false); assert.match(unchanged.row.history[0].text, /ещё не подписал/);
  const missed = kit.logEdoCall(row, { reach: 'Недозвон', office: '—', comment: '' }, 'Оператор', now);
  assert.equal(missed.callStatus, 'В работе'); assert.equal(missed.promised, false);
  const called = kit.logEdoCall(row, { reach: 'Дозвонились', office: 'Придёт', comment: 'Подпишет в Sapar сегодня' }, 'Оператор', now);
  assert.equal(called.callStatus, 'Обработан'); assert.equal(called.manager, 'Оператор'); assert.equal(called.calledAt, now);
  const signed = kit.refreshEdo(called, now);
  assert.equal(signed.changed, true); assert.ok(kit.allSigned(signed.row)); assert.equal(signed.row.office, 'Пришёл'); assert.equal(signed.row.signedAt, today);
});

test('provider campaign: agreeing needs the ID request, the provider changes once the ID is received', () => {
  const row = kit.seedProvider()[0];
  assert.throws(() => kit.logProviderCall(row, { reach: 'Дозвон', outcome: '—', requestId: '—', office: '—', comment: '' }, 'Оператор', now), /итог звонка/);
  assert.throws(() => kit.logProviderCall(row, { reach: 'Дозвон', outcome: 'Согласен сменить', requestId: '—', office: '—', comment: '' }, 'Оператор', now), /Запрос ID/);
  const asked = kit.logProviderCall(row, { reach: 'Дозвон', outcome: 'Согласен сменить', requestId: 'Запрошен', office: '—', comment: '' }, 'Оператор', now);
  assert.equal(asked.changed, '—'); assert.equal(asked.callStatus, 'Обработан');
  const done = kit.logProviderCall(asked, { reach: 'Дозвон', outcome: 'Согласен сменить', requestId: 'Получен', office: '—', comment: '' }, 'Оператор', now);
  assert.equal(done.changed, 'Да'); assert.equal(done.provider, 'sapar');
  assert.equal(kit.logProviderCall(row, { reach: 'Недозвон', outcome: 'Отказ', requestId: 'Получен', office: '—', comment: '' }, 'Оператор', now).outcome, '—', 'no outcome without reaching the driver');
});

test('dashboards count the period and the manager rating counts the last seven days', () => {
  const edo = kit.seedEdo(), board = kit.edoDashboard(edo, '2026-08', { corporate: false, priority: false, hideUnissued: false });
  const scope = edo.filter(r => r.period === '2026-08' && r.smz);
  assert.equal(board.total, scope.length); assert.equal(board.all.count, scope.filter(kit.allSigned).length);
  assert.ok(board.yandex.percent > 0 && board.yandex.percent <= 100); assert.equal(board.called, 0);
  assert.ok(kit.edoDashboard(edo, '2026-08', { corporate: true, priority: false, hideUnissued: true }).total < board.total);
  const provider = kit.providerDashboard(kit.seedProvider(), '2026-08');
  assert.equal(provider.total, 24); assert.deepEqual(provider.byStatus, [['Новый', 24]]);
  const rating = kit.managerRating([{ calledAt: now, manager: 'Оператор' }, { calledAt: '2026-09-29T10:00:00.000Z', manager: 'Оператор' }, { calledAt: '2026-09-01T10:00:00.000Z', manager: 'Старый' }], today);
  assert.equal(rating.days.length, 7); assert.equal(rating.days.at(-1), today);
  assert.deepEqual(rating.rows, [{ manager: 'Оператор', perDay: [0, 0, 0, 0, 0, 1, 1], total: 2 }]);
});

test('resetting one group keeps the others', () => {
  const state = kit.seedSections(drivers);
  const touched = { ...state, backdated: [{ id: 1 }], registrations: [], edo: state.edo.slice(1) };
  const promo = kit.resetGroup(touched, 'promo', drivers);
  assert.equal(promo.backdated.length, 0); assert.equal(promo.registrations.length, 0); assert.equal(promo.edo.length, state.edo.length - 1);
  assert.equal(kit.resetGroup(touched, 'edo', drivers).edo.length, state.edo.length);
});
