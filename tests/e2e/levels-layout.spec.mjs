/**
 * Геометрия экрана «Уровни» на трёх ширинах.
 *
 * Это не замена пиксельным снимкам, а то, что можно проверять в CI на
 * linux: измеряется расположение, а не отрисовка. Сглаживание шрифтов на
 * результат не влияет, поэтому такие проверки блокируют мерж уже сейчас,
 * пока линуксовых базлайнов нет.
 *
 * Ловят настоящие поломки вёрстки: уехавший за экран блок, схлопнувшуюся
 * сетку, слишком мелкие цели нажатия, обрезанный футер модалки.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sample = JSON.parse(
  readFileSync(new URL('../fixtures/operator_levels_sample.json', import.meta.url), 'utf8'),
);

const FROZEN_NOW = new Date('2026-09-01T09:00:00').getTime();

/** Ожидаемое число колонок сетки карточек по проекту. */
const COLUMNS = { desktop: 4, tablet: 2, mobile: 1 };

async function openLevels(page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = body => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body),
    });
    if (path === '/api/auth/me') return json(sample.me.json);
    if (path === '/api/admin/operator-levels/rewards') return json(sample.rewards.json);
    if (path === '/api/admin/operator-levels' || path === '/api/operator-levels') {
      return json(sample.levels.json);
    }
    if (path === '/api/operators') return json([{ id: 1, full_name: 'Иван Петров' }]);
    return json(path.includes('list') || path.endsWith('s') ? [] : {});
  });

  await page.addInitScript(now => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    window.Date = FixedDate;
    try { localStorage.setItem('pulse-theme', 'light'); } catch (e) { /* приватный режим */ }
  }, FROZEN_NOW);

  await page.goto('/index.html#operator-levels');
  await page.locator('.lv-card').first().waitFor({ timeout: 15_000 });
}

/** Элементы, вылезающие за правый край окна. */
async function overflowing(page, selector) {
  return page.evaluate(sel => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll(sel)]
      .map(el => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.right > limit + 1)
      .map(({ el, box }) => `${el.className || el.tagName}: правый край ${Math.round(box.right)} > ${limit}`);
  }, selector);
}

test.describe('Уровни — геометрия', () => {
  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await openLevels(page);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, 'появилась горизонтальная прокрутка страницы')
      .toBeLessThanOrEqual(overflow.client + 1);
  });

  test('ничего не уезжает за правый край', async ({ page }) => {
    await openLevels(page);
    const bad = await overflowing(page, '.lv-card, .lv-kpis, .lv-tabs, .lv-rule, .lv-card-code');
    expect(bad, `за экран вышли: ${bad.join('; ')}`).toEqual([]);
  });

  test('карточки в ряду одинаковой ширины', async ({ page }, testInfo) => {
    await openLevels(page);
    const widths = await page.locator('.lv-card').evaluateAll(
      cards => cards.map(c => Math.round(c.getBoundingClientRect().width)),
    );
    expect(widths.length, 'карточек нет').toBeGreaterThan(1);
    const columns = COLUMNS[testInfo.project.name];
    // Сравниваем внутри первого ряда: карточки разных рядов равны и так,
    // но нас интересует именно ряд.
    const firstRow = widths.slice(0, columns);
    expect(new Set(firstRow).size, `ширины в первом ряду разошлись: ${firstRow.join(', ')}`).toBe(1);
  });

  test('длинное условие переносится, а не растягивает карточку', async ({ page }) => {
    await openLevels(page);
    await page.evaluate(() => {
      const rule = document.querySelector('.lv-rule-text');
      if (rule) rule.textContent = 'Итоговые баллы за расчётный период не ниже 100000000 баллов подряд';
    });
    const bad = await overflowing(page, '.lv-card, .lv-rule');
    expect(bad, `длинный текст растянул карточку: ${bad.join('; ')}`).toEqual([]);
  });

  test('цели нажатия в карточке достаточного размера', async ({ page }, testInfo) => {
    await openLevels(page);
    // 44px — требование ТЗ к пальцу, поэтому спрашиваем его на телефоне.
    // На мыши достаточно 32px (WCAG 2.5.8 требует 24px), и завышать здесь
    // планку значило бы проверять не то, что нужно пользователю.
    const min = testInfo.project.name === 'mobile' ? 44 : 32;
    const small = await page.locator('.lv-card-actions button').evaluateAll(
      (buttons, limit) => buttons
        .map(b => ({ text: b.textContent.trim().slice(0, 20), h: b.getBoundingClientRect().height }))
        .filter(item => item.h < limit)
        .map(item => `${item.text}: ${Math.round(item.h)}px`),
      min,
    );
    expect(small, `меньше ${min}px: ${small.join('; ')}`).toEqual([]);
  });

  test('модалка формы помещается в окно вместе с кнопками', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    await page.locator('[data-lv-form="level"]').waitFor();

    const fits = await page.evaluate(() => {
      const dialog = document.querySelector('#modal-overlay .modal');
      const actions = document.querySelector('.lv-form-actions');
      const box = dialog.getBoundingClientRect();
      const act = actions.getBoundingClientRect();
      return {
        dialogRight: Math.round(box.right),
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        actionsVisible: act.width > 0 && act.height > 0,
        // Подвал должен быть достижим прокруткой внутри окна, а не обрезан.
        dialogScrollable: dialog.scrollHeight <= dialog.clientHeight + 1
          || getComputedStyle(dialog).overflowY !== 'visible',
      };
    });

    expect(fits.dialogRight).toBeLessThanOrEqual(fits.viewportWidth + 1);
    expect(fits.actionsVisible, 'кнопки формы не отрисовались').toBe(true);
    expect(fits.dialogScrollable, 'содержимое окна обрезано и недостижимо прокруткой').toBe(true);
  });

  test('поля формы не уезжают за края окна', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    await page.locator('[data-lv-form="level"]').waitFor();

    const bad = await page.evaluate(() => {
      const dialog = document.querySelector('#modal-overlay .modal').getBoundingClientRect();
      return [...document.querySelectorAll('.lv-form-grid .form-group')]
        .map(el => ({ name: el.dataset.field, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.right > dialog.right + 1 || box.left < dialog.left - 1)
        .map(({ name }) => name);
    });
    expect(bad, `поля вышли за окно: ${bad.join(', ')}`).toEqual([]);
  });
});
