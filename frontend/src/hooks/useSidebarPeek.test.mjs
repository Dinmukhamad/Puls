import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("./useSidebarPeek.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});

/** Runs the hook with persistent state, the way React re-renders one component. */
function fixture(t, collapsed = true) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, (next) => { slot.value = next; }]; },
    useRef(current) { return slots[cursor++] ??= { current }; },
    useEffect() { cursor++; },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((name) => name === "react" ? react : require(name), module, module.exports);
  const { useSidebarPeek, PEEK_OPEN_DELAY, PEEK_CLOSE_DELAY } = module.exports;
  const inside = {}, outside = {};
  const peek = {
    collapsed, PEEK_OPEN_DELAY, PEEK_CLOSE_DELAY, inside, outside,
    render() { cursor = 0; return useSidebarPeek(peek.collapsed); },
    open: () => peek.render().open,
    tick: (ms) => t.mock.timers.tick(ms),
    pointer: (handler, event = {}) => peek.render().handlers[handler]({ pointerType: "mouse", buttons: 0, ...event }),
    focus: (keyboard) => peek.render().handlers.onFocus({ target: { matches: (selector) => keyboard && selector === ":focus-visible" } }),
    blur: (relatedTarget) => peek.render().handlers.onBlur({ currentTarget: { contains: (node) => node === inside }, relatedTarget }),
    // A click on the toggle settles the peek in the same handler that flips the preference.
    toggle() { peek.render().settle(); peek.collapsed = !peek.collapsed; },
  };
  return peek;
}

test("the collapsed menu opens after the hover delay and closes after the close delay", (t) => {
  const peek = fixture(t);
  peek.pointer("onPointerEnter");
  peek.tick(peek.PEEK_OPEN_DELAY - 1);
  assert.equal(peek.open(), false);
  peek.tick(1);
  assert.equal(peek.open(), true);
  peek.pointer("onPointerLeave");
  peek.tick(peek.PEEK_CLOSE_DELAY - 1);
  assert.equal(peek.open(), true, "a short slip past the edge keeps the menu open");
  peek.tick(1);
  assert.equal(peek.open(), false);
});

test("a quick pass, a touch and a drag over the rail never open it", (t) => {
  const peek = fixture(t);
  peek.pointer("onPointerEnter");
  peek.tick(60);
  peek.pointer("onPointerLeave");
  peek.tick(1000);
  assert.equal(peek.open(), false, "a cursor passing to the screen edge");
  peek.pointer("onPointerEnter", { pointerType: "touch" });
  peek.tick(1000);
  assert.equal(peek.open(), false, "touch screens expand the menu with the button");
  peek.pointer("onPointerEnter", { buttons: 1 });
  peek.tick(1000);
  assert.equal(peek.open(), false, "a text selection dragged across the rail");
});

test("moving between the floating menu cards keeps the menu open", (t) => {
  const peek = fixture(t);
  peek.pointer("onPointerEnter");
  peek.tick(peek.PEEK_OPEN_DELAY);
  peek.pointer("onPointerLeave");
  peek.tick(20);
  peek.pointer("onPointerEnter");
  peek.tick(1000);
  assert.equal(peek.open(), true);
});

test("keyboard focus opens the menu at once and keeps it open until focus leaves the menu", (t) => {
  const peek = fixture(t);
  peek.focus(true);
  assert.equal(peek.open(), true);
  peek.pointer("onPointerEnter");
  peek.pointer("onPointerLeave");
  peek.tick(1000);
  assert.equal(peek.open(), true, "the mouse leaving must not hide the focused item");
  peek.blur(peek.inside);
  assert.equal(peek.open(), true, "focus moving between menu items");
  peek.blur(peek.outside);
  assert.equal(peek.open(), false);
});

test("mouse focus does not open the menu and a click ends keyboard mode", (t) => {
  const peek = fixture(t);
  peek.focus(false);
  assert.equal(peek.open(), false);
  peek.focus(true);
  peek.pointer("onPointerEnter");
  peek.render().handlers.onPointerDownCapture();
  peek.pointer("onPointerLeave");
  peek.tick(peek.PEEK_CLOSE_DELAY);
  assert.equal(peek.open(), false);
});

test("the docked menu never peeks, and collapsing it with the mouse stays collapsed until the cursor returns", (t) => {
  const peek = fixture(t, false);
  peek.pointer("onPointerEnter");
  peek.tick(1000);
  assert.equal(peek.open(), false);
  peek.toggle();
  peek.tick(1000);
  assert.equal(peek.open(), false, "the cursor still rests on the menu it just collapsed");
  peek.pointer("onPointerLeave");
  peek.pointer("onPointerEnter");
  peek.tick(peek.PEEK_OPEN_DELAY);
  assert.equal(peek.open(), true);
});

test("pinning the peeked menu docks it, and collapsing from the keyboard keeps the focused button visible", (t) => {
  const peek = fixture(t);
  peek.pointer("onPointerEnter");
  peek.tick(peek.PEEK_OPEN_DELAY);
  peek.toggle();
  assert.equal(peek.collapsed, false);
  assert.equal(peek.open(), false);
  peek.focus(true);
  peek.toggle();
  assert.equal(peek.open(), true, "the toggle keeps focus, so the menu stays open around it");
  peek.blur(peek.outside);
  assert.equal(peek.open(), false);
});
