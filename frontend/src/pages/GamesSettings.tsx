import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { games, type Raffle, type RaffleInput, type WheelConfig } from "../api/games";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { AlertIcon } from "../components/icons";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, RowsSkeleton, Select } from "../components/ui";
import { coins as formatCoins, dateTime, plural, points } from "../utils/format";
import { monthlyChestCoins, promisedCoins } from "./wheelPrizes";

export function WheelSettings() {
  const query=useQuery({queryKey:["wheel"],queryFn:games.wheel});
  if(query.isLoading)return <RowsSkeleton/>;if(query.isError)return <ErrorState error={query.error} onRetry={()=>query.refetch()}/>;
  return <WheelEditor key={JSON.stringify(query.data)} initial={query.data!}/>;
}
function WheelEditor({initial}:{initial:WheelConfig}) {
  const {atLeast}=useAuth();const editable=atLeast("head");const client=useQueryClient();const toast=useToast();
  const [value,setValue]=useState(()=>({enabled:initial.enabled,daily_spins:initial.daily_spins,paid_spins:initial.paid_spins??0,spin_cost:initial.spin_cost??0,segments:structuredClone(initial.segments)}));
  const save=useMutation({mutationFn:()=>games.configureWheel(value),onSuccess:()=>{void client.invalidateQueries({queryKey:["wheel"]});toast.success("Правила сохранены");}});
  const total=value.segments.reduce((sum,item)=>sum+item.weight,0);
  // The average prize: a paid spin should cost more than it wins, or the wheel prints coins.
  const average=total?value.segments.reduce((sum,item)=>sum+item.weight*item.coins,0)/total:0;
  // What the free chests alone give one operator in a month: the plan is about 100 of ~1 000 (docs/COIN_ECONOMY.md).
  const monthly=monthlyChestCoins(value.daily_spins,value.segments);
  const patch=(index:number,field:"title"|"weight"|"coins",next:string|number)=>
    setValue((state)=>({...state,segments:state.segments.map((row,i)=>i===index?{...row,[field]:next}:row)}));

  const changed=JSON.stringify(value)!==JSON.stringify({enabled:initial.enabled,daily_spins:initial.daily_spins,paid_spins:initial.paid_spins??0,spin_cost:initial.spin_cost??0,segments:initial.segments});
  return <form className="stack chest-settings" onSubmit={(e)=>{e.preventDefault();if(editable&&!save.isPending)save.mutate();}}>
    <Card title="Правила" subtitle="Сундук открывается, когда оператор ответил на задания дня. Сначала бесплатные сундуки, после них — платные. Приз определяет сервер."
      action={<label className={`chest-settings__switch${value.enabled?" is-on":""}`}><input type="checkbox" role="switch" checked={value.enabled} disabled={!editable||save.isPending} onChange={(e)=>setValue({...value,enabled:e.target.checked})}/><span className="chest-settings__track" aria-hidden="true"><span/></span>{value.enabled?"Сундук открыт сотрудникам":"Сундук выключен"}</label>}>
      <fieldset className="learning-fieldset chest-settings__numbers" disabled={!editable||save.isPending}>
        <label className="field"><span className="field__label">Бесплатных в день</span><input className="input" type="number" min={1} max={10} required value={value.daily_spins} onChange={(e)=>setValue({...value,daily_spins:Number(e.target.value)})}/></label>
        <label className="field"><span className="field__label">Платных в день</span><input className="input" type="number" min={0} max={10} required value={value.paid_spins} onChange={(e)=>setValue({...value,paid_spins:Number(e.target.value)})}/><span className="field__note">0 — платных нет</span></label>
        <label className="field"><span className="field__label">Цена платного, коинов</span><input className="input" type="number" min={0} max={1000} required value={value.spin_cost} onChange={(e)=>setValue({...value,spin_cost:Number(e.target.value)})}/><span className={`field__note${average>=value.spin_cost&&value.spin_cost>0?" chest-settings__warn":""}`}>Средний выигрыш {points(average)} {average>=value.spin_cost&&value.spin_cost>0?"— не меньше цены: платные сундуки будут добавлять коины, а не сжигать":plural(Math.round(average),"коин","коина","коинов")}</span></label>
      </fieldset>
    </Card>

    {/* Призы редактируются таблицей, а не восемью карточками в столбик:
        в карточках на восемь призов уходила целая страница прокрутки, а
        сравнить веса между собой — то, ради чего сюда и заходят, — было
        нельзя, потому что рядом они не помещались. */}
    <Card title="Призы" subtitle={`${value.segments.length} из 12 · общий вес ${total}`} padded={false}>
      <div className="table-wrap">
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
                <td><input className="input" required maxLength={100} disabled={!editable||save.isPending} value={item.title} onChange={(e)=>patch(index,"title",e.target.value)} aria-label={`Название приза ${index+1}`} aria-describedby={mismatch(item)?`prize-warn-${index}`:undefined}/>
                  {mismatch(item)&&<p className="prize-table__warn" id={`prize-warn-${index}`}><AlertIcon size={13}/>{mismatch(item)}</p>}</td>
                <td className="num"><input className="input input--num" type="number" required min={1} max={10000} disabled={!editable||save.isPending} value={item.weight} onChange={(e)=>patch(index,"weight",Number(e.target.value))} aria-label={`Вес приза ${index+1}`}/></td>
                <td className="num"><input className="input input--num" type="number" required min={0} max={1000} disabled={!editable||save.isPending} value={item.coins} onChange={(e)=>patch(index,"coins",Number(e.target.value))} aria-label={`Коины за приз ${index+1}`}/></td>
                <td className="num prize-table__chance">{total>0?`${points(item.weight/total*100)}%`:"—"}</td>
                <td className="prize-table__remove">{editable&&<IconButton label={`Удалить приз «${item.title||index+1}»`} disabled={value.segments.length<=2||save.isPending} onClick={()=>setValue({...value,segments:value.segments.filter((_,i)=>i!==index)})}><span aria-hidden="true">×</span></IconButton>}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {editable&&<div className="prize-table__add"><Button size="s" disabled={value.segments.length>=12||save.isPending} onClick={()=>setValue({...value,segments:[...value.segments,{title:"В этот раз без награды",weight:1,coins:0}]})}>+ Добавить приз</Button>{value.segments.length>=12&&<span className="secondary small">Не больше 12 призов</span>}</div>}
      <p className="secondary small prize-table__hint">Вес задаёт относительную вероятность: вес 2 вдвое вероятнее веса 1. Шанс пересчитывается сразу и всегда даёт в сумме 100%.</p>
      <p className={`small prize-table__hint prize-economy${monthly>300?" prize-economy--warn":""}`}>{monthly>300&&<AlertIcon size={14}/>}
        Бесплатные сундуки дадут оператору около {formatCoins(monthly)} {plural(monthly,"коина","коинов","коинов")} в месяц.
        {monthly>300?" Это больше трети его месячного дохода (около 1 000 коинов): коины обесценятся, а цены магазина потеряют смысл. По плану экономики сундук даёт около 100 коинов в месяц.":" Это в пределах плана экономики: около 100 коинов в месяц."}</p>
    </Card>

    {editable&&<div className={`chest-settings__save${changed?" is-dirty":""}`}><span className="secondary small">{changed?"Есть несохранённые изменения":"Изменений нет"}</span>
      {changed&&<Button disabled={save.isPending} onClick={()=>setValue({enabled:initial.enabled,daily_spins:initial.daily_spins,paid_spins:initial.paid_spins??0,spin_cost:initial.spin_cost??0,segments:structuredClone(initial.segments)})}>Отменить</Button>}
      <Button type="submit" variant="primary" disabled={save.isPending||!changed}>{save.isPending?"Сохраняем…":"Сохранить правила"}</Button></div>}
    {save.isError&&<ErrorState error={save.error}/>}
  </form>;
}

/** A prize whose name promises other than it pays: operators read the name, the reward is what they get. */
function mismatch(item:{title:string;coins:number}) {
  const promised=promisedCoins(item.title);
  if(promised===null||promised===item.coins)return null;
  const pays=item.coins>0?`даёт ${formatCoins(item.coins)} ${plural(item.coins,"коин","коина","коинов")}`:"пустой";
  return promised===0?`Название обещает пустой сундук, а приз ${pays}`:`В названии ${formatCoins(promised)}, а приз ${pays}`;
}

export function Raffles({administrative}:{administrative:boolean}) {
  const query=useQuery({queryKey:["raffles",administrative],queryFn:()=>games.raffles(administrative),refetchInterval:30000});
  const [editor,setEditor]=useState<Raffle|"new"|null>(null);const [drawing,setDrawing]=useState<Raffle|null>(null);
  const {atLeast}=useAuth();const client=useQueryClient();const toast=useToast();const editable=administrative&&atLeast("head");
  const enter=useMutation({mutationFn:games.enter,onSuccess:(data)=>{void client.invalidateQueries({queryKey:["raffles"]});toast.success(data.detail);}});
  const draw=useMutation({mutationFn:games.draw,onSuccess:()=>{for(const key of ["raffles","dashboard","coin-progress", "badges","notifications"])void client.invalidateQueries({queryKey:[key]});setDrawing(null);toast.success("Результат розыгрыша сохранён");}});
  return <div className="stack">{editable&&<Button className="raffles-create" variant="primary" onClick={()=>setEditor("new")}>Создать розыгрыш</Button>}{query.isLoading&&<RowsSkeleton/>}{query.isError&&<ErrorState error={query.error} onRetry={()=>query.refetch()}/>} {!query.isLoading&&!query.isError&&!query.data?.length&&<EmptyState title="Розыгрышей пока нет" hint="Новые события появятся здесь."/>}<div className="training-grid">{query.data?.map((item)=><Card key={item.id} className="raffle-card" title={item.title} action={<Badge tone={item.won?"success":item.status==="draft"?"neutral":"accent"}>{item.won?"✓ Вы победили":item.status==="closed"?"Завершён":item.status==="draft"?"Черновик":item.accepting_entries?"Идёт набор":"Ожидаем результат"}</Badge>}><div className="stack stack--tight"><div className="raffle-prize"><span aria-hidden="true">✦</span><h3>{item.prize}</h3></div><p>{item.description}</p><p className="secondary small">До {dateTime(item.closes_at)}<br/>{item.participants} участников</p>{item.winner_name&&<p><strong>Победитель:</strong> {item.winner_name}</p>}{item.status==="closed"&&!item.winner_name&&<p className="secondary">Розыгрыш завершён без участников</p>}{!administrative&&item.status!=="closed"&&<Button variant={item.entered?"secondary":"primary"} disabled={item.entered||!item.accepting_entries||enter.isPending} onClick={()=>enter.mutate(item.id)}>{item.entered?"✓ Вы участвуете":!item.accepting_entries?"Приём завершён":item.entry_cost?`Билет за ${item.entry_cost} ${plural(item.entry_cost,"коин","коина","коинов")}`:"Участвовать бесплатно"}</Button>}{editable&&item.status!=="closed"&&<><Button disabled={item.participants>0} onClick={()=>setEditor(item)}>Изменить</Button>{item.status==="published"&&!item.accepting_entries&&<Button variant="primary" onClick={()=>setDrawing(item)}>Определить победителя</Button>}{item.participants>0&&<p className="secondary small">Условия зафиксированы после вступления первого участника.</p>}</>}</div></Card>)}</div>{enter.isError&&<ErrorState error={enter.error}/>}
    {editor&&<RaffleEditor target={editor==="new"?undefined:editor} onClose={()=>setEditor(null)}/>}{drawing&&<Sheet title="Определить победителя?" size="s" onClose={()=>{if(!draw.isPending)setDrawing(null);}} footer={<><Button disabled={draw.isPending} onClick={()=>setDrawing(null)}>Отмена</Button><Button variant="primary" disabled={draw.isPending} onClick={()=>draw.mutate(drawing.id)}>{draw.isPending?"Определяем…":"Провести розыгрыш"}</Button></>}><p>{drawing.title} · {drawing.participants} участников. Победитель выбирается случайно с равными шансами; результат сохраняется.</p>{draw.isError&&<ErrorState error={draw.error}/>}</Sheet>}
  </div>;
}
function RaffleEditor({target,onClose}:{target?:Raffle;onClose:()=>void}) {
  const [value,setValue]=useState<RaffleInput>(()=>target?{title:target.title,description:target.description,prize:target.prize,closes_at:target.closes_at,status:target.status==="published"?"published":"draft",coins_reward:target.coins_reward,entry_cost:target.entry_cost??0}:{title:"",description:"",prize:"",closes_at:"",status:"draft",coins_reward:0,entry_cost:50});
  const client=useQueryClient();const save=useMutation({mutationFn:()=>games.saveRaffle(value,target?.id),onSuccess:()=>{void client.invalidateQueries({queryKey:["raffles"]});onClose();}});
  return <Sheet title={target?"Изменить розыгрыш":"Новый розыгрыш"} onClose={()=>{if(!save.isPending)onClose();}} footer={<Button form="raffle-editor" type="submit" variant="primary" disabled={save.isPending}>{save.isPending?"Сохраняем…":value.status==="published"?"Опубликовать":"Сохранить черновик"}</Button>}><form id="raffle-editor" className="stack" onSubmit={(e)=>{e.preventDefault();if(!save.isPending)save.mutate();}}><fieldset className="learning-fieldset stack" disabled={save.isPending}>{([{key:"title",label:"Название"},{key:"prize",label:"Приз"}]as const).map((field)=><label className="field" key={field.key}><span>{field.label}</span><input className="input" required maxLength={180} value={value[field.key]} onChange={(e)=>setValue({...value,[field.key]:e.target.value})}/></label>)}<label className="field"><span className="field__label">Описание и условия получения</span><textarea className="input" maxLength={4000} value={value.description} onChange={(e)=>setValue({...value,description:e.target.value})}/></label><label className="field"><span className="field__label">Завершение (UTC)</span><input type="datetime-local" className="input" required value={value.closes_at?new Date(value.closes_at).toISOString().slice(0,16):""} onChange={(e)=>setValue({...value,closes_at:e.target.value?`${e.target.value}:00Z`:""})}/></label>{([{key:"coins_reward",label:"Коины победителю",max:10000},{key:"entry_cost",label:"Цена билета, коинов (0 — бесплатно)",max:10000}]as const).map((field)=><label className="field" key={field.key}><span>{field.label}</span><input className="input" type="number" min={0} max={field.max} required value={value[field.key]} onChange={(e)=>setValue({...value,[field.key]:Number(e.target.value)})}/></label>)}<label className="field"><span className="field__label">Статус</span><Select aria-label="Статус розыгрыша" value={value.status} options={[{value:"draft",label:"Черновик"},{value:"published",label:"Опубликован"}]} onChange={(status)=>setValue({...value,status:status as RaffleInput["status"]})}/></label><p className="secondary small">Цена билета списывается при входе в розыгрыш и не возвращается. Коины победителю начисляются автоматически; выдачу указанного приза организует руководитель.</p></fieldset>{save.isError&&<ErrorState error={save.error}/>}</form></Sheet>;
}
