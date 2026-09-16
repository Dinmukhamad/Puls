import { DriverTripReviews } from "./DriverTripReviews";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { driver } from "../api/driver";
import { driverShift, type DriverScenario } from "../api/driverShift";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, ErrorState, RowsSkeleton } from "../components/ui";
import { dateTime } from "../utils/format";

export function DriverTeamResults({ userId }: { userId?: number } = {}) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["driver-team-results", userId, page], queryFn: () => driverShift.results(page, userId) });
  return <Card title="Driver Simulator · смены команды"><div className="stack">{query.isLoading ? <RowsSkeleton /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : query.data?.items.length ? query.data.items.map(x => <details key={x.id}><summary>{x.full_name} · {x.finished_at ? x.result?.score == null ? "Свободная практика" : `${x.result.score}/100` : `В работе · ${x.completed} заказов`}</summary><p>{x.title} · {dateTime(x.created_at)}</p><DriverTripReviews trips={x.result?.trips} />{x.result?.checks.map(check => <p className="small" key={check.key}>{check.done ? "✓" : "○"} {check.title} · {check.path}</p>)}</details>) : <p className="secondary">Смены сотрудников появятся после запуска тренажёра.</p>}<div className="row"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Назад</Button><span>{page}</span><Button disabled={page * 20 >= (query.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Далее</Button></div></div></Card>;
}

export function DriverScenarioEditor() {
  const config = useQuery({ queryKey: ["driver-scenario"], queryFn: driverShift.config });
  const parks = useQuery({ queryKey: ["driver-parks"], queryFn: driver.parks });
  const { atLeast } = useAuth();
  return <Card title="Driver Simulator · сценарий смены" subtitle="Правила применяются к новым сменам. Начатая смена сохраняет свои условия.">
    {config.isLoading ? <RowsSkeleton /> : config.isError ? <ErrorState error={config.error} onRetry={() => config.refetch()} /> : config.data && <ScenarioForm initial={config.data} parks={parks.data?.parks ?? []} readOnly={!atLeast("head")} />}
  </Card>;
}
export function ScenarioForm({ initial, parks, readOnly, onSave = driverShift.saveConfig, saveLabel = "Сохранить сценарий новых смен" }: { initial: DriverScenario; parks: { id: string; name: string }[]; readOnly: boolean; onSave?: (value: DriverScenario) => Promise<DriverScenario>; saveLabel?: string }) {
  const [value, setValue] = useState(() => structuredClone(initial));
  const save = useMutation({ mutationFn: onSave, onSuccess: setValue });
  function edit<K extends keyof DriverScenario>(key: K, next: DriverScenario[K]) { setValue(old => ({ ...old, [key]: next })); save.reset(); }
  const numbers: { key: keyof DriverScenario; title: string; max: number; min?: number; step?: number }[] = [
    { key: "target_orders", title: "Заказов за смену (например 3, 5 или 10)", max: 10, min: 1 },
    { key: "fare", title: "Базовая стоимость поездки, ₸", max: 100000, min: 100 },
    { key: "fare_per_km", title: "Стоимость километра маршрута, ₸", max: 1000 },
    { key: "arrival_radius", title: "Радиус прибытия в А и Б, метров", min: 30, max: 200 },
    { key: "free_wait_seconds", title: "Бесплатное ожидание, секунд", min: 5, max: 900 },
    { key: "boarding_seconds", title: "Через сколько секунд подходит пассажир", min: 5, max: 900 },
    { key: "virtual_speed", title: "Скорость виртуального движения, м/с", min: 1, max: 100 },
    { key: "service_percent", title: "Комиссия сервиса, %", max: 40, step: .01 },
    { key: "service_tax_percent", title: "Налог с комиссии сервиса, %", max: 30, step: .01 },
    { key: "wait_per_minute", title: "Платное ожидание, ₸ / полная минута", max: 1000 },
    { key: "initial_balance", title: "Начальный учебный баланс, ₸", max: 1000000 },
    { key: "initial_points", title: "Начальные баллы уровня", max: 1000000 },
    { key: "priority_base", title: "Начальный приоритет", max: 100 },
    { key: "priority_complete", title: "Приоритет за выполненный заказ", max: 10 },
    { key: "priority_missed", title: "Снижение приоритета за пропуск", max: 30 },
    { key: "priority_cancelled", title: "Снижение приоритета за отмену", max: 30 },
    { key: "offer_seconds", title: "Время принятия предложения, секунд", max: 120, min: 10 },
  ];
  return <form className="stack" onSubmit={e => { e.preventDefault(); if (!readOnly && !save.isPending) save.mutate(value); }}><p className="secondary small">Настройте учебные параметры и вопросы поддержки по вашему регламенту. Комиссия определяется настройками выбранного парка.</p><fieldset className="learning-fieldset stack" disabled={readOnly || save.isPending}>
    <label className="field"><span>Название сценария</span><input className="input" required maxLength={100} value={value.title} onChange={e => edit("title", e.target.value)} /></label>
    <label><input type="checkbox" checked={value.real_location_required} onChange={e => edit("real_location_required", e.target.checked)} /> Реальная геолокация обязательна в учебной смене</label><p className="secondary small">При включённом требовании оператор сможет прибыть и завершить заказ только по GPS. В свободной практике доступно виртуальное движение по построенному маршруту. Demo Mode администратора не даёт зачётных баллов.</p>
    <label className="field"><span>Парк по заданию</span><select className="input" value={value.required_park} onChange={e => edit("required_park", e.target.value)}>{parks.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <details><summary>Параметры заказов и оценки</summary><div className="learning-form-grid">{numbers.map(x => <label key={x.key} className="field"><span>{x.title}</span><input className="input" type="number" required min={x.min ?? 0} max={x.max} step={x.step ?? 1} value={Number(value[x.key])} onChange={e => edit(x.key, Number(e.target.value))} /></label>)}</div><div className="stack">{([["require_photo", "Обязательный фотоконтроль"], ["route_event", "Изменение адреса в первом заказе"], ["require_support", "Проблема с выплатой и Telegram-поддержка"], ["require_documents", "Проверка и подписание документов"]] as const).map(([key, title]) => <label key={key}><input type="checkbox" checked={value[key]} onChange={e => edit(key, e.target.checked)} /> {title}</label>)}</div></details>
    <details><summary>Уровни и преимущества</summary><div className="stack">{value.levels.map((x, i) => <div className="learning-form-grid" key={i}><label className="field"><span>Уровень {i + 1}</span><input className="input" required value={x.name} maxLength={50} onChange={e => edit("levels", value.levels.map((y, j) => i === j ? { ...y, name: e.target.value } : y))} /></label><label className="field"><span>От скольких баллов</span><input className="input" type="number" min={0} max={1000000} required value={x.threshold} onChange={e => edit("levels", value.levels.map((y, j) => i === j ? { ...y, threshold: Number(e.target.value) } : y))} /></label><label className="field"><span>Преимущества</span><input className="input" required maxLength={400} value={x.benefits} onChange={e => edit("levels", value.levels.map((y, j) => i === j ? { ...y, benefits: e.target.value } : y))} /></label><Button disabled={value.levels.length <= 1} onClick={() => edit("levels", value.levels.filter((_, j) => i !== j))}>Удалить уровень</Button></div>)}<Button disabled={value.levels.length >= 10} onClick={() => edit("levels", [...value.levels, { name: "Новый уровень", threshold: value.levels.at(-1)!.threshold + 1000, benefits: "Преимущества уровня" }])}>Добавить уровень</Button></div></details>
    <details><summary>Тарифы и доступность</summary><div className="stack">{value.tariffs.map((x, i) => <div key={x.id} className="learning-form-grid"><label className="field"><span>Название</span><input className="input" required maxLength={60} value={x.name} onChange={e => edit("tariffs", value.tariffs.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} /></label><label><input type="checkbox" checked={x.available} onChange={e => edit("tariffs", value.tariffs.map((y, j) => j === i ? { ...y, available: e.target.checked } : y))} /> Доступен</label><label className="field"><span>Причина ограничения</span><input className="input" maxLength={200} value={x.reason} onChange={e => edit("tariffs", value.tariffs.map((y, j) => j === i ? { ...y, reason: e.target.value } : y))} /></label><Button disabled={value.tariffs.length <= 1} onClick={() => edit("tariffs", value.tariffs.filter((_, j) => i !== j))}>Удалить тариф</Button></div>)}<Button disabled={value.tariffs.length >= 20} onClick={() => edit("tariffs", [...value.tariffs, { id: crypto.randomUUID(), name: "Новый тариф", available: true, reason: "" }])}>Добавить тариф</Button></div></details>
    <details><summary>Начальное распределение рейтинга</summary><div className="learning-form-grid">{value.ratings.map((x, i) => <label key={i} className="field"><span>Оценок {i + 1} ★</span><input className="input" required type="number" min={0} max={100000} value={x} onChange={e => edit("ratings", value.ratings.map((n, j) => j === i ? Number(e.target.value) : n))} /></label>)}</div></details>
    <details><summary>Диалог учебной поддержки в Telegram</summary><div className="stack">{value.support_steps?.map((x, i) => <div className="card stack" key={i}><label className="field"><span>Вопрос {i + 1}</span><textarea className="input" required minLength={5} maxLength={600} value={x.question} onChange={e => edit("support_steps", value.support_steps!.map((y, j) => j === i ? { ...y, question: e.target.value } : y))} /></label>{x.options.map((option, k) => <label className="field" key={k}><span>Вариант {k + 1}</span><input className="input" required maxLength={160} value={option} onChange={e => edit("support_steps", value.support_steps!.map((y, j) => j === i ? { ...y, options: y.options.map((o, n) => n === k ? e.target.value : o) } : y))} /></label>)}<label className="field"><span>Правильный ответ</span><select className="input" value={x.correct} onChange={e => edit("support_steps", value.support_steps!.map((y, j) => j === i ? { ...y, correct: Number(e.target.value) } : y))}>{x.options.map((_, k) => <option key={k} value={k}>Вариант {k + 1}</option>)}</select></label><label className="field"><span>Объяснение после ответа</span><textarea className="input" required minLength={5} maxLength={600} value={x.explanation} onChange={e => edit("support_steps", value.support_steps!.map((y, j) => j === i ? { ...y, explanation: e.target.value } : y))} /></label><Button disabled={value.support_steps!.length <= 1} onClick={() => edit("support_steps", value.support_steps!.filter((_, j) => i !== j))}>Удалить вопрос</Button></div>)}<Button disabled={(value.support_steps?.length ?? 0) >= 10} onClick={() => edit("support_steps", [...value.support_steps ?? [], { question: "Новый учебный вопрос", options: ["Вариант 1", "Вариант 2"], correct: 0, explanation: "Объяснение правильного ответа" }])}>Добавить вопрос</Button></div></details>
    {!readOnly && <Button type="submit" variant="primary">{save.isPending ? "Сохраняем…" : saveLabel}</Button>}
  </fieldset>{save.isSuccess && <p role="status">Сценарий сохранён. Он применится при следующем запуске смены.</p>}{save.isError && <ErrorState error={save.error} />}</form>;
}
