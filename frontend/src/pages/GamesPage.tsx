import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { games, type WheelSpin } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { SoundIcon, SoundOffIcon } from "../components/icons";
import { Badge, Button, Card, ErrorState, IconButton, Progress, RowsSkeleton, SegmentedControl } from "../components/ui";
import { DailyChest } from "./DailyChest";
import { createChestSounds } from "./chestSounds";
import { coins, plural, points } from "../utils/format";
import { Raffles, WheelSettings } from "./GamesSettings";
import { PrizeArt } from "./PrizeArt";
import { PrizeStrip } from "./PrizeStrip";
import { prizeChances, prizeSticker } from "./wheelPrizes";
import "./games.css";
import "./motivation.css";
import "./learning.css";

export function GamesPage({ administrative = false }: { administrative?: boolean }) {
  const [params, setParams] = useSearchParams(); const { atLeast } = useAuth();
  // Raffles stay for the staff who ran them; operators open the chest of the day.
  const tab = administrative && params.get("tab") === "raffles" ? "raffles" : "wheel";
  return <div className="stack games-page"><div className="page-head"><div><h1 className="page-title">Сундук дня</h1><p className="page-subtitle">{administrative ? "Правила и призы ежедневного сундука сотрудников" : "Ответьте на задания дня — и сундук откроется"}</p></div>{!administrative && atLeast("supervisor") && <Link className="btn btn--secondary" to="/admin/games">Управление</Link>}</div>{administrative && <SegmentedControl label="Раздел сундука" value={tab} options={[{ value:"wheel",label:"Сундук дня" },{ value:"raffles",label:"Розыгрыши (архив)" }]} onChange={(value) => setParams({tab:value})} />}{tab === "wheel" ? administrative ? <WheelSettings /> : <Wheel /> : <Raffles administrative={administrative} />}</div>;
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
  const [sounds] = useState(createChestSounds);
  const pending = useRef<WheelSpin|null>(null); const key = useRef<string|null>(null); const client = useQueryClient();

  useEffect(()=>{ try { localStorage.setItem(MUTE_KEY, muted?"1":"0"); } catch { /* приватный режим */ } },[muted]);
  useEffect(()=>()=>sounds.close(),[sounds]);
  useEffect(()=>{ if(muted) sounds.close(); },[muted,sounds]);

  const spin = useMutation({ mutationFn:(paid: boolean)=>{ key.current ??= crypto.randomUUID(); return games.spin(key.current, paid); },onMutate:()=>{
    setResult(null);
  },onSuccess:(value)=>{
    // Результат придерживаем до остановки ленты: показать награду раньше
    // значит обессмыслить саму прокрутку.
    setSnapshot(value.segments); setResult(null); setAnimating(true);
    pending.current = value;
    setRequest({ id: crypto.randomUUID(), segment: value.segment });
  } });

  // Ушли со страницы, пока сундук открывался: награда уже начислена, обновляем баланс и попытки без анимации.
  useEffect(() => () => { if (pending.current) invalidateRewards(client); }, [client]);

  function settled() {
    const value = pending.current;
    pending.current = null;
    setAnimating(false);
    key.current = null;
    if (value) { setResult(value); if(!muted) sounds.reveal(value.reward.coins>0); invalidateRewards(client); }
  }
  if(query.isLoading) return <RowsSkeleton />; if(query.isError) return <ErrorState error={query.error} onRetry={()=>query.refetch()} />;
  const config=query.data!;const segments=snapshot??config.segments;
  // After the free chest, paid ones if the head allowed them: the stake burns (docs/COIN_ECONOMY.md).
  const left=config.free_left??Math.max(0,config.daily_spins-config.used_today);
  const paidLeft=config.paid_left??0, paid=left===0&&paidLeft>0, done=left===0&&!paid;
  const chest=config.chest??{unlocked:true,answered:0,total:0};
  // Выключенный сундук — «на перерыве», а не «сначала задания»: задания его не откроют.
  const locked=config.enabled&&!chest.unlocked;
  const opening=spin.isPending||animating;
  const state=locked?"locked":opening?"opening":result?"open":!config.enabled?"paused":done?"spent":"ready";
  const rewardSticker=result?prizeSticker(result.reward,segments):undefined;
  const cost=`${coins(config.spin_cost)} ${plural(config.spin_cost,"коин","коина","коинов")}`;
  const heading=result?result.reward.title:locked?"Сначала задания. Затем — сюрприз.":opening?"Магия уже внутри…":!config.enabled?"Сундук на перерыве":done?"До встречи завтра!":"Что приготовил ваш сундук?";
  const description=result?result.reward.coins>0?"Награда уже зачислена на ваш счёт. Найдите ей применение в магазине или в своём городе.":paid?"В этот раз без коинов. Можно открыть дополнительный сундук или вернуться завтра.":"Сегодня без коинов. Возвращайтесь за новым сундуком завтра!":locked?"Ответьте на все ситуации дня в «Моём городе», чтобы открыть сундук. Каждый ответ приближает вас к открытию.":opening?"Замок поддаётся. Скоро лента остановится на вашем призе.":!config.enabled?"Открытие временно недоступно. Загляните сюда чуть позже.":done?"Сегодняшние сундуки уже открыты. Новый шанс будет ждать вас на следующий день.":"Один поворот ключа — и сюрприз ваш. Внутри могут оказаться коины для новых покупок и построек.";
  return <div className="wheel-layout"><Card className="wheel-card chest-card" tour="chest" title="Сундук дня" subtitle="Ваш маленький ежедневный ритуал"
    action={<><IconButton label={muted?"Включить звук":"Выключить звук"} aria-pressed={muted} onClick={()=>setMuted((on)=>!on)}>{muted?<SoundOffIcon/>:<SoundIcon/>}</IconButton>
      <button type="button" className="wheel-prizes-button" aria-haspopup="dialog" onClick={()=>setPrizesOpen(true)}><span className="wheel-prizes-button__sticker" aria-hidden="true"><PrizeArt kind="gift" /></span><span>Что внутри</span></button></>}>
      <div className="chest-hero" data-state={state} aria-busy={opening}>
        <div className="chest-hero__content">
          <span className="chest-hero__eyebrow"><span aria-hidden="true">✦</span> {result?"Сундук открыт":locked?"Награда за задания":opening?"Открываем сундук":!config.enabled?"Скоро вернёмся":done?"На сегодня всё":paid?"Дополнительный сундук":"Бесплатный сундук"}</span>
          <div className="chest-hero__message" role="status" aria-atomic="true">
            <h3 className="chest-hero__title">{heading}</h3>
            {result&&result.reward.coins>0&&<Badge tone="coin">+{coins(result.reward.coins)} {plural(result.reward.coins,"коин","коина","коинов")}</Badge>}
            <p className="chest-hero__description">{description}</p>
          </div>
          {locked ? <div className="chest-progress">
          <strong>Задания дня: {chest.answered} из {chest.total}</strong>
          <Progress value={chest.total ? chest.answered / chest.total : 0} label="Задания дня" />
          <Link className="btn btn--primary btn--l" to="/training/city?open=quests">Ответить на задания</Link>
          <p className="wheel-card__note">Засчитывается каждый ответ, даже если он неверный.</p>
        </div> : <div className="wheel-card__foot">
        <Button className="wheel-spin" variant="primary" size="l" disabled={!config.enabled||done||opening||query.isFetching} onClick={()=>{ if(!muted) sounds.unlock(); spin.mutate(paid); }}>{opening?"Сундук открывается…":result&&query.isFetching?"Обновляем попытки…":!config.enabled?"Скоро вернёмся":done?"На сегодня всё":paid?`Ещё сундук за ${cost}`:"Открыть сундук"}</Button>
        <p className="wheel-card__note">{!config.enabled?"Сундук дня сейчас выключен.":left>0?<>Бесплатный сундук ждёт вас{config.spin_cost>0&&config.paid_spins>0?<> · потом ещё {config.paid_spins} за {cost}</>:null} · новый сундук — завтра</>:paid?<>Бесплатный сундук на сегодня открыт · дополнительных осталось {paidLeft} из {config.paid_spins}</>:"Новый сундук — завтра"}</p>
        {spin.isError&&<ErrorState error={spin.error}/>}
        </div>}
        </div>
        <DailyChest state={state} reward={rewardSticker} celebrate={!!result&&result.reward.coins>0} />
      </div>
      {!locked && <div className="chest-prizes">
        <div className="chest-prizes__head"><strong>{opening?"Сейчас всё узнаем…":result?"Ваш приз под указателем":"Что может оказаться внутри"}</strong><span>{opening?"Открытие":result?"Готово":"Случайный приз"}</span></div>
        <PrizeStrip segments={segments} stickers={segments.map((item)=>prizeSticker(item,segments))} spin={request} muted={muted} onTick={sounds.tick} onSettled={settled} />
      </div>}
    </Card>
    {prizesOpen&&<Sheet title="Что может быть в сундуке" subtitle="Призы и шанс каждого" onClose={()=>setPrizesOpen(false)}><PrizeStickers segments={segments} /></Sheet>}
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
    <span className="prize-sticker" data-kind={prizeSticker(item, segments).kind} style={stickerStyle(item, segments, index)} aria-hidden="true"><PrizeArt kind={prizeSticker(item, segments).kind} /></span>
    <strong className="prize-sticker-card__title">{item.title}</strong>
    {item.coins > 0 && <span className="prize-sticker-card__reward">+{coins(item.coins)} {plural(item.coins, "коин", "коина", "коинов")}</span>}
    <span className="prize-sticker-card__chance">Шанс {points(chances[index])}%</span>
  </li>)}</ul>;
}
