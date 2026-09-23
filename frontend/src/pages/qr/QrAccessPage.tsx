import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { workSitesAccess, type QrRecipient } from "../../api/workSitesAccess";
import { Button, Avatar } from "../../components/ui";
import { QrIcon } from "../../components/icons";
import { dateTime } from "../../utils/format";
import { QrScanner } from "./QrScanner";
import "./qr-access.css";

export function QrAccessPage() {
  const [payload, setPayload] = useState(""), [manual, setManual] = useState("");
  const [recipient, setRecipient] = useState<QrRecipient | null>(null);
  const [scanning, setScanning] = useState(true);
  const preview = useMutation({ mutationFn: workSitesAccess.preview, onSuccess: setRecipient });
  const approve = useMutation({ mutationFn: workSitesAccess.approve });
  function read(value: string) { setScanning(false); setPayload(value.trim()); preview.mutate(value.trim()); }
  function reset() { preview.reset(); approve.reset(); setRecipient(null); setPayload(""); setManual(""); setScanning(true); }
  return <div className="qr-approval-page"><header className="page-head"><div><h1 className="page-title">QR-доступ</h1><p className="page-subtitle">Подтверждение доступа операторов к Рабочим сайтам</p></div><QrIcon size={30} /></header>
    {scanning && <><QrScanner onRead={read} /><details className="qr-manual"><summary>Ввести код вручную</summary><form onSubmit={e => { e.preventDefault(); if (manual.trim()) read(manual); }}><label className="field"><span>Код с экрана оператора</span><input className="input" autoComplete="off" maxLength={150} value={manual} onChange={e => setManual(e.target.value)} placeholder="puls:work-sites:…" required /></label><Button type="submit" variant="primary">Проверить код</Button></form></details></>}
    {!scanning && <section className="qr-confirm-card">
      {preview.isPending && <p role="status">Проверяем, кому открыть доступ…</p>}
      {preview.isError && <><h2>Код не подходит</h2><p className="qr-inline-error" role="alert">{preview.error.message}</p><Button onClick={reset}>Сканировать заново</Button></>}
      {recipient && (approve.isSuccess ? <div className="qr-approved" role="status"><div className="qr-success-mark">✓</div><h2>Доступ открыт</h2><p>{approve.data.full_name} теперь может открыть Рабочие сайты на своём устройстве.</p><Button variant="primary" onClick={reset}>Следующий оператор</Button></div> : <><Avatar id={recipient.user_id} name={recipient.full_name} size={76} /><p className="qr-eyebrow">ПОДТВЕРЖДЕНИЕ ОПЕРАТОРА</p><h2>{recipient.full_name}</h2><p className="secondary">{recipient.login}</p><div className="qr-recipient-info"><strong>Рабочие сайты</strong><span>До выхода из текущего аккаунта на устройстве оператора</span><small>Запрос создан {dateTime(recipient.requested_at)}</small><details><summary>Устройство</summary><p>{recipient.device}</p></details></div><p>Проверьте имя сотрудника перед подтверждением.</p><div className="qr-confirm-actions"><Button block variant="primary" disabled={approve.isPending} onClick={() => approve.mutate(payload)}>{approve.isPending ? "Открываем…" : "Открыть доступ"}</Button><Button block disabled={approve.isPending} onClick={reset}>Отмена</Button></div>{approve.isError && <p className="qr-inline-error" role="alert">{approve.error.message}</p>}</>)}
    </section>}
    <p className="qr-session-note">Сканирование показывает сотрудника. Доступ выдаётся только после вашего подтверждения и только к Рабочим сайтам.</p>
  </div>;
}
