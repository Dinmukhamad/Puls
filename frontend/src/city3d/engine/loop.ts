/**
 * The frame loop: requestAnimationFrame, paused in a hidden tab and while the canvas is scrolled out of
 * view (TZ §9.3.9), capped at 30 frames a second when quality asks for it.
 */

/** A little slack keeps the 30 fps throttle on every second vsync instead of slipping to every third. */
export const CAP_SLACK = 3;
/** Longest step animations take, so a stall does not teleport cars. */
export const MAX_DT = .05;

/** Whether a vsync at `now` should draw, given the last drawn frame and the frame-rate cap. */
export function shouldDraw(now: number, last: number, fps: 60 | 30) {
  return fps === 60 || now - last >= 1000 / 30 - CAP_SLACK;
}

export interface LoopOptions {
  /** The element whose visibility pauses the loop (the city host). */
  host: Element;
  /** Start drawing immediately unless false, e.g. while a cached city is detached. Defaults to true. */
  active?: boolean;
  /** Draws one frame: dt in seconds (clamped to 0.05), now in ms. */
  render: (dt: number, now: number) => void;
  fps: () => 60 | 30;
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
  let last = -1, visible = true, disposed = false;
  const canDraw = () => !disposed && active && visible && !document.hidden;

  function schedule() {
    if (frame === null && canDraw()) frame = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    frame = null;
    if (!canDraw()) return;
    try {
      if (last >= 0 && !shouldDraw(now, last, fps())) { schedule(); return; }
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
    last = -1; schedule();
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
