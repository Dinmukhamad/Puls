import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// PwaProvider опрашивает браузер уже при первом рендере; эффекты в SSR не идут.
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };

const require = createRequire(import.meta.url);
const built = await build({
  entryPoints: [fileURLToPath(new URL("./PwaProvider.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, write: false, define: { "import.meta.env": '{"PROD":true}' },
  plugins: [{ name: "test-auth", setup(plugin) { plugin.onResolve({ filter: /\/AuthContext$/ }, () => ({ path: "test:auth", external: true })); } }],
});

function render(role) {
  const stubs = {
    "test:auth": { useAuth: () => ({ user: role ? { id: 1, full_name: "Тест", role } : null, loading: false }) },
    "@tanstack/react-query": { useQueryClient: () => ({ isMutating: () => 0, invalidateQueries() {} }) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)((name) => stubs[name] ?? require(name), module, module.exports);
  const { PwaProvider, PwaInstallCard } = module.exports;
  return renderToStaticMarkup(React.createElement(PwaProvider, null, React.createElement(PwaInstallCard)));
}

const RELEASE_ONLY = [/Версия 2\.\d+\.\d+/, /Проверить обновления/, /Что нового в версии/, /Установлена актуальная версия|Обновления проверяются автоматически/];

test("сотруднику показывают только установку, без сведений о выпуске", () => {
  for (const role of ["operator", "trainer", "supervisor", "head"]) {
    const html = render(role);
    assert.match(html, /Приложение Puls/, role);
    for (const pattern of RELEASE_ONLY) assert.doesNotMatch(html, pattern, `${role}: ${pattern}`);
  }
});

test("администратор видит версию и состав выпуска", () => {
  const html = render("admin");
  for (const pattern of RELEASE_ONLY) assert.match(html, pattern, String(pattern));
});

test("ничто не подсказывает обновиться после того, как обновление применилось", () => {
  for (const role of ["operator", "admin"]) {
    const html = render(role);
    assert.doesNotMatch(html, /Приложение обновлено/, role);
    assert.doesNotMatch(html, /pwa-update-dot/, role);
    assert.doesNotMatch(html, /Обновить приложение/, role);
  }
});
