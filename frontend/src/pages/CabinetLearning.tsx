import { useQuery } from "@tanstack/react-query";
import { city, MISSION_STATES } from "../api/city";
import { useAccess } from "../auth/AccessContext";
import { AccessLink as Link } from "../components/AccessLink";
import { CoinIcon, SparkIcon } from "../components/icons";
import { Badge, Button, Card, Progress, Skeleton } from "../components/ui";
import { coins, plural } from "../utils/format";
import "./cabinet-learning.css";

const CITY_PATH = "/training/city";

/** A small city read reuses the map's cache without importing its 3D scene. */
export function CabinetLearning() {
  const access = useAccess();
  const allowed = access.canPath(CITY_PATH);
  const query = useQuery({
    queryKey: ["city", "self"],
    queryFn: ({ signal }) => city.own(signal),
    enabled: allowed,
    staleTime: 30_000,
    retry: false,
  });

  if (!allowed) return null;

  const data = query.data;
  const missions = data?.missions.filter(mission => mission.enabled && data.districts.some(district => district.id === mission.district && !district.soon)) ?? [];
  // Match the city's next-mission order; never send the operator to a locked or paused task.
  const mission = missions.find(item => item.state === "ready")
    ?? missions.find(item => item.state === "in_progress")
    ?? missions.find(item => item.state === "available");
  const district = data?.districts.find(item => item.id === mission?.district);
  const curriculum = data?.missions.filter(item => item.enabled || item.state === "completed") ?? [];
  const complete = curriculum.length > 0 && curriculum.every(item => item.state === "completed");
  const loading = query.isPending && query.fetchStatus !== "paused";
  const to = mission ? `${CITY_PATH}?${new URLSearchParams({ district: mission.district, mission: mission.key })}` : CITY_PATH;
  const canReward = data?.can_claim && !data.preview && !data.inspecting;
  const action = mission?.state === "ready" && canReward ? "Завершить миссию"
    : mission?.state === "in_progress" ? "Продолжить миссию"
    : mission ? "Открыть миссию" : "Открыть мой город";

  return <Card title="Продолжить обучение" action={<SparkIcon size={20} />} className="cabinet-learning">
    {loading ? <div className="cabinet-learning__loading" role="status">
      <span className="secondary small">Загружаем задание…</span>
      <Skeleton height={24} width="85%" />
      <Skeleton height={16} width="65%" />
      <Skeleton height={8} />
    </div> : mission ? <>
      <div className="cabinet-learning__meta">
        <span>{district?.name ?? "Мой город"}</span>
        <Badge tone={mission.state === "ready" ? "success" : "neutral"}>{MISSION_STATES[mission.state]}</Badge>
      </div>
      <h3 className="cabinet-learning__title">{mission.title}</h3>
      {mission.target > 0 && <div className="cabinet-learning__progress">
        <div><span>{mission.objective}</span><strong>{coins(Math.min(mission.current, mission.target))} / {coins(mission.target)}</strong></div>
        <Progress value={mission.current / mission.target} label={`Миссия «${mission.title}»`} />
      </div>}
    </> : <div className="cabinet-learning__intro">
      <span className="cabinet-learning__icon"><SparkIcon size={26} /></span>
      <h3 className="cabinet-learning__title">{complete ? "Миссии пройдены" : "Твой город ждёт"}</h3>
      <p>{complete ? "Все доступные миссии завершены. Возвращайся в город для практики и новых заданий." : "Открой карту города, чтобы посмотреть задания и продолжить обучение."}</p>
    </div>}

    {!data && !loading && <div className="cabinet-learning__notice" role="status">
      <p>{query.fetchStatus === "paused" ? "Подключись к сети, чтобы обновить задания." : "Не удалось обновить задания."}</p>
      <Button size="s" onClick={() => { void query.refetch(); }}>Повторить</Button>
    </div>}

    <div className="cabinet-learning__footer">
      {mission && canReward && mission.coins > 0 && <p className="cabinet-learning__reward"><CoinIcon size={17} /><strong>+{coins(mission.coins)} {plural(mission.coins, "коин", "коина", "коинов")}</strong><span>за завершение</span></p>}
      <Link hideWhenDenied to={to} className="btn btn--primary btn--m cabinet-learning__cta">{action}<span aria-hidden="true">→</span></Link>
    </div>
  </Card>;
}
