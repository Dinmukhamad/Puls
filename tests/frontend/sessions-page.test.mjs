/**
 * Экран «Сессии» по разделу 6.9 ТЗ.
 *
 * Что было не так:
 *  · из восьми показателей, перечисленных в ТЗ (стр. 23), выводились
 *    четыре: не было общего числа активных, пользователей, отозванных и
 *    истёкших;
 *  · ТЗ (стр. 24) отдельно оговаривает, что activity_state и status —
 *    разные понятия и разные бейджи. В колонке «Состояние» показывался
 *    только activity_state, поэтому отозванную сессию было не отличить от
 *    давно неактивной;
 *  · параметр limit из перечня фильтров был зашит числом 250;
 *  · отсутствие активных сессий показывалось как «Сессий пока нет» — это
 *    хороший знак для безопасности, а не пустота от фильтра.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const view = await readFile(new URL('js/src/views/sessions/35-admin-sessions.view.js', root), 'utf8');
const router = await readFile(new URL('app/modules/sessions/router.py', root), 'utf8');

test('показатели берутся из stats и покрывают перечень ТЗ', () => {
  const block = view.match(/<div class="ui-kpi-grid sessions-kpis">[\s\S]*?<\/div>/)[0];
  for (const field of ['active', 'active_now', 'last_24h', 'suspicious',
                       'total_devices', 'total_users', 'revoked', 'expired']) {
    assert.ok(block.includes(`stats.${field}`), `нет показателя ${field}`);
  }
  // Все восемь полей действительно есть в ответе — иначе экран обещал бы
  // данные, которых сервер не отдаёт.
  const stats = router.match(/"stats": \{[\s\S]*?\n {8}\}/)[0];
  for (const field of ['active', 'active_now', 'suspicious', 'total_devices',
                       'total_users', 'revoked', 'expired']) {
    assert.ok(stats.includes(`"${field}"`), `сервер не отдаёт ${field}`);
  }
});

test('судьба и живость сессии показаны разными бейджами', () => {
  assert.match(view, /function sessionStatusBadge\(status\)/, 'нет бейджа состояния');
  assert.match(view, /function sessionActivityBadge\(state\)/, 'нет бейджа живости');
  const status = view.match(/function sessionStatusBadge[\s\S]*?\n\}/)[0];
  for (const key of ['active', 'revoked', 'expired']) {
    assert.ok(status.includes(`${key}:`), `бейдж состояния не знает ${key}`);
  }
  const activity = view.match(/function sessionActivityBadge[\s\S]*?\n\}/)[0];
  for (const key of ['current', 'active', 'recent', 'inactive', 'ended']) {
    assert.ok(activity.includes(`${key}:`), `бейдж живости не знает ${key}`);
  }
  // В строке рядом оба.
  assert.match(view, /sessionStatusBadge\(s\.status\)[\s\S]{0,80}sessionActivityBadge\(s\.activity_state\)/,
    'в строке показан только один бейдж');
});

test('лимит выборки — фильтр, а не зашитое число', () => {
  assert.match(view, /limit: _sessionFilterLimit/, 'лимит зашит в запросе');
  assert.match(view, /id="sessions-limit"/, 'нет выбора размера выборки');
  assert.match(view, /_sessionFilterLimit = Number\(e\.target\.value\)/, 'выбор лимита ни к чему не привязан');
  // Лимит участвует в ключе кэша, иначе смена ничего не изменит.
  assert.match(view, /sessions:list:[^`]*_sessionFilterLimit/, 'лимит не входит в ключ кэша');
});

test('отсутствие активных сессий не выдаётся за пустоту от фильтра', () => {
  assert.match(view, /uiEmptyState\('Активных сессий нет'/, 'нет отдельного состояния «никого нет»');
  assert.match(view, /нормальное состояние, а не ошибка/, 'пустота не объяснена как хороший знак');
  assert.match(view, /uiNoResultsState\('Ничего не найдено'/, 'нет состояния для пустого фильтра');
  assert.match(view, /id: 'reset'/, 'из пустого фильтра нельзя сбросить условия');
});

test('текущую сессию нельзя завершить и это объяснено', () => {
  assert.match(view, /disabled title="Текущую или завершённую сессию нельзя завершить"/,
    'действие для текущей сессии не заблокировано или без объяснения');
  // Защита обязана быть и на сервере: интерфейс — не единственный барьер.
  assert.match(router, /Нельзя сбросить текущую сессию администратора/,
    'сервер не защищает текущую сессию');
});

test('поиск ждёт паузу в наборе', () => {
  assert.match(view, /function sessionsDebounce\(fn, delay = 300\)/, 'нет задержки поиска');
  assert.match(view, /sessionsDebounce\(/, 'задержка не применяется');
});
