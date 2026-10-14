import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const compiled = await build({
  stdin: {
    contents: 'export { CityPeekPanel } from "./CityPeekPanel.tsx"; export { CityToolbar, CityToolbarContext, closeOnTapOutside } from "./CityToolbar.tsx";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".css": "empty" }, write: false,
});
function load(react = React) {
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((name) => name === "react" ? react : require(name), module, module.exports);
  return module.exports;
}

const { CityPeekPanel, CityToolbar, CityToolbarContext, closeOnTapOutside } = load();
test("collapsed overlays retain children while hiding controls from sight and keyboard navigation", () => {
  const child = React.createElement("input", { defaultValue: "Черновик" });
  const html = renderToStaticMarkup(React.createElement(CityPeekPanel, { label: "Застройка района", icon: "🏡" }, child));
  assert.match(html, /data-open="false"/);
  assert.match(html, /<button[^>]+aria-label="Застройка района"[^>]+aria-expanded="false"[^>]+aria-controls="([^"]+)"/);
  assert.match(html, /<div[^>]+class="city-peek__content"[^>]+hidden=""[^>]+aria-hidden="true"[^>]+inert=""/);
  assert.match(html, /<input[^>]+value="Черновик"/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
});

test("the toolbar's open popup and a held one show their children and an expanded trigger", () => {
  const toolbar = { target: null, active: "quests", setActive() {}, attachTarget() {} };
  for (const [props, value] of [[{ toolbarSlot: "quests" }, toolbar], [{ holdOpen: true }, null]]) {
    const panel = React.createElement(CityPeekPanel, { label: "Задания района", icon: "!", ...props }, React.createElement("button", null, "Перейти к заданию"));
    const html = renderToStaticMarkup(value ? React.createElement(CityToolbarContext.Provider, { value }, panel) : panel);
    assert.match(html, /data-open="true"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /class="city-peek__content" aria-hidden="false"/);
    assert.doesNotMatch(html, /hidden=""|inert=""/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  }
  const other = renderToStaticMarkup(React.createElement(CityToolbarContext.Provider, { value: toolbar },
    React.createElement(CityPeekPanel, { label: "Миссии", icon: "📋", toolbarSlot: "missions" }, "Миссии")));
  assert.match(other, /data-open="false"/, "only the toolbar's active slot is open");
});

test("compact text identifies essential map controls while keeping the full accessible name", () => {
  const html = renderToStaticMarkup(React.createElement(CityPeekPanel, { label: "Застройка района команды", compactLabel: "Строить", icon: "🏡" }, "Панель"));
  assert.match(html, /city-peek--labelled/);
  assert.match(html, /aria-label="Застройка района команды"/);
  assert.match(html, /<span class="city-peek__label" aria-hidden="true">Строить<\/span>/);
});

/** A document whose focus the panels move; one per test, shared by its panels. */
function page(t) {
  const previous = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}

/** A shared toolbar like CityToolbarProvider's: one open slot, set the way React's state setter is. */
function sharedToolbar(target = null) {
  return { target, active: null, setActive(next) { this.active = typeof next === "function" ? next(this.active) : next; } };
}

/** Exercise the real handlers with persistent hook state and native-like focus relationships. */
function fixture(t, { holdOpen = false, toolbar = null, toolbarSlot } = {}) {
  const slots = [];
  let cursor = 0, pending = [], tree, result;
  const changes = [];
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); });
  const mockReact = {
    ...React,
    useContext: () => toolbar,
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
  const Component = load(mockReact).CityPeekPanel;
  const trigger = { focus() { document.activeElement = trigger; } };
  const button = { closest: () => null, focus() { document.activeElement = button; } };
  const dialog = {};
  const dialogButton = { closest: (query) => query === '[role="dialog"]' ? dialog : null };
  const outside = { closest: () => null };
  const content = { contains: (node) => node === button };
  const root = { contains: (node) => node === trigger || node === content || content.contains(node) };
  const child = React.createElement("input", { defaultValue: "Черновик" });
  function render() {
    cursor = 0; pending = [];
    result = Component({ label: "Застройка района", icon: "🏡", children: child, holdOpen, toolbarSlot, onOpenChange(next) { changes.push(next); } });
    tree = result.$$typeof === Symbol.for("react.portal") ? result.children : result;
    tree.ref.current = root;
    tree.props.children[0].ref.current = trigger;
    tree.props.children[1].ref.current = content;
    for (const effect of pending) effect();
    return tree;
  }
  render();
  function event(name, detail = {}) {
    tree.props[name]?.({ pointerType: "mouse", target: root, currentTarget: root, preventDefault() {}, stopPropagation() {}, ...detail });
    render();
  }
  return {
    event, render, changes, button, trigger, child, dialogButton, outside,
    tree: () => tree,
    result: () => result,
    content: () => tree.props.children[1].props,
    expanded: () => tree.props["data-open"] === "true",
    click() { tree.props.children[0].props.onClick(); render(); },
    setHoldOpen(next) { holdOpen = next; render(); render(); },
  };
}

test("hovering opens nothing: a click opens the popup and a second click closes it", (t) => {
  page(t);
  const panel = fixture(t);
  panel.event("onPointerEnter");
  assert.equal(panel.expanded(), false, "passing over a button opens nothing");
  panel.click();
  assert.equal(panel.expanded(), true);
  panel.event("onPointerLeave");
  assert.equal(panel.expanded(), true, "the pointer may leave on its way into the popup");
  panel.click();
  assert.equal(panel.expanded(), false);
  assert.equal(panel.tree().props.children[1].props.children, panel.child, "closed contents stay mounted");
  assert.deepEqual(panel.changes, [false, true, false]);
});

test("in the toolbar one popup is open at a time: another button switches to its own", (t) => {
  page(t);
  const toolbar = sharedToolbar();
  const missions = fixture(t, { toolbar, toolbarSlot: "missions" }), quests = fixture(t, { toolbar, toolbarSlot: "quests" });
  const both = () => { missions.render(); quests.render(); return [missions.expanded(), quests.expanded()]; };
  missions.click();
  assert.deepEqual(both(), [true, false]);
  quests.click();
  assert.equal(toolbar.active, "quests");
  assert.deepEqual(both(), [false, true]);
  // Escape in a closed panel never closes the open one.
  missions.event("onKeyDown", { key: "Escape" });
  assert.deepEqual(both(), [false, true]);
  quests.click();
  assert.equal(toolbar.active, null);
  assert.deepEqual(both(), [false, false]);
  // The page opens a slot itself, e.g. the missions of a district chosen on the map.
  toolbar.setActive("missions");
  assert.deepEqual(both(), [true, false]);
});

test("a shared toolbar receives each whole panel in its slot and keeps it there across expansion", (t) => {
  page(t);
  const slot = { nodeType: 1 };
  const target = { nodeType: 1, querySelector(selector) { return selector === '[data-city-panel="build"]' ? slot : null; } };
  const panel = fixture(t, { toolbar: sharedToolbar(target), toolbarSlot: "build" });
  assert.equal(panel.result().$$typeof, Symbol.for("react.portal"));
  assert.equal(panel.result().containerInfo, slot);
  assert.equal(panel.tree().props.children[1].props.children, panel.child);
  panel.click();
  assert.equal(panel.expanded(), true);
  assert.equal(panel.result().containerInfo, slot);
  panel.click();
  assert.equal(panel.expanded(), false);
  assert.equal(panel.result().containerInfo, slot);
});

test("panels use stable logical slots so DOM keyboard order matches visual toolbar order", () => {
  const html = renderToStaticMarkup(React.createElement(CityToolbar));
  assert.match(html, /role="toolbar" aria-label="Панели города"/);
  assert.deepEqual([...html.matchAll(/data-city-panel="([^"]+)"/g)].map(match => match[1]), ["level", "cities", "build", "missions", "quests", "skills", "tools", "history"]);
});

test("Escape closes the popup and gives focus back to its button", (t) => {
  page(t);
  const panel = fixture(t);
  panel.click();
  panel.button.focus();
  let prevented = false, stopped = false;
  panel.event("onKeyDown", { key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.trigger);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test("Tab out of the popup closes it, while a mouse moving on or a dialog it opened keep it", (t) => {
  page(t);
  const panel = fixture(t);
  panel.click();
  panel.event("onPointerDownCapture");
  panel.event("onBlur", { relatedTarget: panel.outside });
  assert.equal(panel.expanded(), true, "a pointer elsewhere is the toolbar's to judge");
  panel.event("onKeyDown", { key: "Tab" });
  panel.event("onBlur", { relatedTarget: panel.button });
  assert.equal(panel.expanded(), true, "focus still inside");
  panel.event("onBlur", { relatedTarget: panel.dialogButton });
  assert.equal(panel.expanded(), true, "a sheet opened from the popup");
  panel.event("onBlur", { relatedTarget: panel.outside });
  assert.equal(panel.expanded(), false);
});

test("a pending operation holds the popup open, and a close asked for meanwhile follows when it ends", (t) => {
  page(t);
  const panel = fixture(t, { holdOpen: true });
  assert.equal(panel.expanded(), true);
  panel.click();
  panel.event("onKeyDown", { key: "Escape" });
  assert.equal(panel.expanded(), true);
  assert.equal(panel.content().hidden, false);
  assert.equal(panel.content().inert, undefined);
  panel.button.focus();
  panel.setHoldOpen(false);
  assert.equal(panel.expanded(), false);
  assert.equal(document.activeElement, panel.trigger, "no focus left in hidden content");
  assert.deepEqual(panel.changes, [true, false]);
});

/** A document's capturing pointer listeners and its Escape, as closeOnTapOutside registers them. */
function listeningDocument() {
  const listeners = {};
  return {
    listeners, sheet: false,
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener(type, listener) { if (listeners[type] === listener) delete listeners[type]; },
    querySelector() { return this.sheet ? {} : null; },
  };
}
const element = (inside) => ({ closest: (query) => inside.some(part => query.includes(part)) ? {} : null });

test("a tap outside the toolbar closes its popup; a drag over the map and taps in the toolbar or a dialog do not", () => {
  const doc = listeningDocument();
  let closed = 0;
  const stop = closeOnTapOutside(() => { closed++; }, doc);
  const press = (target, [x0, y0], [x1, y1], isPrimary = true) => {
    doc.listeners.pointerdown({ isPrimary, target, clientX: x0, clientY: y0 });
    doc.listeners.pointerup({ isPrimary, target, clientX: x1, clientY: y1 });
  };
  const map = element([]), toolbar = element([".city-toolbar"]), sheet = element(["[role=dialog]"]);
  press(map, [100, 100], [102, 101]);
  assert.equal(closed, 1, "a tap on the map");
  press(map, [100, 100], [160, 140]);
  assert.equal(closed, 1, "moving the map");
  press(toolbar, [10, 10], [10, 10]);
  press(sheet, [300, 300], [300, 300]);
  press(map, [100, 100], [100, 100], false);
  assert.equal(closed, 1, "the toolbar's own buttons, a sheet and a second finger");
  let prevented = false;
  doc.listeners.keydown({ key: "Escape", defaultPrevented: false, preventDefault() { prevented = true; } });
  assert.equal(closed, 2);
  assert.equal(prevented, true);
  doc.sheet = true;
  doc.listeners.keydown({ key: "Escape", defaultPrevented: false, preventDefault() {} });
  assert.equal(closed, 2, "a sheet over the city takes its own Escape");
  stop();
  assert.deepEqual(Object.keys(doc.listeners), []);
});
