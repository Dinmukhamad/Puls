/**
 * «Мотивация» in the site's style: the tab names are the page titles, lists are the site's, and a
 * bonus card names only the limits that are set.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const built = await build({ entryPoints: [new URL("./StoreAdminPage.tsx", import.meta.url).pathname], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { storeLimits } = module.exports;

test("a bonus card names only the limits that are set", () => {
  assert.equal(storeLimits({ stock_limit: null, per_user_monthly_limit: null, monthly_stock: null }), "Без лимитов");
  assert.equal(storeLimits({ stock_limit: null, per_user_monthly_limit: 2, monthly_stock: 8 }), "2 в месяц на сотрудника · 8 в месяц на всех");
  // Zero is a limit too: nothing may be issued.
  assert.equal(storeLimits({ stock_limit: 0, per_user_monthly_limit: null, monthly_stock: null }), "0 всего");
});

test("each tab of the section opens a page with its own name", () => {
  const titles = { "LevelsAdminPage.tsx": "Уровни", "StoreAdminPage.tsx": "Товары магазина", "AdminRequestsPage.tsx": "Заказы и выдача", "EconomyPage.tsx": "Экономика коинов", "GamesPage.tsx": "Сундук дня" };
  for (const [file, title] of Object.entries(titles)) assert.match(read(`./${file}`), new RegExp(`<h1 className="page-title">\\s*${title}\\s*</h1>`), file);
  const navigation = read("../navigation.ts");
  for (const title of Object.values(titles)) assert.match(navigation, new RegExp(`"${title}"`), title);
});

test("the section's lists are the site's, not the system's", () => {
  for (const file of ["StoreAdminPage.tsx", "EconomyPage.tsx", "GamesSettings.tsx", "LevelsAdminPage.tsx"]) assert.doesNotMatch(read(`./${file}`), /<select|<option/, file);
  assert.match(read("./StoreAdminPage.tsx"), /<Select aria-label="Статус бонусов"/);
  assert.match(read("./EconomyPage.tsx"), /<Select aria-label="Месяц"/);
});
