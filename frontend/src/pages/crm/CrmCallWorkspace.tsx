import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FleetState } from "../../api/dispatch";
import { crmTraining, crmTrainingKey, type CrmTrainingTask } from "../../api/crmTraining";
import { DispatchSite } from "../dispatch/DispatchSite";
import { fleetLink, fullName, parseRoute, type FleetRoute } from "../dispatch/fleetNav";
import { copyText } from "./accountData";
import "./crm-call-desktop.css";

const ADVICE = [
  ["registered_call", "Позвонить с номера регистрации"],
  ["taxi_pro", "Изменить номер в приложении «Такси Про»"],
  ["whatsapp", "Написать в WhatsApp для смены номера"],
  ["change_now", "Оформить смену номера по текущему звонку"],
];
const WIDTH = 1440, HEIGHT = 720;

/** Capture the rendered work windows, including their current fields, rather than redraw their data. */
export async function callSnapshot(desktop: HTMLElement): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  const image = await toBlob(desktop, {
    width: WIDTH, height: HEIGHT, canvasWidth: WIDTH, canvasHeight: HEIGHT,
    pixelRatio: 1, backgroundColor: "#ffffff", skipFonts: true,
    style: { transform: "none", transformOrigin: "top left" },
  });
  if (!image) throw new Error("Не удалось сделать снимок. Повтори попытку.");
  return image;
}

export function CrmCallWorkspace({ task, fleet, userId, onForm }: { task: CrmTrainingTask; fleet?: FleetState; userId?: number; onForm: () => void }) {
  const [route, setRoute] = useState<FleetRoute>({ page: "contractors" });
  const [parkId, setParkId] = useState(fleet?.drivers.find(d => d.id === task.driver?.id)?.park ?? "itaxi-krg");
  const [choices, setChoices] = useState<string[]>([]), [copied, setCopied] = useState(false);
  const [note, setNote] = useState(task.call_form?.note ?? "");
  const [result, setResult] = useState(task.call_form?.result ?? "Успешный звонок");
  const [scale, setScale] = useState(1), [preview, setPreview] = useState(false);
  const viewport = useRef<HTMLDivElement>(null), desktop = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const update = (value: Awaited<ReturnType<typeof crmTraining.state>>) => client.setQueryData(crmTrainingKey(userId), value);
  const inspect = useMutation({ mutationFn: (id: string) => crmTraining.action(task.key, { action: "inspect", driver_id: id }), onSuccess: update });
  const saveCall = useMutation({ mutationFn: () => crmTraining.action(task.key, { action: "call_form", note, call_result: result }), onSuccess: () => { void client.invalidateQueries({ queryKey: crmTrainingKey(userId) }); } });
  const selected = route.page === "driver" ? fleet?.drivers.find(d => d.id === route.id && d.park === parkId) : undefined;
  const park = fleet?.parks.find(p => p.id === parkId);
  const address = selected ? fleetLink(selected, park) : `fleet.yandex.kz/contractors · ${park?.name ?? "Таксопарк"}`;
  const details = !!selected && (route.tab ?? "details") === "details";
  const correct = details && selected.id === task.driver?.id;
  const capture = useMutation({ mutationFn: async () => {
    if (!correct || !desktop.current) throw new Error("Открой вкладку «Детали» нужного водителя.");
    const phone = desktop.current.querySelector<HTMLInputElement>('[data-coach="driver-phone"] input');
    const licence = desktop.current.querySelector<HTMLInputElement>('[data-coach="driver-license"] input');
    if (!phone || !licence) throw new Error("Дождись загрузки карточки водителя.");
    if (phone.value.replace(/\D/g, "").slice(-10) !== task.incoming_phone?.replace(/\D/g, "").slice(-10)) throw new Error("Номера не совпадают. По этому звонку нельзя оформить смену номера.");
    await inspect.mutateAsync(selected.id);
    await saveCall.mutateAsync();
    desktop.current.querySelector<HTMLElement>(".fleet-main")?.scrollTo({ top: 0 });
    const image = await callSnapshot(desktop.current);
    return crmTraining.capture(task.key, image);
  }, onSuccess: value => { update(value); setPreview(false); } });
  const advice = useMutation({ mutationFn: () => crmTraining.action(task.key, { action: "advice", choices }), onSuccess: update });
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setScale(Math.max(.65, Math.min(1, node.clientWidth / WIDTH))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function go(path: string, nextPark = parkId) {
    const next = parseRoute(path); setRoute(next); setParkId(nextPark); setCopied(false);
    if (next.page === "driver" && next.id && (next.tab ?? "details") === "details") inspect.mutate(next.id);
  }
  const d = task.driver;
  if (!d) return <p>Начни урок, чтобы открыть учебный звонок.</p>;
  const mismatch = task.key === "crm_mismatch_v2";
  const error = capture.error ?? inspect.error ?? advice.error ?? saveCall.error;
  const busy = capture.isPending || inspect.isPending;
  return <section className="crm-panel crm-call-workspace" aria-label="Учебный звонок и диспетчерская">
    <div className="crm-call-brief"><div><span>Учебный звонок</span><h2>{task.title}</h2><p>«{task.speech}»</p></div><span className="crm-call-live">● Водитель на линии</span></div>
    <div className="crm-call-desktop-viewport" ref={viewport} style={{ height: HEIGHT * scale, "--crm-desktop-scale": scale } as CSSProperties}>
      <div className="crm-call-desktop" ref={desktop}>
        <section className="crm-call-oktell" aria-label="OKTEL — учебное окно">
          <header className="crm-call-window-bar"><span>☰</span><strong>OKTEL</strong><small>Учебный звонок</small></header>
          <div className="crm-oktell-form">
            <p className="crm-oktell-park">{park?.name ?? d.park}</p>
            <div className="crm-oktell-identity"><label htmlFor="crm-call-phone">Номер телефона</label><label htmlFor="crm-call-name">ФИО</label>
              <input id="crm-call-phone" value={task.incoming_phone ?? ""} readOnly />
              <input id="crm-call-name" value={d.name} readOnly />
            </div>
            <label htmlFor="crm-call-note">Заметка</label><input id="crm-call-note" value={note} onChange={e => setNote(e.target.value)} onBlur={() => saveCall.mutate()} placeholder="Ссылка на аккаунт водителя" />
            <label htmlFor="crm-call-result">Результат звонка</label><select id="crm-call-result" value={result} onChange={e => setResult(e.target.value)} onBlur={() => saveCall.mutate()}><option>Успешный звонок</option><option>Перезвонить</option><option>Не удалось связаться</option></select>
          </div>
          <div className="crm-oktell-request"><strong>Просьба водителя</strong><p>{mismatch ? "Смена номера при звонке с другого телефона" : <>Новый номер: <b>{d.new_phone}</b></>}</p></div>
        </section>
        <section className="crm-call-dispatch" aria-label="Диспетчерская — учебное окно">
          <div className="crm-call-browser-bar"><button type="button" aria-label="Назад к исполнителям" disabled={route.page === "contractors"} onClick={() => go("contractors")}>←</button><span className="crm-call-browser-address" title={address}>▣ {address.replace("https://", "")}</span><button type="button" aria-label={copied ? "Ссылка скопирована" : "Скопировать ссылку на аккаунт"} title="Скопировать ссылку на аккаунт" disabled={!selected} onClick={() => void copyText(address).then(ok => setCopied(ok))}>{copied ? "✓" : "⧉"}</button></div>
          <DispatchSite route={route} parkId={parkId} go={go} onResult={() => {}} />
        </section>
      </div>
    </div>
    <p className="crm-call-small-screen">На узком экране рабочие окна можно прокручивать по горизонтали.</p>
    {!!error && <p role="alert" className="crm-course-feedback">{error instanceof Error ? error.message : "Не удалось выполнить действие. Повтори."}</p>}
    {mismatch ? <div className="crm-course-advice"><h3>Что предложишь водителю?</h3>{ADVICE.map(([key, label]) => <label key={key}><input type="checkbox" checked={choices.includes(key)} onChange={e => setChoices(values => e.target.checked ? [...values, key] : values.filter(v => v !== key))} />{label}</label>)}<button className="crm-primary" disabled={advice.isPending || !correct || inspect.isPending} onClick={() => advice.mutate()}>Ответить водителю</button></div>
    : <div className="crm-call-capture"><div className="crm-call-capture-actions"><button className="crm-primary" disabled={!correct || busy} onClick={() => capture.mutate()}>{capture.isPending ? "Делаем снимок…" : task.capture ? "Сделать новый снимок" : "Сделать снимок"}</button>{task.capture && <><button className="crm-secondary" onClick={() => setPreview(v => !v)} aria-expanded={preview}>{preview ? "Скрыть снимок" : "Посмотреть снимок"}</button><button className="crm-primary" onClick={onForm}>{task.appeal_id ? "Заменить снимок в обращении" : "Перейти к оформлению обращения"}</button></>}</div>
      <p>{!correct ? "Справа найди водителя из звонка и открой его карточку → «Детали»." : !task.capture ? `Сравни номер телефона в OKTEL слева и в карточке ${fullName(selected!)} справа. Затем сделай один снимок.` : "Снимок сохранён. Прикрепи его в форме обращения."}</p>
      {task.capture && preview && <img src={task.capture.data_url} alt="Снимок рабочих окон: OKTEL слева и карточка водителя справа" />}
    </div>}
  </section>;
}
