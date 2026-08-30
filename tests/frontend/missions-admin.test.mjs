/**
 * Регрессии административного экрана «Миссии».
 *
 * Что ломалось до переработки:
 *  · две настройки периода делили одну плотную горизонтальную строку внутри
 *    секции «Территории и период SAPAR»;
 *  · поле сообщения оператору на 1000 символов было однострочным <input>
 *    шириной 120–265 px — текст обрезался;
 *  · кнопка публикации стояла между полями ввода, а не рядом с версией;
 *  · системные статусы выводились как есть: available, coming_soon;
 *  · публикация новой версии происходила без подтверждения.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const view = await readFile(new URL('js/src/views/missions/80-missions.view.js', root), 'utf8');
const css = await readFile(new URL('css/src/views/21-missions-admin.css', root), 'utf8');

test('экран разложен на отдельные зоны, а не одну секцию с настройками', () => {
  assert.match(view, /function missionWorldsSection/, 'нет зоны структуры обучения');
  assert.match(view, /function missionProviderWindowCard/, 'период смены провайдера не выделен в карточку');
  assert.match(view, /function documentSigningWindowEditor/, 'период подписания АВР не выделен в карточку');
  // Прежняя общая секция, смешивавшая территории и настройку периода, ушла.
  // Проверяем разметку, а не текст файла: объяснение прежнего дефекта
  // живёт в комментарии и не должно ронять тест.
  assert.doesNotMatch(view, /<h2[^>]*>Территории и период SAPAR/, 'вернулась смешанная секция');
  assert.doesNotMatch(view, /function missionAdminConfiguration/, 'вернулась общая функция настроек');
});

test('сообщение оператору — многострочное поле, а не однострочный input', () => {
  const card = view.match(/function missionWindowCard[\s\S]*?\n\}/)[0];
  assert.match(card, /<textarea[^>]*id="\$\{esc\(message\.id\)\}"/, 'сообщение не textarea');
  assert.match(card, /maxlength="1000"/, 'потерян предел длины сообщения');
  // Однострочных input с id *-window-message быть не должно.
  assert.doesNotMatch(view, /<input id="mission-window-message"/, 'сообщение снова однострочное');
  assert.doesNotMatch(view, /<input id="smz-window-message"/, 'сообщение подписания снова однострочное');
  assert.match(css, /\.mission-window-message textarea/, 'нет стилей многострочного поля');
  assert.match(css, /resize: vertical/, 'поле нельзя растянуть под длинный текст');
});

test('карточка показывает версию, дату публикации и расчёт сервера', () => {
  const card = view.match(/function missionWindowCard[\s\S]*?\n\}/)[0];
  assert.match(card, /Версия \$\{version\}/, 'не показывается текущая версия');
  assert.match(card, /mission-window-version/, 'нет блока версии');
  assert.match(card, /\$\{preview\}/, 'не показывается фактический период от сервера');
  assert.match(view, /function missionVersionDate/, 'нет даты публикации версии');
});

test('кнопка публикации стоит в подвале карточки рядом с версией', () => {
  const card = view.match(/function missionWindowCard[\s\S]*?\n\}/)[0];
  const footer = card.match(/mission-window-footer[\s\S]*?<\/div>\s*<\/section>/);
  assert.ok(footer, 'нет подвала карточки');
  assert.match(footer[0], /btn-primary/, 'кнопка публикации не в подвале');
});

test('несохранённые изменения видны до публикации', () => {
  assert.match(view, /function bindMissionWindowDirty/, 'нет отслеживания правок');
  assert.match(view, /data-dirty-for=/, 'нет индикатора несохранённых изменений');
  assert.match(view, /bindMissionWindowDirty\(el\)/, 'отслеживание не подключено к экрану');
  assert.match(css, /\.mission-dirty/, 'нет стилей индикатора');
});

test('системные статусы доступности локализованы', () => {
  assert.match(view, /function missionAvailabilityLabel/, 'нет перевода статусов доступности');
  const map = view.match(/function missionAvailabilityLabel[\s\S]*?\n\}/)[0];
  assert.match(map, /available: 'Доступно'/);
  assert.match(map, /coming_soon: 'Скоро'/);
  // Сырое значение больше не печатается в разметке территорий.
  assert.doesNotMatch(view, /esc\(world\.availability\)/, 'сырой статус снова выводится пользователю');
});

test('публикация версии подтверждается и сообщает о последствиях', () => {
  assert.match(view, /function confirmWindowPublish/, 'нет подтверждения публикации');
  for (const fn of ['saveMissionProviderWindow', 'saveDocumentSigningWindow']) {
    const body = view.match(new RegExp(`async function ${fn}[\\s\\S]*?\\n\\}`))[0];
    assert.match(body, /await confirmWindowPublish\(/, `${fn} публикует без подтверждения`);
    assert.match(body, /if \(!ok\) return;/, `${fn} игнорирует отказ от публикации`);
    assert.match(body, /Уже начатые попытки продолжат работать по прежней версии/,
      `${fn} не предупреждает о влиянии на активные попытки`);
    assert.match(body, /showWindowValidationError\(/, `${fn} не показывает ошибку валидации у карточки`);
  }
});

test('поля не сжимаются на узком экране, а переносятся', () => {
  assert.match(css, /\.mission-window-fields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit/,
    'поля периода выложены не сеткой');
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?grid-template-columns: 1fr/,
    'на телефоне поля не переходят в одну колонку');
  // Высота берётся из токена, поэтому проверяем и ссылку, и само значение:
  // уменьшение --control-h-lg тоже должно ронять тест.
  assert.match(css, /min-height: var\(--control-h-lg\)/,
    'высота кнопки задана мимо токена');
  const tokens = readFileSync(new URL('../../css/tokens.css', import.meta.url), 'utf8');
  const size = tokens.match(/--control-h-lg:\s*(\d+)px/);
  assert.ok(size, 'токен --control-h-lg не объявлен');
  assert.ok(Number(size[1]) >= 44,
    `цель нажатия ${size[1]}px меньше комфортных 44px`);
});
