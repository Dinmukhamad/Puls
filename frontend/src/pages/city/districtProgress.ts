import type { DistrictLandState } from "../../api/cityEstate";

/** The server opens new land when 70% of all currently open plots are taken, including earlier stages. */
export function districtBuildProgress(land: DistrictLandState) {
  const stages = Math.max(1, land.bands.length), stage = Math.min(Math.max(1, land.open_band), stages);
  const open = land.bands.filter(band => band.band <= stage);
  const plots = open.reduce((sum, band) => sum + band.plots, 0);
  const taken = open.reduce((sum, band) => sum + band.taken, 0);
  const target = Math.ceil(plots * .7);
  return { stage, stages, plots, taken, available: Math.max(0, plots - taken), target,
    remaining: stage < stages ? Math.max(0, target - taken) : null };
}
