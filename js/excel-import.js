/**
 * excel-import.js
 *
 * Импортирует расчёт из отчёта Excel за выбранный период.
 * Автоматически обновляет «Качество», «Выработка» и «Эфф. %».
 * Ручные поля и штрафы остаются без перезаписи, «Итого» пересчитывается в app.js.
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

function readSheetFromSources(sources, key, fallbackYear, required = true) {
  const errors = [];

  for (const source of sources) {
    if (!source?.workbook) continue;
    const sheetName = findSheetName(source.workbook, IMPORT_SHEETS[key]);
    if (!sheetName) continue;

    try {
      const info = readSheet(source.workbook, key, fallbackYear, true);
      info.fileName = source.file?.name || source.name || 'Excel';
      return info;
    } catch (error) {
      errors.push(`${source.file?.name || source.name || 'Excel'}: ${error.message}`);
    }
  }

  if (required) {
    if (errors.length) throw new Error(errors.join(' '));
    throw new Error(`В выбранных файлах нет листа «${IMPORT_SHEETS[key][0]}».`);
  }
  return null;
}

function parseRatingValues(value) {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  const matches = String(value).match(/\d+(?:[,.]\d+)?/g) || [];
  return matches.map(item => toNum(item)).filter(value => Number.isFinite(value));
}

function detectQualityLayout(rows, fallbackYear) {
  let best = null;

  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    const row = rows[r] || [];
    let nameCol = -1;
    const dateCols = new Map();

    for (let c = 0; c < row.length; c += 1) {
      const cellNorm = norm(row[c]);
      if (nameCol < 0 && (cellNorm === 'фио' || cellNorm === 'оператор' || cellNorm === 'фио оператора')) {
        nameCol = c;
      }

      const key = parseHeaderDate(row[c], fallbackYear);
      if (key) dateCols.set(key, c);
    }

    if (nameCol < 0 || dateCols.size === 0) continue;

    const candidate = { headerRow: r, dataStartRow: r + 1, nameCol, dateCols };
    if (!best || candidate.dateCols.size > best.dateCols.size) best = candidate;
  }

  return best;
}

function makeQualityRows(sheetInfo) {
  const rowsByName = new Map();
  for (let r = sheetInfo.layout.dataStartRow; r < sheetInfo.rows.length; r += 1) {
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

function readQualitySheets(source, fallbackYear) {
  if (!source?.workbook) return [];
  const sheets = [];

  source.workbook.SheetNames.forEach(sheetName => {
    const sheet = source.workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
    const layout = detectQualityLayout(rows, fallbackYear);
    if (!layout) return;

    const info = {
      sheetName,
      fileName: source.file?.name || source.name || 'Excel',
      rows,
      layout,
    };
    info.operators = makeQualityRows(info);
    sheets.push(info);
  });

  return sheets;
}

function collectQualityScores(source, dateKeys, fallbackYear) {
  const sheets = readQualitySheets(source, fallbackYear);
  const scoresByOperator = new Map();
  const availableDateKeys = new Set();

  sheets.forEach(sheetInfo => {
    sheetInfo.layout.dateCols.forEach((_, key) => availableDateKeys.add(key));

    sheetInfo.operators.forEach((entry, operatorKey) => {
      const values = scoresByOperator.get(operatorKey) || [];
      dateKeys.forEach(dateKey => {
        const col = sheetInfo.layout.dateCols.get(dateKey);
        if (col === undefined) return;
        values.push(...parseRatingValues(entry.row[col]));
      });
      if (values.length) scoresByOperator.set(operatorKey, values);
    });
  });

  return {
    scoresByOperator,
    sheetNames: sheets.map(sheet => sheet.sheetName),
    availableDateKeys: [...availableDateKeys].sort(),
  };
}

function collectQualityScoresFromSources(sources, dateKeys, fallbackYear) {
  const scoresByOperator = new Map();
  const sheetNames = [];
  const availableDateKeys = new Set();

  sources.forEach(source => {
    const quality = collectQualityScores(source, dateKeys, fallbackYear);
    quality.sheetNames.forEach(sheetName => {
      sheetNames.push(`${sheetName} (${source.file?.name || source.name || 'Excel'})`);
    });
    quality.availableDateKeys.forEach(key => availableDateKeys.add(key));
    quality.scoresByOperator.forEach((values, operatorKey) => {
      const existing = scoresByOperator.get(operatorKey) || [];
      scoresByOperator.set(operatorKey, existing.concat(values));
    });
  });

  return {
    scoresByOperator,
    sheetNames,
    availableDateKeys: [...availableDateKeys].sort(),
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function getPeriodTargetNorm(monthlyNorm, sheetInfo, dateKeys) {
  const monthDateCount = sheetInfo ? sheetInfo.layout.dateCols.size : 0;
  if (!monthlyNorm || !monthDateCount || !dateKeys.length) return 0;
  const selectedDateCount = dateKeys.filter(key => sheetInfo.layout.dateCols.has(key)).length;
  return monthlyNorm * selectedDateCount / monthDateCount;
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
      <td>${row.qualityScore}</td>
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
        <div><b>Файлы:</b> ${escapeImportHtml(report.files)}</div>
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
              <th>Кач.</th>
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

async function readWorkbookFile(file) {
  const buffer = await file.arrayBuffer();
  return {
    file,
    workbook: XLSX.read(buffer, { type: 'array', cellDates: true }),
  };
}

async function parseExcelAndApply(reportFile, datesFile) {
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

    const selectedFiles = [reportFile, datesFile].filter(Boolean);
    if (!selectedFiles.length) {
      throw new Error('Выберите хотя бы один Excel-файл.');
    }

    setImportStatus('Читаю Excel и считаю выбранный период...');

    const sources = await Promise.all(selectedFiles.map(file => readWorkbookFile(file)));
    const fallbackYear = startDate.getFullYear();

    const workSheet = readSheetFromSources(sources, 'work', fallbackYear, false);
    const efficiencySheet = readSheetFromSources(sources, 'efficiency', fallbackYear, false);
    const trainingsSheet = readSheetFromSources(sources, 'trainings', fallbackYear, false);
    const techSheet = readSheetFromSources(sources, 'tech', fallbackYear, false);
    const offlineSheet = readSheetFromSources(sources, 'offline', fallbackYear, false);

    const selectedDateKeys = dateKeysInRange(startDate, endDate);
    const canImportReport = !!workSheet && !!efficiencySheet;
    const usedDateKeys = canImportReport
      ? selectedDateKeys.filter(key => workSheet.layout.dateCols.has(key) && efficiencySheet.layout.dateCols.has(key))
      : [];

    const workMetricIdx = metricIndexByKeyword('выработ');
    const effMetricIdx = metricIndexByKeyword('эфф');
    const qualityMetricIdx = metricIndexByKeyword('качеств');

    if (typeof normalizeEditableData === 'function') normalizeEditableData();

    const warnings = [];
    const missingSiteOperators = [];
    const extraExcelOperators = [];
    const zeroNormOperators = [];
    const missingQualityOperators = [];
    const updatedNames = new Set();
    const preview = [];
    const qualityImport = collectQualityScoresFromSources(sources, selectedDateKeys, fallbackYear);
    const dailyImport = {
      period: `${formatDateRu(startDate)} - ${formatDateRu(endDate)}`,
      dateKeys: usedDateKeys,
      generatedAt: new Date().toISOString(),
      operators: {},
    };

    if (canImportReport && !usedDateKeys.length) {
      const availableWorkDates = [...workSheet.layout.dateCols.keys()].sort();
      warnings.push(
        `По основному отчёту нет дат, которые одновременно найдены на листах «${workSheet.sheetName}» и «${efficiencySheet.sheetName}». ` +
        `Даты в основном листе: ${formatDateRange(availableWorkDates)}.`
      );
    }
    if (canImportReport && usedDateKeys.length < selectedDateKeys.length) {
      const missed = selectedDateKeys.filter(key => !usedDateKeys.includes(key));
      warnings.push(`В Excel найдена только часть периода. Посчитаны даты ${formatDateRange(usedDateKeys)}; пропущены ${formatDateRange(missed)}.`);
    }
    if (workSheet && !efficiencySheet) warnings.push('Найден лист «Отработанные часы», но нет листа «Эффективность»: выработка и эффективность не обновлены.');
    if (!workSheet && efficiencySheet) warnings.push('Найден лист «Эффективность», но нет листа «Отработанные часы»: выработка и эффективность не обновлены.');
    if (!workSheet && !efficiencySheet) warnings.push('Основной отчёт не выбран или в файле нет листов «Отработанные часы» и «Эффективность»: обновится только качество, если оно найдено.');
    if (canImportReport && workMetricIdx < 0) warnings.push('На сайте не найдена колонка «Выработка»: выработка не обновлена.');
    if (canImportReport && effMetricIdx < 0) warnings.push('На сайте не найдена колонка «Эфф. %»: эффективность не обновлена.');
    if (canImportReport && !trainingsSheet) warnings.push('Лист «Тренинги» не найден: тренинги посчитаны как 0.');
    if (canImportReport && !techSheet) warnings.push('Лист «Тех. сбои» не найден: тех. сбои посчитаны как 0.');
    if (canImportReport && !offlineSheet) warnings.push('Лист «Офлайн активность» не найден: офлайн активность посчитана как 0.');
    if (qualityMetricIdx < 0) warnings.push('На сайте не найдена колонка «Качество»: оценки по датам прочитаны, но качество не обновлено.');
    if (!qualityImport.sheetNames.length) {
      warnings.push('Файл оценок не выбран или в загруженных файлах не найдены листы с колонкой ФИО и датами.');
    } else {
      const qualityDateKeys = selectedDateKeys.filter(key => qualityImport.availableDateKeys.includes(key));
      if (!qualityDateKeys.length) {
        warnings.push(`В файле оценок нет дат из выбранного периода. Даты в файле: ${formatDateRange(qualityImport.availableDateKeys)}.`);
      }
    }

    const canUpdateReport = canImportReport && usedDateKeys.length > 0 && workMetricIdx >= 0 && effMetricIdx >= 0;

    FACULTIES.forEach((faculty, facIdx) => {
      (faculty.operators || []).forEach((operatorName, opIdx) => {
        const operatorKey = norm(operatorName);
        const qualityValues = qualityImport.scoresByOperator.get(operatorKey) || [];
        const qualityScore = qualityValues.length ? round2(average(qualityValues)) : null;
        const metricRow = ensureMetricRow(facIdx, opIdx);
        let wasUpdated = false;
        let reportValues = null;

        if (qualityMetricIdx >= 0 && qualityScore !== null) {
          metricRow[qualityMetricIdx] = qualityScore;
          wasUpdated = true;
        }

        if (canUpdateReport) {
          const workEntry = workSheet.operators.get(operatorKey);
          const efficiencyEntry = efficiencySheet.operators.get(operatorKey);

          if (!workEntry || !efficiencyEntry) {
            missingSiteOperators.push(operatorName);
          } else {
            const monthlyNorm = toNum(workEntry.row[workSheet.layout.normCol]);
            const targetNorm = getPeriodTargetNorm(monthlyNorm, workSheet, usedDateKeys);
            const baseWorked = sumSheetDates(workSheet, operatorKey, usedDateKeys);
            const trainings = sumSheetDates(trainingsSheet, operatorKey, usedDateKeys);
            const tech = sumSheetDates(techSheet, operatorKey, usedDateKeys);
            const offline = sumSheetDates(offlineSheet, operatorKey, usedDateKeys);
            const effectiveHours = sumSheetDates(efficiencySheet, operatorKey, usedDateKeys);
            const actualFact = baseWorked + trainings + tech + offline;
            const workScore = targetNorm > 0 ? actualFact / targetNorm * 100 : 0;
            const effScore = baseWorked > 0 ? effectiveHours / baseWorked * 100 : 0;
            const dailyRows = usedDateKeys.map(dateKey => {
              const dayBase = sumSheetDates(workSheet, operatorKey, [dateKey]);
              const dayTrainings = sumSheetDates(trainingsSheet, operatorKey, [dateKey]);
              const dayTech = sumSheetDates(techSheet, operatorKey, [dateKey]);
              const dayOffline = sumSheetDates(offlineSheet, operatorKey, [dateKey]);
              const dayEffective = sumSheetDates(efficiencySheet, operatorKey, [dateKey]);
              const dayActual = dayBase + dayTrainings + dayTech + dayOffline;
              return {
                key: dateKey,
                label: formatDateRu(dateKey),
                baseWorked: round2(dayBase),
                extraHours: round2(dayTrainings + dayTech + dayOffline),
                actualFact: round2(dayActual),
                effectiveHours: round2(dayEffective),
              };
            });

            if (targetNorm <= 0) zeroNormOperators.push(operatorName);

            metricRow[workMetricIdx] = round2(workScore);
            metricRow[effMetricIdx] = round2(effScore);
            dailyImport.operators[operatorKey] = {
              operator: operatorName,
              dates: dailyRows,
            };
            reportValues = {
              actualFact: round2(actualFact),
              targetNorm: round2(targetNorm),
              workScore: round2(workScore),
              effectiveHours: round2(effectiveHours),
              baseWorked: round2(baseWorked),
              effScore: round2(effScore),
            };
            wasUpdated = true;
          }
        }

        if (!wasUpdated) return;

        updatedNames.add(operatorKey);
        if (qualityScore === null && qualityMetricIdx >= 0 && qualityImport.sheetNames.length) {
          missingQualityOperators.push(operatorName);
        }
        if (preview.length < 8) {
          preview.push({
            operator: operatorName,
            qualityScore: qualityScore === null ? '—' : qualityScore,
            actualFact: reportValues?.actualFact ?? '—',
            targetNorm: reportValues?.targetNorm ?? '—',
            workScore: reportValues?.workScore ?? '—',
            effectiveHours: reportValues?.effectiveHours ?? '—',
            baseWorked: reportValues?.baseWorked ?? '—',
            effScore: reportValues?.effScore ?? '—',
          });
        }
      });
    });

    if (workSheet) {
      for (const [operatorKey, entry] of workSheet.operators.entries()) {
        if (!updatedNames.has(operatorKey) && !findOperator(entry.name)) {
          extraExcelOperators.push(entry.name);
        }
      }
    }

    if (zeroNormOperators.length) {
      const sample = zeroNormOperators.slice(0, 8).join(', ');
      warnings.push(`У ${zeroNormOperators.length} операторов норма часов равна 0: ${sample}${zeroNormOperators.length > 8 ? ' ...' : ''}.`);
    }
    if (missingQualityOperators.length && qualityMetricIdx >= 0) {
      const sample = missingQualityOperators.slice(0, 8).join(', ');
      warnings.push(`Для ${missingQualityOperators.length} операторов не найдены оценки качества за выбранный период: ${sample}${missingQualityOperators.length > 8 ? ' ...' : ''}.`);
    }

    if (updatedNames.size === 0) {
      throw new Error('Ни один оператор с сайта не найден в Excel. Данные не изменены.');
    }

    if (canUpdateReport && Object.keys(dailyImport.operators).length) {
      if (typeof setDailyImportData === 'function') {
        setDailyImportData(dailyImport);
      } else {
        try { localStorage.setItem('divergentContestDailyImport', JSON.stringify(dailyImport)); } catch {}
      }
    }

    await saveEditableData();
    await refreshDashboard();
    renderEditor();

    const sheetNames = [
      workSheet ? `${workSheet.sheetName} (${workSheet.fileName})` : null,
      efficiencySheet ? `${efficiencySheet.sheetName} (${efficiencySheet.fileName})` : null,
      trainingsSheet ? `${trainingsSheet.sheetName} (${trainingsSheet.fileName})` : null,
      techSheet ? `${techSheet.sheetName} (${techSheet.fileName})` : null,
      offlineSheet ? `${offlineSheet.sheetName} (${offlineSheet.fileName})` : null,
      ...qualityImport.sheetNames,
    ].filter(Boolean).join(', ');

    const report = {
      updatedCount: updatedNames.size,
      files: selectedFiles.map(file => file.name).join('; '),
      selectedPeriod: `${formatDateRu(startDate)} - ${formatDateRu(endDate)}`,
      usedDates: canUpdateReport ? formatDateRange(usedDateKeys) : formatDateRange(selectedDateKeys),
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

function validateImportFile(file, label) {
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls', 'ods'].includes(ext)) {
    throw new Error(`${label}: поддерживаются только .xlsx, .xls и .ods.`);
  }
}

function bindImportFileName(input, nameId, emptyText) {
  input.addEventListener('change', () => {
    const nameEl = document.getElementById(nameId);
    if (nameEl) nameEl.textContent = input.files[0]?.name || emptyText;
    setImportStatus('');
  });
}

function initExcelImport() {
  const reportInput = document.getElementById('excel-report-input');
  const datesInput = document.getElementById('excel-dates-input');
  const importBtn = document.getElementById('excel-import-btn');

  if (!reportInput || !datesInput || !importBtn) return;

  setDefaultImportPeriod();

  importBtn.addEventListener('click', () => {
    try {
      const reportFile = reportInput.files[0];
      const datesFile = datesInput.files[0];
      if (!reportFile && !datesFile) {
        throw new Error('Выберите хотя бы один Excel-файл.');
      }
      validateImportFile(reportFile, 'основной отчёт');
      validateImportFile(datesFile, 'оценки по датам');
      parseExcelAndApply(reportFile || null, datesFile || null);
    } catch (error) {
      setImportStatus(error.message, 'error');
    }
  });

  bindImportFileName(reportInput, 'excel-report-file-name', 'Выберите report_2026-06.xlsx...');
  bindImportFileName(datesInput, 'excel-dates-file-name', 'Выберите monthly_report_dates_2026-06.xlsx...');
}

document.addEventListener('DOMContentLoaded', initExcelImport);
