import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { cityWorld, type DepartmentId, type WorldEditorData, type WorldSaveSettings } from "../../api/cityWorld";
import { Badge, Button, ErrorState, Select, Skeleton } from "../../components/ui";
import { preparedLand } from "../../city3d/world/estateGrid";
import { plural } from "../../utils/format";
import { FormFooter, FormStatus, Switch } from "./CityAdminControls";
import { CityLayoutPlanner } from "./CityLayoutPlanner";
import { districtColumns } from "./districtColumns";
import { canEditWorldCity, changeWorldCity, hasRevokedWorldChanges, refreshWorldDraft, supervisorAssignment, WORLD_QUERY_KEYS, worldDraftState } from "./worldEditor";

/** The city as saved: the plan of its districts lives there, apart from the draft. */
const savedCity = (data: WorldEditorData, id: DepartmentId) => data.cities.find(city => city.id === id);


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
  function reloadSettings() {
    if (pending.current || busy) return;
    pending.current = true; reload.mutate();
  }
  return <form className="stack city-world-editor" onSubmit={event => {
    event.preventDefault();
    if (!canSubmit || pending.current) return;
    pending.current = true; setSaved(false); mutation.mutate(state.draft);
  }}>
    <div className="ui-note city-admin-note">
      <p>Администратор назначает руководителя каждого города. Руководитель меняет названия и назначает супервайзеров в районах своего города. Все активные группы супервайзера входят в его район автоматически, а операторы строят в этом районе, когда стройка открыта. Один супервайзер может занимать только один район в двух городах.</p>
      <p>Для обмена районами сначала выберите «Не назначен» у обоих супервайзеров, затем назначьте их заново и сохраните. При переводе личные постройки операторов переходят в инвентарь без потери уровня; общие постройки остаются в районе.</p>
    </div>
    {isHead && !data.editable_city_ids.length && <p className="ui-note city-admin-alert" role="status">За вами ещё не закреплён город. Администратор должен назначить вас руководителем города, чтобы вы могли управлять его районами.</p>}
    {state.draft.cities.map(city => {
      const editable = canEditWorldCity(data, city.id);
      const head = data.heads.find(person => person.id === city.head_id);
      const staffed = city.districts.filter(district => district.supervisor_id != null).length;
      const headOptions = [
        { value: "", label: "Не назначен" },
        ...(city.head_id !== null && !head ? [{ value: city.head_id, label: "Руководитель недоступен · назначьте другого", disabled: true }] : []),
        ...data.heads.map(person => ({ value: person.id, label: person.name })),
      ];
      return <section key={city.id} className="card card--standard city-world-editor__city" aria-labelledby={`world-city-${city.id}`}>
        <header className="card__head">
          <div className="card__titles"><h2 className="card__title" id={`world-city-${city.id}`}>{city.id === "support" ? "Город техподдержки" : "Город отдела продаж"}</h2><p className="card__subtitle">{city.districts.length} {plural(city.districts.length, "район", "района", "районов")} · с супервайзером: {staffed}</p></div>
          <div className="card__action"><Badge tone={editable ? "success" : "neutral"}>{editable ? "Доступно управление" : "Только просмотр"}</Badge></div>
        </header>
        <div className="card__body">
          <fieldset className="city-world-editor__controls" disabled={!editable || busy}>
            <legend className="sr-only">Настройки: {city.id === "support" ? "техподдержка" : "отдел продаж"}</legend>
            <div className="city-world-editor__basics">
              <label className="field"><span className="field__label">Название города</span><input className="input" value={city.name} required minLength={2} maxLength={40} onChange={event => edit(city.id, item => { item.name = event.target.value; })} /></label>
              {data.can_manage_heads ? <label className="field"><span className="field__label">Руководитель города</span><Select aria-label="Руководитель города" value={city.head_id ?? ""} options={headOptions} onChange={value => edit(city.id, item => { item.head_id = value ? Number(value) : null; }, true)} /><span className="field__note">Назначать и менять руководителя может только администратор.</span></label>
                : <div className="field"><span className="field__label">Руководитель</span><span className="city-world-editor__owner">{head?.name ?? (city.head_id === null ? "Не назначен" : "Недоступен")}</span>{city.head_id === null && <span className="field__note">Город должен закрепить администратор.</span>}</div>}
            </div>
            <div className="city-world-editor__districts" style={{ "--districts": districtColumns(city.districts.length) } as CSSProperties}>{city.districts.map((district, index) => {
              const supervisor = data.supervisors.find(person => person.id === district.supervisor_id);
              const prepared = preparedLand(district.id);
              const supervisorOptions = [
                { value: "", label: "Не назначен" },
                ...(district.supervisor_id != null && !supervisor ? [{ value: district.supervisor_id, label: "Супервайзер недоступен · назначьте другого", disabled: true }] : []),
                ...data.supervisors.map(person => {
                  const occupied = supervisorAssignment(state.draft, person.id, district.id, data);
                  return { value: person.id, label: `${person.name}${occupied ? ` · уже назначен: ${occupied}` : ""}`, disabled: !!occupied };
                }),
              ];
              return <section key={district.id} className="city-world-editor__district" aria-labelledby={`world-district-${district.id}`}>
                <div className="city-world-editor__district-head"><h3 id={`world-district-${district.id}`}>Район {index + 1}</h3>{district.supervisor_id === null && <Badge>Свободен</Badge>}</div>
                <label className="field"><span className="field__label">Название района</span><input className="input" value={district.name} required minLength={2} maxLength={40} onChange={event => edit(city.id, item => { item.districts[index].name = event.target.value; })} /></label>
                <label className="field"><span className="field__label">Супервайзер района</span><Select aria-label="Супервайзер района" aria-describedby={`world-team-${district.id}`} value={district.supervisor_id ?? ""} options={supervisorOptions} onChange={value => edit(city.id, item => { item.districts[index].supervisor_id = value ? Number(value) : null; })} /></label>
                <div id={`world-team-${district.id}`} className="city-world-editor__team">
                  {supervisor ? <><p>Операторов: <strong>{supervisor.operator_count}</strong> · групп: <strong>{supervisor.group_ids.length}</strong></p><p>{supervisor.group_names.length ? `Все группы района: ${supervisor.group_names.join(", ")}` : "Групп пока нет. Когда команда появится, её группы войдут в этот район автоматически."}</p></>
                    : district.supervisor_id === undefined ? <><p>В районе сохранено прежнее назначение групп. Выберите одного супервайзера, чтобы объединить его команду, или снимите прежнее назначение.</p><Button size="s" onClick={() => edit(city.id, item => { item.districts[index].supervisor_id = null; })}>Снять прежнее назначение</Button></>
                      : <p>{district.supervisor_id === null ? "Район свободен. Назначьте супервайзера, чтобы закрепить его команду." : "Этот супервайзер больше недоступен. Снимите назначение или выберите другого."}</p>}
                </div>
                <Switch checked={district.construction} disabled={!prepared} onChange={checked => edit(city.id, item => { item.districts[index].construction = checked; })} hint={prepared ? undefined : "Стройку не открыть: у этого района нет подготовленной земли"}>Стройка открыта</Switch>
              </section>;
            })}</div>
          </fieldset>
          {savedCity(data, city.id) && <CityLayoutPlanner city={savedCity(data, city.id)!} data={data} editable={editable} />}
        </div>
      </section>;
    })}
    {(revoked || denied) && <p className="ui-note city-admin-alert" role="alert">Права управления изменились. Черновик сохранён на экране, но отправить его нельзя. Загрузите текущие настройки города.</p>}
    {(conflict || outdated) && <p className="ui-note city-admin-alert" role="alert">Настройки города уже изменены. Черновик сохранён на экране. Загрузите сохранённые настройки заново перед следующим изменением.</p>}
    {reload.isError && <ErrorState error={reload.error} />}
    <FormFooter status={<FormStatus error={mutation.isError && !conflict && !denied && mutation.error} saved={saved && "Города и районы сохранены."}
      note={!data.can_edit && !isHead ? "Управлять районами могут руководитель закреплённого города и администратор." : state.dirty ? "Есть несохранённые изменения." : null} />}>
      <Button disabled={busy} onClick={reloadSettings}>{reload.isPending ? "Загружаем…" : state.dirty ? "Загрузить сохранённые настройки (сбросить черновик)" : "Обновить настройки"}</Button>
      {data.can_edit && <Button type="submit" variant="primary" disabled={!canSubmit}>{mutation.isPending ? "Сохраняем…" : "Сохранить города и районы"}</Button>}
    </FormFooter>
  </form>;
}
