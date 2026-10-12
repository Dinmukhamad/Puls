import type { DistrictLandState } from "../../api/cityEstate";
import { plural } from "../../utils/format";
import { districtBuildProgress } from "./districtProgress";

/** Whole-district availability; building growth is shown once in DistrictLandmarkCard. */
export function DistrictBuildProgress({ land, legend = true }: { land: DistrictLandState; legend?: boolean }) {
  const p = districtBuildProgress(land);
  return <section className="estate-section estate-progress" aria-label="Земля района">
    <div className="estate-progress__head"><h3>Весь район открыт</h3><strong>Свободно {p.available.toLocaleString("ru-RU")} {plural(p.available, "клетка", "клетки", "клеток")} · занято {p.taken.toLocaleString("ru-RU")} из {p.cells.toLocaleString("ru-RU")}</strong></div>
    <p className="secondary small">Операторы команды сами планируют район: прокладывают дороги, сажают деревья, ставят фонари и дома. Договоритесь, каким он будет — квадратным, круглым или любым другим.</p>
    {legend && <div className="estate-land-legend"><span><i data-open aria-hidden="true" />Свободно</span><span><i aria-hidden="true" />Занято</span></div>}
  </section>;
}
