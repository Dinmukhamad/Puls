import { useEffect, useRef } from "react";

export interface WheelSegmentView {
  title: string;
  weight: number;
}

export interface SpinRequest {
  /** Меняется на каждой прокрутке — по нему компонент понимает, что пора крутить. */
  id: string;
  /** Индекс сектора, который выбрал сервер. Клиент только доводит колесо до него. */
  segment: number;
}

/**
 * Профиль скорости: разгон, затем инерционное торможение до полной остановки.
 *
 * Возвращает долю пройденного пути от 0 до 1. Функция подобрана так, чтобы
 * скорость была нулевой на обоих концах — иначе колесо дёргается на старте
 * и обрывается на финише, а это главное, что отличает живое вращение от
 * поворота картинки.
 *
 *   до ACCEL       скорость растёт линейно (разгон),
 *   после ACCEL    падает квадратично до нуля (выбег).
 *
 * Обе ветви сходятся в точке ACCEL и по значению, и по скорости, поэтому
 * перелома в движении не видно.
 */
const ACCEL = 0.22;
const SPAN = ACCEL / 2 + (1 - ACCEL) / 3;

export function spinProgress(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t <= ACCEL) return (t * t) / (2 * ACCEL) / SPAN;
  const tail = (1 - t) / (1 - ACCEL);
  return (ACCEL / 2 + ((1 - ACCEL) / 3) * (1 - tail ** 3)) / SPAN;
}

/**
 * Угол поворота, после которого под стрелкой окажется середина нужного
 * сектора. Отсчёт как у прежней вёрстки на CSS: стрелка сверху, сектор i
 * занимает [i·360/n, (i+1)·360/n] по часовой стрелке от неё.
 *
 * Полные обороты добавляются к текущему углу, а не к нулю: иначе при второй
 * прокрутке колесо отматывало бы назад.
 */
export function targetAngle(current: number, segment: number, count: number, turns = 4): number {
  const base = Math.floor(current / 360) * 360;
  return base + turns * 360 + 360 - ((segment + 0.5) * 360) / count;
}

/**
 * Подгоняет буфер холста под его размер на экране с учётом плотности пикселей.
 *
 * Стороны проверяются по отдельности намеренно. Сначала здесь стояло одно
 * условие по ширине — и оно промахивалось ровно в самом частом случае: у
 * холста размер буфера по умолчанию 300x150, ширина совпадала с нужной,
 * присваивание не выполнялось, и высота оставалась 150. Круг рисовался с
 * обрезанным низом, при этом и типы, и сборка, и тесты были зелёными.
 *
 * Возвращает true, если размер меняли: вызывающий код может по этому судить,
 * что содержимое буфера очищено браузером и его надо нарисовать заново.
 */
export function fitCanvas(canvas: { width: number; height: number; clientWidth: number }, ratio: number): boolean {
  const side = Math.round(canvas.clientWidth * ratio);
  let changed = false;
  if (canvas.width !== side) { canvas.width = side; changed = true; }
  if (canvas.height !== side) { canvas.height = side; changed = true; }
  return changed;
}

const DURATION = 4200;

/** Короткий щелчок при проходе стрелки над границей секторов. */
function makeClicker() {
  let ctx: AudioContext | null = null;
  return {
    click() {
      try {
        // Контекст создаётся при первом щелчке, то есть уже внутри жеста
        // пользователя: браузеры не дают завести звук раньше.
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
        // Звук — украшение. Если браузер его не дал, колесо крутится дальше.
      }
    },
  };
}

export function WheelCanvas({
  segments,
  colors,
  spin,
  muted,
  onSettled,
}: {
  segments: WheelSegmentView[];
  colors: string[];
  spin: SpinRequest | null;
  muted: boolean;
  onSettled: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angle = useRef(0);
  const frame = useRef<number | null>(null);
  const clicker = useRef(makeClicker());
  const lastSpin = useRef<string | null>(null);
  const settle = useRef(onSettled);
  settle.current = onSettled;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  /** Отрисовка круга под текущим углом. Отдельно от анимации: рисовать нужно
   *  и в покое — при первой загрузке и при смене набора секторов. */
  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !segments.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (!size) return;
    fitCanvas(canvas, ratio);

    const r = size / 2;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate((angle.current * Math.PI) / 180);

    const step = (Math.PI * 2) / segments.length;
    segments.forEach((_, index) => {
      const from = -Math.PI / 2 + index * step;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, from, from + step);
      ctx.closePath();
      ctx.fillStyle = colors[index % colors.length];
      ctx.fill();

      // Тонкая перемычка между секторами: без неё соседние цвета сливаются.
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.rotate(from + step / 2);
      ctx.translate(r * 0.72, 0);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "#fff";
      ctx.font = `650 ${Math.max(13, r * 0.11)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  // Перерисовываем при смене набора секторов и при изменении размера.
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

    const from = angle.current;
    const to = targetAngle(from, spin.segment, segments.length);

    // Системная настройка «меньше движения» выключает вращение целиком, а не
    // ускоряет его: быстрое мелькание как раз то, от чего она защищает.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      angle.current = to;
      draw();
      settle.current();
      return;
    }

    const started = performance.now();
    const step = 360 / segments.length;
    let passed = Math.floor(from / step);

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION);
      angle.current = from + (to - from) * spinProgress(t);
      draw();

      // Щелчок ровно на границе сектора, а не по таймеру: на разгоне они
      // частые, на выбеге редеют — этим и слышно, что колесо тормозит.
      const crossed = Math.floor(angle.current / step);
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

  return <canvas className="wheel-canvas" ref={canvasRef} aria-hidden="true" />;
}
