import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cityWorld, type WorldEditorData, type WorldSettings } from "../../api/cityWorld";
import { ErrorState, Skeleton } from "../../components/ui";
import { preparedLand } from "../../city3d/world/estateGrid";

/** Districts with land prepared for building (the first six of each city). */
const prepared = (id: string) => preparedLand(Number(id.split("-").at(-1)));

export function CityWorldEditor() {
  const query = useQuery({ queryKey: ["city-world-settings"], queryFn: cityWorld.settings });
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return query.data ? <Editor initial={query.data} /> : <Skeleton height={300} />;
}
function Editor({ initial }: { initial: WorldEditorData }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<WorldSettings>(() => ({ revision: initial.revision, cities: structuredClone(initial.cities) }));
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({ mutationFn: cityWorld.save, onSuccess: data => {
    setDraft(data); setSaved(true); void client.invalidateQueries({ queryKey: ["city-world"] });
    client.setQueryData(["city-world-settings"], { ...initial, ...data });
  } });
  const reload = useMutation({ mutationFn: cityWorld.settings, onSuccess: data => {
    setDraft({ revision: data.revision, cities: structuredClone(data.cities) });
    client.setQueryData(["city-world-settings"], data); setSaved(false); mutation.reset();
  } });
  function edit(cityIndex: number, update: (c: WorldSettings["cities"][number]) => void) {
    setSaved(false); setDraft(old => { const next = structuredClone(old); update(next.cities[cityIndex]); return next; });
  }
  return <form className="city-admin-edit" onSubmit={e => { e.preventDefault(); if (initial.can_edit) mutation.mutate(draft); }}>
    <p className="city-admin-warning">Названия сохраняются для всех участников. Свяжите районы с реальными группами: группы одного супервайзера в одном городе относятся к одному району. Пустой район остаётся резервом. Флажок «Стройка открыта» включает покупки за коины и общие проекты района — сначала для пилотной команды. Если группа переходит в другой район, личные постройки её операторов уходят в их инвентарь без потери уровня; общие остаются в районе.</p>
    <fieldset disabled={!initial.can_edit || mutation.isPending} style={{ border: 0, padding: 0 }}>
      {draft.cities.map((c, ci) => <section key={c.id} className="city-group-card">
        <label className="field"><span className="field__label">Название города · {c.id === "support" ? "техподдержка" : "отдел продаж"}</span><input className="input" value={c.name} required minLength={2} maxLength={40} onChange={e => edit(ci, d => { d.name = e.target.value; })} /></label>
        {c.districts.map((d, di) => <div className="city-editor-fields" key={d.id} style={{ marginTop: 20 }}>
          <label className="field"><span className="field__label">Название района {di + 1}</span><input className="input" value={d.name} required minLength={2} maxLength={40} onChange={e => edit(ci, x => { x.districts[di].name = e.target.value; })} /></label>
          <label className="row"><input type="checkbox" checked={!!d.construction} disabled={!prepared(d.id)} onChange={e => edit(ci, x => { x.districts[di].construction = e.target.checked; })} />Стройка открыта (пилот){prepared(d.id) ? "" : " · территория ещё не подготовлена"}</label>
          <fieldset style={{ border: 0, padding: 0 }}><legend>Группы района</legend>{!initial.groups.length && <p>Сначала создайте группы и назначьте супервайзеров.</p>}{initial.groups.map(g => {
            const occupied = draft.cities.some(city => city.districts.some(area => area.id !== d.id && area.group_ids.includes(g.id)));
            return <label className="row" key={g.id}><input type="checkbox" checked={d.group_ids.includes(g.id)} disabled={occupied || !g.supervisor_id} onChange={e => edit(ci, x => { x.districts[di].group_ids = e.target.checked ? [...d.group_ids, g.id] : d.group_ids.filter(id => id !== g.id); })} />{g.name} · {g.supervisor_name ?? "не назначен супервайзер"}{occupied ? " · уже назначена" : ""}</label>;
          })}</fieldset>
        </div>)}
        {c.districts.length < 12 && <button type="button" className="city-secondary" onClick={() => edit(ci, x => {
          const n = Math.max(...x.districts.map(d => Number(d.id.split("-").at(-1)))) + 1;
          x.districts.push({ id: `${x.id}-team-${n}`, name: `Район ${n}`, group_ids: [], construction: false });
        })}>Добавить район</button>}
      </section>)}
      {initial.can_edit && <button className="city-action" disabled={mutation.isPending}>{mutation.isPending ? "Сохраняем…" : "Сохранить города и районы"}</button>}
    </fieldset>
    {!initial.can_edit && <p className="secondary">Изменять карту могут руководитель и администратор.</p>}
    {saved && <p role="status">Названия и районы сохранены.</p>}
    {mutation.isError && <><ErrorState error={mutation.error} /><button type="button" className="city-secondary" disabled={reload.isPending} onClick={() => reload.mutate()}>Загрузить сохранённые настройки заново</button></>}
    {reload.isError && <ErrorState error={reload.error} />}
  </form>;
}
