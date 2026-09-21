/**
 * Отбор сеансов на экране «Сессии и устройства».
 *
 * Экран был списком карточек во весь экран без единого фильтра, кроме
 * переключателя «Все аккаунты / Мой аккаунт»: чтобы найти вход по нужному
 * IP, приходилось прокручивать всё подряд. Появились поиск, отбор по
 * сотруднику, платформе и давности активности, сортировка — и вместе с ними
 * место, где экран может соврать: показать чужой сеанс под «Мой аккаунт»
 * или потерять строку из-за регистра.
 *
 * Логика вынесена из useMemo в чистую функцию именно ради этой проверки.
 * Время передаётся аргументом, иначе тест про «давность» протухал бы сам.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("./SessionsPage.tsx", import.meta.url), "utf8");
const formats = readFileSync(new URL("../utils/format.ts", import.meta.url), "utf8");

// Компонент тянет React и react-query; для чистых функций они не нужны, поэтому
// берём только их, отрезав всё, что начинается с компонента, и убрав импорты.
//
// parseTimestamp и plural подставляются настоящие, из utils/format: именно
// parseTimestamp решает, считать ли отметку без пояса за UTC, и заглушка
// вместо него превратила бы проверку часовых поясов в проверку заглушки.
const helpers = ["parseTimestamp", "plural"]
  .map((name) => {
    const at = formats.search(new RegExp(`^export function ${name}\\(`, "m"));
    assert.notEqual(at, -1, `в utils/format нет ${name}`);
    const end = formats.indexOf("\n}", at);
    return formats.slice(at, end + 2).replace("export ", "");
  })
  .join("\n\n");

const head = source.slice(0, source.indexOf("export function SessionsPage"));
const built = await transform(`${helpers}\n${head.replace(/^import[\s\S]*?;$/gm, "")}`, {
  loader: "tsx",
  format: "esm",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString("base64")}`);
const { browserOf, platformOf, freshnessOf, filterSessions } = mod;

const NOW = Date.UTC(2026, 8, 21, 14, 0, 0);
// Бэкенд отдаёт отметки без часового пояса — ровно так, как их пишет
// datetime.utcnow(). Тест обязан использовать тот же вид строки: с суффиксом
// «Z» ошибка разбора не воспроизводится и проверка ничего не стережёт.
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString().replace("Z", "");

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

const SESSIONS = [
  { id: "a", user_id: 1, full_name: "Тест Тестович", device: CHROME_WIN, ip_address: "176.98.225.85",
    created_at: ago(30), last_active_at: ago(2), expires_at: ago(-100), current: false },
  { id: "b", user_id: 2, full_name: "Dinmukhamad", device: CHROME_WIN, ip_address: "176.98.225.85",
    created_at: ago(900), last_active_at: ago(70), expires_at: ago(-100), current: true },
  { id: "c", user_id: 1, full_name: "Тест Тестович", device: SAFARI_IOS, ip_address: "10.0.0.7",
    created_at: ago(20000), last_active_at: ago(15000), expires_at: ago(-100), current: false },
  { id: "d", user_id: 3, full_name: "Анна Козлова", device: FIREFOX_LINUX, ip_address: null,
    created_at: ago(5000), last_active_at: ago(600), expires_at: ago(-100), current: false },
];

const BASE = { scope: "all", person: "", platform: "", freshness: "", search: "", sort: "active" };
const ids = (rows) => rows.map((r) => r.id);

/* ── Разбор User-Agent ──────────────────────────────────────── */

test("браузер и платформа читаются из строки агента", () => {
  assert.equal(browserOf(CHROME_WIN), "Chrome");
  assert.equal(platformOf(CHROME_WIN), "Windows");
  // Safari определяется последним: у Chrome в агенте тоже есть слово Safari,
  // и порядок проверок здесь несущий, а не случайный.
  assert.equal(browserOf(SAFARI_IOS), "Safari");
  assert.equal(platformOf(SAFARI_IOS), "iOS");
  assert.equal(browserOf(FIREFOX_LINUX), "Firefox");
  assert.equal(platformOf(FIREFOX_LINUX), "Linux");
});

test("незнакомый агент не ломает разбор", () => {
  assert.equal(browserOf("curl/8.4.0"), "Браузер");
  assert.equal(platformOf("curl/8.4.0"), "Другое");
});

/* ── Давность активности ───────────────────────────────────── */

test("пороги давности совпадают с подписями фильтра", () => {
  assert.equal(freshnessOf(ago(2), NOW), "now");
  assert.equal(freshnessOf(ago(70), NOW), "today");
  assert.equal(freshnessOf(ago(60 * 30), NOW), "week");
  assert.equal(freshnessOf(ago(60 * 24 * 10), NOW), "stale");
});

/* ── Отбор ─────────────────────────────────────────────────── */

test("«Мой аккаунт» показывает только свои сеансы", () => {
  const mine = filterSessions(SESSIONS, { ...BASE, scope: "mine", meId: 1 }, NOW);
  assert.deepEqual(ids(mine).sort(), ["a", "c"]);
});

test("без выбранного сотрудника отбор по нему не срабатывает", () => {
  // Пустая строка — это «все», а не пользователь с пустым идентификатором.
  assert.equal(filterSessions(SESSIONS, BASE, NOW).length, SESSIONS.length);
});

test("отбор по сотруднику и платформе складывается", () => {
  const rows = filterSessions(SESSIONS, { ...BASE, person: "1", platform: "iOS" }, NOW);
  assert.deepEqual(ids(rows), ["c"]);
});

test("поиск находит по IP-адресу", () => {
  // Ради этого случая экран и переделывали: найти вход с конкретного адреса.
  const rows = filterSessions(SESSIONS, { ...BASE, search: "10.0.0.7" }, NOW);
  assert.deepEqual(ids(rows), ["c"]);
});

test("поиск не зависит от регистра и пробелов по краям", () => {
  const rows = filterSessions(SESSIONS, { ...BASE, search: "  КОЗЛОВА  " }, NOW);
  assert.deepEqual(ids(rows), ["d"]);
});

test("сеанс без записанного адреса не роняет поиск", () => {
  const rows = filterSessions(SESSIONS, { ...BASE, search: "firefox" }, NOW);
  assert.deepEqual(ids(rows), ["d"]);
});

test("отбор по давности берёт те же пороги, что и подписи", () => {
  assert.deepEqual(ids(filterSessions(SESSIONS, { ...BASE, freshness: "now" }, NOW)), ["a"]);
  assert.deepEqual(ids(filterSessions(SESSIONS, { ...BASE, freshness: "stale" }, NOW)), ["c"]);
});

/* ── Порядок ───────────────────────────────────────────────── */

test("по умолчанию сверху самые свежие", () => {
  assert.deepEqual(ids(filterSessions(SESSIONS, BASE, NOW)), ["a", "b", "d", "c"]);
});

test("сортировка по входу отличается от сортировки по активности", () => {
  const byCreated = ids(filterSessions(SESSIONS, { ...BASE, sort: "created" }, NOW));
  assert.deepEqual(byCreated, ["a", "b", "d", "c"].sort((x, y) => {
    const at = SESSIONS.find((s) => s.id === x), bt = SESSIONS.find((s) => s.id === y);
    return new Date(bt.created_at) - new Date(at.created_at);
  }));
  assert.equal(byCreated[0], "a");
});

test("сортировка по имени упорядочивает кириллицу и не разрывает тёзок", () => {
  // Порядок между алфавитами закреплять не стоит: где окажется латиница
  // относительно кириллицы, решает ICU, и на другой сборке Node ответ
  // может отличиться. Проверяем то, что действительно нужно на экране.
  const names = filterSessions(SESSIONS, { ...BASE, sort: "name" }, NOW).map((r) => r.full_name);
  const cyrillic = names.filter((n) => /^[А-Яа-я]/.test(n));
  assert.deepEqual(cyrillic, [...cyrillic].sort((a, b) => a.localeCompare(b, "ru")));
  // Два сеанса одного человека должны стоять рядом, иначе список
  // невозможно читать глазами.
  assert.equal(names.indexOf("Тест Тестович") + 1, names.lastIndexOf("Тест Тестович"));
  assert.equal(names.length, SESSIONS.length);
});

test("исходный список не изменяется при сортировке", () => {
  // sort мутирует массив на месте; если отдать ему данные запроса, порядок
  // в кеше react-query поедет вслед за выбором в выпадающем списке.
  const before = SESSIONS.map((s) => s.id);
  filterSessions(SESSIONS, { ...BASE, sort: "name" }, NOW);
  assert.deepEqual(SESSIONS.map((s) => s.id), before);
});

/* ── Часовые пояса ─────────────────────────────────────────── */

test("отметка без часового пояса читается как UTC, а не как местное время", () => {
  // Это не теория: экран показывал «5 часов назад» для сеанса, начатого
  // минуту назад, потому что new Date считает такую строку локальной.
  // В UTC+5 свежий вход попадал в «Сегодня» вместо «Сейчас», и фильтр
  // давности — главное на экране безопасности — врал.
  const naive = new Date(NOW - 60000).toISOString().replace("Z", "");
  assert.equal(freshnessOf(naive, NOW), "now");

  // Та же отметка с явным поясом должна дать тот же ответ.
  assert.equal(freshnessOf(`${naive}Z`, NOW), "now");
});

test("порядок не зависит от того, есть ли в отметке пояс", () => {
  const withZone = SESSIONS.map((s) => ({
    ...s,
    last_active_at: `${s.last_active_at}Z`,
    created_at: `${s.created_at}Z`,
  }));
  assert.deepEqual(ids(filterSessions(withZone, BASE, NOW)), ids(filterSessions(SESSIONS, BASE, NOW)));
});
