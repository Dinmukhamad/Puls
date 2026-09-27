/**
 * Pointer picking: a tap (not a drag) on a district selects it, and the mouse cursor turns into a hand
 * over one. Hit objects name their district in `userData.district` (on the mesh or any parent).
 */
import * as THREE from "three/webgpu";

/** A press is a tap when it moves less than this and ends within this long; otherwise it moved the camera. */
export const TAP_DISTANCE = 6, TAP_TIME = 600;

export interface PickerHandlers {
  onPick: (id: string) => void;
  onHover?: (id: string | null) => void;
}

export interface Picker {
  /** The district under a point in client coordinates, or null. */
  pickAt(clientX: number, clientY: number): string | null;
  dispose(): void;
}

export function createPicker(canvas: HTMLElement, camera: THREE.Camera, pickables: () => THREE.Object3D[], { onPick, onHover }: PickerHandlers): Picker {
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), hits: THREE.Intersection[] = [];
  raycaster.layers.enableAll();
  let down: { x: number; y: number; time: number } | null = null, pressed = 0, multi = false;
  let hovered: string | null = null, hover: { x: number; y: number } | null = null, hoverFrame = 0;

  function pickAt(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    hits.length = 0;
    raycaster.intersectObjects(pickables(), true, hits);
    for (const hit of hits) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (typeof o.userData.district === "string") return o.userData.district;
    }
    return null;
  }
  function setHovered(id: string | null) {
    if (id === hovered) return;
    hovered = id; canvas.style.cursor = id ? "pointer" : "";
    onHover?.(id);
  }

  const onDown = (event: PointerEvent) => {
    // A second finger turns the gesture into a pinch, which never selects. The primary pointer starts a
    // fresh gesture, so a release missed outside the canvas cannot leave the count stuck.
    if (event.isPrimary) { pressed = 1; multi = false; down = { x: event.clientX, y: event.clientY, time: performance.now() }; }
    else { pressed++; multi = true; }
  };
  const onUp = (event: PointerEvent) => {
    pressed = Math.max(0, pressed - 1);
    if (down && !multi && pressed === 0 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_DISTANCE && performance.now() - down.time < TAP_TIME) {
      const id = pickAt(event.clientX, event.clientY);
      if (id) onPick(id);
    }
    if (pressed === 0) down = null;
  };
  const onCancel = () => { pressed = Math.max(0, pressed - 1); if (pressed === 0) down = null; };
  // Hover is picked at most once a frame: pointermove can fire far more often than the screen refreshes.
  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.buttons) return;
    hover = { x: event.clientX, y: event.clientY };
    if (!hoverFrame) hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (hover) setHovered(pickAt(hover.x, hover.y)); });
  };
  const onLeave = () => { hover = null; setHovered(null); };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  return {
    pickAt,
    dispose() {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.style.cursor = "";
    },
  };
}
