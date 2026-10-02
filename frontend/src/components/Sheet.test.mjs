import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./Sheet.tsx", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)((name) => {
  if (name === "react") return {
    ...React,
    useId: () => "sheet-test-title",
    useLayoutEffect: () => {},
    useRef: (current) => ({ current }),
    useState: (current) => [current, () => {}],
  };
  if (name === "react-dom") return { createPortal: (children) => children };
  return require(name);
}, module, module.exports);
const { Sheet } = module.exports;

function fixture(t) {
  const previousDocument = globalThis.document;
  globalThis.document = { body: {} };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  let closes = 0;
  const backdrop = {};
  const sheet = Sheet({
    title: "Развитие района",
    onClose: () => { closes += 1; },
    children: React.createElement("button", null, "Выбрать участок"),
  });
  function event(name, target = backdrop, pointerType = "touch") {
    sheet.props[name]?.({ target, currentTarget: backdrop, pointerType, isPrimary: true, button: 0 });
  }
  return { sheet, event, closes: () => closes };
}

test("a sheet opened by a canvas touch survives the compatibility mouse events from that touch", (t) => {
  // The canvas has already handled pointerdown/pointerup when it mounts Sheet.
  // Chromium then targets the new backdrop for mousedown, mouseup and click.
  const { event, closes } = fixture(t);
  event("onMouseDown");
  event("onMouseUp");
  event("onClick");
  assert.equal(closes(), 0, "the opening gesture must not immediately dismiss the sheet");
  event("onPointerDown");
  assert.equal(closes(), 1, "a subsequent deliberate tap outside still dismisses it");
});

test("fresh mouse and touch pointers outside the sheet dismiss it", (t) => {
  const { event, closes } = fixture(t);
  for (const [index, pointerType] of ["mouse", "touch"].entries()) {
    event("onPointerDown", undefined, pointerType);
    event("onPointerUp", undefined, pointerType);
    event("onMouseDown");
    event("onMouseUp");
    event("onClick");
    assert.equal(closes(), index + 1, "each outside gesture dismisses once");
  }
});

test("pointer events bubbling from sheet content leave it open and its close button still works", (t) => {
  const { sheet, event, closes } = fixture(t);
  const panel = sheet.props.children;
  const header = panel.props.children[0];
  const body = panel.props.children[1];
  event("onPointerDown", body, "touch");
  event("onPointerDown", body.props.children, "mouse");
  event("onMouseDown", body.props.children, "mouse");
  event("onClick", body.props.children, "mouse");
  assert.equal(closes(), 0);
  const closeButton = React.Children.toArray(header.props.children).find((child) => child.type === "button");
  closeButton.props.onClick();
  assert.equal(closes(), 1);
});
