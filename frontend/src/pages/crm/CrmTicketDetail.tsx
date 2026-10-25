import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crm, type CrmTicket } from "../../api/crm";
import { crmTrainingKey } from "../../api/crmTraining";
import { useCrmDraft } from "./useCrmDraft";
import { crmDate } from "./CrmAppealList";

const STATUS: Record<string, string> = { new: "Новый", awaiting_reply: "Ожидает предоставление ответа", moderation: "Модерация", rework: "На доработке" };
const ACTION: Record<string, string> = { moderate: "Модерация", rework: "Возвращён на доработку", comment: "Комментарий добавлен", ooz_review: "Проверено ООЗ" };
export function CrmTicketDetail({ id, userId, onAppeal }: { id: number; userId?: number; onAppeal: (id: number) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["crm-ticket", id], queryFn: () => crm.ticket(id), retry: false });
  const [modal, setModal] = useState(false), [fileError, setFileError] = useState("");
  const draft = useCrmDraft({ enabled: modal, userId, ticketId: id, initial: { request_id: crypto.randomUUID(), channel: "Звонок", phone: "", license_number: "", driver_id: "", contacted_at: "", park: "", city: "", category_ids: [], details: {}, comment: "", is_ticket: false } });
  const comment = draft.form.comment, files = draft.files.map(entry => entry.file);
  const request = useRef<{ action: string; comment: string; revision: number; id: string }>();
  const input = useRef<HTMLInputElement>(null), area = useRef<HTMLTextAreaElement>(null), opener = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null);
  const [uncertain, setUncertain] = useState(false);
  const mutation = useMutation({ mutationFn: async ({ item, action }: { item: CrmTicket; action: "moderate" | "rework" | "comment" }) => {
    const confirmed = action === "comment" ? await draft.flush() : null;
    const text = action === "comment" ? confirmed!.form.comment : "";
    const old = request.current;
    const same = old?.action === action && old.comment === text && old.revision === item.revision;
    if (!same) request.current = { action, comment: text, revision: item.revision, id: crypto.randomUUID() };
    return crm.ticketAction(id, { action, comment: text, revision: item.revision, request_id: request.current!.id, ...(confirmed ? { draft_key: confirmed.draftKey!, draft_revision: confirmed.revision } : {}) });
  }, onSuccess: async item => {
    client.setQueryData(["crm-ticket", id], item); void client.invalidateQueries({ queryKey: crmTrainingKey(userId) });
    request.current = undefined; setUncertain(false); setModal(false); if (draft.ready) await draft.clear().catch(() => {}); opener.current?.focus();
  }, onError: error => { if (request.current && (!("status" in error) || Number(error.status) === 0 || Number(error.status) >= 500)) setUncertain(true); } });
  useEffect(() => { if (query.data) void client.invalidateQueries({ queryKey: crmTrainingKey(userId) }); }, [query.data, client, userId]);
  // Поле включается, когда черновик загрузился: фокус ставим тогда, а не на ещё выключенное поле.
  useEffect(() => { if (modal && draft.ready) area.current?.focus(); }, [modal, draft.ready]);
  function attach(incoming: File[]) {
    setFileError("");
    if (files.length + draft.attachments.length + incoming.length > 5 || incoming.some(f => f.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(f.type))) { setFileError("До 5 файлов, каждый до 2 МБ: PNG, JPEG, WebP или PDF."); return; }
    draft.addFiles(incoming);
  }
  if (query.isPending) return <p role="status">Открываем тикет…</p>;
  if (query.isError) return <div role="alert"><p>{query.error.message}</p><button className="crm-secondary" onClick={() => void query.refetch()}>Повторить</button></div>;
  const item = query.data;
  // A ticket left behind when its lesson started over keeps its history but takes no lesson actions.
  const actions = item.in_lesson !== false;
  const left = !actions && ["awaiting_reply", "moderation", "rework"].includes(item.status) && !item.events.some(event => event.action === "comment");
  return <section className="crm-panel crm-ticket-detail">
    <div className="crm-panel-heading"><h2>Тикет №{id}</h2><div className="crm-ticket-actions">{actions && item.status === "awaiting_reply" && <button className="crm-primary" data-course="moderate" disabled={mutation.isPending || uncertain} onClick={() => mutation.mutate({ item, action: "moderate" })}>Модерация</button>}{actions && item.status === "moderation" && <button className="crm-secondary" data-course="rework" disabled={mutation.isPending || uncertain} onClick={() => mutation.mutate({ item, action: "rework" })}>Вернуть на доработку</button>}</div></div>
    {left && <p className="crm-ticket-left" role="note">Этот тикет больше не относится к уроку: урок начат заново. Тикет текущего урока открывается из панели обучения.</p>}
    <div className="crm-detail-body"><div className="crm-ticket-columns"><dl className="crm-detail-grid"><div><dt>Номер обращения</dt><dd><button className="crm-ticket-link" onClick={() => onAppeal(item.appeal_id)}>{item.appeal_id}</button></dd></div><div><dt>Статус</dt><dd>{STATUS[item.status] ?? item.status}</dd></div><div><dt>Номер телефона</dt><dd>{item.phone}</dd></div><div><dt>Создан</dt><dd>{crmDate(item.created_at)}</dd></div></dl><section><h3>История операций</h3><ol className="crm-ticket-history"><li>Создан · {crmDate(item.created_at)}</li>{item.events.map(event => <li key={event.id}>{ACTION[event.action] ?? event.action}<small>{crmDate(event.created_at)}</small></li>)}</ol></section></div>
      <div className="crm-ticket-comments-heading"><h3>Комментарии</h3><button ref={opener} className="crm-primary" data-course="comment" disabled={!actions || item.status !== "rework" || item.events.some(event => event.action === "comment") || mutation.isPending} onClick={() => { mutation.reset(); setModal(true); }}>Добавить комментарий</button></div>
      {item.events.filter(event => event.comment || event.attachments.length).map(event => <article className="crm-ticket-comment" key={event.id}><strong>{event.author}</strong><p>{event.comment}</p><small>{crmDate(event.created_at)}</small>{event.attachments.map(file => <button key={file.id} className="crm-secondary" onClick={() => void crm.ticketAttachment(file.id, file.name).catch(error => setFileError(error.message))}>{file.name} ↓</button>)}</article>)}
      {!item.events.some(e => e.comment) && <p>Комментариев пока нет.</p>}
      {mutation.isError && !modal && <p role="alert" className="crm-course-feedback">{mutation.error.message}{uncertain && <button onClick={() => mutation.variables && mutation.mutate(mutation.variables)}>Повторить действие</button>}{"status" in mutation.error && mutation.error.status === 409 && <button onClick={() => void query.refetch()}>Обновить тикет</button>}</p>}
      {fileError && <p role="alert" className="crm-course-feedback">{fileError}</p>}
    </div>
    {modal && <div className="crm-ticket-overlay"><div ref={dialog} className="crm-ticket-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-comment-title" onKeyDown={e => {
      if (e.key === "Escape" && !mutation.isPending && !uncertain) { setModal(false); opener.current?.focus(); }
      if (e.key === "Tab") { const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not([hidden]):not(:disabled)') ?? [])].filter(el => el.offsetParent !== null); const first = nodes[0], last = nodes.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    }}><h2 id="crm-comment-title">Тикет №{id} · Добавить комментарий</h2><form onSubmit={e => { e.preventDefault(); mutation.mutate({ item, action: "comment" }); }} onPaste={e => { const images = [...e.clipboardData.files].filter(f => f.type.startsWith("image/")); if (images.length) { e.preventDefault(); attach(images); } }}>
      <p role="status">{draft.status === "saved" ? "Черновик комментария сохранён" : draft.status === "saving" ? "Сохраняем комментарий…" : draft.status === "loading" ? "Восстанавливаем комментарий…" : "Комментарий сохраняется автоматически"}</p>
      {draft.error && <p role="alert" className="crm-course-feedback">{draft.error}<button type="button" onClick={() => void draft.retry().catch(() => {})}>Повторить сохранение</button></p>}
      <label htmlFor="crm-ticket-comment">Комментарий</label><textarea id="crm-ticket-comment" ref={area} required maxLength={10000} value={comment} disabled={mutation.isPending || uncertain || !draft.ready || draft.status === "conflict"} onChange={e => draft.change({ comment: e.target.value })} placeholder={"Дополняю тикет по замечанию ООЗ.\nСсылка на аккаунт водителя: https://fleet.yandex.kz/contractors/…"} /><small className="crm-ticket-dialog-hint">Вставь полную ссылку на аккаунт водителя из Диспетчерской (Ctrl+V). Изображение не заменяет ссылку в тексте.</small>
      <input hidden ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e => { attach([...e.target.files ?? []]); e.target.value = ""; }} />
      <button type="button" className="crm-paste-zone" disabled={mutation.isPending || uncertain} onClick={() => input.current?.click()}>Прикрепить изображение или вставить Ctrl+V · до 2 МБ</button>
      {draft.attachments.map(file => <div className="crm-file-row" key={file.id}>{file.name}<button type="button" aria-label={`Удалить ${file.name}`} disabled={mutation.isPending || uncertain} onClick={() => draft.removeAttachment(file.id)}>×</button></div>)}
      {files.map((file, index) => <div className="crm-file-row" key={index}>{file.name}<button type="button" disabled={mutation.isPending || uncertain} aria-label={`Удалить ${file.name}`} onClick={() => draft.removeFile(draft.files[index].key)}>×</button></div>)}
      {mutation.isError && <p role="alert" className="crm-course-feedback">{mutation.error.message}</p>}
      {uncertain && <p>Ответ сервера не получен. Повтори отправку — второй комментарий не создастся.</p>}
      <footer><button type="button" className="crm-secondary" disabled={mutation.isPending || uncertain} onClick={() => { setModal(false); opener.current?.focus(); }}>Отмена</button><button className="crm-primary" disabled={mutation.isPending || !draft.ready || draft.status === "conflict"}>{mutation.isPending ? "Отправляем…" : uncertain ? "Повторить отправку" : "Отправить"}</button></footer>
    </form></div></div>}
  </section>;
}
