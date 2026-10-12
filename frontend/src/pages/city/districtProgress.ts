import type { DistrictLandState } from "../../api/cityEstate";

/** All the land is available together; zones only determine the price of land. Cells free, taken and in all. */
export function districtBuildProgress(land: DistrictLandState) {
  const cells = Math.max(0, land.cells), taken = Math.max(0, land.taken);
  return { cells, taken, available: Math.max(0, cells - taken) };
}
