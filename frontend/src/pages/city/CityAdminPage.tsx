import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, type CitySettings } from "../../api/city";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, Skeleton } from "../../components/ui";
import "./city.css";

export function CityAdminPage() {
  const { user } = useAuth();
  const canEdit = ["trainer", "head", "admin"].includes(user?.role ?? "");
  const [tab, setTab] = useState<"participants"|"settings">("participants");
  const settings = useQuery({ queryKey:["city-settings"], queryFn:city.settings, enabled:tab === "settings", refetchOnWindowFocus:false });
  return <div className="city-page city-admin"><header className="city-heading"><div><span className="city-eyebrow">СТУДИЯ ОБУЧЕНИЯ</span><h1>Миссии города</h1><p>Настраивайте маршрут и следите за реальным прогрессом.</p></div><Link className="city-secondary" to="/training/city">Открыть город →</Link></header>
    <nav className="city-admin-tabs" aria-label="Управление городом"><button className="city-secondary" aria-pressed={tab==='participants'} onClick={()=>setTab('participants')}>Прогресс операторов</button><button className="city-secondary" aria-pressed={tab==='settings'} onClick={()=>setTab('settings')}>{canEdit?'Настроить миссии':'Условия миссий'}</button></nav>
    {tab==='participants'?<Participants />:settings.data?<MissionEditor initial={settings.data} canEdit={canEdit} />:settings.isError?<ErrorState error={settings.error} onRetry={()=>settings.refetch()} />:<Skeleton height={350} />}
  </div>;
}

function Participants() {
  const [search,setSearch]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1);
  useEffect(()=>{const timer=setTimeout(()=>{setQ(search);setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  const query=useQuery({queryKey:['city-participants',q,page],queryFn:()=>city.participants(q,page),refetchInterval:30000});
  return <><div className="city-admin-controls"><label className="field"><span>Найти оператора</span><input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Имя или логин" maxLength={100}/></label><span className="city-admin-warning">{query.data?`Операторов: ${query.data.total}`:'Загрузка…'}<br/>Пройдено — награда получена. Готово — условия выполнены.</span></div>
    {query.isError&&<ErrorState error={query.error} onRetry={()=>query.refetch()}/>}{query.isPending&&<Skeleton height={250}/>}
    <div className="city-participants">{query.data?.items.map(p=><article className="city-person" key={p.user_id}><div><h3>{p.full_name}</h3><p>{p.login} · уровень {p.level} · {p.xp} XP</p><p>{p.orders} заказов · {p.appeals} обращений</p></div><div className="city-person-progress"><div className="city-person-route" role="img" aria-label={p.missions.map(m=>`${m.title}: ${MISSION_STATES[m.state]}, ${m.current} из ${m.target}`).join('; ')}>{p.missions.map(m=><span key={m.key} data-state={m.state} title={`${m.title}: ${MISSION_STATES[m.state]}`} />)}</div><small>Пройдено {p.completed} / {p.total} · готово к завершению {p.ready}</small></div><Link className="city-secondary" to={`/training/city?operator=${p.user_id}`}>Открыть путь →</Link></article>)}</div>
    {query.data&&!query.data.items.length&&<p className="secondary">По этому запросу операторов нет.</p>}
    {query.data&&query.data.total>query.data.size&&<div className="city-admin-controls"><button className="city-secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>← Назад</button><span>Страница {page} из {Math.ceil(query.data.total/query.data.size)}</span><button className="city-secondary" disabled={page*query.data.size>=query.data.total} onClick={()=>setPage(p=>p+1)}>Далее →</button></div>}
  </>;
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
    <p className="city-admin-warning">Уже полученные награды и опыт сохраняются. Новые условия применяются к непройденным миссиям. Цели проверяются по данным CRM и Driver Simulator.</p>
    <label className="field"><span>Миссия</span><select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>{Object.entries(draft.missions).map(([key,m])=><option key={key} value={key}>{m.title}</option>)}</select></label>
    <fieldset disabled={!canEdit||mutation.isPending} style={{border:0,padding:0,margin:0,display:'grid',gap:16}}>
      <label className="field"><span>Название</span><input className="input" value={mission.title} minLength={3} maxLength={140} required onChange={e=>change({title:e.target.value})}/></label>
      <label className="field"><span>Задание для оператора</span><textarea className="input" value={mission.description} minLength={5} maxLength={2000} required onChange={e=>change({description:e.target.value})}/></label>
      <label className="field"><span>Подсказка Пульсара</span><textarea className="input" value={mission.pulsar} minLength={5} maxLength={1200} required onChange={e=>change({pulsar:e.target.value})}/></label>
      <div className="city-editor-fields"><label className="field"><span>Цель: количество действий</span><input className="input" type="number" min={1} max={['welcome','driver_profile'].includes(selected)?1:100} value={mission.target} required onChange={e=>change({target:Number(e.target.value)})}/></label><label className="field"><span>Опыт города, XP</span><input className="input" type="number" min={0} max={1000} value={mission.xp} required onChange={e=>change({xp:Number(e.target.value)})}/></label><label className="field"><span>Награда, коины</span><input className="input" type="number" min={0} max={selected==='welcome'?0:1000} value={mission.coins} required onChange={e=>change({coins:Number(e.target.value)})}/></label></div>
      <label className="field"><span>Открыть после миссии</span><select className="input" value={mission.prerequisite??''} disabled={selected==='welcome'} onChange={e=>change({prerequisite:e.target.value||null})}><option value="">Без предыдущего задания</option>{Object.entries(draft.missions).filter(([key])=>key!==selected).map(([key,m])=><option key={key} value={key}>{m.title}</option>)}</select></label>
      <label className="row"><input type="checkbox" checked={mission.enabled} onChange={e=>change({enabled:e.target.checked})}/> Миссия доступна операторам</label>
      {canEdit&&<button className="city-action" type="submit">{mutation.isPending?'Сохраняем…':'Сохранить все изменения'}</button>}
    </fieldset>
    {saved&&<p role="status">Условия миссий сохранены.</p>}{mutation.isError&&<ErrorState error={mutation.error}/>}
  </form>;
}
