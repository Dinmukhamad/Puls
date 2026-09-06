import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { games, type WheelSpin } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, RowsSkeleton, SegmentedControl } from "../components/ui";
import { dateTime, points } from "../utils/format";
import { Raffles, WheelSettings } from "./GamesSettings";
import "./games.css";
import "./learning.css";

const COLORS = ["#4f68ff","#7a5cfa","#278f78","#a57a26","#456cab","#7652bc","#34817c","#967640"];
export function GamesPage({ administrative = false }: { administrative?: boolean }) {
  const [params, setParams] = useSearchParams(); const { atLeast } = useAuth();
  const tab = params.get("tab") === "raffles" ? "raffles" : "wheel";
  return <div className="stack games-page"><div className="page-head"><div><h1 className="page-title">{administrative ? "Управление играми" : "Моменты WOW"}</h1><p className="page-subtitle">{administrative ? "Награды и правила участия" : "Небольшие приятные события в рабочем дне"}</p></div>{!administrative && atLeast("supervisor") && <Link className="btn btn--secondary" to="/admin/games">Управление</Link>}</div>{!administrative && atLeast("supervisor") && <SegmentedControl label="Игры" value={tab} options={[{ value:"wheel",label:"Колесо WOW" },{ value:"raffles",label:"Розыгрыши" }]} onChange={(value) => setParams({tab:value})} />}{tab === "wheel" ? administrative ? <WheelSettings /> : <Wheel /> : <Raffles administrative={administrative} />}</div>;
}
export function invalidateRewards(client: ReturnType<typeof useQueryClient>) { for (const key of ["wheel","wheel-history","dashboard","wallet","xp-summary", "xp-ledger","xp-history","notifications"]) void client.invalidateQueries({ queryKey:[key] }); }
function Wheel() {
  const query = useQuery({ queryKey:["wheel"], queryFn:games.wheel });
  const [page,setPage] = useState(1); const history = useQuery({ queryKey:["wheel-history",page],queryFn:()=>games.history(page) });
  const [result,setResult] = useState<WheelSpin|null>(null); const [animating,setAnimating] = useState(false);
  const [rotation,setRotation] = useState(0); const [snapshot,setSnapshot] = useState<WheelSpin["segments"]|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null); const key = useRef<string|null>(null); const client = useQueryClient();
  useEffect(()=>()=>{ if(timer.current) clearTimeout(timer.current); },[]);
  const spin = useMutation({ mutationFn:()=>{ key.current ??= crypto.randomUUID(); return games.spin(key.current); },onSuccess:(value)=>{
    setSnapshot(value.segments); setResult(null); setAnimating(true);
    setRotation((old)=>Math.floor(old/360)*360+1080+360-(value.segment+.5)*360/value.segments.length);
    timer.current=setTimeout(()=>{ setResult(value);setAnimating(false);key.current=null;invalidateRewards(client); },window.matchMedia("(prefers-reduced-motion: reduce)").matches?0:3100);
  } });
  if(query.isLoading) return <RowsSkeleton />; if(query.isError) return <ErrorState error={query.error} onRetry={()=>query.refetch()} />;
  const config=query.data!;const segments=snapshot??config.segments;
  const background=`conic-gradient(${segments.map((_,index)=>`${COLORS[index%COLORS.length]} ${index*360/segments.length}deg ${(index+1)*360/segments.length}deg`).join(",")})`;
  const totalWeight=segments.reduce((total,item)=>total+item.weight,0);
  return <div className="wheel-layout"><Card className="wheel-card"><span className="training-eyebrow">КОЛЕСО WOW</span><h2>Пусть день удивит.</h2><p className="secondary">Небольшая возможность для приятного бонуса</p><div className="wheel-stage"><span className="wheel-pointer" aria-hidden="true" /><div className="wheel-disc" aria-hidden="true" style={{background,transform:`rotate(${rotation}deg)`}}>{segments.map((_,index)=><span className="wheel-number" key={index} style={{"--angle":`${(index+.5)*360/segments.length}deg`} as CSSProperties}>{index+1}</span>)}</div><div className="wheel-center">WOW<span>PULS</span></div></div><Button className="wheel-spin" variant="primary" disabled={!config.enabled||config.used_today>=config.daily_spins||spin.isPending||animating} onClick={()=>spin.mutate()}>{spin.isPending?"Готовим результат…":animating?"Вращаем…":!config.enabled?"Скоро вернёмся":config.used_today>=config.daily_spins?"На сегодня всё":"Крутить колесо"}</Button><p className="secondary small">Бесплатно · Осталось {Math.max(0,config.daily_spins-config.used_today)} из {config.daily_spins}<br/>Попытки обновляются в 00:00 UTC</p>{spin.isError&&<ErrorState error={spin.error}/>}</Card>
    <div className="stack">{result&&<Card className="wheel-result" title={result.reward.xp||result.reward.coins?"Ваш результат":"В этот раз без награды"}><div role="status" className="stack stack--tight"><h3>{result.reward.title}</h3><div className="row">{result.reward.xp>0&&<Badge tone="xp">+{result.reward.xp} XP</Badge>}{result.reward.coins>0&&<Badge tone="coin">+{result.reward.coins} коинов</Badge>}</div><p className="secondary">{result.reward.xp||result.reward.coins?"Награда уже зачислена.":"Спасибо за участие. Следующая попытка будет новой возможностью."}</p></div></Card>}
      <Card title="Что может выпасть" subtitle="Вероятности указаны рядом с каждым результатом"><ol className="wheel-legend">{segments.map((item,index)=><li key={index}><span className="wheel-legend__dot" style={{background:COLORS[index%COLORS.length]}}>{index+1}</span><span>{item.title}</span><strong>{points(item.weight/totalWeight*100)}%</strong></li>)}</ol></Card>
      <Card title="История вращений">{history.isLoading&&<RowsSkeleton/>}{history.isError&&<ErrorState error={history.error} onRetry={()=>history.refetch()}/>} {!history.data?.total&&!history.isLoading&&!history.isError&&<EmptyState title="Первое вращение впереди"/>}{history.data?.items.map((item)=><div className="game-history" key={item.id}><span><strong>{item.reward.title}</strong><small>{dateTime(item.created_at)}</small></span><span>{[item.reward.xp?`+${item.reward.xp} XP`:"",item.reward.coins?`+${item.reward.coins} коинов`:""].filter(Boolean).join(" · ")||"Без награды"}</span></div>)}<Pagination page={page} size={20} total={history.data?.total??0} onChange={setPage}/></Card>
    </div></div>;
}
