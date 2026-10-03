import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function load(path, mocks = {}) {
  const keys = Object.keys(mocks);
  const built = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false,
    plugins: [{ name: "wallet-fixture", setup(plugin) { plugin.onResolve({ filter: /.*/ }, ({ path }) => {
      const key = keys.find((key) => path === key || path.endsWith(`/${key}`));
      return key ? { path: `test:${key}`, external: true } : undefined;
    }); } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((name) => name.startsWith("test:") ? mocks[name.slice(5)] : require(name), module, module.exports);
  return module.exports;
}
const wallet = await load("../api/wallet.ts");
const { validManualCoins } = await load("../components/manualCoinsValidation.ts");
const rules = { manual_max_abs_amount: 9999, manual_reason_min_length: 5 };
const operator = { user_id: 17, full_name: "Оператор команды", group_name: "Первая группа", is_active: true, balance: 100, reserved: 70, available: 30 };
const transaction = { id: 23, user_id: 17, full_name: operator.full_name, amount: -20, balance_after: 80, tx_type: "manual_debit", reason: "Исправление ошибки", created_at: "2026-10-03T11:00:00Z", author_name: "Руководитель", author_role: "head", is_system: false };
const report = { summary: { balance: 100, available: 30, reserved: 70, earned_total: 200, awarded: 20, spent: 20, refunded: 0 }, history: { total: 1, items: [transaction] } };
const FakeSheet = ({ title, subtitle, children, footer }) => React.createElement("section", { role: "dialog" }, React.createElement("h2", null, title), subtitle, children, footer);
const FakeLink = ({ to, children }) => React.createElement("a", { href: to }, children);

test("coin editing is limited to supervisors, heads and administrators", async () => {
  assert.deepEqual(["operator", "trainer", "supervisor", "head", "admin", undefined].map(wallet.canManageCoins), [false, false, true, true, true, false]);
  let role = "supervisor";
  const { WalletPage } = await load("./WalletPage.tsx", {
    AuthContext: { useAuth: () => ({ user: { role } }) }, AccessLink: { AccessLink: FakeLink },
    "react-router-dom": { useSearchParams: () => [new URLSearchParams(), () => {}] },
    "@tanstack/react-query": { useQuery: ({ queryKey }) => ({ data: queryKey[0] === "wallet" ? report : undefined }) },
  });
  for (role of ["supervisor", "head", "admin", "trainer", "operator"]) {
    const html = renderToStaticMarkup(React.createElement(WalletPage, { administrative: true }));
    assert.match(html, /История коинов/);
    assert.equal(html.includes("Начислить / списать"), wallet.canManageCoins(role));
    if (role === "supervisor") assert.match(html, /операторов ваших групп/);
    if (role === "head" || role === "admin") assert.match(html, /всех операторов/);
    if (role === "operator") assert.match(html, /доступных вам операций/);
  }
});

test("ledger identifies reason, actor, operation and resulting balance without mislabelling missing manual authors", async () => {
  assert.equal(wallet.walletAuthor({ ...transaction, author_name: null }), "Автор недоступен");
  assert.equal(wallet.walletAuthor({ ...transaction, author_name: null, tx_type: "manual_credit", is_system: undefined }), "Автор недоступен");
  assert.equal(wallet.walletAuthor({ ...transaction, author_name: null, tx_type: "learning_reward", is_system: true }), "Система");
  const { WalletPage } = await load("./WalletPage.tsx", {
    AuthContext: { useAuth: () => ({ user: { role: "head" } }) }, AccessLink: { AccessLink: FakeLink },
    "react-router-dom": { useSearchParams: () => [new URLSearchParams(), () => {}] },
    "@tanstack/react-query": { useQuery: ({ queryKey }) => ({ data: queryKey[0] === "wallet" ? report : undefined }) },
  });
  const html = renderToStaticMarkup(React.createElement(WalletPage, { administrative: true }));
  for (const expected of [/Исправление ошибки/, /Руководитель · Руководитель/, /Операция №23/, /Баланс после 80/, /-20/]) assert.match(html, expected);
});

test("manual validation protects reserved coins and rejects invalid amounts and empty reasons even with a zero configured minimum", () => {
  assert.equal(validManualCoins("30", "За качество", "debit", rules, 30), true);
  assert.equal(validManualCoins("31", "За качество", "debit", rules, 30), false);
  assert.equal(validManualCoins("9999", "За качество", "credit", rules, 0), true);
  for (const value of ["", "0", "-1", "1.5", "10000", "Infinity", "9007199254740992"]) assert.equal(validManualCoins(value, "За качество", "credit", rules, 30), false);
  for (const reason of ["", "   ", "abc", "x".repeat(501)]) assert.equal(validManualCoins("10", reason, "credit", rules, 30), false);
  assert.equal(validManualCoins("10", "  ", "credit", { ...rules, manual_reason_min_length: 0 }, 30), false);
  assert.equal(validManualCoins("10", "Причина", "credit", rules, undefined), false);
});

function find(tree, predicate) {
  if (!React.isValidElement(tree)) return undefined;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props.children)) { const found = find(child, predicate); if (found) return found; }
}
function hooks(initial = []) {
  const states = [...initial]; const refs = []; let stateCursor = 0, refCursor = 0;
  return { react: { ...React, useId: () => "coin-test", useMemo: (factory) => factory(), useEffect: () => {},
    useState: (initial) => { const index = stateCursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useRef: (initial) => { const index = refCursor++; refs[index] ??= { current: initial }; return refs[index]; } },
    reset() { stateCursor = 0; refCursor = 0; } };
}
async function pickerHarness({ search = "", settled = search, page = 1, items = [operator], total = items.length, props = {} } = {}) {
  const fixture = hooks([search, settled, page, true, -1]), calls = [], signal = new AbortController().signal;
  const { CoinOperatorPicker } = await load("../components/CoinOperatorPicker.tsx", {
    react: fixture.react, wallet: { walletApi: { operators: (params, receivedSignal) => { calls.push({ params, signal: receivedSignal }); return Promise.resolve({ items, total }); } } },
    "@tanstack/react-query": { useQuery: (options) => { if (options.enabled) void options.queryFn({ signal }); return { data: { items, total } }; } },
  });
  return { calls, signal, render() { fixture.reset(); return CoinOperatorPicker(props); } };
}
test("empty operator search shows no full list and makes no management request", async () => {
  const harness = await pickerHarness(), html = renderToStaticMarkup(harness.render());
  assert.equal(harness.calls.length, 0); assert.match(html, /role="combobox"/); assert.doesNotMatch(html, /<select|role="option"|Оператор команды/);
});
test("live search renders scoped names below input and reaches later pages", async () => {
  const harness = await pickerHarness({ search: "Оператор", page: 12, total: 145 }), html = renderToStaticMarkup(harness.render());
  assert.deepEqual(harness.calls, [{ params: { search: "Оператор", page: 12, size: 10 }, signal: harness.signal }]);
  assert.match(html, /role="listbox"/); assert.match(html, /role="option"[^>]*>[\s\S]*Оператор команды/); assert.match(html, /12 \/ 15/);
  assert.ok(html.indexOf('role="combobox"') < html.indexOf('role="listbox"')); assert.doesNotMatch(html, /<select/);
});
test("a changed search hides previous matches before debounce completes", async () => {
  const harness = await pickerHarness({ search: "Айжан", settled: "Оператор" }), html = renderToStaticMarkup(harness.render());
  assert.equal(harness.calls.length, 0); assert.match(html, /Поиск операторов/); assert.doesNotMatch(html, /role="option"|Оператор команды/);
});
test("keyboard selects operator, clears search and removes selected chip", async () => {
  const changes = [], second = { ...operator, user_id: 19, full_name: "Второй оператор" };
  const harness = await pickerHarness({ search: "Оператор", props: { selected: operator, onChange: (value) => changes.push(value) }, items: [second] });
  let tree = harness.render(); find(tree, (node) => node.props.role === "combobox").props.onKeyDown({ key: "ArrowDown", preventDefault() {} });
  tree = harness.render(); assert.match(renderToStaticMarkup(tree), /aria-activedescendant="coin-test-results-19"/);
  find(tree, (node) => node.props.role === "combobox").props.onKeyDown({ key: "Enter", preventDefault() {} }); assert.equal(changes[0].user_id, 19);
  tree = harness.render(); assert.equal(find(tree, (node) => node.props.role === "combobox").props.value, ""); assert.equal(find(tree, (node) => node.props.role === "listbox"), undefined);
  find(tree, (node) => node.props["aria-label"] === `Убрать оператора ${operator.full_name}`).props.onClick(); assert.equal(changes[1], undefined);
});
test("multiple selection excludes existing chips, accepts mouse click and closes on Escape", async () => {
  const added = [], removed = [], second = { ...operator, user_id: 19, full_name: "Второй оператор" };
  const harness = await pickerHarness({ search: "Оператор", items: [operator, second], props: { selectedOperators: [operator], onAdd: (value) => added.push(value), onRemove: (id) => removed.push(id) } });
  let tree = harness.render(); assert.doesNotMatch(renderToStaticMarkup(tree), /id="coin-test-results-17"/);
  find(tree, (node) => node.props.role === "option").props.onClick(); assert.deepEqual(added, [second]);
  tree = harness.render(); find(tree, (node) => node.props["aria-label"] === `Убрать оператора ${operator.full_name}`).props.onClick(); assert.deepEqual(removed, [17]);
  find(tree, (node) => node.props.role === "combobox").props.onChange({ target: { value: "Новый" } }); tree = harness.render();
  find(tree, (node) => node.props.role === "combobox").props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(find(harness.render(), (node) => node.props.role === "combobox").props["aria-expanded"], false);
});
function sheetHarness({ role = "supervisor", available = 30, previewCount = 1 } = {}) {
  const fixture = hooks(); let options, calls = [], isError = false;
  return {
    mocks: { react: fixture.react, AuthContext: { useAuth: () => ({ user: { role } }) }, Sheet: { Sheet: FakeSheet }, Toast: { useToast: () => ({ success: () => {} }) },
      endpoints: { admin: { gratitude: () => Promise.resolve(transaction) } },
      wallet: { ...wallet, walletApi: { groups: () => Promise.resolve([]), operators: () => Promise.resolve({ items: [{ ...operator, available }], total: 1 }), preview: () => Promise.resolve({}),
        manualBatch: (batch) => { calls.push(structuredClone(batch)); return Promise.resolve({ count: previewCount, total_amount: batch.amount * previewCount, transaction_ids: [23] }); } } },
      "@tanstack/react-query": {
        useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
        useQuery: ({ queryKey }) => {
          let data;
          if (queryKey[0] === "configuration-rules") data = { ...rules, driver_gratitude_bonus: 10 };
          else if (queryKey[0] === "wallet-groups") data = [{ group_id: 5, name: "Первая группа", operators_count: previewCount }];
          else if (queryKey[0] === "wallet-preview") {
            const amount = queryKey[2], count = "user_ids" in queryKey[1] ? queryKey[1].user_ids.length : previewCount;
            data = { count, eligible_count: amount >= 0 || -amount <= available ? count : 0, insufficient_count: amount < 0 && -amount > available ? count : 0,
              balance: 100 * count, available: available * count, reserved: (100 - available) * count, min_available: available, amount, total_amount: amount * count,
              can_submit: count > 0 && (amount >= 0 || -amount <= available), selection_token: `frozen-selection-${count}` };
          } else data = { items: [{ ...operator, available }], total: 1 };
          return { isSuccess: true, isFetching: false, data, refetch: () => Promise.resolve() };
        },
        useMutation: (configuration) => { options = configuration; return { isPending: false, isError, error: isError ? new Error("Connection lost") : null, mutate: () => { void options.mutationFn(); } }; },
      },
    },
    render(Component, props = {}) { fixture.reset(); const element = Component({ operator, onClose: () => {}, ...props }); return element.type === FakeSheet ? element : element.type(element.props); },
    lostResponse() { available = 5; previewCount = 9; isError = true; options.onError(new Error("Connection lost")); options.onSettled(); }, get calls() { return calls; },
  };
}
function changeForm(tree, { amount, reason, direction, mode } = {}) {
  if (amount !== undefined) find(tree, (node) => node.type === "input" && node.props.type === "number").props.onChange({ target: { value: amount } });
  if (reason !== undefined) find(tree, (node) => node.type === "textarea").props.onChange({ target: { value: reason } });
  if (direction) find(tree, (node) => node.props.label === "Направление операции").props.onChange(direction);
  if (mode) find(tree, (node) => node.props.label === "Получатели коинов").props.onChange(mode);
}
test("debit previews protected balances and blocks duplicate submission in the same render", async () => {
  const harness = sheetHarness(), { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks);
  changeForm(harness.render(ManualCoinsSheet), { direction: "debit", amount: "20", reason: "За качество" });
  const tree = harness.render(ManualCoinsSheet), html = renderToStaticMarkup(tree);
  assert.match(html, /В резерве/); assert.match(html, /Баланс после операции: <strong>80<\/strong>; доступно: <strong>10<\/strong>/); assert.doesNotMatch(html, /Исправление ошибочного начисления/);
  const submit = find(tree, (node) => node.type === "form").props.onSubmit; submit({ preventDefault() {} }); submit({ preventDefault() {} }); assert.equal(harness.calls.length, 1);
  assert.deepEqual({ ...harness.calls[0], request_id: "saved" }, { user_ids: [17], amount: -20, reason: "За качество", request_id: "saved", selection_token: "frozen-selection-1" });
});
test("uncertain group debit retries exact selection after balances and membership change", async () => {
  const harness = sheetHarness({ available: 30, previewCount: 2 }), { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks);
  changeForm(harness.render(ManualCoinsSheet), { mode: "groups", direction: "debit", amount: "20", reason: "За качество" });
  let tree = harness.render(ManualCoinsSheet); find(tree, (node) => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
  tree = harness.render(ManualCoinsSheet); find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} }); harness.lostResponse();
  const retry = harness.render(ManualCoinsSheet); assert.equal(retry.props.footer.props.disabled, false); assert.equal(find(retry, (node) => node.type === "fieldset").props.disabled, true);
  const html = renderToStaticMarkup(retry); assert.match(html, /Повторить запрос/); assert.doesNotMatch(html, /Недостаточно доступных|Общий баланс после операции/);
  find(retry, (node) => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(harness.calls.length, 2); assert.deepEqual(harness.calls[1], harness.calls[0]);
  assert.deepEqual(harness.calls[1].group_ids, [5]); assert.equal(harness.calls[1].selection_token, "frozen-selection-2");
});
test("9999 can be credited to all scoped operators but 10000 disables confirmation", async () => {
  const harness = sheetHarness({ available: 0, previewCount: 61 }), { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks);
  changeForm(harness.render(ManualCoinsSheet), { mode: "all", amount: "9999", reason: "За качество" }); let tree = harness.render(ManualCoinsSheet);
  assert.equal(tree.props.footer.props.disabled, false); const html = renderToStaticMarkup(tree); assert.match(html, /Получателей: <strong>61<\/strong>/); assert.match(html, /max="9999"/);
  find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(harness.calls[0].all_operators, true); assert.equal(harness.calls[0].amount, 9999);
  const another = sheetHarness({ available: 0, previewCount: 61 }), { ManualCoinsSheet: AnotherSheet } = await load("../components/ManualCoinsSheet.tsx", another.mocks);
  changeForm(another.render(AnotherSheet), { mode: "all", amount: "10000", reason: "За качество" }); tree = another.render(AnotherSheet); assert.equal(tree.props.footer.props.disabled, true);
  find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(another.calls.length, 0);
});
test("trainer form has no editing controls and never queries management data", async () => {
  const harness = sheetHarness({ role: "trainer" }); harness.mocks["@tanstack/react-query"] = { useQuery: () => { throw new Error("Trainer cannot load coin management data"); } };
  const { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks), html = renderToStaticMarkup(harness.render(ManualCoinsSheet));
  assert.match(html, /могут супервайзер, руководитель и администратор/); assert.doesNotMatch(html, /Количество коинов|Причина · обязательно|type="submit"/);
});
