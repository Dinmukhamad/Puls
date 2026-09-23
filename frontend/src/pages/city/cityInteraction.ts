/** Horizontal dragging rotates; vertical touch gestures remain page scrolling. */
export function bindCityDrag(host: HTMLElement, rotate: (radians: number) => void) {
  let pointer: number | null = null, start = 0, last = 0, dragging = false;
  function down(event: PointerEvent) {
    if (pointer !== null || !event.isPrimary || event.button !== 0) return;
    pointer = event.pointerId; start = last = event.clientX; dragging = false;
    host.setPointerCapture(pointer);
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    if (!dragging && Math.abs(event.clientX - start) < 6) return;
    dragging = true; host.dataset.dragging = "true";
    rotate(-(event.clientX - last) / Math.max(host.clientWidth, 240) * Math.PI * 2);
    last = event.clientX;
  }
  function end(event: PointerEvent) {
    if (event.pointerId !== pointer) return;
    const id = pointer; pointer = null; dragging = false;
    delete host.dataset.dragging;
    if (host.hasPointerCapture(id)) host.releasePointerCapture(id);
  }
  function key(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault(); rotate(event.key === "ArrowLeft" ? -.15 : .15);
  }
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
  host.addEventListener("lostpointercapture", end);
  host.addEventListener("keydown", key);
  return () => {
    if (pointer !== null && host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer);
    host.removeEventListener("pointerdown", down);
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerup", end);
    host.removeEventListener("pointercancel", end);
    host.removeEventListener("lostpointercapture", end);
    host.removeEventListener("keydown", key);
    delete host.dataset.dragging;
  };
}

/** Keep labels attached to their projection, avoiding collisions at every angle. */
export function placeCityPins(pins: { id: string; x: number; y: number }[], w: number, h: number) {
  const width = w < 440 ? 112 : 124, gap = 6, height = 48;
  const left = width / 2 + 8, right = w - left, top = 78, bottom = h - 64;
  const placed: { x: number; y: number }[] = [], positions: Record<string, { x: number; y: number }> = {};
  for (const pin of [...pins].sort((a, b) => a.y - b.y)) {
    const x = Math.max(left, Math.min(right, pin.x)), y = Math.max(top, Math.min(bottom, pin.y));
    const candidates = [{ x, y }];
    for (let cy = top; cy <= bottom; cy += height + gap)
      for (const cx of [x, left, (left + right) / 2, right]) candidates.push({ x: cx, y: cy });
    candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
    const position = candidates.find(p => placed.every(a => Math.abs(p.x - a.x) >= width + gap || Math.abs(p.y - a.y) >= height + gap)) ?? candidates[0];
    positions[pin.id] = position; placed.push(position);
  }
  return positions;
}
