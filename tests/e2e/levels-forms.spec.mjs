/**
 * Формы экрана «Уровни» в настоящем браузере.
 *
 * Юнит-тесты проверяют перечни полей и разбор ошибок на заглушках DOM.
 * Здесь проверяется то, что заглушкой не поймать: форма действительно
 * открывается, введённое переживает ошибку сервера, повторный клик не
 * шлёт второй запрос, а клиентские проверки не пускают заведомо неверное.
 *
 * API подменён: снимок и поведение не должны зависеть от живых данных.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sample = JSON.parse(
  readFileSync(new URL('../fixtures/operator_levels_sample.json', import.meta.url), 'utf8'),
);

const FROZEN_NOW = new Date('2026-09-01T09:00:00').getTime();

/**
 * @param {object} options
 * @param {'ok'|'conflict'|'slow'} options.onCreate поведение POST уровня
 */
async function openLevels(page, { onCreate = 'ok' } = {}) {
  const calls = { createLevel: 0, addRule: 0, manual: 0, recalc: 0 };

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (method === 'POST' && path === '/api/admin/operator-levels') {
      calls.createLevel++;
      if (onCreate === 'conflict') {
        return json({
          code: 'http_409',
          message: 'Уровень с таким кодом уже существует',
          details: null,
          detail: 'Уровень с таким кодом уже существует',
        }, 409);
      }
      if (onCreate === 'slow') {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      return json({ ...sample.levels.json[0], id: 999 });
    }
    if (method === 'POST' && /\/rules$/.test(path)) { calls.addRule++; return json({ id: 1 }); }
    if (method === 'POST' && /level\/manual$/.test(path)) { calls.manual++; return json({ ok: true }); }
    if (method === 'POST' && /recalculate$/.test(path)) {
      calls.recalc++;
      return json({ ok: true, processed: 12, updated: 3, skipped_manual: 1 });
    }

    if (path === '/api/auth/me') return json(sample.me.json);
    if (path === '/api/admin/operator-levels') return json(sample.levels.json);
    if (path === '/api/admin/operator-levels/rewards') return json(sample.rewards.json);
    if (path === '/api/operator-levels') return json(sample.levels.json);
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
  return calls;
}

const modal = page => page.locator('#modal-overlay');

test.describe('Уровни — формы', () => {
  test('форма уровня открывается со всеми полями бэкенда', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();

    const form = page.locator('[data-lv-form="level"]');
    await expect(form).toBeVisible();

    // Перечень сверен с writable-схемой в юнит-тесте; здесь — что поля
    // действительно отрисовались, а не остались в константе.
    for (const name of ['code', 'name', 'description', 'color', 'icon', 'sort_order',
      'min_total_xp', 'reward_coins', 'reward_once', 'coin_multiplier_percent',
      'shop_discount_percent', 'is_active']) {
      await expect(form.locator(`[name="${name}"]`)).toHaveCount(1);
    }
    await expect(form.locator('.form-required')).not.toHaveCount(0);
  });

  test('пустой код не уходит на сервер и подсвечивается у поля', async ({ page }) => {
    const calls = await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();

    const form = page.locator('[data-lv-form="level"]');
    await form.locator('[name="name"]').fill('Без кода');
    await form.locator('[data-submit]').click();

    await expect(form.locator('[data-error-for="code"]')).toBeVisible();
    await expect(form.locator('[name="code"]')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.createLevel, 'заведомо неверная форма ушла на сервер').toBe(0);
  });

  test('409 показывается у поля «Код», а введённое сохраняется', async ({ page }) => {
    await openLevels(page, { onCreate: 'conflict' });
    await page.getByRole('button', { name: 'Добавить уровень' }).click();

    const form = page.locator('[data-lv-form="level"]');
    await form.locator('[name="code"]').fill('gold');
    await form.locator('[name="name"]').fill('Золотой уровень');
    await form.locator('[name="reward_coins"]').fill('42');
    await form.locator('[data-submit]').click();

    await expect(form.locator('[data-error-for="code"]')).toContainText(/кодом уже существует/);
    // Главное: окно не закрылось и не перерисовалось — вводить заново нечего.
    await expect(form.locator('[name="name"]')).toHaveValue('Золотой уровень');
    await expect(form.locator('[name="reward_coins"]')).toHaveValue('42');
  });

  test('повторный клик по «Создать» не отправляет второй запрос', async ({ page }) => {
    const calls = await openLevels(page, { onCreate: 'slow' });
    await page.getByRole('button', { name: 'Добавить уровень' }).click();

    const form = page.locator('[data-lv-form="level"]');
    await form.locator('[name="code"]').fill('twice');
    await form.locator('[name="name"]').fill('Дважды');

    const submit = form.locator('[data-submit]');
    await submit.click();
    await expect(submit).toBeDisabled();
    await submit.click({ force: true, timeout: 2000 }).catch(() => {});

    await expect(submit).toBeEnabled({ timeout: 10_000 });
    expect(calls.createLevel, 'повторный клик создал второй уровень').toBe(1);
  });

  test('условие «в диапазоне» требует верхнюю границу', async ({ page }) => {
    const calls = await openLevels(page);
    await page.locator('.lv-card').first().getByRole('button', { name: /Условия/ }).click();

    const form = page.locator('[data-lv-form="rule"]');
    await expect(form).toBeVisible();
    await form.locator('[name="operator"]').selectOption('between');
    await form.locator('[name="value_min"]').fill('5');
    await form.locator('[data-submit]').click();

    await expect(form.locator('[data-error-for="value_max"]')).toBeVisible();
    expect(calls.addRule, 'условие без границы ушло на сервер').toBe(0);
  });

  test('ручное назначение не отправляется без причины', async ({ page }) => {
    const calls = await openLevels(page);
    await page.getByRole('button', { name: 'Назначить вручную' }).click();

    const form = page.locator('[data-lv-form="manual"]');
    await expect(form).toBeVisible();
    await form.locator('[name="operator_id"]').selectOption({ index: 1 });
    await form.locator('[name="level_id"]').selectOption({ index: 1 });
    await form.locator('[data-submit]').click();

    await expect(form.locator('[data-error-for="reason"]')).toBeVisible();
    expect(calls.manual, 'назначение без причины ушло на сервер').toBe(0);
  });

  test('пересчёт показывает итог и не обещает несуществующий предпросмотр', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Пересчитать уровни' }).click();

    const form = page.locator('[data-lv-form="recalc"]');
    await expect(form).toBeVisible();
    // Режима предпросмотра на сервере нет — кнопка не должна быть кликабельной.
    await expect(form.locator('[data-mode="preview"]')).toBeDisabled();

    await form.locator('[data-submit]').click();
    const result = form.locator('[data-recalc-result]');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText('12');
    await expect(result).toContainText('3');
  });

  test('пересчёт не принимает период задом наперёд', async ({ page }) => {
    const calls = await openLevels(page);
    await page.getByRole('button', { name: 'Пересчитать уровни' }).click();

    const form = page.locator('[data-lv-form="recalc"]');
    await form.locator('[name="period_start"]').fill('2026-08-31');
    await form.locator('[name="period_end"]').fill('2026-08-01');
    await form.locator('[data-submit]').click();

    await expect(form.locator('[data-error-for="period_end"]')).toBeVisible();
    expect(calls.recalc).toBe(0);
  });

  test('модалка закрывается по Esc и возвращает фокус', async ({ page }) => {
    await openLevels(page);
    const opener = page.getByRole('button', { name: 'Добавить уровень' });
    await opener.click();
    await expect(page.locator('[data-lv-form="level"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe('Уровни — доступность', () => {
  test('фокус на заголовке раздела не рисует рамку', async ({ page }) => {
    // Проверка в браузере, а не в тексте CSS: рамку возвращало правило с той
    // же специфичностью, объявленное позже, и текстовая проверка её не видела.
    await openLevels(page);
    const outline = await page.evaluate(() => {
      const heading = document.querySelector('h1.section-title');
      heading.focus();
      const style = getComputedStyle(heading);
      return { width: style.outlineWidth, style: style.outlineStyle, focused: document.activeElement === heading };
    });
    expect(outline.focused, 'заголовок не получил фокус — проверка ничего не значит').toBe(true);
    expect(outline.width, 'вокруг названия раздела рисуется рамка').toBe('0px');
  });
});
