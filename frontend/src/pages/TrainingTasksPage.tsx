import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, nextMission, type CityDistrict, type CityMission, type CityReward } from "../api/city";
import { AccessLink as Link } from "../components/AccessLink";
import { Badge, Button, Card, ErrorState, Progress, SegmentedControl, Skeleton } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { DISTRICT_COLORS, DISTRICT_ICONS } from "./city/cityDistricts";
import { DriverEntry } from "./DriverEntry";
import { coins, plural } from "../utils/format";
import "./training-tasks.css";

type Filter = "open" | "all" | "done";
const FILTERS: { value: Filter; label: string }[] = [{ value: "open", label: "Что сделать" }, { value: "all", label: "Все" }, { value: "done", label: "Пройденные" }];
const OPEN = new Set(["ready", "in_progress", "available"]);
const TONES = { ready: "success", in_progress: "accent", available: "info", completed: "neutral", locked: "neutral", unavailable: "warning" } as const;

/**
 * The whole training as a list, without the 3D city (docs/CITY_MISSIONS.md): every district's missions with their
 * state, progress and reward, and one action each — open the exercise, take the reward, or see what comes first.
 * The same data and the same actions as the city's mission panel; the city stays a button away.
 */
export function TrainingTasksPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["city", "self"], queryFn: ({ signal }) => city.own(signal), staleTime: 15_000 });
  const [filter, setFilter] = useState<Filter>("open");
  const [driverLaunch, setDriverLaunch] = useState(false);
  const [reward, setReward] = useState<CityReward | null>(null);
  const claim = useMutation({
    mutationFn: (key: string) => city.claim(key, query.data!.revision),
    onSuccess: async result => { setReward(result); await client.invalidateQueries({ queryKey: ["city"] }); },
    onError: () => { void query.refetch(); },
  });

  if (query.isPending) return <div className="stack training-tasks"><Skeleton height={56} width="40%" /><Skeleton height={160} /><Skeleton height={320} /></div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const districts = data.districts.filter(d => !d.soon);
  const curriculum = data.missions.filter(m => (m.enabled || m.state === "completed") && districts.some(d => d.id === m.district));
  const done = curriculum.filter(m => m.state === "completed");
  const ready = curriculum.filter(m => m.state === "ready");
  const next = nextMission(curriculum.filter(m => OPEN.has(m.state)));
  const earned = { xp: done.reduce((s, m) => s + m.xp, 0), coins: done.reduce((s, m) => s + m.coins, 0) };
  const byKey = new Map(data.missions.map(m => [m.key, m]));
  const shown = (m: CityMission) => filter === "all" || (filter === "done" ? m.state === "completed" : m.state !== "completed");
  const canAct = !data.inspecting && !data.preview;

  /** The one action of a mission: take its reward, open its exercise, or nothing yet. */
  const action = (m: CityMission, primary = false) => {
    const size = primary ? "m" : "s";
    if (m.state === "ready" && data.can_claim && canAct) return <Button size={size} variant="primary" disabled={claim.isPending} onClick={() => claim.mutate(m.key)}>{claim.isPending && claim.variables === m.key ? "Проверяем…" : "Забрать награду"}</Button>;
    if (!canAct || m.key === "welcome" || !["in_progress", "available", "completed"].includes(m.state)) return null;
    const label = m.state === "completed" ? "Практика" : m.state === "in_progress" ? "Продолжить" : "Начать";
    const variant = primary ? "primary" : m.state === "completed" ? "plain" : "secondary";
    if (m.district === "driver") return <Button size={size} variant={variant} onClick={() => setDriverLaunch(true)}>{label} →</Button>;
    return <Link to={m.path} className={`btn btn--${variant} btn--${size}`}>{label} →</Link>;
  };

  return <div className="stack training-tasks">
    <div className="page-head">
      <div><h1 className="page-title">Мои задания</h1><p className="page-subtitle">Всё обучение списком: что сделать сейчас и что дальше</p></div>
      <Link to="/training/city" className="btn btn--secondary">Открыть город</Link>
    </div>

    <section className="training-tasks__summary" aria-label="Итог обучения">
      <div><span>Пройдено</span><strong>{done.length} из {curriculum.length}</strong><Progress value={curriculum.length ? done.length / curriculum.length : 0} tone="success" size="s" label="Пройденные миссии" /></div>
      <div><span>Награды ждут</span><strong>{ready.length ? `${ready.length} ${plural(ready.length, "миссия", "миссии", "миссий")}` : "нет"}</strong><small>{ready.length ? "Нажми «Забрать награду»" : "Всё полученное — уже у тебя"}</small></div>
      <div><span>Заработано за обучение</span><strong>✦ {coins(earned.xp)} XP · ◈ {coins(earned.coins)}</strong><small>Коины — на стройку района в городе</small></div>
    </section>

    {next && <Card variant="highlight" className="training-tasks__next" title="Сейчас" subtitle={districtName(districts, next)} action={<Badge tone={TONES[next.state]}>{MISSION_STATES[next.state]}</Badge>}>
      <h2 className="training-tasks__next-title">{next.title}</h2>
      <p className="training-tasks__next-copy">{next.description}</p>
      <MissionProgress mission={next} />
      <div className="training-tasks__next-foot"><Rewards mission={next} />{action(next, true)}</div>
      {claim.isError && <p className="training-tasks__error" role="alert">{claim.error.message}</p>}
    </Card>}

    <SegmentedControl label="Какие задания показать" options={FILTERS} value={filter} onChange={setFilter} />

    {districts.map(d => {
      const own = curriculum.filter(m => m.district === d.id), list = own.filter(shown), passed = own.filter(m => m.state === "completed").length;
      if (!own.length || !list.length) return null;
      return <section key={d.id} className="training-tasks__district" style={{ "--district": DISTRICT_COLORS[d.id] } as React.CSSProperties} aria-label={d.name}>
        <header><span className="training-tasks__icon" aria-hidden="true">{DISTRICT_ICONS[d.id]}</span><div><h2>{d.name}</h2><p>{d.subtitle}</p></div><span className="training-tasks__count">{passed} из {own.length}</span></header>
        <ol>{list.map(m => {
          const parent = m.prerequisite ? byKey.get(m.prerequisite) : undefined;
          return <li key={m.key} data-state={m.state}>
            <span className="training-tasks__mark" aria-hidden="true">{m.state === "completed" ? "✓" : m.state === "locked" ? "🔒" : m.state === "ready" ? "★" : own.indexOf(m) + 1}</span>
            <div className="training-tasks__body">
              <div className="training-tasks__line"><strong>{m.title}</strong><Badge tone={TONES[m.state]}>{MISSION_STATES[m.state]}</Badge></div>
              {m.state === "locked" ? <p>Сначала: «{parent?.title ?? "предыдущая миссия"}»</p> : <p>{m.objective}</p>}
              {m.state !== "locked" && m.state !== "completed" && <MissionProgress mission={m} compact />}
              <Rewards mission={m} />
            </div>
            <div className="training-tasks__act">{action(m)}</div>
          </li>;
        })}</ol>
      </section>;
    })}
    {filter !== "done" && !curriculum.some(m => m.state !== "completed") && <Card><p className="training-tasks__empty">Все доступные миссии пройдены. Новые появятся здесь и в городе.</p></Card>}
    <p className="training-tasks__fine">Задания дня, стройка района и награды за здания — в городе.</p>

    {driverLaunch && <Sheet title="Автопарк · Driver Simulator" onClose={() => setDriverLaunch(false)}><DriverEntry /></Sheet>}
    {reward && <Sheet title={reward.already_claimed ? "Эта награда уже получена" : "Миссия пройдена"} size="s" onClose={() => setReward(null)}>
      <div className="training-tasks__reward"><strong>{reward.title}</strong><p>{reward.already_claimed ? "Прогресс сохранён." : "Награда начислена. Следующая миссия уже ждёт."}</p>
        <div>{reward.xp > 0 && <span>✦ +{reward.xp} XP</span>}{reward.coins > 0 && <span>◈ +{coins(reward.coins)}</span>}</div>
        <Button variant="primary" onClick={() => setReward(null)}>Дальше</Button></div>
    </Sheet>}
  </div>;
}

const districtName = (districts: CityDistrict[], m: CityMission) => `${DISTRICT_ICONS[m.district]} ${districts.find(d => d.id === m.district)?.name ?? ""}`;

function MissionProgress({ mission, compact = false }: { mission: CityMission; compact?: boolean }) {
  if (mission.target <= 1 && compact) return null;
  const current = Math.min(mission.current, mission.target);
  return <div className={`training-tasks__progress${compact ? " is-compact" : ""}`}>
    {!compact && <div><span>{mission.objective}</span><strong>{current} / {mission.target}</strong></div>}
    {compact && <small>{current} / {mission.target}</small>}
    <Progress value={mission.target ? current / mission.target : 0} size="s" label={`«${mission.title}»: ${current} из ${mission.target}`} />
  </div>;
}

function Rewards({ mission }: { mission: CityMission }) {
  if (!mission.xp && !mission.coins) return null;
  return <p className="training-tasks__rewards">{mission.xp > 0 && <span>✦ {mission.xp} XP</span>}{mission.coins > 0 && <span className="is-coin">◈ {coins(mission.coins)}</span>}{mission.state === "completed" && <small>получено</small>}</p>;
}
