/**
 * Экран «Группы» по разделу 6.6 ТЗ.
 *
 * Главное требование раздела — обязательная оговорка на стр. 17: GroupRead
 * содержит только id, name, status, operator_count, created_at, updated_at.
 * Поля «Код» и «Подгруппы» есть на макете, но их нет в API, и ТЗ прямо
 * запрещает заполнять их выдуманными значениями. Тест следит, чтобы они не
 * появились, а KPI считались по тому же ответу.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const view = await readFile(new URL('js/src/views/coins/32-groups-page-2026.view.js', root), 'utf8');
const router = await readFile(new URL('app/modules/groups/router.py', root), 'utf8');

test('экран не показывает полей, которых нет в GroupRead', () => {
  // Схема ответа — источник истины для набора полей.
  const schema = router.match(/class GroupRead\(BaseModel\):[\s\S]*?model_config/)[0];
  const fields = [...schema.matchAll(/^\s{4}([a-z_]+):/gm)].map(m => m[1]);
  assert.deepEqual(fields.sort(),
    ['created_at', 'id', 'name', 'operator_count', 'status', 'updated_at'],
    'схема GroupRead изменилась — пересмотрите набор колонок экрана');

  // Проверяем разметку, а не текст файла: объяснение оговорки живёт в
  // комментарии и не должно ронять тест.
  const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['Код', 'Подгруппы', 'subgroup', 'group_code']) {
    assert.ok(!code.includes(forbidden),
      `на экране появилось поле «${forbidden}», которого нет в API`);
  }
});

test('KPI считаются по ответу API, а не задаются числами', () => {
  const fn = view.match(/function renderGroups\(\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /all\.filter\(g => g\.status === 'active'\)\.length/, 'счёт активных не из данных');
  assert.match(fn, /reduce\(\(sum, g\) => sum \+ Number\(g\.operator_count/, 'сумма операторов не из данных');
  // Ни одного числа, вписанного руками в KPI.
  const kpiBlock = fn.match(/<div class="ui-kpi-grid">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(kpiBlock, /value: \d/, 'значение KPI задано числом в коде');
});

test('таблица содержит колонки из ТЗ и сортируется', () => {
  const fn = view.match(/const columns = \[[\s\S]*?\];/)[0];
  for (const label of ['Группа', 'Операторов', 'Статус', 'Дата создания', 'Обновлено', 'Действия']) {
    assert.ok(fn.includes(`'${label}'`), `нет колонки «${label}»`);
  }
  assert.match(fn, /key: 'actions', label: 'Действия', actions: true/, 'колонка действий не помечена');
  const sortable = (fn.match(/sortable: true/g) || []).length;
  assert.equal(sortable, 5, `сортируемых колонок ${sortable}, ожидалось 5`);
});

test('удаление доступно только администратору', () => {
  const fn = view.match(/function groupsRowActions[\s\S]*?\n\}/)[0];
  assert.match(fn, /STATE\.user\?\.role === 'admin'/, 'удаление показывается не только админу');
  assert.match(fn, /canDelete \? `<button class="btn-danger/, 'удаление не оформлено как разрушительное');
});

test('пустой список и отфильтрованная пустота различаются', () => {
  const fn = view.match(/const empty = hasFilters[\s\S]*?true\);/)[0];
  assert.match(fn, /uiNoResultsState/, 'нет состояния «ничего не найдено»');
  assert.match(fn, /uiEmptyState\('Группы не созданы'/, 'нет состояния пустой системы');
  assert.match(fn, /id: 'reset'/, 'из отфильтрованной пустоты нельзя сбросить фильтры');
  assert.match(fn, /id: 'create'/, 'из пустой системы нельзя создать группу');
});

test('ошибка загрузки не выдаётся за пустой список', () => {
  assert.match(view, /STATE\.groupsError && !\(STATE\.groups \|\| \[\]\)\.length/,
    'ошибка не отделена от пустоты');
  assert.match(view, /uiErrorStateFor\(STATE\.groupsError/, 'ошибка показывается без повтора');
});

test('после мутации данные перезапрашиваются', () => {
  // Мутации в старом файле делают swrInvalidate и зовут renderGroups.
  // Без этой ветки экран рисовал бы устаревший статус.
  assert.match(view, /!swrPeek\('groups:list'\)/, 'экран не замечает инвалидацию кэша');
  assert.match(view, /keepContent: true/, 'фоновое обновление очищает экран');
});
