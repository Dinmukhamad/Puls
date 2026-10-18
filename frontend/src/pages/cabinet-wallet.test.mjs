import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function component(path, mocks = {}) {
  const keys = Object.keys(mocks);
  const built = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, platform: "node", format: "cjs", packages: "external",
    jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" }, write: false,
    plugins: [{ name: "cabinet-fixture", setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, ({ path }) => {
        const key = keys.find(key => path === key || path.endsWith(`/${key}`));
        return key ? { path: `test:${key}`, external: true } : undefined;
      });
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(
    name => name.startsWith("test:") ? mocks[name.slice(5)] : require(name),
    module, module.exports,
  );
  return module.exports;
}

const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const balance = { balance: 120, available: 35, reserved: 85, earned_this_week: 14, rank: null, rank_delta: null };
const progress = {
  total: 915, available: 35, current: { title: "Уверенный специалист" },
  next: { title: "Мастер", min_coins: 1000 }, level_number: 3,
  progress: .83, remaining: 85,
};
const week = { week_id: null, metrics: [] };
const linkMocks = {
  AccessContext: { useAccess: () => ({ can: () => false, canPath: () => true }) },
  "react-router-dom": { Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children) },
};

test("the cabinet separates spendable coins and reserved purchases from lifetime level progress", async () => {
  let current = balance;
  const { CabinetPage } = await component("./CabinetPage.tsx", {
    "@tanstack/react-query": { useQuery: ({ queryKey }) => ({ data: {
      dashboard: { full_name: "Оператор", balance: current, week },
      "coin-progress": progress,
      badges: [],
    }[queryKey[0]] }) },
  });
  let html = render(CabinetPage);
  assert.match(html, /class="cabinet-wallet__amount">35<\/p>/);
  assert.match(html, /В резерве на покупки: <strong>85<\/strong> коинов\. Общий баланс: 120\./);
  assert.match(html, /class="cabinet-progress__earned"><strong>915<\/strong><span>коинов за всё время/);
  assert.match(html, /Уверенный специалист/);
  assert.match(html, /85 коинов до уровня «Мастер»/);
  assert.match(html, /Покупки не уменьшают уровень/);
  // Spending the remaining coins changes the wallet, while the earned level stays.
  current = { ...balance, balance: 85, available: 0 };
  html = render(CabinetPage);
  assert.match(html, /class="cabinet-wallet__amount">0<\/p>/);
  assert.match(html, /class="cabinet-progress__earned"><strong>915<\/strong>/);
  assert.match(html, /Уверенный специалист/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("recent cabinet transactions request the personal wallet and show only three operations without management links", async () => {
  const requests = [];
  const queries = [];
  const client = await component("../api/client.ts");
  const items = [
    { id: 41, amount: 12, reason: "Награда за обучение", tx_type: "learning_reward" },
    { id: 40, amount: -20, reason: "Покупка в магазине", tx_type: "shop_purchase", shop_request_id: 99 },
    { id: 39, amount: 7, reason: "Бонус за качество", tx_type: "manual_credit" },
    { id: 38, amount: 4, reason: "Четвёртая операция", tx_type: "manual_credit" },
  ].map(tx => ({ ...tx, user_id: 17, full_name: "Моё имя", created_at: "2026-10-03T11:00:00Z", balance_after: 120 }));
  const report = { history: { total: 4, items } };
  const { RecentTransactions } = await component("./CabinetWallet.tsx", {
    ...linkMocks,
    client: { ...client, request: async path => { requests.push(path); return report; } },
    "@tanstack/react-query": { useQuery: options => { queries.push(options); return { data: report }; } },
  });
  const html = render(RecentTransactions);
  await Promise.all(queries.map(query => query.queryFn()));
  assert.equal(requests.length, 1);
  const request = new URL(requests[0], "https://puls.example");
  assert.equal(request.pathname, "/api/v1/me/wallet");
  assert.equal(request.searchParams.get("page"), "1");
  assert.equal(request.searchParams.has("user_id"), false);
  assert.equal((html.match(/class="cabinet-transaction"/g) ?? []).length, 3);
  for (const tx of items.slice(0, 3)) assert.ok(html.includes(tx.reason));
  assert.doesNotMatch(html, /Четвёртая операция|\/admin\/|Моё имя|Фильтры|Начислить \/ списать/);
  assert.match(html, /href="\/wallet"[^>]*>Все операции/);
  assert.match(html, />\+12<span>/);
  assert.match(html, />-20<span>/);
});

test("wallet actions respect access and a zero reserve does not suggest coins are locked", async () => {
  let allowed = true;
  const { WalletCard } = await component("./CabinetWallet.tsx", {
    ...linkMocks,
    AccessContext: { useAccess: () => ({ canPath: () => allowed }) },
  });
  let html = render(WalletCard, { balance: { ...balance, reserved: 0, balance: 35 } });
  assert.match(html, /href="\/shop"/);
  assert.match(html, /href="\/wallet"/);
  assert.doesNotMatch(html, /В резерве|Общий баланс/);
  allowed = false;
  html = render(WalletCard, { balance });
  assert.doesNotMatch(html, /href=|История операций|В магазин/);
  assert.match(html, /class="cabinet-wallet__amount">35<\/p>/);
});

test("recent transactions distinguish loading and failures from a genuinely empty wallet", async () => {
  let state = { isLoading: true };
  const { RecentTransactions } = await component("./CabinetWallet.tsx", {
    "@tanstack/react-query": { useQuery: () => state },
  });
  let html = render(RecentTransactions);
  assert.match(html, /rows-skeleton/);
  assert.doesNotMatch(html, /Здесь появятся ваши операции|Не удалось загрузить/);
  state = { isError: true, error: new Error("Связь прервана"), refetch: () => {} };
  html = render(RecentTransactions);
  assert.match(html, /role="alert"/);
  assert.match(html, /Связь прервана/);
  assert.match(html, /Повторить/);
  assert.doesNotMatch(html, /Здесь появятся ваши операции|rows-skeleton/);
  state = { data: { history: { total: 0, items: [] } } };
  html = render(RecentTransactions);
  assert.match(html, /Здесь появятся ваши операции/);
  assert.doesNotMatch(html, /role="alert"|rows-skeleton|cabinet-transaction"/);
});
