import { useCallback, useEffect, useRef, useState } from 'react';
import { Ticket, Volume2, VolumeX } from 'lucide-react';
import { WHEEL_SECTORS } from '../../mockData';
import { useStore } from '../../store';
import { fmtNumber, fmtTime } from '../../lib/format';
import { Badge, Button, EmptyState, PageHeader, Panel, PanelHeader, cx } from '../ui/primitives';
import type { WheelSector } from '../../types';

const SECTORS = WHEEL_SECTORS;
const TAU = Math.PI * 2;

/** Приз выбирается по весам ДО анимации, и колесо докручивается к нему. */
function drawPrize(): { sector: WheelSector; index: number } {
  const total = SECTORS.reduce((s, x) => s + x.weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < SECTORS.length; i += 1) {
    roll -= SECTORS[i].weight;
    if (roll <= 0) return { sector: SECTORS[i], index: i };
  }
  return { sector: SECTORS[SECTORS.length - 1], index: SECTORS.length - 1 };
}

/**
 * Колесо фортуны.
 *
 * Устройство честное и это важно: приз определяется весами заранее, а
 * анимация лишь доводит стрелку до выбранного сектора. Обратный порядок —
 * «куда остановилось, то и выпало» — сделал бы результат заложником
 * частоты кадров.
 *
 * Торможение задано функцией с крутым началом и длинным хвостом: так
 * колесо замедляется как настоящее, а не линейно.
 */
export function WheelView(): JSX.Element {
  const { state, dispatch, me } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const rafRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const lastTickRef = useRef(0);

  const [spinning, setSpinning] = useState(false);
  const [sound, setSound] = useState(true);
  const [outcome, setOutcome] = useState<WheelSector | null>(null);

  const canSpin = !spinning && (me.tickets > 0 || state.freeSpins > 0);

  /* ── Отрисовка ─────────────────────────────────────────── */

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const r = size / 2;
    const step = TAU / SECTORS.length;
    const dark = document.documentElement.classList.contains('dark');

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(angleRef.current);

    SECTORS.forEach((sector, i) => {
      const from = i * step;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r - 10, from, from + step);
      ctx.closePath();

      // Монохром с чередованием и одной золотой нотой на крупный выигрыш.
      const big = sector.kind === 'coins' && sector.amount >= 300;
      if (big) ctx.fillStyle = dark ? '#3a3122' : '#efe3c2';
      else if (sector.kind === 'nothing') ctx.fillStyle = dark ? '#17181c' : '#f4f4f5';
      else ctx.fillStyle = dark ? (i % 2 ? '#1f2025' : '#26272d') : i % 2 ? '#ffffff' : '#ededf0';
      ctx.fill();

      ctx.strokeStyle = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.rotate(from + step / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px ui-sans-serif, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = big ? '#d4b656' : dark ? '#d4d4d8' : '#3f3f46';
      ctx.fillText(sector.label, r - 26, 0);
      ctx.restore();
    });

    ctx.restore();

    // Ступица поверх секторов.
    ctx.beginPath();
    ctx.arc(r, r, 34, 0, TAU);
    ctx.fillStyle = dark ? '#0d0e12' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 360 * dpr;
    canvas.height = 360 * dpr;
    canvas.style.width = '360px';
    canvas.style.height = '360px';
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr / dpr, dpr / dpr);
    paint();
  }, [paint, state.theme]);

  /* ── Щелчок ────────────────────────────────────────────── */

  const click = useCallback(() => {
    if (!sound) return;
    try {
      audioRef.current ??= new AudioContext();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 1100;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.045);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // Звук — приятное дополнение. Если браузер его не даёт, колесо
      // продолжает работать, а пользователю ничего сообщать не нужно.
    }
  }, [sound]);

  /* ── Прокрутка ─────────────────────────────────────────── */

  const spin = (): void => {
    if (!canSpin) return;
    const { sector, index } = drawPrize();
    const step = TAU / SECTORS.length;
    // Чем платим за прокрутку, решаем здесь и запоминаем: пока колесо
    // крутится, состояние может измениться, и в конце было бы уже не
    // понять, был ли это бесплатный ход.
    const usedFreeSpin = state.freeSpins > 0;

    setSpinning(true);
    setOutcome(null);

    // Стрелка сверху: сектор должен встать под неё центром.
    const target = TAU * 6 + (TAU - (index * step + step / 2)) - Math.PI / 2;
    const start = angleRef.current % TAU;
    const distance = target - start;
    const duration = 4200;
    const startedAt = performance.now();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      angleRef.current = target;
      paint();
      settle(sector, usedFreeSpin);
      return;
    }

    const frame = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / duration);
      // Разгон первые 12%, дальше долгое торможение.
      const eased = t < 0.12 ? (t / 0.12) ** 2 * 0.06 : 0.06 + (1 - (1 - (t - 0.12) / 0.88) ** 4) * 0.94;
      angleRef.current = start + distance * eased;

      const passed = Math.floor(angleRef.current / step);
      if (passed !== lastTickRef.current) {
        lastTickRef.current = passed;
        if (t < 0.97) click();
      }

      paint();
      if (t < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        settle(sector, usedFreeSpin);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  };

  const settle = (sector: WheelSector, usedFreeSpin: boolean): void => {
    setSpinning(false);
    setOutcome(sector);
    dispatch({
      type: 'spinWheel',
      label: sector.label,
      kind: sector.kind,
      amount: sector.amount,
      usedFreeSpin,
    });
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <>
      <PageHeader
        title="Колесо WOW"
        hint="Прокрутка стоит один билет. Приз определяется до вращения — колесо лишь показывает результат."
        action={
          <>
            <Badge mono><Ticket size={12} /> {me.tickets}</Badge>
            {state.freeSpins > 0 ? <Badge tone="affirm" mono>+{state.freeSpins} бесплатных</Badge> : null}
            <Button variant="ghost" size="sm" onClick={() => setSound((s) => !s)} aria-label={sound ? 'Выключить звук' : 'Включить звук'}>
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        <Panel className="flex flex-col items-center">
          <div className="relative">
            {/* Стрелка сверху, вершиной вниз. */}
            <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
              <div className="h-0 w-0 border-l-[9px] border-r-[9px] border-t-[16px] border-l-transparent border-r-transparent border-t-zinc-900 dark:border-t-zinc-100" />
            </div>
            <canvas ref={canvasRef} role="img" aria-label="Колесо призов" className="max-w-full" />
          </div>

          <Button
            variant="primary"
            className="mt-6 w-full max-w-[220px]"
            disabled={!canSpin}
            onClick={spin}
          >
            {spinning ? 'Крутится…' : state.freeSpins > 0 ? 'Бесплатная прокрутка' : 'Крутить за билет'}
          </Button>

          {!canSpin && !spinning ? (
            <p className="mt-3 text-center text-[12.5px] text-zinc-500 dark:text-zinc-400">
              Билетов нет. Их выдаёт руководитель за заметный результат, а ещё они приходят с миссий и тестов.
            </p>
          ) : null}

          {outcome ? (
            <div className="mt-5 w-full rounded-lg border border-zinc-200 px-4 py-3 text-center dark:border-zinc-800">
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Выпало</p>
              <p className={cx('mt-1 text-[16px] font-medium', outcome.kind === 'nothing' ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-50')}>
                {outcome.label}
              </p>
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader title="История прокруток" hint={`${state.spinHistory.length} за сессию`} />
          {state.spinHistory.length === 0 ? (
            <EmptyState
              title="Прокруток ещё не было"
              detail="Здесь появится список: что выпало и когда. История ведётся в рамках текущей сессии."
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {state.spinHistory.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="text-[13.5px] text-zinc-800 dark:text-zinc-200">{entry.label}</span>
                  <span className="shrink-0 font-mono tnum text-[12.5px] text-zinc-400 dark:text-zinc-600">
                    {fmtTime(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <p className="mb-2.5 text-[13px] font-medium text-zinc-900 dark:text-zinc-100">Состав колеса</p>
            <ul className="space-y-1.5">
              {SECTORS.map((s) => {
                const total = SECTORS.reduce((sum, x) => sum + x.weight, 0);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-zinc-600 dark:text-zinc-400">{s.label}</span>
                    <span className="font-mono tnum text-zinc-400 dark:text-zinc-600">
                      {fmtNumber((s.weight / total) * 100, 1)}%
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12px] text-zinc-500 dark:text-zinc-500">
              Шансы показаны честно: это те же веса, по которым выбирается приз.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
