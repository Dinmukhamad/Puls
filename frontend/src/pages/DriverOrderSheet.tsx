import { useRef, type CSSProperties, type ReactNode } from "react";

export const sheetStops = [24, 50, 88];
export const sheetSnap = (value: number) => sheetStops.reduce((a, b) => Math.abs(value - a) < Math.abs(value - b) ? a : b);
export function DriverOrderSheet({ height, setHeight, title, children }: { height: number; setHeight: (value: number) => void; title: string; children: ReactNode }) {
  const element = useRef<HTMLElement>(null), start = useRef<{ y: number; height: number; pixels: number }>();
  return <section ref={element} className={`dn-sheet${height < 30 ? " dn-sheet--collapsed" : ""}`} style={{ "--sheet-height": `${height}%` } as CSSProperties} aria-label={title}>
    <button type="button" className="dn-sheet-handle" aria-label="Высота шторки заказа" aria-expanded={height > 30} onClick={e => { if (e.detail === 0) setHeight(height < 50 ? 50 : height < 80 ? 88 : 24); }} onKeyDown={e => {
      if (["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); setHeight(Math.max(24, Math.min(88, sheetStops[sheetStops.indexOf(sheetSnap(height)) + (e.key === "ArrowUp" ? 1 : -1)] ?? height))); }
    }} onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, height, pixels: element.current?.parentElement?.clientHeight || 600 }; }} onPointerMove={e => {
      if (start.current) setHeight(Math.max(24, Math.min(88, start.current.height + (start.current.y - e.clientY) / start.current.pixels * 100)));
    }} onPointerUp={e => { if (!start.current) return; const moved = Math.abs(e.clientY - start.current.y); setHeight(moved < 5 ? height < 50 ? 50 : height < 80 ? 88 : 24 : sheetSnap(height)); start.current = undefined; }} onPointerCancel={() => { start.current = undefined; setHeight(sheetSnap(height)); }}><span /><small>{height < 30 ? "Подробности" : height > 80 ? "Свернуть" : "Потяните вверх или вниз"}</small></button>
    <div className="dn-sheet-body" onFocusCapture={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) setHeight(88); }}>{children}</div>
  </section>;
}
