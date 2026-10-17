/**
 * The plots on the green belt behind the learning districts (world/plots.ts), built up: what the operator built there and,
 * on the others, a building of each plot's own (plotBuilding). Drawn through instance pools of their own, so a change
 * rebuilds only these few copies, not the city.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { plotBuilding, plotLayout, type Plot, type PlotState } from "../world/plots";
import type { CityPlotInfo } from "../types";

export interface Plots {
  set(states: CityPlotInfo[]): void;
  setCatalogue(catalogue: Catalogue): void;
  dispose(): void;
}

export function createPlots(ctx: CityContext, options: { states: CityPlotInfo[] }): Plots {
  const plots = ctx.world.plots;
  let states = new Map(options.states.map(s => [s.key, s])), catalogue: Catalogue | null = null;
  let pools: InstancePools | null = null, patches: THREE.Mesh | null = null;
  const stateOf = (plot: Plot): PlotState => ({ unlocked: true, item: plotBuilding(plot, states.get(plot.key)?.item ?? null) });

  function rebuild() {
    if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); patches = null; }
    pools?.dispose(); pools = null;
    const layouts = plots.map(plot => plotLayout(plot, stateOf(plot)));
    if (plots.length) { patches = createPatches(layouts.flatMap(l => l.surfaces)); ctx.scene.add(patches); }
    if (catalogue) pools = createInstancePools(ctx, catalogue, layouts.flatMap(l => l.placements));
    ctx.requestShadowUpdate();
  }
  rebuild();

  return {
    set(next) { states = new Map(next.map(s => [s.key, s])); rebuild(); },
    setCatalogue(value) { catalogue = value; rebuild(); },
    dispose() {
      pools?.dispose();
      if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); }
    },
  };
}
