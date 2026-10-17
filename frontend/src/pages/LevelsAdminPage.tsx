import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { progressApi, type ProgressLevel } from "../api/progress";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { Badge, Button, Card, ErrorState, Skeleton } from "../components/ui";
import { coins, plural } from "../utils/format";
import "./workflow.css";
import "./motivation.css";

export function LevelsAdminPage() {
  const { atLeast } = useAuth();
  const [editor, setEditor] = useState<ProgressLevel | "new" | null>(null);
  const [saved, setSaved] = useState(false);
  const levels = useQuery({ queryKey: ["coin-levels"], queryFn: progressApi.levels });
  const rows = [...(levels.data ?? [])].sort((a, b) => a.min_coins - b.min_coins);
  const top = Math.max(1, ...rows.map(level => level.min_coins));
  const admin = atLeast("admin");
  return <div className="stack levels-page">
    <header className="page-head"><div><h1 className="page-title">Уровни</h1><p className="page-subtitle">{levels.data ? `${rows.filter(level => level.is_active).length} ${plural(rows.filter(level => level.is_active).length, "активный уровень", "активных уровня", "активных уровней")} · ` : ""}уровень растёт с коинами, заработанными за всё время</p></div>{admin && <div className="page-head__actions"><Button variant="primary" onClick={() => { setSaved(false); setEditor("new"); }}>Добавить уровень</Button></div>}</header>
    {saved && <p className="levels-saved" role="status">Уровень сохранён. Прогресс сотрудников пересчитан по новым порогам.</p>}
    <Card className="levels-scale" padded={false} title="Шкала уровней" subtitle="Покупки и возвраты прогресс не уменьшают. На каждом пороге выше нуля сотрудник получает одноимённое достижение; отдельных коинов за уровень нет.">
      {levels.isPending && <div className="card__body"><Skeleton height={240} /></div>}
      {levels.isError && <ErrorState error={levels.error} onRetry={() => levels.refetch()} />}
      {rows.length > 0 && <ol className="levels-list">{rows.map((level, index) => <li key={level.id} className={`levels-row${level.is_active ? "" : " is-hidden"}`}>
        <span className="levels-row__number" aria-hidden="true">{index + 1}</span>
        <div className="levels-row__main">
          <p className="levels-row__title"><strong>{level.title}</strong>{!level.is_active && <Badge tone="neutral">Скрыт</Badge>}</p>
          <p className="levels-row__meta">{level.min_coins > 0 ? `Достижение «${coins(level.min_coins)} коинов заработано»` : "Стартовый уровень у всех сотрудников"}{level.description ? ` · ${level.description}` : ""}</p>
        </div>
        <div className="levels-row__threshold"><span className="levels-row__coins">{level.min_coins > 0 ? `от ${coins(level.min_coins)}` : "0"}</span><span className="levels-row__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, level.min_coins / top * 100)}%` }} /></span></div>
        {admin && <Button size="s" variant="plain" className="levels-row__edit" aria-label={`Изменить уровень «${level.title}»`} onClick={() => { setSaved(false); setEditor(level); }}>Изменить</Button>}
      </li>)}</ol>}
      <p className="levels-note">Изменение порогов пересчитывает уровни и достижения всех сотрудников по их заработку. Баланс кошельков не меняется.</p>
    </Card>
    {editor && <LevelEditor level={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setSaved(true); }} />}
  </div>;
}

function LevelEditor({ level, onClose, onSaved }: { level?: ProgressLevel; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(level?.title ?? "");
  const [threshold, setThreshold] = useState(String(level?.min_coins ?? 100));
  const [description, setDescription] = useState(level?.description ?? "");
  const [active, setActive] = useState(level?.is_active ?? true);
  const client = useQueryClient();
  const starting = level?.min_coins === 0;
  const save = useMutation({ mutationFn: () => progressApi.saveLevel({ title, min_coins: Number(threshold), description: description || null, is_active: active }, level?.id), onSuccess: () => {
    for (const key of ["coin-levels", "coin-progress", "dashboard", "badges"]) void client.invalidateQueries({ queryKey: [key] });
    onSaved();
  } });
  return <Sheet title={level ? "Изменить уровень" : "Новый уровень"} onClose={() => { if (!save.isPending) onClose(); }} footer={<Button form="coin-level-form" type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить уровень"}</Button>}>
    <form id="coin-level-form" className="stack" onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}><fieldset className="learning-fieldset stack" disabled={save.isPending}>
      <label className="field"><span className="field__label">Название уровня</span><input className="input" required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="field"><span className="field__label">Заработать коинов за всё время</span><input className="input" type="number" required min={0} max={100000000} step={1} disabled={starting} value={threshold} onChange={event => setThreshold(event.target.value)} /></label>
      <label className="field"><span className="field__label">Описание</span><textarea className="input" maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="row"><input type="checkbox" checked={active} disabled={starting} onChange={event => setActive(event.target.checked)} />Уровень активен</label>
      <p className="small secondary">{starting ? "Стартовый уровень всегда активен и имеет порог 0." : `При достижении порога сотрудник получит уровень и достижение «${coins(Number(threshold))} коинов заработано».`}</p>
      <p className="small secondary">Настройка применяется ко всем существующим и будущим сотрудникам после сохранения.</p>
    </fieldset>{save.isError && <ErrorState error={save.error} />}</form>
  </Sheet>;
}
