import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { games, type WheelSpin } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { SoundIcon, SoundOffIcon } from "../components/icons";
import { Badge, Button, Card, ErrorState, IconButton, RowsSkeleton, SegmentedControl } from "../components/ui";
import { coins, plural, points } from "../utils/format";
import { Raffles, WheelSettings } from "./GamesSettings";
import { PrizeStrip } from "./PrizeStrip";
import { prizeChances, prizeSticker } from "./wheelPrizes";
import "./games.css";
import "./learning.css";

export function GamesPage({ administrative = false }: { administrative?: boolean }) {
  const [params, setParams] = useSearchParams(); const { atLeast } = useAuth();
  const tab = params.get("tab") === "raffles" ? "raffles" : "wheel";
  return <div className="stack games-page"><div className="page-head"><div><h1 className="page-title">{administrative ? "Управление играми" : "Моменты WOW"}</h1><p className="page-subtitle">{administrative ? "Награды и правила участия" : "Небольшие приятные события в рабочем дне"}</p></div>{!administrative && atLeast("supervisor") && <Link className="btn btn--secondary" to="/admin/games">Управление</Link>}</div>{!administrative && atLeast("supervisor") && <SegmentedControl label="Игры" value={tab} options={[{ value:"wheel",label:"Лента удачи" },{ value:"raffles",label:"Розыгрыши" }]} onChange={(value) => setParams({tab:value})} />}{tab === "wheel" ? administrative ? <WheelSettings /> : <Wheel /> : <Raffles administrative={administrative} />}</div>;
}
export function invalidateRewards(client: ReturnType<typeof useQueryClient>) { for (const key of ["wheel","dashboard","wallet","coin-progress", "badges","notifications"]) void client.invalidateQueries({ queryKey:[key] }); }
const MUTE_KEY = "puls:wheel-muted";

function Wheel() {
  const query = useQuery({ queryKey:["wheel"], queryFn:games.wheel });
  const [prizesOpen,setPrizesOpen] = useState(false);
  const [result,setResult] = useState<WheelSpin|null>(null); const [animating,setAnimating] = useState(false);
  const [snapshot,setSnapshot] = useState<WheelSpin["segments"]|null>(null);
  // Запрос на прокрутку: меняется id — лента едет к нужному призу.
  const [request,setRequest] = useState<{id:string;segment:number}|null>(null);
  const [muted,setMuted] = useState(()=>{ try { return localStorage.getItem(MUTE_KEY)==="1"; } catch { return false; } });
  const pending = useRef<WheelSpin|null>(null); const key = useRef<string|null>(null); const client = useQueryClient();

  useEffect(()=>{ try { localStorage.setItem(MUTE_KEY, muted?"1":"0"); } catch { /* приватный режим */ } },[muted]);

  const spin = useMutation({ mutationFn:(paid: boolean)=>{ key.current ??= crypto.randomUUID(); return games.spin(key.current, paid); },onSuccess:(value)=>{
    // Результат придерживаем до остановки ленты: показать награду раньше
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
  // After the free spins, paid ones if the head allowed them: the stake burns (docs/COIN_ECONOMY.md).
  const left=config.free_left??Math.max(0,config.daily_spins-config.used_today);
  const paidLeft=config.paid_left??0, paid=left===0&&paidLeft>0, done=left===0&&!paid;
  return <div className="wheel-layout"><Card className="wheel-card" title="Лента удачи" subtitle="Приз, который остановится в рамке, — ваш"
    action={<><IconButton label={muted?"Включить звук":"Выключить звук"} aria-pressed={muted} onClick={()=>setMuted((on)=>!on)}>{muted?<SoundOffIcon/>:<SoundIcon/>}</IconButton>
      <button type="button" className="wheel-prizes-button" aria-haspopup="dialog" onClick={()=>setPrizesOpen(true)}><span className="wheel-prizes-button__sticker" aria-hidden="true">🎁</span><span>Что может выпасть</span></button></>}>
      <PrizeStrip segments={segments} stickers={segments.map((item)=>prizeSticker(item,segments))} spin={request} muted={muted} onSettled={settled} />
      <div className="wheel-card__foot">
        <Button className="wheel-spin" variant="primary" size="l" disabled={!config.enabled||done||spin.isPending||animating} onClick={()=>spin.mutate(paid)}>{spin.isPending?"Готовим результат…":animating?"Лента крутится…":!config.enabled?"Скоро вернёмся":done?"На сегодня всё":paid?`Крутить за ${coins(config.spin_cost)} ${plural(config.spin_cost,"коин","коина","коинов")}`:"Крутить"}</Button>
        <p className="wheel-card__note">{!config.enabled?"Сейчас лента удачи выключена. Попытки появятся, когда её снова включат.":left>0?<>Бесплатно · осталось {left} из {config.daily_spins}{config.spin_cost>0&&config.paid_spins>0?<> · потом ещё {config.paid_spins} за {coins(config.spin_cost)} {plural(config.spin_cost,"коин","коина","коинов")}</>:null} · попытки обновляются в 00:00 UTC</>:paid?<>Бесплатные попытки на сегодня закончились · платных осталось {paidLeft} из {config.paid_spins}</>:"Попытки обновляются в 00:00 UTC"}</p>
        {spin.isError&&<ErrorState error={spin.error}/>}
      </div>
    </Card>
    {result&&<Card className="wheel-result" variant="highlight" title="Ваш результат"><div role="status" className="wheel-result__body"><span className="prize-sticker prize-sticker--small" style={stickerStyle(result.reward,segments,0)} aria-hidden="true">{prizeSticker(result.reward,segments).icon}</span><div className="wheel-result__text"><div className="wheel-result__head"><h3>{result.reward.title}</h3>{result.reward.coins>0&&<Badge tone="coin">+{coins(result.reward.coins)} {plural(result.reward.coins,"коин","коина","коинов")}</Badge>}</div><p className="secondary">{result.reward.coins?"Награда уже зачислена на ваш счёт.":"Спасибо за участие. Следующая попытка будет новой возможностью."}</p></div></div></Card>}
    {prizesOpen&&<Sheet title="Что может выпасть" subtitle="Призы ленты удачи и шанс выпадения каждого" onClose={()=>setPrizesOpen(false)}><PrizeStickers segments={segments} /></Sheet>}
  </div>;
}

function stickerStyle(prize: WheelSpin["reward"], prizes: WheelSpin["segments"], index: number): CSSProperties {
  return { "--sticker": prizeSticker(prize, prizes).color, "--tilt": `${index % 2 ? 4 : -4}deg` } as CSSProperties;
}

/** The prize list as stickers: what can drop, its reward and the chance. */
export function PrizeStickers({ segments }: { segments: WheelSpin["segments"] }) {
  const chances = prizeChances(segments);
  if (!segments.length) return <p className="secondary">Призы ленты удачи ещё не настроены.</p>;
  return <ul className="prize-stickers">{segments.map((item, index) => <li className="prize-sticker-card" key={index}>
    <span className="prize-sticker" style={stickerStyle(item, segments, index)} aria-hidden="true">{prizeSticker(item, segments).icon}</span>
    <strong className="prize-sticker-card__title">{item.title}</strong>
    {item.coins > 0 && <span className="prize-sticker-card__reward">+{coins(item.coins)} {plural(item.coins, "коин", "коина", "коинов")}</span>}
    <span className="prize-sticker-card__chance">Шанс {points(chances[index])}%</span>
  </li>)}</ul>;
}
