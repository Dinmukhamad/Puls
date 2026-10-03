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
const rules = { manual_max_abs_amount: 1000, manual_reason_min_length: 5 };
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
  assert.equal(validManualCoins("1000", "За качество", "credit", rules, 0), true);
  for (const value of ["", "0", "-1", "1.5", "1001", "Infinity", "9007199254740992"]) assert.equal(validManualCoins(value, "За качество", "credit", rules, 30), false);
  for (const reason of ["", "   ", "abc", "x".repeat(501)]) assert.equal(validManualCoins("10", reason, "credit", rules, 30), false);
  assert.equal(validManualCoins("10", "  ", "credit", { ...rules, manual_reason_min_length: 0 }, 30), false);
  assert.equal(validManualCoins("10", "Причина", "credit", rules, undefined), false);
});

test("operator picker requests server-scoped pages and reaches operators beyond the first hundred", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  let state = 0;
  const { CoinOperatorPicker } = await load("../components/CoinOperatorPicker.tsx", {
    react: { ...React, useState: () => [state++ === 0 ? "Оператор" : 6, () => {}] },
    wallet: { walletApi: { operators: (params, receivedSignal) => { calls.push({ params, signal: receivedSignal }); return Promise.resolve({ items: [operator], total: 145 }); } } },
    "@tanstack/react-query": { useQuery: (options) => { void options.queryFn({ signal }); return { data: { items: [operator], total: 145 } }; } },
  });
  const html = renderToStaticMarkup(React.createElement(CoinOperatorPicker, { onChange: () => {} }));
  assert.deepEqual(calls, [{ params: { search: "Оператор", page: 6, size: 20 }, signal }]);
  assert.match(html, /101–120 из 145/);
  assert.doesNotMatch(html, /первые 100/);
});

function sheetHarness({ role = "supervisor", available = 30, direction = "debit", reason = "За качество" } = {}) {
  const states = [operator, direction, false, "", "20", reason, false];
  const refs = [];
  let stateCursor = 0, refCursor = 0, options, calls = [], isError = false;
  const react = { ...React, useId: () => "coin-form", useState: (initial) => {
    const index = stateCursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
  }, useRef: (initial) => { const index = refCursor++; refs[index] ??= { current: initial }; return refs[index]; } };
  return {
    mocks: { react, AuthContext: { useAuth: () => ({ user: { role } }) }, Sheet: { Sheet: FakeSheet }, Toast: { useToast: () => ({ success: () => {} }) },
      endpoints: { admin: { manualCoins: (...args) => { calls.push(args); return Promise.resolve(transaction); }, gratitude: () => Promise.resolve(transaction) } },
      wallet: { ...wallet, walletApi: { operators: () => Promise.resolve({ items: [{ ...operator, available }], total: 1 }) } },
      "@tanstack/react-query": {
        useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
        useQuery: ({ queryKey }) => ({ isSuccess: true, data: queryKey[0] === "configuration-rules" ? { ...rules, driver_gratitude_bonus: 10 } : { items: [{ ...operator, available }], total: 1 }, refetch: () => Promise.resolve() }),
        useMutation: (configuration) => { options = configuration; return { isPending: false, isError, error: isError ? new Error("Connection lost") : null, mutate: () => { void options.mutationFn(); } }; },
      },
    },
    render(Component) { stateCursor = 0; refCursor = 0; const element = Component({ operator, onClose: () => {} }); return element.type === FakeSheet ? element : element.type(element.props); },
    lostResponse() { available = 5; isError = true; options.onError(new Error("Connection lost")); options.onSettled(); },
    get calls() { return calls; },
  };
}
function find(tree, predicate) {
  if (!React.isValidElement(tree)) return undefined;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props.children)) { const found = find(child, predicate); if (found) return found; }
}

test("manual debit shows available balance and blocks a second submit in the same render", async () => {
  const harness = sheetHarness();
  const { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks);
  const tree = harness.render(ManualCoinsSheet);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /В резерве/);
  assert.match(html, /Баланс после операции: <strong>80<\/strong>; доступно: <strong>10<\/strong>/);
  const submit = find(tree, (element) => element.type === "form").props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].slice(0, 3), [17, -20, "За качество"]);
});

test("uncertain debit retries the exact saved request after available balance becomes lower", async () => {
  const harness = sheetHarness();
  const { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks);
  const first = harness.render(ManualCoinsSheet);
  find(first, (element) => element.type === "form").props.onSubmit({ preventDefault() {} });
  harness.lostResponse();
  const retry = harness.render(ManualCoinsSheet);
  assert.equal(retry.props.footer.props.disabled, false);
  assert.equal(find(retry, (element) => element.type === "fieldset").props.disabled, true);
  const html = renderToStaticMarkup(retry);
  assert.match(html, /Повторить запрос/);
  assert.doesNotMatch(html, /Недостаточно доступных|Баланс после операции/);
  find(retry, (element) => element.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[1], harness.calls[0]);
});

test("trainer coin form contains no editing controls and never queries management data", async () => {
  const harness = sheetHarness({ role: "trainer" });
  harness.mocks["@tanstack/react-query"] = { useQuery: () => { throw new Error("A trainer must not load coin management data"); } };
  const { ManualCoinsSheet } = await load("../components/ManualCoinsSheet.tsx", harness.mocks);
  const html = renderToStaticMarkup(harness.render(ManualCoinsSheet));
  assert.match(html, /могут супервайзер, руководитель и администратор/);
  assert.doesNotMatch(html, /Количество коинов|Причина · обязательно|type="submit"/);
});
