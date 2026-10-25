import { useEffect, useRef, type HTMLAttributes } from "react";

const CONTROLS = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Окно, которое страница рисует сама (не Sheet): при открытии фокус переходит внутрь,
 * Tab ходит по кругу внутри окна, Esc закрывает, после закрытия фокус возвращается туда, откуда открыли.
 */
export function useDialogFocus<T extends HTMLElement>(onClose?: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(CONTROLS)).filter((node) => node.getClientRects().length > 0);
    if (!dialog.contains(document.activeElement)) (controls()[0] ?? dialog).focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && close.current) { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const list = controls(), first = list[0], last = list.at(-1), active = document.activeElement;
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/** `<section role="dialog" aria-modal>` with the focus handling above. */
export function FocusDialog({ onClose, ...props }: HTMLAttributes<HTMLElement> & { onClose?: () => void }) {
  const ref = useDialogFocus<HTMLElement>(onClose);
  return <section ref={ref} role="dialog" aria-modal="true" tabIndex={-1} {...props} />;
}
