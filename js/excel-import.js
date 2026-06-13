/**
 * excel-import.js
 *
 * Парсит Excel-файл формата «Таблица_для_конкурса.xlsx» и заполняет
 * выбранную неделю на сайте. Формула расчёта баллов на сайте НЕ
 * используется — итоговый балл берётся напрямую из Excel (колонка
 * «ИТОГО БАЛЛОВ»).
 *
 * Колонки определяются автоматически по заголовку — порядок и
 * количество колонок может меняться, главное чтобы названия
 * содержали ключевые слова: «оператор», «качество», «оценка»,
 * «выработка», «эффективность», «опоздания», «посторонние»/«сайты»,
 * «итого».
 *
 * Поддерживаются обе структуры файла:
 *   - старая (без колонки «Фракция»): A=№, B=Оператор, C=Качество…
 *   - новая (с колонкой «Фракция»):   A=№, B=Фракция, C=Оператор, D=Качество…
 *
 * Привязка имени к фракции:
 *   - Имя из Excel ищется в operators всех фракций в data.json
 *   - Если найдено → пишем значения в эту строку выбранной публикации
 *   - Если не найдено → строка пропускается с предупреждением
 *     (новый оператор должен сначала быть добавлен через админ-панель
 *     с привязкой к нужной фракции)
 */

'use strict';

/* ── Утилиты ─────────────────────────────────────────────── */
function norm(str) {
  return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/\s/g, '').replace('%', '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/* Ищет оператора во всех фракциях по нормализованному имени.
   Возвращает { facIdx, opIdx } или null. */
function findOperator(rawName) {
  const target = norm(rawName);
  for (let fi = 0; fi < FACULTIES.length; fi++) {
    const ops = FACULTIES[fi].operators || [];
    for (let oi = 0; oi < ops.length; oi++) {
      if (norm(ops[oi]) === target) {
        return { facIdx: fi, opIdx: oi };
      }
    }
  }
  return null;
}

/* Показывает сообщение внутри импорт-модала */
function setImportStatus(msg, type = 'info') {
  const el = document.getElementById('import-status');
  if (!el) return;
  if (!msg) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = msg;
  el.className = `import-status import-status--${type}`;
  el.style.display = 'block';
  el.removeAttribute('hidden');
}

/* ── Автоопределение колонок по заголовку ─────────────────
   Принимает массив строк из листа (rows). Ищет строку, содержащую
   слово «оператор» в одной из ячеек (это шапка категорий). От этой
   строки также берёт колонки метрик. Если в найденной строке нет
   подзаголовков «Значение/Баллы», предполагает что подзаголовки
   находятся в строке ниже.

   Возвращает объект:
   {
     nameCol:   индекс колонки с ФИО оператора,
     metricCols: [{ excelCol, metricIdx }],
     scoreCol:  индекс колонки «ИТОГО БАЛЛОВ»,
     headerRow: индекс строки заголовка,
     dataStartRow: индекс первой строки данных
   }
   или null, если разобрать не удалось. */
function detectLayout(rows) {
  /* 1. Ищем строку, где есть «оператор» */
  let headerRow = -1;
  let operatorCol = -1;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (norm(row[c]) === 'оператор' || norm(row[c]) === 'фио' || norm(row[c]) === 'фио оператора') {
        headerRow = r;
        operatorCol = c;
        break;
      }
    }
    if (headerRow >= 0) break;
  }
  if (headerRow < 0) return null;

  /* 2. Карта ключевых слов → метрика. Порядок в массиве соответствует
        индексам метрик на сайте: 0=качество, 1=оценка, 2=выработка,
        3=эффективность, 4=опоздания, 5=сайты. */
  const KEYWORDS = [
    { metricIdx: 0, words: ['качество'] },
    { metricIdx: 1, words: ['оценка'] },
    { metricIdx: 2, words: ['выработка'] },
    { metricIdx: 3, words: ['эффективность'] },
    { metricIdx: 4, words: ['опоздания', 'опоздание'] },
    { metricIdx: 5, words: ['посторонние', 'сайты'] },
  ];

  const headerCells = (rows[headerRow] || []).map(v => norm(v));
  const subRowCells = (rows[headerRow + 1] || []).map(v => norm(v));

  /* Для каждой метрики ищем первую колонку, в заголовке которой
     встречается ключевое слово. */
  const metricCols = [];
  for (const kw of KEYWORDS) {
    let found = -1;
    for (let c = 0; c < headerCells.length; c++) {
      const cell = headerCells[c];
      if (kw.words.some(w => cell.includes(w))) {
        found = c;
        break;
      }
    }
    if (found >= 0) metricCols.push({ excelCol: found, metricIdx: kw.metricIdx });
  }

  /* 3. Колонка «ИТОГО БАЛЛОВ» */
  let scoreCol = -1;
  for (let c = 0; c < headerCells.length; c++) {
    if (headerCells[c].includes('итого')) {
      scoreCol = c;
      break;
    }
  }

  /* 4. Определяем, есть ли подзаголовочная строка под шапкой.
        Признак: ниже шапки в тех же колонках встречаются слова
        «значение», «баллы», «минуты», «факты» и т.п. */
  const SUBHEAD_HINTS = ['значение', 'баллы', 'минуты', 'факты', 'балл', 'эффективность'];
  const hasSubHeader = subRowCells.some(c => SUBHEAD_HINTS.some(h => c.includes(h)));

  /* 5. Стартовая строка данных — после заголовка(ов).
        Дальше всё равно дополнительно проверим в основной функции
        (там ищется первая строка, где A=число и есть имя). */
  const dataStartRow = headerRow + (hasSubHeader ? 2 : 1);

  return {
    nameCol: operatorCol,
    metricCols,
    scoreCol,
    headerRow,
    dataStartRow,
  };
}

/* ── Основная функция парсинга ───────────────────────────── */
function parseExcelAndApply(file, weekIndex) {
  if (typeof XLSX === 'undefined') {
    setImportStatus('Библиотека Excel не загрузилась. Обновите страницу и попробуйте ещё раз.', 'error');
    return;
  }

  setImportStatus('Читаю файл…');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      if (workbook.SheetNames.length === 0) {
        setImportStatus('В файле нет ни одного листа.', 'error');
        return;
      }

      const noticeMultiSheet = workbook.SheetNames.length > 1
        ? `Файл содержит ${workbook.SheetNames.length} листов. Импортирую первый: «${workbook.SheetNames[0]}».`
        : '';

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

      if (rows.length < 3) {
        setImportStatus('Файл слишком короткий — нет строк с данными.', 'error');
        return;
      }

      /* Автоопределение структуры */
      const layout = detectLayout(rows);
      if (!layout) {
        setImportStatus('Не удалось распознать структуру файла: не найдена колонка «Оператор» в заголовке.', 'error');
        return;
      }
      if (layout.metricCols.length === 0 || layout.scoreCol < 0) {
        setImportStatus('Не удалось распознать колонки метрик или «ИТОГО БАЛЛОВ» в заголовке.', 'error');
        return;
      }

      const metricCount = METRICS.length;
      const scoreIdx    = getScoreMetricIndex();

      let imported = 0;
      let skipped  = 0;
      const warnings = [];
      const missingOperators = [];

      /* Ищем фактический старт данных: строка, где есть имя в nameCol
         и (опционально) число в колонке A. */
      let startRow = layout.dataStartRow;
      for (let r = layout.dataStartRow; r < rows.length; r++) {
        const row = rows[r] || [];
        const nameCell = row[layout.nameCol];
        if (nameCell && String(nameCell).trim()) {
          startRow = r;
          break;
        }
      }

      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r];
        if (!row) { continue; }

        const rawName = row[layout.nameCol];
        if (!rawName || !String(rawName).trim()) {
          // Пустая строка — конец данных, прекращаем
          break;
        }

        const op = findOperator(rawName);
        if (!op) {
          missingOperators.push(String(rawName).trim());
          skipped++;
          continue;
        }

        /* Гарантируем существование строки */
        if (!WEEKLY_DATA[weekIndex])              WEEKLY_DATA[weekIndex] = [];
        if (!WEEKLY_DATA[weekIndex][op.facIdx])   WEEKLY_DATA[weekIndex][op.facIdx] = [];
        if (!WEEKLY_DATA[weekIndex][op.facIdx][op.opIdx]) {
          WEEKLY_DATA[weekIndex][op.facIdx][op.opIdx] = Array(metricCount).fill(0);
        }

        const arr = WEEKLY_DATA[weekIndex][op.facIdx][op.opIdx];

        /* Заполняем 6 метрик */
        layout.metricCols.forEach(({ excelCol, metricIdx }) => {
          if (metricIdx < arr.length) {
            arr[metricIdx] = toNum(row[excelCol]);
          }
        });

        /* Итоговый балл — напрямую из Excel, никаких пересчётов */
        const scoreFromExcel = toNum(row[layout.scoreCol]);
        arr[scoreIdx] = Math.round(scoreFromExcel * 10) / 10;

        imported++;
      }

      if (imported === 0) {
        let msg = 'Ни одна строка не была импортирована.';
        if (missingOperators.length) {
          msg += ` Ни одно имя из файла не совпало со списком операторов на сайте.`;
        }
        setImportStatus(msg, 'error');
        return;
      }

      /* ── Сохранение ──────────────────────────────────── */
      saveEditableData().then(() => {
        renderStats(currentWeek);
        renderScoreboard(currentWeek);
        renderFacultyCards(currentWeek);
        renderEditor();

        let msg = `✅ Импорт завершён: ${imported} операторов загружено в «${PUB_LABELS[Math.min(weekIndex,1)].date + ' — ' + PUB_LABELS[Math.min(weekIndex,1)].name}»`;
        if (skipped) msg += `, ${skipped} пропущено`;
        if (noticeMultiSheet) msg += `\n${noticeMultiSheet}`;
        if (missingOperators.length) {
          const sample = missingOperators.slice(0, 5).join(', ');
          msg += `\n⚠ Не найдены в системе: ${sample}`;
          if (missingOperators.length > 5) msg += ` … и ещё ${missingOperators.length - 5}`;
          msg += `\n(Добавьте этих операторов через админ-панель в нужную фракцию)`;
        }
        setImportStatus(msg, missingOperators.length ? 'warn' : 'success');
      }).catch(err => {
        setImportStatus(`Импорт прошёл, но не удалось сохранить: ${err.message}`, 'error');
      });

    } catch (err) {
      console.error('[excel-import]', err);
      setImportStatus(`Ошибка при разборе файла: ${err.message}`, 'error');
    }
  };

  reader.onerror = () => setImportStatus('Не удалось прочитать файл.', 'error');
  reader.readAsArrayBuffer(file);
}

/* ── UI: инициализация кнопки и обработчика ─────────────── */
function initExcelImport() {
  const fileInput  = document.getElementById('excel-file-input');
  const weekSelect = document.getElementById('import-week-select');
  const importBtn  = document.getElementById('excel-import-btn');

  if (!fileInput || !weekSelect || !importBtn) return;

  importBtn.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file) {
      setImportStatus('Выберите файл Excel (.xlsx или .xls)', 'error');
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'ods'].includes(ext)) {
      setImportStatus('Поддерживаются только .xlsx, .xls и .ods', 'error');
      return;
    }
    const weekIdx = parseInt(weekSelect.value, 10);
    setImportStatus('');
    parseExcelAndApply(file, weekIdx);
  });

  /* Обновляем имя файла и сбрасываем статус при смене */
  fileInput.addEventListener('change', () => {
    const nameEl = document.getElementById('excel-file-name');
    if (nameEl) nameEl.textContent = fileInput.files[0]?.name || 'Выберите файл…';
    setImportStatus('');
  });
}

document.addEventListener('DOMContentLoaded', initExcelImport);
