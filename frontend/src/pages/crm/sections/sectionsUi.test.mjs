import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL('.', import.meta.url));
const built = await build({ stdin: { contents: `export * from './CrmSections.tsx'; export * from './sectionsStore.ts'; export * from './edoData.ts'; export * from './promoData.ts'; export { seedDrivers } from '../drivers/driverData.ts'; export { COACH_TOURS } from '../coachTours.ts';`, resolveDir: here, loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, module, module.exports);
const kit = module.exports;

const drivers = kit.seedDrivers(), state = kit.seedSections(drivers);
const props = { state, update() {}, drivers, updateDriver() {}, addDriver() {}, employee: 'Оператор Учебный', notify() {}, openDriver() {}, go() {} };
const render = (view, query = '') => renderToStaticMarkup(React.createElement(kit.SectionPage, { ...props, view, params: new URLSearchParams(query) }));
const count = (html, needle) => html.split(needle).length - 1;

test('every section view renders, and the menu reaches each of them', () => {
  for (const view of Object.keys(kit.SECTION_VIEWS)) assert.ok(render(view).length > 300, view);
  const targets = kit.SIDEBAR.flatMap(g => g.items.map(([, target]) => target)).filter(Boolean);
  for (const view of Object.keys(kit.SECTION_VIEWS).filter(v => v !== 'registration-new')) assert.ok(targets.includes(view), view);
  assert.equal(kit.menuView('registration-new'), 'registration');
  assert.equal(kit.menuView('create'), 'list');
  assert.equal(kit.menuGroup('edo-dashboard'), 'ЭДО');
  for (const view of Object.keys(kit.SECTION_VIEWS)) assert.ok(kit.COACH_TOURS[kit.SECTION_TOURS[view]]?.length >= 2, `${view} has a Pulsar tour`);
});

test('the registry shows the legend and «Пополнить» works only where the payout is confirmed or failed', () => {
  const html = render('promo-registry');
  for (const label of Object.values(kit.PAYOUT).map(p => p.label)) assert.ok(html.includes(label), label);
  assert.ok(html.includes('Автоматическое начисление по акциям приостановлено'));
  assert.equal(count(html, '<tr data-payout='), 10, 'ten rows a page');
  const buttons = html.match(/<button class="sec-pay"[^>]*>/g) ?? [];
  assert.ok(buttons.length > 0);
  const rows = html.split('<tr data-payout="').slice(1);
  for (const row of rows) {
    const payout = row.slice(0, row.indexOf('"')), button = row.match(/<button class="sec-pay"[^>]*>/)?.[0];
    if (payout === 'ready' || payout === 'error') assert.ok(button && !button.includes('disabled'), payout);
    else if (payout === 'waiting') assert.ok(button?.includes('disabled'), payout);
    else assert.equal(button, undefined, payout);
  }
});

test('promotion pages start empty for the operator', () => {
  assert.ok(render('promo-connect').includes('ID водителя (аккаунт)'));
  assert.ok(render('promo-backdated').includes('Заявок нет.'));
  const conditions = render('promo-conditions');
  assert.ok(conditions.includes('Неделя без комиссии — 7 дн.') && conditions.includes('Вы ещё никого не добавляли.'));
});

test('registration: the list shows every seeded row, a draft reopens with its fields', () => {
  const list = render('registration');
  assert.ok(list.includes('Новый водитель') && list.includes('Через CRM') && list.includes('Черновик'));
  const draft = state.registrations.find(r => r.status === 'Черновик');
  const form = render('registration-new', `draft=${draft.id}`);
  assert.ok(form.includes(`черновик №${draft.id}`) && form.includes(`value="${draft.lastName}"`));
  assert.ok(form.includes('Номер В/У') && form.includes('Госномер'), 'a courier on a car needs a licence and the car');
  const blank = render('registration-new');
  assert.ok(!blank.includes('Номер В/У') && !blank.includes('День рождения'), 'nothing profession-specific before the profession');
  const details = render('registration', `reg=${state.registrations[0].id}`);
  assert.ok(details.includes(`Регистрация №${state.registrations[0].id}`));
});

test('ЭДО lists the working drivers of the period, pages by 25 and the dashboard counts them', () => {
  const html = render('edo'), shown = state.edo.filter(r => r.period === '2026-08' && r.works).length;
  assert.equal(count(html, '⟳ Обновить статус'), Math.min(25, shown));
  assert.ok(html.includes(`of total ${shown} items.`));
  const board = kit.edoDashboard(state.edo, '2026-08', { corporate: false, priority: false, hideUnissued: false });
  const dashboard = render('edo-dashboard');
  assert.ok(dashboard.includes(`${board.all.percent}%`) && dashboard.includes('Целевой уровень — 50%') && dashboard.includes('Нет данных для отображения'));
  assert.ok(render('edo-provider-dashboard').includes('Всего контактов'));
  assert.ok(render('edo-provider').includes('Статус - Провайдер сменили'));
});
