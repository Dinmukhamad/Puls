import { CityWorldEditor } from "./CityWorldEditor";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, POINT_KINDS, SITE_STAGES, type CityEconomy, type CitySettings, type CitySituation, type CitySituations, type PointKind } from "../../api/city";
import { cityEstate } from "../../api/cityEstate";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, Skeleton } from "../../components/ui";
import { isReadyHouse } from "../../city3d/world/familyHouses";
import { isOfficeBuilding } from "../../city3d/world/officeBuildings";
import { estateRows, plotEconomyName, readyBuildingLabel } from "./plotCatalogue";
import "./city.css";

/** Dispatch missions count the calls of their group; a trainer cannot ask for more (app/services/city.py TARGET_LIMITS). */
const DISPATCH_TARGETS: Record<string, number> = { dispatch_driver: 2, dispatch_car: 1, dispatch_inventory: 1, dispatch_support: 1, dispatch_limit: 3 };
type CityAdminTab = "participants" | "groups" | "economy" | "situations" | "settings" | "world" | "estates";
const CITY_ADMIN_TABS: CityAdminTab[] = ["participants", "groups", "economy", "situations", "settings", "world", "estates"];

export function CityAdminPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const canEdit = ["trainer", "head", "admin"].includes(user?.role ?? "");
  const [tab, setTab] = useState<CityAdminTab>(() => {
    const requested = params.get("tab") as CityAdminTab | null;
    return requested && CITY_ADMIN_TABS.includes(requested) ? requested : ["head", "admin"].includes(user?.role ?? "") ? "world" : "participants";
  });
  const settings = useQuery({ queryKey:["city-settings"], queryFn:city.settings, enabled:tab === "settings", refetchOnWindowFocus:false });
  return <div className="city-page city-admin"><header className="city-heading"><div><span className="city-eyebrow">СТУДИЯ ОБУЧЕНИЯ</span><h1>Управление городом</h1><p>Назначайте команды районов, настраивайте миссии и следите за прогрессом.</p></div><Link className="city-secondary" to="/training/city">Открыть город →</Link></header>
    <nav className="city-admin-tabs" aria-label="Управление городом"><button className="city-secondary" aria-pressed={tab==='world'} onClick={()=>setTab('world')}>Города и районы</button><button className="city-secondary" aria-pressed={tab==='estates'} onClick={()=>setTab('estates')}>Стройка районов</button><button className="city-secondary" aria-pressed={tab==='participants'} onClick={()=>setTab('participants')}>Прогресс операторов</button><button className="city-secondary" aria-pressed={tab==='groups'} onClick={()=>setTab('groups')}>Города групп</button><button className="city-secondary" aria-pressed={tab==='situations'} onClick={()=>setTab('situations')}>Ситуации дня</button><button className="city-secondary" aria-pressed={tab==='economy'} onClick={()=>setTab('economy')}>Экономика игры</button><button className="city-secondary" aria-pressed={tab==='settings'} onClick={()=>setTab('settings')}>{canEdit?'Настроить миссии':'Условия миссий'}</button></nav>
    {tab==='world'?<CityWorldEditor isHead={user?.role === "head"} />:tab==='estates'?<Estates />:tab==='participants'?<Participants />:tab==='groups'?<Groups />:tab==='economy'?<Economy />:tab==='situations'?<Situations />:settings.data?<MissionEditor initial={settings.data} canEdit={canEdit} />:settings.isError?<ErrorState error={settings.error} onRetry={()=>settings.refetch()} />:<Skeleton height={350} />}
  </div>;
}

function Participants() {
  const [search,setSearch]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1);
  useEffect(()=>{const timer=setTimeout(()=>{setQ(search);setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  const query=useQuery({queryKey:['city-participants',q,page],queryFn:()=>city.participants(q,page),refetchInterval:30000});
  return <><div className="city-admin-controls"><label className="field"><span className="field__label">Найти оператора</span><input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Имя или логин" maxLength={100}/></label><span className="city-admin-warning">{query.data?`Операторов: ${query.data.total}`:'Загрузка…'}<br/>Пройдено — награда получена. Готово — условия выполнены.</span></div>
    {query.isError&&<ErrorState error={query.error} onRetry={()=>query.refetch()}/>}{query.isPending&&<Skeleton height={250}/>}
    <div className="city-participants">{query.data?.items.map(p=><article className="city-person" key={p.user_id}><div><h3>{p.full_name}</h3><p>{p.login} · уровень {p.level} · {p.xp} XP</p><p>{p.orders} заказов · {p.appeals} обращений</p></div><div className="city-person-progress"><div className="city-person-route" role="img" aria-label={p.missions.map(m=>`${m.title}: ${MISSION_STATES[m.state]}, ${m.current} из ${m.target}`).join('; ')}>{p.missions.map(m=><span key={m.key} data-state={m.state} title={`${m.title}: ${MISSION_STATES[m.state]}`} />)}</div><small>Пройдено {p.completed} / {p.total} · готово к завершению {p.ready}</small></div><Link className="city-secondary" to={`/training/city?operator=${p.user_id}`}>Открыть путь →</Link></article>)}</div>
    {query.data&&!query.data.items.length&&<p className="secondary">По этому запросу операторов нет.</p>}
    {query.data&&query.data.total>query.data.size&&<div className="city-admin-controls"><button className="city-secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>← Назад</button><span>Страница {page} из {Math.ceil(query.data.total/query.data.size)}</span><button className="city-secondary" disabled={page*query.data.size>=query.data.total} onClick={()=>setPage(p=>p+1)}>Далее →</button></div>}
  </>;
}

/** Staff only: every visible group's quarters with points, and each member's contribution. Operators never see this. */
function Groups() {
  const query=useQuery({queryKey:['city-groups'],queryFn:city.groups,refetchInterval:30000});
  const kinds=Object.keys(POINT_KINDS) as PointKind[];
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!query.data)return <Skeleton height={250}/>;
  return <div className="city-groups">
    <p className="city-admin-warning">Операторы видят только стадии кварталов своей группы и свои очки. Очки: {kinds.map(k=>`${POINT_KINDS[k]} — ${query.data.points[k]}`).join("; ")}.</p>
    {!query.data.items.length&&<p className="secondary">Нет групп, закреплённых за вами.</p>}
    {query.data.items.map(g=><article className="city-group-card" key={g.id}>
      <header><h3>{g.name}</h3><span>{g.total} очков · {g.members.length} операторов</span></header>
      <ol className="city-group-card__projects">{g.projects.map(p=><li key={p.key}><span>{p.name}</span><small>{SITE_STAGES[p.stage]} · {p.points} / {p.cost}</small><div className="city-meter"><span style={{width:`${p.points/p.cost*100}%`}}/></div></li>)}</ol>
      <div className="city-group-card__table" role="table" aria-label={`Вклад операторов: ${g.name}`}>
        <div role="row"><span role="columnheader">Оператор</span>{kinds.map(k=><span role="columnheader" key={k}>{POINT_KINDS[k]}</span>)}<span role="columnheader">Очки</span></div>
        {g.members.map(m=><div role="row" key={m.user_id}><span role="cell"><Link to={`/training/city?operator=${m.user_id}`}>{m.full_name}</Link></span>{kinds.map(k=><span role="cell" key={k}>{m[k]}</span>)}<span role="cell"><b>{m.points}</b></span></div>)}
      </div>
    </article>)}
  </div>;
}

const SLOTS = 3;
/** The daily situations' own set: trainers, the head and the admin edit it; supervisors read it. */
function Situations() {
  const client=useQueryClient();
  const query=useQuery({queryKey:['city-situations'],queryFn:city.situations,refetchOnWindowFocus:false});
  const [draft,setDraft]=useState<CitySituations|null>(null),[selected,setSelected]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{if(query.data){setDraft(structuredClone(query.data));setSelected(s=>s||query.data.items[0]?.id||'');}},[query.data]);
  const mutation=useMutation({mutationFn:city.saveSituations,onSuccess:data=>{setSaved(true);client.setQueryData(['city-situations'],{...data,can_edit:query.data?.can_edit});}});
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!draft)return <Skeleton height={350}/>;
  const canEdit=!!draft.can_edit, item=draft.items.find(i=>i.id===selected), enabled=draft.items.filter(i=>i.enabled).length;
  const setItems=(items:CitySituation[])=>{setSaved(false);setDraft(d=>d&&({...d,items}));};
  const change=(patch:Partial<CitySituation>)=>setItems(draft.items.map(i=>i.id===selected?{...i,...patch}:i));
  function add(){const id=`own-${Date.now().toString(36)}`;setItems([...draft!.items,{id,speaker:'Водитель',text:'',options:['',''],correct:0,explanation:'',enabled:true}]);setSelected(id);}
  function remove(){const rest=draft!.items.filter(i=>i.id!==selected);setItems(rest);setSelected(rest[0]?.id??'');}
  return <form className="city-admin-edit" onSubmit={e=>{e.preventDefault();if(canEdit)mutation.mutate(draft);}}>
    <p className="city-admin-warning">Каждый день оператор получает {SLOTS} ситуации. Сначала берутся вопросы из тестов, которые он уже прошёл, остальные — из этого набора. Включено: {enabled}, нужно не меньше {SLOTS}. Изменения действуют с новых заданий: сегодняшние уже розданы.{canEdit?'':' Менять ситуации могут тренер, руководитель и администратор.'}</p>
    <div className="city-editor-fields"><label className="field"><span className="field__label">Ситуация</span><select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>{draft.items.map((i,k)=><option key={i.id} value={i.id}>{k+1}. {i.enabled?'':'(выключена) '}{i.speaker?`${i.speaker}: `:''}{i.text.slice(0,70)||'Новая ситуация'}</option>)}</select></label>
      {canEdit&&<div className="city-situations__actions"><button type="button" className="city-secondary" onClick={add}>+ Добавить</button>{item&&<button type="button" className="city-secondary" onClick={remove}>Удалить</button>}</div>}</div>
    {item&&<fieldset disabled={!canEdit||mutation.isPending} style={{border:0,padding:0,margin:0,display:'grid',gap:16}}>
      <label className="field"><span className="field__label">Кто обращается</span><input className="input" list="city-speakers" maxLength={60} value={item.speaker} onChange={e=>change({speaker:e.target.value})} placeholder="Водитель, Клиент…"/><datalist id="city-speakers"><option value="Водитель"/><option value="Клиент"/></datalist><small className="secondary">«Водитель» ждёт у такси автопарка, «Клиент» — у CRM-центра, остальные — у помощника.</small></label>
      <label className="field"><span className="field__label">Что случилось</span><textarea className="input" minLength={5} maxLength={1000} required value={item.text} onChange={e=>change({text:e.target.value})}/></label>
      <fieldset className="city-situations__options"><legend className="field__label">Варианты ответа — отметьте верный</legend>
        {item.options.map((o,k)=><div key={k} className="city-situations__option"><input type="radio" name="city-correct" aria-label={`Вариант ${k+1} верный`} checked={item.correct===k} onChange={()=>change({correct:k})}/><input className="input" maxLength={300} required value={o} onChange={e=>change({options:item.options.map((x,j)=>j===k?e.target.value:x)})} placeholder={`Вариант ${k+1}`}/>{item.options.length>2&&<button type="button" className="city-secondary" aria-label={`Убрать вариант ${k+1}`} onClick={()=>change({options:item.options.filter((_,j)=>j!==k),correct:item.correct===k?0:item.correct>k?item.correct-1:item.correct})}>×</button>}</div>)}
        {item.options.length<6&&<button type="button" className="city-secondary" onClick={()=>change({options:[...item.options,'']})}>+ Вариант</button>}
      </fieldset>
      <label className="field"><span className="field__label">Пояснение после ответа</span><textarea className="input" maxLength={1000} value={item.explanation} onChange={e=>change({explanation:e.target.value})}/></label>
      <label className="row"><input type="checkbox" checked={item.enabled} onChange={e=>change({enabled:e.target.checked})}/> Ситуация участвует в заданиях дня</label>
    </fieldset>}
    {canEdit&&<button className="city-action" type="submit" disabled={mutation.isPending||enabled<SLOTS}>{mutation.isPending?'Сохраняем…':'Сохранить все ситуации'}</button>}
    {saved&&<p role="status">Ситуации сохранены.</p>}{mutation.isError&&<ErrorState error={mutation.error}/>}
  </form>;
}

/** The game's numbers: head and admin edit them, trainers and supervisors read them. */
function Economy() {
  const client=useQueryClient();
  const query=useQuery({queryKey:['city-economy'],queryFn:city.economy,refetchOnWindowFocus:false});
  const [draft,setDraft]=useState<CityEconomy|null>(null),[saved,setSaved]=useState(false);
  useEffect(()=>{if(query.data)setDraft(structuredClone(query.data));},[query.data]);
  const mutation=useMutation({mutationFn:city.saveEconomy,onSuccess:async data=>{setSaved(true);client.setQueryData(['city-economy'],{...query.data,...data});await client.invalidateQueries({queryKey:['city']});await client.invalidateQueries({queryKey:['city-groups']});}});
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!draft)return <Skeleton height={350}/>;
  const canEdit=!!draft.can_edit;
  const change=(patch:Partial<CityEconomy>)=>{setSaved(false);setDraft(d=>d&&({...d,...patch}));};
  const number=(value:string)=>Math.max(0,Math.round(Number(value)||0));
  return <form className="city-admin-edit city-economy" onSubmit={e=>{e.preventDefault();if(canEdit)mutation.mutate(draft);}}>
    <p className="city-admin-warning">Цены и награда за задание действуют для новых покупок и ответов: уже построенное остаётся по цене покупки. Очки и стоимость кварталов пересчитывают город группы сразу, стадии кварталов могут сдвинуться.{canEdit?'':' Менять настройки могут руководитель и администратор.'}</p>
    <fieldset disabled={!canEdit||mutation.isPending}>
      <h3>Цены построек, коинов</h3>
      <div className="city-economy__grid">{(draft.catalogue??[]).map(b=><label className="field" key={b.key}><span className="field__label">{b.icon} {b.name}</span><input className="input" type="number" min={1} max={100000} required value={draft.prices[b.key]} onChange={e=>change({prices:{...draft.prices,[b.key]:number(e.target.value)}})}/></label>)}</div>
      <h3>Очки для города группы</h3>
      <div className="city-economy__grid">{(Object.keys(POINT_KINDS) as PointKind[]).map(k=><label className="field" key={k}><span className="field__label">{POINT_KINDS[k]}</span><input className="input" type="number" min={0} max={1000} required value={draft.points[k]} onChange={e=>change({points:{...draft.points,[k]:number(e.target.value)}})}/></label>)}</div>
      <h3>Кварталы группы, по очереди</h3>
      <div className="city-economy__projects">{draft.projects.map((p,i)=><div key={p.key} className="city-editor-fields"><label className="field"><span className="field__label">Название квартала {i+1}</span><input className="input" minLength={3} maxLength={60} required value={p.name} onChange={e=>change({projects:draft.projects.map(q=>q.key===p.key?{...q,name:e.target.value}:q)})}/></label><label className="field"><span className="field__label">Стоимость, очков</span><input className="input" type="number" min={10} max={1000000} required value={p.cost} onChange={e=>change({projects:draft.projects.map(q=>q.key===p.key?{...q,cost:number(e.target.value)}:q)})}/></label></div>)}</div>
      <h3>Задания дня</h3>
      <div className="city-economy__grid"><label className="field"><span className="field__label">Коинов за верный ответ</span><input className="input" type="number" min={0} max={1000} required value={draft.quest_coins} onChange={e=>change({quest_coins:number(e.target.value)})}/></label></div>
      {draft.land&&<><h3>Стоимость земли по зонам, коинов за участок</h3>
        <p className="city-admin-warning">Зоны идут от центра города к окраине: земля у центра дороже. Её стоимость добавляется к цене сквера, дома или офиса. Новые зоны открываются по мере застройки района. В ОП три зоны — используются первые три цены.</p>
        <div className="city-economy__grid">{draft.land.map((price,i)=><label className="field" key={i}><span className="field__label">Зона {i+1}{i===0?' · у центра':i===draft.land!.length-1?' · окраина':''}</span><input className="input" type="number" min={0} max={100000} required value={price} onChange={e=>change({land:draft.land!.map((v,j)=>j===i?number(e.target.value):v)})}/></label>)}</div></>}
      {draft.estate&&<><h3>Районы команд: постройки на участках, коинов за ступень</h3>
        <p className="city-admin-warning">Первая ступень сквера и дома — покупка (вместе с участком), следующие — улучшения. Готовые дома и офисные здания покупаются целиком, по одной цене. Чем больше этажей и площадь дома, есть ли гараж и терраса — тем дороже. Парк и большой парк не покупаются: их собирают свои скверы, первая ступень — сбор (0 — бесплатно). Купленное не дорожает: новые цены действуют для новых операций, а открытая страница стройки попросит подтвердить новую цену.</p>
        <div className="city-economy__projects">{estateRows(draft.estate).map(row=><div key={row.key}>{row.title&&<h4>{row.title}</h4>}<div className="city-economy__grid">{row.families.flatMap(family=>draft.estate![family].map((price,i)=>{const levels=draft.estate![family],gathered=(family==='park'||family==='bigpark')&&i===0;return <label className="field" key={`${family}-${i}`}><span className="field__label">{plotEconomyName(family)} · {gathered?'сбор из скверов (0 — бесплатно)':isReadyHouse(family)||isOfficeBuilding(family)?readyBuildingLabel(family):i===0?'покупка':`ступень ${i+1}`}</span><input className="input" type="number" min={gathered?0:1} max={100000} required value={price} onChange={e=>change({estate:{...draft.estate,[family]:levels.map((v,j)=>j===i?number(e.target.value):v)}})}/></label>;}))}</div></div>)}</div></>}
      {draft.district&&<><h3>Общие проекты района: смета ступени</h3>
        <p className="city-admin-warning">Смета фиксируется при открытии проекта; новая цена не переписывает уже открытые сборы.</p>
        <div className="city-economy__projects">{Object.entries(draft.district).map(([family,levels])=><div key={family} className="city-economy__grid">{levels.map((cost,i)=><label className="field" key={i}><span className="field__label">{PROJECT_NAMES[family]??family} · ступень {i+1}</span><input className="input" type="number" min={1} max={100000} required value={cost} onChange={e=>change({district:{...draft.district,[family]:levels.map((v,j)=>j===i?number(e.target.value):v)}})}/></label>)}</div>)}</div></>}
      {draft.hq&&<><h3>Штаб района: построенных общих проектов для ступени</h3>
        <div className="city-economy__grid">{draft.hq.map((need,i)=><label className="field" key={i}><span className="field__label">Ступень {i+2}</span><input className="input" type="number" min={1} max={1000} required value={need} onChange={e=>change({hq:draft.hq!.map((v,j)=>j===i?number(e.target.value):v)})}/></label>)}</div>
        <p className="city-admin-warning">Ступени по возрастанию. Уже полученная ступень штаба не снижается.</p></>}
      {canEdit&&<button className="city-action" type="submit">{mutation.isPending?'Сохраняем…':'Сохранить настройки'}</button>}
    </fieldset>
    {saved&&<p role="status">Настройки игры сохранены.</p>}{mutation.isError&&<ErrorState error={mutation.error}/>}
  </form>;
}

const PROJECT_NAMES:Record<string,string>={square:'🌳 Сквер',gazebo:'🌷 Беседка',fountain:'⛲ Площадь с фонтаном',sports:'🏀 Спортплощадка',park:'🏞️ Парк на площади'};

/** Staff only: land, buildings and shared projects per district, and what the old plots hold before their transfer. */
function Estates() {
  const query=useQuery({queryKey:['city-estates-report'],queryFn:cityEstate.report,refetchInterval:30000});
  if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  if(!query.data)return <Skeleton height={250}/>;
  const r=query.data;
  return <div className="city-groups">
    <p className="city-admin-warning">Стройку включает руководитель во вкладке «Города и районы». Операторы покупают личные постройки в районе своей команды. Новая территория открывается, когда занято 70 % уже открытой земли; общие проекты размещаются на площади команды.</p>
    <div className="city-group-card__table" role="table" aria-label="Районы команд">
      <div role="row"><span role="columnheader">Район</span><span role="columnheader">Стройка</span><span role="columnheader">Операторы</span><span role="columnheader">Участки</span><span role="columnheader">Этап застройки</span><span role="columnheader">Постройки</span><span role="columnheader">Сборы</span><span role="columnheader">Штаб</span></div>
      {r.districts.map(d=><div role="row" key={d.id}><span role="cell"><b>{d.name}</b> · {d.city==='sales'?'ОП':'Техподдержка'}</span><span role="cell">{d.land?d.construction?'открыта':'закрыта':'нет земли'}</span><span role="cell">{d.operators}{d.builders?` · строят ${d.builders}`:''}</span><span role="cell">{d.land?`${d.land.taken} / ${d.land.plots}`:'—'}</span><span role="cell">{d.land?.open_band??'—'}</span><span role="cell">{d.buildings}</span><span role="cell">{d.open_projects}</span><span role="cell">{d.hq_level} · {d.built_projects} пр.</span></div>)}
    </div>
    <p className="city-admin-warning">Операторов без района: {r.operators_without_district}. Построек в инвентаре после перевода: {r.inventory}. Потрачено на участки и постройки: {r.coins.buildings} коинов, взносы в проекты: {r.coins.contributions}, возвращено: {r.coins.refunded}.</p>
    <p className="city-admin-warning">Прежние постройки на участках учебных центров: {r.legacy.buildings} у {r.legacy.operators} операторов, оплачено {r.legacy.paid} коинов. Они остаются на месте; перенос в районы — отдельный этап со сверкой и без повторной оплаты.</p>
  </div>;
}

function MissionEditor({initial,canEdit}:{initial:CitySettings;canEdit:boolean}) {
  const client=useQueryClient();
  const [draft,setDraft]=useState(()=>structuredClone(initial)),[selected,setSelected]=useState('welcome'),[saved,setSaved]=useState(false);
  const mutation=useMutation({mutationFn:city.save,onSuccess:async data=>{setDraft(data);setSaved(true);client.setQueryData(['city-settings'],data);await client.invalidateQueries({queryKey:['city']});await client.invalidateQueries({queryKey:['city-participants']});}});
  const dirty=JSON.stringify(draft)!==JSON.stringify(initial)&&!saved;
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const mission=draft.missions[selected];
  function change(patch:Partial<typeof mission>){setSaved(false);setDraft(d=>({...d,missions:{...d.missions,[selected]:{...d.missions[selected],...patch}}}));}
  return <form className="city-admin-edit" onSubmit={e=>{e.preventDefault();if(canEdit)mutation.mutate(draft);}}>
    <p className="city-admin-warning">Уже полученные награды и опыт сохраняются. Новые условия применяются к непройденным миссиям. Цели проверяются по данным CRM, Driver Simulator и учебной Диспетчерской: в миссиях Диспетчерской цель — число решённых звонков.</p>
    <label className="field"><span className="field__label">Миссия</span><select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>{Object.entries(draft.missions).map(([key,m])=><option key={key} value={key}>{m.title}</option>)}</select></label>
    <fieldset disabled={!canEdit||mutation.isPending} style={{border:0,padding:0,margin:0,display:'grid',gap:16}}>
      <label className="field"><span className="field__label">Название</span><input className="input" value={mission.title} minLength={3} maxLength={140} required onChange={e=>change({title:e.target.value})}/></label>
      <label className="field"><span className="field__label">Задание для оператора</span><textarea className="input" value={mission.description} minLength={5} maxLength={2000} required onChange={e=>change({description:e.target.value})}/></label>
      <label className="field"><span className="field__label">Подсказка Пульсара</span><textarea className="input" value={mission.pulsar} minLength={5} maxLength={1200} required onChange={e=>change({pulsar:e.target.value})}/></label>
      <div className="city-editor-fields"><label className="field"><span className="field__label">Цель: количество действий</span><input className="input" type="number" min={1} max={['welcome','driver_profile'].includes(selected)?1:DISPATCH_TARGETS[selected]??100} value={mission.target} required onChange={e=>change({target:Number(e.target.value)})}/></label><label className="field"><span className="field__label">Опыт города, XP</span><input className="input" type="number" min={0} max={1000} value={mission.xp} required onChange={e=>change({xp:Number(e.target.value)})}/></label><label className="field"><span className="field__label">Награда, коины</span><input className="input" type="number" min={0} max={selected==='welcome'?0:1000} value={mission.coins} required onChange={e=>change({coins:Number(e.target.value)})}/></label></div>
      <label className="field"><span className="field__label">Открыть после миссии</span><select className="input" value={mission.prerequisite??''} disabled={selected==='welcome'} onChange={e=>change({prerequisite:e.target.value||null})}><option value="">Без предыдущего задания</option>{Object.entries(draft.missions).filter(([key])=>key!==selected).map(([key,m])=><option key={key} value={key}>{m.title}</option>)}</select></label>
      <label className="row"><input type="checkbox" checked={mission.enabled} onChange={e=>change({enabled:e.target.checked})}/> Миссия доступна операторам</label>
      {canEdit&&<button className="city-action" type="submit">{mutation.isPending?'Сохраняем…':'Сохранить все изменения'}</button>}
    </fieldset>
    {saved&&<p role="status">Условия миссий сохранены.</p>}{mutation.isError&&<ErrorState error={mutation.error}/>}
  </form>;
}
