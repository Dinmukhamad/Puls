import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wheel = await readFile(
  new URL('../../js/src/views/wheel/60-wheel-tests.view.js', import.meta.url),
  'utf8',
);
const wheelCss = await readFile(
  new URL('../../css/src/views/99-wheel-operator-redesign.css', import.meta.url),
  'utf8',
);

test('wheel is drawn dynamically for any number of prizes', () => {
  assert.match(wheel, /const n = items\.length/);
  assert.match(wheel, /for \(let i = 0; i < n; i\+\+\)/);
  // никаких завязок на фиксированные 8 секторов
  assert.doesNotMatch(wheel, /items\.length === 8|n === 8/);
});

test('segments use the harmonious conic palette (gradient look)', () => {
  assert.match(wheel, /WHEEL_CONIC_PALETTE/);
  assert.match(wheel, /function wheelConicColor/);
  assert.match(wheel, /wheelConicColor\(\(i \+ 0\.5\) \/ n\)/);
});

test('wheel has the gold rim treatment', () => {
  assert.match(wheel, /wheelGoldRim/);
});

test('spin button lives in the centre of the wheel', () => {
  assert.match(wheel, /class="wheel-hub wheel-hub-btn" id="wheel-spin-btn"/);
  assert.match(wheel, /'Крутить'/);
  assert.match(wheelCss, /\.wheel-hub-btn/);
});

test('pointer stays at the top of the wheel', () => {
  assert.match(wheel, /wheel-pointer wheel-pointer-v2/);
});

test('spin landing maths is preserved (result lands under the top pointer)', () => {
  assert.match(wheel, /const center = safeIdx \* seg \+ seg \/ 2/);
  assert.match(wheel, /360 - center - jitter/);
});

test('conic colour helper returns valid hex across the ring (no NaN)', () => {
  // безопасно извлекаем чистые функции цвета и выполняем их
  const grab = (name) => {
    const m = wheel.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(m, `функция ${name} должна существовать`);
    return m[0];
  };
  const palette = wheel.match(/const WHEEL_CONIC_PALETTE = (\[[^\]]*\]);/)[1];
  const factory = new Function(
    `const WHEEL_CONIC_PALETTE = ${palette};\n` +
    `${grab('wheelHexRgb')}\n${grab('wheelLerpHex')}\n${grab('wheelConicColor')}\n` +
    'return wheelConicColor;',
  );
  const conic = factory();
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.999, 1]) {
    assert.match(conic(t), /^#[0-9a-fA-F]{6}$/, `t=${t}`);
  }
});
