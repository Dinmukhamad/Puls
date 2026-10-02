/**
 * Ready office towers for district plots: the nine bodies in the High Rise Office Buildings collection.
 * Each scene in high-rise-offices.glb is centred on x/z, grounded on y = 0 and faces +z. Dimensions are in
 * source units; the city keeps their proportions and shrinks them uniformly only when a plot is narrower.
 */
export type OfficeBuilding = "officea" | "officeb" | "officec" | "officed" | "officee" | "officef" | "officeg" | "officeh" | "officei";
export interface OfficeBuildingModel { model: number; name: string; width: number; depth: number; height: number }

export const OFFICE_SCALE = 2;
/** Towers sit slightly behind the plot's centre, leaving room for their entrance plaza. */
export const OFFICE_SETBACK = -.65;
export const OFFICE_BUILDINGS: Record<OfficeBuilding, OfficeBuildingModel> = {
  officea: { model: 1, name: "Офисная башня A", width: 2.160, depth: 2.160, height: 6.609 },
  officeb: { model: 2, name: "Офисная башня B", width: 2.160, depth: 2.160, height: 6.228 },
  officec: { model: 3, name: "Офисная башня C", width: 2.160, depth: 2.160, height: 6.513 },
  officed: { model: 4, name: "Офисная башня D", width: 2.228, depth: 2.228, height: 6.486 },
  officee: { model: 5, name: "Офисная башня E", width: 2.160, depth: 2.160, height: 6.228 },
  officef: { model: 6, name: "Офисная башня F", width: 2.160, depth: 2.160, height: 6.744 },
  officeg: { model: 7, name: "Офисная башня G", width: 2.160, depth: 2.344, height: 6.513 },
  officeh: { model: 8, name: "Офисная башня H", width: 2.245, depth: 2.757, height: 6.700 },
  officei: { model: 9, name: "Офисная башня I", width: 2.160, depth: 2.160, height: 6.471 },
};

export const isOfficeBuilding = (family: string): family is OfficeBuilding => Object.prototype.hasOwnProperty.call(OFFICE_BUILDINGS, family);
/** Placement variant is the source body's number minus one. */
export const officeVariant = (variant: number) => Math.max(0, Math.floor(variant)) % Object.keys(OFFICE_BUILDINGS).length;
export const officeModelName = (variant: number) => `office-building-${officeVariant(variant) + 1}`;
/** Half a unit behind, 1.8 units for the entrance plaza, and half a unit at either side. */
export function officeBuildingScale(family: OfficeBuilding, width: number, depth: number) {
  const model = OFFICE_BUILDINGS[family];
  return Math.min(OFFICE_SCALE, Math.max(.1, width - 1) / model.width, Math.max(.1, depth - 2.3) / model.depth);
}

type Point3 = { x: number; y: number; z: number };
type OfficePlot = { x: number; z: number; rotation: number; width: number; depth: number };
/** Actual tower bounds in its plot, shared by facade picking and camera focus. */
export function officeBuildingBounds(family: OfficeBuilding, frame: OfficePlot) {
  const model = OFFICE_BUILDINGS[family], scale = officeBuildingScale(family, frame.width, frame.depth);
  return {
    x: frame.x + Math.sin(frame.rotation) * OFFICE_SETBACK,
    z: frame.z + Math.cos(frame.rotation) * OFFICE_SETBACK,
    rotation: frame.rotation, width: model.width * scale, depth: model.depth * scale, height: model.height * scale,
  };
}
/** Distance along the ray to a tower's oriented bounds, or null if the tower is missed or behind the camera. */
export function officeBuildingRayDistance(family: OfficeBuilding, frame: OfficePlot, origin: Point3, direction: Point3): number | null {
  const bounds = officeBuildingBounds(family, frame), s = Math.sin(bounds.rotation), c = Math.cos(bounds.rotation);
  const dx = origin.x - bounds.x, dz = origin.z - bounds.z;
  const axes = [
    [dx * c - dz * s, direction.x * c - direction.z * s, -bounds.width / 2, bounds.width / 2],
    [origin.y, direction.y, .2, .2 + bounds.height],
    [dx * s + dz * c, direction.x * s + direction.z * c, -bounds.depth / 2, bounds.depth / 2],
  ];
  let near = 0, far = Infinity;
  for (const [at, along, min, max] of axes) {
    if (Math.abs(along) < 1e-10) { if (at < min || at > max) return null; continue; }
    const first = (min - at) / along, last = (max - at) / along;
    near = Math.max(near, Math.min(first, last)); far = Math.min(far, Math.max(first, last));
    if (far < near) return null;
  }
  return near;
}
