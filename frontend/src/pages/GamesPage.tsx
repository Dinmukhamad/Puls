import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { games, type WheelSpin } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { Badge, Button, Card, ErrorState, RowsSkeleton, SegmentedControl } from "../components/ui";
import { coins, plural, points } from "../utils/format";
import { Raffles, WheelSettings } from "./GamesSettings";
import { PrizeStrip } from "./PrizeStrip";
import { prizeChances, prizeSticker } from "./wheelPrizes";
import "./games.css";
import "./learning.css";

const COLORS = ["#17191e","#4a4e57","#2a2d34","#6b7079","#1f2126","#5a5e67","#33363d","#7a7f88"];
export function GamesPage({ administrative = false }: { administrative?: boolean }) {
  const [params, setParams] = useSearchParams(); const { atLeast } = useAuth();
  const tab = params.get("tab") === "raffles" ? "raffles" : "wheel";
  return <div className="stack games-page"><div className="page-head"><div><h1 className="page-title">{administrative ? "Управление играми" : "Моменты WOW"}</h1><p className="page-subtitle">{administrative ? "Награды и правила участия" : "Небольшие приятные события в рабочем дне"}</p></div>{!administrative && atLeast("supervisor") && <Link className="btn btn--secondary" to="/admin/games">Управление</Link>}</div>{!administrative && atLeast("supervisor") && <SegmentedControl label="Игры" value={tab} options={[{ value:"wheel",label:"Колесо WOW" },{ value:"raffles",label:"Розыгрыши" }]} onChange={(value) => setParams({tab:value})} />}{tab === "wheel" ? administrative ? <WheelSettings /> : <Wheel /> : <Raffles administrative={administrative} />}</div>;
}
export function invalidateRewards(client: ReturnType<typeof useQueryClient>) { for (const key of ["wheel","dashboard","wallet","coin-progress", "badges","notifications"]) void client.invalidateQueries({ queryKey:[key] }); }
const MUTE_KEY = "puls:wheel-muted";

function Wheel() {
  const query = useQuery({ queryKey:["wheel"], queryFn:games.wheel });
  const [prizesOpen,setPrizesOpen] = useState(false);
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
  return <div className="wheel-layout"><Card className="wheel-card">
      <button type="button" className="wheel-prizes-button" aria-haspopup="dialog" onClick={()=>setPrizesOpen(true)}><span className="wheel-prizes-button__sticker" aria-hidden="true">🎁</span><span>Что может выпасть</span></button>
      <span className="training-eyebrow">КОЛЕСО WOW</span><h2>Пусть день удивит.</h2><p className="secondary">Небольшая возможность для приятного бонуса</p><div className="strip-stage"><PrizeStrip segments={segments} colors={COLORS} icons={segments.map((item)=>prizeSticker(item,segments).icon)} spin={request} muted={muted} onSettled={settled} /></div><Button className="wheel-spin" variant="primary" disabled={!config.enabled||config.used_today>=config.daily_spins||spin.isPending||animating} onClick={()=>spin.mutate()}>{spin.isPending?"Готовим результат…":animating?"Вращаем…":!config.enabled?"Скоро вернёмся":config.used_today>=config.daily_spins?"На сегодня всё":"Крутить"}</Button><p className="secondary small">Бесплатно · Осталось {Math.max(0,config.daily_spins-config.used_today)} из {config.daily_spins}<br/>Попытки обновляются в 00:00 UTC</p><button type="button" className="wheel-mute" aria-pressed={muted} onClick={()=>setMuted((on)=>!on)}>{muted?"Включить звук":"Выключить звук"}</button>{spin.isError&&<ErrorState error={spin.error}/>}</Card>
    {result&&<Card className="wheel-result" title={result.reward.coins?"Ваш результат":"В этот раз без награды"}><div role="status" className="wheel-result__body"><span className="prize-sticker prize-sticker--small" style={stickerStyle(result.reward,segments,0)} aria-hidden="true">{prizeSticker(result.reward,segments).icon}</span><div className="stack stack--tight"><h3>{result.reward.title}</h3><div className="row">{result.reward.coins>0&&<Badge tone="coin">+{coins(result.reward.coins)} {plural(result.reward.coins,"коин","коина","коинов")}</Badge>}</div><p className="secondary">{result.reward.coins?"Награда уже зачислена.":"Спасибо за участие. Следующая попытка будет новой возможностью."}</p></div></div></Card>}
    {prizesOpen&&<Sheet title="Что может выпасть" subtitle="Призы колеса и шанс выпадения каждого" onClose={()=>setPrizesOpen(false)}><PrizeStickers segments={segments} /></Sheet>}
  </div>;
}

function stickerStyle(prize: WheelSpin["reward"], prizes: WheelSpin["segments"], index: number): CSSProperties {
  return { "--sticker": prizeSticker(prize, prizes).color, "--tilt": `${index % 2 ? 4 : -4}deg` } as CSSProperties;
}

/** The prize list as stickers: what can drop, its reward and the chance. */
export function PrizeStickers({ segments }: { segments: WheelSpin["segments"] }) {
  const chances = prizeChances(segments);
  if (!segments.length) return <p className="secondary">Призы колеса ещё не настроены.</p>;
  return <ul className="prize-stickers">{segments.map((item, index) => <li className="prize-sticker-card" key={index}>
    <span className="prize-sticker" style={stickerStyle(item, segments, index)} aria-hidden="true">{prizeSticker(item, segments).icon}</span>
    <strong className="prize-sticker-card__title">{item.title}</strong>
    {item.coins > 0 && <span className="prize-sticker-card__reward">+{coins(item.coins)} {plural(item.coins, "коин", "коина", "коинов")}</span>}
    <span className="prize-sticker-card__chance">Шанс {points(chances[index])}%</span>
  </li>)}</ul>;
}
