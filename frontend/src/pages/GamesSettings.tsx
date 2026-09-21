import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { games, type Raffle, type RaffleInput, type WheelConfig } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, RowsSkeleton } from "../components/ui";
import { dateTime, points } from "../utils/format";

export function WheelSettings() {
  const query=useQuery({queryKey:["wheel"],queryFn:games.wheel});
  if(query.isLoading)return <RowsSkeleton/>;if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  return <WheelEditor key={JSON.stringify(query.data)} initial={query.data!}/>;
}
function WheelEditor({initial}:{initial:WheelConfig}) {
  const {atLeast}=useAuth();const editable=atLeast("head");const client=useQueryClient();const toast=useToast();
  const [value,setValue]=useState(()=>({enabled:initial.enabled,daily_spins:initial.daily_spins,segments:structuredClone(initial.segments)}));
  const save=useMutation({mutationFn:()=>games.configureWheel(value),onSuccess:()=>{void client.invalidateQueries({queryKey:["wheel"]});toast.success("Правила сохранены");}});
  const total=value.segments.reduce((sum,item)=>sum+item.weight,0);
  const patch=(index:number,field:"title"|"weight"|"coins",next:string|number)=>
    setValue((state)=>({...state,segments:state.segments.map((row,i)=>i===index?{...row,[field]:next}:row)}));

  return <form className="stack" onSubmit={(e)=>{e.preventDefault();if(editable&&!save.isPending)save.mutate();}}>
    <Card title="Правила розыгрыша" subtitle="Участие бесплатное. Результат и начисление определяет сервер.">
      <fieldset className="learning-fieldset stack" disabled={!editable||save.isPending}>
        <label className="learning-check"><input type="checkbox" checked={value.enabled} onChange={(e)=>setValue({...value,enabled:e.target.checked})}/>Доступно сотрудникам</label>
        <label className="field"><span>Попыток на человека в день</span><input className="input" type="number" min={1} max={10} required value={value.daily_spins} onChange={(e)=>setValue({...value,daily_spins:Number(e.target.value)})}/></label>
      </fieldset>
    </Card>

    {/* Призы редактируются таблицей, а не восемью карточками в столбик:
        в карточках на восемь призов уходила целая страница прокрутки, а
        сравнить веса между собой — то, ради чего сюда и заходят, — было
        нельзя, потому что рядом они не помещались. */}
    <Card title="Призы" subtitle={`${value.segments.length} из 12 · общий вес ${total}`} padded={false}>
      <div className="table-wrap table-wrap--responsive">
        <table className="table prize-table">
          <thead>
            <tr>
              <th style={{width:"46%"}}>Название приза</th>
              <th className="num">Вес</th>
              <th className="num">Коины</th>
              <th className="num">Шанс</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {value.segments.map((item,index)=>
              <tr key={index}>
                <td><input className="input" required maxLength={100} disabled={!editable||save.isPending} value={item.title} onChange={(e)=>patch(index,"title",e.target.value)} aria-label={`Название приза ${index+1}`}/></td>
                <td className="num"><input className="input input--num" type="number" required min={1} max={10000} disabled={!editable||save.isPending} value={item.weight} onChange={(e)=>patch(index,"weight",Number(e.target.value))} aria-label={`Вес приза ${index+1}`}/></td>
                <td className="num"><input className="input input--num" type="number" required min={0} max={1000} disabled={!editable||save.isPending} value={item.coins} onChange={(e)=>patch(index,"coins",Number(e.target.value))} aria-label={`Коины за приз ${index+1}`}/></td>
                <td className="num prize-table__chance">{total>0?`${points(item.weight/total*100)}%`:"—"}</td>
                <td>{editable&&<Button variant="destructive" disabled={value.segments.length<=2||save.isPending} onClick={()=>setValue({...value,segments:value.segments.filter((_,i)=>i!==index)})}>Удалить</Button>}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      <p className="secondary small prize-table__hint">Вес задаёт относительную вероятность: вес 2 вдвое вероятнее веса 1. Шанс пересчитывается сразу и всегда даёт в сумме 100%.</p>
    </Card>

    {editable&&<div className="row">
      <Button disabled={value.segments.length>=12||save.isPending} onClick={()=>setValue({...value,segments:[...value.segments,{title:"В этот раз без награды",weight:1,coins:0}]})}>Добавить приз</Button>
      <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending?"Сохраняем…":"Сохранить правила"}</Button>
    </div>}
    {save.isError&&<ErrorState error={save.error}/>}
  </form>;
}

export function Raffles({administrative}:{administrative:boolean}) {
  const query=useQuery({queryKey:["raffles",administrative],queryFn:()=>games.raffles(administrative),refetchInterval:30000});
  const [editor,setEditor]=useState<Raffle|"new"|null>(null);const [drawing,setDrawing]=useState<Raffle|null>(null);
  const {atLeast}=useAuth();const client=useQueryClient();const toast=useToast();const editable=administrative&&atLeast("head");
  const enter=useMutation({mutationFn:games.enter,onSuccess:(data)=>{void client.invalidateQueries({queryKey:["raffles"]});toast.success(data.detail);}});
  const draw=useMutation({mutationFn:games.draw,onSuccess:()=>{for(const key of ["raffles","dashboard","coin-progress", "badges","notifications"])void client.invalidateQueries({queryKey:[key]});setDrawing(null);toast.success("Результат розыгрыша сохранён");}});
  return <div className="stack">{editable&&<Button variant="primary" onClick={()=>setEditor("new")}>Создать розыгрыш</Button>}{query.isLoading&&<RowsSkeleton/>}{query.isError&&<ErrorState error={query.error} onRetry={()=>query.refetch()}/>} {!query.isLoading&&!query.isError&&!query.data?.length&&<EmptyState title="Розыгрышей пока нет" hint="Новые события появятся здесь."/>}<div className="training-grid">{query.data?.map((item)=><Card key={item.id} className="raffle-card" title={item.title} action={<Badge tone={item.won?"success":item.status==="draft"?"neutral":"accent"}>{item.won?"✓ Вы победили":item.status==="closed"?"Завершён":item.status==="draft"?"Черновик":item.accepting_entries?"Идёт набор":"Ожидаем результат"}</Badge>}><div className="stack stack--tight"><div className="raffle-prize"><span aria-hidden="true">✦</span><h3>{item.prize}</h3></div><p>{item.description}</p><p className="secondary small">До {dateTime(item.closes_at)}<br/>{item.participants} участников</p>{item.winner_name&&<p><strong>Победитель:</strong> {item.winner_name}</p>}{item.status==="closed"&&!item.winner_name&&<p className="secondary">Розыгрыш завершён без участников</p>}{!administrative&&item.status!=="closed"&&<Button variant={item.entered?"secondary":"primary"} disabled={item.entered||!item.accepting_entries||enter.isPending} onClick={()=>enter.mutate(item.id)}>{item.entered?"✓ Вы участвуете":item.accepting_entries?"Участвовать бесплатно":"Приём завершён"}</Button>}{editable&&item.status!=="closed"&&<><Button disabled={item.participants>0} onClick={()=>setEditor(item)}>Изменить</Button>{item.status==="published"&&!item.accepting_entries&&<Button variant="primary" onClick={()=>setDrawing(item)}>Определить победителя</Button>}{item.participants>0&&<p className="secondary small">Условия зафиксированы после вступления первого участника.</p>}</>}</div></Card>)}</div>{enter.isError&&<ErrorState error={enter.error}/>}
    {editor&&<RaffleEditor target={editor==="new"?undefined:editor} onClose={()=>setEditor(null)}/>}{drawing&&<Sheet title="Определить победителя?" size="s" onClose={()=>{if(!draw.isPending)setDrawing(null);}} footer={<><Button disabled={draw.isPending} onClick={()=>setDrawing(null)}>Отмена</Button><Button variant="primary" disabled={draw.isPending} onClick={()=>draw.mutate(drawing.id)}>{draw.isPending?"Определяем…":"Провести розыгрыш"}</Button></>}><p>{drawing.title} · {drawing.participants} участников. Победитель выбирается случайно с равными шансами; результат сохраняется.</p>{draw.isError&&<ErrorState error={draw.error}/>}</Sheet>}
  </div>;
}
function RaffleEditor({target,onClose}:{target?:Raffle;onClose:()=>void}) {
  const [value,setValue]=useState<RaffleInput>(()=>target?{title:target.title,description:target.description,prize:target.prize,closes_at:target.closes_at,status:target.status==="published"?"published":"draft",coins_reward:target.coins_reward}:{title:"",description:"",prize:"",closes_at:"",status:"draft",coins_reward:0});
  const client=useQueryClient();const save=useMutation({mutationFn:()=>games.saveRaffle(value,target?.id),onSuccess:()=>{void client.invalidateQueries({queryKey:["raffles"]});onClose();}});
  return <Sheet title={target?"Изменить розыгрыш":"Новый розыгрыш"} onClose={()=>{if(!save.isPending)onClose();}} footer={<Button form="raffle-editor" type="submit" variant="primary" disabled={save.isPending}>{save.isPending?"Сохраняем…":value.status==="published"?"Опубликовать":"Сохранить черновик"}</Button>}><form id="raffle-editor" className="stack" onSubmit={(e)=>{e.preventDefault();if(!save.isPending)save.mutate();}}><fieldset className="learning-fieldset stack" disabled={save.isPending}>{([{key:"title",label:"Название"},{key:"prize",label:"Приз"}]as const).map((field)=><label className="field" key={field.key}><span>{field.label}</span><input className="input" required maxLength={180} value={value[field.key]} onChange={(e)=>setValue({...value,[field.key]:e.target.value})}/></label>)}<label className="field"><span>Описание и условия получения</span><textarea className="input" maxLength={4000} value={value.description} onChange={(e)=>setValue({...value,description:e.target.value})}/></label><label className="field"><span>Завершение (UTC)</span><input type="datetime-local" className="input" required value={value.closes_at?new Date(value.closes_at).toISOString().slice(0,16):""} onChange={(e)=>setValue({...value,closes_at:e.target.value?`${e.target.value}:00Z`:""})}/></label>{([{key:"coins_reward",label:"Коины победителю",max:10000}]as const).map((field)=><label className="field" key={field.key}><span>{field.label}</span><input className="input" type="number" min={0} max={field.max} required value={value[field.key]} onChange={(e)=>setValue({...value,[field.key]:Number(e.target.value)})}/></label>)}<label className="field"><span>Статус</span><select className="input" value={value.status} onChange={(e)=>setValue({...value,status:e.target.value as RaffleInput["status"]})}><option value="draft">Черновик</option><option value="published">Опубликован</option></select></label><p className="secondary small">Участие бесплатное. Коины победителю начисляются автоматически; выдачу указанного приза организует руководитель.</p></fieldset>{save.isError&&<ErrorState error={save.error}/>}</form></Sheet>;
}
