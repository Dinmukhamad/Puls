/**
 * District labels as HTML over the canvas (TZ §9.2): the old canvas boards (icon, name, status, the active
 * one in the district's colour) as buttons, plus the assistant's name tag. Every frame the anchors are
 * projected and only `transform` changes, so text stays sharp, skips the post effects, reaches screen
 * readers and takes clicks and the keyboard without a render pass of its own.
 */
import * as THREE from "three/webgpu";
import type { DistrictId } from "../../api/city";
import type { CityContext } from "../engine/context";
import type { CityLabelInfo } from "../types";
import { isFutureDistrict } from "./districts";
import "../city3d.css";

/**
 * How a label sits on its anchor: `units` world units (at board scale 1) are `px` CSS pixels at CSS scale 1;
 * the label's bottom (align -100) or middle (-50) is `lift` units above the anchor.
 * The old board was 7 × 2.5 units (a 1024 × 368 canvas), its bottom 0.25 above the anchor; CSS draws it 196 × 70.
 * The old name tag was a pill 1.05 units high, centred on its anchor; CSS draws it 40 px high.
 */
interface Fit { units: number; px: number; lift: number; align: -100 | -50 }
const BOARD: Fit = { units: 7, px: 196, lift: .25, align: -100 }, TAG: Fit = { units: 1.05, px: 40, lift: 0, align: -50 };
/** The name's room on the board (196 − borders, paddings, icon and gap = 124 px, less a margin for font differences); long names shrink from 19 px down to 11.5 px, then end in "…". */
const NAME_ROOM = 120, NAME_MAX = 19, NAME_MIN = 11.5;
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
/** A reserved island has no server district yet. */
const FUTURE: Omit<CityLabelInfo, "id"> = { name: "Новый район", status: "Скоро откроется", icon: "🏗️", soon: true, reward: false, level: 1 };

/** The old boards' world scale: they grow with distance, so they stay readable, within 0.45…1.5. */
export const boardScale = (distance: number) => THREE.MathUtils.clamp(distance / 78, .45, 1.5);

export interface LabelsOptions {
  anchors: Map<string, THREE.Vector3>;
  /** The assistant's name tag anchor; no tag without it. */
  mascotAnchor?: THREE.Vector3;
  onSelect: (id: DistrictId) => void;
}

export interface Labels {
  setLabels(labels: CityLabelInfo[]): void;
  setSelected(id: string): void;
  setMascotName(name: string): void;
  dispose(): void;
}

interface Item {
  el: HTMLElement; anchor: THREE.Vector3; fit: Fit;
  /** Last written values, so unchanged frames touch no style. */
  transform: string; hidden: boolean; z: number; depth: number;
}

let measure: CanvasRenderingContext2D | null | undefined;
/** The old boards shrank long names until they fit; measured on a canvas, so no layout is forced. */
function nameSize(text: string) {
  if (measure === undefined) measure = document.createElement("canvas").getContext("2d");
  if (!measure) return NAME_MAX;
  let size = NAME_MAX;
  for (; size > NAME_MIN; size -= .75) { measure.font = `800 ${size}px ${FONT}`; if (measure.measureText(text).width <= NAME_ROOM) break; }
  return Math.max(NAME_MIN, size);
}

export function createLabels(ctx: CityContext, { anchors, mascotAnchor, onSelect }: LabelsOptions): Labels {
  const { overlay } = ctx, ownsClass = !overlay.classList.contains("c3-overlay");
  overlay.classList.add("c3-overlay");
  const layer = document.createElement("div");
  layer.className = "c3-labels"; layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "Районы на карте");
  overlay.append(layer);
  const colors = new Map(ctx.world.districts.map(d => [d.id, d.color]));
  const boards = new Map<string, { item: Item; icon: HTMLElement; name: HTMLElement; status: HTMLElement }>(), items: Item[] = [];
  /** Labels start hidden and appear at the first projection, so none flashes in the corner. */
  const place = (el: HTMLElement, anchor: THREE.Vector3, fit: Fit) => {
    const item: Item = { el, anchor, fit, transform: "", hidden: true, z: 0, depth: 0 };
    el.style.visibility = "hidden"; items.push(item); return item;
  };

  for (const [id, anchor] of anchors) {
    // Reserved islands are not selectable, so their board is not a button.
    const el = document.createElement(isFutureDistrict(id) ? "div" : "button");
    el.className = "c3-label"; el.dataset.district = id;
    el.style.setProperty("--c3-district", colors.get(id) ?? "#5b8def");
    if (el instanceof HTMLButtonElement) { el.type = "button"; el.setAttribute("aria-pressed", "false"); el.addEventListener("click", () => onSelect(id as DistrictId)); }
    const icon = document.createElement("span"), text = document.createElement("span"), name = document.createElement("strong"), status = document.createElement("small");
    icon.className = "c3-label__icon"; icon.setAttribute("aria-hidden", "true");
    text.className = "c3-label__text"; name.className = "c3-label__name"; status.className = "c3-label__status";
    text.append(name, status); el.append(icon, text); layer.append(el);
    const item = place(el, anchor, BOARD);
    boards.set(id, { item, icon, name, status });
  }
  let tag: { item: Item; text: HTMLElement } | null = null;
  if (mascotAnchor) {
    const el = document.createElement("div"), text = document.createElement("span");
    el.className = "c3-tag"; el.style.display = "none"; el.append(text); layer.append(el);
    tag = { item: place(el, mascotAnchor, TAG), text };
  }

  function setLabels(labels: CityLabelInfo[]) {
    boards.forEach((board, id) => {
      const info = labels.find(l => l.id === id) ?? (isFutureDistrict(id) ? { ...FUTURE, id: id as DistrictId } : null);
      const name = info?.name ?? id;
      board.icon.textContent = info?.icon ?? ""; board.name.textContent = name; board.status.textContent = info?.status ?? "";
      board.name.style.fontSize = `${nameSize(name)}px`;
      board.item.el.toggleAttribute("data-soon", !!info?.soon); board.item.el.toggleAttribute("data-reward", !!info?.reward);
    });
  }
  setLabels([]);

  let width = overlay.clientWidth, height = overlay.clientHeight;
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    const box = entries[entries.length - 1].contentRect; width = box.width; height = box.height; update();
  });
  resize?.observe(overlay);

  const view = new THREE.Vector3(), order = [...items];
  /** Projects every anchor; nearer labels stack on top, labels behind the camera or far off-screen hide. */
  function update() {
    const { camera } = ctx;
    camera.updateMatrixWorld();
    // Pixels per world unit at depth 1: the projection's focal length times half the height.
    const focal = camera.projectionMatrix.elements[5] * height / 2;
    for (const item of items) {
      view.copy(item.anchor).applyMatrix4(camera.matrixWorldInverse);
      const depth = -view.z;
      let hidden = !width || !height || depth < camera.near;
      if (!hidden) { view.applyMatrix4(camera.projectionMatrix); hidden = Math.abs(view.x) > 1.4 || Math.abs(view.y) > 1.4; }
      if (hidden !== item.hidden) { item.hidden = hidden; item.el.style.visibility = hidden ? "hidden" : ""; }
      // Hidden labels count as the farthest.
      item.depth = hidden ? Number.MAX_VALUE : depth;
      if (hidden) continue;
      const pixels = boardScale(camera.position.distanceTo(item.anchor)) * focal / depth, { units, px, lift, align } = item.fit;
      const x = (view.x + 1) * width / 2, y = (1 - view.y) * height / 2 - lift * pixels;
      const transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,${align}%) scale(${(units * pixels / px).toFixed(3)})`;
      if (transform !== item.transform) { item.transform = transform; item.el.style.transform = transform; }
    }
    order.sort((a, b) => b.depth - a.depth);
    order.forEach((item, i) => { if (item.z !== i + 1) { item.z = i + 1; item.el.style.zIndex = String(i + 1); } });
  }
  // The camera may move after the frame callbacks: project again then, so labels never trail it by a frame.
  const offFrame = ctx.onFrame(update), offCamera = ctx.onCameraMove(update);

  return {
    setLabels,
    setSelected(id) { boards.forEach((board, key) => { if (board.item.el instanceof HTMLButtonElement) board.item.el.setAttribute("aria-pressed", String(key === id)); }); },
    setMascotName(name) { if (tag) { tag.text.textContent = name; tag.item.el.style.display = name ? "" : "none"; } },
    dispose() {
      offFrame(); offCamera(); resize?.disconnect(); layer.remove();
      if (ownsClass) overlay.classList.remove("c3-overlay");
    },
  };
}
