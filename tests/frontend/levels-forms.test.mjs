/**
 * Формы экрана «Уровни».
 *
 * Главная мысль: форма не имеет права разъехаться с бэкендом молча.
 * Поэтому перечни полей, показателей и условий сверяются не с копией
 * внутри теста, а с настоящими файлами Python — schemas.py и service.py.
 * Добавили метрику на сервере и забыли в форме — тест падает.
 *
 * Функции не разбираются регулярками, а выполняются: DOM подменён
 * минимальной заглушкой, которой хватает этим формам.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const forms = await readFile(new URL('js/src/views/operator-levels/14-levels-forms-2026.view.js', root), 'utf8');
const client = await readFile(new URL('js/src/api/client/00-client-auth.js', root), 'utf8');
const schemasPy = await readFile(new URL('app/modules/operator_levels/schemas.py', root), 'utf8');
const servicePy = await readFile(new URL('app/modules/operator_levels/service.py', root), 'utf8');

function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `в исходнике нет функции ${name}`);

  // Параметры бывают с деструктуризацией — `({ run, onSuccess })`. Считать
  // фигурные скобки с первой попавшейся нельзя: она из списка аргументов,
  // и функция обрежется на сигнатуре. Сначала закрываем круглые скобки.
  let i = source.indexOf('(', start);
  let paren = 0;
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }

  let depth = 0;
  for (let j = source.indexOf('{', i); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`не нашёл конец функции ${name}`);
}

function extractConst(source, name) {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `в исходнике нет константы ${name}`);
  const open = source.indexOf(source[source.indexOf('=', start) + 2] === '[' ? '[' : '{', start);
  const close = source[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === source[open]) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(start, i + 2);
  }
  throw new Error(`не нашёл конец константы ${name}`);
}

/* ── Что на самом деле объявлено на бэкенде ──────────────────── */

/** Значения Literal OperatorLevelMetricCode из schemas.py. */
function backendMetricCodes(python) {
  const block = python.match(/OperatorLevelMetricCode = Literal\[([\s\S]*?)\]/);
  assert.ok(block, 'не нашёл Literal с кодами показателей');
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
}

/** Поля writable-схемы уровня: OperatorLevelBase + всё из Update. */
function backendLevelFields(python) {
  const base = python.match(/class OperatorLevelBase\(BaseModel\):([\s\S]*?)\n\nclass /);
  assert.ok(base, 'не нашёл OperatorLevelBase');
  return [...base[1].matchAll(/^ {4}([a-z_]+):/gm)].map(m => m[1]);
}

/** Какую границу читает _rule_ok для каждого оператора. */
function backendOperatorBounds(python) {
  const fn = python.match(/def _rule_ok\([\s\S]*?\n\ndef /);
  assert.ok(fn, 'не нашёл _rule_ok');
  const body = fn[0];
  const out = {};
  for (const op of ['gte', 'lte', 'eq', 'between']) {
    const branch = body.match(new RegExp(`operator == "${op}":([\\s\\S]*?)(?=\\n    if |\\n    return False)`));
    assert.ok(branch, `в _rule_ok нет ветки ${op}`);
    const uses = [];
    if (branch[1].includes('value_min')) uses.push('value_min');
    if (branch[1].includes('value_max')) uses.push('value_max');
    out[op] = uses;
  }
  return out;
}

const BACKEND_METRICS = backendMetricCodes(schemasPy);
const BACKEND_LEVEL_FIELDS = backendLevelFields(schemasPy);
const BACKEND_BOUNDS = backendOperatorBounds(servicePy);

/* ── Песочница ───────────────────────────────────────────────── */

const sandbox = new Function(`
  function esc(v) { return String(v ?? ''); }
  ${extractConst(forms, 'LV_METRICS')}
  ${extractConst(forms, 'LV_OPERATORS')}
  ${extractConst(forms, 'LV_LEVEL_FIELDS')}
  ${extractConst(forms, 'LV_LEVEL_DEFAULTS')}
  ${extractFn(forms, 'lvChangedOnly')}
  ${extractFn(forms, 'lvClearErrors')}
  ${extractFn(forms, 'lvSetFieldError')}
  ${extractFn(forms, 'lvSetGeneralError')}
  ${extractFn(forms, 'lvFocusFirstError')}
  ${extractFn(forms, 'lvApplyError')}
  ${extractFn(forms, 'lvSubmitOnce')}
  return { LV_METRICS, LV_OPERATORS, LV_LEVEL_FIELDS, LV_LEVEL_DEFAULTS,
           lvChangedOnly, lvApplyError, lvSubmitOnce, lvClearErrors };
`)();

const apiErrors = new Function(`
  ${extractConst(client, 'FIELD_LABELS_RU')}
  ${extractFn(client, '_formatValidationError')}
  ${extractFn(client, '_validationEntries')}
  ${extractFn(client, '_fieldErrorsFrom')}
  ${extractFn(client, '_errorMessageFromResponse')}
  return { _fieldErrorsFrom, _errorMessageFromResponse };
`)();

/* ── Минимальный DOM: ровно то, чем пользуются формы ─────────── */

function fakeForm(fieldNames) {
  const make = extra => ({
    hidden: true, textContent: '', innerHTML: '', isConnected: true,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
    },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    removeAttribute(k) { delete this._attrs[k]; },
    focus() { this.focused = true; },
    ...extra,
  });

  const errorSlots = Object.fromEntries(fieldNames.map(n => [n, make({ field: n })]));
  const controls = Object.fromEntries(fieldNames.map(n => [n, make({ field: n })]));
  const general = make({});
  const submit = make({ textContent: 'Сохранить', disabled: false });

  const form = {
    dataset: {},
    querySelector(sel) {
      if (sel === '[data-submit]') return submit;
      if (sel === '[data-form-error]') return general;
      let m = sel.match(/^\[data-error-for="(.+)"\]$/);
      if (m) return errorSlots[m[1]] || null;
      m = sel.match(/^\[name="(.+)"\]$/);
      if (m) return controls[m[1]] || null;
      if (sel === '[data-error-for]:not([hidden])') {
        const found = Object.values(errorSlots).find(s => !s.hidden);
        return found ? { getAttribute: () => found.field } : null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-error-for]') return Object.values(errorSlots);
      if (sel === '.is-invalid') {
        return Object.values(controls).filter(c => c.classList.contains('is-invalid'));
      }
      return [];
    },
    _slots: errorSlots, _controls: controls, _general: general, _submit: submit,
  };
  return form;
}

/* ── Тесты: перечни совпадают с бэкендом ─────────────────────── */

test('показатели правил совпадают с Literal на бэкенде', () => {
  const front = sandbox.LV_METRICS.map(m => m.code);
  assert.deepEqual([...front].sort(), [...BACKEND_METRICS].sort(),
    'перечень показателей в форме разошёлся с schemas.py');
});

test('у каждого показателя есть человеческая подпись', () => {
  for (const metric of sandbox.LV_METRICS) {
    assert.ok(metric.label && metric.label !== metric.code,
      `показатель ${metric.code} остался без подписи`);
  }
});

test('поля формы уровня — это writable-поля бэкенда, без выдуманных', () => {
  const front = sandbox.LV_LEVEL_FIELDS.map(f => f.name);
  const extra = front.filter(name => !BACKEND_LEVEL_FIELDS.includes(name));
  assert.deepEqual(extra, [], `форма шлёт поля, которых нет в схеме: ${extra.join(', ')}`);
});

test('форма покрывает все writable-поля уровня', () => {
  const front = sandbox.LV_LEVEL_FIELDS.map(f => f.name);
  const missing = BACKEND_LEVEL_FIELDS.filter(name => !front.includes(name));
  assert.deepEqual(missing, [], `в форме нет полей: ${missing.join(', ')}`);
});

test('вычисляемые поля не попадают в форму', () => {
  const computed = ['id', 'created_at', 'updated_at', 'stage_number', 'rules_count', 'reward_label', 'rules'];
  const front = sandbox.LV_LEVEL_FIELDS.map(f => f.name);
  for (const name of computed) {
    assert.ok(!front.includes(name), `форма пытается отправить вычисляемое поле ${name}`);
  }
});

test('is_active помечено как поле только для администратора', () => {
  const field = sandbox.LV_LEVEL_FIELDS.find(f => f.name === 'is_active');
  assert.ok(field, 'потеряно поле is_active');
  assert.equal(field.adminOnly, true,
    'бэкенд отдаёт 403 руководителю на смену is_active — поле обязано быть adminOnly');
});

test('условия правил используют те же границы, что и расчёт на бэкенде', () => {
  for (const op of sandbox.LV_OPERATORS) {
    assert.deepEqual(op.uses, BACKEND_BOUNDS[op.code],
      `условие ${op.code}: форма требует ${op.uses.join('+') || 'ничего'}, `
      + `а _rule_ok читает ${BACKEND_BOUNDS[op.code].join('+') || 'ничего'}`);
  }
});

/* ── Тесты: поведение форм ───────────────────────────────────── */

test('PATCH уходит только с изменёнными полями', () => {
  const original = { code: 'gold', name: 'Золото', is_active: true, reward_coins: 10 };
  const values = { code: 'gold', name: 'Платина', is_active: true, reward_coins: 10 };
  assert.deepEqual(sandbox.lvChangedOnly(values, original), { name: 'Платина' },
    'вместе с именем ушло бы is_active, и руководитель получил бы 403 на ровном месте');
});

test('нетронутое булево поле не считается изменённым', () => {
  const out = sandbox.lvChangedOnly({ reward_once: true }, { reward_once: true });
  assert.deepEqual(out, {});
});

test('ошибка 422 раскладывается по полям', () => {
  const form = fakeForm(['code', 'name']);
  sandbox.lvApplyError(form, {
    status: 422,
    message: 'Название: обязательное поле',
    fieldErrors: { name: 'обязательное поле' },
  });
  assert.equal(form._slots.name.hidden, false);
  assert.equal(form._slots.name.textContent, 'обязательное поле');
  assert.equal(form._controls.name._attrs['aria-invalid'], 'true');
  assert.equal(form._general.hidden, true, 'ошибка поля не должна дублироваться общим блоком');
});

test('409 про код показывается у поля «Код», а не общим сообщением', () => {
  const form = fakeForm(['code', 'name']);
  sandbox.lvApplyError(form, { status: 409, message: 'Уровень с таким кодом уже существует' });
  assert.equal(form._slots.code.hidden, false);
  assert.match(form._slots.code.textContent, /кодом уже существует/);
});

test('403 про включение уровня показывается у поля is_active', () => {
  const form = fakeForm(['is_active']);
  sandbox.lvApplyError(form, {
    status: 403, message: 'Включать и отключать уровни может только администратор',
  });
  assert.equal(form._slots.is_active.hidden, false);
});

test('400 про пустую причину показывается у поля «Причина»', () => {
  const form = fakeForm(['reason']);
  sandbox.lvApplyError(form, { status: 400, message: 'Укажите причину ручной смены уровня' });
  assert.equal(form._slots.reason.hidden, false);
});

test('ошибка без подходящего поля уходит в общий блок', () => {
  const form = fakeForm(['code']);
  sandbox.lvApplyError(form, { status: 500, message: 'Сервер недоступен' });
  assert.equal(form._general.hidden, false);
  assert.match(form._general.innerHTML, /Сервер недоступен/);
});

test('повторный submit не отправляет второй запрос', async () => {
  const form = fakeForm(['code']);
  let calls = 0;
  const slow = () => new Promise(resolve => setTimeout(() => { calls++; resolve({}); }, 20));

  const first = sandbox.lvSubmitOnce(form, { run: slow, onSuccess: () => {} });
  const second = sandbox.lvSubmitOnce(form, { run: slow, onSuccess: () => {} });
  assert.equal(form._submit.disabled, true, 'кнопка не заблокирована на время запроса');
  await Promise.all([first, second]);

  assert.equal(calls, 1, 'второй submit прошёл, хотя первый ещё выполнялся');
  assert.equal(form._submit.disabled, false, 'кнопка осталась заблокированной после ответа');
});

test('после ошибки форма снова принимает отправку', async () => {
  const form = fakeForm(['code']);
  let calls = 0;
  const failing = () => { calls++; return Promise.reject({ status: 409, message: 'Уровень с таким кодом уже существует' }); };

  await sandbox.lvSubmitOnce(form, { run: failing, onSuccess: () => {} });
  assert.equal(form._slots.code.hidden, false, 'ошибка не показана у поля');
  await sandbox.lvSubmitOnce(form, { run: failing, onSuccess: () => {} });
  assert.equal(calls, 2, 'форма осталась заблокированной после ошибки');
});

test('успешная отправка не оставляет кнопку в состоянии «Сохраняем…»', async () => {
  const form = fakeForm(['code']);
  await sandbox.lvSubmitOnce(form, { run: () => Promise.resolve({}), onSuccess: () => {} });
  assert.equal(form._submit.textContent, 'Сохранить');
  assert.equal(form._submit.disabled, false);
});

/* ── Тесты: разбор ошибок в API-клиенте ──────────────────────── */

const ENVELOPE_422 = {
  code: 'validation_error',
  message: 'Проверьте заполнение полей',
  details: [{ type: 'missing', loc: ['body', 'name'], msg: 'Field required' }],
  detail: 'Проверьте заполнение полей',
};

test('ошибки полей достаются из details, а не из уплощённого detail', () => {
  const fields = apiErrors._fieldErrorsFrom(ENVELOPE_422);
  assert.deepEqual(fields, { name: 'обязательное поле' });
});

test('вложенный loc сводится к имени поля', () => {
  const fields = apiErrors._fieldErrorsFrom({
    details: [{ type: 'missing', loc: ['body', 'rules', 0, 'metric_code'], msg: 'Field required' }],
  });
  assert.deepEqual(fields, { metric_code: 'обязательное поле' });
});

test('ограничение ge превращается в понятный текст', () => {
  const fields = apiErrors._fieldErrorsFrom({
    details: [{ type: 'greater_than_equal', loc: ['body', 'reward_coins'], ctx: { ge: 0 } }],
  });
  assert.deepEqual(fields, { reward_coins: 'не меньше 0' });
});

test('общее сообщение перестало быть безликим «Проверьте заполнение полей»', () => {
  const msg = apiErrors._errorMessageFromResponse(ENVELOPE_422, 422);
  assert.match(msg, /Название/, 'в сообщении нет имени поля');
  assert.notEqual(msg, 'Проверьте заполнение полей');
});

test('ошибка без деталей отдаёт текст сервера', () => {
  const msg = apiErrors._errorMessageFromResponse(
    { code: 'http_409', message: 'Уровень с таким кодом уже существует', details: null, detail: 'Уровень с таким кодом уже существует' },
    409,
  );
  assert.equal(msg, 'Уровень с таким кодом уже существует');
});

/* ── Статические гарантии, которые дешевле проверить текстом ─── */

test('после успешного сохранения окно закрывается принудительно', () => {
  // closeModal() без force спрашивает «данные не сохранятся» — после успеха
  // это ложная тревога.
  const successBlocks = forms.match(/onSuccess: async[\s\S]*?\n {6}\},/g) || [];
  assert.ok(successBlocks.length >= 3, 'не нашёл обработчики успеха');
  for (const block of successBlocks) {
    if (!block.includes('closeModal')) continue;
    assert.match(block, /closeModal\(true\)/,
      'closeModal без force после успеха покажет лишний вопрос про потерю данных');
  }
});

test('форма не отправляет вычисляемые поля даже случайно', () => {
  assert.ok(!/stage_number|rules_count|reward_label/.test(
    forms.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  'в коде форм упомянуто вычисляемое поле');
});
