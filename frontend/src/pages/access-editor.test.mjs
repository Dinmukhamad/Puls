import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const { applyAccessDraft, draftEffect, sourceDescription } = await load("./accessEditor.ts");
const { AccessSwitch } = await load("./AccessAdminPage.tsx");
const policy = { revision: 4, sections: [], rules: [
  { target_type: "role", target_id: "operator", section: "training", effect: "deny" },
  { target_type: "user", target_id: "12", section: "training", effect: "allow" },
  { target_type: "user", target_id: "12", section: "results", effect: "deny" },
] };

test("applying a bulk draft updates only selected rules and retains exceptions", () => {
  const next = applyAccessDraft(policy, { target_type: "role", target_ids: ["operator", "head"], changes: [{ section: "training", effect: "allow" }] }, 5);
  assert.equal(next.revision, 5);
  assert.equal(next.rules.length, 4);
  assert.deepEqual(next.rules.filter(r => r.target_type === "user"), policy.rules.filter(r => r.target_type === "user"));
  assert.equal(policy.revision, 4);
  const inherited = applyAccessDraft(policy, { target_type: "user", target_ids: ["12"], changes: [{ section: "training", effect: "inherit" }] }, 5);
  assert.equal(inherited.rules.length, 2);
  assert.ok(inherited.rules.some(r => r.section === "results"));
});
test("returning a switch to its saved rule removes only that draft change", () => {
  assert.deepEqual(draftEffect(policy, "role", ["operator"], { training: "allow", results: "deny" }, "training", "deny"), { results: "deny" });
  assert.deepEqual(draftEffect(policy, "role", ["operator", "head"], {}, "training", "deny"), { training: "deny" });
  assert.deepEqual(draftEffect(policy, "user", ["20"], { training: "allow" }, "training", "inherit"), {});
  assert.deepEqual(draftEffect(policy, "user", ["20"], { training: "deny" }, "training", "allow", "on"), {});
});
test("mixed switches explain the state and expose keyboard-accessible checkboxes", () => {
  const html = renderToStaticMarkup(React.createElement(AccessSwitch, { title: "Обучение", state: "mixed", disabled: false, onChange() {} }));
  assert.match(html, /type="checkbox"/);
  assert.match(html, /aria-label="Доступ: Обучение" aria-checked="mixed"/);
  assert.match(html, /Разный доступ/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(renderToStaticMarkup(React.createElement(AccessSwitch, { title: "Аудит", state: "off", disabled: true, onChange() {} })), /disabled=""/);
});
test("rule sources explain inherited and mixed decisions", () => {
  assert.match(sourceDescription({ group: 1 }), /Настройка группы/);
  assert.match(sourceDescription({ role: 1, user: 2 }), /Настройка роли, Личное исключение/);
});
