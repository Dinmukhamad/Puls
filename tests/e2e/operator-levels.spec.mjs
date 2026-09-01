/**
 * Базлайн экрана «Уровни» (#operator-levels) на трёх ширинах из ТЗ.
 *
 * API подменяется фикстурами: снимок обязан ломаться от правки вёрстки, а
 * не от того, что кто-то завёл нового оператора. Неизвестные запросы
 * отдают пустой ответ — приложение при загрузке дёргает много эндпоинтов,
 * и без заглушки экран показал бы ошибку связи вместо содержимого.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sample = JSON.parse(
  readFileSync(new URL('../fixtures/operator_levels_sample.json', import.meta.url), 'utf8'),
);

/** Фиксированное «сейчас»: относительные даты иначе плывут между прогонами. */
const FROZEN_NOW = new Date('2026-09-01T09:00:00').getTime();

async function stubApi(page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (path === '/api/auth/me') return json(sample.me.json);
    if (path === '/api/admin/operator-levels') return json(sample.levels.json);
    if (path === '/api/admin/operator-levels/rewards') return json(sample.rewards.json);
    if (path === '/api/operator-levels') return json(sample.levels.json);
    // Остальное приложению для этого экрана не нужно: отдаём пустое, чтобы
    // не всплывали баннеры об ошибках поверх снимка.
    return json(path.includes('list') || path.endsWith('s') ? [] : {});
  });
}

async function openLevels(page) {
  await stubApi(page);
  await page.addInitScript(now => {
    // Замораживаем время до загрузки приложения.
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    window.Date = FixedDate;
    try { localStorage.setItem('pulse-theme', 'light'); } catch (e) { /* приватный режим */ }
  }, FROZEN_NOW);

  await page.goto('/index.html#operator-levels');
  await page.waitForFunction(() => typeof window.STATE === 'object' && window.STATE !== null,
    null, { timeout: 15_000 }).catch(() => {});
  // Ждём, пока раздел действительно отрисуется, а не просто загрузится документ.
  await page.locator('#view-operator-levels').waitFor({ state: 'attached', timeout: 15_000 });
  await page.waitForTimeout(600);
}

/**
 * Ни один тест не должен проходить при ошибке в консоли.
 *
 * Повод конкретный: функция обновления экрана какое-то время вызывала саму
 * себя, каждое сохранение падало с RangeError — и все проверки оставались
 * зелёными, потому что смотрели только на видимый результат. Ошибка
 * случалась после закрытия окна, и её никто не замечал.
 */
const consoleErrors = [];

test.beforeEach(({ page }) => {
  consoleErrors.length = 0;
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // «Failed to load resource» — это браузер сообщает код ответа, а не сбой
    // приложения. Тесты нарочно отдают 409 и 422, и такие строки означали бы
    // ложное падение. Всё остальное, включая RangeError, остаётся ошибкой.
    if (message.text().includes('Failed to load resource')) return;
    consoleErrors.push(`console: ${message.text()}`);
  });
});

test.afterEach(() => {
  expect(consoleErrors, `ошибки в консоли страницы:\n${consoleErrors.join('\n')}`).toEqual([]);
});

test.describe('Уровни — визуальный базлайн', () => {
  // @visual — снимок зависит от сглаживания шрифтов конкретной ОС.
  // В CI на ubuntu такие тесты исключаются: базлайн снят на windows.
  test('экран целиком @visual', async ({ page }) => {
    await openLevels(page);
    await expect(page).toHaveScreenshot('operator-levels.png', { fullPage: true });
  });

  test('сетка карточек 4 → 2 → 1 по ширине экрана', async ({ page }, testInfo) => {
    await openLevels(page);
    const grid = page.locator('.lv-grid');
    await grid.waitFor({ timeout: 10_000 });
    const columns = await grid.evaluate(
      el => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
    );
    const expected = { desktop: 4, tablet: 2, mobile: 1 }[testInfo.project.name];
    expect(columns, `на ${testInfo.project.name} ожидали ${expected} колонки`).toBe(expected);
  });

  test('цвет уровня не единственный признак: рядом имя, код и словесный статус', async ({ page }) => {
    await openLevels(page);
    const card = page.locator('.lv-card').first();
    await expect(card.locator('.lv-card-title')).not.toBeEmpty();
    await expect(card.locator('.lv-card-code code')).not.toBeEmpty();
    await expect(card.locator('.lv-state')).toHaveText(/расчёте/);
  });

  test('карточки уровней идут по sort_order', async ({ page }) => {
    await openLevels(page);
    const expected = [...sample.levels.json]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(l => l.name);
    // Порядок задаёт сервер — экран не имеет права его переставлять.
    const shown = await page.locator('[data-level-name]').allTextContents();
    // Без условия: раньше здесь стоял `if (shown.length)`, а узла
    // [data-level-name] в разметке не было вовсе — проверка тихо не
    // выполнялась ни разу и порядок карточек ничем не был закреплён.
    expect(shown.length, 'на экране нет ни одного имени уровня').toBeGreaterThan(0);
    expect(shown.map(s => s.trim())).toEqual(expected);
  });
});
