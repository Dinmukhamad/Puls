import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { citySeasons, SEASONS_QUERY, type CitySeasons, type SeasonPeriod } from "../../api/citySeasons";
import { Badge, Button, Card, ErrorState, KPI, Skeleton } from "../../components/ui";
import { Select } from "../../components/Select";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { FormFooter, FormStatus } from "./CityAdminControls";
import { dateText, daysText, firstReset, localInput, PERIOD_EVERY, resetMoment, resetsText, seasonDates, timeLeft, totalsLine } from "./seasonText";
import "./cityHistory.css";

/**
 * «Сезоны»: one schedule for both cities, the reset now, and every past season with its dates and what it built.
 * Heads and administrators change it; the rest of the staff read it.
 */
export function CitySeasonsAdmin() {
  const client = useQueryClient(), toast = useToast();
  const query = useQuery({ queryKey: SEASONS_QUERY, queryFn: ({ signal }) => citySeasons.overview(signal), refetchInterval: 60000 });
  const [confirming, setConfirming] = useState(false);
  const reset = useMutation({
    mutationFn: (number: number) => citySeasons.reset(number),
    onSuccess: async data => {
      client.setQueryData(SEASONS_QUERY, data); setConfirming(false);
      toast.success(`Город начал сезон ${data.current.number}. Прошлый — в истории.`);
      await client.invalidateQueries({ queryKey: ["city-estates"] });
      await client.invalidateQueries({ queryKey: ["city-estates-report"] });
      await client.invalidateQueries({ queryKey: ["city-estate"] });
    },
  });
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return <Skeleton height={300} />;
  const data = query.data, current = data.current;
  const age = Math.max(1, Math.round((Date.now() - new Date(current.started_at).getTime()) / 86_400_000));
  return <div className="stack">
    <p className="ui-note">Город строится сезонами: по расписанию районы обоих городов очищаются, а прошлый город остаётся в истории. Постройки, дороги, благоустройство и инвентарь уходят, главные здания районов возвращаются на 1 уровень. Обучение, опыт, коины и уровни зданий обучения остаются; коины за постройки не возвращаются, взносы в недостроенные общие проекты — возвращаются. Операторы видят прошлый город {daysText(data.visible_days)}, руководители и администраторы — всегда.</p>
    <div className="kpi-grid">
      <KPI label="Идёт сезон" value={current.number} hint={`С ${dateText(current.started_at)} · ${daysText(age)}`} />
      <KPI label="Следующий сброс" value={current.ends_at ? timeLeft(current.ends_at) : "—"} hint={current.ends_at ? resetMoment(current.ends_at) : "Расписание не задано"} />
      <KPI label="Город сбрасывался" value={resetsText(data.resets)} hint="За всё время" />
    </div>
    <Schedule data={data} />
    {data.can_manage && <Card title="Сбросить сейчас" subtitle="Если руководители договорились закончить сезон раньше">
      <div className="stack stack--tight">
        <p className="ui-note">Оба города начнут сезон {current.number + 1} сразу. Расписание продолжится от этого момента.</p>
        <div><Button variant="destructive" onClick={() => setConfirming(true)}>Сбросить город сейчас</Button></div>
      </div>
    </Card>}
    <Card title="Прошлые сезоны" subtitle={data.history.length ? `Город сбрасывался ${resetsText(data.resets)}` : "Сбросов ещё не было"} padded={false}>
      {data.history.length ? <div className="table-wrap table-wrap--responsive city-admin-table"><table className="table">
        <thead><tr><th>Сезон</th><th>Даты</th><th className="num">Длился</th><th>Как закончился</th><th>Построено</th><th /></tr></thead>
        <tbody>{data.history.map(s => <tr key={s.id}>
          <td><strong>Сезон {s.number}</strong></td>
          <td className="nowrap">{seasonDates(s.started_at, s.ended_at)}</td>
          <td className="num">{daysText(s.days)}</td>
          <td>{s.scheduled ? <Badge tone="neutral">По расписанию</Badge> : <Badge tone="warning">{s.ended_by ?? "Вручную"}</Badge>}</td>
          <td>{totalsLine(s.totals)}</td>
          <td className="nowrap"><Link to={`/training/city?city=support&history=${s.id}`}>Техподдержка</Link> · <Link to={`/training/city?city=sales&history=${s.id}`}>ОП</Link></td>
        </tr>)}</tbody>
      </table></div> : <div className="card__body"><p className="ui-note">Когда город сбросится, здесь появится его сезон: даты, итоги и прошлый город в 3D.</p></div>}
      {data.history.length > 0 && <div className="card__body"><ul className="card-list">{data.history.map(s => <li className="list-card" key={s.id}>
        <div className="list-card__head"><strong>Сезон {s.number}</strong>{s.scheduled ? <Badge tone="neutral">По расписанию</Badge> : <Badge tone="warning">{s.ended_by ?? "Вручную"}</Badge>}</div>
        <p className="ui-note">{seasonDates(s.started_at, s.ended_at)} · {daysText(s.days)}</p>
        <p>{totalsLine(s.totals)}</p>
        <p><Link to={`/training/city?city=support&history=${s.id}`}>Смотреть Техподдержку</Link> · <Link to={`/training/city?city=sales&history=${s.id}`}>ОП</Link></p>
      </li>)}</ul></div>}
    </Card>
    {confirming && <Sheet title={`Сбросить город и закончить сезон ${current.number}?`} subtitle="Действие нельзя отменить" onClose={() => !reset.isPending && setConfirming(false)} size="s"
      footer={<><Button onClick={() => setConfirming(false)} disabled={reset.isPending}>Отмена</Button><Button variant="destructive" disabled={reset.isPending} onClick={() => reset.mutate(current.number)}>{reset.isPending ? "Сбрасываем…" : "Сбросить город"}</Button></>}>
      <div className="stack stack--tight">
        <p>В обоих городах уйдут в историю все постройки, дороги, деревья, фонари, инвентарь и общие проекты. Главные здания районов вернутся на 1 уровень.</p>
        <p>Останутся обучение, опыт, коины на балансе и уровни зданий обучения. Коины за постройки не вернутся, взносы в недостроенные проекты — вернутся.</p>
        <p>Операторы получат уведомление и увидят прошлый город в «Истории» {daysText(data.visible_days)}.</p>
        {reset.isError && <FormStatus error={reset.error} />}
      </div>
    </Sheet>}
  </div>;
}

/** The period and the next reset; the date follows the period chosen until it is set by hand. */
function Schedule({ data }: { data: CitySeasons }) {
  const client = useQueryClient(), current = data.current;
  const [period, setPeriod] = useState<SeasonPeriod | "">(current.period ?? ""), [endsAt, setEndsAt] = useState(current.ends_at ? localInput(new Date(current.ends_at)) : "");
  const [dirty, setDirty] = useState(false);
  // A save elsewhere arrives with polling; it replaces the form only while nothing is being edited here.
  useEffect(() => { if (dirty) return; setPeriod(current.period ?? ""); setEndsAt(current.ends_at ? localInput(new Date(current.ends_at)) : ""); }, [current.period, current.ends_at, current.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => citySeasons.schedule({ revision: current.revision, period: period || null, ends_at: period && endsAt ? new Date(endsAt).toISOString() : null }),
    onSuccess: result => { client.setQueryData(SEASONS_QUERY, result); setDirty(false); },
  });
  const options = [{ value: "", label: "Не сбрасывать само" }, ...data.periods.map(p => ({ value: p.id, label: p.name }))];
  const missingDate = !!period && !endsAt;
  return <Card title="Расписание" subtitle="Одно для Техподдержки и ОП">
    <form className="stack" onSubmit={event => { event.preventDefault(); if (!missingDate) save.mutate(); }}>
      <div className="city-admin-grid">
        <label className="field"><span className="field__label">Как часто сбрасывать город</span>
          <Select aria-label="Как часто сбрасывать город" value={period} options={options} disabled={!data.can_manage || save.isPending} onChange={value => {
            const next = value as SeasonPeriod | ""; setPeriod(next); setDirty(true);
            if (next && !endsAt) setEndsAt(localInput(firstReset(next)));
            if (!next) setEndsAt("");
          }} /></label>
        <label className="field"><span className="field__label">Следующий сброс</span>
          <input className="input" type="datetime-local" value={endsAt} disabled={!data.can_manage || !period || save.isPending} required={!!period} onChange={event => { setEndsAt(event.target.value); setDirty(true); }} /></label>
      </div>
      {data.can_manage && <FormFooter status={<FormStatus error={save.error} saved={!dirty && save.isSuccess ? "Расписание сохранено" : undefined}
        note={period ? `Город будет сбрасываться ${PERIOD_EVERY[period]}. За ${daysText(data.warn_days)} до сброса операторы видят предупреждение.` : "Пока расписания нет, город сбрасывается только кнопкой «Сбросить сейчас»."} />}>
        <Button variant="primary" type="submit" disabled={!dirty || missingDate || save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить расписание"}</Button>
      </FormFooter>}
      {!data.can_manage && <p className="ui-note">Расписание меняют руководитель и администратор.</p>}
    </form>
  </Card>;
}
