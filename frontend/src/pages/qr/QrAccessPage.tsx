import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { workSitesAccess, type QrRecipient } from "../../api/workSitesAccess";
import { Avatar, Button, Card, SegmentedControl } from "../../components/ui";
import { CheckIcon, ClockIcon, KeyboardIcon, ShieldIcon } from "../../components/icons";
import { dateTime } from "../../utils/format";
import { QrScanner } from "./QrScanner";
import { clock, deviceName, runningOut, secondsLeft } from "./qrPresentation";
import "./qr-access.css";

type Mode = "camera" | "manual";
interface Approved { id: number; name: string; at: number }

/**
 * Staff confirm an operator's access to the work sites (docs/WORK_SITES_QR.md): the camera or the typed code finds
 * whose QR it is, the pass shows them, and only «Открыть доступ» grants it. Who was let in during this visit stays
 * listed beside, for a trainer letting in a whole group.
 */
export function QrAccessPage() {
  const [mode, setMode] = useState<Mode>("camera");
  const [payload, setPayload] = useState(""), [manual, setManual] = useState("");
  const [approved, setApproved] = useState<Approved[]>([]);
  const preview = useMutation({ mutationFn: workSitesAccess.preview });
  const approve = useMutation({ mutationFn: workSitesAccess.approve,
    onSuccess: result => setApproved(list => [{ id: result.user_id, name: result.full_name, at: Date.now() }, ...list.filter(item => item.id !== result.user_id)].slice(0, 8)) });
  function read(value: string) { const code = value.trim(); setPayload(code); preview.mutate(code); }
  function reset() { preview.reset(); approve.reset(); setPayload(""); setManual(""); }
  const checking = !!payload;
  return <div className="stack qr-approval-page">
    <header className="page-head"><div><h1 className="page-title">QR-доступ</h1><p className="page-subtitle">Подтверждение доступа операторов к Рабочим сайтам</p></div></header>
    <div className="qr-approval-layout">
      <section className="qr-station glass glass--prominent" aria-label={checking ? "Подтверждение доступа" : mode === "camera" ? "Сканер QR-кода" : "Ввод кода вручную"}>
        {!checking && <SegmentedControl block label="Как проверить код" value={mode} onChange={setMode}
          options={[{ value: "camera", label: "Камера" }, { value: "manual", label: "Ввести код" }]} />}
        {!checking ? mode === "camera" ? <QrScanner onRead={read} onManual={() => setMode("manual")} />
          : <ManualEntry value={manual} onChange={setManual} onSubmit={() => { if (manual.trim()) read(manual); }} />
          : <div className="qr-verdict">
            {preview.isPending && <div className="qr-checking" role="status"><span className="qr-spinner" aria-hidden="true" />Проверяем, кому открыть доступ…</div>}
            {preview.isError && <div className="qr-outcome"><span className="qr-result-mark qr-result-mark--error" aria-hidden="true">!</span><h2>Код не подходит</h2>
              <p className="qr-outcome__text" role="alert">{preview.error.message}</p><Button variant="primary" onClick={reset}>{mode === "camera" ? "Сканировать заново" : "Ввести другой код"}</Button></div>}
            {preview.data && (approve.isSuccess
              ? <div className="qr-outcome" role="status"><span className="qr-result-mark qr-result-mark--done" aria-hidden="true"><CheckIcon size={38} /></span><h2>Доступ открыт</h2>
                <p className="qr-outcome__text"><strong>{approve.data.full_name}</strong> уже видит Рабочие сайты на своём устройстве.</p><Button variant="primary" onClick={reset}>Следующий оператор</Button></div>
              : <Pass recipient={preview.data} pending={approve.isPending} error={approve.isError ? approve.error.message : null} onApprove={() => approve.mutate(payload)} onCancel={reset} />)}
          </div>}
      </section>
      <aside className="qr-approval-side">
        <Card title="Как подтвердить доступ">
          <ol className="qr-steps">
            <li>Оператор открывает «Рабочие сайты» и показывает QR на своём экране.</li>
            <li>Наведите камеру на код или введите его вручную — сотрудник определится сам.</li>
            <li>Сверьте имя с человеком перед вами и нажмите «Открыть доступ».</li>
          </ol>
        </Card>
        {approved.length > 0 && <Card title="Подтверждены сейчас" subtitle="За это открытие страницы">
          <ul className="qr-approved-list">{approved.map(item => <li key={item.id}><Avatar id={item.id} name={item.name} size={32} /><span className="qr-approved-list__name">{item.name}</span>
            <time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ul>
        </Card>}
        <p className="qr-session-note qr-session-note--side"><ShieldIcon size={16} />Сканирование только показывает сотрудника. Доступ выдаётся после вашего подтверждения и только к Рабочим сайтам.</p>
      </aside>
    </div>
  </div>;
}

function ManualEntry({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit: () => void }) {
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
  return <form className="qr-manual-entry" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
    <span className="qr-manual-entry__icon" aria-hidden="true"><KeyboardIcon size={28} /></span>
    <h2>Код с экрана оператора</h2>
    <p>Если камера не включается или код не считывается: оператор нажимает «Не получается отсканировать?» под своим QR и передаёт код.</p>
    <label className="qr-manual-entry__field"><span className="sr-only">Код с экрана оператора</span>
      <input className="input" autoComplete="off" spellCheck={false} maxLength={150} value={value} onChange={e => onChange(e.target.value)} placeholder="puls:work-sites:…" required autoFocus />
      {canPaste && <Button onClick={() => { void navigator.clipboard.readText().then(text => onChange(text.trim())).catch(() => {}); }}>Вставить</Button>}
    </label>
    <Button type="submit" variant="primary" block disabled={!value.trim()}>Проверить код</Button>
  </form>;
}

/** Whose QR it is, on what and for how much longer: the staff member compares it with the person in front of them. */
function Pass({ recipient, pending, error, onApprove, onCancel }: { recipient: QrRecipient; pending: boolean; error: string | null; onApprove: () => void; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = secondsLeft(recipient.expires_at, now);
  return <div className="qr-pass">
    <div className="qr-pass__top"><span className="qr-badge"><ShieldIcon size={15} />Запрос доступа</span>
      <span className={`qr-chip${!seconds ? " is-expired" : runningOut(seconds) ? " is-ending" : ""}`}><ClockIcon size={14} />{seconds ? `Код ещё ${clock(seconds)}` : "Код истёк"}</span></div>
    <div className="qr-pass__person"><Avatar id={recipient.user_id} name={recipient.full_name} size={84} /><h2>{recipient.full_name}</h2><p>{recipient.login}</p></div>
    <dl className="qr-pass__facts">
      <div><dt>Раздел</dt><dd>{recipient.section}</dd></div>
      <div><dt>Действует</dt><dd>До выхода из аккаунта на этом устройстве</dd></div>
      <div><dt>Устройство</dt><dd title={recipient.device}>{deviceName(recipient.device)}</dd></div>
      <div><dt>QR создан</dt><dd>{dateTime(recipient.requested_at)}</dd></div>
    </dl>
    <p className="qr-pass__hint">Сверьте имя и логин с сотрудником перед вами.</p>
    <div className="qr-pass__actions">
      <Button block variant="primary" disabled={pending || !seconds} onClick={onApprove}>{pending ? "Открываем…" : "Открыть доступ"}</Button>
      <Button block disabled={pending} onClick={onCancel}>Отмена</Button>
    </div>
    {!seconds && <p className="qr-inline-error" role="alert">Время кода вышло. Попросите оператора создать новый QR.</p>}
    {error && <p className="qr-inline-error" role="alert">{error}</p>}
  </div>;
}
