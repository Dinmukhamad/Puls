/**
 * The daily situations on the map (app/services/city_quests.py): a bouncing "!" over the depot's taxi, a car
 * at the CRM centre and the guide, one per open situation of the day. A click opens the situation.
 */
import * as THREE from "three/webgpu";
import type { CityContext } from "../engine/context";
import type { CityQuestInfo } from "../types";

/** How high over its spot each marker floats: over a car roof, over a car roof, over the guide's head. */
const LIFT = [2.1, 2.1, 3.1];
const REACH = 240;
const GIVER_LABEL: Record<string, string> = { driver: "Водитель ждёт помощи", client: "Звонок клиента", guide: "Вопрос от помощника" };

export interface Quests { set(states: CityQuestInfo[]): void; spot(slot: number): THREE.Vector3 | undefined; dispose(): void }

export function createQuests(ctx: CityContext, options: { states: CityQuestInfo[]; onPick?: (slot: number) => void }): Quests {
  const layer = document.createElement("div");
  layer.className = "c3-plots"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Задания дня на карте");
  ctx.overlay.append(layer);
  const view = new THREE.Vector3();
  const markers = ctx.world.questSpots.map((spot, slot) => {
    const el = document.createElement("button");
    el.type = "button"; el.className = "c3-quest"; el.dataset.slot = String(slot);
    el.innerHTML = '<span aria-hidden="true">!</span>';
    el.addEventListener("click", () => options.onPick?.(slot));
    layer.append(el);
    return { el, point: new THREE.Vector3(spot.x, LIFT[slot] ?? 2.1, spot.z), shown: false, transform: "" };
  });
  function set(states: CityQuestInfo[]) {
    markers.forEach((m, slot) => {
      const q = states.find(s => s.slot === slot);
      m.shown = !!options.onPick && !!q && !q.answered;
      m.el.setAttribute("aria-label", `${GIVER_LABEL[q?.giver ?? "guide"] ?? "Задание дня"}: открыть задание`);
      if (!m.shown) m.el.style.visibility = "hidden";
    });
  }
  const project = () => {
    const width = ctx.overlay.clientWidth, height = ctx.overlay.clientHeight;
    if (!width || !height) return;
    ctx.camera.updateMatrixWorld();
    const focal = ctx.camera.projectionMatrix.elements[5] * height / 2;
    for (const m of markers) {
      if (!m.shown) continue;
      view.copy(m.point).applyMatrix4(ctx.camera.matrixWorldInverse);
      const depth = -view.z;
      view.applyMatrix4(ctx.camera.projectionMatrix);
      const hidden = depth < ctx.camera.near || ctx.camera.position.distanceTo(m.point) > REACH || Math.abs(view.x) > 1.1 || Math.abs(view.y) > 1.1;
      m.el.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      const scale = THREE.MathUtils.clamp(focal / depth * .05, .6, 1.15);
      const next = `translate3d(${((view.x + 1) * width / 2).toFixed(1)}px,${((1 - view.y) * height / 2).toFixed(1)}px,0) translate(-50%,-100%) scale(${scale.toFixed(3)})`;
      if (next !== m.transform) { m.transform = next; m.el.style.transform = next; }
    }
  };
  const offFrame = ctx.onFrame(project), offMove = ctx.onCameraMove(project);
  set(options.states);
  return {
    set,
    spot: slot => markers[slot]?.point,
    dispose() { offFrame(); offMove(); layer.remove(); },
  };
}
