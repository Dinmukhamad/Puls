import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { telegram, type TelegramInvitation } from "../api/telegram";
import { useAccess } from "../auth/AccessContext";
import { parseTimestamp } from "../utils/format";
import { Sheet } from "./Sheet";
import { Button } from "./ui";
import { TelegramIcon } from "./icons";

export function TelegramCard() {
  const location = useLocation();
  useEffect(() => { if (location.hash === "#telegram") document.getElementById("telegram")?.scrollIntoView({ block: "center" }); }, [location.hash]);
  const { can } = useAccess();
  const training = can("training");
  const client = useQueryClient();
  const [mode, setMode] = useState<"settings" | "link" | "disconnect" | null>(null);
  const [password, setPassword] = useState("");
  const [invitation, setInvitation] = useState<(TelegramInvitation & { previous: string | null }) | null>(null);
  const [now, setNow] = useState(Date.now());
  const fieldId = useId();
  const invitationActive = invitation && now < parseTimestamp(invitation.expires_at).getTime();
  const query = useQuery({ queryKey: ["telegram-link"], queryFn: telegram.status, refetchInterval: (query) => invitationActive ? 2000 : query.state.data?.pending_username ? 5000 : false });
  const link = useMutation({ mutationFn: () => telegram.link(password), onSuccess: (data) => {
    setInvitation({ ...data, previous: query.data?.linked_at ?? null }); setPassword("");
  } });
  const disconnect = useMutation({ mutationFn: () => telegram.disconnect(password), onSuccess: (data) => {
    client.setQueryData(["telegram-link"], data);
    void client.invalidateQueries({ queryKey: ["driver-profile"] });
    setMode(null); setPassword(""); setInvitation(null);
  } });
  useEffect(() => {
    if (!invitation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [invitation]);
  useEffect(() => {
    if (invitation && query.data?.connected && query.data.linked_at !== invitation.previous) {
      setInvitation(null); setMode(null);
      void client.invalidateQueries({ queryKey: ["driver-profile"] });
    }
  }, [invitation, query.data, client]);
  const busy = link.isPending || disconnect.isPending;
  const error = mode === "disconnect" ? disconnect.error : link.error;
  function open(next: "settings" | "link" | "disconnect") {
    setMode(next); setPassword(""); setInvitation(null); link.reset(); disconnect.reset(); setNow(Date.now());
  }
  const status = query.isLoading ? "Проверяем подключение…" : query.isError ? "Не удалось проверить подключение" : query.data?.connected ? `Подключён${query.data.username ? ` · @${query.data.username}` : ""}` : query.data?.pending_username ? `Ожидает подтверждения · @${query.data.pending_username}` : "Не подключён";
  return <>
    <div id="telegram" className="profile-setting">
      <span className="profile-setting__icon"><TelegramIcon /></span>
      <div className="profile-setting__text"><h3>Telegram</h3><p role={query.isError ? "alert" : "status"}>{status}</p></div>
      <Button size="s" disabled={query.isLoading || query.isFetching && query.isError} aria-label={query.isError ? "Проверить подключение Telegram повторно" : "Настроить Telegram"} onClick={() => query.isError ? void query.refetch() : open("settings")}>{query.isError ? "Повторить" : query.data?.connected ? "Настроить" : "Подключить"}</Button>
    </div>
    {mode && <Sheet title={mode === "settings" ? "Telegram" : mode === "link" ? "Подключить Telegram" : "Отключить Telegram"} size="s" onClose={() => { if (!busy) { setMode(null); setPassword(""); setInvitation(null); } }}>
      {mode === "settings" ? <div className="stack stack--tight">
        <p className="secondary small">{training ? "Коды для входа в Driver Simulator приходят в ваш личный чат с ботом Puls." : "Подключите личный чат с ботом Puls."}</p>
        <p role="status">{status}</p>
        {!query.data?.connected && query.data?.pending_username && <p className="small secondary">Откройте личную ссылку, которую вам передал сотрудник, и нажмите «Запустить» в Telegram. Если ссылка истекла, получите новую.</p>}
        {!query.data?.configured && <p className="ui-note">Подключение пока недоступно. Обратитесь к администратору, чтобы настроить бота.</p>}
        <div className="row"><Button size="s" disabled={!query.data?.configured} onClick={() => open("link")}>{query.data?.connected ? "Сменить Telegram" : query.data?.pending_username ? "Получить новую ссылку" : "Подключить Telegram"}</Button>{query.data?.connected && <Button size="s" variant="destructive" onClick={() => open("disconnect")}>Отключить</Button>}</div>
        {query.data?.connected && training && <Link to="/simulator">Вернуться в Driver Simulator →</Link>}
      </div> : invitation && invitationActive ? <div className="stack">
        <p>Откройте @{query.data?.bot_username} по этой личной ссылке и нажмите «Запустить» в Telegram. Затем вернитесь сюда.</p>
        <a className="btn btn--primary" href={invitation.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть бота в Telegram</a>
        <p className="muted">Ссылка действует 10 минут. Не передавайте её другим людям.</p>
        <p role="status">Ожидаем подключения…</p>
        <Button onClick={() => query.refetch()}>Проверить подключение</Button>
        {query.isError && <p className="field__error" role="alert">{query.error.message}</p>}
      </div> : <form className="stack" onSubmit={(event) => { event.preventDefault(); if (!busy) (mode === "link" ? link : disconnect).mutate(); }}>
        <p>{mode === "disconnect" ? "Коды перестанут приходить. Подтверждение браузеров будет сброшено." : "Подтвердите действие паролем Puls. При подключении другого Telegram браузеры потребуется подтвердить заново."}</p>
        {invitation && <p role="status">Ссылка истекла. Получите новую.</p>}
        <label className="field" htmlFor={fieldId}><span className="field__label">Текущий пароль Puls</span><input id={fieldId} className="input" type="password" autoComplete="current-password" autoFocus required maxLength={128} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error instanceof Error && <p className="field__error" role="alert">{error.message}</p>}
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Подождите…" : mode === "link" ? "Получить личную ссылку" : "Отключить Telegram"}</Button>
      </form>}
    </Sheet>}
  </>;
}
