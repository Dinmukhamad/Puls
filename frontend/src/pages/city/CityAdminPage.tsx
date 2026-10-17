import { CityWorldEditor } from "./CityWorldEditor";
import { CitySeasonsAdmin } from "./CitySeasonsAdmin";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, type CityEconomy, type CitySettings, type CitySituation, type CitySituations } from "../../api/city";
import { ApiError } from "../../api/client";
import { cityEstate } from "../../api/cityEstate";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, KPI, Pagination, SegmentedControl, Select, Skeleton, type Tone } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { coins, plural } from "../../utils/format";
import { FormFooter, FormStatus, Switch } from "./CityAdminControls";
import { decorEconomyName, estateRows, plotEconomyName } from "./plotCatalogue";

/** Dispatch calls cannot exceed the server's curriculum. */
const DISPATCH_TARGETS: Record<string, number> = { dispatch_driver: 2, dispatch_car: 1, dispatch_inventory: 1, dispatch_support: 1, dispatch_limit: 3 };
type CityAdminTab = "participants" | "economy" | "situations" | "settings" | "world" | "estates" | "seasons";
const CITY_ADMIN_TABS: CityAdminTab[] = ["participants", "economy", "situations", "settings", "world", "estates", "seasons"];

export function CityAdminPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const canEdit = ["trainer", "head", "admin"].includes(user?.role ?? "");
  const requested = params.get("tab") as CityAdminTab | null;
  const tab: CityAdminTab = requested && CITY_ADMIN_TABS.includes(requested) ? requested : ["head", "admin"].includes(user?.role ?? "") ? "world" : "participants";
  const settings = useQuery({ queryKey:["city-settings"], queryFn:city.settings, enabled:tab === "settings", refetchOnWindowFocus:false });
  const tabs: { value: CityAdminTab; label: string }[] = [
    { value: "world", label: "Города и районы" }, { value: "estates", label: "Стройка районов" }, { value: "seasons", label: "Сезоны и история" }, { value: "participants", label: "Прогресс операторов" },
    { value: "situations", label: "Ситуации дня" }, { value: "economy", label: "Экономика игры" },
    { value: "settings", label: canEdit ? "Настроить миссии" : "Условия миссий" },
  ];
  // The tab lives in the address, so a reload or a shared link opens the same section.
  const select = (next: CityAdminTab) => setParams(current => { const query = new URLSearchParams(current); query.set("tab", next); return query; }, { replace: true });
  // On a narrow screen the row of sections scrolls; the open one is always in sight.
  const tabRow = useRef<HTMLDivElement>(null);
  useEffect(() => { tabRow.current?.querySelector(".segmented__item.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [tab]);
  return <div className="stack city-admin">
    <div className="page-head"><div><h1 className="page-title">Управление городом</h1><p className="page-subtitle">Назначайте команды районов, настраивайте миссии и следите за прогрессом.</p></div><div className="page-head__actions"><Link className="btn btn--secondary btn--m" to="/training/city">Открыть город</Link></div></div>
    <div className="city-admin-tabs" ref={tabRow}><SegmentedControl label="Разделы управления городом" options={tabs} value={tab} onChange={select} /></div>
    {tab==='world'?<CityWorldEditor isHead={user?.role === "head"} />:tab==='estates'?<Estates />:tab==='seasons'?<CitySeasonsAdmin />:tab==='participants'?<Participants />:tab==='economy'?<Economy />:tab==='situations'?<Situations />:settings.data?<MissionEditor initial={settings.data} canEdit={canEdit} />:settings.isError?<ErrorState error={settings.error} onRetry={()=>settings.refetch()} />:<Skeleton height={350} />}
  </div>;
}

const ROUTE_LEGEND: [string, string][] = [["completed", "Пройдено — награда получена"], ["ready", "Готово к завершению"], ["open", "В работе или впереди"]];

function Participants() {
  const [search,setSearch]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1);
  useEffect(()=>{const timer=setTimeout(()=>{setQ(search);setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  const query=useQuery({queryKey:['city-participants',q,page],queryFn:()=>city.participants(q,page),refetchInterval:30000,placeholderData:keepPreviousData});
  return <div className="stack stack--tight">
    <Card padded>
      <div className="city-admin-search">
        <label className="field"><span className="field__label">Найти оператора</span><input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Имя или логин" maxLength={100}/></label>
        <ul className="city-admin-legend" aria-label="Обозначения шкалы миссий">{ROUTE_LEGEND.map(([state,label])=><li key={state}><span data-state={state} aria-hidden="true"/>{label}</li>)}</ul>
      </div>
    </Card>
    {query.isError&&<ErrorState error={query.error} onRetry={()=>query.refetch()}/>}{query.isPending&&<Skeleton height={250}/>}
    {query.data&&<Card className={query.isPlaceholderData?'city-admin-refreshing':undefined} title="Операторы" subtitle={`${query.data.total} ${plural(query.data.total,'оператор','оператора','операторов')}${q?' по запросу':''}`} padded={false}>
      {query.data.items.length ? <ul className="city-admin-people">{query.data.items.map(p=><li className="city-admin-person" key={p.user_id}>
        <div className="city-admin-person__who"><strong>{p.full_name}</strong><span>{p.login} · уровень {p.level} · {p.xp} XP</span><span>{p.orders} {plural(p.orders,'заказ','заказа','заказов')} · {p.appeals} {plural(p.appeals,'обращение','обращения','обращений')}</span></div>
        <div className="city-admin-person__progress">
          <div className="city-admin-route" role="img" aria-label={p.missions.map(m=>`${m.title}: ${MISSION_STATES[m.state]}, ${m.current} из ${m.target}`).join('; ')}>{p.missions.map(m=><span key={m.key} data-state={m.state} title={`${m.title}: ${MISSION_STATES[m.state]}`} />)}</div>
          <span>Пройдено <b>{p.completed} из {p.total}</b>{p.ready?` · готово к завершению ${p.ready}`:''}</span>
        </div>
        <Link className="btn btn--secondary btn--s" to={`/training/city?operator=${p.user_id}`}>Открыть путь</Link>
      </li>)}</ul> : <EmptyState title="Операторы не найдены" hint="Попробуйте другое имя или логин."/>}
      <div className="city-admin-pagination"><Pagination page={page} size={query.data.size} total={query.data.total} onChange={setPage}/></div>
    </Card>}
  </div>;
}

const SLOTS = 3;
/** Who asks decides where the situation waits on the map: the depot's taxi, the CRM centre or the guide. */
const speakerIcon = (speaker: string) => /водител/i.test(speaker) ? "🚕" : /клиент|звонящ/i.test(speaker) ? "📞" : "💡";
const newSituation = (): CitySituation => ({ id: `own-${Date.now().toString(36)}`, speaker: "Водитель", text: "", options: ["", ""], correct: 0, explanation: "", enabled: true });

/** The daily situations' own set: trainers, the head and the admin create and edit them in a dialog; supervisors read them. */
function Situations() {
  const client=useQueryClient();
  const toast=useToast();
  const query=useQuery({queryKey:['city-situations'],queryFn:city.situations,refetchOnWindowFocus:false});
  const [editing,setEditing]=useState<{item:CitySituation;isNew:boolean}|null>(null),[removing,setRemoving]=useState<CitySituation|null>(null);
  // Every change is saved at once; the answer counts are read again with it.
  const save=useMutation({
    mutationFn:(items:CitySituation[])=>city.saveSituations({revision:query.data?.revision??0,items}),
    onSuccess:data=>{client.setQueryData<CitySituations>(['city-situations'],current=>current&&{...current,...data});void client.invalidateQueries({queryKey:['city-situations']});},
    onError:error=>{if(error instanceof ApiError&&error.status===409)void client.invalidateQueries({queryKey:['city-situations']});},
  });
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!query.data)return <Skeleton height={350}/>;
  const {items,can_edit:canEdit=false,answered={},exhausted=0}=query.data;
  const enabled=items.filter(i=>i.enabled).length;
  // A day needs three situations: the last three enabled ones cannot be switched off or deleted.
  const locked=(item:CitySituation)=>item.enabled&&enabled<=SLOTS;
  const persist=(next:CitySituation[],done:string,then?:()=>void)=>save.mutate(next,{onSuccess:()=>{toast.success(done);then?.();}});
  function open(item:CitySituation,isNew=false){save.reset();setEditing({item:structuredClone(item),isNew});}
  return <div className="stack">
    <p className="ui-note">Каждый день оператор получает до {SLOTS} ситуаций из этого набора. Ситуацию, на которую он уже ответил, верно или нет, он больше не получит. Когда пройдены все включённые, заданий дня нет, пока вы не добавите новые. Изменения действуют с новых заданий: сегодняшние уже розданы.{canEdit?'':' Менять ситуации могут тренер, руководитель и администратор.'}</p>
    {exhausted>0&&<p className="ui-note city-admin-alert" role="status">У {exhausted} {plural(exhausted,'оператора','операторов','операторов')} не осталось новых ситуаций. Добавьте ситуации, чтобы им снова приходили задания дня.</p>}
    <Card title="Ситуации дня" subtitle={`Включено ${enabled} из ${items.length} · в день — до ${SLOTS}`} action={canEdit?<Button variant="primary" disabled={save.isPending} onClick={()=>open(newSituation(),true)}>+ Новая ситуация</Button>:undefined} padded={false}>
      {items.length?<ol className="city-admin-situations">{items.map((item,index)=>{const count=answered[item.id]??0;return <li key={item.id} className={item.enabled?undefined:'is-off'}>
        <span className="city-admin-situations__icon" aria-hidden="true">{speakerIcon(item.speaker)}</span>
        <div className="city-admin-situations__body">
          <div className="city-admin-situations__title"><strong>{index+1}. {item.speaker||'Ситуация'}</strong>{!item.enabled&&<Badge>Выключена</Badge>}</div>
          <p className="city-admin-situations__text">{item.text}</p>
          <span className="city-admin-situations__facts">{item.options.length} {plural(item.options.length,'вариант','варианта','вариантов')} ответа · {count?`прошли ${count} ${plural(count,'оператор','оператора','операторов')}`:'ещё никто не проходил'}</span>
        </div>
        <div className="city-admin-situations__actions">{canEdit?<>
          <Switch checked={item.enabled} disabled={save.isPending||locked(item)} onChange={on=>persist(items.map(i=>i.id===item.id?{...i,enabled:on}:i),on?'Ситуация включена':'Ситуация выключена')}>В заданиях<span className="sr-only">: ситуация {index+1}</span></Switch>
          <Button size="s" aria-label={`Изменить ситуацию ${index+1}`} disabled={save.isPending} onClick={()=>open(item)}>Изменить</Button>
          <Button size="s" variant="destructive" aria-label={`Удалить ситуацию ${index+1}`} disabled={save.isPending||locked(item)} onClick={()=>{save.reset();setRemoving(item);}}>Удалить</Button>
        </>:<Button size="s" aria-label={`Открыть ситуацию ${index+1}`} onClick={()=>open(item)}>Открыть</Button>}</div>
      </li>;})}</ol>:<EmptyState title="Ситуаций пока нет" hint={canEdit?'Создайте первую ситуацию.':undefined}/>}
    </Card>
    {canEdit&&enabled<=SLOTS&&<p className="field__note">Включено {enabled} — столько выдаётся в день. Чтобы выключить или удалить ситуацию, сначала добавьте или включите другую.</p>}
    {!editing&&!removing&&save.isError&&<FormStatus error={save.error}/>}
    {editing&&<SituationDialog initial={editing.item} isNew={editing.isNew} readOnly={!canEdit} canSwitchOff={editing.isNew||!locked(editing.item)} pending={save.isPending} error={save.isError?save.error:null} onClose={()=>setEditing(null)}
      onSave={item=>persist(editing.isNew?[...items,item]:items.map(i=>i.id===item.id?item:i),editing.isNew?'Ситуация создана':'Ситуация сохранена',()=>setEditing(null))}/>}
    {removing&&<Sheet title="Удалить ситуацию?" size="s" onClose={()=>{if(!save.isPending)setRemoving(null);}} footer={<><Button disabled={save.isPending} onClick={()=>setRemoving(null)}>Отмена</Button><Button variant="destructive" disabled={save.isPending} onClick={()=>persist(items.filter(i=>i.id!==removing.id),'Ситуация удалена',()=>setRemoving(null))}>{save.isPending?'Удаляем…':'Удалить'}</Button></>}>
      <div className="stack stack--tight"><p>«{removing.text}»</p><p className="field__note">Операторы, которые на неё уже ответили, сохранят ответы и коины. Новым она больше не придёт.</p>{save.isError&&<FormStatus error={save.error}/>}</div>
    </Sheet>}
  </div>;
}

/** One situation in a dialog: who asks, what happened, the answers with the right one, and why. */
function SituationDialog({initial,isNew,readOnly,canSwitchOff,pending,error,onClose,onSave}:{initial:CitySituation;isNew:boolean;readOnly:boolean;canSwitchOff:boolean;pending:boolean;error:unknown;onClose:()=>void;onSave:(item:CitySituation)=>void}) {
  const [item,setItem]=useState(initial);
  const formId=useId();
  const change=(patch:Partial<CitySituation>)=>setItem(current=>({...current,...patch}));
  const close=()=>{if(!pending)onClose();};
  return <Sheet title={readOnly?'Ситуация дня':isNew?'Новая ситуация дня':'Изменить ситуацию'} subtitle={readOnly?undefined:'Действует с новых заданий дня'} onClose={close}
    footer={readOnly?<Button onClick={onClose}>Закрыть</Button>:<><Button disabled={pending} onClick={close}>Отмена</Button><Button type="submit" form={formId} variant="primary" disabled={pending}>{pending?'Сохраняем…':isNew?'Создать ситуацию':'Сохранить'}</Button></>}>
    <form id={formId} className="stack city-admin-dialog" onSubmit={e=>{e.preventDefault();if(!readOnly)onSave(item);}}>
      <fieldset className="city-admin-fieldset" disabled={readOnly||pending}>
        <label className="field"><span className="field__label">Кто обращается</span><input className="input" list={`${formId}-speakers`} maxLength={60} value={item.speaker} onChange={e=>change({speaker:e.target.value})} placeholder="Водитель, Клиент…"/><datalist id={`${formId}-speakers`}><option value="Водитель"/><option value="Клиент"/></datalist><span className="field__note">«Водитель» ждёт у такси автопарка, «Клиент» — у CRM-центра, остальные — у помощника.</span></label>
        <label className="field"><span className="field__label">Что случилось</span><textarea className="input" rows={3} minLength={5} maxLength={1000} required value={item.text} onChange={e=>change({text:e.target.value})}/></label>
        <fieldset className="city-admin-options"><legend className="field__label">Варианты ответа — отметьте верный</legend>
          {item.options.map((o,k)=><div key={k} className={`city-admin-option${item.correct===k?' is-correct':''}`}>
            <input type="radio" name={`${formId}-correct`} aria-label={`Вариант ${k+1} верный`} checked={item.correct===k} onChange={()=>change({correct:k})}/>
            <input className="input" maxLength={300} required value={o} onChange={e=>change({options:item.options.map((x,j)=>j===k?e.target.value:x)})} placeholder={`Вариант ${k+1}`}/>
            {item.options.length>2&&<IconButton label={`Убрать вариант ${k+1}`} onClick={()=>change({options:item.options.filter((_,j)=>j!==k),correct:item.correct===k?0:item.correct>k?item.correct-1:item.correct})}>×</IconButton>}
          </div>)}
          {item.options.length<6&&<div className="city-admin-options__add"><Button size="s" onClick={()=>change({options:[...item.options,'']})}>+ Вариант</Button></div>}
        </fieldset>
        <label className="field"><span className="field__label">Пояснение после ответа</span><textarea className="input" rows={3} maxLength={1000} value={item.explanation} onChange={e=>change({explanation:e.target.value})}/></label>
        <Switch checked={item.enabled} disabled={item.enabled&&!canSwitchOff} onChange={value=>change({enabled:value})} hint={item.enabled&&!canSwitchOff?`Включено ${SLOTS} ситуации — столько выдаётся в день`:undefined}>Ситуация участвует в заданиях дня</Switch>
      </fieldset>
      {error?<FormStatus error={error}/>:null}
    </form>
  </Sheet>;
}

/** One numeric setting: the label above, the value in the site's field. */
function NumberField({ label, value, min, max, onChange }: { label: ReactNode; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="field"><span className="field__label">{label}</span><input className="input" type="number" inputMode="numeric" min={min} max={max} required value={value} onChange={e=>onChange(Math.max(0,Math.round(Number(e.target.value)||0)))}/></label>;
}

type EconomyKey = "prices" | "quests" | "land" | "estate" | "decor" | "district" | "hq";
/** Where each section lives in the settings: a save sends it over the latest values of the rest. */
const ECONOMY_FIELD: Record<EconomyKey, keyof CityEconomy> = { prices: "prices", quests: "quest_coins", land: "land", estate: "estate", decor: "decor", district: "district", hq: "hq" };
/** One number of the game: how it reads, its limits, and how it lands in the settings. */
interface EconomyValue { key: string; label: ReactNode; value: number; min: number; max: number; set: (draft: CityEconomy, value: number) => CityEconomy }
interface EconomySection { key: EconomyKey; title: string; subtitle: string; note?: string; groups: { key: string; title?: string; values: EconomyValue[] }[] }

/** The game's numbers by section, read from one set of settings: the page shows them, a dialog edits them. */
function economySections(e: CityEconomy): EconomySection[] {
  const levelName = (family: string, i: number) => (family === 'park' || family === 'bigpark') && i === 0 ? 'сбор из скверов (0 — бесплатно)' : i === 0 ? 'покупка' : `ступень ${i + 1}`;
  const sections: EconomySection[] = [
    { key: 'prices', title: 'Цены построек', subtitle: 'Коинов за покупку в учебном районе', groups: [{ key: 'all', values: (e.catalogue ?? []).map(b => ({ key: b.key, label: <><span aria-hidden="true">{b.icon}</span>{b.name}</>, value: e.prices[b.key], min: 1, max: 100000, set: (d, v) => ({ ...d, prices: { ...d.prices, [b.key]: v } }) })) }] },
    { key: 'quests', title: 'Задания дня', subtitle: 'Награда за ситуацию дня', groups: [{ key: 'all', values: [{ key: 'coins', label: 'Коинов за верный ответ', value: e.quest_coins, min: 0, max: 1000, set: (d, v) => ({ ...d, quest_coins: v }) }] }] },
  ];
  if (e.land) sections.push({ key: 'land', title: 'Стоимость земли по зонам', subtitle: 'Коинов за одну клетку земли под постройкой', note: 'Зоны идут от центра города к окраине: земля у центра дороже. Постройка платит за каждую свою клетку: дом — за 9 (3 × 3), сквер и офис — за 4 (2 × 2); это добавляется к цене постройки. Все зоны района доступны сразу; они различаются только ценой земли. В ОП три зоны — используются первые три цены. У дорог, деревьев и фонарей земля уже входит в цену клетки.',
    groups: [{ key: 'all', values: e.land.map((price, i) => ({ key: String(i), label: `Зона ${i + 1}${i === 0 ? ' · у центра' : i === e.land!.length - 1 ? ' · окраина' : ''}`, value: price, min: 0, max: 100000, set: (d, v) => ({ ...d, land: d.land!.map((x, j) => j === i ? v : x) }) })) }] });
  if (e.estate) sections.push({ key: 'estate', title: 'Районы команд: дома, офисы и скверы', subtitle: 'Коинов за ступень', note: 'Дома и готовые дома занимают 3 × 3 клетки, скверы и офисные здания — 2 × 2, парк — 4 × 4, большой парк — 6 × 4. Первая ступень сквера и дома — покупка (вместе с землёй под ней), следующие — улучшения. Готовые дома и офисные здания покупаются целиком, по одной цене. Чем больше этажей и площадь дома, есть ли гараж и терраса — тем дороже. Парк и большой парк не покупаются: их собирают свои скверы, первая ступень — сбор (0 — бесплатно). Купленное не дорожает: новые цены действуют для новых операций, а открытая страница стройки попросит подтвердить новую цену.',
    groups: estateRows(e.estate).map(row => ({ key: row.key, title: row.title ?? plotEconomyName(row.families[0]), values: row.families.flatMap(family => e.estate![family].map((price, i) => {
      const gathered = (family === 'park' || family === 'bigpark') && i === 0;
      return { key: `${family}-${i}`, label: row.title ? plotEconomyName(family) : levelName(family, i), value: price, min: gathered ? 0 : 1, max: 100000, set: (d: CityEconomy, v: number) => ({ ...d, estate: { ...d.estate, [family]: d.estate![family].map((x, j) => j === i ? v : x) } }) };
    })) })) });
  if (e.decor) sections.push({ key: 'decor', title: 'Дороги и благоустройство', subtitle: 'Коинов за клетку', note: 'Дорога, дорожка, аллея, деревья, фонарь, скамейка и другие мелкие постройки занимают одну клетку; цена включает землю. Оператор может убрать то, что поставил сам, — коины вернутся полностью. 0 — бесплатно.',
    groups: [{ key: 'all', values: Object.entries(e.decor).map(([family, price]) => ({ key: family, label: decorEconomyName(family), value: price, min: 0, max: 100000, set: (d: CityEconomy, v: number) => ({ ...d, decor: { ...d.decor, [family]: v } }) })) }] });
  if (e.district) sections.push({ key: 'district', title: 'Общие проекты района', subtitle: 'Смета ступени, коинов', note: 'Смета фиксируется при открытии проекта; новая цена не переписывает уже открытые сборы.',
    groups: Object.entries(e.district).map(([family, levels]) => ({ key: family, title: PROJECT_NAMES[family] ?? family, values: levels.map((cost, i) => ({ key: String(i), label: `ступень ${i + 1}`, value: cost, min: 1, max: 100000, set: (d: CityEconomy, v: number) => ({ ...d, district: { ...d.district, [family]: d.district![family].map((x, j) => j === i ? v : x) } }) })) })) });
  if (e.hq) sections.push({ key: 'hq', title: 'Учёт прежних общих проектов', subtitle: 'Пороги ступеней', note: 'Ступени по возрастанию. Эти пороги относятся к прежним общим проектам. Главное здание района растёт автоматически при застройке 10, 25, 50 и 75 % всей земли.',
    groups: [{ key: 'all', values: e.hq.map((need, i) => ({ key: String(i), label: `Ступень ${i + 2}`, value: need, min: 1, max: 1000, set: (d, v) => ({ ...d, hq: d.hq!.map((x, j) => j === i ? v : x) }) })) }] });
  return sections;
}

/** The game's numbers at a glance; the head and the admin change one section at a time in a dialog. */
function Economy() {
  const client=useQueryClient();
  const toast=useToast();
  const query=useQuery({queryKey:['city-economy'],queryFn:city.economy,refetchOnWindowFocus:false});
  const [editing,setEditing]=useState<EconomyKey|null>(null);
  const save=useMutation({
    mutationFn:city.saveEconomy,
    onSuccess:async data=>{client.setQueryData<CityEconomy>(['city-economy'],current=>current&&{...current,...data});await client.invalidateQueries({queryKey:['city']});},
    onError:error=>{if(error instanceof ApiError&&error.status===409)void client.invalidateQueries({queryKey:['city-economy']});},
  });
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!query.data)return <Skeleton height={350}/>;
  const economy=query.data,canEdit=!!economy.can_edit,sections=economySections(economy);
  const section=sections.find(s=>s.key===editing);
  return <div className="stack">
    <p className="ui-note">Цены и награда за задание действуют для новых покупок и ответов: уже построенное остаётся по цене покупки.{canEdit?'':' Менять настройки могут руководитель и администратор.'}</p>
    {sections.map(s=><Card key={s.key} className="city-admin-economy-card" title={s.title} subtitle={s.subtitle} action={canEdit?<Button size="s" aria-label={`Изменить: ${s.title}`} disabled={save.isPending} onClick={()=>{save.reset();setEditing(s.key);}}>Изменить</Button>:undefined}>
      <div className="city-admin-strips">{s.groups.map(g=><section key={g.key}>
        {s.groups.length>1&&g.title&&<h3 className="city-admin-subtitle">{g.title}</h3>}
        <dl className="city-admin-strip">{g.values.map(v=><div key={v.key}><dt>{v.label}</dt><dd>{coins(v.value)}</dd></div>)}</dl>
      </section>)}</div>
    </Card>)}
    {section&&<EconomyDialog key={section.key} section={section.key} economy={economy} pending={save.isPending} error={save.isError?save.error:null} onClose={()=>setEditing(null)}
      onSave={next=>save.mutate({...economy,[ECONOMY_FIELD[section.key]]:next[ECONOMY_FIELD[section.key]]},{onSuccess:()=>{toast.success(`Сохранено: ${section.title}`);setEditing(null);}})}/>}
  </div>;
}

/** One section of the game's numbers in a dialog; the rest of the settings go back as they were. */
function EconomyDialog({section,economy,pending,error,onClose,onSave}:{section:EconomyKey;economy:CityEconomy;pending:boolean;error:unknown;onClose:()=>void;onSave:(next:CityEconomy)=>void}) {
  const [draft,setDraft]=useState(()=>structuredClone(economy));
  const formId=useId();
  const current=economySections(draft).find(s=>s.key===section)!;
  const close=()=>{if(!pending)onClose();};
  return <Sheet title={current.title} subtitle={current.subtitle} size={section==='estate'?'l':'m'} onClose={close}
    footer={<><Button disabled={pending} onClick={close}>Отмена</Button><Button type="submit" form={formId} variant="primary" disabled={pending}>{pending?'Сохраняем…':'Сохранить'}</Button></>}>
    <form id={formId} className="stack city-admin-dialog" onSubmit={e=>{e.preventDefault();onSave(draft);}}>
      {current.note&&<p className="city-admin-card-note">{current.note}</p>}
      <fieldset className="city-admin-fieldset" disabled={pending}>
        {current.groups.map(g=><section key={g.key} className="city-admin-dialog__group">
          {current.groups.length>1&&g.title&&<h3 className="city-admin-subtitle">{g.title}</h3>}
          <div className="city-admin-grid">{g.values.map(v=><NumberField key={v.key} label={v.label} value={v.value} min={v.min} max={v.max} onChange={value=>setDraft(d=>v.set(d,value))}/>)}</div>
        </section>)}
      </fieldset>
      {error?<FormStatus error={error}/>:null}
    </form>
  </Sheet>;
}

const PROJECT_NAMES:Record<string,string>={square:'🌳 Сквер',gazebo:'🌷 Беседка',fountain:'⛲ Площадь с фонтаном',sports:'🏀 Спортплощадка',park:'🏞️ Парк на площади'};

/** Staff only: land, buildings and shared projects per district, and what the old plots hold before their transfer. */
function Estates() {
  const query=useQuery({queryKey:['city-estates-report'],queryFn:cityEstate.report,refetchInterval:30000});
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!query.data)return <Skeleton height={250}/>;
  const r=query.data;
  const rows=r.districts.map(d=>({ ...d,
    cityName:d.city==='sales'?'ОП':'Техподдержка',
    status:!d.land?{tone:'neutral' as Tone,label:'Нет земли'}:d.construction?{tone:'success' as Tone,label:'Открыта'}:{tone:'neutral' as Tone,label:'Закрыта'},
    people:`${d.operators}${d.builders?` · строят ${d.builders}`:''}`,
    taken:d.land?`${d.land.taken} / ${d.land.cells}`:'—',
    free:d.land?String(Math.max(0,d.land.cells-d.land.taken)):'—',
    landmark:d.land?`${d.landmark_level} из 5`:'—',
  }));
  return <div className="stack">
    <p className="ui-note">Стройку включает руководитель во вкладке «Города и районы». После этого операторы команды сами планируют весь район: прокладывают дороги, сажают деревья, ставят фонари, дома и офисы на свободных клетках. Главное здание в центре улучшается автоматически при застройке 10, 25, 50 и 75 % всей земли домами, офисами и скверами.</p>
    <Card title="Районы команд" subtitle={`${rows.length} ${plural(rows.length,'район','района','районов')}`} padded={false}>
      <div className="table-wrap table-wrap--responsive city-admin-table"><table className="table">
        <thead><tr><th>Район</th><th>Стройка</th><th className="num">Операторы</th><th className="num">Занято клеток</th><th className="num">Свободно</th><th className="num">Постройки</th><th className="num">Сборы</th><th className="num">Главное здание</th></tr></thead>
        <tbody>{rows.map(d=><tr key={d.id}><td><strong>{d.name}</strong><span className="city-admin-muted"> · {d.cityName}</span></td><td><Badge tone={d.status.tone}>{d.status.label}</Badge></td><td className="num">{d.people}</td><td className="num">{d.taken}</td><td className="num">{d.free}</td><td className="num">{d.buildings}</td><td className="num">{d.open_projects}</td><td className="num nowrap">{d.landmark==='—'?'—':`Уровень ${d.landmark}`}</td></tr>)}</tbody>
      </table></div>
      <div className="card__body"><ul className="card-list">{rows.map(d=><li className="list-card" key={d.id}>
        <div className="list-card__head"><span><strong>{d.name}</strong><span className="city-admin-muted"> · {d.cityName}</span></span><Badge tone={d.status.tone}>{d.status.label}</Badge></div>
        <dl className="list-card__metrics city-admin-metrics">
          <div className="list-card__metric"><dt>Операторы</dt><dd>{d.people}</dd></div>
          <div className="list-card__metric"><dt>Занято клеток</dt><dd>{d.taken}</dd></div>
          <div className="list-card__metric"><dt>Свободно</dt><dd>{d.free}</dd></div>
          <div className="list-card__metric"><dt>Постройки</dt><dd>{d.buildings}</dd></div>
          <div className="list-card__metric"><dt>Сборы</dt><dd>{d.open_projects}</dd></div>
          <div className="list-card__metric"><dt>Главное здание</dt><dd>{d.landmark}</dd></div>
        </dl>
      </li>)}</ul></div>
    </Card>
    <div className="kpi-grid">
      <KPI label="Операторов без района" value={r.operators_without_district} hint="Их команда не закреплена за районом"/>
      <KPI label="Построек в инвентаре" value={r.inventory} hint="Остались после перевода в другой район"/>
      <KPI label="Потрачено на стройку" value={coins(r.coins.buildings)} tone="coin" hint="Участки и постройки, коинов"/>
      <KPI label="Взносы в проекты" value={coins(r.coins.contributions)} hint={`Возвращено ${coins(r.coins.refunded)} коинов`}/>
    </div>
    <p className="ui-note">Прежние постройки на участках учебных центров: {r.legacy.buildings} у {r.legacy.operators} {plural(r.legacy.operators,'оператора','операторов','операторов')}, оплачено {coins(r.legacy.paid)} коинов. Они остаются на месте; перенос в районы — отдельный этап со сверкой и без повторной оплаты.</p>
  </div>;
}

function MissionEditor({initial,canEdit}:{initial:CitySettings;canEdit:boolean}) {
  const client=useQueryClient();
  const [draft,setDraft]=useState(()=>structuredClone(initial)),[selected,setSelected]=useState('welcome'),[saved,setSaved]=useState(false);
  const mutation=useMutation({mutationFn:city.save,onSuccess:async data=>{setDraft(data);setSaved(true);client.setQueryData(['city-settings'],data);await client.invalidateQueries({queryKey:['city']});await client.invalidateQueries({queryKey:['city-participants']});}});
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial)&&!saved;
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const mission=draft.missions[selected];
  const scenario=selected.startsWith('scenario_');
  const crmExercise=['crm_first','crm_phone','crm_closed'].includes(selected);
  function change(patch:Partial<typeof mission>){setSaved(false);setDraft(d=>({...d,missions:{...d.missions,[selected]:{...d.missions[selected],...patch}}}));}
  const missionOptions=Object.entries(draft.missions).map(([key,m])=>({value:key,label:m.title}));
  const prerequisites=[{value:'',label:'Без предыдущего задания'},...Object.entries(draft.missions).filter(([key])=>key!==selected&&!key.startsWith('scenario_')).map(([key,m])=>({value:key,label:m.title}))];
  return <form className="stack" onSubmit={e=>{e.preventDefault();if(canEdit)mutation.mutate(draft);}}>
    <p className="ui-note">Уже полученные награды и опыт сохраняются. Новые условия применяются к непройденным миссиям. Цели проверяются по данным CRM, Driver Simulator и учебной Диспетчерской: в Диспетчерской цель — число решённых звонков. Сценарии доступны только техподдержке; их результат проверяет тренажёр диалога и практики.</p>
    <Card title="Миссия" subtitle={`${missionOptions.length} ${plural(missionOptions.length,'миссия','миссии','миссий')} города`}>
      <label className="field city-admin-field-narrow"><span className="field__label">Выберите миссию</span><Select aria-label="Миссия" value={selected} options={missionOptions} onChange={setSelected}/></label>
    </Card>
    <Card title={mission.title} action={<Badge tone={mission.enabled?'success':'neutral'}>{mission.enabled?'Доступна':'Выключена'}</Badge>}>
      <fieldset className="city-admin-fieldset" disabled={!canEdit||mutation.isPending}>
        <label className="field"><span className="field__label">Название</span><input className="input" value={mission.title} minLength={3} maxLength={140} required onChange={e=>change({title:e.target.value})}/></label>
        <label className="field"><span className="field__label">Задание для оператора</span><textarea className="input" rows={3} value={mission.description} minLength={5} maxLength={2000} required onChange={e=>change({description:e.target.value})}/></label>
        <label className="field"><span className="field__label">Подсказка Пульсара</span><textarea className="input" rows={3} value={mission.pulsar} minLength={5} maxLength={1200} required onChange={e=>change({pulsar:e.target.value})}/></label>
        <div className="city-admin-grid city-admin-grid--three">
          <label className="field"><span className="field__label">{scenario||crmExercise?'Цель: успешное прохождение':'Цель: количество действий'}</span><input className="input" type="number" min={1} max={scenario||crmExercise||['welcome','driver_profile'].includes(selected)?1:DISPATCH_TARGETS[selected]??100} value={mission.target} disabled={scenario||crmExercise} required onChange={e=>change({target:Number(e.target.value)})}/></label>
          <label className="field"><span className="field__label">Опыт города, XP</span><input className="input" type="number" min={0} max={1000} value={mission.xp} disabled={scenario} required onChange={e=>change({xp:Number(e.target.value)})}/></label>
          <label className="field"><span className="field__label">{scenario?'Награда за сценарий, коины':'Награда, коины'}</span><input className="input" type="number" min={0} max={selected==='welcome'?0:1000} value={mission.coins} required onChange={e=>change({coins:Number(e.target.value)})}/></label>
        </div>
        {crmExercise&&<p className="city-admin-card-note">Цель CRM — одно успешно проверенное задание. Результат подтверждается сохранённым обращением; количество обращений и ручные отметки его не заменяют.</p>}
        {scenario&&<p className="city-admin-card-note">От 0 до 1000 коинов за первое успешное прохождение. 0 — сценарий без награды. Повторная тренировка не начисляет коины. Цель — одно успешное прохождение; XP не начисляется. Изменение награды не переписывает уже выданные коины.</p>}
        <label className="field"><span className="field__label">Открыть после миссии</span><Select aria-label="Открыть после миссии" value={mission.prerequisite??''} disabled={scenario||selected==='welcome'} options={prerequisites} onChange={value=>change({prerequisite:value||null})}/></label>
        <Switch checked={mission.enabled} onChange={value=>change({enabled:value})}>Миссия доступна операторам</Switch>
      </fieldset>
    </Card>
    {canEdit&&<FormFooter status={<FormStatus error={mutation.isError&&mutation.error} saved={saved&&'Условия миссий сохранены.'} note={dirty&&'Есть несохранённые изменения.'}/>}>
      <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending?'Сохраняем…':'Сохранить все изменения'}</Button>
    </FormFooter>}
  </form>;
}
