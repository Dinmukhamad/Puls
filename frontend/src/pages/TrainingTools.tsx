import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { learning, type LearningContent } from "../api/learning";
import { lookups, type UserOption } from "../api/access";
import { driver } from "../api/driver";
import { driverShift, type DriverScenario } from "../api/driverShift";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "../components/Sheet";
import { Button, Card, ErrorState, RowsSkeleton } from "../components/ui";
import { ScenarioForm } from "./DriverScenarioEditor";
import "./training-tools.css";

export function AssignmentEditor({ content, onClose }: { content: LearningContent; onClose: () => void }) {
  const [all, setAll] = useState(false), [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UserOption[]>([]), [deadline, setDeadline] = useState("");
  const client = useQueryClient();
  const people = useQuery({ queryKey: ["training-operator-options", search], queryFn: ({ signal }) => lookups.operators({ search, size: 50 }, signal) });
  const save = useMutation({ mutationFn: () => learning.assign(content.id, { all_operators: all, user_ids: all ? [] : selected.map(x => x.id), deadline: deadline ? new Date(deadline).toISOString() : null }), onSuccess: () => {
    for (const key of ["learning", "training-analytics"]) void client.invalidateQueries({ queryKey: [key] });
  } });
  return <Sheet title="Назначить операторам" subtitle={content.title} onClose={() => { if (!save.isPending) onClose(); }} footer={<Button variant="primary" disabled={save.isPending || (!all && !selected.length)} onClick={() => save.mutate()}>{save.isPending ? "Назначаем…" : "Назначить"}</Button>}>
    <div className="stack"><label><input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); save.reset(); }} disabled={save.isPending} /> Всем активным операторам</label>
      {!all && <><label className="field"><span className="field__label">Найти оператора</span><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="ФИО" /></label>
        {selected.length > 0 && <div className="row">{selected.map(item => <Button key={item.id} size="s" disabled={save.isPending} onClick={() => setSelected(old => old.filter(x => x.id !== item.id))}>{item.full_name} ×</Button>)}</div>}
        {people.isPending && <RowsSkeleton rows={2} />}{people.isError && <ErrorState error={people.error} />}
        <div className="training-operator-picker">{people.data?.items.map(item => <label key={item.id}><input type="checkbox" checked={selected.some(x => x.id === item.id)} disabled={save.isPending} onChange={e => { setSelected(old => e.target.checked ? [...old, item] : old.filter(x => x.id !== item.id)); save.reset(); }} />{item.full_name}</label>)}</div>
        {(people.data?.total ?? 0) > 50 && <p className="secondary">Показаны первые 50 операторов. Уточните поиск.</p>}
      </>}
      <label className="field"><span className="field__label">Срок прохождения · необязательно</span><input className="input" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} disabled={save.isPending} /></label>
      <p className="secondary">Повторное назначение не сбрасывает результаты и не создаёт дубликат. Назначение всем охватывает текущих активных операторов.</p>
      {save.isSuccess && <p role="status">Назначено: {save.data.assigned}. Уже назначено ранее: {save.data.already_assigned}.</p>}{save.isError && <ErrorState error={save.error} />}
    </div>
  </Sheet>;
}

export function TrainerHome() {
  const { user } = useAuth();
  return <div className="stack"><header className="page-head"><div><h1 className="page-title">Кабинет тренера</h1><p className="page-subtitle">{user?.full_name} · подготовка операторов в Driver Simulator</p></div></header>
    <Card title="Рабочий день тренера"><p>Создайте операторов и подготовьте сценарии Driver Simulator. В аналитике симулятора видны прогресс, ошибки и активность операторов.</p><div className="training-home-links"><Link to="/admin/users">Создать оператора →</Link><Link to="/admin/learning">Подготовить сценарии →</Link><Link to="/admin/learning-analytics">Аналитика симулятора →</Link></div></Card>
    <Card title="Проверка перед публикацией"><p>Кнопка «Пройти как оператор» открывает тестовое прохождение. Оно не входит в рабочую статистику и не выдаёт коины.</p><div className="training-home-links"><Link to="/admin/learning">Открыть сценарии Driver Simulator →</Link><Link to="/training/city?district=driver">Тестовый запуск в городе →</Link></div></Card>
  </div>;
}

export function DriverContentEditor({ content, onClose }: { content?: LearningContent; onClose: () => void }) {
  const config = useQuery({ queryKey: ["driver-scenario"], queryFn: driverShift.config, enabled: !content });
  const parks = useQuery({ queryKey: ["driver-parks"], queryFn: driver.parks });
  const [status, setStatus] = useState<"draft" | "published" | "archived">(content?.status ?? "draft");
  const [pass, setPass] = useState(content?.pass_percent ?? 80);
  const client = useQueryClient();
  const initial = content?.driver_config ?? config.data;
  async function save(value: DriverScenario) {
    await learning.save({ kind: "simulator", title: value.title, description: content?.description ?? "Учебная смена водителя", world: "Driver Simulator", difficulty: "medium", minutes: 30, status, is_required: false, deadline: null, allow_back: true, pass_percent: pass, coins_reward: content?.coins_reward ?? 0, driver_config: value,
      steps: [{ speaker: "", text: "Выполните учебную смену", options: ["Выполнено", "Нужна практика"], correct: 0, explanation: "Разбор доступен после смены" }],
    }, content?.id);
    void client.invalidateQueries({ queryKey: ["learning-definitions"] }); void client.invalidateQueries({ queryKey: ["learning"] });
    onClose(); return value;
  }
  return <Sheet title={content ? "Редактор сценария" : "Новый сценарий Driver Simulator"} size="l" onClose={onClose}>
    <div className="stack"><label className="field"><span className="field__label">Публикация</span><select className="input" value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="draft">Черновик</option><option value="published">Опубликовано</option><option value="archived">Архив</option></select></label><label className="field"><span className="field__label">Проходной балл</span><input className="input" type="number" min={1} max={100} value={pass} onChange={e => setPass(Number(e.target.value))} /></label>
    <p className="secondary">Сценарий хранится отдельно от системных настроек и может назначаться операторам. Начатые смены сохраняют свою версию.</p>
    {config.isError && <ErrorState error={config.error} />}{parks.isError && <ErrorState error={parks.error} />}
    {initial && parks.data ? <ScenarioForm initial={initial} parks={parks.data.parks} readOnly={false} onSave={save} saveLabel="Сохранить сценарий" /> : <RowsSkeleton />}</div>
  </Sheet>;
}
