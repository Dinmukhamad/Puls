import type { DistrictLandState } from "../../api/cityEstate";

/** All personal land is available together; zones only determine the price of a plot. */
export function districtBuildProgress(land: DistrictLandState) {
  const plots = Math.max(0, land.plots), taken = Math.max(0, land.taken);
  return { plots, taken, available: Math.max(0, plots - taken) };
}
