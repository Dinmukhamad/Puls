import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { citySeasons, SEASONS_QUERY } from "../../api/citySeasons";
import { cityWorld, type PlannedDistrict, type WorldCity, type WorldEditorData } from "../../api/cityWorld";
import { Badge, Button, Select } from "../../components/ui";
import { districtColour, LAYOUT_COUNTS } from "../../city3d/world/estateGrid";
import { plural } from "../../utils/format";
import { FormStatus } from "./CityAdminControls";
import type { LayoutPreview } from "./layoutPreview";

const districts = (n: number) => `${n} ${plural(n, "район", "района", "районов")}`;
const cityName = (id: string) => id === "support" ? "техподдержки" : "отдела продаж";

/** The plan as the form starts it: the saved one, or today's districts. */
function startPlan(city: WorldCity): PlannedDistrict[] {
  return city.plan?.districts ?? city.districts.map(d => ({ name: d.name, supervisor_id: d.supervisor_id ?? null }));
}

/** Resizes a plan, keeping what is set for the districts that stay. */
function resize(plan: PlannedDistrict[], count: number): PlannedDistrict[] {
  return Array.from({ length: count }, (_, i) => plan[i] ?? { name: `Район ${i + 1}`, supervisor_id: null });
}

/**
 * How many districts a city has from the next season. The land is cut anew at the season's reset: each district gets
 * an equal share and starts with its main building, the past city stays in the history in its own layout.
 */
export function CityLayoutPlanner({ city, data, editable }: { city: WorldCity; data: WorldEditorData; editable: boolean }) {
  const client = useQueryClient();
  const seasons = useQuery({ queryKey: SEASONS_QUERY, queryFn: ({ signal }) => citySeasons.overview(signal) });
  const current = city.districts.length, planned = city.plan?.count ?? null;
  const [count, setCount] = useState(planned ?? current);
  const [plan, setPlan] = useState(() => startPlan(city));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<LayoutPreview | null>(null), [showPreview, setShowPreview] = useState(false);
  useEffect(() => { if (!dirty) { setCount(planned ?? current); setPlan(startPlan(city)); } }, [city, dirty, planned, current]);
  useEffect(() => {
    if (!showPreview) return;
    let live = true;
    setPreview(null);
    void import("./layoutPreview").then(m => { if (live) setPreview(m.layoutPreview(city.id, count)); });
    return () => { live = false; };
  }, [showPreview, city.id, count]);

  const save = useMutation({
    mutationFn: (body: { count: number | null; districts: PlannedDistrict[] }) => cityWorld.layout({ revision: data.revision, city: city.id, ...body }),
    onSuccess: next => { setDirty(false); client.setQueryData(["city-world-settings"], next); void client.invalidateQueries({ queryKey: ["city-sandbox"] }); },
    onError: error => { if (error instanceof ApiError && (error.status === 409 || error.status === 403)) void client.invalidateQueries({ queryKey: ["city-world-settings"] }); },
  });
  function change(update: () => void) { if (!editable || save.isPending) return; save.reset(); setDirty(true); update(); }

  // Supervisors the other city will have after the reset: they cannot lead a district here.
  const other = data.cities.find(c => c.id !== city.id);
  const elsewhere = new Set((other?.plan?.districts ?? other?.districts ?? []).map(d => d.supervisor_id).filter((id): id is number => id != null));
  const chosen = plan.map(d => d.supervisor_id).filter((id): id is number => id != null);
  const leaders = city.districts.map(d => d.supervisor_id).filter((id): id is number => id != null);
  const left = leaders.filter(id => !chosen.includes(id)).map(id => data.supervisors.find(s => s.id === id)?.name ?? "Супервайзер недоступен");
  const free = plan.filter(d => d.supervisor_id === null).length;
  const ends = seasons.data?.current.ends_at;
  const when = ends ? `при сбросе ${new Date(ends).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : "при сбросе сезона";
  const status = planned
    ? `Сейчас ${districts(current)}, со следующего сезона будет ${districts(planned)}. Изменится ${when}.`
    : `Сейчас ${districts(current)}. Новое число районов вступит в силу ${when}.`;
  const unchanged = count === current && plan.every((d, i) => d.name === city.districts[i]?.name && d.supervisor_id === (city.districts[i]?.supervisor_id ?? null));

  return <section className="city-layout-planner" aria-labelledby={`layout-${city.id}`}>
    <div className="city-layout-planner__head">
      <h3 id={`layout-${city.id}`}>Районов со следующего сезона</h3>
      {planned && <Badge tone="warning">Запланировано: {districts(planned)}</Badge>}
    </div>
    <p className="city-layout-planner__status" role="status">{status}</p>
    <p className="field__note">Город нарезается заново на равные районы. Постройки сезона уходят в историю, как при обычном сбросе; в каждом районе снова главное здание первого уровня. «Сбросить город сейчас» во вкладке «Сезоны» применит план сразу.</p>
    <fieldset className="city-layout-planner__controls" disabled={!editable || save.isPending}>
      <legend className="sr-only">Число районов города {cityName(city.id)}</legend>
      <label className="field city-layout-planner__count"><span className="field__label">Число районов</span>
        <Select aria-label="Число районов со следующего сезона" value={count} options={LAYOUT_COUNTS.map(n => ({ value: n, label: `${districts(n)}${n === current ? " · как сейчас" : ""}` }))}
          onChange={value => change(() => { const n = Number(value); setCount(n); setPlan(p => resize(p, n)); })} /></label>
      <ol className="city-layout-planner__districts">{plan.map((district, index) => {
        const options = [
          { value: "", label: "Свободный район" },
          ...data.supervisors.map(person => {
            const taken = elsewhere.has(person.id) ? `ведёт район в городе ${cityName(other?.id ?? "")}` : plan.some((d, i) => i !== index && d.supervisor_id === person.id) ? "уже в другом районе" : "";
            return { value: person.id, label: `${person.name}${taken ? ` · ${taken}` : ""}`, disabled: !!taken };
          }),
        ];
        return <li key={index} className="city-layout-planner__district" style={{ "--district": districtColour(index + 1) } as CSSProperties}>
          <span className="city-layout-planner__number" aria-hidden="true">{index + 1}</span>
          <label className="field"><span className="field__label">Название района {index + 1}</span>
            <input className="input" value={district.name} maxLength={40} onChange={event => change(() => setPlan(p => p.map((d, i) => i === index ? { ...d, name: event.target.value } : d)))} /></label>
          <label className="field"><span className="field__label">Супервайзер</span>
            <Select aria-label={`Супервайзер района ${index + 1}`} value={district.supervisor_id ?? ""} options={options}
              onChange={value => change(() => setPlan(p => p.map((d, i) => i === index ? { ...d, supervisor_id: value ? Number(value) : null } : d)))} /></label>
        </li>;
      })}</ol>
    </fieldset>
    {(dirty || planned) && free > 0 && <p className="ui-note">{free === 1 ? "Один район останется свободным" : `${free} ${plural(free, "район останется", "района останутся", "районов останутся")} свободными`}: стройка в {free === 1 ? "нём" : "них"} закрыта, пока не назначен супервайзер.</p>}
    {(dirty || planned) && left.length > 0 && <p className="ui-note city-admin-alert" role="alert">Команде {left.join(", ")} не хватит района: её операторы увидят «Как открыть стройку», пока супервайзер не получит район.</p>}
    <div className="city-layout-planner__actions">
      <Button size="s" aria-expanded={showPreview} onClick={() => setShowPreview(on => !on)}>{showPreview ? "Скрыть раскладку" : "Показать раскладку"}</Button>
      {editable && planned && <Button size="s" disabled={save.isPending} onClick={() => save.mutate({ count: null, districts: [] })}>Отменить план</Button>}
      {editable && <Button size="s" variant="primary" disabled={!dirty || save.isPending || (unchanged && !planned) || plan.some(d => d.name.trim().length < 2)}
        onClick={() => save.mutate({ count, districts: plan.map(d => ({ ...d, name: d.name.trim() })) })}>{save.isPending ? "Сохраняем…" : "Запланировать"}</Button>}
    </div>
    <FormStatus error={save.isError && save.error} saved={save.isSuccess && (planned ? "План сохранён." : "План отменён.")} />
    {showPreview && <figure className="city-layout-planner__preview">
      {preview ? <PreviewMap preview={preview} count={count} /> : <p className="field__note">Рисуем раскладку…</p>}
      <figcaption className="field__note">Вид сверху: цвет — район, кружок — его центр с главным зданием.</figcaption>
    </figure>}
  </section>;
}

/** The future city from above: each cell in its district's colour, each centre numbered. */
function PreviewMap({ preview, count }: { preview: LayoutPreview; count: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const { box, cell } = preview, size = 840, scale = size / Math.max(box.w, box.h);
    el.width = Math.round(box.w * scale); el.height = Math.round(box.h * scale);
    const at = (x: number, z: number) => [(x - box.x) * scale, (z - box.z) * scale] as const, side = Math.max(1, cell * scale);
    for (const c of preview.cells) { const [x, y] = at(c.x, c.z); ctx.fillStyle = districtColour(c.district); ctx.fillRect(x - side / 2, y - side / 2, side, side); }
    ctx.font = "700 26px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const c of preview.centres) {
      const [x, y] = at(c.x, c.z);
      ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.fillStyle = districtColour(c.district); ctx.fillText(String(c.district), x, y + 1);
    }
  }, [preview]);
  return <canvas ref={canvas} role="img" aria-label={`Раскладка: ${districts(count)}`} />;
}
