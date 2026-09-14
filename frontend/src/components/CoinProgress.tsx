import { useQuery } from "@tanstack/react-query";
import { progressApi, type CoinProgressData } from "../api/progress";
import type { BadgeOut } from "../api/types";
import { AccessLink as Link } from "./AccessLink";
import { Badge, Card, EmptyState, ErrorState, Progress, Skeleton } from "./ui";
import { coins, plural } from "../utils/format";
import "../pages/coin-progress.css";

export function CoinProgress({ userId, showDetails = false }: { userId?: number; showDetails?: boolean }) {
  const query = useQuery({ queryKey: ["coin-progress", userId ?? "me"], queryFn: () => progressApi.summary(userId) });
  if (query.isPending) return <Skeleton height={220} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <ProgressOverview data={query.data} showDetails={showDetails} own={userId === undefined} />;
}

export function ProgressOverview({ data, showDetails, own = false }: { data: CoinProgressData; showDetails: boolean; own?: boolean }) {
  const earned = data.achievements.filter(item => item.unlocked).length;
  const work = data.achievements.filter(item => item.category === "work");
  const nearest = work.filter(item => !item.unlocked).sort((a, b) => b.progress_percent - a.progress_percent)[0];
  return <div className="stack coin-progress">
    <Card className="coin-progress-hero" variant="highlight">
      <div className="coin-progress-heading"><span>Уровень {data.level_number}</span><Badge tone="coin">{earned} {plural(earned, "достижение", "достижения", "достижений")}</Badge></div>
      <h2>{data.current?.title ?? "Начало пути"}</h2>
      <p className="coin-progress-total"><strong>{coins(data.total)}</strong> коинов заработано за всё время</p>
      <Progress value={data.progress} tone="accent" label="До следующего уровня" />
      <p>{data.next ? <>До уровня «{data.next.title}» осталось заработать <strong>{coins(data.remaining)} коинов</strong>.</> : "Все настроенные уровни достигнуты."}</p>
      <p className="coin-progress-explanation">Покупки не снижают уровень. Возвраты покупок не прибавляют прогресс.</p>
      <div className="coin-progress-wallet"><span>Доступно в кошельке: <strong>{coins(data.available)} коинов</strong></span>{own && <Link hideWhenDenied to="/wallet">Открыть кошелёк →</Link>}</div>
    </Card>
    {showDetails && <>
      {nearest && <Card title="Ближайшее достижение"><Achievement item={nearest} own={own} /></Card>}
      <Card title="Как заработать коины"><div className="coin-earning-options">
        <div><h3>Работа</h3><p>Выполняйте показатели недели. После закрытия недели результат и бонусы переводятся в коины.</p>{own && <Link hideWhenDenied to="/cabinet">Посмотреть показатели →</Link>}</div>
        <div><h3>Обучение</h3><p>Пройдите задание успешно. Размер награды указан в его карточке; за одно задание коины выдаются один раз.</p>{own && <Link hideWhenDenied to="/training">Выбрать обучение →</Link>}</div>
        <div><h3>Достижения</h3><p>Выполняйте условия ниже. Бонус за первое получение приближает следующий уровень.</p><a href="#work-achievements">Посмотреть условия ↓</a></div>
      </div></Card>
      <Card title="Уровни и достижения" subtitle="При достижении порога открываются уровень и его достижение. Повторного начисления коинов за уровень нет.">
        <ol className="coin-levels">{data.levels.map((level, index) => {
          const reached = data.total >= level.min_coins;
          return <li key={level.id} className={data.current?.id === level.id ? "is-current" : ""}><span className="coin-level-number">{index + 1}</span><div><h3>{level.title}</h3><p>{level.min_coins ? `Заработать ${coins(level.min_coins)} коинов за всё время` : "Стартовый уровень"}</p>{level.min_coins > 0 && <p className="coin-level-achievement">Достижение: «{coins(level.min_coins)} коинов заработано»</p>}{level.description && <p>{level.description}</p>}</div><Badge tone={reached ? "success" : "neutral"}>{data.current?.id === level.id ? "Ваш уровень" : reached ? "Достигнут" : "Впереди"}</Badge></li>;
        })}</ol>
      </Card>
      <div id="work-achievements"><Card title="Достижения за работу и обучение" subtitle="У каждого результата — своё условие. Бонус за достижение выдаётся только при первом получении.">
        {!work.length && <EmptyState title="Рабочие достижения ещё не настроены" hint="Достижения за уровни уже доступны выше." />}
        <div className="coin-achievements">{work.map(item => <Achievement key={item.code} item={item} own={own} />)}</div>
      </Card></div>
    </>}
  </div>;
}

function Achievement({ item, own }: { item: BadgeOut; own: boolean }) {
  return <article className="coin-achievement"><div className="coin-achievement-title"><h3>{item.title}</h3><Badge tone={item.unlocked ? "success" : "neutral"}>{item.unlocked ? "Получено" : "В процессе"}</Badge></div>
    {item.description && <p>{item.description}</p>}
    {!item.unlocked && <><Progress value={item.progress_percent / 100} label={item.title} /><p>{item.hint}</p></>}
    <p className="coin-achievement-reward">{item.unlocked ? item.coins_awarded > 0 ? `Начислено за достижение: ${coins(item.coins_awarded)} коинов` : "Достижение получено. Дополнительного начисления нет." : item.coins_reward > 0 ? `Награда за первое получение: ${coins(item.coins_reward)} коинов` : "Награда: достижение без дополнительного начисления коинов"}</p>
    {own && !item.unlocked && item.action_url && item.action_url !== "/progress" && <Link hideWhenDenied to={item.action_url}>{item.action_url === "/training" ? "Перейти к обучению →" : "Посмотреть показатели →"}</Link>}
  </article>;
}
