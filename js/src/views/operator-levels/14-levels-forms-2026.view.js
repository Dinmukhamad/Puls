/* ══════════════════════════════════════════════════════════════
   Формы экрана «Уровни»: уровень, условия, пересчёт, ручное
   назначение, отключение.

   Все поля соответствуют реальным writable-полям бэкенда
   (app/modules/operator_levels/schemas.py). Вычисляемые поля
   (stage_number, rules_count, reward_label, rules) не отправляются.

   Общие правила для всех форм здесь:
     • введённое сохраняется при 409 и 422 — окно не перерисовывается;
     • ошибка показывается у своего поля, а не только тостом;
     • повторный submit заблокирован, пока идёт запрос.
══════════════════════════════════════════════════════════════ */

/** Показатели правил — тот же перечень, что в Literal на бэкенде. */
const LV_METRICS = [
  { code: 'tenure_days', label: 'Стаж', unit: 'дн.' },
  { code: 'quality', label: 'Качество', unit: '%' },
  { code: 'kvz', label: 'КВЗ', unit: '' },
  { code: 'efficiency', label: 'Эффективность', unit: '%' },
  { code: 'penalty_minutes', label: 'Штрафы', unit: 'мин.' },
  { code: 'final_points', label: 'Итоговые баллы', unit: 'баллов' },
  { code: 'test_percent', label: 'Результат тестов', unit: '%' },
  { code: 'total_xp', label: 'XP', unit: 'XP' },
];

/**
 * Какие границы использует бэкенд для каждого условия (_rule_ok в service.py).
 * Незаполненная граница там молча означает «условие выполнено», поэтому
 * форма обязана требовать её сама — сервер такую заготовку принимает.
 */
const LV_OPERATORS = [
  { code: 'gte', label: 'не ниже', uses: ['value_min'] },
  { code: 'lte', label: 'не выше', uses: ['value_max'] },
  { code: 'eq', label: 'равно', uses: ['value_min'] },
  { code: 'between', label: 'в диапазоне', uses: ['value_min', 'value_max'] },
];

/**
 * Поля уровня, доступные на запись. Порядок задаёт порядок в форме.
 * adminOnly — поле, менять которое бэкенд разрешает только администратору.
 */
const LV_LEVEL_FIELDS = [
  {
    name: 'code', label: 'Код', type: 'text', required: true, maxlength: 64,
    hint: 'Латиницей, без пробелов. Используется в интеграциях и должен быть уникальным.',
  },
  { name: 'name', label: 'Название', type: 'text', required: true, maxlength: 120 },
  { name: 'description', label: 'Описание', type: 'textarea', maxlength: 500 },
  { name: 'color', label: 'Цвет метки', type: 'color' },
  { name: 'icon', label: 'Иконка', type: 'text', maxlength: 32, hint: 'Необязательно.' },
  {
    name: 'sort_order', label: 'Порядок', type: 'number', step: 1,
    hint: 'Чем больше число, тем выше этап. Оператор получает самый высокий подходящий.',
  },
  { name: 'min_total_xp', label: 'Минимальный XP', type: 'number', min: 0, step: 1 },
  { name: 'reward_coins', label: 'Награда, коинов', type: 'number', min: 0, step: 1 },
  {
    name: 'reward_once', label: 'Начислять награду', type: 'checkbox',
    // Семантика на бэкенде именно такая: при reward_once=false награда не
    // начисляется вообще (service.py: `if not level.reward_once: return None`),
    // а не «начисляется каждый раз».
    hint: 'Награда придёт один раз за всё время. Если снять галочку, коины не начисляются вовсе.',
  },
  {
    name: 'coin_multiplier_percent', label: 'Множитель коинов, %', type: 'number', step: 0.1,
    hint: 'Поле сохраняется, но расчёт коинов его пока не учитывает.',
  },
  {
    name: 'shop_discount_percent', label: 'Скидка в магазине, %', type: 'number', step: 0.1,
    hint: 'Поле сохраняется, но магазин его пока не учитывает.',
  },
  {
    name: 'is_active', label: 'Участвует в расчёте', type: 'checkbox', adminOnly: true,
    hint: 'Отключённый уровень не присваивается автоматически.',
  },
];

const LV_LEVEL_DEFAULTS = {
  code: '', name: '', description: '', color: '#5E5CE6', icon: '',
  sort_order: 0, min_total_xp: 0, reward_coins: 0, reward_once: true,
  coin_multiplier_percent: 0, shop_discount_percent: 0, is_active: true,
};

/**
 * Перерисовать экран и вернуть фокус в осмысленное место.
 *
 * closeModal возвращает фокус на кнопку, которая открыла окно, но следом
 * renderOperatorLevelsSettings переписывает innerHTML раздела — этой кнопки
 * больше не существует, и фокус уходит на body. Для работы с клавиатуры это
 * означает, что после каждого сохранения обход начинается заново с шапки
 * страницы. Ставим фокус на заголовок раздела: он же объявляет экран.
 */
async function lvRefreshScreen() {
  await renderOperatorLevelsSettings();
  const heading = document.querySelector('#view-operator-levels .section-title');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

/* ── Разметка полей ──────────────────────────────────────────── */

function lvControl(field, value, disabled) {
  const off = disabled ? ' disabled' : '';
  const id = `lv-f-${field.name}`;
  const attrs = [
    `id="${id}"`, `name="${field.name}"`,
    field.maxlength ? `maxlength="${field.maxlength}"` : '',
    field.min != null ? `min="${field.min}"` : '',
    field.step != null ? `step="${field.step}"` : '',
    field.required ? 'required aria-required="true"' : '',
    // Ошибка перечислена в describedby вместе с подсказкой: без ссылки на
    // неё программа экранного доступа прочитает поле как исправное.
    `aria-describedby="${id}-hint ${id}-error"`,
  ].filter(Boolean).join(' ');

  if (field.type === 'textarea') {
    return `<textarea class="form-textarea" rows="2" ${attrs}${off}>${esc(value ?? '')}</textarea>`;
  }
  if (field.type === 'checkbox') {
    return `<label class="lv-check">
      <input type="checkbox" ${attrs}${off}${value ? ' checked' : ''}>
      <span>${esc(field.label)}</span>
    </label>`;
  }
  if (field.type === 'color') {
    // Нижний регистр намеренно: браузер возвращает значение input[type=color]
    // строчными буквами, и при «#5E5CE6» в атрибуте нетронутое поле выглядело
    // изменённым — уходил лишний PATCH, а «Изменений нет» не срабатывало.
    const hex = String(value || '#5E5CE6').toLowerCase();
    return `<span class="lv-color-pair">
      <input type="color" class="lv-color-input" ${attrs}${off} value="${esc(hex)}">
      <output class="lv-color-value" for="${id}">${esc(hex)}</output>
    </span>`;
  }
  return `<input type="${field.type}" class="form-input" ${attrs}${off} value="${esc(value ?? '')}">`;
}

function lvGroup(field, value, { disabled = false, note = '' } = {}) {
  const id = `lv-f-${field.name}`;
  const labelHtml = field.type === 'checkbox'
    ? ''
    : `<label class="form-label${field.required ? ' form-required' : ''}" for="${id}">${esc(field.label)}</label>`;
  const hint = note || field.hint || '';
  return `
    <div class="form-group" data-field="${field.name}">
      ${labelHtml}
      ${lvControl(field, value, disabled)}
      <p class="form-hint" id="${id}-hint">${esc(hint)}</p>
      <p class="form-hint is-error" id="${id}-error" role="alert"
         data-error-for="${field.name}" hidden></p>
    </div>`;
}

/* ── Ошибки формы ────────────────────────────────────────────── */

function lvClearErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach(node => {
    node.hidden = true;
    node.textContent = '';
  });
  form.querySelectorAll('.is-invalid').forEach(node => {
    node.classList.remove('is-invalid');
    node.removeAttribute('aria-invalid');
  });
  const general = form.querySelector('[data-form-error]');
  if (general) { general.hidden = true; general.innerHTML = ''; }
}

function lvSetFieldError(form, name, message) {
  const slot = form.querySelector(`[data-error-for="${name}"]`);
  if (!slot) return false;
  slot.textContent = message;
  slot.hidden = false;
  const control = form.querySelector(`[name="${name}"]`);
  if (control) {
    control.classList.add('is-invalid');
    control.setAttribute('aria-invalid', 'true');
  }
  return true;
}

function lvSetGeneralError(form, message, actionsHtml = '') {
  const general = form.querySelector('[data-form-error]');
  if (!general) return;
  general.innerHTML = `<span>${esc(message)}</span>${actionsHtml}`;
  general.hidden = false;
}

function lvFocusFirstError(form) {
  const slot = form.querySelector('[data-error-for]:not([hidden])');
  const name = slot?.getAttribute('data-error-for');
  const control = name && form.querySelector(`[name="${name}"]`);
  if (control) {
    control.focus({ preventScroll: false });
    return;
  }
  // Ошибка без своего поля («Изменений нет», отказ сервера) иначе оставалась
  // незамеченной: фокус никуда не двигался, и с клавиатуры о ней было не узнать.
  const general = form.querySelector('[data-form-error]:not([hidden])');
  if (general) {
    general.setAttribute('tabindex', '-1');
    general.focus({ preventScroll: false });
  }
}

/**
 * Раскладывает ошибку сервера по полям формы.
 *
 * 422 приходит разобранным (error.fieldErrors), а 409 и 403 — общим
 * сообщением: их привязываем к полю, к которому они относятся, чтобы
 * пользователь не искал причину глазами.
 */
function lvApplyError(form, error) {
  let placed = false;

  const byField = error?.fieldErrors;
  if (byField) {
    for (const [name, message] of Object.entries(byField)) {
      if (lvSetFieldError(form, name, message)) placed = true;
    }
  }

  const message = String(error?.message || 'Не удалось сохранить');
  if (!placed && error?.status === 409 && /код/i.test(message)) {
    placed = lvSetFieldError(form, 'code', message);
  }
  if (!placed && error?.status === 403 && /включать и отключать/i.test(message)) {
    placed = lvSetFieldError(form, 'is_active', message);
  }
  if (!placed && error?.status === 400 && /причин/i.test(message)) {
    placed = lvSetFieldError(form, 'reason', message);
  }

  if (!placed) lvSetGeneralError(form, message);
  lvFocusFirstError(form);
}

/**
 * Одна точка отправки для всех форм экрана.
 * Блокирует повторный submit и не трогает введённые значения при ошибке.
 */
function lvSubmitOnce(form, { run, onSuccess, busyLabel = 'Сохраняем…' }) {
  const button = form.querySelector('[data-submit]');
  if (form.dataset.busy === '1') return Promise.resolve();
  form.dataset.busy = '1';
  const restore = button ? button.textContent : '';
  if (button) {
    // Именно aria-disabled, а не disabled: браузер снимает фокус с
    // выключенного элемента на body, то есть за пределы диалога. Отправляют
    // форму обычно с клавиатуры, стоя на этой самой кнопке, — и следующий
    // Tab уводил в боковое меню под оверлеем. Повторную отправку не пускает
    // form.dataset.busy ниже, а не атрибут.
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyLabel;
  }
  lvClearErrors(form);

  return Promise.resolve()
    .then(run)
    .then(result => onSuccess(result))
    .catch(error => { lvApplyError(form, error); })
    .finally(() => {
      form.dataset.busy = '0';
      if (button && button.isConnected) {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-busy');
        button.textContent = restore;
      }
    });
}

/** Значение поля в том виде, в котором его ждёт бэкенд. */
function lvReadField(form, field) {
  const control = form.querySelector(`[name="${field.name}"]`);
  if (!control) return undefined;
  if (field.type === 'checkbox') return control.checked;
  const raw = control.value;
  if (field.type === 'number') {
    if (raw === '' || raw == null) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }
  return String(raw ?? '').trim();
}

function lvReadLevelForm(form, fields) {
  const out = {};
  for (const field of fields) {
    const value = lvReadField(form, field);
    if (value !== undefined) out[field.name] = value;
  }
  return out;
}

/** Только изменившиеся поля: PATCH разбирает тело как exclude_unset. */
function lvChangedOnly(values, original) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const before = original?.[key];
    let same;
    if (typeof value === 'number') {
      same = Number(before ?? 0) === value;
    } else if (key === 'color') {
      // Цвет сравниваем без учёта регистра: «#64748B» с сервера и «#64748b»
      // из поля — одно и то же значение.
      same = String(before ?? '').toLowerCase() === String(value ?? '').toLowerCase();
    } else {
      same = String(before ?? '') === String(value ?? '');
    }
    if (!same) out[key] = value;
  }
  return out;
}

/* ── Форма уровня ────────────────────────────────────────────── */

function showLevelFormModal(level = null) {
  const isEdit = Boolean(level);
  const isAdmin = STATE.user?.role === 'admin';
  const values = { ...LV_LEVEL_DEFAULTS, ...(level || {}) };

  const groups = LV_LEVEL_FIELDS.map(field => {
    // Менять is_active бэкенд разрешает только администратору: показываем
    // поле выключенным с объяснением, а не даём наткнуться на 403.
    const locked = field.adminOnly && !isAdmin;
    const note = locked ? 'Включать и отключать уровни может только администратор.' : '';
    return lvGroup(field, values[field.name], { disabled: locked, note });
  }).join('');

  showModal(`
    <h2 class="modal-title">${isEdit ? 'Редактирование уровня' : 'Новый уровень'}</h2>
    <p class="modal-subtitle">Поля соответствуют настройкам уровня на сервере.</p>
    <form class="lv-form" data-lv-form="level" novalidate>
      <div class="lv-form-grid">${groups}</div>
      <p class="form-hint is-error" role="alert" data-form-error hidden></p>
      <div class="lv-form-actions">
        <button class="btn-outline" type="button" data-cancel>Отмена</button>
        <button class="btn-primary" type="submit" data-submit>
          ${isEdit ? 'Сохранить' : 'Создать уровень'}
        </button>
      </div>
    </form>`, { className: 'lv-modal' });

  const form = document.querySelector('[data-lv-form="level"]');
  if (!form) return;

  form.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal());
  form.querySelector('.lv-color-input')?.addEventListener('input', event => {
    const out = form.querySelector('.lv-color-value');
    if (out) out.textContent = event.target.value;
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    // Сбрасываем прошлые ошибки до проверок: клиентские ветки ниже уходят
    // в lvApplyError напрямую, минуя lvSubmitOnce, где сброс и происходит.
    lvClearErrors(form);
    const editable = LV_LEVEL_FIELDS.filter(f => !(f.adminOnly && !isAdmin));
    const values2 = lvReadLevelForm(form, editable);

    // Клиентские проверки — до запроса, чтобы не гонять заведомо неверное.
    if (!values2.code) return lvApplyError(form, { fieldErrors: { code: 'Укажите код уровня' } });
    if (!values2.name) return lvApplyError(form, { fieldErrors: { name: 'Укажите название' } });

    const payload = isEdit ? lvChangedOnly(values2, level) : values2;
    if (isEdit && !Object.keys(payload).length) {
      lvSetGeneralError(form, 'Изменений нет — сохранять нечего.');
      lvFocusFirstError(form);
      return;
    }

    return lvSubmitOnce(form, {
      run: () => (isEdit
        ? api.updateOperatorLevel(level.id, payload)
        : api.createOperatorLevel(payload)),
      onSuccess: async () => {
        swrInvalidate('levels:');
        closeModal(true);
        showToast(isEdit ? 'Уровень сохранён' : 'Уровень создан', 'success');
        await lvRefreshScreen();
      },
    });
  });
}

/* ── Условия уровня ──────────────────────────────────────────── */

function lvRuleRow(rule) {
  const metric = LV_METRICS.find(m => m.code === rule.metric_code);
  const op = LV_OPERATORS.find(o => o.code === rule.operator);
  const bounds = (op?.uses || [])
    .map(key => rule[key])
    .filter(v => v != null)
    .join(' – ');
  return `
    <li class="lv-rule-row" data-rule="${rule.id}">
      <span class="lv-rule-row-text">
        <strong>${esc(metric?.label || rule.metric_code)}</strong>
        ${esc(op?.label || rule.operator)} ${esc(bounds || '—')} ${esc(metric?.unit || '')}
        ${rule.is_required ? '' : '<span class="lv-rule-tag">необязательное</span>'}
      </span>
      <span class="lv-rule-row-actions">
        <button class="btn-tertiary btn-sm" type="button" data-rule-edit
                aria-label="Изменить условие «${esc(metric?.label || rule.metric_code)}»">Изменить</button>
        <button class="btn-tertiary btn-sm" type="button" data-rule-delete
                aria-label="Удалить условие «${esc(metric?.label || rule.metric_code)}»">Удалить</button>
      </span>
    </li>`;
}

function showLevelRulesModal(level, editingRule = null) {
  const rules = level.rules || [];
  const editing = editingRule || null;
  const current = editing || { metric_code: 'quality', operator: 'gte', value_min: '', value_max: '', is_required: true };

  showModal(`
    <h2 class="modal-title">Условия уровня «${esc(level.name)}»</h2>
    <p class="modal-subtitle">
      Уровень присваивается, когда выполнены все обязательные условия.
    </p>

    ${rules.length ? `<ul class="lv-rule-rows">${rules.map(lvRuleRow).join('')}</ul>`
      : `<p class="lv-empty-inline">Условий нет — уровень не будет присвоен автоматически.</p>`}

    <form class="lv-form" data-lv-form="rule" novalidate>
      <h3 class="lv-sub">${editing ? 'Изменение условия' : 'Новое условие'}</h3>
      <div class="lv-form-grid">
        <div class="form-group" data-field="metric_code">
          <label class="form-label form-required" for="lv-f-metric_code">Показатель</label>
          <select class="form-select" id="lv-f-metric_code" name="metric_code" aria-required="true" aria-describedby="lv-f-metric_code-error">
            ${LV_METRICS.map(m => `<option value="${m.code}"${m.code === current.metric_code ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
          </select>
          <p class="form-hint is-error" role="alert" id="lv-f-metric_code-error" data-error-for="metric_code" hidden></p>
        </div>
        <div class="form-group" data-field="operator">
          <label class="form-label form-required" for="lv-f-operator">Условие</label>
          <select class="form-select" id="lv-f-operator" name="operator" aria-required="true" aria-describedby="lv-f-operator-error">
            ${LV_OPERATORS.map(o => `<option value="${o.code}"${o.code === current.operator ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
          <p class="form-hint is-error" role="alert" id="lv-f-operator-error" data-error-for="operator" hidden></p>
        </div>
        <div class="form-group" data-field="value_min">
          <label class="form-label" for="lv-f-value_min">Минимум</label>
          <input class="form-input" id="lv-f-value_min" name="value_min" type="number" step="0.01"
                 aria-describedby="lv-f-value_min-hint lv-f-value_min-error"
                 value="${current.value_min ?? ''}">
          <p class="form-hint" id="lv-f-value_min-hint" data-bound-hint></p>
          <p class="form-hint is-error" role="alert" id="lv-f-value_min-error" data-error-for="value_min" hidden></p>
        </div>
        <div class="form-group" data-field="value_max">
          <label class="form-label" for="lv-f-value_max">Максимум</label>
          <input class="form-input" id="lv-f-value_max" name="value_max" type="number" step="0.01"
                 aria-describedby="lv-f-value_max-hint lv-f-value_max-error"
                 value="${current.value_max ?? ''}">
          <p class="form-hint" id="lv-f-value_max-hint" data-bound-hint></p>
          <p class="form-hint is-error" role="alert" id="lv-f-value_max-error" data-error-for="value_max" hidden></p>
        </div>
        <div class="form-group" data-field="is_required">
          <label class="lv-check">
            <input type="checkbox" name="is_required"${current.is_required ? ' checked' : ''}>
            <span>Обязательное условие</span>
          </label>
          <p class="form-hint">Необязательные условия показываются оператору, но на присвоение не влияют.</p>
          <p class="form-hint is-error" role="alert" id="lv-f-is_required-error" data-error-for="is_required" hidden></p>
        </div>
      </div>
      <p class="form-hint is-error" role="alert" data-form-error hidden></p>
      <div class="lv-form-actions">
        <button class="btn-outline" type="button" data-cancel>Закрыть</button>
        <button class="btn-primary" type="submit" data-submit>
          ${editing ? 'Сохранить условие' : 'Добавить условие'}
        </button>
      </div>
    </form>`, { className: 'lv-modal' });

  const form = document.querySelector('[data-lv-form="rule"]');
  if (!form) return;

  form.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal());

  document.querySelectorAll('[data-rule]').forEach(row => {
    const ruleId = Number(row.dataset.rule);
    const rule = rules.find(r => r.id === ruleId);
    row.querySelector('[data-rule-edit]')?.addEventListener('click', () => {
      showLevelRulesModal(level, rule);
    });
    row.querySelector('[data-rule-delete]')?.addEventListener('click', () => {
      deleteLevelRuleUi(level, rule);
    });
  });

  /** Подсказывает, какие границы нужны выбранному условию. */
  const syncBounds = () => {
    const op = LV_OPERATORS.find(o => o.code === form.querySelector('[name="operator"]').value);
    for (const key of ['value_min', 'value_max']) {
      const group = form.querySelector(`[data-field="${key}"]`);
      const used = (op?.uses || []).includes(key);
      group.classList.toggle('is-muted', !used);
      const label = group.querySelector('.form-label');
      if (label) label.classList.toggle('form-required', used);

      // Ненужную границу не просто гасим цветом: поле выключается и говорит
      // об этом словами. Раньше в него можно было ввести значение, которое
      // затем молча выбрасывалось при отправке.
      const input = group.querySelector('input');
      input.disabled = !used;
      input.toggleAttribute('aria-required', used);
      const hint = group.querySelector('[data-bound-hint]');
      if (hint) {
        hint.textContent = used
          ? 'Обязательно для выбранного условия.'
          : 'Не используется для выбранного условия.';
      }
    }
  };
  form.querySelector('[name="operator"]').addEventListener('change', syncBounds);
  syncBounds();

  form.addEventListener('submit', event => {
    event.preventDefault();
    const operator = form.querySelector('[name="operator"]').value;
    const spec = LV_OPERATORS.find(o => o.code === operator);
    const read = key => {
      const raw = form.querySelector(`[name="${key}"]`).value;
      return raw === '' ? null : Number(raw);
    };
    const payload = {
      metric_code: form.querySelector('[name="metric_code"]').value,
      operator,
      value_min: spec.uses.includes('value_min') ? read('value_min') : null,
      value_max: spec.uses.includes('value_max') ? read('value_max') : null,
      is_required: form.querySelector('[name="is_required"]').checked,
    };

    // Бэкенд принимает условие без границы и молча считает его выполненным,
    // поэтому обязательность границ проверяем здесь.
    const missing = spec.uses.filter(key => payload[key] == null);
    if (missing.length) {
      lvClearErrors(form);
      missing.forEach(key => lvSetFieldError(form, key, 'Обязательно для выбранного условия'));
      lvFocusFirstError(form);
      return;
    }
    if (operator === 'between' && payload.value_min > payload.value_max) {
      lvClearErrors(form);
      lvSetFieldError(form, 'value_max', 'Максимум должен быть не меньше минимума');
      lvFocusFirstError(form);
      return;
    }

    return lvSubmitOnce(form, {
      run: () => (editing
        ? api.updateOperatorLevelRule(editing.id, payload)
        : api.addOperatorLevelRule(level.id, payload)),
      onSuccess: async () => {
        swrInvalidate('levels:');
        closeModal(true);
        showToast(editing ? 'Условие сохранено' : 'Условие добавлено', 'success');
        await lvRefreshScreen();
      },
    });
  });
}

/**
 * Удаление условия из окна условий.
 *
 * Подтверждение открывается через тот же единственный оверлей, поэтому
 * окно условий им уничтожается. Раньше после отмены пользователь просто
 * оставался ни с чем — окно пропадало. Возвращаем его в обеих ветках.
 */
async function deleteLevelRuleUi(level, rule) {
  const metric = LV_METRICS.find(m => m.code === rule.metric_code);
  const confirmed = await uiConfirmAction({
    title: 'Удалить условие?',
    description: `Условие «${metric?.label || rule.metric_code}» перестанет учитываться при расчёте уровня «${level.name}».`,
    confirmLabel: 'Удалить условие',
  });
  if (!confirmed) {
    showLevelRulesModal(level);
    return;
  }
  try {
    await api.deleteOperatorLevelRule(rule.id);
    swrInvalidate('levels:');
    showToast('Условие удалено', 'success');
    await renderOperatorLevelsSettings();
    // Возвращаем окно с уже обновлённым списком условий.
    const fresh = await api.listAdminOperatorLevels().catch(() => null);
    const updated = fresh?.find(item => item.id === level.id);
    showLevelRulesModal(updated || { ...level, rules: (level.rules || []).filter(r => r.id !== rule.id) });
  } catch (error) {
    showToast(error.message || 'Не удалось удалить условие', 'error');
    showLevelRulesModal(level);
  }
}

/* ── Пересчёт ────────────────────────────────────────────────── */

function lvMonthBounds() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = date => date.toISOString().slice(0, 10);
  return { start: iso(first), end: iso(last) };
}

function showRecalculateModal() {
  const { start, end } = lvMonthBounds();

  showModal(`
    <h2 class="modal-title">Пересчёт уровней</h2>
    <p class="modal-subtitle">
      Показатели берутся за выбранный период по всем работающим операторам.
      Уровни, выставленные вручную, не трогаются.
    </p>
    <form class="lv-form" data-lv-form="recalc" novalidate>
      <div class="lv-form-grid">
        <div class="form-group" data-field="period_start">
          <label class="form-label form-required" for="lv-f-period_start">Начало периода</label>
          <input class="form-input" id="lv-f-period_start" name="period_start" type="date" aria-required="true" aria-describedby="lv-f-period_start-error" value="${start}">
          <p class="form-hint is-error" role="alert" id="lv-f-period_start-error" data-error-for="period_start" hidden></p>
        </div>
        <div class="form-group" data-field="period_end">
          <label class="form-label form-required" for="lv-f-period_end">Конец периода</label>
          <input class="form-input" id="lv-f-period_end" name="period_end" type="date" aria-required="true" aria-describedby="lv-f-period_end-error" value="${end}">
          <p class="form-hint is-error" role="alert" id="lv-f-period_end-error" data-error-for="period_end" hidden></p>
        </div>
      </div>

      <div class="form-group" data-field="mode">
        <p class="form-label" id="lv-f-mode-label">Режим</p>
        <p class="lv-mode-fixed">Применить — результат записывается сразу.</p>
        <p class="form-hint">
          Предпросмотра нет: сервер выполняет пересчёт и не умеет показывать
          результат без записи. Выбор появится здесь, когда появится на сервере.
        </p>
      </div>

      <p class="form-hint is-error" role="alert" data-form-error hidden></p>
      <div class="lv-result" data-recalc-result role="status" tabindex="-1" hidden></div>
      <div class="lv-form-actions">
        <button class="btn-outline" type="button" data-cancel>Отмена</button>
        <button class="btn-primary" type="submit" data-submit>Пересчитать и применить</button>
      </div>
    </form>`, { className: 'lv-modal' });

  const form = document.querySelector('[data-lv-form="recalc"]');
  if (!form) return;
  form.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal());

  form.addEventListener('submit', event => {
    event.preventDefault();
    const period_start = form.querySelector('[name="period_start"]').value;
    const period_end = form.querySelector('[name="period_end"]').value;

    lvClearErrors(form);
    // Через lvApplyError, а не lvSetFieldError: фокус на поле с ошибкой
    // ставится внутри него — иначе эти две ветки молчали для клавиатуры.
    if (!period_start) return lvApplyError(form, { fieldErrors: { period_start: 'Укажите начало периода' } });
    if (!period_end) return lvApplyError(form, { fieldErrors: { period_end: 'Укажите конец периода' } });
    if (period_start > period_end) {
      lvSetFieldError(form, 'period_end', 'Конец периода раньше начала');
      lvFocusFirstError(form);
      return;
    }

    return lvSubmitOnce(form, {
      busyLabel: 'Пересчитываем…',
      run: () => api.recalculateOperatorLevels({ period_start, period_end, mode: 'apply' }),
      onSuccess: async result => {
        const box = form.querySelector('[data-recalc-result]');
        const processed = Number(result?.processed || 0);
        const updated = Number(result?.updated || 0);
        const skipped = Number(result?.skipped_manual || 0);
        if (box) {
          box.hidden = false;
          box.innerHTML = `
            <p class="lv-result-title">Пересчёт выполнен</p>
            <ul class="lv-result-list">
              <li>Просмотрено операторов: <strong>${processed}</strong></li>
              <li>Уровень изменился у: <strong>${updated}</strong></li>
              <li>Пропущено ручных назначений: <strong>${skipped}</strong></li>
            </ul>
            <p class="form-hint">Подробности по каждому оператору — в истории уровней.</p>`;
        }
        swrInvalidate('levels:');
        showToast(updated ? `Уровень изменился у ${updated} операторов` : 'Изменений нет', 'success');
        // Окно пересчёта остаётся открытым ради итога, поэтому обновляем
        // экран без перевода фокуса на заголовок: он лежит под оверлеем.
        await renderOperatorLevelsSettings();
        box?.focus({ preventScroll: true });
      },
    });
  });
}

/* ── Ручное назначение ───────────────────────────────────────── */

async function showManualAssignModal(levels) {
  const sorted = levelsSorted(levels).filter(l => l.is_active);
  let operators = Array.isArray(STATE.operators) ? STATE.operators : [];
  if (!operators.length) {
    try { operators = await api.listOperators({ limit: 500 }); } catch { operators = []; }
  }
  const items = Array.isArray(operators?.items) ? operators.items : operators;

  showModal(`
    <h2 class="modal-title">Назначить уровень вручную</h2>
    <p class="modal-subtitle">
      Ручное назначение переживает пересчёт: автоматический подбор такой уровень не снимет.
      Поэтому причина обязательна — она попадёт в историю.
    </p>
    <form class="lv-form" data-lv-form="manual" novalidate>
      <div class="lv-form-grid">
        <div class="form-group" data-field="operator_id">
          <label class="form-label form-required" for="lv-f-operator_id">Оператор</label>
          <select class="form-select" id="lv-f-operator_id" name="operator_id" aria-required="true" aria-describedby="lv-f-operator_id-error">
            <option value="">Выберите оператора</option>
            ${items.map(op => `<option value="${op.id}">${esc(op.full_name || op.name || `#${op.id}`)}</option>`).join('')}
          </select>
          <p class="form-hint is-error" role="alert" id="lv-f-operator_id-error" data-error-for="operator_id" hidden></p>
        </div>
        <div class="form-group" data-field="level_id">
          <label class="form-label form-required" for="lv-f-level_id">Уровень</label>
          <select class="form-select" id="lv-f-level_id" name="level_id" aria-required="true" aria-describedby="lv-f-level_id-error">
            <option value="">Выберите уровень</option>
            ${sorted.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
          </select>
          <p class="form-hint is-error" role="alert" id="lv-f-level_id-error" data-error-for="level_id" hidden></p>
        </div>
      </div>
      <div class="form-group" data-field="reason">
        <label class="form-label form-required" for="lv-f-reason">Причина</label>
        <input class="form-input" id="lv-f-reason" name="reason" type="text" aria-required="true" aria-describedby="lv-f-reason-error" maxlength="200"
               placeholder="Например: перевод на новую линию">
        <p class="form-hint">Обязательно. Останется в истории уровня оператора.</p>
        <p class="form-hint is-error" role="alert" id="lv-f-reason-error" data-error-for="reason" hidden></p>
      </div>
      <div class="form-group" data-field="comment">
        <label class="form-label" for="lv-f-comment">Комментарий</label>
        <textarea class="form-textarea" id="lv-f-comment" name="comment" rows="2" maxlength="500"></textarea>
        <p class="form-hint is-error" role="alert" id="lv-f-comment-error" data-error-for="comment" hidden></p>
      </div>
      <p class="form-hint is-error" role="alert" data-form-error hidden></p>
      <div class="lv-form-actions">
        <button class="btn-outline" type="button" data-cancel>Отмена</button>
        <button class="btn-primary" type="submit" data-submit>Назначить уровень</button>
      </div>
    </form>`, { className: 'lv-modal' });

  const form = document.querySelector('[data-lv-form="manual"]');
  if (!form) return;
  form.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal());

  form.addEventListener('submit', event => {
    event.preventDefault();
    const operatorId = form.querySelector('[name="operator_id"]').value;
    const levelId = form.querySelector('[name="level_id"]').value;
    const reason = form.querySelector('[name="reason"]').value.trim();
    const comment = form.querySelector('[name="comment"]').value.trim();

    lvClearErrors(form);
    if (!operatorId) return lvApplyError(form, { fieldErrors: { operator_id: 'Выберите оператора' } });
    if (!levelId) return lvApplyError(form, { fieldErrors: { level_id: 'Выберите уровень' } });
    // Пустую причину бэкенд отбивает 400 — не тратим на это запрос.
    if (!reason) return lvApplyError(form, { fieldErrors: { reason: 'Укажите причину — она обязательна' } });

    return lvSubmitOnce(form, {
      busyLabel: 'Назначаем…',
      run: () => api.manualOperatorLevel(Number(operatorId), {
        level_id: Number(levelId), reason, comment,
      }),
      onSuccess: async () => {
        swrInvalidate('levels:');
        closeModal(true);
        showToast('Уровень назначен вручную', 'success');
        await lvRefreshScreen();
      },
    });
  });
}

/* ── Отключение уровня ───────────────────────────────────────── */

/**
 * На бэкенде DELETE — это мягкое отключение: уровень остаётся в базе с
 * is_active = false (router.py: disable_level). Поэтому в диалоге написано
 * именно то, что произойдёт, без обещания необратимого удаления.
 */
async function disableLevelUi(level) {
  if (STATE.user?.role !== 'admin') {
    showToast('Отключать уровни может только администратор', 'error');
    return;
  }
  const confirmed = await uiConfirmAction({
    title: `Отключить уровень «${level.name}»?`,
    description: 'Уровень перестанет присваиваться при пересчёте. Операторы, у которых он уже есть, '
      + 'его сохранят, а настройки и условия останутся — уровень можно включить обратно.',
    confirmLabel: 'Отключить уровень',
  });
  if (!confirmed) return;

  try {
    await api.deleteOperatorLevel(level.id);
    swrInvalidate('levels:');
    showToast('Уровень отключён', 'success');
    await lvRefreshScreen();
  } catch (error) {
    if (error?.status === 409) {
      // Защитная ветка: сегодня сервер 409 на этой операции не возвращает.
      // Если начнёт — предлагаем безопасный выход, но выполняем только по клику.
      showLevelConflictModal(level, error.message);
      return;
    }
    showToast(error?.message || 'Не удалось отключить уровень', 'error');
  }
}

/** Конфликт при отключении: объясняем и предлагаем действие, не делая его сами. */
function showLevelConflictModal(level, message) {
  showModal(`
    <h2 class="modal-title">Уровень занят</h2>
    <p class="modal-subtitle">${esc(message || 'Уровень используется и не может быть удалён.')}</p>
    <p class="form-hint">
      Безопасная замена: снять уровень с расчёта. Он перестанет присваиваться,
      но данные операторов и история сохранятся. Ничего не выполнено — выберите действие сами.
    </p>
    <form class="lv-form" data-lv-form="conflict" novalidate>
      <p class="form-hint is-error" role="alert" data-form-error hidden></p>
      <div class="lv-form-actions">
        <button class="btn-outline" type="button" data-cancel>Ничего не делать</button>
        <button class="btn-primary" type="submit" data-submit>Снять уровень с расчёта</button>
      </div>
    </form>`, { className: 'lv-modal' });

  const form = document.querySelector('[data-lv-form="conflict"]');
  if (!form) return;
  form.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal(true));

  form.addEventListener('submit', event => {
    event.preventDefault();
    return lvSubmitOnce(form, {
      busyLabel: 'Отключаем…',
      run: () => api.updateOperatorLevel(level.id, { is_active: false }),
      onSuccess: async () => {
        swrInvalidate('levels:');
        closeModal(true);
        showToast('Уровень снят с расчёта', 'success');
        await lvRefreshScreen();
      },
    });
  });
}
