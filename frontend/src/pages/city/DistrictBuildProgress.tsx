import type { DistrictLandState } from "../../api/cityEstate";
import { plural } from "../../utils/format";
import { districtBuildProgress } from "./districtProgress";

/** Whole-district availability; building growth is shown once in DistrictLandmarkCard. */
export function DistrictBuildProgress({ land, legend = true }: { land: DistrictLandState; legend?: boolean }) {
  const p = districtBuildProgress(land);
  return <section className="estate-section estate-progress" aria-label="Участки района">
    <div className="estate-progress__head"><h3>Весь район открыт</h3><strong>Свободно {p.available.toLocaleString("ru-RU")} {plural(p.available, "участок", "участка", "участков")} · занято {p.taken.toLocaleString("ru-RU")} из {p.plots.toLocaleString("ru-RU")}</strong></div>
    <p className="secondary small">Все операторы команды могут выбрать любой свободный участок своего района. Договоритесь, где будут дома, офисы и парки.</p>
    {legend && <div className="estate-land-legend"><span><i data-open aria-hidden="true" />Свободно</span><span><i aria-hidden="true" />Занято</span></div>}
  </section>;
}
