import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FleetState } from "../../api/dispatch";
import { crmTraining, crmTrainingKey, type CrmTrainingDriver, type CrmTrainingTask } from "../../api/crmTraining";
import { copyText } from "./accountData";

const ADVICE = [
  ["registered_call", "Позвонить с номера регистрации"],
  ["taxi_pro", "Изменить номер в приложении «Такси Про»"],
  ["whatsapp", "Написать в WhatsApp для смены номера"],
  ["change_now", "Оформить смену номера по текущему звонку"],
];

/** Draw the same two training cards as one PNG; only this course capture is accepted as proof. */
export async function callSnapshot(driver: CrmTrainingDriver, incoming: string): Promise<Blob> {
  const canvas = document.createElement("canvas"); canvas.width = 1440; canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось сделать снимок. Попробуй другой браузер.");
  ctx.fillStyle = "#edf1f7"; ctx.fillRect(0, 0, 1440, 720);
  const text = (value: string, x: number, y: number, size = 24, color = "#202b3c") => {
    ctx.font = `${size}px Arial, sans-serif`; ctx.fillStyle = color; ctx.fillText(value, x, y, 610);
  };
  [[24, "ДИСПЕТЧЕРСКАЯ"], [732, "OKTEL · ВХОДЯЩИЙ ЗВОНОК"]].forEach(([x, title]) => {
    ctx.fillStyle = "#fff"; ctx.fillRect(Number(x), 28, 684, 652);
    ctx.fillStyle = "#273c59"; ctx.fillRect(Number(x), 28, 684, 74);
    text(String(title), Number(x) + 24, 75, 25, "#fff");
  });
  text("Аккаунт водителя", 52, 154, 20, "#64748b"); text(driver.name, 52, 201, 28);
  text("Номер регистрации", 52, 263, 20, "#64748b"); text(driver.phone, 52, 310, 36);
  text(`ВУ: ${driver.license}`, 52, 375); text(`Таксопарк: ${driver.park}`, 52, 425);
  text(`Город: ${driver.city}`, 52, 475); text(`ID: ${driver.id}`, 52, 532, 17);
  text(driver.link, 52, 590, 13);
  text("Номер входящего звонка", 760, 154, 20, "#64748b"); text(incoming, 760, 215, 36);
  text("Звонок на линии", 760, 290, 25, "#18794e"); text("Просьба: сменить номер телефона", 760, 356);
  text("Учебные данные · практика CRM", 52, 650, 16, "#64748b");
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не удалось сделать снимок")), "image/png"));
}

export function CrmCallWorkspace({ task, fleet, userId, onForm }: { task: CrmTrainingTask; fleet?: FleetState; userId?: number; onForm: () => void }) {
  const [search, setSearch] = useState(""), [selected, setSelected] = useState<CrmTrainingDriver | null>(null);
  const [choices, setChoices] = useState<string[]>([]), [copied, setCopied] = useState(false);
  const client = useQueryClient();
  const update = (value: Awaited<ReturnType<typeof crmTraining.state>>) => client.setQueryData(crmTrainingKey(userId), value);
  const inspect = useMutation({ mutationFn: (driver: CrmTrainingDriver) => crmTraining.action(task.key, { action: "inspect", driver_id: driver.id }), onSuccess: update });
  const capture = useMutation({ mutationFn: async () => {
    if (!selected || selected.id !== task.driver.id) throw new Error("Открой аккаунт водителя из звонка.");
    await inspect.mutateAsync(selected);
    return crmTraining.capture(task.key, await callSnapshot(selected, task.incoming_phone!));
  }, onSuccess: update });
  const advice = useMutation({ mutationFn: () => crmTraining.action(task.key, { action: "advice", choices }), onSuccess: update });
  const d = task.driver;
  if (!d) return <p>Начни урок, чтобы открыть учебный звонок.</p>;
  const drivers = (fleet?.drivers ?? []).map(row => {
    if (row.id === d.id) return d;
    const park = fleet?.parks.find(p => p.id === row.park);
    return { id: row.id, name: [row.last_name, row.first_name, row.middle_name].filter(Boolean).join(" "), phone: row.phone, license: row.license, park: park?.name ?? "", city: park?.city ?? "", link: "" };
  });
  const needle = search.toLowerCase().replace(/[+()\s-]/g, "");
  const found = needle ? drivers.filter(row => `${row.name} ${row.phone} ${row.license}`.toLowerCase().replace(/[+()\s-]/g, "").includes(needle)).slice(0, 6) : [];
  const mismatch = task.key === "crm_mismatch_v2";
  const error = capture.error ?? inspect.error ?? advice.error;
  return <section className="crm-panel crm-call-workspace" aria-label="Учебный звонок и диспетчерская">
    <div className="crm-panel-heading"><div><h2>{task.title}</h2><p>{task.speech}</p></div></div>
    <div className="crm-call-windows">
      <section className="crm-call-window" aria-label="Диспетчерская — учебное окно"><header>Диспетчерская</header>
        <label>Поиск водителя<input aria-label="Найти водителя по телефону, имени или ВУ" value={search} onChange={e => setSearch(e.target.value)} placeholder="Телефон, имя или ВУ" /></label>
        {!needle && !selected && <p>Найди водителя по данным звонка.</p>}
        {needle && <div className="crm-call-search">{found.map(row => <button key={row.id} disabled={inspect.isPending} onClick={() => { setSelected(row); setSearch(""); inspect.mutate(row); }}><strong>{row.name}</strong><span>{row.phone}</span></button>)}{!found.length && <p>Водитель не найден. Проверь введённые данные.</p>}</div>}
        {selected && <div className="crm-call-account"><h3>{selected.name}</h3><dl>{[["Номер регистрации", selected.phone], ["ВУ", selected.license], ["Таксопарк", selected.park], ["Город", selected.city]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {selected.link && <><p className="crm-call-link">{selected.link}</p><button className="crm-secondary" onClick={() => void copyText(selected.link).then(ok => setCopied(ok))}>{copied ? "Ссылка скопирована" : "Скопировать ссылку на аккаунт"}</button></>}
        </div>}
      </section>
      <section className="crm-call-window" aria-label="OKTEL — учебное окно"><header>OKTEL</header><div className="crm-call-incoming"><small>Входящий звонок</small><strong>{task.incoming_phone}</strong><span>● На линии</span></div><p>«{task.speech}»</p>{!mismatch && <dl><dt>Водитель просит указать новый номер</dt><dd>{d.new_phone}</dd></dl>}{mismatch && <p>Данные для поиска: {d.name}, ВУ {d.license}.</p>}</section>
    </div>
    {!!error && <p role="alert" className="crm-course-feedback">{error instanceof Error ? error.message : "Не удалось выполнить действие. Повтори."}</p>}
    {mismatch ? <div className="crm-course-advice"><h3>Что предложишь водителю?</h3>{ADVICE.map(([key, label]) => <label key={key}><input type="checkbox" checked={choices.includes(key)} onChange={e => setChoices(values => e.target.checked ? [...values, key] : values.filter(v => v !== key))} />{label}</label>)}<button className="crm-primary" disabled={advice.isPending || !selected || inspect.isPending} onClick={() => advice.mutate()}>Ответить водителю</button></div>
    : <div className="crm-call-capture"><button className="crm-primary" disabled={!selected || selected.id !== d.id || capture.isPending || inspect.isPending} onClick={() => capture.mutate()}>{capture.isPending ? "Делаем снимок…" : task.capture ? "Снимок сохранён" : "Сделать снимок"}</button>
      {task.capture && <><img src={task.capture.data_url} alt="Один снимок диспетчерской и OKTEL с номерами водителя" /><button className="crm-primary" onClick={onForm}>Перейти к оформлению обращения</button><p>В форме прикрепи этот снимок кнопкой «Прикрепить снимок двух окон».</p></>}
    </div>}
  </section>;
}
