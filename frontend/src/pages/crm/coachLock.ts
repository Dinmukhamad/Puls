/**
 * While Pulsar shows a step, the page answers only where he points: the element of a step that
 * asks for an action, the places the step allows besides it and his own bubble. A step that only
 * explains something leaves the whole page read-only. Scrolling and hovering keep working.
 */
export interface CoachLock {
  /** Pulsar's own layer with the bubble and its buttons. */
  coach: () => Element | null;
  /** The element the operator must use now, or null while Pulsar explains or looks for it. */
  target: () => Element | null;
  /** Selector of other places the step needs, e.g. the search field while picking a result. */
  allow: () => string | undefined;
  /** The current step has found its element; between steps focus is left alone. */
  ready: () => boolean;
  /** The operator clicked the lit element. */
  onUsed: () => void;
  /** An operator's click, key press or typing was swallowed. */
  onBlocked: () => void;
  /** Escape closes the tour, and only the tour. */
  onEscape: () => void;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Pointer events that act on the page. Touches are only stopped, so the page still scrolls. */
const POINTER = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "touchstart", "touchend"];
/** These also start a default action: focus, text selection, following a link, ticking a box. */
const CANCEL = new Set(["mousedown", "click", "dblclick", "auxclick"]);
const KEYS = ["keydown", "keyup"], EDITS = ["beforeinput", "paste", "cut", "drop"];
/** Bare modifiers never change the page. */
const FREE_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const within = (box: Box, x: number, y: number) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

function point(e: Event) {
  if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
  const touch = (e as TouchEvent).changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/** Presses the lit element the way the operator meant to: fields get focus, the rest a click. */
function press(target: Element) {
  if (!(target instanceof HTMLElement)) return;
  if (target.matches("input, select, textarea")) target.focus(); else target.click();
}

/** Installs the lock on the whole window. `settle` drops focus that is outside the open places. */
export function lockPage(lock: CoachLock) {
  /** "free" — Pulsar's bubble or an allowed place; "use" — the lit element itself. */
  const reach = (node: EventTarget | null): "free" | "use" | null => {
    if (!(node instanceof Element) || lock.coach()?.contains(node)) return "free";
    const allow = lock.allow();
    if (allow && node.closest(allow)) return "free";
    const target = lock.target();
    if (!target) return null;
    if (target.contains(node)) return "use";
    // A label outside the target still works the control inside it; the control then gets the click.
    const control = node.closest("label")?.control;
    return control && target.contains(control) ? "free" : null;
  };
  // Nothing is focused: keys scroll the page or paste into it, which changes nothing.
  const idle = (e: Event) => e.target === document.body || e.target === document.documentElement;
  // Pulsar's own clicks are synthetic, so only the operator's events are checked.
  const pointer = (e: Event) => {
    if (!e.isTrusted) return;
    const why = reach(e.target);
    if (why) { if (why === "use" && e.type === "click") lock.onUsed(); return; }
    e.stopPropagation();
    if (CANCEL.has(e.type)) e.preventDefault();
    if (e.type !== "click") return;
    // A press on the lit place that lands on something covering it still reaches the lit element.
    const target = lock.target(), at = point(e);
    if (target && at && within(target.getBoundingClientRect(), at.x, at.y)) { press(target); lock.onUsed(); } else lock.onBlocked();
  };
  /** Tab walks only the open places: the lit element, the allowed ones and Pulsar's bubble. */
  const tab = (back: boolean) => {
    const zones = [lock.target(), ...(lock.allow() ? document.querySelectorAll(lock.allow()!) : []), lock.coach()].filter((z): z is Element => !!z);
    const items = [...new Set(zones.flatMap(z => [...(z.matches(FOCUSABLE) ? [z] : []), ...z.querySelectorAll(FOCUSABLE)]))]
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0)
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[at < 0 ? (back ? items.length - 1 : 0) : (at + (back ? -1 : 1) + items.length) % items.length].focus();
  };
  const key = (e: Event) => {
    if (!e.isTrusted) return;
    const { key: name, repeat, shiftKey } = e as KeyboardEvent;
    if (name === "Escape") { e.preventDefault(); e.stopPropagation(); if (e.type === "keydown" && !repeat) lock.onEscape(); return; }
    if (name === "Tab") { e.preventDefault(); e.stopPropagation(); if (e.type === "keydown") tab(shiftKey); return; }
    if (FREE_KEYS.has(name) || idle(e) || reach(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === "keydown" && !repeat) lock.onBlocked();
  };
  const edit = (e: Event) => {
    if (!e.isTrusted || idle(e) || reach(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    lock.onBlocked();
  };
  const settle = () => {
    if (!lock.ready()) return;
    const node = document.activeElement;
    if (node instanceof HTMLElement && node !== document.body && !reach(node)) node.blur();
  };
  // A field focused by the page itself (autofocus in a window that just opened) keeps focus only
  // if the step that follows needs it: typing, dictation and IME cannot slip past the lock then.
  let pending = 0;
  const focus = () => { window.clearTimeout(pending); pending = window.setTimeout(settle, 150); };
  const listeners: [string, (e: Event) => void][] = [...POINTER.map(t => [t, pointer] as [string, typeof pointer]), ...KEYS.map(t => [t, key] as [string, typeof key]), ...EDITS.map(t => [t, edit] as [string, typeof edit]), ["focusin", focus]];
  // The window hears events before the page and React do, so a swallowed click reaches nobody.
  for (const [type, listener] of listeners) window.addEventListener(type, listener, { capture: true, passive: type.startsWith("touch") });
  return {
    settle,
    release: () => { window.clearTimeout(pending); for (const [type, listener] of listeners) window.removeEventListener(type, listener, true); },
  };
}
