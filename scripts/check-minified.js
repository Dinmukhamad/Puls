#!/usr/bin/env node
/**
 * Проверка минификации (ТЗ P2.2).
 *
 * История: после инцидента с web-редактором .min-файлы один раз превратились
 * в побайтовые копии исходников — «минификация» существовала только в имени
 * файла. Этот скрипт не даёт такому повториться: CI/pre-deploy падает, если
 * какой-либо .min идентичен исходнику или не меньше его по размеру.
 *
 * Запуск: node scripts/check-minified.js  (или npm run check:minified)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PAIRS = [
  ['js/app.js', 'js/app.min.js'],
  ['js/api.js', 'js/api.min.js'],
  ['css/styles.css', 'css/styles.min.css'],
  ['css/tokens.css', 'css/tokens.min.css'],
];

let failed = false;

for (const [srcRel, minRel] of PAIRS) {
  const src = path.join(ROOT, srcRel);
  const min = path.join(ROOT, minRel);

  if (!fs.existsSync(min)) {
    console.error(`FAIL  ${minRel}: файл отсутствует — выполните \`npm run build\``);
    failed = true;
    continue;
  }

  const a = fs.readFileSync(src);
  const b = fs.readFileSync(min);

  if (a.equals(b)) {
    console.error(`FAIL  ${minRel}: побайтово идентичен ${srcRel} — минификация не выполнена`);
    failed = true;
  } else if (b.length >= a.length) {
    console.error(`FAIL  ${minRel}: ${b.length} байт — не меньше исходника (${a.length})`);
    failed = true;
  } else {
    const pct = (100 - (b.length / a.length) * 100).toFixed(1);
    console.log(`OK    ${minRel}: ${a.length} → ${b.length} байт (−${pct}%)`);
  }
}

process.exit(failed ? 1 : 0);
