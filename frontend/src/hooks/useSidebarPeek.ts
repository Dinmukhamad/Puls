import { useEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";

// Курсор, пролетевший над меню по пути к краю экрана, не раскрывает его,
// а короткий выход за край не сворачивает сразу.
export const PEEK_OPEN_DELAY = 150;
export const PEEK_CLOSE_DELAY = 200;

/**
 * Свёрнутое меню раскрывается поверх страницы, пока на нём курсор или клавиатурный
 * фокус. Касание его не раскрывает: на сенсорном экране для этого есть кнопка.
 * Обработчики вешаются на все плавающие карточки меню, переход между ними его не закрывает.
 */
export function useSidebarPeek(collapsed: boolean) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0); const hovering = useRef(false); const keyboardFocus = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  function change(next: boolean, delay = 0) {
    window.clearTimeout(timer.current);
    if (delay) timer.current = window.setTimeout(() => setOpen(next), delay); else setOpen(next);
  }
  return {
    open: collapsed && open,
    // После щелчка по кнопке меню остаётся в выбранном виде, пока курсор не уйдёт и не вернётся.
    settle() { hovering.current = false; change(keyboardFocus.current); },
    handlers: {
      onPointerEnter(event: PointerEvent<HTMLElement>) {
        if (event.pointerType === "touch" || event.buttons) return;
        hovering.current = true;
        if (collapsed) change(true, PEEK_OPEN_DELAY);
      },
      onPointerLeave(event: PointerEvent<HTMLElement>) {
        if (event.pointerType === "touch") return;
        hovering.current = false;
        if (!keyboardFocus.current) change(false, PEEK_CLOSE_DELAY);
      },
      onPointerDownCapture() { keyboardFocus.current = false; },
      onFocus(event: FocusEvent<HTMLElement>) {
        if (!event.target.matches(":focus-visible")) return;
        keyboardFocus.current = true;
        change(true);
      },
      onBlur(event: FocusEvent<HTMLElement>) {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        keyboardFocus.current = false;
        if (!hovering.current) change(false);
      },
    },
  };
}
