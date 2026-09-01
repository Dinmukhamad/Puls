/**
 * Клавиатура и доступные подписи экрана «Уровни» (шаг 8 ТЗ).
 *
 * Проверяется поведение в браузере, а не наличие атрибутов в исходнике:
 * роль без работающих стрелок и aria-describedby, указывающий не туда,
 * выглядят в коде одинаково правильно.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sample = JSON.parse(
  readFileSync(new URL('../fixtures/operator_levels_sample.json', import.meta.url), 'utf8'),
);

const FROZEN_NOW = new Date('2026-09-01T09:00:00').getTime();

async function openLevels(page, { onCreate = 'ok' } = {}) {
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (request.method() === 'POST' && path === '/api/admin/operator-levels') {
      if (onCreate === 'conflict') {
        return json({
          code: 'http_409', message: 'Уровень с таким кодом уже существует',
          details: null, detail: 'Уровень с таким кодом уже существует',
        }, 409);
      }
      return json({ ...sample.levels.json[0], id: 999 });
    }
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

test.describe('Уровни — клавиатура', () => {
  test('стрелки переводят фокус между вкладками, не переключая раздел', async ({ page }) => {
    await openLevels(page);
    const tabs = page.locator('[role="tab"]');
    await tabs.first().focus();

    const before = page.url();
    await page.keyboard.press('ArrowRight');

    await expect(tabs.nth(1)).toBeFocused();
    // Переключение вкладки грузит данные: на каждое нажатие стрелки этого
    // происходить не должно.
    expect(page.url(), 'стрелка переключила раздел, а не только фокус').toBe(before);
  });

  test('Home и End переводят фокус на крайние вкладки', async ({ page }) => {
    await openLevels(page);
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    await tabs.first().focus();

    await page.keyboard.press('End');
    await expect(tabs.nth(count - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.first()).toBeFocused();
  });

  test('Enter на вкладке переключает раздел', async ({ page }) => {
    await openLevels(page);
    const tabs = page.locator('[role="tab"]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/tab=achievements/);
  });

  test('в обход табом попадает ровно одна вкладка', async ({ page }) => {
    await openLevels(page);
    // Roving tabindex: группа вкладок — одна остановка таба, внутри стрелки.
    const reachable = await page.locator('[role="tab"]').evaluateAll(
      tabs => tabs.filter(t => t.getAttribute('tabindex') !== '-1').length,
    );
    expect(reachable, 'вкладки должны быть одной остановкой таба').toBe(1);
  });

  test('панель связана с активной вкладкой', async ({ page }) => {
    await openLevels(page);
    const panel = page.locator('#lv-body');
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    const labelledBy = await panel.getAttribute('aria-labelledby');
    const activeTab = page.locator('[role="tab"][aria-selected="true"]');
    await expect(activeTab).toHaveAttribute('id', labelledBy);
    await expect(page.locator('[role="tab"]').first()).toHaveAttribute('aria-controls', 'lv-body');
  });

  test('все кнопки карточки достижимы с клавиатуры', async ({ page }) => {
    await openLevels(page);
    const unreachable = await page.locator('.lv-card-actions button').evaluateAll(
      buttons => buttons
        .filter(b => b.tabIndex < 0 || b.disabled)
        .map(b => b.textContent.trim()),
    );
    expect(unreachable, `недостижимы табом: ${unreachable.join(', ')}`).toEqual([]);
  });

  test('после сохранения фокус не теряется на body', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    const form = page.locator('[data-lv-form="level"]');
    await form.locator('[name="code"]').fill('kb_test');
    await form.locator('[name="name"]').fill('С клавиатуры');
    await form.locator('[data-submit]').click();

    await expect(page.locator('#modal-overlay')).toBeHidden({ timeout: 10_000 });
    const active = await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      cls: document.activeElement.className,
    }));
    expect(active.tag, 'фокус ушёл на body — обход табом начнётся с шапки')
      .not.toBe('BODY');
  });
});

test.describe('Уровни — доступные подписи', () => {
  test('у каждого поля формы есть связанная подпись', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    await page.locator('[data-lv-form="level"]').waitFor();

    const unlabelled = await page.evaluate(() => {
      const form = document.querySelector('[data-lv-form="level"]');
      return [...form.querySelectorAll('input, select, textarea')]
        .filter(el => {
          if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
          if (el.closest('label')) return false;
          return !form.querySelector(`label[for="${el.id}"]`);
        })
        .map(el => el.name || el.id);
    });
    expect(unlabelled, `поля без подписи: ${unlabelled.join(', ')}`).toEqual([]);
  });

  test('обязательность поля объявляется программно', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    const form = page.locator('[data-lv-form="level"]');

    // Звёздочка в классе .form-required — визуальный признак; программе
    // экранного доступа нужен aria-required.
    await expect(form.locator('[name="code"]')).toHaveAttribute('aria-required', 'true');
    await expect(form.locator('[name="name"]')).toHaveAttribute('aria-required', 'true');
  });

  test('ошибка поля связана с полем и объявляется', async ({ page }) => {
    await openLevels(page, { onCreate: 'conflict' });
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    const form = page.locator('[data-lv-form="level"]');
    await form.locator('[name="code"]').fill('gold');
    await form.locator('[name="name"]').fill('Золото');
    await form.locator('[data-submit]').click();

    const errorSlot = form.locator('[data-error-for="code"]');
    await expect(errorSlot).toBeVisible();
    // role=alert — сообщение объявляется в момент появления.
    await expect(errorSlot).toHaveAttribute('role', 'alert');

    const linked = await page.evaluate(() => {
      const input = document.querySelector('[data-lv-form="level"] [name="code"]');
      const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
      const slot = document.querySelector('[data-error-for="code"]');
      return ids.includes(slot.id) && slot.id.length > 0;
    });
    expect(linked, 'aria-describedby не ссылается на сообщение об ошибке').toBe(true);
  });

  test('поле с ошибкой помечено как неверное', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    const form = page.locator('[data-lv-form="level"]');
    await form.locator('[name="name"]').fill('Без кода');
    await form.locator('[data-submit]').click();

    await expect(form.locator('[name="code"]')).toHaveAttribute('aria-invalid', 'true');
  });

  test('кнопка условий называет свой уровень и сохраняет видимый текст', async ({ page }) => {
    await openLevels(page);
    const button = page.locator('.lv-card').first().locator('[data-lv-rules]');

    // WCAG 2.5.3: доступное имя обязано содержать видимую надпись целиком.
    // aria-label «Условия уровня «Стажёр»» это правило нарушал — счётчика
    // «· 3» в имени не было, и голосовое управление по надписи не работало.
    const visible = (await button.innerText()).trim();
    const accessible = await button.evaluate(el => el.textContent.replace(/\s+/g, ' ').trim());
    expect(accessible, 'видимая надпись выпала из доступного имени')
      .toContain(visible.split('\n')[0].trim());
    expect(accessible, 'имя не называет уровень').toMatch(/уровня «.+»/);
  });

  test('номер этапа не спрятан от программы экранного доступа', async ({ page }) => {
    await openLevels(page);
    const stage = page.locator('.lv-card').first().locator('.lv-stage');
    await expect(stage).not.toHaveAttribute('aria-hidden', 'true');
    // Голое число без слова непонятно на слух.
    await expect(stage).toContainText('Этап');
  });

  test('обязательность поля видна не только цветом', async ({ page }) => {
    await openLevels(page);
    await page.getByRole('button', { name: 'Добавить уровень' }).click();
    await page.locator('[data-lv-form="level"]').waitFor();

    const marker = await page.evaluate(() => {
      const label = document.querySelector('[data-lv-form="level"] .form-required');
      return getComputedStyle(label, '::after').content;
    });
    expect(marker, 'обязательность держится на одном цвете').toMatch(/\*/);
  });

  test('ненужная граница условия выключается, а не просто бледнеет', async ({ page }) => {
    await openLevels(page);
    await page.locator('.lv-card').first().getByRole('button', { name: /Условия/ }).click();
    const form = page.locator('[data-lv-form="rule"]');
    await form.waitFor();

    // «не ниже» использует только минимум: в максимум вводить нечего, и его
    // значение всё равно отбрасывается при отправке.
    await form.locator('[name="operator"]').selectOption('gte');
    await expect(form.locator('[name="value_max"]')).toBeDisabled();
    await expect(form.locator('[data-field="value_max"] [data-bound-hint]'))
      .toContainText('Не используется');

    await form.locator('[name="operator"]').selectOption('between');
    await expect(form.locator('[name="value_max"]')).toBeEnabled();
  });

  test('ошибка без своего поля получает фокус', async ({ page }) => {
    await openLevels(page);
    // Открываем редактирование и сохраняем, ничего не поменяв.
    await page.locator('.lv-card').first().getByRole('button', { name: 'Редактировать' }).click();
    const form = page.locator('[data-lv-form="level"]');
    await form.waitFor();
    await form.locator('[data-submit]').click();

    const general = form.locator('[data-form-error]');
    await expect(general).toBeVisible();
    await expect(general).toHaveAttribute('role', 'alert');
    await expect(general).toBeFocused();
  });
});
