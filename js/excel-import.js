/**
 * excel-import.js
 *
 * Импортирует показатели конкурса из Excel строго за выбранный период.
 * Автоматически обновляет только: выработку, эффективность, качество, КВЗ
 * и штрафные баллы за опоздания. Остальные ручные показатели сохраняются.
 */

'use strict';

const IMPORT_SHEETS = {
  work: ['отработанные часы'],
  efficiency: ['эффективность'],
  calls: ['звонки'],
  quality: ['качество звонков'],
  late: ['штрафы'],
  trainings: ['тренинги'],
  tech: ['тех. сбои', 'тех сбои', 'технические сбои'],
  offline: ['офлайн активность'],
};

let PENDING_IMPORT = null;

function norm(str) {
  return String(str || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v)
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.+-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseStrictNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function escapeImportHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function ymd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateRu(keyOrDate) {
  const date = typeof keyOrDate === 'string' ? parseInputDate(keyOrDate, '') : keyOrDate;
  if (!date) return String(keyOrDate || '');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatDateRange(keys) {
  if (!keys.length) return 'нет дат';
  if (keys.length === 1) return formatDateRu(keys[0]);
  return `${formatDateRu(keys[0])} - ${formatDateRu(keys[keys.length - 1])}`;
}

function parseInputDate(value, fieldName = 'Дата') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    if (fieldName) throw new Error(`${fieldName}: выберите дату.`);
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    if (fieldName) throw new Error(`${fieldName}: некорректная дата.`);
    return null;
  }
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKeysInRange(startDate, endDate) {
  const keys = [];
  for (let date = new Date(startDate); date <= endDate; date = addDays(date, 1)) {
    keys.push(ymd(date));
  }
  return keys;
}

function parseHeaderDate(value, fallbackYear) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return ymd(value);

  if (typeof value === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) return ymd(new Date(parsed.y, parsed.m - 1, parsed.d));
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return ymd(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));

  match = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = match[3] ? Number(match[3]) : fallbackYear;
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return ymd(date);
  }

  return null;
}

function getSiteOperators() {
  const rows = [];
  FACULTIES.forEach((faculty, facIdx) => {
    (faculty.operators || []).forEach((name, opIdx) => {
      rows.push({ facIdx, opIdx, name, key: norm(name), faculty: faculty.name });
    });
  });
  return rows;
}

function findOperator(rawName) {
  const target = norm(rawName);
  return getSiteOperators().find(operator => operator.key === target) || null;
}

function findMetricIndexByAliases(aliases) {
  const needles = aliases.map(norm);
  return METRICS.findIndex(metric => {
    const label = norm(metric.label);
    return metric.type !== 'score' && needles.some(needle => label.includes(needle));
  });
}

function ensureAutoMetric(aliases, label, type = 'metric') {
  let idx = findMetricIndexByAliases(aliases);
  if (idx >= 0) {
    METRICS[idx].type = type;
    if (norm(METRICS[idx].label).includes('опозд')) METRICS[idx].label = label;
    return idx;
  }

  const insertAt = typeof getScoreMetricIndex === 'function' ? getScoreMetricIndex() : METRICS.length;
  METRICS.splice(insertAt, 0, { label, type });
  WEEKLY_DATA[0].forEach(facRows => { facRows.forEach(row => row.splice(insertAt, 0, 0)); });
  return insertAt;
}

function getImportMetricIndexes() {
  return {
    quality: ensureAutoMetric(['качество'], 'Качество', 'metric'),
    work: ensureAutoMetric(['выработ'], 'Выработка', 'metric'),
    efficiency: ensureAutoMetric(['эфф'], 'Эфф. %', 'metric'),
    kvz: ensureAutoMetric(['квз'], 'КВЗ', 'metric'),
    late: ensureAutoMetric(['опозд'], 'Опоздания', 'penalty'),
    score: typeof getScoreMetricIndex === 'function' ? getScoreMetricIndex() : METRICS.findIndex(m => m.type === 'score'),
  };
}

function recalcScore(metricRow, metricIndexes) {
  if (metricIndexes.score < 0) return;
  let total = 0;
  METRICS.forEach((metric, idx) => {
    if (idx === metricIndexes.score || metric.type === 'score') return;
    const value = Number(metricRow[idx]) || 0;
    total += metric.type === 'penalty' ? -Math.abs(value) : value;
  });
  metricRow[metricIndexes.score] = round2(total);
}

function setImportStatus(message, type = 'info', html = false) {
  const el = document.getElementById('import-status');
  if (!el) return;

  if (!message) {
    el.textContent = '';
    el.style.display = 'none';
    el.setAttribute('hidden', '');
    return;
  }

  el.className = `import-status import-status--${type}`;
  if (html) el.innerHTML = message;
  else el.textContent = message;
  el.style.display = 'block';
  el.removeAttribute('hidden');
}

function findSheetName(workbook, aliases) {
  const wanted = aliases.map(alias => norm(alias));
  return workbook.SheetNames.find(sheetName => wanted.includes(norm(sheetName))) || null;
}

function detectTableLayout(rows, fallbackYear) {
  let best = null;

  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    let nameCol = -1;
    let normCol = -1;
    const dateCols = new Map();

    for (let c = 0; c < row.length; c++) {
      const cellNorm = norm(row[c]);
      if (nameCol < 0 && (cellNorm === 'оператор' || cellNorm === 'фио' || cellNorm === 'фио оператора')) nameCol = c;
      if (normCol < 0 && cellNorm.includes('норма') && cellNorm.includes('час')) normCol = c;

      const key = parseHeaderDate(row[c], fallbackYear);
      if (key) dateCols.set(key, c);
    }

    if (nameCol < 0 || dateCols.size === 0) continue;
    const candidate = { headerRow: r, dataStartRow: r + 1, nameCol, normCol, dateCols };
    if (!best || candidate.dateCols.size > best.dateCols.size) best = candidate;
  }

  return best;
}

function isSummaryName(name) {
  const value = norm(name);
  return !value || value === 'итого' || value === 'всего' || value.includes('total');
}

function makeOperatorRows(sheetInfo) {
  if (!sheetInfo) return new Map();

  const rowsByName = new Map();
  for (let r = sheetInfo.layout.dataStartRow; r < sheetInfo.rows.length; r++) {
    const row = sheetInfo.rows[r] || [];
    const name = String(row[sheetInfo.layout.nameCol] ?? '').trim();
    if (!name || isSummaryName(name)) continue;

    const key = norm(name);
    if (!rowsByName.has(key)) rowsByName.set(key, { row, name, rowNumber: r + 1 });
  }

  return rowsByName;
}

function readSheet(workbook, key, fallbackYear, required = true) {
  const sheetName = findSheetName(workbook, IMPORT_SHEETS[key]);
  if (!sheetName) {
    if (required) throw new Error(`В файле нет листа «${IMPORT_SHEETS[key][0]}».`);
    return null;
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  const layout = detectTableLayout(rows, fallbackYear);
  if (!layout) {
    if (required) throw new Error(`Не удалось найти строку заголовков с оператором/ФИО и датами на листе «${sheetName}».`);
    return null;
  }

  if (key === 'work' && layout.normCol < 0) {
    throw new Error(`На листе «${sheetName}» не найдена колонка «Норма часов (ч)».`);
  }

  const info = { key, sheetName, rows, layout };
  info.operators = makeOperatorRows(info);
  return info;
}

function sumSheetDates(sheetInfo, operatorKey, dateKeys) {
  if (!sheetInfo) return 0;
  const entry = sheetInfo.operators.get(operatorKey);
  if (!entry) return 0;

  return dateKeys.reduce((sum, key) => {
    const col = sheetInfo.layout.dateCols.get(key);
    return col === undefined ? sum : sum + toNum(entry.row[col]);
  }, 0);
}

function readQualityScores(sheetInfo, operatorKey, dateKeys, reportErrors) {
  const entry = sheetInfo.operators.get(operatorKey);
  if (!entry) return [];

  const scores = [];
  dateKeys.forEach(key => {
    const col = sheetInfo.layout.dateCols.get(key);
    if (col === undefined) return;
    const raw = entry.row[col];
    if (raw === null || raw === undefined || raw === '') return;

    String(raw).split(/[;,]/).forEach(piece => {
      const value = piece.trim();
      if (value === '') return;
      const num = parseStrictNum(value);
      if (num !== null) scores.push(num);
      else reportErrors.push(`${entry.name}, ${formatDateRu(key)}: неверная оценка «${value}».`);
    });
  });

  return scores;
}

function ensureMetricRow(facIdx, opIdx) {
  if (!WEEKLY_DATA[0]) WEEKLY_DATA[0] = [];
  if (!WEEKLY_DATA[0][facIdx]) WEEKLY_DATA[0][facIdx] = [];
  if (!WEEKLY_DATA[0][facIdx][opIdx]) WEEKLY_DATA[0][facIdx][opIdx] = Array(METRICS.length).fill(0);
  while (WEEKLY_DATA[0][facIdx][opIdx].length < METRICS.length) WEEKLY_DATA[0][facIdx][opIdx].push(0);
  return WEEKLY_DATA[0][facIdx][opIdx];
}

function buildPreviewReport(importData) {
  const siteOptions = getSiteOperators().map(operator => (
    `<option value="${operator.facIdx}:${operator.opIdx}">${escapeImportHtml(operator.name)} (${escapeImportHtml(operator.faculty)})</option>`
  )).join('');
  const warnItems = importData.warnings.map(item => `<li>${escapeImportHtml(item)}</li>`).join('');
  const errorItems = importData.errors.slice(0, 20).map(item => `<li>${escapeImportHtml(item)}</li>`).join('');
  const rows = importData.rows.map(row => {
    const matchText = row.match
      ? escapeImportHtml(row.match.name)
      : `<select class="import-map-select" data-row-id="${row.id}">
          <option value="">Не сопоставлять</option>${siteOptions}
        </select>`;
    return `
      <tr>
        <td><input type="checkbox" class="import-row-check" data-row-id="${row.id}" ${row.match ? 'checked' : ''}></td>
        <td>${escapeImportHtml(row.excelName)}</td>
        <td>${matchText}</td>
        <td>${escapeImportHtml(row.datesLabel)}</td>
        <td>${row.worked}</td>
        <td>${row.cleanHours}</td>
        <td>${row.hoursScoreStatus || row.hoursScore}</td>
        <td>${row.efficiencyStatus || row.efficiency}</td>
        <td>${row.qualityStatus || row.quality}</td>
        <td>${row.kvzStatus || row.kvz}</td>
        <td>${row.lateAmount} / ${row.lateMinutes} / -${row.latePenaltyPoints}</td>
      </tr>
    `;
  }).join('');
  const missingSite = importData.missingSiteOperators.slice(0, 16).map(escapeImportHtml).join(', ');

  return `
    <div class="import-report">
      <div class="import-report-title">Предпросмотр импорта: ${importData.rows.length} строк из Excel</div>
      <div class="import-report-list">
        <div><b>Период:</b> ${escapeImportHtml(importData.selectedPeriod)}</div>
        <div><b>Посчитанные даты:</b> ${escapeImportHtml(importData.usedDates)}</div>
        <div><b>Листы:</b> ${escapeImportHtml(importData.sheetNames)}</div>
      </div>
      ${warnItems ? `<ul class="import-report-warnings">${warnItems}</ul>` : ''}
      ${errorItems ? `<ul class="import-report-errors">${errorItems}</ul>` : ''}
      ${missingSite ? `<div class="import-report-note"><b>Есть на сайте, но нет в Excel:</b> ${missingSite}${importData.missingSiteOperators.length > 16 ? ' ...' : ''}</div>` : ''}
      <div class="import-preview-wrap">
        <table class="import-preview-table import-preview-table-wide">
          <thead>
            <tr>
              <th>Вкл.</th><th>ФИО Excel</th><th>Участник сайта</th><th>Даты</th>
              <th>W</th><th>B</th><th>Выр.</th><th>Эфф.</th><th>Кач.</th><th>КВЗ</th><th>Опоздания</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="import-actions">
        <button class="admin-popover-submit import-confirm-btn" type="button" onclick="confirmPendingImport()">Подтвердить импорт</button>
        <button class="editor-btn ghost" type="button" onclick="cancelPendingImport()">Отмена</button>
      </div>
    </div>
  `;
}

function buildFinalReport(report) {
  const warnItems = report.warnings.map(item => `<li>${escapeImportHtml(item)}</li>`).join('');
  const skipped = report.skippedRows.slice(0, 16).map(escapeImportHtml).join(', ');
  return `
    <div class="import-report">
      <div class="import-report-title">Готово: обновлено ${report.updatedCount} операторов</div>
      <div class="import-report-list">
        <div><b>Период:</b> ${escapeImportHtml(report.selectedPeriod)}</div>
        <div><b>Посчитанные даты:</b> ${escapeImportHtml(report.usedDates)}</div>
      </div>
      ${warnItems ? `<ul class="import-report-warnings">${warnItems}</ul>` : ''}
      ${skipped ? `<div class="import-report-note"><b>Не обновлены:</b> ${skipped}${report.skippedRows.length > 16 ? ' ...' : ''}</div>` : ''}
    </div>
  `;
}

function collectSheetDateIntersection(sheets, selectedDateKeys) {
  return selectedDateKeys.filter(key => sheets.every(sheet => sheet.layout.dateCols.has(key)));
}

function prepareImportData(workbook, startDate, endDate) {
  const fallbackYear = startDate.getFullYear();
  const workSheet = readSheet(workbook, 'work', fallbackYear, true);
  const efficiencySheet = readSheet(workbook, 'efficiency', fallbackYear, true);
  const callsSheet = readSheet(workbook, 'calls', fallbackYear, true);
  const qualitySheet = readSheet(workbook, 'quality', fallbackYear, true);
  const lateSheet = readSheet(workbook, 'late', fallbackYear, true);
  const trainingsSheet = readSheet(workbook, 'trainings', fallbackYear, false);
  const techSheet = readSheet(workbook, 'tech', fallbackYear, false);
  const offlineSheet = readSheet(workbook, 'offline', fallbackYear, false);

  const selectedDateKeys = dateKeysInRange(startDate, endDate);
  const usedDateKeys = collectSheetDateIntersection(
    [workSheet, efficiencySheet, callsSheet, qualitySheet, lateSheet],
    selectedDateKeys
  );

  if (!usedDateKeys.length) {
    const availableWorkDates = [...workSheet.layout.dateCols.keys()].sort();
    throw new Error(
      `В выбранном периоде нет дат, которые одновременно найдены на обязательных листах. ` +
      `Даты на листе «${workSheet.sheetName}»: ${formatDateRange(availableWorkDates)}.`
    );
  }

  const warnings = [];
  const errors = [];
  if (usedDateKeys.length < selectedDateKeys.length) {
    const missed = selectedDateKeys.filter(key => !usedDateKeys.includes(key));
    warnings.push(`В Excel найдена только часть периода. Посчитаны даты ${formatDateRange(usedDateKeys)}; пропущены ${formatDateRange(missed)}.`);
  }
  if (!trainingsSheet) warnings.push('Лист «Тренинги» не найден: тренинги посчитаны как 0.');
  if (!techSheet) warnings.push('Лист «Тех. сбои» не найден: тех. сбои посчитаны как 0.');
  if (!offlineSheet) warnings.push('Лист «Офлайн активность» не найден: офлайн активность посчитана как 0.');

  const rows = [];
  const siteKeysInExcel = new Set();
  let rowId = 0;

  for (const [operatorKey, workEntry] of workSheet.operators.entries()) {
    const monthlyNorm = toNum(workEntry.row[workSheet.layout.normCol]);
    const targetNorm = monthlyNorm / 4;
    const worked = sumSheetDates(workSheet, operatorKey, usedDateKeys);
    const trainings = sumSheetDates(trainingsSheet, operatorKey, usedDateKeys);
    const tech = sumSheetDates(techSheet, operatorKey, usedDateKeys);
    const offline = sumSheetDates(offlineSheet, operatorKey, usedDateKeys);
    const cleanHours = Math.max(worked - trainings - tech - offline, 0);
    const effectiveHours = sumSheetDates(efficiencySheet, operatorKey, usedDateKeys);
    const calls = sumSheetDates(callsSheet, operatorKey, usedDateKeys);
    const qualityScores = readQualityScores(qualitySheet, operatorKey, usedDateKeys, errors);
    const lateAmount = sumSheetDates(lateSheet, operatorKey, usedDateKeys);
    const lateMinutes = lateAmount / 50;
    const latePenaltyPoints = lateMinutes * 5;
    const match = findOperator(workEntry.name);

    if (match) siteKeysInExcel.add(match.key);
    if (targetNorm <= 0) warnings.push(`${workEntry.name}: нет нормы часов, выработка не будет обновлена.`);
    if (cleanHours <= 0) warnings.push(`${workEntry.name}: чистые часы B = 0, эффективность и КВЗ не будут обновлены.`);
    if (!qualityScores.length) warnings.push(`${workEntry.name}: нет оценок качества за выбранный период.`);

    rows.push({
      id: String(rowId++),
      excelKey: operatorKey,
      excelName: workEntry.name,
      match,
      datesLabel: formatDateRange(usedDateKeys),
      worked: round2(worked),
      trainings: round2(trainings),
      tech: round2(tech),
      offline: round2(offline),
      cleanHours: round2(cleanHours),
      targetNorm: round2(targetNorm),
      hoursScore: targetNorm > 0 ? round2(worked / targetNorm * 100) : null,
      hoursScoreStatus: targetNorm > 0 ? '' : 'Нет нормы',
      effectiveHours: round2(effectiveHours),
      efficiency: cleanHours > 0 ? round2(effectiveHours / cleanHours * 100) : null,
      efficiencyStatus: cleanHours > 0 ? '' : 'Нет данных',
      quality: qualityScores.length ? round2(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length) : null,
      qualityCount: qualityScores.length,
      qualityStatus: qualityScores.length ? '' : 'Нет оценок',
      calls: round2(calls),
      kvz: cleanHours > 0 ? round2(calls / cleanHours) : null,
      kvzStatus: cleanHours > 0 ? '' : 'Нет данных',
      lateAmount: round2(lateAmount),
      lateMinutes: round2(lateMinutes),
      latePenaltyPoints: round2(latePenaltyPoints),
      dailyRows: usedDateKeys.map(dateKey => {
        const dayWorked = sumSheetDates(workSheet, operatorKey, [dateKey]);
        const dayTrainings = sumSheetDates(trainingsSheet, operatorKey, [dateKey]);
        const dayTech = sumSheetDates(techSheet, operatorKey, [dateKey]);
        const dayOffline = sumSheetDates(offlineSheet, operatorKey, [dateKey]);
        const dayClean = Math.max(dayWorked - dayTrainings - dayTech - dayOffline, 0);
        const dayEffective = sumSheetDates(efficiencySheet, operatorKey, [dateKey]);
        const dayCalls = sumSheetDates(callsSheet, operatorKey, [dateKey]);
        const dayLateAmount = sumSheetDates(lateSheet, operatorKey, [dateKey]);
        return {
          key: dateKey,
          label: formatDateRu(dateKey),
          baseWorked: round2(dayClean),
          extraHours: round2(dayTrainings + dayTech + dayOffline),
          actualFact: round2(dayWorked),
          effectiveHours: round2(dayEffective),
          calls: round2(dayCalls),
          lateAmount: round2(dayLateAmount),
          lateMinutes: round2(dayLateAmount / 50),
        };
      }),
    });
  }

  const missingSiteOperators = getSiteOperators()
    .filter(operator => !siteKeysInExcel.has(operator.key))
    .map(operator => operator.name);

  return {
    selectedPeriod: `${formatDateRu(startDate)} - ${formatDateRu(endDate)}`,
    usedDates: formatDateRange(usedDateKeys),
    usedDateKeys,
    sheetNames: [
      workSheet.sheetName,
      efficiencySheet.sheetName,
      callsSheet.sheetName,
      qualitySheet.sheetName,
      lateSheet.sheetName,
      trainingsSheet?.sheetName,
      techSheet?.sheetName,
      offlineSheet?.sheetName,
    ].filter(Boolean).join(', '),
    rows,
    warnings,
    errors,
    missingSiteOperators,
  };
}

async function parseExcelForPreview(file) {
  if (typeof XLSX === 'undefined') {
    setImportStatus('Библиотека Excel не загрузилась. Обновите страницу и попробуйте еще раз.', 'error');
    return;
  }
  if (typeof requireAdmin === 'function' && !requireAdmin()) return;

  try {
    const startInput = document.getElementById('excel-period-start');
    const endInput = document.getElementById('excel-period-end');
    const startDate = parseInputDate(startInput?.value, 'Начало периода');
    const endDate = parseInputDate(endInput?.value, 'Конец периода');
    if (startDate > endDate) throw new Error('Начало периода не может быть позже конца периода.');

    setImportStatus('Читаю Excel и готовлю предпросмотр...');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

    if (typeof normalizeEditableData === 'function') normalizeEditableData();
    const importData = prepareImportData(workbook, startDate, endDate);
    if (!importData.rows.length) throw new Error('В файле не найдено строк операторов для импорта.');

    PENDING_IMPORT = importData;
    setImportStatus(buildPreviewReport(importData), importData.warnings.length || importData.errors.length ? 'warn' : 'info', true);
  } catch (err) {
    console.error('[excel-import]', err);
    PENDING_IMPORT = null;
    setImportStatus(`Ошибка импорта: ${err.message}`, 'error');
  }
}

function getSelectedImportTargets() {
  if (!PENDING_IMPORT) return [];
  const targets = [];
  const checked = new Set([...document.querySelectorAll('.import-row-check:checked')].map(input => input.dataset.rowId));

  PENDING_IMPORT.rows.forEach(row => {
    if (!checked.has(row.id)) return;
    let target = row.match ? { facIdx: row.match.facIdx, opIdx: row.match.opIdx, name: row.match.name } : null;
    const manual = document.querySelector(`.import-map-select[data-row-id="${row.id}"]`)?.value || '';
    if (manual) {
      const [facIdx, opIdx] = manual.split(':').map(Number);
      const name = FACULTIES[facIdx]?.operators?.[opIdx];
      if (name) target = { facIdx, opIdx, name };
    }
    if (target) targets.push({ row, target });
  });

  return targets;
}

async function confirmPendingImport() {
  if (!PENDING_IMPORT) {
    setImportStatus('Нет подготовленного предпросмотра. Сначала выберите файл и нажмите «Предпросмотр».', 'error');
    return;
  }
  if (typeof requireAdmin === 'function' && !requireAdmin()) return;

  try {
    const selected = getSelectedImportTargets();
    if (!selected.length) throw new Error('Выберите хотя бы одну строку для обновления или сопоставьте ФИО вручную.');

    const metricIndexes = getImportMetricIndexes();
    const dailyImport = {
      period: PENDING_IMPORT.selectedPeriod,
      dateKeys: PENDING_IMPORT.usedDateKeys,
      generatedAt: new Date().toISOString(),
      operators: {},
    };
    const updatedKeys = new Set();

    selected.forEach(({ row, target }) => {
      const metricRow = ensureMetricRow(target.facIdx, target.opIdx);
      if (row.hoursScore !== null) metricRow[metricIndexes.work] = row.hoursScore;
      if (row.efficiency !== null) metricRow[metricIndexes.efficiency] = row.efficiency;
      if (row.quality !== null) metricRow[metricIndexes.quality] = row.quality;
      if (row.kvz !== null) metricRow[metricIndexes.kvz] = row.kvz;
      metricRow[metricIndexes.late] = row.latePenaltyPoints;
      recalcScore(metricRow, metricIndexes);

      const operatorKey = norm(target.name);
      updatedKeys.add(operatorKey);
      dailyImport.operators[operatorKey] = {
        operator: target.name,
        dates: row.dailyRows,
        importSummary: {
          worked: row.worked,
          cleanHours: row.cleanHours,
          qualityCount: row.qualityCount,
          calls: row.calls,
          lateAmount: row.lateAmount,
          lateMinutes: row.lateMinutes,
          latePenaltyPoints: row.latePenaltyPoints,
        },
      };
    });

    if (typeof setDailyImportData === 'function') setDailyImportData(dailyImport);
    else {
      try { localStorage.setItem('divergentContestDailyImport', JSON.stringify(dailyImport)); } catch {}
    }

    await saveEditableData();
    await refreshDashboard();
    renderEditor();

    const skippedRows = PENDING_IMPORT.rows
      .filter(row => !selected.some(item => item.row.id === row.id))
      .map(row => row.excelName);
    const report = {
      updatedCount: updatedKeys.size,
      selectedPeriod: PENDING_IMPORT.selectedPeriod,
      usedDates: PENDING_IMPORT.usedDates,
      warnings: PENDING_IMPORT.warnings,
      skippedRows,
    };

    PENDING_IMPORT = null;
    setImportStatus(buildFinalReport(report), report.warnings.length || skippedRows.length ? 'warn' : 'success', true);
  } catch (err) {
    console.error('[excel-import-confirm]', err);
    setImportStatus(`Ошибка применения: ${err.message}`, 'error');
  }
}

function cancelPendingImport() {
  PENDING_IMPORT = null;
  setImportStatus('Импорт отменен. Данные сайта не изменены.', 'info');
}

function setDefaultImportPeriod() {
  const startInput = document.getElementById('excel-period-start');
  const endInput = document.getElementById('excel-period-end');
  if (!startInput || !endInput || startInput.value || endInput.value) return;

  const today = new Date();
  const weekDay = today.getDay() || 7;
  const monday = addDays(today, 1 - weekDay);
  const sunday = addDays(monday, 6);

  startInput.value = ymd(monday);
  endInput.value = ymd(sunday);
}

function initExcelImport() {
  const fileInput = document.getElementById('excel-file-input');
  const importBtn = document.getElementById('excel-import-btn');
  if (!fileInput || !importBtn) return;

  setDefaultImportPeriod();
  importBtn.textContent = 'Предпросмотр';

  importBtn.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file) {
      setImportStatus('Выберите файл Excel (.xlsx или .xls).', 'error');
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'ods'].includes(ext)) {
      setImportStatus('Поддерживаются только .xlsx, .xls и .ods.', 'error');
      return;
    }

    parseExcelForPreview(file);
  });

  fileInput.addEventListener('change', () => {
    const nameEl = document.getElementById('excel-file-name');
    if (nameEl) nameEl.textContent = fileInput.files[0]?.name || 'Выберите файл...';
    PENDING_IMPORT = null;
    setImportStatus('');
  });
}

document.addEventListener('DOMContentLoaded', initExcelImport);
