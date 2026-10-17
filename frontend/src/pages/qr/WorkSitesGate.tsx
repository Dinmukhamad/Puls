import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { workSitesAccess } from "../../api/workSitesAccess";
import { useAuth } from "../../auth/AuthContext";
import { Avatar, Button, ErrorState, Skeleton } from "../../components/ui";
import { CheckIcon, QrIcon, ShieldIcon } from "../../components/icons";
import { QrImage } from "./QrImage";
import { clock, QR_LIFETIME_SECONDS, runningOut, secondsLeft } from "./qrPresentation";
import "./qr-access.css";

/** How long the operator sees «Доступ открыт» before the work sites replace it. */
const OPENED_PAUSE_MS = 1400;

export function WorkSitesGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === "operator" ? <OperatorGate key={user.id}>{children}</OperatorGate> : children;
}

/**
 * The operator's pass: their QR with its five minutes running out, whose it is and what happens next. Staff scan it
 * in «QR-доступ»; the work sites open here by themselves once the server grants this session.
 */
function OperatorGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [now, setNow] = useState(Date.now());
  const status = useQuery({ queryKey: ["work-sites-access"], queryFn: workSitesAccess.status,
    staleTime: 0, gcTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    refetchInterval: query => query.state.data?.granted ? false : 2500 });
  // A grant that arrives while a QR is on screen is shown for a moment, so the operator sees it worked.
  const [waited, setWaited] = useState(false), [settled, setSettled] = useState(false);
  const issue = useMutation({ mutationFn: workSitesAccess.issue, onSuccess: data => { setNow(Date.now()); if (data.payload) setWaited(true); void status.refetch(); } });
  const payload = issue.data?.payload;
  const seconds = secondsLeft(issue.data?.expires_at, now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const granted = !!status.data?.granted;
  useEffect(() => {
    if (!granted || !waited) return;
    const timer = window.setTimeout(() => setSettled(true), OPENED_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [granted, waited]);
  if (status.isPending) return <div className="qr-gate-page"><Skeleton height={420} /></div>;
  // Never mount the CRM (and its data requests) until the server grants this session.
  if (granted && (!waited || settled)) return children;
  const live = !!payload && seconds > 0, expired = !!payload && !seconds;
  // Once granted every step is done.
  const step = granted ? 4 : live ? 2 : 1;
  return <div className="qr-gate-page"><Link className="qr-back" to="/training/city">← Обучение</Link>
    <section className="qr-gate glass glass--prominent" aria-labelledby="qr-gate-title">
      <header className="qr-gate__head">
        <span className="qr-badge"><ShieldIcon size={15} />Доступ с подтверждением</span>
        <h1 id="qr-gate-title">Рабочие сайты</h1>
        <p className="qr-intro">Покажите QR сотруднику. Как только он подтвердит, рабочее окно откроется здесь само.</p>
      </header>

      <div className="qr-gate__pass">
        {granted ? <div className="qr-ticket qr-ticket--opened" role="status">
          <span className="qr-done-mark" aria-hidden="true"><CheckIcon size={40} /></span>
          <strong>Доступ открыт</strong><span>Открываем Рабочие сайты…</span>
        </div> : <div className={`qr-ticket${live ? " is-live" : ""}${expired ? " is-expired" : ""}`}>
          <div className="qr-ticket__code">
            {payload ? <QrImage payload={payload} /> : <div className="qr-ticket__empty" aria-hidden="true"><QrIcon size={44} /></div>}
            <i className="qr-corner qr-corner--tl" /><i className="qr-corner qr-corner--tr" /><i className="qr-corner qr-corner--bl" /><i className="qr-corner qr-corner--br" />
            {expired && <div className="qr-ticket__veil"><strong>Время вышло</strong><span>Создайте новый QR</span></div>}
          </div>
          {live ? <div className={`qr-timer${runningOut(seconds) ? " is-ending" : ""}`}>
            <div className="qr-timer__row"><span className="qr-live"><i aria-hidden="true" />Ждём подтверждения</span><strong aria-label={`Осталось ${clock(seconds)}`}>{clock(seconds)}</strong></div>
            <div className="qr-timer__track" aria-hidden="true"><span style={{ width: `${seconds / QR_LIFETIME_SECONDS * 100}%` }} /></div>
          </div> : !payload && <p className="qr-ticket__hint">Здесь появится ваш QR. Он действует 5 минут.</p>}
          {user && <div className="qr-owner"><Avatar id={user.id} name={user.full_name} size={36} /><span><strong>{user.full_name}</strong><small>{user.login}</small></span></div>}
        </div>}
      </div>

      <ol className="qr-gate__steps" aria-label="Как открыть доступ">
        {["Создайте QR на этом устройстве", "Покажите его тренеру, супервайзеру, руководителю или администратору", "Рабочие сайты откроются здесь сами"].map((text, i) =>
          <li key={text} data-state={i + 1 < step ? "done" : i + 1 === step ? "current" : "next"}>
            <span className="qr-step-mark" aria-hidden="true">{i + 1 < step ? <CheckIcon size={14} /> : i + 1}</span>{text}
          </li>)}
      </ol>

      <div className="qr-gate__actions">
        {status.isError ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : !granted && <>
          <Button block variant={live ? "secondary" : "primary"} disabled={issue.isPending} onClick={() => issue.mutate()}>{issue.isPending ? "Создаём QR…" : payload ? "Создать новый QR" : "Сгенерировать QR"}</Button>
          {issue.isError && <p className="qr-inline-error" role="alert">{issue.error.message}</p>}
          {live && <details className="qr-manual"><summary>Не получается отсканировать?</summary><p>Сотрудник может ввести этот код вручную в разделе «QR-доступ».</p>
            <div className="qr-manual__row"><input aria-label="Код доступа для ручного ввода" readOnly value={payload} onFocus={e => e.target.select()} /><Button onClick={() => { void navigator.clipboard?.writeText(payload).catch(() => {}); }}>Скопировать</Button></div></details>}
        </>}
      </div>
      <p className="qr-session-note qr-gate__note">Доступ действует до выхода из аккаунта и только в этом браузере или приложении. На другом устройстве понадобится новое подтверждение.</p>
    </section></div>;
}
