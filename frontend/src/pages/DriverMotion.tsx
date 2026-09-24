import { useEffect, useRef, useState, type CSSProperties } from "react";

/* Движение Driver Simulator: числа, праздник заказа, живая сцена такси и кольцо прогресса смены.
   Всё уважает «уменьшить движение»: тогда значения просто появляются. */

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Число доезжает до нового значения за доли секунды, как счётчик в приложении водителя. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString("ru-RU"), duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || from.current === value) { from.current = value; setShown(value); return; }
    const start = performance.now(), origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick); else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = value; };
  }, [value, duration]);
  return <bdi className="dx-number" data-changing={shown !== value}>{format(shown)}</bdi>;
}

const CONFETTI = ["#ffe128", "#ffffff", "#ffb800", "#7ce0b5", "#ff8a5c", "#8fb4ff"];
/** Короткий салют после выполненного заказа. Сам исчезает и не мешает нажатиям. */
export function Confetti({ pieces = 28 }: { pieces?: number }) {
  const [alive, setAlive] = useState(!reduced());
  useEffect(() => { const timer = window.setTimeout(() => setAlive(false), 1900); return () => window.clearTimeout(timer); }, []);
  if (!alive) return null;
  return <div className="dx-confetti" aria-hidden="true">{Array.from({ length: pieces }, (_, i) => {
    const angle = (i / pieces) * Math.PI * 2 + (i % 3) * 0.2, distance = 90 + (i * 37) % 110;
    return <i key={i} style={{ "--x": `${Math.cos(angle) * distance}px`, "--y": `${Math.sin(angle) * distance - 60}px`, "--r": `${(i * 47) % 360}deg`, "--c": CONFETTI[i % CONFETTI.length], "--d": `${(i % 5) * 40}ms` } as CSSProperties} />;
  })}</div>;
}

/** Галочка, которая прорисовывается штрихом. */
export function SuccessMark() {
  return <svg className="dx-success" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" /><path d="M20 33l8 8 16-17" /></svg>;
}

/** Ночной город, дорога и едущее такси — заставка и стартовый экран симулятора. */
export function TaxiScene({ compact = false }: { compact?: boolean }) {
  return <div className={`dx-scene${compact ? " dx-scene--compact" : ""}`} aria-hidden="true">
    <div className="dx-scene__sky"><i /><i /><i /><i /><i /></div>
    <svg className="dx-scene__city" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice">
      <path d="M0 120V70h22V48h18v22h14V30h26v40h12V56h20v64zM112 120V62h16V40h30v22h10V74h22V36h24v84zM214 120V54h20V30h16v24h12V66h24V44h28v76zM314 120V60h18V42h22v18h14V52h32v68z" />
      {[[30, 60], [64, 42], [70, 58], [140, 50], [150, 70], [240, 44], [276, 76], [300, 56], [336, 52], [372, 66], [196, 50]].map(([x, y], i) => <rect key={i} className="dx-scene__window" x={x} y={y} width="4" height="5" style={{ animationDelay: `${(i * 0.37).toFixed(2)}s` }} />)}
    </svg>
    <div className="dx-scene__road"><span /></div>
    <svg className="dx-scene__taxi" viewBox="0 0 120 56">
      <path className="dx-taxi-body" d="M10 38c0-6 4-10 10-11l14-2 12-11c3-3 6-4 10-4h22c4 0 7 2 9 5l8 11 9 2c5 1 8 5 8 10v6H10z" />
      <path className="dx-taxi-glass" d="M48 16h14v10H38zM66 16h12l7 10H66z" />
      <rect className="dx-taxi-sign" x="52" y="4" width="18" height="7" rx="2" />
      <rect className="dx-taxi-check" x="18" y="34" width="84" height="4" />
      <circle className="dx-taxi-light" cx="110" cy="38" r="3" />
      <g className="dx-wheel" style={{ transformOrigin: "32px 46px" }}><circle cx="32" cy="46" r="8" /><path d="M32 40v12M26 46h12" /></g>
      <g className="dx-wheel" style={{ transformOrigin: "90px 46px" }}><circle cx="90" cy="46" r="8" /><path d="M90 40v12M84 46h12" /></g>
    </svg>
  </div>;
}

/** Кольцо выполненных заказов смены в шапке: заполняется при каждом заказе. */
export function ShiftRing({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? Math.min(1, done / total) : 0, r = 9, c = 2 * Math.PI * r;
  return <svg className="dx-ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r={r} /><circle className="dx-ring__fill" cx="12" cy="12" r={r} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - share) }} /></svg>;
}
