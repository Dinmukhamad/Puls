export interface CityAnchor { id: string; x: number; y: number; depth: number }
export interface CityLabel { x: number; y: number; visible: boolean; anchorX: number; anchorY: number; moved: boolean }
export interface CityLabelBounds { top: number; bottom: number; side: number }

export const LABEL_STEM = 14;

/**
 * Each label sits right above its building. When labels collide the nearer building keeps its
 * spot and the farther label is stacked above or below — sideways only as a last resort — so a
 * label never wanders to the opposite side of the map.
 */
export function layoutCityLabels(anchors: CityAnchor[], w: number, h: number, size: { width: number; height: number }, bounds: CityLabelBounds = { top: 44, bottom: 58, side: 8 }): Record<string, CityLabel> {
  return place(anchors, w, h, size, bounds, false) ?? place(anchors, w, h, size, bounds, true)!;
}

/** With `columns` every label snaps to a fixed column, which always fits on narrow screens. */
function place(anchors: CityAnchor[], w: number, h: number, size: { width: number; height: number }, bounds: CityLabelBounds, columns: boolean) {
  const { width, height } = size, gap = 6;
  const minX = bounds.side + width / 2, maxX = Math.max(minX, w - bounds.side - width / 2);
  const minY = bounds.top + height / 2, maxY = Math.max(minY, h - bounds.bottom - height / 2);
  const count = Math.max(1, Math.floor((maxX - minX) / (width + gap)) + 1);
  const columnXs = count === 1 ? [(minX + maxX) / 2] : Array.from({ length: count }, (_, i) => minX + (maxX - minX) * i / (count - 1));
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const placed: { x: number; y: number }[] = [], result: Record<string, CityLabel> = {};
  const free = (x: number, y: number) => placed.every(p => Math.abs(p.x - x) >= width + gap || Math.abs(p.y - y) >= height + gap);
  for (const anchor of [...anchors].sort((a, b) => a.depth - b.depth)) {
    const visible = anchor.x >= 0 && anchor.x <= w && anchor.y >= 0 && anchor.y <= h;
    const baseX = clamp(anchor.x, minX, maxX), baseY = clamp(anchor.y - LABEL_STEM - height / 2, minY, maxY);
    if (!visible) { result[anchor.id] = { x: baseX, y: baseY, visible, anchorX: anchor.x, anchorY: anchor.y, moved: false }; continue; }
    let best: { x: number; y: number; cost: number } | null = null;
    const consider = (x: number, y: number) => {
      if (!free(x, y)) return;
      const cost = Math.abs(y - baseY) + 2.4 * Math.abs(x - baseX) + (y > anchor.y ? 30 : 0);
      if (!best || cost < best.cost) best = { x, y, cost };
    };
    if (columns) {
      for (const x of columnXs) for (let y = minY; y <= maxY + .01; y += height + gap) consider(x, y);
    } else {
      for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5]) for (const dx of [0, -.55, .55, -1.1, 1.1, -1.65, 1.65, -2.2, 2.2])
        consider(clamp(baseX + dx * (width + gap), minX, maxX), clamp(baseY + dy * (height + gap), minY, maxY));
      // Crowded screens: scan the whole map for the nearest free slot.
      if (!best) for (let y = minY; y <= maxY; y += (height + gap) / 2) for (let x = minX; x <= maxX; x += (width + gap) / 4) consider(x, y);
    }
    const found = best as { x: number; y: number } | null;
    if (!found && !columns) return null;
    const spot = found ?? { x: baseX, y: baseY };
    placed.push(spot);
    result[anchor.id] = { x: spot.x, y: spot.y, visible, anchorX: anchor.x, anchorY: anchor.y, moved: Math.hypot(spot.x - anchor.x, spot.y + height / 2 + LABEL_STEM - anchor.y) > 3 };
  }
  return result;
}
