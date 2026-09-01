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

test.describe('Уровни — визуальный базлайн', () => {
  test('экран целиком', async ({ page }) => {
    await openLevels(page);
    await expect(page).toHaveScreenshot('operator-levels.png', { fullPage: true });
  });

  test('карточки уровней идут по sort_order', async ({ page }) => {
    await openLevels(page);
    const expected = [...sample.levels.json]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(l => l.name);
    // Порядок задаёт сервер — экран не имеет права его переставлять.
    const shown = await page.locator('[data-level-name]').allTextContents();
    if (shown.length) expect(shown.map(s => s.trim())).toEqual(expected);
  });
});
