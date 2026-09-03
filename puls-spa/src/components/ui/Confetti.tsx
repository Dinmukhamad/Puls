import { useEffect, useRef } from 'react';

/**
 * Салют при получении награды. Рисуется на Canvas, а не сотней элементов
 * в разметке: восемьдесят частиц через DOM заставили бы браузер считать
 * раскладку на каждом кадре.
 *
 * Строгая палитра распространяется и сюда: конфетти монохромное с одной
 * золотой нотой на монету. Разноцветный дождь спорил бы с правилом
 * «цвет только функционален».
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
}

const PALETTE = ['#d4b656', '#e4e4e7', '#a1a1aa', '#71717a', '#fafafa'];

export function Confetti({ trigger, onDone }: { trigger: string | null; onDone: () => void }): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!trigger) return undefined;

    // Уважаем системную настройку: вместо салюта просто закрываем событие.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = window.setTimeout(() => doneRef.current(), 400);
      return () => window.clearTimeout(timer);
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const particles: Particle[] = Array.from({ length: 90 }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 220,
      y: height * 0.34 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 8,
      size: 3 + Math.random() * 5,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    }));

    let frame = 0;
    let raf = 0;

    const tick = (): void => {
      frame += 1;
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.vy += 0.32;      // сила тяжести
        p.vx *= 0.995;     // сопротивление воздуха
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = Math.max(0, 1 - frame / 110);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
        ctx.restore();
      }
      if (frame < 110) {
        raf = window.requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
        doneRef.current();
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [trigger]);

  if (!trigger) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
    />
  );
}
