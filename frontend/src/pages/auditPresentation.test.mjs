import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const result = await build({ entryPoints: [fileURLToPath(new URL("./AuditPage.tsx", import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { AuditChanges } = module.exports;
const helper = await build({ entryPoints: [fileURLToPath(new URL("./auditPresentation.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", write: false });
const helpers = { exports: {} };
new Function("require", "module", "exports", helper.outputFiles[0].text)(createRequire(import.meta.url), helpers, helpers.exports);
const { auditActionLabel, auditBusinessChanges, auditEntityLabel } = helpers.exports;

const entry = {
  id: 9481, action: "user.update", entity_type: "user", entity_id: "5741", actor_name: "Администратор",
  created_at: "2026-10-10T10:00:00Z", ip_address: "192.0.2.154", comment: "Изменена команда сотрудника",
  changes: {
    before: { full_name: "Алия Ахметова", role: "operator", is_active: true, group_id: 8539, code: "hidden_user_code" },
    after: { full_name: "Алия Ахметова", role: "supervisor", is_active: false, group_id: 8540, unexpected_field: "hidden_schema" },
    operator_ids: [6149, 6150], changed_count: 2,
  },
};

test("business audit preserves names, roles and changes without nested identifiers or unknown schemas", () => {
  const html = renderToStaticMarkup(React.createElement(AuditChanges, { entry, developer: false }));
  assert.match(html, /Алия Ахметова/);
  assert.match(html, /Роль: Оператор/);
  assert.match(html, /Роль: Супервайзер/);
  assert.match(html, /Активен: Да/);
  assert.match(html, /Активен: Нет/);
  assert.match(html, /Операторов переведено/);
  assert.doesNotMatch(html, /5741|8539|8540|6149|6150|192\.0\.2\.154|hidden_user_code|hidden_schema|Технические сведения|user\.update/);
  assert.equal(entry.changes.after.group_id, 8540);
});

test("developer can explicitly expand the complete original audit entry", () => {
  const html = renderToStaticMarkup(React.createElement(AuditChanges, { entry, developer: true }));
  assert.match(html, /<details[^>]*><summary>Технические сведения<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /5741/);
  assert.match(html, /192\.0\.2\.154/);
  assert.match(html, /hidden_user_code/);
  assert.match(html, /hidden_schema/);
});

test("audit maps known actions and entities, and never exposes unknown action or entity codes", () => {
  assert.equal(auditActionLabel("coins.manual"), "Выполнена операция с коинами");
  assert.equal(auditEntityLabel("contest_week"), "Отчётный период");
  assert.equal(auditActionLabel("internal.unknown_action"), "Действие зарегистрировано");
  assert.equal(auditEntityLabel("internal_table"), "Данные Puls");
  assert.equal(auditActionLabel("constructor"), "Действие зарегистрировано");
});

test("unrecognized enum values and unsafe value shapes are suppressed without hiding valid amounts", () => {
  assert.deepEqual(auditBusinessChanges({ role: "internal_role", tx_type: "internal_transaction", status: "internal_status", title: { id: 7891 }, amount: 250, balance: 540, is_active: true }), [
    { label: "Количество", value: "250" }, { label: "Баланс", value: "540" }, { label: "Активен", value: "Да" },
  ]);
  assert.deepEqual(auditBusinessChanges(JSON.parse('{"constructor":"internal","__proto__":"internal","before":{"user_id":4781},"after":{"metric_code":"hours_norm"}}')), []);
});

test("nested condition summaries keep thresholds while omitting internal metric references", () => {
  assert.deepEqual(auditBusinessChanges({ after: { rule_params: { metric_code: "quality", weeks: 2, gte: 95 }, kind: "positive", direction: "higher_is_better" } }), [
    { label: "Стало", value: "Условия: Недель подряд: 2; Порог: 95; Тип: Основной показатель; Направление: Больше — лучше" },
  ]);
});

test("events containing only technical changes retain a clear completion message", () => {
  const html = renderToStaticMarkup(React.createElement(AuditChanges, { entry: { ...entry, comment: null, changes: { before: { supervisor_id: 9412 }, after: { supervisor_id: 9413 } } }, developer: false }));
  assert.match(html, /Изменения сохранены/);
  assert.doesNotMatch(html, /9412|9413|supervisor_id/);
});
