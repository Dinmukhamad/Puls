import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { cityWorld, type DepartmentId, type WorldEditorData, type WorldSaveSettings } from "../../api/cityWorld";
import { ErrorState, Skeleton } from "../../components/ui";
import { districtNumber, preparedLand } from "../../city3d/world/estateGrid";
import { canEditWorldCity, changeWorldCity, hasRevokedWorldChanges, refreshWorldDraft, supervisorAssignment, WORLD_QUERY_KEYS, worldDraftState } from "./worldEditor";

export function CityWorldEditor({ isHead = false }: { isHead?: boolean }) {
  const query = useQuery({ queryKey: ["city-world-settings"], queryFn: cityWorld.settings, refetchInterval: 30000 });
  // A failed background refresh must not unmount the editor and discard unfinished changes.
  if (query.data) return <>{query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}<WorldSettingsEditor data={query.data} isHead={isHead} /></>;
  return query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <Skeleton height={300} />;
}

export function WorldSettingsEditor({ data, isHead = false }: { data: WorldEditorData; isHead?: boolean }) {
  const client = useQueryClient();
  const [state, setState] = useState(() => worldDraftState(data));
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  useEffect(() => { setState(current => refreshWorldDraft(current, data)); }, [data, state.dirty]);

  async function acceptSettings(next: WorldEditorData) {
    await client.cancelQueries({ queryKey: ["city-world-settings"] });
    setState(worldDraftState(next));
    client.setQueryData(["city-world-settings"], next);
  }
  const mutation = useMutation({
    mutationFn: async (draft: WorldSaveSettings) => {
      await client.cancelQueries({ queryKey: ["city-world-settings"] });
      return cityWorld.save(draft);
    },
    onSuccess: async next => {
      await acceptSettings(next); setSaved(true);
      void Promise.all(WORLD_QUERY_KEYS.map(key => client.invalidateQueries({ queryKey: [key] })));
    },
    onError: error => { if (error instanceof ApiError && error.status === 403) void client.invalidateQueries({ queryKey: ["city-world-settings"] }); },
    onSettled: () => { pending.current = false; },
  });
  const reload = useMutation({
    mutationFn: async () => {
      await client.cancelQueries({ queryKey: ["city-world-settings"] });
      return cityWorld.settings();
    },
    onSuccess: async next => { await acceptSettings(next); setSaved(false); mutation.reset(); },
    onSettled: () => { pending.current = false; },
  });
  const busy = mutation.isPending || reload.isPending;
  const conflict = mutation.error instanceof ApiError && mutation.error.status === 409;
  const denied = mutation.error instanceof ApiError && mutation.error.status === 403;
  const revoked = hasRevokedWorldChanges(state, data);
  const outdated = state.dirty && state.draft.revision !== data.revision;
  const canSubmit = data.can_edit && state.dirty && !revoked && !outdated && !conflict && !denied && !busy;

  function edit(cityId: DepartmentId, update: (city: WorldSaveSettings["cities"][number]) => void, owner = false) {
    if (busy || pending.current || (owner ? !data.can_manage_heads : !canEditWorldCity(data, cityId))) return;
    setSaved(false);
    if (!conflict && !denied) mutation.reset();
    setState(current => changeWorldCity(current, cityId, update));
  }
  return <form className="city-admin-edit city-world-editor" onSubmit={event => {
    event.preventDefault();
    if (!canSubmit || pending.current) return;
    pending.current = true; setSaved(false); mutation.mutate(state.draft);
  }}>
    <p className="city-admin-warning">Администратор назначает руководителя каждого города. Руководитель меняет названия и назначает супервайзеров в районах своего города. Все активные группы супервайзера входят в его район автоматически, а операторы строят в этом районе, когда стройка открыта. Один супервайзер может занимать только один район в двух городах.</p>
    <p className="city-admin-warning">Для обмена районами сначала выберите «Не назначен» у обоих супервайзеров, затем назначьте их заново и сохраните. При переводе личные постройки операторов переходят в инвентарь без потери уровня; общие постройки остаются в районе.</p>
    {isHead && !data.editable_city_ids.length && <p className="city-world-editor__notice" role="status">За вами ещё не закреплён город. Администратор должен назначить вас руководителем города, чтобы вы могли управлять его районами.</p>}
    {state.draft.cities.map(city => {
      const editable = canEditWorldCity(data, city.id);
      const head = data.heads.find(person => person.id === city.head_id);
      return <section key={city.id} className="city-group-card city-world-editor__city" aria-labelledby={`world-city-${city.id}`}>
        <header><h2 id={`world-city-${city.id}`}>{city.id === "support" ? "Город техподдержки" : "Город отдела продаж"}</h2><span>{editable ? "Доступно управление" : "Только просмотр"}</span></header>
        {data.can_manage_heads ? <label className="field"><span className="field__label">Руководитель города</span><select className="input" value={city.head_id ?? ""} disabled={busy} onChange={event => edit(city.id, item => { item.head_id = event.target.value ? Number(event.target.value) : null; }, true)}>
          <option value="">Не назначен</option>
          {city.head_id !== null && !head && <option value={city.head_id} disabled>Руководитель недоступен · назначьте другого</option>}
          {data.heads.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select><small className="secondary">Назначать и менять руководителя может только администратор.</small></label>
          : <p className="city-world-editor__owner">Руководитель: <strong>{head?.name ?? (city.head_id === null ? "не назначен" : "недоступен")}</strong>{city.head_id === null && <span> · город должен закрепить администратор</span>}</p>}
        <fieldset className="city-world-editor__controls" disabled={!editable || busy}>
          <legend className="sr-only">Настройки: {city.id === "support" ? "техподдержка" : "отдел продаж"}</legend>
          <label className="field"><span className="field__label">Название города</span><input className="input" value={city.name} required minLength={2} maxLength={40} onChange={event => edit(city.id, item => { item.name = event.target.value; })} /></label>
          <div className="city-world-editor__districts">{city.districts.map((district, index) => {
            const supervisor = data.supervisors.find(person => person.id === district.supervisor_id);
            const prepared = preparedLand(districtNumber(district.id));
            return <section key={district.id} className="city-world-editor__district" aria-labelledby={`world-district-${district.id}`}>
              <h3 id={`world-district-${district.id}`}>Район {index + 1}</h3>
              <label className="field"><span className="field__label">Название района</span><input className="input" value={district.name} required minLength={2} maxLength={40} onChange={event => edit(city.id, item => { item.districts[index].name = event.target.value; })} /></label>
              <label className="field"><span className="field__label">Супервайзер района</span><select className="input" value={district.supervisor_id ?? ""} aria-describedby={`world-team-${district.id}`} onChange={event => edit(city.id, item => { item.districts[index].supervisor_id = event.target.value ? Number(event.target.value) : null; })}>
                <option value="">Не назначен</option>
                {district.supervisor_id != null && !supervisor && <option value={district.supervisor_id} disabled>Супервайзер недоступен · назначьте другого</option>}
                {data.supervisors.map(person => {
                  const occupied = supervisorAssignment(state.draft, person.id, district.id, data);
                  return <option key={person.id} value={person.id} disabled={!!occupied}>{person.name}{occupied ? ` · уже назначен: ${occupied}` : ""}</option>;
                })}
              </select></label>
              <div id={`world-team-${district.id}`} className="city-world-editor__team">
                {supervisor ? <><p>Операторов: <strong>{supervisor.operator_count}</strong> · групп: <strong>{supervisor.group_ids.length}</strong></p><p>{supervisor.group_names.length ? `Все группы района: ${supervisor.group_names.join(", ")}` : "Групп пока нет. Когда команда появится, её группы войдут в этот район автоматически."}</p></>
                  : district.supervisor_id === undefined ? <><p>В районе сохранено прежнее назначение групп. Выберите одного супервайзера, чтобы объединить его команду, или снимите прежнее назначение.</p><button type="button" className="city-secondary" onClick={() => edit(city.id, item => { item.districts[index].supervisor_id = null; })}>Снять прежнее назначение</button></>
                    : <p>{district.supervisor_id === null ? "Район свободен. Назначьте супервайзера, чтобы закрепить его команду." : "Этот супервайзер больше недоступен. Снимите назначение или выберите другого."}</p>}
              </div>
              <label className="row city-world-editor__construction"><input type="checkbox" checked={district.construction} disabled={!prepared} onChange={event => edit(city.id, item => { item.districts[index].construction = event.target.checked; })} /><span>Стройка открыта{prepared ? "" : " · у этого района нет подготовленной земли"}</span></label>
            </section>;
          })}</div>
        </fieldset>
      </section>;
    })}
    {(revoked || denied) && <p className="city-world-editor__notice" role="alert">Права управления изменились. Черновик сохранён на экране, но отправить его нельзя. Загрузите текущие настройки города.</p>}
    {(conflict || outdated) && <p className="city-world-editor__notice" role="alert">Настройки города уже изменены. Черновик сохранён на экране. Загрузите сохранённые настройки заново перед следующим изменением.</p>}
    <div className="city-world-editor__actions">
      {data.can_edit && <button type="submit" className="city-action" disabled={!canSubmit}>{mutation.isPending ? "Сохраняем…" : "Сохранить города и районы"}</button>}
      <button type="button" className="city-secondary" disabled={busy} onClick={() => { if (pending.current || busy) return; pending.current = true; reload.mutate(); }}>{reload.isPending ? "Загружаем…" : state.dirty ? "Загрузить сохранённые настройки (сбросить черновик)" : "Обновить настройки"}</button>
    </div>
    {!data.can_edit && !isHead && <p className="secondary">Управлять районами могут руководитель закреплённого города и администратор.</p>}
    {saved && <p role="status">Города и районы сохранены.</p>}
    {mutation.isError && !conflict && !denied && <ErrorState error={mutation.error} />}
    {reload.isError && <ErrorState error={reload.error} />}
  </form>;
}
