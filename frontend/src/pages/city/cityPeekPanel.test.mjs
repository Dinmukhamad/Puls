import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./CityPeekPanel.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, write: false,
});
function load(react = React) {
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((name) => name === "react" ? react : require(name), module, module.exports);
  return module.exports.CityPeekPanel;
}

const CityPeekPanel = load();
test("collapsed overlays retain children while hiding controls from sight and keyboard navigation", () => {
  const child = React.createElement("input", { defaultValue: "Черновик" });
  const html = renderToStaticMarkup(React.createElement(CityPeekPanel, { label: "Застройка района", icon: "🏡" }, child));
  assert.match(html, /data-open="false"/);
  assert.match(html, /<button[^>]+aria-label="Застройка района"[^>]+aria-expanded="false"[^>]+aria-controls="([^"]+)"/);
  assert.match(html, /<div[^>]+class="city-peek__content"[^>]+hidden=""[^>]+aria-hidden="true"[^>]+inert=""/);
  assert.match(html, /<input[^>]+value="Черновик"/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
});

test("expanded and held overlays expose the same children and an expanded trigger", () => {
  for (const props of [{ open: true }, { open: false, holdOpen: true }]) {
    const html = renderToStaticMarkup(React.createElement(CityPeekPanel, { label: "Задания района", icon: "!", ...props }, React.createElement("button", null, "Перейти к заданию")));
    assert.match(html, /data-open="true"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /class="city-peek__content" aria-hidden="false"/);
    assert.doesNotMatch(html, /hidden=""|inert=""/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  }
});

test("compact text identifies essential map controls while keeping the full accessible name", () => {
  const html = renderToStaticMarkup(React.createElement(CityPeekPanel, { label: "Застройка района команды", compactLabel: "Строить", icon: "🏡" }, "Панель"));
  assert.match(html, /city-peek--labelled/);
  assert.match(html, /aria-label="Застройка района команды"/);
  assert.match(html, /<span class="city-peek__label" aria-hidden="true">Строить<\/span>/);
});

/** Exercise the real handlers with persistent hook state and native-like focus relationships. */
function fixture(t, { controlled = true, initialOpen = false, holdOpen = false, toolbarTarget = null, toolbarSlot } = {}) {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    activeElement: null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  t.after(() => {
    for (const slot of slots) slot?.cleanup?.();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const slots = [];
  let cursor = 0, pending = [], tree, result, externalOpen = initialOpen;
  const changes = [];
  const mockReact = {
    ...React,
    useContext: () => toolbarTarget ? { target: toolbarTarget } : null,
    useId() { const index = cursor++; return slots[index] ??= "city-peek-test-content"; },
    useRef(current) { const index = cursor++; return slots[index] ??= { current }; },
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: initial };
      return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const prior = slots[index];
      if (!prior || deps.some((value, key) => !Object.is(value, prior.deps[key]))) {
        pending.push(() => { prior?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const Component = load(mockReact);
  const button = { kind: "button", matches: (query) => query === ":focus-visible" && button.focusVisible,
    focusVisible: false, focus() { document.activeElement = button; tree.props.onFocus({ target: button }); } };
  const field = { kind: "input", matches: (query) => query === ":focus-visible" || query.includes("input") };
  const trigger = { focusVisible: false, matches: (query) => query === ":focus-visible" && trigger.focusVisible,
    focus() { document.activeElement = trigger; tree.props.onFocus({ target: trigger }); } };
  const dialog = { matches: (query) => query === ":focus-visible", closest: (query) => query === '[role="dialog"]' ? dialog : null };
  const dialogButton = { matches: (query) => query === ":focus-visible", closest: (query) => query === '[role="dialog"]' ? dialog : null };
  const content = { contains: (node) => node === button || node === field };
  const root = { contains: (node) => node === trigger || node === content || content.contains(node) };
  const child = React.createElement("input", { defaultValue: "Черновик" });
  function render() {
    cursor = 0; pending = [];
    result = Component({ label: "Застройка района", icon: "🏡", children: child, holdOpen, toolbarSlot,
      ...(controlled ? { open: externalOpen } : {}),
      onOpenChange(next) { externalOpen = next; changes.push(next); },
    });
    tree = result.$$typeof === Symbol.for("react.portal") ? result.children : result;
    tree.ref.current = root;
    tree.props.children[0].ref.current = trigger;
    tree.props.children[1].ref.current = content;
    for (const effect of pending) effect();
    return tree;
  }
  render();
  function event(name, detail = {}) {
    tree.props[name]?.({ pointerType: "mouse", target: root, currentTarget: root,
      preventDefault() {}, stopPropagation() {}, ...detail });
    render();
  }
  return {
    event, changes, button, field, trigger, child, dialog, dialogButton,
    tree: () => tree,
    result: () => result,
    expanded: () => tree.props["data-open"] === "true",
    click() { tree.props.children[0].props.onClick(); render(); },
    outsideTouch() { listeners.get("pointerdown")?.({ pointerType: "touch", target: {} }); render(); },
    setHoldOpen(next) { holdOpen = next; render(); render(); },
  };
}

test("hover opens and pointer leave closes despite a mouse-focused child, preserving its mounted content", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter");
  assert.equal(panel.expanded(), true);
  panel.event("onPointerDownCapture");
  panel.button.focus();
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.trigger);
  assert.equal(panel.tree().props.children[1].props.children, panel.child);
  assert.equal(panel.tree().props.children[1].props.hidden, true);
  assert.equal(panel.tree().props.children[1].props.inert, "");
  assert.deepEqual(panel.changes, [true, false]);
});

test("a shared toolbar receives each whole panel and keeps its portal target stable across expansion", (t) => {
  const target = { nodeType: 1 };
  const panel = fixture(t, { toolbarTarget: target });
  assert.equal(panel.result().$$typeof, Symbol.for("react.portal"));
  assert.equal(panel.result().containerInfo, target);
  assert.equal(panel.result().children, panel.tree());
  assert.equal(panel.tree().props.children[1].props.children, panel.child);
  panel.event("onPointerEnter");
  assert.equal(panel.expanded(), true);
  assert.equal(panel.result().containerInfo, target);
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), false);
  assert.equal(panel.result().containerInfo, target);
  assert.equal(panel.tree().props.children[1].props.children, panel.child);
});

test("panels use stable logical slots so DOM keyboard order matches visual toolbar order", async (t) => {
  const slot = { nodeType: 1 };
  const target = { nodeType: 1, querySelector(selector) { return selector === '[data-city-panel="build"]' ? slot : null; } };
  const panel = fixture(t, { toolbarTarget: target, toolbarSlot: "build" });
  assert.equal(panel.result().containerInfo, slot);
  panel.event("onPointerEnter");
  assert.equal(panel.result().containerInfo, slot);
  panel.event("onPointerLeave");
  assert.equal(panel.result().containerInfo, slot);

  const built = await build({ entryPoints: [fileURLToPath(new URL("./CityToolbar.tsx", import.meta.url))],
    bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", write: false });
  const module = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const html = renderToStaticMarkup(React.createElement(module.exports.CityToolbar));
  assert.match(html, /role="toolbar" aria-label="Панели города"/);
  assert.deepEqual([...html.matchAll(/data-city-panel="([^"]+)"/g)].map(match => match[1]), ["level", "cities", "build", "missions", "skills", "tools"]);
});

test("keyboard focus within survives pointer leave and Escape closes without focus reopening", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter");
  panel.event("onKeyDown", { key: "Tab" });
  panel.button.focusVisible = true;
  panel.button.focus();
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), true);
  let prevented = false, stopped = false;
  panel.event("onKeyDown", { key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.trigger);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test("mouse focus on a text input does not keep the overlay covering the map", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter");
  panel.event("onPointerDownCapture");
  document.activeElement = panel.field;
  panel.event("onFocus", { target: panel.field });
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.trigger);
});

test("keyboard-opened dialogs preserve their panel and can restore focus before Escape closes it", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter");
  panel.event("onKeyDown", { key: "Enter" });
  panel.button.focus();
  panel.event("onBlur", { relatedTarget: panel.dialog });
  document.activeElement = panel.dialogButton;
  panel.event("onFocus", { target: panel.dialogButton });
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), true);
  assert.equal(panel.tree().props.children[1].props.hidden, false);
  panel.button.focus();
  assert.equal(document.activeElement, panel.button);
  panel.event("onKeyDown", { key: "Escape" });
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.trigger);
});

test("mouse-opened portal dialogs do not latch their map panel open", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter");
  panel.event("onPointerDownCapture");
  panel.button.focus();
  panel.event("onBlur", { relatedTarget: panel.dialog });
  document.activeElement = panel.dialogButton;
  panel.event("onFocus", { target: panel.dialogButton });
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.dialogButton);
});

test("touch uses explicit trigger toggles, ignores compatibility pointer leave, and closes on outside touch", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter", { pointerType: "touch" });
  assert.equal(panel.expanded(), false);
  panel.click();
  assert.equal(panel.expanded(), true);
  panel.event("onPointerLeave", { pointerType: "touch" });
  assert.equal(panel.expanded(), true);
  panel.click();
  assert.equal(panel.expanded(), false);
  panel.click();
  panel.outsideTouch();
  assert.equal(panel.expanded(), false);
});

test("uncontrolled overlays notify geometry observers when expansion changes", (t) => {
  const panel = fixture(t, { controlled: false });
  panel.event("onPointerEnter");
  assert.equal(panel.expanded(), true);
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), false);
  assert.deepEqual(panel.changes, [false, true, false]);
});

test("pending operations can hold the panel open and keep exposed children interactive", (t) => {
  const panel = fixture(t, { holdOpen: true });
  panel.event("onPointerLeave");
  panel.click();
  panel.event("onKeyDown", { key: "Escape" });
  assert.equal(panel.expanded(), true);
  assert.equal(panel.tree().props.children[1].props.hidden, false);
  assert.equal(panel.tree().props.children[1].props.inert, undefined);
  assert.deepEqual(panel.changes, []);
});

for (const controlled of [true, false]) {
  test(`${controlled ? "controlled" : "local"} panel closes after a pending operation if the pointer already left`, (t) => {
    const panel = fixture(t, { controlled });
    panel.event("onPointerEnter");
    panel.setHoldOpen(true);
    panel.event("onPointerDownCapture");
    panel.button.focus();
    panel.event("onPointerLeave");
    assert.equal(panel.expanded(), true);
    assert.equal(document.activeElement, panel.button);
    panel.setHoldOpen(false);
    assert.equal(panel.expanded(), false);
    assert.equal(document.activeElement, panel.trigger);
    assert.equal(panel.tree().props.children[1].props.children, panel.child);
  });
}

test("returning to a held panel cancels the deferred close", (t) => {
  const panel = fixture(t);
  panel.event("onPointerEnter");
  panel.setHoldOpen(true);
  panel.event("onPointerLeave");
  panel.event("onPointerEnter");
  panel.setHoldOpen(false);
  assert.equal(panel.expanded(), true);
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), false);
});
