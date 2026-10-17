/**
 * Framing a photo for the avatar (docs/AVATARS.md): the photo always covers the circle, the person moves it and zooms in,
 * and the browser draws exactly that square at AVATAR_OUTPUT pixels. A phone's 48-megapixel shot leaves the device as
 * a small square, so neither the server's size limit nor its megapixel limit is ever in the way.
 */
export const AVATAR_OUTPUT = 512;
export const ZOOM_MAX = 3;
/** Larger originals are not worth decoding in a browser tab. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export interface Frame { width: number; height: number; zoom: number; x: number; y: number }

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

/** The photo's size on a stage of `side` px: its shorter side fills the stage at zoom 1. */
export function displayed(frame: Pick<Frame, "width" | "height" | "zoom">, side: number) {
  const base = side / Math.min(frame.width, frame.height);
  return { w: frame.width * base * frame.zoom, h: frame.height * base * frame.zoom };
}

/** Keeps the photo over the whole circle: it can move only as far as it is larger than the stage. */
export function clampFrame(frame: Frame, side: number): Frame {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, frame.zoom));
  const { w, h } = displayed({ ...frame, zoom }, side);
  return { ...frame, zoom, x: clamp(frame.x, (w - side) / 2), y: clamp(frame.y, (h - side) / 2) };
}

/** Where the photo is drawn on the square canvas of `out` px, so the saved square is what the stage showed. */
export function drawRect(frame: Frame, side: number, out = AVATAR_OUTPUT) {
  const { w, h } = displayed(frame, side), ratio = out / side;
  return { x: out / 2 + frame.x * ratio - (w * ratio) / 2, y: out / 2 + frame.y * ratio - (h * ratio) / 2, w: w * ratio, h: h * ratio };
}
