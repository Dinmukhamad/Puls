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
  /** Draws one frame: dt in seconds (clamped to 0.05), now in ms. */
  render: (dt: number, now: number) => void;
  fps: () => 60 | 30;
  /** Time since the previous drawn frame, for quality; Infinity after a pause, so its window restarts. */
  onGap?: (gap: number, now: number) => void;
}

export interface Loop {
  readonly running: boolean;
  dispose(): void;
}

export function createLoop({ host, render, fps, onGap }: LoopOptions): Loop {
  let frame = 0, last = -1, visible = true, disposed = false;

  function tick(now: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    if (last >= 0 && !shouldDraw(now, last, fps())) { frame = requestAnimationFrame(tick); return; }
    const gap = last < 0 ? Infinity : now - last, dt = last < 0 ? 1 / 60 : Math.min(MAX_DT, gap / 1000);
    last = now;
    onGap?.(gap, now);
    render(dt, now);
    frame = requestAnimationFrame(tick);
  }
  /** After a pause the next frame starts a fresh measurement instead of reporting the pause as a frame. */
  function resume() {
    if (disposed || frame || !visible || document.hidden) return;
    last = -1; frame = requestAnimationFrame(tick);
  }
  function pause() { if (frame) cancelAnimationFrame(frame); frame = 0; }

  const onVisibility = () => { if (document.hidden) pause(); else resume(); };
  document.addEventListener("visibilitychange", onVisibility);
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) resume(); else pause();
  });
  observer?.observe(host);
  resume();

  return {
    get running() { return frame !== 0; },
    dispose() {
      disposed = true; pause(); observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
