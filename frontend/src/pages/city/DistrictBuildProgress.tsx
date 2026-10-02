import type { DistrictLandState } from "../../api/cityEstate";
import { plural } from "../../utils/format";
import { districtBuildProgress } from "./districtProgress";

/** One current stage and the exact number of plots needed to unlock the next one. */
export function DistrictBuildProgress({ land, legend = true }: { land: DistrictLandState; legend?: boolean }) {
  const p = districtBuildProgress(land);
  return <section className="estate-section estate-progress" aria-label="Этапы застройки">
    <div className="estate-progress__head"><h3>{p.remaining === null ? "Весь район открыт" : `Этап застройки ${p.stage} из ${p.stages}`}</h3><strong>Свободно {p.available.toLocaleString("ru-RU")} {plural(p.available, "участок", "участка", "участков")}</strong></div>
    {p.remaining !== null && <>
      <p className="small">{p.remaining ? `До расширения — осталось занять ещё ${p.remaining.toLocaleString("ru-RU")} ${plural(p.remaining, "участок", "участка", "участков")}.` : "Новые участки откроются после следующей стройки."}</p>
      <div className="city-meter" role="progressbar" aria-label={`Застроено ${p.taken} из ${p.target} участков для следующего этапа`} aria-valuemin={0} aria-valuemax={p.target || 1} aria-valuenow={Math.min(p.taken, p.target)}><span style={{ width: `${p.target ? Math.min(100, p.taken / p.target * 100) : 100}%` }} /></div>
      <p className="secondary small">Когда команда застроит 70 % уже открытой земли, откроется новая территория.</p>
    </>}
    {legend && <div className="estate-land-legend"><span><i data-open aria-hidden="true" />Можно строить</span>{p.remaining !== null && <span><i aria-hidden="true" />Откроется позже</span>}</div>}
  </section>;
}
