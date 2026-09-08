import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { telegram } from "../api/telegram";
import { Sheet } from "./Sheet";
import { Button, Card } from "./ui";

export function TelegramCard() {
  useEffect(() => { if (window.location.hash === "#telegram") document.getElementById("telegram")?.scrollIntoView({ block: "start" }); }, []);
  const client = useQueryClient();
  const [mode, setMode] = useState<"link" | "disconnect" | null>(null);
  const [password, setPassword] = useState("");
  const [invitation, setInvitation] = useState<{ url: string; expires_at: string; previous: string | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const fieldId = useId();
  const query = useQuery({ queryKey: ["telegram-link"], queryFn: telegram.status, refetchInterval: invitation && now < Date.parse(invitation.expires_at) ? 2000 : false });
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
  function open(next: "link" | "disconnect") {
    setMode(next); setPassword(""); setInvitation(null); link.reset(); disconnect.reset(); setNow(Date.now());
  }
  return <Card id="telegram" title="Telegram для входа" subtitle="Коды для Driver Simulator приходят в ваш личный чат с ботом">
    <div className="stack stack--tight">
      {query.isLoading ? <p role="status">Проверяем подключение…</p> : query.isError ? <><p role="alert" className="field__error">{query.error.message}</p><Button onClick={() => query.refetch()}>Повторить</Button></> : <>
        <p role="status">{query.data?.connected ? `Подключён${query.data.username ? ` · @${query.data.username}` : ""}` : "Telegram ещё не подключён"}</p>
        {!query.data?.configured && <p className="muted">Администратору нужно завершить настройку бота на сервере.</p>}
        <div className="stack stack--tight">
          <Button disabled={!query.data?.configured} onClick={() => open("link")}>{query.data?.connected ? "Сменить Telegram" : "Подключить Telegram"}</Button>
          {query.data?.connected && <Button onClick={() => open("disconnect")}>Отключить</Button>}
        </div>
        {query.data?.connected && <Link to="/simulator">Вернуться в Driver Simulator →</Link>}
      </>}
    </div>
    {mode && <Sheet title={mode === "link" ? "Подключить Telegram" : "Отключить Telegram"} size="s" onClose={() => { if (!busy) { setMode(null); setPassword(""); setInvitation(null); } }}>
      {invitation && now < Date.parse(invitation.expires_at) ? <div className="stack">
        <p>Откройте @{query.data?.bot_username} по этой личной ссылке и нажмите «Запустить» в Telegram. Затем вернитесь сюда.</p>
        <a className="btn btn--primary" href={invitation.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть бота в Telegram</a>
        <p className="muted">Ссылка действует 10 минут. Не передавайте её другим людям.</p>
        <p role="status">Ожидаем подключения…</p>
        <Button onClick={() => query.refetch()}>Проверить подключение</Button>
        {query.isError && <p className="field__error" role="alert">{query.error.message}</p>}
      </div> : <form className="stack" onSubmit={(event) => { event.preventDefault(); if (!busy) (mode === "link" ? link : disconnect).mutate(); }}>
        <p>{mode === "disconnect" ? "Коды перестанут приходить. Подтверждение браузеров будет сброшено." : "Подтвердите действие паролем Puls. При подключении другого Telegram браузеры потребуется подтвердить заново."}</p>
        {invitation && <p role="status">Ссылка истекла. Получите новую.</p>}
        <label className="field" htmlFor={fieldId}><span className="field__label">Текущий пароль Puls</span><input id={fieldId} className="input" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error instanceof Error && <p className="field__error" role="alert">{error.message}</p>}
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Подождите…" : mode === "link" ? "Получить личную ссылку" : "Отключить Telegram"}</Button>
      </form>}
    </Sheet>}
  </Card>;
}
