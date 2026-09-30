/**
 * While Pulsar shows a step, the page answers only where he points: the lit element, the places
 * the step allows besides it and his own bubble. Scrolling and hovering keep working everywhere.
 */
export interface CoachLock {
  /** Pulsar's own layer with the bubble and its buttons. */
  coach: () => Element | null;
  /** The element the current step points at, or null while Pulsar is still looking for it. */
  target: () => Element | null;
  /** Selector of other places the step needs, e.g. Pulsar's panel with the courier code. */
  allow: () => string | undefined;
  /** An operator's click or key press was swallowed. */
  onBlocked: () => void;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Pointer events that act on the page. Touches are only stopped, so the page still scrolls. */
const POINTER = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "touchstart", "touchend"];
/** These also start a default action: focus, text selection, following a link, ticking a box. */
const CANCEL = new Set(["mousedown", "click", "dblclick", "auxclick"]);
const KEYS = ["keydown", "keyup"], EDITS = ["beforeinput", "paste", "cut", "drop"];
/** Moving focus, closing the hint and bare modifiers never change the page. */
const FREE_KEYS = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta"]);

export const within = (box: Box, x: number, y: number) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

function point(e: Event) {
  if (e instanceof MouseEvent) return { x: e.clientX, y: e.clientY };
  const touch = (e as TouchEvent).changedTouches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/** Installs the lock on the whole window; returns the function that lifts it. */
export function lockPage(lock: CoachLock) {
  const open = (e: Event) => {
    const node = e.target;
    if (!(node instanceof Element) || lock.coach()?.contains(node)) return true;
    const allow = lock.allow();
    if (allow && node.closest(allow)) return true;
    const target = lock.target();
    if (!target) return false;
    if (target.contains(node)) return true;
    // A label outside the target still works the control inside it.
    const control = node.closest("label")?.control;
    if (control && target.contains(control)) return true;
    // Whatever covers the lit place, e.g. a panel's backdrop, can be clicked through to reach it.
    const at = point(e);
    return !!at && within(target.getBoundingClientRect(), at.x, at.y);
  };
  // Nothing is focused: keys scroll the page or paste into it, which changes nothing.
  const idle = (e: Event) => e.target === document.body || e.target === document.documentElement;
  // Pulsar's own «Открыть за меня» is a synthetic click, so only the operator's events are checked.
  const pointer = (e: Event) => {
    if (!e.isTrusted || open(e)) return;
    e.stopPropagation();
    if (CANCEL.has(e.type)) e.preventDefault();
    if (e.type === "click") lock.onBlocked();
  };
  const key = (e: Event) => {
    if (!e.isTrusted || FREE_KEYS.has((e as KeyboardEvent).key) || idle(e) || open(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === "keydown" && !(e as KeyboardEvent).repeat) lock.onBlocked();
  };
  const edit = (e: Event) => {
    if (!e.isTrusted || idle(e) || open(e)) return;
    e.preventDefault(); e.stopPropagation();
  };
  const listeners: [string, (e: Event) => void][] = [...POINTER.map(t => [t, pointer] as [string, typeof pointer]), ...KEYS.map(t => [t, key] as [string, typeof key]), ...EDITS.map(t => [t, edit] as [string, typeof edit])];
  // The window hears events before the page and React do, so a swallowed click reaches nobody.
  for (const [type, listener] of listeners) window.addEventListener(type, listener, { capture: true, passive: type.startsWith("touch") });
  return () => { for (const [type, listener] of listeners) window.removeEventListener(type, listener, true); };
}
