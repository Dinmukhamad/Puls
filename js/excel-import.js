/**
 * excel-import.js
 *
 * Импортирует расчёт из отчёта Excel за выбранный период.
 * Автоматически обновляет только «Выработка» и «Эфф. %».
 * Все ручные поля, штрафы и «Итого» остаются без перезаписи.
 */

'use strict';

const IMPORT_SHEETS = {
  work: ['отработанные часы'],
  efficiency: ['эффективность'],
  trainings: ['тренинги'],
  tech: ['тех. сбои', 'тех сбои', 'технические сбои'],
  offline: ['офлайн активность'],
};

function norm(str) {
  return String(str || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/\s/g, '').replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
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
  const date = typeof keyOrDate === 'string' ? parseInputDate(keyOrDate) : keyOrDate;
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return ymd(value);
  }

  if (typeof value === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return ymd(new Date(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return ymd(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  match = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = match[3] ? Number(match[3]) : fallbackYear;
    if (year < 100) year += 2000;
    return ymd(new Date(year, month - 1, day));
  }

  return null;
}

function findOperator(rawName) {
  const target = norm(rawName);
  for (let fi = 0; fi < FACULTIES.length; fi++) {
    const operators = FACULTIES[fi].operators || [];
    for (let oi = 0; oi < operators.length; oi++) {
      if (norm(operators[oi]) === target) return { facIdx: fi, opIdx: oi, name: operators[oi] };
    }
  }
  return null;
}

function metricIndexByKeyword(keyword) {
  const needle = norm(keyword);
  return METRICS.findIndex(metric => norm(metric.label).includes(needle) && metric.type !== 'score');
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
      if (nameCol < 0 && (cellNorm === 'оператор' || cellNorm === 'фио' || cellNorm === 'фио оператора')) {
        nameCol = c;
      }
      if (normCol < 0 && cellNorm.includes('норма') && cellNorm.includes('час')) {
        normCol = c;
      }

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
    if (!rowsByName.has(key)) {
      rowsByName.set(key, { row, name, rowNumber: r + 1 });
    }
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
    if (required) throw new Error(`Не удалось найти строку заголовков с оператором и датами на листе «${sheetName}».`);
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

function ensureMetricRow(facIdx, opIdx) {
  if (!WEEKLY_DATA[0]) WEEKLY_DATA[0] = [];
  if (!WEEKLY_DATA[0][facIdx]) WEEKLY_DATA[0][facIdx] = [];
  if (!WEEKLY_DATA[0][facIdx][opIdx]) WEEKLY_DATA[0][facIdx][opIdx] = Array(METRICS.length).fill(0);
  while (WEEKLY_DATA[0][facIdx][opIdx].length < METRICS.length) {
    WEEKLY_DATA[0][facIdx][opIdx].push(0);
  }
  return WEEKLY_DATA[0][facIdx][opIdx];
}

function buildImportReport(report) {
  const warnItems = report.warnings
    .map(item => `<li>${escapeImportHtml(item)}</li>`)
    .join('');
  const missingSite = report.missingSiteOperators.slice(0, 12).map(escapeImportHtml).join(', ');
  const extraExcel = report.extraExcelOperators.slice(0, 12).map(escapeImportHtml).join(', ');
  const rows = report.preview.map(row => `
    <tr>
      <td>${escapeImportHtml(row.operator)}</td>
      <td>${row.actualFact}</td>
      <td>${row.targetNorm}</td>
      <td>${row.workScore}</td>
      <td>${row.effectiveHours}</td>
      <td>${row.baseWorked}</td>
      <td>${row.effScore}</td>
    </tr>
  `).join('');

  return `
    <div class="import-report">
      <div class="import-report-title">Готово: обновлено ${report.updatedCount} операторов</div>
      <div class="import-report-list">
        <div><b>Период:</b> ${escapeImportHtml(report.selectedPeriod)}</div>
        <div><b>Посчитанные даты:</b> ${escapeImportHtml(report.usedDates)}</div>
        <div><b>Листы:</b> ${escapeImportHtml(report.sheetNames)}</div>
      </div>
      ${warnItems ? `<ul class="import-report-warnings">${warnItems}</ul>` : ''}
      ${missingSite ? `<div class="import-report-note"><b>Есть на сайте, но нет в Excel:</b> ${missingSite}${report.missingSiteOperators.length > 12 ? ' ...' : ''}</div>` : ''}
      ${extraExcel ? `<div class="import-report-note"><b>Есть в Excel, но нет на сайте:</b> ${extraExcel}${report.extraExcelOperators.length > 12 ? ' ...' : ''}</div>` : ''}
      ${rows ? `
        <table class="import-preview-table">
          <thead>
            <tr>
              <th>Оператор</th>
              <th>Факт</th>
              <th>Норма</th>
              <th>Выр.</th>
              <th>Эфф. ч</th>
              <th>База</th>
              <th>Эфф.</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      ` : ''}
    </div>
  `;
}

async function parseExcelAndApply(file) {
  if (typeof XLSX === 'undefined') {
    setImportStatus('Библиотека Excel не загрузилась. Обновите страницу и попробуйте ещё раз.', 'error');
    return;
  }
  if (typeof requireAdmin === 'function' && !requireAdmin()) return;

  try {
    const startInput = document.getElementById('excel-period-start');
    const endInput = document.getElementById('excel-period-end');
    const startDate = parseInputDate(startInput?.value, 'Начало периода');
    const endDate = parseInputDate(endInput?.value, 'Конец периода');

    if (startDate > endDate) {
      throw new Error('Начало периода не может быть позже конца периода.');
    }

    setImportStatus('Читаю Excel и считаю выбранный период...');

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const fallbackYear = startDate.getFullYear();

    const workSheet = readSheet(workbook, 'work', fallbackYear, true);
    const efficiencySheet = readSheet(workbook, 'efficiency', fallbackYear, true);
    const trainingsSheet = readSheet(workbook, 'trainings', fallbackYear, false);
    const techSheet = readSheet(workbook, 'tech', fallbackYear, false);
    const offlineSheet = readSheet(workbook, 'offline', fallbackYear, false);

    const selectedDateKeys = dateKeysInRange(startDate, endDate);
    const usedDateKeys = selectedDateKeys.filter(key =>
      workSheet.layout.dateCols.has(key) && efficiencySheet.layout.dateCols.has(key)
    );

    if (!usedDateKeys.length) {
      const availableWorkDates = [...workSheet.layout.dateCols.keys()].sort();
      throw new Error(
        `В выбранном периоде нет дат, которые одновременно найдены на листах «${workSheet.sheetName}» и «${efficiencySheet.sheetName}». ` +
        `Даты в основном листе: ${formatDateRange(availableWorkDates)}.`
      );
    }

    const workMetricIdx = metricIndexByKeyword('выработ');
    const effMetricIdx = metricIndexByKeyword('эфф');
    if (workMetricIdx < 0 || effMetricIdx < 0) {
      throw new Error('Не найдены колонки сайта «Выработка» и/или «Эфф. %». Проверьте названия метрик в админке.');
    }

    if (typeof normalizeEditableData === 'function') normalizeEditableData();

    const warnings = [];
    const missingSiteOperators = [];
    const extraExcelOperators = [];
    const zeroNormOperators = [];
    const updatedNames = new Set();
    const preview = [];

    if (usedDateKeys.length < selectedDateKeys.length) {
      const missed = selectedDateKeys.filter(key => !usedDateKeys.includes(key));
      warnings.push(`В Excel найдена только часть периода. Посчитаны даты ${formatDateRange(usedDateKeys)}; пропущены ${formatDateRange(missed)}.`);
    }
    if (!trainingsSheet) warnings.push('Лист «Тренинги» не найден: тренинги посчитаны как 0.');
    if (!techSheet) warnings.push('Лист «Тех. сбои» не найден: тех. сбои посчитаны как 0.');
    if (!offlineSheet) warnings.push('Лист «Офлайн активность» не найден: офлайн активность посчитана как 0.');

    FACULTIES.forEach((faculty, facIdx) => {
      (faculty.operators || []).forEach((operatorName, opIdx) => {
        const operatorKey = norm(operatorName);
        const workEntry = workSheet.operators.get(operatorKey);
        const efficiencyEntry = efficiencySheet.operators.get(operatorKey);

        if (!workEntry || !efficiencyEntry) {
          missingSiteOperators.push(operatorName);
          return;
        }

        const monthlyNorm = toNum(workEntry.row[workSheet.layout.normCol]);
        const targetNorm = monthlyNorm / 4;
        const baseWorked = sumSheetDates(workSheet, operatorKey, usedDateKeys);
        const trainings = sumSheetDates(trainingsSheet, operatorKey, usedDateKeys);
        const tech = sumSheetDates(techSheet, operatorKey, usedDateKeys);
        const offline = sumSheetDates(offlineSheet, operatorKey, usedDateKeys);
        const effectiveHours = sumSheetDates(efficiencySheet, operatorKey, usedDateKeys);
        const actualFact = baseWorked + trainings + tech + offline;
        const workScore = targetNorm > 0 ? actualFact / targetNorm * 100 : 0;
        const effScore = baseWorked > 0 ? effectiveHours / baseWorked * 100 : 0;

        if (targetNorm <= 0) zeroNormOperators.push(operatorName);

        const metricRow = ensureMetricRow(facIdx, opIdx);
        metricRow[workMetricIdx] = round2(workScore);
        metricRow[effMetricIdx] = round2(effScore);

        updatedNames.add(operatorKey);
        if (preview.length < 8) {
          preview.push({
            operator: operatorName,
            actualFact: round2(actualFact),
            targetNorm: round2(targetNorm),
            workScore: round2(workScore),
            effectiveHours: round2(effectiveHours),
            baseWorked: round2(baseWorked),
            effScore: round2(effScore),
          });
        }
      });
    });

    for (const [operatorKey, entry] of workSheet.operators.entries()) {
      if (!updatedNames.has(operatorKey) && !findOperator(entry.name)) {
        extraExcelOperators.push(entry.name);
      }
    }

    if (zeroNormOperators.length) {
      const sample = zeroNormOperators.slice(0, 8).join(', ');
      warnings.push(`У ${zeroNormOperators.length} операторов норма часов равна 0: ${sample}${zeroNormOperators.length > 8 ? ' ...' : ''}.`);
    }

    if (updatedNames.size === 0) {
      throw new Error('Ни один оператор с сайта не найден в Excel. Данные не изменены.');
    }

    await saveEditableData();
    await refreshDashboard();
    renderEditor();

    const sheetNames = [
      workSheet.sheetName,
      efficiencySheet.sheetName,
      trainingsSheet?.sheetName,
      techSheet?.sheetName,
      offlineSheet?.sheetName,
    ].filter(Boolean).join(', ');

    const report = {
      updatedCount: updatedNames.size,
      selectedPeriod: `${formatDateRu(startDate)} - ${formatDateRu(endDate)}`,
      usedDates: formatDateRange(usedDateKeys),
      sheetNames,
      warnings,
      missingSiteOperators,
      extraExcelOperators,
      preview,
    };

    const statusType = warnings.length || missingSiteOperators.length || extraExcelOperators.length ? 'warn' : 'success';
    setImportStatus(buildImportReport(report), statusType, true);
  } catch (err) {
    console.error('[excel-import]', err);
    setImportStatus(`Ошибка импорта: ${err.message}`, 'error');
  }
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

    parseExcelAndApply(file);
  });

  fileInput.addEventListener('change', () => {
    const nameEl = document.getElementById('excel-file-name');
    if (nameEl) nameEl.textContent = fileInput.files[0]?.name || 'Выберите файл...';
    setImportStatus('');
  });
}

document.addEventListener('DOMContentLoaded', initExcelImport);
