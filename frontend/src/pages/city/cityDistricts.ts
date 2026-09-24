import type { CityDistrict, CityMission, DistrictId } from "../../api/city";
import { districtLevel } from "./cityLevels";
import type { CityLabelInfo } from "./cityScene";

export const DISTRICT_ICONS: Record<DistrictId, string> = { academy: "🎓", driver: "🚕", crm: "💬", dispatch: "📡", oktell: "🎧" };
export const DISTRICT_COLORS: Record<DistrictId, string> = { academy: "#5b8def", driver: "#f0a23a", crm: "#7b5cff", dispatch: "#35b6a6", oktell: "#e86aa6" };

/** Подписи районов: одни и те же для щитов на карте и для панели навыков. */
export function districtLabels(districts: CityDistrict[], missions: CityMission[]): CityLabelInfo[] {
  return districts.map(d => {
    const own = missions.filter(m => m.district === d.id && m.enabled), done = missions.filter(m => m.district === d.id && m.state === "completed").length;
    const reward = own.some(m => m.state === "ready");
    return { id: d.id, name: d.name, icon: DISTRICT_ICONS[d.id], soon: d.soon, reward, level: districtLevel(done, d.soon), status: d.soon ? "Скоро откроется" : done && done >= own.length ? "✓ Район освоен" : reward ? "✦ Забрать награду" : `${done} из ${Math.max(own.length, done)} миссий` };
  });
}
