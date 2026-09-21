import { useEffect, useRef } from "react";
import { fitCanvas, spinProgress, stripTarget } from "./spinPhysics";

export interface StripSegment {
  title: string;
  weight: number;
}

export interface SpinRequest {
  /** Меняется на каждой прокрутке — по нему компонент понимает, что пора ехать. */
  id: string;
  /** Индекс приза, который выбрал сервер. Клиент только доводит ленту до него. */
  segment: number;
}

const DURATION = 4200;
const GAP = 12;
const HEIGHT = 128;

/** Ширина карточки: на телефоне помещается две с половиной, на широком экране — пять. */
function cellWidth(width: number) {
  return Math.round(Math.min(190, Math.max(128, width / 4.2)));
}

/** Короткий щелчок при проходе карточки мимо метки. */
function makeClicker() {
  let ctx: AudioContext | null = null;
  return {
    click() {
      try {
        // Контекст создаётся при первом щелчке, то есть уже внутри жеста
        // пользователя: браузеры не дают завести звук раньше.
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx ??= new Ctor();
        if (ctx.state === "suspended") void ctx.resume();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(1180, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
      } catch {
        // Звук — украшение. Если браузер его не дал, лента едет дальше.
      }
    },
  };
}

export function PrizeStrip({
  segments,
  colors,
  spin,
  muted,
  onSettled,
}: {
  segments: StripSegment[];
  colors: string[];
  spin: SpinRequest | null;
  muted: boolean;
  onSettled: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offset = useRef(0);
  const frame = useRef<number | null>(null);
  const clicker = useRef(makeClicker());
  const lastSpin = useRef<string | null>(null);
  const settle = useRef(onSettled);
  settle.current = onSettled;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !segments.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const ratio = window.devicePixelRatio || 1;
    fitCanvas(canvas, ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cell = cellWidth(width);
    const pitch = cell + GAP;
    const cardHeight = Math.min(HEIGHT, height - 28);
    const top = (height - cardHeight) / 2;
    const middle = width / 2;

    // Рисуем только то, что попадает в кадр, плюс по одной карточке с краёв.
    const first = Math.floor((offset.current - middle) / pitch) - 1;
    const last = Math.ceil((offset.current + middle) / pitch) + 1;
    const font = getComputedStyle(document.body).fontFamily;

    for (let index = first; index <= last; index += 1) {
      const prize = segments[((index % segments.length) + segments.length) % segments.length];
      const center = middle + index * pitch - offset.current;
      const left = center - cell / 2;
      // Карточки по краям кадра приглушены: взгляд держится на середине,
      // где и произойдёт остановка.
      const distance = Math.min(1, Math.abs(center - middle) / middle);
      ctx.save();
      ctx.globalAlpha = 0.35 + (1 - distance) * 0.65;
      ctx.beginPath();
      ctx.roundRect(left, top, cell, cardHeight, 16);
      ctx.fillStyle = colors[((index % colors.length) + colors.length) % colors.length];
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `650 ${Math.max(13, cell * 0.115)}px ${font}`;
      // Длинное название переносим по словам, иначе оно вылезает за карточку.
      const words = prize.title.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > cell - 20 && line) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      if (line) lines.push(line);
      const step = Math.max(16, cell * 0.14);
      const start = top + cardHeight / 2 - ((lines.length - 1) * step) / 2;
      lines.slice(0, 3).forEach((text, row) => ctx.fillText(text, center, start + row * step));
      ctx.restore();
    }

    // Метка по центру: к ней и подъезжает выпавший приз.
    const ink = getComputedStyle(document.body).color;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(middle, 10);
    ctx.lineTo(middle, height - 10);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(middle - 9, 4);
    ctx.lineTo(middle + 9, 4);
    ctx.lineTo(middle, 19);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(() => draw());
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, colors]);

  useEffect(() => {
    if (!spin || spin.id === lastSpin.current || !segments.length) return;
    lastSpin.current = spin.id;

    const canvas = canvasRef.current;
    const pitch = cellWidth(canvas?.clientWidth ?? 600) + GAP;
    const from = offset.current;
    const to = stripTarget(from, spin.segment, segments.length, pitch);

    // Системная настройка «меньше движения» выключает поездку целиком, а не
    // ускоряет её: мелькание как раз то, от чего она защищает.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      offset.current = to;
      draw();
      settle.current();
      return;
    }

    const started = performance.now();
    let passed = Math.floor(from / pitch);

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      offset.current = from + (to - from) * spinProgress(t);
      draw();

      // Щелчок на проходе карточки, а не по таймеру: на разгоне щелчки
      // частые, на выбеге редеют — этим и слышно торможение.
      const crossed = Math.floor(offset.current / pitch);
      if (crossed !== passed) {
        passed = crossed;
        if (!mutedRef.current) clicker.current.click();
      }

      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
        settle.current();
      }
    };
    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.id]);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  return <canvas className="prize-strip" ref={canvasRef} aria-hidden="true" />;
}
