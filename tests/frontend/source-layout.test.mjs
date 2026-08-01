/* Структура исходников фронтенда: отсутствие файлов-монолитов и целостность
   разреза. Три вьюхи (3110 + 2671 + 2603 строки) были в сумме больше, чем
   весь app/modules/analytics, и содержали по десять несвязанных разделов. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function jsSources(dir = "js/src", out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) jsSources(path, out);
    else if (entry.endsWith(".js")) out.push(path.split("\\").join("/"));
  }
  return out;
}

test("ни один исходник фронтенда не длиннее 900 строк", () => {
  const LIMIT = 900;
  // Долг, оставшийся с прошлых итераций: эти файлы в текущий разрез не входили.
  // Список только сокращается — новые записи в него не добавляем.
  const KNOWN_DEBT = new Set([
    "js/src/views/rating/20-rating-shop-summary.view.js",
    "js/src/views/operator-levels/10-levels-cabinet.view.js",
  ]);
  const tooBig = jsSources()
    .map((f) => [f, readFileSync(f, "utf8").split("\n").length])
    .filter(([f, n]) => n > LIMIT && !KNOWN_DEBT.has(f))
    .map(([f, n]) => `${f}: ${n}`);
  assert.deepEqual(tooBig, [], `файлы длиннее ${LIMIT} строк:\n${tooBig.join("\n")}`);
});

test("разрезанные монолиты не вернулись", () => {
  const gone = [
    "js/src/views/coins/30-admin-coins-groups-operators.view.js",
    "js/src/views/reports/40-reports-analytics.view.js",
    "js/src/views/wheel/60-wheel-tests.view.js",
  ];
  const present = jsSources().filter((f) => gone.includes(f));
  assert.deepEqual(present, [], `монолит восстановлен: ${present.join(", ")}`);
});

test("общие утилиты лежат в js/src/utils, а не внутри вьюхи", () => {
  // esc() вызывается сотни раз по проекту и раньше была объявлена
  // на 2791-й строке вьюхи коинов.
  const owners = {
    "function esc(": "js/src/utils/05-format.js",
    "function isAdmin(": "js/src/utils/05-format.js",
    "function showModal(": "js/src/utils/06-modal.js",
    "function closeModal(": "js/src/utils/06-modal.js",
    "function showToast(": "js/src/utils/07-toast.js",
    "function downloadCSV(": "js/src/utils/08-export.js",
  };
  for (const [signature, owner] of Object.entries(owners)) {
    const found = jsSources().filter((f) => readFileSync(f, "utf8").includes(signature));
    assert.deepEqual(found, [owner], `${signature.trim()} объявлена в: ${found.join(", ")}`);
  }
});

test("порядок склейки бандла не изменился: утилиты идут до вьюх", () => {
  const bundle = readFileSync("js/app.js", "utf8");
  assert.ok(bundle.indexOf("function esc(") < bundle.indexOf("function renderUsersPage("),
    "утилиты должны попадать в бандл раньше вьюх, которые их используют");
  assert.ok(bundle.indexOf("function showModal(") < bundle.indexOf("function showAddOperatorModal("));
});
