import type { DistrictLandmark } from "../../api/cityEstate";
import { plural } from "../../utils/format";

/** Complex growth uses the whole district's personal land, separate from unlocking the next build area. */
export function DistrictLandmarkCard({ landmark, compact = false }: { landmark: DistrictLandmark; compact?: boolean }) {
  if (landmark.status !== "active") return null;
  const fill = landmark.plots ? Math.min(100, Math.max(0, landmark.taken / landmark.plots * 100)) : 0;
  return <section className="estate-landmark" aria-label="Развитие комплекса района">
    <div className="estate-placing__title"><span aria-hidden="true">🏢</span><div><h2>{landmark.name}</h2><small>Комплекс района · уровень {landmark.level} из 5</small></div></div>
    <p className="secondary small">Растёт автоматически, когда команда строит на участках района.</p>
    <div className="estate-landmark__progress"><div><strong>Застроено {Math.floor(fill)} % района</strong><small>{landmark.taken.toLocaleString("ru-RU")} из {landmark.plots.toLocaleString("ru-RU")} участков</small></div>
      <div className="city-meter" role="progressbar" aria-label="Застройка района для роста комплекса" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(fill)}><span style={{ width: `${fill}%` }} /></div>
    </div>
    <p className="small">{landmark.next ? <>До «{landmark.next.name}» — {landmark.next.remaining ? <>займите ещё {landmark.next.remaining.toLocaleString("ru-RU")} {plural(landmark.next.remaining, "участок", "участка", "участков")}</> : "после следующей стройки"}.<small className="estate-landmark__next">Уровень {landmark.next.level} открывается при застройке {landmark.next.percent} % всего района.</small></> : "Комплекс достиг максимального уровня."}</p>
    {!compact && <p className="secondary small">Комплекс занимает всю площадку рядом со штабом. Достигнутый уровень сохраняется при переводах сотрудников.</p>}
  </section>;
}
