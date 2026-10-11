import { CityWorldEditor } from "./CityWorldEditor";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, POINT_KINDS, SITE_STAGES, type CityEconomy, type CitySettings, type CitySituation, type CitySituations, type PointKind, type SiteStage } from "../../api/city";
import { ApiError } from "../../api/client";
import { cityEstate } from "../../api/cityEstate";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, KPI, Pagination, Progress, SegmentedControl, Select, Skeleton, type Tone } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { coins, plural } from "../../utils/format";
import { FormFooter, FormStatus, Switch } from "./CityAdminControls";
import { estateRows, plotEconomyName } from "./plotCatalogue";

/** Dispatch calls cannot exceed the server's curriculum. */
const DISPATCH_TARGETS: Record<string, number> = { dispatch_driver: 2, dispatch_car: 1, dispatch_inventory: 1, dispatch_support: 1, dispatch_limit: 3 };
type CityAdminTab = "participants" | "groups" | "economy" | "situations" | "settings" | "world" | "estates";
const CITY_ADMIN_TABS: CityAdminTab[] = ["participants", "groups", "economy", "situations", "settings", "world", "estates"];

export function CityAdminPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const canEdit = ["trainer", "head", "admin"].includes(user?.role ?? "");
  const requested = params.get("tab") as CityAdminTab | null;
  const tab: CityAdminTab = requested && CITY_ADMIN_TABS.includes(requested) ? requested : ["head", "admin"].includes(user?.role ?? "") ? "world" : "participants";
  const settings = useQuery({ queryKey:["city-settings"], queryFn:city.settings, enabled:tab === "settings", refetchOnWindowFocus:false });
  const tabs: { value: CityAdminTab; label: string }[] = [
    { value: "world", label: "Города и районы" }, { value: "estates", label: "Стройка районов" }, { value: "participants", label: "Прогресс операторов" },
    { value: "groups", label: "Города групп" }, { value: "situations", label: "Ситуации дня" }, { value: "economy", label: "Экономика игры" },
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
    {tab==='world'?<CityWorldEditor isHead={user?.role === "head"} />:tab==='estates'?<Estates />:tab==='participants'?<Participants />:tab==='groups'?<Groups />:tab==='economy'?<Economy />:tab==='situations'?<Situations />:settings.data?<MissionEditor initial={settings.data} canEdit={canEdit} />:settings.isError?<ErrorState error={settings.error} onRetry={()=>settings.refetch()} />:<Skeleton height={350} />}
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

const STAGE_TONE: Record<SiteStage, Tone> = { planned: "neutral", foundation: "accent", frame: "accent", floors: "accent", done: "success" };

/** Staff only: every visible group's quarters with points, and each member's contribution. Operators never see this. */
function Groups() {
  const query=useQuery({queryKey:['city-groups'],queryFn:city.groups,refetchInterval:30000});
  const kinds=Object.keys(POINT_KINDS) as PointKind[];
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!query.data)return <Skeleton height={250}/>;
  return <div className="stack">
    <div className="ui-note city-admin-note"><p>Операторы видят только стадии кварталов своей группы и свои очки.</p>
      <dl className="city-admin-points">{kinds.map(k=><div key={k}><dt>{POINT_KINDS[k]}</dt><dd>{query.data.points[k]} {plural(query.data.points[k],'очко','очка','очков')}</dd></div>)}</dl></div>
    {!query.data.items.length&&<EmptyState title="Нет групп" hint="За вами пока не закреплена ни одна группа."/>}
    {query.data.items.map(g=><Card key={g.id} title={g.name} subtitle={`${g.total} ${plural(g.total,'очко','очка','очков')} · ${g.members.length} ${plural(g.members.length,'оператор','оператора','операторов')}`} padded={false}>
      <div className="card__body city-admin-quarters-body"><ol className="city-admin-quarters">{g.projects.map(p=><li key={p.key}>
        <Badge tone={STAGE_TONE[p.stage]}>{SITE_STAGES[p.stage]}</Badge>
        <strong className="city-admin-quarters__name">{p.name}</strong>
        <Progress value={p.cost>0?p.points/p.cost:0} size="s" label={`${p.name}: ${p.points} из ${p.cost} очков`}/>
        <span className="city-admin-quarters__count">{p.points} / {p.cost} очков</span>
      </li>)}</ol></div>
      {g.members.length>0&&<><div className="table-wrap table-wrap--responsive city-admin-table"><table className="table">
        <thead><tr><th>Оператор</th>{kinds.map(k=><th className="num" key={k}>{POINT_KINDS[k]}</th>)}<th className="num">Очки</th></tr></thead>
        <tbody>{g.members.map(m=><tr key={m.user_id}><td><Link to={`/training/city?operator=${m.user_id}`}>{m.full_name}</Link></td>{kinds.map(k=><td className="num" key={k}>{m[k]}</td>)}<td className="num"><strong>{m.points}</strong></td></tr>)}</tbody>
      </table></div>
      <div className="card__body city-admin-members"><h3 className="city-admin-subtitle">Операторы группы</h3><ul className="card-list">{g.members.map(m=><li className="list-card" key={m.user_id}>
        <div className="list-card__head"><Link to={`/training/city?operator=${m.user_id}`}>{m.full_name}</Link><strong className="nowrap">{m.points} {plural(m.points,'очко','очка','очков')}</strong></div>
        <dl className="list-card__metrics city-admin-metrics">{kinds.map(k=><div className="list-card__metric" key={k}><dt>{POINT_KINDS[k]}</dt><dd>{m[k]}</dd></div>)}</dl>
      </li>)}</ul></div></>}
    </Card>)}
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

/** The game's numbers: head and admin edit them, trainers and supervisors read them. */
function Economy() {
  const client=useQueryClient();
  const query=useQuery({queryKey:['city-economy'],queryFn:city.economy,refetchOnWindowFocus:false});
  const [draft,setDraft]=useState<CityEconomy|null>(()=>query.data?structuredClone(query.data):null),[saved,setSaved]=useState(false);
  useEffect(()=>{if(query.data)setDraft(structuredClone(query.data));},[query.data]);
  const mutation=useMutation({mutationFn:city.saveEconomy,onSuccess:async data=>{setSaved(true);client.setQueryData(['city-economy'],{...query.data,...data});await client.invalidateQueries({queryKey:['city']});await client.invalidateQueries({queryKey:['city-groups']});}});
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!draft)return <Skeleton height={350}/>;
  const canEdit=!!draft.can_edit;
  const change=(patch:Partial<CityEconomy>)=>{setSaved(false);setDraft(d=>d&&({...d,...patch}));};
  return <form className="stack" onSubmit={e=>{e.preventDefault();if(canEdit)mutation.mutate(draft);}}>
    <p className="ui-note">Цены и награда за задание действуют для новых покупок и ответов: уже построенное остаётся по цене покупки. Очки и стоимость кварталов пересчитывают город группы сразу, стадии кварталов могут сдвинуться.{canEdit?'':' Менять настройки могут руководитель и администратор.'}</p>
    <fieldset className="city-admin-fieldset city-admin-fieldset--sections" disabled={!canEdit||mutation.isPending}>
      <Card title="Цены построек" subtitle="Коинов за покупку в учебном районе">
        <div className="city-admin-grid">{(draft.catalogue??[]).map(b=><NumberField key={b.key} label={<><span aria-hidden="true">{b.icon}</span>{b.name}</>} value={draft.prices[b.key]} min={1} max={100000} onChange={value=>change({prices:{...draft.prices,[b.key]:value}})}/>)}</div>
      </Card>
      <Card title="Очки для города группы" subtitle="Сколько очков приносит каждое действие">
        <div className="city-admin-grid">{(Object.keys(POINT_KINDS) as PointKind[]).map(k=><NumberField key={k} label={POINT_KINDS[k]} value={draft.points[k]} min={0} max={1000} onChange={value=>change({points:{...draft.points,[k]:value}})}/>)}</div>
      </Card>
      <Card title="Кварталы группы" subtitle="Строятся по очереди: следующий начинается после предыдущего">
        <ol className="city-admin-quarter-list">{draft.projects.map((p,i)=><li key={p.key}>
          <span className="city-admin-quarter-list__number" aria-hidden="true">{i+1}</span>
          <label className="field"><span className="field__label">Название квартала {i+1}</span><input className="input" minLength={3} maxLength={60} required value={p.name} onChange={e=>change({projects:draft.projects.map(q=>q.key===p.key?{...q,name:e.target.value}:q)})}/></label>
          <NumberField label="Стоимость, очков" value={p.cost} min={10} max={1000000} onChange={value=>change({projects:draft.projects.map(q=>q.key===p.key?{...q,cost:value}:q)})}/>
        </li>)}</ol>
      </Card>
      <Card title="Задания дня">
        <div className="city-admin-grid"><NumberField label="Коинов за верный ответ" value={draft.quest_coins} min={0} max={1000} onChange={value=>change({quest_coins:value})}/></div>
      </Card>
      {draft.land&&<Card title="Стоимость земли по зонам" subtitle="Коинов за участок">
        <p className="city-admin-card-note">Зоны идут от центра города к окраине: земля у центра дороже. Её стоимость добавляется к цене сквера, дома или офиса. Все зоны района доступны сразу; они различаются только ценой земли. В ОП три зоны — используются первые три цены.</p>
        <div className="city-admin-grid">{draft.land.map((price,i)=><NumberField key={i} label={`Зона ${i+1}${i===0?' · у центра':i===draft.land!.length-1?' · окраина':''}`} value={price} min={0} max={100000} onChange={value=>change({land:draft.land!.map((v,j)=>j===i?value:v)})}/>)}</div>
      </Card>}
      {draft.estate&&<Card title="Районы команд: постройки на участках" subtitle="Коинов за ступень">
        <p className="city-admin-card-note">Первая ступень сквера и дома — покупка (вместе с участком), следующие — улучшения. Готовые дома и офисные здания покупаются целиком, по одной цене. Чем больше этажей и площадь дома, есть ли гараж и терраса — тем дороже. Парк и большой парк не покупаются: их собирают свои скверы, первая ступень — сбор (0 — бесплатно). Купленное не дорожает: новые цены действуют для новых операций, а открытая страница стройки попросит подтвердить новую цену.</p>
        <div className="city-admin-subsections">{estateRows(draft.estate).map(row=><section key={row.key}>{row.title&&<h3 className="city-admin-subtitle">{row.title}</h3>}<div className="city-admin-grid">{row.families.flatMap(family=>draft.estate![family].map((price,i)=>{const levels=draft.estate![family],gathered=(family==='park'||family==='bigpark')&&i===0;return <NumberField key={`${family}-${i}`} label={row.title?plotEconomyName(family):`${plotEconomyName(family)} · ${gathered?'сбор из скверов (0 — бесплатно)':i===0?'покупка':`ступень ${i+1}`}`} value={price} min={gathered?0:1} max={100000} onChange={value=>change({estate:{...draft.estate,[family]:levels.map((v,j)=>j===i?value:v)}})}/>;}))}</div></section>)}</div>
      </Card>}
      {draft.district&&<Card title="Общие проекты района" subtitle="Смета ступени, коинов">
        <p className="city-admin-card-note">Смета фиксируется при открытии проекта; новая цена не переписывает уже открытые сборы.</p>
        <div className="city-admin-subsections">{Object.entries(draft.district).map(([family,levels])=><div key={family} className="city-admin-grid">{levels.map((cost,i)=><NumberField key={i} label={`${PROJECT_NAMES[family]??family} · ступень ${i+1}`} value={cost} min={1} max={100000} onChange={value=>change({district:{...draft.district,[family]:levels.map((v,j)=>j===i?value:v)}})}/>)}</div>)}</div>
      </Card>}
      {draft.hq&&<Card title="Учёт прежних общих проектов" subtitle="Пороги ступеней">
        <p className="city-admin-card-note">Ступени по возрастанию. Эти пороги относятся к прежним общим проектам. Главное здание района растёт автоматически при застройке 10, 25, 50 и 75 % всей земли.</p>
        <div className="city-admin-grid">{draft.hq.map((need,i)=><NumberField key={i} label={`Ступень ${i+2}`} value={need} min={1} max={1000} onChange={value=>change({hq:draft.hq!.map((v,j)=>j===i?value:v)})}/>)}</div>
      </Card>}
    </fieldset>
    {canEdit&&<FormFooter status={<FormStatus error={mutation.isError&&mutation.error} saved={saved&&'Настройки игры сохранены.'}/>}>
      <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending?'Сохраняем…':'Сохранить настройки'}</Button>
    </FormFooter>}
  </form>;
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
    taken:d.land?`${d.land.taken} / ${d.land.plots}`:'—',
    free:d.land?String(Math.max(0,d.land.plots-d.land.taken)):'—',
    landmark:d.land?`${d.landmark_level} из 5`:'—',
  }));
  return <div className="stack">
    <p className="ui-note">Стройку включает руководитель во вкладке «Города и районы». После этого операторы команды могут покупать любые свободные участки во всём районе. Главное здание в центре улучшается автоматически при застройке 10, 25, 50 и 75 % всей земли. Прежние общие постройки и сборы сохраняются.</p>
    <Card title="Районы команд" subtitle={`${rows.length} ${plural(rows.length,'район','района','районов')}`} padded={false}>
      <div className="table-wrap table-wrap--responsive city-admin-table"><table className="table">
        <thead><tr><th>Район</th><th>Стройка</th><th className="num">Операторы</th><th className="num">Занято участков</th><th className="num">Свободно</th><th className="num">Постройки</th><th className="num">Сборы</th><th className="num">Главное здание</th></tr></thead>
        <tbody>{rows.map(d=><tr key={d.id}><td><strong>{d.name}</strong><span className="city-admin-muted"> · {d.cityName}</span></td><td><Badge tone={d.status.tone}>{d.status.label}</Badge></td><td className="num">{d.people}</td><td className="num">{d.taken}</td><td className="num">{d.free}</td><td className="num">{d.buildings}</td><td className="num">{d.open_projects}</td><td className="num nowrap">{d.landmark==='—'?'—':`Уровень ${d.landmark}`}</td></tr>)}</tbody>
      </table></div>
      <div className="card__body"><ul className="card-list">{rows.map(d=><li className="list-card" key={d.id}>
        <div className="list-card__head"><span><strong>{d.name}</strong><span className="city-admin-muted"> · {d.cityName}</span></span><Badge tone={d.status.tone}>{d.status.label}</Badge></div>
        <dl className="list-card__metrics city-admin-metrics">
          <div className="list-card__metric"><dt>Операторы</dt><dd>{d.people}</dd></div>
          <div className="list-card__metric"><dt>Занято участков</dt><dd>{d.taken}</dd></div>
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
          <label className="field"><span className="field__label">{scenario?'Цель: успешное прохождение':'Цель: количество действий'}</span><input className="input" type="number" min={1} max={scenario||['welcome','driver_profile'].includes(selected)?1:DISPATCH_TARGETS[selected]??100} value={mission.target} disabled={scenario} required onChange={e=>change({target:Number(e.target.value)})}/></label>
          <label className="field"><span className="field__label">Опыт города, XP</span><input className="input" type="number" min={0} max={1000} value={mission.xp} disabled={scenario} required onChange={e=>change({xp:Number(e.target.value)})}/></label>
          <label className="field"><span className="field__label">{scenario?'Награда за сценарий, коины':'Награда, коины'}</span><input className="input" type="number" min={0} max={selected==='welcome'?0:1000} value={mission.coins} required onChange={e=>change({coins:Number(e.target.value)})}/></label>
        </div>
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
