#!/usr/bin/env node
/**
 * Проставляет в index.html версии ассетов по хешу их содержимого.
 *
 * Зачем: раньше версии в query-строке правились руками
 * (`app.js?v=smz-document-signing-v1`). Забыть бампнуть было легко, поэтому
 * сервер на всякий случай отдавал .css и .js с `no-cache, must-revalidate`.
 * В итоге версионирование не работало вовсе: каждый повторный визит тратил
 * round-trip на ревалидацию каждого файла — на медленном 4G это ~350 мс,
 * при нулевом объёме переданных данных.
 *
 * Хеш от содержимого убирает человеческий фактор: версия меняется ровно
 * тогда, когда меняется файл, поэтому ассеты можно отдавать как immutable.
 * Сам index.html отдаётся с no-store, так что новый деплой подхватывается
 * сразу.
 *
 * `npm run stamp`          — переписать index.html.
 * `npm run check:stamped`  — упасть, если index.html отстал от бандлов (CI).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(ROOT, "index.html");

/**
 * `ref` — как путь может выглядеть в index.html сейчас (исходный или уже
 * заштампованный), `serve` — что реально должен грузить браузер.
 */
export const STAMPED_ASSETS = Object.freeze([
  Object.freeze({ ref: "css/tokens.css", serve: "css/tokens.css" }),
  Object.freeze({ ref: "css/styles.css", serve: "css/styles.min.css" }),
  Object.freeze({ ref: "js/theme-init.js", serve: "js/theme-init.js" }),
  Object.freeze({ ref: "js/api.js", serve: "js/api.min.js" }),
  Object.freeze({ ref: "js/app.js", serve: "js/app.min.js" }),
]);

function contentHash(relativePath) {
  const bytes = readFileSync(join(ROOT, relativePath));
  // Нормализуем переводы строк: иначе хеш скачет между Windows и Linux и
  // CI падает на файле, который никто не менял.
  const normalized = bytes.toString("utf8").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stampHtml(html) {
  let output = html;
  for (const asset of STAMPED_ASSETS) {
    const hash = contentHash(asset.serve);
    const candidates = asset.ref === asset.serve ? [asset.ref] : [asset.serve, asset.ref];
    const alternatives = candidates.map(escapeForRegExp).join("|");
    // Ловим и исходный путь, и уже заштампованный — скрипт идемпотентен.
    const pattern = new RegExp(`(href|src)="(?:${alternatives})(?:\\?[^"]*)?"`, "g");
    // Считаем совпадения, а не изменения текста: на повторном прогоне замена
    // даёт тот же результат, и сравнение строк ложно сигналило бы об ошибке.
    let matches = 0;
    output = output.replace(pattern, (_full, attribute) => {
      matches += 1;
      return `${attribute}="${asset.serve}?v=${hash}"`;
    });
    if (matches === 0) {
      throw new Error(
        `index.html не ссылается на ${asset.ref} — обновите STAMPED_ASSETS в scripts/stamp-assets.mjs`,
      );
    }
  }
  return output;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const current = readFileSync(INDEX, "utf8");
  const expected = stampHtml(current);

  if (checkOnly) {
    if (current !== expected) {
      console.error(
        "index.html отстал от собранных бандлов. Запустите npm run build и закоммитьте результат.",
      );
      process.exit(1);
    }
    console.log("index.html: версии ассетов совпадают с содержимым");
    return;
  }

  if (current === expected) {
    console.log("index.html: версии ассетов уже актуальны");
    return;
  }
  writeFileSync(INDEX, expected);
  for (const asset of STAMPED_ASSETS) {
    console.log(`stamped ${asset.serve} -> ?v=${contentHash(asset.serve)}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("stamp-assets.mjs")) {
  main();
}
