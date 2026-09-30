import type { CityControl, CityOptions } from "../../city3d/types";

type Factory = (host: HTMLDivElement, options: CityOptions) => CityControl;
type Status = "loading" | "ready" | "failed";
interface Entry {
  owner: string; key: string; host: HTMLDivElement; frame: HTMLDivElement;
  control: CityControl; callbacks: CityOptions | null; status: Status;
  traffic: boolean; selected: CityOptions["selected"]; lease: symbol | null;
}

/** One live scene per browser tab. Detached scenes retain GPU resources, but never draw or handle keys. */
export function createCityRetention() {
  let entry: Entry | null = null;
  function clear() {
    const old = entry; entry = null;
    if (!old) return;
    old.callbacks = null; old.lease = null;
    old.control.dispose(); old.host.remove(); old.frame.remove();
  }
  return {
    clear,
    /** Logout, account changes and revoked access must also clear a detached city. */
    setOwner(owner: string | null) { if (entry && entry.owner !== owner) clear(); },
    acquire({ owner, key, mount, options, traffic, create }: {
      owner: string; key: string; mount: HTMLDivElement; options: CityOptions; traffic: boolean; create: Factory;
    }) {
      if (entry && (entry.owner !== owner || entry.key !== key || entry.status === "failed")) clear();
      const reused = !!entry;
      if (!entry) {
        const host = document.createElement("div"), frame = document.createElement("div");
        host.className = "city-scene"; host.tabIndex = 0; host.setAttribute("role", "application");
        frame.className = "city-frame"; frame.setAttribute("aria-hidden", "true");
        mount.append(host, frame);
        const next = { owner, key, host, frame, callbacks: options, status: "loading", traffic, selected: options.selected, lease: null } as Entry;
        const status = (value: Status) => {
          next.status = value;
          if (value === "ready") next.callbacks?.onReady();
          else if (value === "failed") next.callbacks?.onLost();
        };
        let raw: CityControl;
        try { raw = create(host, {
          ...options, frame,
          onSelect: id => { next.selected = id; next.callbacks?.onSelect(id); },
          onView: view => next.callbacks?.onView(view),
          onPlot: options.onPlot ? key => next.callbacks?.onPlot?.(key) : undefined,
          onSite: options.onSite ? key => next.callbacks?.onSite?.(key) : undefined,
          onQuest: options.onQuest ? slot => next.callbacks?.onQuest?.(slot) : undefined,
          onReady: () => status("ready"), onLost: () => status("failed"),
          onRestored: () => { status("ready"); next.callbacks?.onRestored?.(); },
          onProgress: share => next.callbacks?.onProgress?.(share),
        }); } catch (error) {
          // A synchronous factory failure must not leave an orphaned scene or
          // callbacks into the page; a later visit can try a clean creation.
          next.callbacks = null;
          host.remove(); frame.remove();
          throw error;
        }
        next.control = {
          ...raw,
          select(id) { next.selected = id; raw.select(id); },
          setTraffic(enabled) { next.traffic = enabled; raw.setTraffic(enabled); },
        };
        entry = next;
        next.control.setTraffic(traffic);
      }
      const current = entry, lease = Symbol("city visit");
      current.lease = lease; current.callbacks = options;
      mount.append(current.host, current.frame);
      if (reused) {
        current.control.setLevels(options.levels, options.grown);
        current.control.setLabels(options.labels);
        if (options.mascot) current.control.setMascot(options.mascot);
        current.control.setPlots(options.plots ?? []);
        current.control.setSites(options.sites ?? null);
        current.control.setQuests(options.quests ?? []);
        current.control.setTimeOfDay(options.timeOfDay ?? "day");
        current.control.setControls(options.controls ?? "orbit");
        if (current.selected !== options.selected) current.control.select(options.selected);
      }
      current.control.setActive(true);
      return {
        control: current.control, host: current.host, status: current.status, traffic: current.traffic, reused,
        release() {
          if (entry !== current || current.lease !== lease) return;
          current.lease = null; current.callbacks = null;
          current.control.setActive(false);
          current.host.remove(); current.frame.remove();
        },
      };
    },
  };
}

// This module has no runtime import of the engine: other pages do not download Three.js.
export const retainedCity = createCityRetention();
