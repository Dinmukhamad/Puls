import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const { StaticRouter } = require("react-router-dom/server");
async function moduleAt(path, request = async () => ({})) {
  const built = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
    platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    loader: { ".css": "empty" }, write: false,
    plugins: [{ name: "voice-client", setup(plugin) { plugin.onResolve({ filter: /(?:^\.\/|\/)(?:client)$/ }, () => ({ path: "test:client", external: true })); } }],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(name => name === "test:client" ? { request } : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const render = (Component, props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: "/" }, React.createElement(Component, props)));

test("step ids stay put, a removed step leaves its answers to be pointed again", async () => {
  const { nextStepId, removeStep } = await moduleAt("../../api/voiceScenarios.ts");
  assert.equal(nextStepId([]), "s1");
  assert.equal(nextStepId([{ id: "s1" }, { id: "s3" }]), "s2");
  assert.equal(nextStepId([{ id: "s1" }, { id: "s2" }]), "s3");
  const content = { steps: [
    { id: "s1", name: "", fallback: "", replies: [{ keywords: ["а"], driver: "x", next: "s2" }, { keywords: ["б"], driver: "y", next: "end" }] },
    { id: "s2", name: "", fallback: "", replies: [] },
  ] };
  const after = removeStep(content, "s2");
  assert.deepEqual(after.steps.map(step => step.id), ["s1"]);
  assert.deepEqual(after.steps[0].replies.map(reply => reply.next), ["", "end"]);
});

test("keywords split on commas, semicolons and new lines", async () => {
  const { splitKeywords } = await moduleAt("../../api/voiceScenarios.ts");
  assert.deepEqual(splitKeywords("такси  про, приложение;\nWhatsApp,, "), ["такси про", "приложение", "WhatsApp"]);
});

test("the editor API saves with the draft version and tests the unsaved draft", async () => {
  const calls = [];
  const { voiceScenarios } = await moduleAt("../../api/voiceScenarios.ts", async (path, options) => { calls.push({ path, options }); return {}; });
  const content = { title: "Т" };
  await voiceScenarios.save(5, 3, content);
  await voiceScenarios.publish(5, 4);
  await voiceScenarios.test(content, ["ответ"]);
  assert.deepEqual(calls.map(call => [call.path, call.options.method]), [
    ["/api/v1/admin/learning/voice-scenarios/5", "PUT"],
    ["/api/v1/admin/learning/voice-scenarios/5/publish", "POST"],
    ["/api/v1/admin/learning/voice-scenarios/test", "POST"],
  ]);
  assert.deepEqual(calls[0].options.json, { draft_version: 3, content });
  assert.deepEqual(calls[2].options.json, { content, answers: ["ответ"] });
});

test("keywords show as removable chips with the matching rules explained", async () => {
  const { KeywordInput } = await moduleAt("./VoiceScenariosPage.tsx");
  const html = render(KeywordInput, { label: "Если оператор скажет", value: ["такси про", "приложение"], onChange: () => {} });
  assert.match(html, /class="vs-chip">такси про/);
  assert.match(html, /aria-label="Убрать «приложение»"/);
  assert.match(html, /Окончания не важны/);
});
