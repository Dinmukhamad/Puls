/**
 * The operator's plots on the green belt (world/plots.ts): their ground patches, what the operator built
 * there (drawn through instance pools of their own, so a purchase rebuilds only these few copies, not the
 * city), and a marker over every open plot that is still empty, which opens the building catalogue.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { plotLayout, type Plot, type PlotState } from "../world/plots";
import type { CityPlotInfo } from "../types";

/** Markers show only this close to the camera, so the belt does not fill with pins from afar. */
const MARKER_REACH = 150;

export interface Plots {
  set(states: CityPlotInfo[]): void;
  setCatalogue(catalogue: Catalogue): void;
  /** Where to look at a plot from. */
  find(key: string): Plot | undefined;
  dispose(): void;
}

export function createPlots(ctx: CityContext, options: { states: CityPlotInfo[]; onPick?: (key: string) => void }): Plots {
  const plots = ctx.world.plots;
  let states = new Map(options.states.map(s => [s.key, s])), catalogue: Catalogue | null = null;
  let pools: InstancePools | null = null, patches: THREE.Mesh | null = null;
  const stateOf = (plot: Plot): PlotState => { const s = states.get(plot.key); return { unlocked: !!s?.unlocked, item: s?.item ?? null }; };

  function rebuild() {
    if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); patches = null; }
    pools?.dispose(); pools = null;
    const layouts = plots.map(plot => plotLayout(plot, stateOf(plot)));
    if (plots.length) { patches = createPatches(layouts.flatMap(l => l.surfaces)); ctx.scene.add(patches); }
    if (catalogue) pools = createInstancePools(ctx, catalogue, layouts.flatMap(l => l.placements));
    ctx.requestShadowUpdate();
    markers.forEach(m => m.refresh());
  }

  // One button per plot; only the open, empty ones are shown, and only when the viewer may build.
  const layer = document.createElement("div");
  layer.className = "c3-plots"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Участки для построек");
  ctx.overlay.append(layer);
  const anchor = new THREE.Vector3(), view = new THREE.Vector3();
  const markers = plots.map(plot => {
    const el = document.createElement("button");
    el.type = "button"; el.className = "c3-plot"; el.dataset.plot = plot.key;
    el.innerHTML = '<span aria-hidden="true">＋</span><small>Построить</small>';
    el.setAttribute("aria-label", "Свободный участок: выбрать постройку");
    el.addEventListener("click", () => options.onPick?.(plot.key));
    layer.append(el);
    const point = new THREE.Vector3(plot.x, 1.4, plot.z);
    let shown = false, transform = "";
    return {
      refresh() { const s = stateOf(plot); shown = !!options.onPick && s.unlocked && !s.item; if (!shown) el.style.visibility = "hidden"; },
      place(width: number, height: number, focal: number) {
        if (!shown) return;
        view.copy(anchor.copy(point)).applyMatrix4(ctx.camera.matrixWorldInverse);
        const depth = -view.z, far = ctx.camera.position.distanceTo(point) > MARKER_REACH;
        view.applyMatrix4(ctx.camera.projectionMatrix);
        const hidden = far || depth < ctx.camera.near || Math.abs(view.x) > 1.2 || Math.abs(view.y) > 1.2;
        el.style.visibility = hidden ? "hidden" : "visible";
        if (hidden) return;
        const scale = THREE.MathUtils.clamp(focal / depth * .06, .55, 1.1);
        const next = `translate3d(${((view.x + 1) * width / 2).toFixed(1)}px,${((1 - view.y) * height / 2).toFixed(1)}px,0) translate(-50%,-100%) scale(${scale.toFixed(3)})`;
        if (next !== transform) { transform = next; el.style.transform = next; }
      },
    };
  });
  const project = () => {
    const width = ctx.overlay.clientWidth, height = ctx.overlay.clientHeight;
    if (!width || !height) return;
    ctx.camera.updateMatrixWorld();
    const focal = ctx.camera.projectionMatrix.elements[5] * height / 2;
    markers.forEach(m => m.place(width, height, focal));
  };
  const offFrame = ctx.onFrame(project), offMove = ctx.onCameraMove(project);
  rebuild();

  return {
    set(next) { states = new Map(next.map(s => [s.key, s])); rebuild(); },
    setCatalogue(value) { catalogue = value; rebuild(); },
    find: key => plots.find(p => p.key === key),
    dispose() {
      offFrame(); offMove(); layer.remove(); pools?.dispose();
      if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); }
    },
  };
}
