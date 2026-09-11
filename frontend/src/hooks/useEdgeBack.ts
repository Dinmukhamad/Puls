import { useEffect, useRef, useState } from "react";

const EDGE = 26;        // ширина полосы у левого края, с которой начинается жест
const AXIS = 8;         // сдвиг, после которого решаем: это горизонталь или прокрутка
const COMMIT = 0.38;    // доля ширины экрана, после которой отпускание возвращает назад

/**
 * Возврат свайпом от левого края. Нужен прежде всего установленному приложению на iOS:
 * в режиме standalone там нет ни системного жеста, ни адресной строки, поэтому кнопка
 * остаётся единственным выходом. Возвращает текущий сдвиг в пикселях, чтобы экран ехал
 * за пальцем; `null` вместо обработчика полностью выключает жест.
 */
export function useEdgeBack(onBack: (() => void) | null) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; axis: "" | "x" | "y" } | null>(null);
  const shift = useRef(0);

  useEffect(() => {
    const back = onBack;
    if (!back || typeof window === "undefined") return;
    const width = () => window.innerWidth || 360;
    const reset = () => { start.current = null; shift.current = 0; setOffset(0); setDragging(false); };

    function down(event: TouchEvent) {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX > EDGE) return;
      start.current = { x: touch.clientX, y: touch.clientY, axis: "" };
    }
    function move(event: TouchEvent) {
      const from = start.current;
      if (!from || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - from.x, dy = touch.clientY - from.y;
      if (!from.axis) {
        if (Math.abs(dx) < AXIS && Math.abs(dy) < AXIS) return;
        from.axis = dx > 0 && Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (from.axis === "x") setDragging(true);
      }
      if (from.axis !== "x") return;
      shift.current = Math.max(0, Math.min(width(), dx));
      setOffset(shift.current);
    }
    // Стрелочная форма, а не объявление: объявление поднимается выше проверки на null,
    // и TypeScript перестаёт видеть, что обработчик к этому моменту уже задан.
    const up = () => {
      const committed = start.current?.axis === "x" && shift.current > width() * COMMIT;
      reset();
      if (committed) back();
    };

    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [onBack]);

  // Жест выключён — экран не должен остаться сдвинутым.
  useEffect(() => { if (!onBack) { setOffset(0); setDragging(false); } }, [onBack]);

  return { offset, dragging };
}
