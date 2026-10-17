import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("./", import.meta.url));
const source = `export { Avatar } from ${JSON.stringify(root + "ui.tsx")}; export { AvatarViewerContext } from ${JSON.stringify(root + "avatarContext.ts")};`;
const result = await build({ stdin: { contents: source, resolveDir: root, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Avatar, AvatarViewerContext } = module.exports;

test("without an authenticated provider the avatar remains initials", () => {
  const html = renderToStaticMarkup(React.createElement(Avatar, { name: "Данияр Ахметов", id: 2 }));
  assert.match(html, /ДА/);
  assert.doesNotMatch(html, /<img/);
});

test("shared avatar source uses the target account and preserves initials fallback", () => {
  let requested;
  const photo = id => { requested = id; return React.createElement("img", { src: "data:image/webp;base64,stored", alt: "" }); };
  const html = renderToStaticMarkup(React.createElement(AvatarViewerContext.Provider, { value: photo }, React.createElement(Avatar, { name: "Данияр Ахметов", id: 9 })));
  assert.equal(requested, 9);
  assert.match(html, /data:image\/webp;base64,stored/);
  assert.match(html, /ДА/);
});

test("an explicit upload preview takes precedence without querying the saved avatar", () => {
  const photo = () => { throw new Error("saved photo should not be requested for preview"); };
  const html = renderToStaticMarkup(React.createElement(AvatarViewerContext.Provider, { value: photo }, React.createElement(Avatar, { name: "Данияр Ахметов", id: 9, src: "blob:local-preview" })));
  assert.match(html, /src="blob:local-preview"/);
  assert.match(html, /class="avatar__photo"/);
});

test("decorative initials never request another account photo from a colour seed", () => {
  const photo = () => { throw new Error("decorative avatar must not look up an account"); };
  const html = renderToStaticMarkup(React.createElement(AvatarViewerContext.Provider, { value: photo }, React.createElement(Avatar, { name: "Система", id: 123, photo: false })));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /С/);
});
