import { useState } from "react";
import { fleet as api, type FleetTicket } from "../../api/dispatch";
import { Drawer, FleetHead, Icon, useFleet } from "./FleetUi";
import { parkTitle, shortDate } from "./fleetNav";

const DRIVER_THEME = "Вопросы об исполнителе";

/** «Техподдержка → Мои обращения»: questions to Яндекс support and the new-ticket panel. */
export function SupportPage() {
  const { state, park } = useFleet();
  const [creating, setCreating] = useState(false), [open, setOpen] = useState<FleetTicket | null>(null), [status, setStatus] = useState("");
  const tickets = state.tickets.filter(t => (!status || t.status === status));
  return <div className="fleet-page"><FleetHead title="Мои обращения">
    <button className="fleet-add" data-coach="support-add" aria-label="Новое обращение" onClick={() => setCreating(true)}><Icon name="plus" /></button>
  </FleetHead>
    <p className="fleet-note">Обращения в поддержку Яндекса. Перед «+» проверьте парк в правом верхнем углу: сейчас <strong>{parkTitle(park)}</strong>.</p>
    <div className="fleet-chips"><span className="fleet-chip is-static">📅 Последний месяц</span>
      <label className="fleet-chip fleet-chip-select"><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Статус обращения"><option value="">Любой статус</option><option>В работе</option><option>Выполнен</option><option>Закрыт</option></select></label></div>
    <div className="fleet-table-card fleet-scroll"><table className="fleet-table fleet-tickets" data-coach="tickets-table">
      <thead><tr><th><span className="fleet-sr">Новое</span></th><th>Вопрос</th><th>Статус</th><th>Автор</th><th>Обновлено</th><th>Создано</th></tr></thead>
      <tbody>{tickets.map(t => <tr key={t.id} className={t.mine ? "is-mine" : ""} onClick={() => setOpen(t)}>
        <td>{t.mine && t.status === "Выполнен" && <i className="fleet-unread" aria-label="Есть ответ" />}</td>
        <td><button className="fleet-ticket" onClick={e => { e.stopPropagation(); setOpen(t); }}><Icon name="chat" /><span><strong>{t.question}</strong><small>{t.theme} • {t.subtheme}</small></span></button></td>
        <td><span className={`fleet-pill ${t.status === "В работе" ? "is-work" : t.status === "Выполнен" ? "is-done" : ""}`}><i />{t.status}</span></td>
        <td>{t.author}</td><td>{shortDate(t.updated_at)}</td><td>{shortDate(t.created_at)}</td>
      </tr>)}</tbody>
    </table></div>
    {creating && <NewTicket onClose={() => setCreating(false)} />}
    {open && <Drawer title="Обращение" subtitle={`${open.theme} • ${open.subtheme}`} onClose={() => setOpen(null)}>
      <p className="fleet-ticket-text">{open.question}</p>
      <dl className="fleet-facts"><div><dt>Статус</dt><dd>{open.status}</dd></div>{open.license && <div><dt>Номер в/у</dt><dd>{open.license}</dd></div>}<div><dt>Автор</dt><dd>{open.author}</dd></div><div><dt>Доступ</dt><dd>{open.private ? "Мне и моей роли" : "Всем сотрудникам парка"}</dd></div>{open.files.length > 0 && <div><dt>Файлы</dt><dd>{open.files.join(", ")}</dd></div>}</dl>
      {open.reply ? <div className="fleet-reply"><strong>Поддержка Яндекса</strong><p>{open.reply}</p></div> : open.mine && <p className="fleet-muted">Учебная поддержка отвечает через пару минут — статус сменится на «Выполнен».</p>}
    </Drawer>}
  </div>;
}

function NewTicket({ onClose }: { onClose: () => void }) {
  const { state, park, run } = useFleet();
  const [kind, setKind] = useState<"text" | "call">("text"), [privateAccess, setPrivate] = useState(false);
  const [theme, setTheme] = useState(""), [subtheme, setSubtheme] = useState(""), [license, setLicense] = useState(""), [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const needsLicense = theme === DRIVER_THEME && !!subtheme;
  const ready = !!theme && !!subtheme && text.trim().length >= 10 && (!needsLicense || license.trim().length >= 8);
  async function send() {
    setBusy(true); setError("");
    try { await run(() => api.ticket({ park: park.id, kind, private: privateAccess, theme, subtheme, license: needsLicense ? license : "", text, files }), "Обращение отправлено"); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Drawer title="Новое обращение" subtitle={`Парк: ${parkTitle(park)}`} coach="ticket-form" onClose={onClose}
    footer={<>{error && <p className="fleet-error" role="alert">{error}</p>}<button className="fleet-btn fleet-btn--yellow fleet-btn--wide" data-coach="support-send" disabled={busy || !ready} onClick={() => void send()}>{busy ? "Отправляем…" : "Отправить"}</button></>}>
    <div className="fleet-form">
      <fieldset className="fleet-kinds" data-coach="support-kind"><legend>Тип</legend>
        {([["text", "Текстовое обращение", "Ответим через ~5 минут"], ["call", "Обратный звонок", "Позвоним через ~10 минут"]] as const).map(([id, label, note]) => <label key={id} className={kind === id ? "is-on" : ""}><input type="radio" name="ticket-kind" checked={kind === id} onChange={() => setKind(id)} /><span><strong>{label}</strong><small>{note}</small></span><i aria-hidden="true">{kind === id ? "✓" : ""}</i></label>)}
      </fieldset>
      <label className="fleet-toggle-row" data-coach="support-private" data-on={privateAccess}><span>Доступ: мне и моей роли</span><input type="checkbox" checked={privateAccess} onChange={e => setPrivate(e.target.checked)} /></label>
      <label className="fleet-float is-filled"><span>Email</span><input value={state.login} readOnly aria-readonly="true" /></label>
      <label className={`fleet-float${theme ? " is-filled" : ""}`} data-coach="support-theme"><span>Тема</span><select value={theme} onChange={e => { setTheme(e.target.value); setSubtheme(""); }}><option value="" disabled hidden />{Object.keys(state.catalog.themes).map(t => <option key={t}>{t}</option>)}</select></label>
      {theme && <label className={`fleet-float${subtheme ? " is-filled" : ""}`} data-coach="support-subtheme"><span>Подтема</span><select value={subtheme} onChange={e => setSubtheme(e.target.value)}><option value="" disabled hidden />{state.catalog.themes[theme].map(t => <option key={t}>{t}</option>)}</select></label>}
      {subtheme === "Ограничение доступа к сервису" && <p className="fleet-field-hint fleet-link-like">Информация про ограничения: снять их может только поддержка Яндекса, поэтому обращение пишем сюда.</p>}
      {needsLicense && <label className={`fleet-float${license ? " is-filled" : ""}`} data-coach="support-license"><span>Номер в/у</span><input value={license} maxLength={12} onChange={e => setLicense(e.target.value.toUpperCase())} /></label>}
      {subtheme && <label className={`fleet-float is-area${text ? " is-filled" : ""}`} data-coach="support-text"><span>Текст обращения</span><textarea rows={5} value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder="ДД! Прошу проверить…" /></label>}
      {subtheme && <div className="fleet-files" data-coach="support-files"><strong>Файлы</strong>
        <label className="fleet-chip"><Icon name="clip" /> Максимум 8 файлов<input type="file" multiple className="fleet-sr" onChange={e => { const names = [...(e.target.files ?? [])].map(f => f.name.slice(0, 120)); setFiles(list => [...list, ...names].slice(0, 8)); e.target.value = ""; }} /></label>
        {files.map(name => <span key={name} className="fleet-file">{name}<button aria-label={`Убрать ${name}`} onClick={() => setFiles(list => list.filter(n => n !== name))}><Icon name="close" /></button></span>)}
        <small className="fleet-field-hint">В учебной среде уходят только названия файлов.</small></div>}
    </div>
  </Drawer>;
}
