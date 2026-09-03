/**
 * «Расчёт периода» (6.8) и «Аналитика» (6.7) ТЗ.
 *
 * Что было не так:
 *  · на «Расчёте периода» не было полосы статуса: после перезагрузки страница
 *    показывала пустую форму, хотя файлы лежат в БД и переживают редеплой;
 *  · кнопки «Загрузить файлы» и «Рассчитать» были всегда активны и объясняли
 *    отказ уже после нажатия, хотя ТЗ (стр. 22) требует блокировать их до
 *    выполнения условий, включая «конец периода не раньше начала»;
 *  · в «Аналитике» из перечня Reset/Export/Refresh (стр. 19) была только
 *    выгрузка, а панель вкладок не имела role="tabpanel".
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const report = await readFile(new URL('js/src/views/reports/40-period-report.view.js', root), 'utf8');
const analytics = await readFile(new URL('js/src/views/reports/41-analytics.view.js', root), 'utf8');
const service = await readFile(new URL('app/modules/reports/service.py', root), 'utf8');
const schemas = await readFile(new URL('app/modules/reports/schemas.py', root), 'utf8');

test('полоса статуса показывает только то, что отдаёт API', () => {
  assert.match(report, /function prStatusStrip\(status\)/, 'нет полосы статуса');
  const fn = report.match(/function prStatusStrip[\s\S]*?\n  \}/)[0];
  // upload_status отдаёт filename и uploaded_at по каждому файлу — и всё.
  const payload = service.match(/return \{\n\s+"monthly":[\s\S]*?\n {4}\}/)[0];
  assert.match(payload, /"filename"/);
  assert.match(payload, /"uploaded_at"/);
  assert.ok(fn.includes('f.filename'), 'имя файла не показывается');
  assert.ok(fn.includes('f.uploaded_at'), 'время загрузки не показывается');
  // Даты сохранённого расчёта в этом ответе нет — её нельзя выдумывать.
  assert.ok(!/saved_at|last_saved|Отчёт сохранён/.test(fn),
    'полоса обещает данные о сохранённом расчёте, которых API не отдаёт');
});

test('действия заблокированы до выполнения условий ТЗ', () => {
  const fn = report.match(/function prSyncActions\(host\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /uploadBtn\.disabled = !ready/, 'загрузка не блокируется');
  assert.match(fn, /start <= end/, 'не проверяется, что конец не раньше начала');
  assert.match(fn, /Дата окончания не может быть раньше начала/, 'причина отказа не названа');
  assert.match(fn, /Укажите обе даты периода/, 'нет подсказки про даты');
  assert.match(fn, /Выберите оба файла/, 'нет подсказки про файлы');
  // Пересчёт на каждое изменение, иначе кнопка застынет.
  for (const trigger of ['#pr-start-date', 'accept(input.files[0]); prSyncActions']) {
    assert.ok(report.includes(trigger), `доступность не пересчитывается: ${trigger}`);
  }
});

test('таблица расчёта опирается на поля PeriodSummaryOut', () => {
  // Набор полей — источник истины; если схема изменится, тест это заметит.
  const metrics = schemas.match(/class OperatorMetricsOut[\s\S]*?\n\n/)[0];
  for (const field of ['quality_avg', 'total_hours', 'base_hours', 'calls_total', 'kvz',
                       'efficiency_percent', 'penalty_minutes', 'final_points',
                       'individual_norm_hours', 'norm_completion_percent']) {
    assert.ok(metrics.includes(`${field}:`), `схема потеряла поле ${field}`);
  }
  const warnings = schemas.match(/class PeriodWarningsOut[\s\S]*?\n\n/)[0];
  for (const group of ['site_only', 'file_only', 'norm_warnings',
                       'no_quality', 'no_base_hours', 'ignored_service_rows']) {
    assert.ok(warnings.includes(`${group}:`), `схема потеряла группу предупреждений ${group}`);
  }
});

test('в «Аналитике» есть сброс, выгрузка и обновление', () => {
  for (const [id, what] of [['an2-reset', 'сброс'], ['an2-export', 'выгрузка'], ['an2-refresh', 'обновление']]) {
    assert.ok(analytics.includes(`id="${id}"`), `нет кнопки: ${what}`);
  }
  const refresh = analytics.match(/#an2-refresh'\)\?\.addEventListener[\s\S]*?\n  \}\);/)[0];
  assert.match(refresh, /swrInvalidate\('analytics:'\)/, 'обновление отдаёт данные из кэша');
  // ТЗ (стр. 20): «Refresh не сбрасывает view» — вкладка и фильтры остаются.
  assert.doesNotMatch(refresh, /AN_STATE\.tab =(?!=)/, 'обновление меняет вкладку');
  assert.doesNotMatch(refresh, /AN_STATE\.preset =(?!=)/, 'обновление сбрасывает период');

  const reset = analytics.match(/#an2-reset'\)\?\.addEventListener[\s\S]*?\n  \}\);/)[0];
  assert.match(reset, /AN_STATE\.preset = '30d'/, 'сброс не возвращает период');
  assert.match(reset, /AN_STATE\.groupId = null/, 'сброс не возвращает группу');
  assert.match(reset, /weekdays = \[0, 1, 2, 3, 4, 5, 6\]/, 'сброс не возвращает дни недели');
  assert.doesNotMatch(reset, /AN_STATE\.tab =(?!=)/, 'сброс меняет выбранную вкладку');
});

test('шаблон вкладок «Аналитики» собран полностью', () => {
  assert.match(analytics, /id="an2-tab-\$\{t\.key\}"/, 'у вкладок нет идентификаторов');
  assert.match(analytics, /aria-controls="an2-body"/, 'вкладки не связаны с панелью');
  assert.match(analytics, /id="an2-body" role="tabpanel" aria-labelledby="an2-tab-\$\{AN_STATE\.tab\}"/,
    'панель без роли или без связи с активной вкладкой');
});
