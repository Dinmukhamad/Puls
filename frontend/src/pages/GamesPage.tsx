import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { games, type WheelSpin } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, RowsSkeleton, SegmentedControl } from "../components/ui";
import { dateTime, points } from "../utils/format";
import { Raffles, WheelSettings } from "./GamesSettings";
import { PrizeStrip } from "./PrizeStrip";
import "./games.css";
import "./learning.css";

const COLORS = ["#e8431f","#2c2f36","#0f8a7f","#a8700c","#2f6fe4","#b8341a","#4a4e57","#0b7a71"];
export function GamesPage({ administrative = false }: { administrative?: boolean }) {
  const [params, setParams] = useSearchParams(); const { atLeast } = useAuth();
  const tab = params.get("tab") === "raffles" ? "raffles" : "wheel";
  return <div className="stack games-page"><div className="page-head"><div><h1 className="page-title">{administrative ? "Управление играми" : "Моменты WOW"}</h1><p className="page-subtitle">{administrative ? "Награды и правила участия" : "Небольшие приятные события в рабочем дне"}</p></div>{!administrative && atLeast("supervisor") && <Link className="btn btn--secondary" to="/admin/games">Управление</Link>}</div>{!administrative && atLeast("supervisor") && <SegmentedControl label="Игры" value={tab} options={[{ value:"wheel",label:"Колесо WOW" },{ value:"raffles",label:"Розыгрыши" }]} onChange={(value) => setParams({tab:value})} />}{tab === "wheel" ? administrative ? <WheelSettings /> : <Wheel /> : <Raffles administrative={administrative} />}</div>;
}
export function invalidateRewards(client: ReturnType<typeof useQueryClient>) { for (const key of ["wheel","wheel-history","dashboard","wallet","coin-progress", "badges","notifications"]) void client.invalidateQueries({ queryKey:[key] }); }
const MUTE_KEY = "puls:wheel-muted";

function Wheel() {
  const query = useQuery({ queryKey:["wheel"], queryFn:games.wheel });
  const [page,setPage] = useState(1); const history = useQuery({ queryKey:["wheel-history",page],queryFn:()=>games.history(page) });
  const [result,setResult] = useState<WheelSpin|null>(null); const [animating,setAnimating] = useState(false);
  const [snapshot,setSnapshot] = useState<WheelSpin["segments"]|null>(null);
  // Запрос на прокрутку для холста: меняется id — колесо едет к нужному сектору.
  const [request,setRequest] = useState<{id:string;segment:number}|null>(null);
  const [muted,setMuted] = useState(()=>{ try { return localStorage.getItem(MUTE_KEY)==="1"; } catch { return false; } });
  const pending = useRef<WheelSpin|null>(null); const key = useRef<string|null>(null); const client = useQueryClient();

  useEffect(()=>{ try { localStorage.setItem(MUTE_KEY, muted?"1":"0"); } catch { /* приватный режим */ } },[muted]);

  const spin = useMutation({ mutationFn:()=>{ key.current ??= crypto.randomUUID(); return games.spin(key.current); },onSuccess:(value)=>{
    // Результат придерживаем до остановки колеса: показать награду раньше
    // значит обессмыслить саму прокрутку.
    setSnapshot(value.segments); setResult(null); setAnimating(true);
    pending.current = value;
    setRequest({ id: crypto.randomUUID(), segment: value.segment });
  } });

  function settled() {
    const value = pending.current;
    pending.current = null;
    setAnimating(false);
    key.current = null;
    if (value) { setResult(value); invalidateRewards(client); }
  }
  if(query.isLoading) return <RowsSkeleton />; if(query.isError) return <ErrorState error={query.error} onRetry={()=>query.refetch()} />;
  const config=query.data!;const segments=snapshot??config.segments;
  const totalWeight=segments.reduce((total,item)=>total+item.weight,0);
  return <div className="wheel-layout"><Card className="wheel-card"><span className="training-eyebrow">КОЛЕСО WOW</span><h2>Пусть день удивит.</h2><p className="secondary">Небольшая возможность для приятного бонуса</p><div className="strip-stage"><PrizeStrip segments={segments} colors={COLORS} spin={request} muted={muted} onSettled={settled} /></div><Button className="wheel-spin" variant="primary" disabled={!config.enabled||config.used_today>=config.daily_spins||spin.isPending||animating} onClick={()=>spin.mutate()}>{spin.isPending?"Готовим результат…":animating?"Вращаем…":!config.enabled?"Скоро вернёмся":config.used_today>=config.daily_spins?"На сегодня всё":"Крутить"}</Button><p className="secondary small">Бесплатно · Осталось {Math.max(0,config.daily_spins-config.used_today)} из {config.daily_spins}<br/>Попытки обновляются в 00:00 UTC</p><button type="button" className="wheel-mute" aria-pressed={muted} onClick={()=>setMuted((on)=>!on)}>{muted?"Включить звук":"Выключить звук"}</button>{spin.isError&&<ErrorState error={spin.error}/>}</Card>
    <div className="stack">{result&&<Card className="wheel-result" title={result.reward.coins?"Ваш результат":"В этот раз без награды"}><div role="status" className="stack stack--tight"><h3>{result.reward.title}</h3><div className="row">{result.reward.coins>0&&<Badge tone="coin">+{result.reward.coins} коинов</Badge>}</div><p className="secondary">{result.reward.coins?"Награда уже зачислена.":"Спасибо за участие. Следующая попытка будет новой возможностью."}</p></div></Card>}
      <Card title="Что может выпасть" subtitle="Вероятности указаны рядом с каждым результатом"><ol className="wheel-legend">{segments.map((item,index)=><li key={index}><span className="wheel-legend__dot" style={{background:COLORS[index%COLORS.length]}}>{index+1}</span><span>{item.title}</span><strong>{points(item.weight/totalWeight*100)}%</strong></li>)}</ol></Card>
      <Card title="История розыгрышей">{history.isLoading&&<RowsSkeleton/>}{history.isError&&<ErrorState error={history.error} onRetry={()=>history.refetch()}/>} {!history.data?.total&&!history.isLoading&&!history.isError&&<EmptyState title="Первое вращение впереди"/>}{history.data?.items.map((item)=><div className="game-history" key={item.id}><span><strong>{item.reward.title}</strong><small>{dateTime(item.created_at)}</small></span><span>{[item.reward.coins?`+${item.reward.coins} коинов`:""].filter(Boolean).join(" · ")||"Без награды"}</span></div>)}<Pagination page={page} size={20} total={history.data?.total??0} onChange={setPage}/></Card>
    </div></div>;
}
