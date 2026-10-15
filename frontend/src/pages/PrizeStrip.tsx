import { useEffect, useRef, useState, type CSSProperties } from "react";
import { coins, plural } from "../utils/format";
import { spinProgress, stripTarget } from "./spinPhysics";

export interface StripSegment {
  title: string;
  weight: number;
  coins?: number;
}

export interface SpinRequest {
  /** Меняется на каждой прокрутке — по нему компонент понимает, что пора ехать. */
  id: string;
  /** Индекс приза, который выбрал сервер. Клиент только доводит ленту до него. */
  segment: number;
}

const DURATION = 4200;
const GAP = 12;

/** Ширина карточки: на телефоне видно две с небольшим, на широком экране — около восьми. */
function cellWidth(width: number) {
  return Math.round(Math.min(176, Math.max(132, width / 5.4)));
}

/**
 * Лента призов: карточки в стиле сайта едут под рамкой в центре.
 *
 * Карточки — обычная разметка, а не рисунок на холсте: так они берут цвета,
 * шрифты и тёмную тему из общих стилей. В кадре только видимые карточки;
 * каждая знает свой сквозной номер, поэтому лента бесконечна.
 */
export function PrizeStrip({
  segments,
  stickers,
  spin,
  muted,
  onTick,
  onSettled,
}: {
  segments: StripSegment[];
  /** Стикер каждого приза — те же, что в окне «Что может выпасть». */
  stickers?: { icon: string; color: string }[];
  spin: SpinRequest | null;
  muted: boolean;
  onTick: () => void;
  onSettled: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  // Положение ленты считается в карточках, а не в пикселях: какая карточка
  // под рамкой (в пути — дробное). Поэтому новая ширина карточки, даже
  // посреди прокрутки, не сдвигает приз из-под рамки.
  const position = useRef(0);
  // Кадр анимации меняет только ref; это состояние лишь просит React перерисовать ленту.
  const [, redraw] = useState(0);
  const [won, setWon] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const tickSound = useRef(onTick);
  tickSound.current = onTick;
  const lastSpin = useRef<string | null>(null);
  const settle = useRef(onSettled);
  settle.current = onSettled;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => { if (stage.clientWidth) setWidth(stage.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!spin || spin.id === lastSpin.current || !segments.length) return;
    lastSpin.current = spin.id;
    setWon(null);
    const from = position.current;
    const to = stripTarget(from, spin.segment, segments.length, 1);
    const finish = () => {
      position.current = to;
      redraw(to);
      setWon(to);
      settle.current();
    };

    // Системная настройка «меньше движения» выключает поездку целиком, а не
    // ускоряет её: мелькание как раз то, от чего она защищает.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    const started = performance.now();
    let passed = Math.floor(from);
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      position.current = from + (to - from) * spinProgress(t);
      redraw(position.current);
      // Щелчок на проходе карточки, а не по таймеру: на разгоне щелчки
      // частые, на выбеге редеют — этим и слышно торможение.
      const crossed = Math.floor(position.current);
      if (crossed !== passed) {
        passed = crossed;
        if (!mutedRef.current) tickSound.current();
      }
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else { frame.current = null; finish(); }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.id]);

  const cell = cellWidth(width);
  const pitch = cell + GAP;
  const at = position.current;
  const current = Math.round(at);
  const middle = width / 2;
  const first = Math.floor(at - middle / pitch) - 1;
  const last = Math.ceil(at + middle / pitch) + 1;
  const tiles = segments.length ? Array.from({ length: last - first + 1 }, (_, k) => first + k) : [];

  return <div className="prize-strip" ref={stageRef} aria-hidden="true" style={{ "--cell": `${cell}px` } as CSSProperties}>
    <div className="prize-strip__track">
      {tiles.map(index => {
        const slot = ((index % segments.length) + segments.length) % segments.length;
        const prize = segments[slot];
        const sticker = stickers?.[slot];
        const x = middle + (index - at) * pitch - cell / 2;
        const state = index === won ? " is-won" : index === current ? " is-current" : "";
        return <div key={index} className={`prize-strip__tile${state}`} style={{ transform: `translateX(${x}px)` }}>
          {sticker && <span className="prize-strip__sticker" style={{ "--sticker": sticker.color } as CSSProperties}>{sticker.icon}</span>}
          <span className="prize-strip__title">{prize.title}</span>
          {prize.coins ? <span className="prize-strip__reward">+{coins(prize.coins)} {plural(prize.coins, "коин", "коина", "коинов")}</span> : <span className="prize-strip__reward prize-strip__reward--none">без награды</span>}
        </div>;
      })}
    </div>
    <div className="prize-strip__window" />
  </div>;
}
