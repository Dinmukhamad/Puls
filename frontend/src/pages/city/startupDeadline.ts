/** A hidden browser tab must not spend the time allowed for the city's first visible frame. */
export function watchCityStartup(onTimeout: () => void, timeoutMs = 50_000, runtime = {
  now: () => performance.now(),
  visibility: document,
  schedule: (callback: () => void, delay: number) => window.setTimeout(callback, delay),
  unschedule: (timer: number) => window.clearTimeout(timer),
}) {
  let remaining = timeoutMs, started = 0, timer: number | undefined, stopped = false;
  function pause() {
    if (timer === undefined) return;
    runtime.unschedule(timer); timer = undefined;
    remaining = Math.max(0, remaining - (runtime.now() - started));
  }
  function stop() {
    stopped = true; pause();
    runtime.visibility.removeEventListener("visibilitychange", visibility);
  }
  function resume() {
    if (stopped || timer !== undefined || runtime.visibility.hidden) return;
    started = runtime.now();
    timer = runtime.schedule(() => { timer = undefined; stop(); onTimeout(); }, remaining);
  }
  function visibility() { if (runtime.visibility.hidden) pause(); else resume(); }
  runtime.visibility.addEventListener("visibilitychange", visibility);
  resume();
  return stop;
}
