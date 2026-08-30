/**
 * Регрессии маршрутизации и целостности бандла.
 *
 * Три класса дефектов, каждый из которых уже ломал production:
 *  1. Использование переменной, объявление которой потерялось при разрезании
 *     файла (`RATING_TABS is not defined` — раздел «Рейтинг» не открывался).
 *  2. Раздел с собственным форматом адреса («Коины» писались в pathname,
 *     а не в hash — адрес раздела пропадал, Back/Forward работал через раз).
 *  3. Ссылки навигации с общим `href="#"` — ломались новая вкладка,
 *     копирование ссылки и доступность.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

const core = await readFile(new URL('js/src/app/00-core-shell.js', root), 'utf8');
const indexHtml = await readFile(new URL('index.html', root), 'utf8');
const bundle = await readFile(new URL('js/app.js', root), 'utf8');

/** Все исходники фронтенда, из которых собирается js/app.js. */
async function collectSources(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) files.push(...(await collectSources(`${path}/`)));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

test('каждый раздел из реестра маршрутов имеет заголовок и функцию отрисовки', () => {
  const registry = core.match(/const ROUTES = \{[\s\S]*?\n\};/);
  assert.ok(registry, 'реестр ROUTES не найден в ядре приложения');
  const body = registry[0];
  const entries = [...body.matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{/gm)].map(m => m[1]);
  assert.ok(entries.length >= 14, `в реестре только ${entries.length} маршрутов`);
  for (const name of entries) {
    const line = body.match(new RegExp(`'?${name}'?:\\s*\\{[^}]*\\}`));
    assert.ok(line, `маршрут ${name} не разобран`);
    assert.match(line[0], /title:/, `у маршрута ${name} нет заголовка`);
    assert.match(line[0], /render:\s*\(\)\s*=>/, `у маршрута ${name} нет ленивой render-функции`);
  }
});

test('«Коины» адресуются hash, а не отдельным путём', () => {
  assert.ok(
    !/routeUrl\s*=\s*view === 'coins'/.test(core),
    'вернулась отдельная сборка URL для «Коинов»',
  );
  assert.match(core, /function routeToHash/, 'нет единой функции построения адреса');
  const hashFn = core.match(/function routeToHash[\s\S]*?\n\}/)[0];
  assert.match(hashFn, /`#\$\{view\}\?tab=\$\{tab\}`/, 'вкладка не попадает в hash');
  assert.match(hashFn, /return `#\$\{view\}`/, 'раздел без вкладок не даёт простой hash');
});

test('Back и Forward обрабатываются, а не только правка адреса', () => {
  assert.match(core, /addEventListener\('popstate', syncRouteFromUrl\)/);
  assert.match(core, /addEventListener\('hashchange', syncRouteFromUrl\)/);
  // Повторное применение того же маршрута должно отсекаться: оба события
  // приходят на один переход по истории.
  const sync = core.match(/function syncRouteFromUrl[\s\S]*?\n\}/)[0];
  assert.match(sync, /sameView && sameTab/, 'нет защиты от двойной отрисовки');
});

test('неизвестный маршрут и раздел без прав уходят на стартовый экран', () => {
  const resolve = core.match(/function resolveRoute[\s\S]*?\n\}/)[0];
  assert.match(resolve, /isKnownRoute\(target\)/, 'неизвестный маршрут не проверяется');
  assert.match(resolve, /allowedViewsForRole\(role\)\.includes\(target\)/, 'права не проверяются');
  assert.match(resolve, /fallbackViewForRole/, 'нет запасного раздела');
});

test('ссылки навигации ведут на настоящие адреса, а не на общий "#"', () => {
  assert.equal(
    (indexHtml.match(/href="#"/g) || []).length,
    0,
    'в разметке остались ссылки с href="#"',
  );
  const links = [...indexHtml.matchAll(/<a class="side-nav-link" href="#([a-z-]+)" data-nav-target="([a-z-]+)"/g)];
  assert.ok(links.length >= 15, `найдено только ${links.length} ссылок навигации`);
  for (const [, href, target] of links) {
    assert.equal(href, target, `ссылка #${href} не совпадает с разделом ${target}`);
  }
});

test('активный пункт навигации помечается для скринридера', () => {
  assert.match(core, /setAttribute\('aria-current', 'page'\)/);
  assert.match(core, /removeAttribute\('aria-current'\)/);
});

test('смена раздела обновляет заголовок вкладки браузера', () => {
  assert.match(core, /document\.title = /, 'document.title не обновляется при навигации');
});

test('отрисовка раздела обёрнута в error boundary', () => {
  const render = core.match(/function renderView[\s\S]*?\n\}/)[0];
  assert.match(render, /try \{/, 'нет перехвата синхронной ошибки');
  assert.match(render, /catch \(error\)/, 'ошибка отрисовки не перехватывается');
  assert.match(render, /typeof result\.catch === 'function'/, 'отказ асинхронной вьюхи не перехвачен');
  assert.match(core, /function showViewError/, 'нет экрана ошибки раздела');
  // Пустой экран недопустим: пользователю нужен повтор.
  const errView = core.match(/function showViewError[\s\S]*?\n\}/)[0];
  assert.match(errView, /data-view-retry/, 'на экране ошибки нет повторной попытки');
});

test('необработанные исключения и промисы попадают в глобальный перехват', () => {
  assert.match(core, /addEventListener\('error', event/);
  assert.match(core, /addEventListener\('unhandledrejection', event/);
});

/**
 * Убирает комментарии и строковые литералы, оставляя только исполняемый код.
 * Без этого проверка ниже ловит слова из русских предложений и комментариев:
 * «… SAPAR.» выглядит как обращение к константе SAPAR.
 */
function stripLiterals(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        // Внутри шаблонной строки ${...} — снова код, его сохраняем.
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            if (depth > 0) i += 1;
          }
          out += ` ${stripLiterals(source.slice(start, i))} `;
        }
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += ' ';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

test('каждая константа верхнего регистра объявлена (регрессия RATING_TABS)', async () => {
  const sources = await collectSources('js/src/');
  const declared = new Set();
  for (const file of sources) {
    const text = await readFile(new URL(file, root), 'utf8');
    // Объявление может быть с любым отступом — например внутри функции.
    for (const m of text.matchAll(/(?:^|[\s;{(])(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\s*=/gm)) {
      declared.add(m[1]);
    }
    // Деструктуризация и параметры функций тоже объявляют имя.
    for (const m of text.matchAll(/function\s+\w+\s*\(([^)]*)\)/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/[=\s]/)[0];
        if (/^[A-Z][A-Z0-9_]{2,}$/.test(name)) declared.add(name);
      }
    }
  }

  const code = stripLiterals(bundle);
  // Именно этот класс дефекта уронил «Рейтинг»: константа-структура
  // (массив/словарь) осталась в коде, а её объявление потерялось при
  // разрезании файла. Такое обращение всегда выглядит как перебор или
  // индексация — по прозе в тексте оно не срабатывает.
  const STRUCTURE_ACCESS = /(?:^|[^\w.$])([A-Z][A-Z0-9_]{3,})\s*(?:\.(?:map|forEach|filter|find|includes|join|slice|some|every|reduce|indexOf|keys|length)\b|\[)/g;
  const used = new Set();
  for (const m of code.matchAll(STRUCTURE_ACCESS)) used.add(m[1]);

  const globals = new Set(['JSON', 'URL', 'DOM', 'XMLHttpRequest', 'NaN', 'CSS']);
  const missing = [...used].filter(name => !declared.has(name) && !globals.has(name)).sort();

  assert.deepEqual(
    missing,
    [],
    `в бандле используются необъявленные константы: ${missing.join(', ')}`,
  );
});

test('RATING_TABS объявлен ровно один раз и доступен обоим потребителям', async () => {
  const declarations = (bundle.match(/const RATING_TABS\s*=/g) || []).length;
  assert.equal(declarations, 1, `объявлений RATING_TABS: ${declarations}, ожидалось 1`);
  const usages = (bundle.match(/RATING_TABS\.map/g) || []).length;
  assert.ok(usages >= 2, `RATING_TABS используется ${usages} раз, ожидалось минимум 2`);
});

test('каждая вызываемая функция объявлена (регрессия analyticsFetch)', async () => {
  const sources = await collectSources('js/src/');
  const declared = new Set();
  for (const file of sources) {
    const text = await readFile(new URL(file, root), 'utf8');
    // Объявление функции — в любом виде и на любой вложенности.
    for (const m of text.matchAll(/(?:async\s+)?function\s+([a-z][A-Za-z0-9_]*)/g)) declared.add(m[1]);
    // Присваивание чего угодно: стрелки, функции, значения.
    for (const m of text.matchAll(/(?:const|let|var)\s+([a-z][A-Za-z0-9_]*)\s*=/g)) declared.add(m[1]);
    for (const m of text.matchAll(/window\.([a-z][A-Za-z0-9_]*)\s*=/g)) declared.add(m[1]);
    // Переменные циклов for..of / for..in.
    for (const m of text.matchAll(/for\s*\(\s*(?:const|let|var)\s+([a-z][A-Za-z0-9_]*)\s+(?:of|in)/g)) declared.add(m[1]);
    // Параметры функций: внутри тела они вызываются как обычные имена.
    for (const m of text.matchAll(/\(([^)]{0,200})\)\s*(?:\{|=>)/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^\.\.\./, '').split(/[=\s:]/)[0];
        if (/^[a-z][A-Za-z0-9_]*$/.test(name)) declared.add(name);
      }
    }
    for (const m of text.matchAll(/(?:^|[\s(,])([a-z][A-Za-z0-9_]*)\s*=>/g)) declared.add(m[1]);
    // Методы объектов и сокращённая запись.
    for (const m of text.matchAll(/([a-z][A-Za-z0-9_]*)\s*[:(]\s*(?:async\s*)?(?:function|\()/g)) declared.add(m[1]);
  }

  const code = stripLiterals(bundle);
  // Вызов вида identifier(...) в позиции выражения. Отсекаем обращения к
  // методам (obj.method()), объявления и ключевые слова.
  const KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof',
    'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'throw',
    'super', 'import', 'export', 'yield', 'case', 'instanceof', 'with', 'let',
    'const', 'var', 'class', 'extends', 'this', 'null', 'true', 'false',
  ]);
  const called = new Set();
  for (const m of code.matchAll(/(?:^|[^\w.$'"`])([a-z][A-Za-z0-9_]{3,})\s*\(/g)) {
    if (!KEYWORDS.has(m[1])) called.add(m[1]);
  }

  // Всё, что предоставляет браузер или подключённые скрипты.
  const ambient = new Set([
    'fetch', 'alert', 'confirm', 'prompt', 'setTimeout', 'setInterval',
    'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone',
    'queueMicrotask', 'btoa', 'atob', 'getComputedStyle', 'matchMedia', 'scrollTo',
    'requestIdleCallback', 'reportError', 'open', 'close', 'print', 'focus', 'blur',
    // CSS-функции: встречаются в строках стилей, куда снятие литералов не
    // достаёт из-за вложенных интерполяций внутри шаблонов.
    'rgba', 'rgb', 'rotate', 'bezier', 'translate', 'scale', 'calc', 'clamp',
    'linear', 'radial', 'hsl', 'hsla',
  ]);

  const missing = [...called]
    .filter(name => !declared.has(name) && !ambient.has(name))
    .sort();

  assert.deepEqual(
    missing,
    [],
    `в бандле вызываются необъявленные функции: ${missing.join(', ')}`,
  );
});
