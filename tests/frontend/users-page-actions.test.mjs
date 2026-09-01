/**
 * Действия экрана «Пользователи» должны звать существующие функции
 * с правильным типом аргумента.
 *
 * Что было не так: при переносе экрана на новый макет кнопка
 * «+ Новый пользователь» оказалась привязана к showUserManagementModal()
 * вместо showAddOperatorModal(). Карточка управления ищет пользователя
 * по id в STATE.users и без него молча выходит через «Пользователь не
 * найден», поэтому форма создания просто не открывалась — аккаунт создать
 * было нельзя. Остальные действия получали объект пользователя там, где
 * ожидается числовой id, и вели себя так же.
 *
 * Опечатку в имени функции не поймает ни один синтаксический тест: ошибка
 * возникает только в момент клика. Поэтому проверяем связку статически.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const screen = await readFile(new URL('js/src/views/coins/31-users-page-2026.view.js', root), 'utf8');

/** Все объявления функций во фронтенде — по ним проверяем, что вызов не в пустоту. */
async function collectDeclaredFunctions(dir, acc = new Set()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) {
      await collectDeclaredFunctions(path, acc);
    } else if (entry.name.endsWith('.js')) {
      const code = await readFile(path, 'utf8');
      for (const m of code.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
        acc.add(m[1]);
      }
    }
  }
  return acc;
}

const declared = await collectDeclaredFunctions(new URL('js/src/', root));

test('кнопка создания открывает форму создания, а не карточку управления', () => {
  assert.match(
    screen,
    /data-up="create"[\s\S]{0,200}?showAddOperatorModal\(\)/,
    'создание должно звать showAddOperatorModal — showUserManagementModal без id только покажет «Пользователь не найден»',
  );
  assert.doesNotMatch(
    screen,
    /data-up="create"[\s\S]{0,200}?showUserManagementModal/,
    'на кнопке создания снова карточка управления',
  );
});

test('модалки пользователя получают числовой id, а не объект', () => {
  const calls = [...screen.matchAll(/(showUserManagementModal|showUserResetPasswordModal|deactivateUserUi)\(([^)]*)\)/g)]
    .filter(m => m[2].trim() && !m[2].includes('userId'));
  assert.ok(calls.length >= 3, 'вызовы действий не найдены — тест устарел вместе с экраном');
  for (const [full, name, arg] of calls) {
    assert.match(
      arg,
      /Number\(/,
      `${name} принимает id числом, а получает «${arg.trim()}» — ${full.slice(0, 60)}`,
    );
  }
});

test('каждое действие экрана ссылается на существующую функцию', () => {
  const called = new Set(
    [...screen.matchAll(/\b(show[A-Z][\w$]*|deactivateUserUi|reloadUsersList)\s*\(/g)].map(m => m[1]),
  );
  assert.ok(called.size >= 4, 'вызовы модалок не найдены — тест устарел');
  const missing = [...called].filter(name => !declared.has(name));
  assert.deepEqual(missing, [], `экран зовёт несуществующие функции: ${missing.join(', ')}`);
});
