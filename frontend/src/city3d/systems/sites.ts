/**
 * The group city's quarters (world/sites.ts), each drawn at the stage the server reports, through instance
 * pools and ground patches of their own so a new stage rebuilds only these quarters. Without a group
 * (staff, operators outside one) every quarter stands finished. The quarter being built carries a sign
 * with its name and stage that opens the group panel.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { Catalogue } from "../assets/catalogue";
import { createInstancePools, type InstancePools } from "../render/instances";
import { createPatches } from "../render/terrain";
import { siteLayout, type Site, type SiteStage } from "../world/sites";
import type { CitySiteInfo } from "../types";

const STAGE_NAMES: Record<SiteStage, string> = { planned: "Запланирован", foundation: "Фундамент", frame: "Каркас", floors: "Этажи", done: "Построен" };
/** The sign shows only this close to the camera. */
const SIGN_REACH = 260;

export interface Sites {
  set(states: CitySiteInfo[] | null): void;
  setCatalogue(catalogue: Catalogue): void;
  find(key: string): Site | undefined;
  dispose(): void;
}

export function createSites(ctx: CityContext, options: { states: CitySiteInfo[] | null; onPick?: (key: string) => void }): Sites {
  const sites = ctx.world.sites;
  let states: Map<string, CitySiteInfo> | null = null, catalogue: Catalogue | null = null;
  let pools: InstancePools | null = null, patches: THREE.Mesh | null = null;
  const stageOf = (site: Site): SiteStage => states ? states.get(site.key)?.stage ?? "planned" : "done";

  const layer = document.createElement("div");
  layer.className = "c3-plots"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Стройки группы");
  ctx.overlay.append(layer);
  const sign = document.createElement("button");
  sign.type = "button"; sign.className = "c3-site";
  sign.addEventListener("click", () => { if (current) options.onPick?.(current.key); });
  layer.append(sign);
  let current: Site | null = null, transform = "";
  const point = new THREE.Vector3(), view = new THREE.Vector3();

  function rebuild() {
    if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); patches = null; }
    pools?.dispose(); pools = null;
    const layouts = sites.map(site => siteLayout(site, stageOf(site)));
    if (sites.length) { patches = createPatches(layouts.flatMap(l => l.surfaces)); ctx.scene.add(patches); }
    if (catalogue) pools = createInstancePools(ctx, catalogue, layouts.flatMap(l => l.placements));
    ctx.requestShadowUpdate();
    // The sign stands over the first quarter still to finish, once it is under way.
    current = states ? sites.find(site => !["done", "planned"].includes(stageOf(site))) ?? null : null;
    if (current) {
      const info = states!.get(current.key);
      sign.innerHTML = `<span aria-hidden="true">🏗️</span><span><strong></strong><small></small></span>`;
      sign.querySelector("strong")!.textContent = info?.name ?? "Квартал группы";
      sign.querySelector("small")!.textContent = `Стройка группы · ${STAGE_NAMES[stageOf(current)]}`;
      sign.setAttribute("aria-label", `${info?.name ?? "Квартал группы"}: ${STAGE_NAMES[stageOf(current)]}. Открыть город группы`);
      point.set(current.x, 10, current.z);
    }
    sign.style.visibility = "hidden";
  }

  const project = () => {
    if (!current) return;
    const width = ctx.overlay.clientWidth, height = ctx.overlay.clientHeight;
    if (!width || !height) return;
    ctx.camera.updateMatrixWorld();
    view.copy(point).applyMatrix4(ctx.camera.matrixWorldInverse);
    const depth = -view.z;
    view.applyMatrix4(ctx.camera.projectionMatrix);
    const hidden = depth < ctx.camera.near || ctx.camera.position.distanceTo(point) > SIGN_REACH || Math.abs(view.x) > 1.1 || Math.abs(view.y) > 1.1;
    sign.style.visibility = hidden ? "hidden" : "visible";
    if (hidden) return;
    const focal = ctx.camera.projectionMatrix.elements[5] * height / 2, scale = THREE.MathUtils.clamp(focal / depth * .09, .6, 1);
    const next = `translate3d(${((view.x + 1) * width / 2).toFixed(1)}px,${((1 - view.y) * height / 2).toFixed(1)}px,0) translate(-50%,-100%) scale(${scale.toFixed(3)})`;
    if (next !== transform) { transform = next; sign.style.transform = next; }
  };
  const offFrame = ctx.onFrame(project), offMove = ctx.onCameraMove(project);

  const apply = (next: CitySiteInfo[] | null) => { states = next ? new Map(next.map(s => [s.key, s])) : null; };
  apply(options.states);
  rebuild();

  return {
    set(next) { apply(next); rebuild(); },
    setCatalogue(value) { catalogue = value; rebuild(); },
    find: key => sites.find(s => s.key === key),
    dispose() {
      offFrame(); offMove(); layer.remove(); pools?.dispose();
      if (patches) { ctx.scene.remove(patches); patches.geometry.dispose(); (patches.material as THREE.Material).dispose(); }
    },
  };
}
