/**
 * The frame loop: requestAnimationFrame, paused in a hidden tab and while the canvas is scrolled out of
 * view (TZ §9.3.9), capped at the frame rate the city asks for: 60 or 30 from quality, fewer while it rests.
 */

/**
 * A frame may come this share of a vsync early and still be drawn, so a cap lands on whole vsyncs: 60 draws
 * every vsync of a 60 or 75 Hz screen and every second one at 120 Hz, 30 every second vsync at 60 Hz.
 */
export const CAP_SLACK = .6;
/** Longest step animations take, so a stall does not teleport cars. */
export const MAX_DT = .05;

/** Whether a vsync at `now` should draw, given the last drawn frame, the cap and the screen's vsync interval in ms. */
export function shouldDraw(now: number, last: number, fps: number, vsync = 1000 / 60) {
  return now - last >= 1000 / fps - CAP_SLACK * vsync;
}

export interface LoopOptions {
  /** The element whose visibility pauses the loop (the city host). */
  host: Element;
  /** Start drawing immediately unless false, e.g. while a cached city is detached. Defaults to true. */
  active?: boolean;
  /** Draws one frame: dt in seconds (clamped to 0.05), now in ms. */
  render: (dt: number, now: number) => void;
  /** Frames a second at most: 60 or 30 from quality, fewer while the city rests or loads. */
  fps: () => number;
  /** Time since the previous drawn frame, for quality; Infinity after a pause, so its window restarts. */
  onGap?: (gap: number, now: number) => void;
  /** A failed frame stops the loop and lets the page recover instead of remaining on its loading screen. */
  onError?: (error: unknown) => void;
}

export interface Loop {
  readonly running: boolean;
  /** Pauses all frames; resuming still waits for a visible document and host. */
  setActive(active: boolean): void;
  dispose(): void;
}

export function createLoop({ host, render, fps, onGap, onError, active = true }: LoopOptions): Loop {
  let frame: number | null = null;
  // The screen's vsync interval, learnt from the steady steps between callbacks (120 Hz screens draw 60).
  let last = -1, lastTick = -1, vsync = 1000 / 60, visible = true, disposed = false;
  const canDraw = () => !disposed && active && visible && !document.hidden;

  function schedule() {
    if (frame === null && canDraw()) frame = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    frame = null;
    if (!canDraw()) return;
    const step = now - lastTick; lastTick = now;
    if (step > 2 && step < 40) vsync += (step - vsync) * .1;
    try {
      if (last >= 0 && !shouldDraw(now, last, fps(), vsync)) { schedule(); return; }
      const gap = last < 0 ? Infinity : now - last, dt = last < 0 ? 1 / 60 : Math.min(MAX_DT, gap / 1000);
      last = now;
      onGap?.(gap, now);
      if (!canDraw()) return;
      render(dt, now);
    } catch (error) {
      active = false; pause();
      if (onError) onError(error); else throw error;
      return;
    }
    // A callback can deactivate or dispose the city, or resume it and already schedule its next frame.
    schedule();
  }
  /** After a pause the next frame starts a fresh measurement instead of reporting the pause as a frame. */
  function resume() {
    if (!canDraw() || frame !== null) return;
    last = lastTick = -1; schedule();
  }
  function pause() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }

  const onVisibility = () => { if (document.hidden) pause(); else resume(); };
  document.addEventListener("visibilitychange", onVisibility);
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    if (!entries.length) return;
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) resume(); else pause();
  });
  observer?.observe(host);
  resume();

  return {
    get running() { return frame !== null; },
    setActive(next) {
      if (disposed || active === next) return;
      active = next;
      if (active) resume(); else pause();
    },
    dispose() {
      disposed = true; pause(); observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
