import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { progressApi, type ProgressLevel } from "../api/progress";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { Badge, Button, Card, ErrorState, Skeleton } from "../components/ui";
import { coins } from "../utils/format";
import "./workflow.css";

export function LevelsAdminPage() {
  const { atLeast } = useAuth();
  const [editor, setEditor] = useState<ProgressLevel | "new" | null>(null);
  const [saved, setSaved] = useState(false);
  const levels = useQuery({ queryKey: ["coin-levels"], queryFn: progressApi.levels });
  return <div className="stack">
    <header className="page-head"><div><h1 className="page-title">Уровни и прогресс</h1><p className="page-subtitle">Уровень определяется заработанными коинами за всё время.</p></div>{atLeast("admin") && <Button variant="primary" onClick={() => { setSaved(false); setEditor("new"); }}>Добавить уровень</Button>}</header>
    <Card title="Как работают уровни"><p>Покупки и возвраты не меняют прогресс. При достижении каждого порога выше нуля автоматически открывается одноимённое достижение. Дополнительные коины за уровень не начисляются.</p><p className="workflow-note">Изменение порогов пересчитывает уровни и достижения всех сотрудников по их заработку. Баланс кошельков сохраняется.</p></Card>
    {saved && <p role="status">Уровень сохранён. Прогресс сотрудников пересчитан по новым порогам.</p>}
    <Card title="Шкала уровней">{levels.isPending && <Skeleton height={240} />}{levels.isError && <ErrorState error={levels.error} onRetry={() => levels.refetch()} />}
      <div className="workflow-results">{levels.data?.map(level => <article className="workflow-result" key={level.id}><div><strong>{level.title}</strong><p>От {coins(level.min_coins)} заработанных коинов</p>{level.min_coins > 0 && <p className="small secondary">Достижение: «{coins(level.min_coins)} коинов заработано»</p>}{level.description && <p>{level.description}</p>}</div><div className="workflow-actions"><Badge tone={level.is_active ? "success" : "neutral"}>{level.is_active ? "Активен" : "Скрыт"}</Badge>{atLeast("admin") && <Button onClick={() => { setSaved(false); setEditor(level); }}>Изменить</Button>}</div></article>)}</div>
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
      <label className="field"><span>Название уровня</span><input className="input" required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label className="field"><span>Заработать коинов за всё время</span><input className="input" type="number" required min={0} max={100000000} step={1} disabled={starting} value={threshold} onChange={event => setThreshold(event.target.value)} /></label>
      <label className="field"><span>Описание</span><textarea className="input" maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="row"><input type="checkbox" checked={active} disabled={starting} onChange={event => setActive(event.target.checked)} />Уровень активен</label>
      <p className="small secondary">{starting ? "Стартовый уровень всегда активен и имеет порог 0." : `При достижении порога сотрудник получит уровень и достижение «${coins(Number(threshold))} коинов заработано».`}</p>
      <p className="small secondary">Настройка применяется ко всем существующим и будущим сотрудникам после сохранения.</p>
    </fieldset>{save.isError && <ErrorState error={save.error} />}</form>
  </Sheet>;
}
