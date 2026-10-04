export const CITY_ROUTE_LOAD_TIMEOUT = 30_000;

export type CityRouteLoadState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; reason: "timeout" | "failed" };

type Clock = {
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

/** Only a successful module is cached. Each active visit has a bounded load. */
export function createCityRouteLoader<T>(importModule: () => Promise<T>, options: { timeout?: number; clock?: Clock } = {}) {
  const clock: Clock = options.clock ?? {
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: timer => clearTimeout(timer),
  };
  const timeout = options.timeout ?? CITY_ROUTE_LOAD_TIMEOUT;
  const listeners = new Set<(state: CityRouteLoadState<T>) => void>();
  let cached: { value: T } | null = null;
  let attempt: { timer: ReturnType<typeof setTimeout> } | null = null;

  function abandon() {
    if (attempt) clock.clearTimeout(attempt.timer);
    attempt = null;
  }

  function begin() {
    const current = { timer: clock.setTimeout(() => finish({ status: "error", reason: "timeout" }), timeout) };
    attempt = current;
    function finish(state: Exclude<CityRouteLoadState<T>, { status: "loading" }>) {
      // Native imports cannot be aborted. A late settlement belongs to its
      // original visit and must not overwrite a retry or populate its cache.
      if (attempt !== current) return;
      abandon();
      if (state.status === "ready") cached = { value: state.value };
      const active = [...listeners];
      listeners.clear();
      active.forEach(listener => listener(state));
    }
    try {
      Promise.resolve(importModule()).then(
        value => finish({ status: "ready", value }),
        () => finish({ status: "error", reason: "failed" }),
      );
    } catch {
      finish({ status: "error", reason: "failed" });
    }
  }

  return {
    peek(): CityRouteLoadState<T> {
      return cached ? { status: "ready", value: cached.value } : { status: "loading" };
    },
    subscribe(listener: (state: CityRouteLoadState<T>) => void) {
      if (cached) {
        listener({ status: "ready", value: cached.value });
        return () => {};
      }
      // A wrapper gives each subscription its own identity, including retries
      // and development StrictMode's mount/cleanup/mount sequence.
      const notify = (state: CityRouteLoadState<T>) => listener(state);
      listeners.add(notify);
      notify({ status: "loading" });
      if (!attempt) begin();
      return () => {
        if (listeners.delete(notify) && listeners.size === 0) abandon();
      };
    },
  };
}
