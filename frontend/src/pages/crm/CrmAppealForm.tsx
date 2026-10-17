import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { categoryRules, crm, CRM_FIELDS, extraFields, selectedCategories, type CrmAppeal, type CrmCatalog, type CrmInput, type CrmSaveInput } from "../../api/crm";
import type { CrmCourseCapture } from "../../api/crmTraining";
import { CategorySelect } from "./CrmCategories";
import { useGuide } from "../../guide";
import { PulsarFace } from "./PulsarGuide";
import { crmSubmissionDetails, ScenarioCrmProof } from "../scenarios/ScenarioCrmProof";
import { fieldMatch, linkMatch, type AccountData } from "./accountData";
import { useAuth } from "../../auth/AuthContext";
import { useCrmDraft } from "./useCrmDraft";
import "./crm-draft.css";

const localDateValue = (iso: string) => { const value = new Date(iso); return Number.isNaN(value.getTime()) ? localDate() : new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const localDate = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
/** `accounts` are the driver accounts the appeal may be about: the fields say whether they hold their data, and Pulsar waits for that. */
/** `courseHint`: what the course lesson asks to put into this form, shown above its fields. */
export function CrmAppealForm({ catalog, initial, editing, trainingTask, capture, courseHint, scenarioAttemptId, scenarioRevision, accounts, onSaved, onDirty, onCategoryChange, onRequestHelp }: {
  onCategoryChange: (ids: string[]) => void; onRequestHelp: () => void; catalog: CrmCatalog;
  capture?: CrmCourseCapture; courseHint?: ReactNode; initial?: CrmAppeal; editing?: CrmAppeal; trainingTask?: string; scenarioAttemptId?: string; scenarioRevision?: number;
  accounts?: AccountData[]; onSaved: (appeal: CrmAppeal, duplicate: boolean) => void; onDirty: (dirty: boolean) => void;
}) {
  const source = editing ?? initial;
  const [legacyForm, setForm] = useState<CrmInput>(() => ({ request_id: crypto.randomUUID(), channel: source?.channel ?? "Звонок", phone: source?.phone ?? "", license_number: source?.license_number ?? "", driver_id: source?.driver_id ?? "", contacted_at: editing ? localDateValue(editing.contacted_at) : localDate(), park: source?.park ?? "", city: source?.city ?? "", category_ids: source?.category_ids ?? [], details: source?.details ?? {}, comment: source?.comment ?? "", is_ticket: source?.is_ticket ?? false }));
  const { user } = useAuth();
  const ordinary = !scenarioAttemptId;
  const draft = useCrmDraft({ enabled: ordinary, userId: user?.id, task: trainingTask, appealId: editing?.id, initial: legacyForm, initialDirty: !!initial });
  const form = ordinary ? draft.form : legacyForm;
  const guide = useGuide();
  const [legacyFiles, setFiles] = useState<File[]>([]), [fileError, setFileError] = useState(""), [duplicate, setDuplicate] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const finalAttempt = useRef<{ payload: CrmSaveInput; files: File[] }>();
  const files = ordinary ? draft.files.map(entry => entry.file) : legacyFiles;
  const existingFiles = ordinary ? (editing?.attachments ?? []).filter(file => !draft.removedAppealAttachmentIds.includes(file.id)) : [];
  const savedFiles = ordinary ? draft.attachments : [];
  const [legacyDirty, setDirty] = useState(!!initial);
  const dirty = uncertain || (ordinary ? !["idle", "saved"].includes(draft.status) : legacyDirty);
  const fileInput = useRef<HTMLInputElement>(null);
  const [draftActionError, setDraftActionError] = useState("");
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { if (!dirty) return; const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave); }, [dirty]);
  const rules = categoryRules(catalog.categories, form.category_ids), fields = extraFields(rules);
  useEffect(() => { onCategoryChange(form.category_ids); }, [form.category_ids, onCategoryChange]);
  const legacyScenario = !!scenarioAttemptId && (scenarioRevision ?? 3) < 3;
  // A CRM task checks its comment: what the consultation said or what the driver asks for.
  const commentRequired = legacyScenario || !!trainingTask || rules.has("account_link") || rules.has("description");
  const instruction = catalog.instructions?.[`category:${form.category_ids.at(-1)}`];
  const save = useMutation({ mutationFn: async () => {
    if (uncertain && finalAttempt.current) {
      const attempt = finalAttempt.current;
      return editing ? crm.update(editing.id, attempt.payload, attempt.files) : crm.create(attempt.payload, attempt.files);
    }
    finalAttempt.current = undefined;
    const confirmed = ordinary ? await draft.flush() : null;
    const input = confirmed?.form ?? form;
    const inputFields = extraFields(categoryRules(catalog.categories, input.category_ids));
    const payload = { ...input, contacted_at: new Date(input.contacted_at).toISOString(), details: crmSubmissionDetails(input.details, inputFields, scenarioAttemptId),
      ...(ordinary && trainingTask ? { training_task: trainingTask } : {}),
      ...(confirmed?.draftKey ? { draft_key: confirmed.draftKey, draft_revision: confirmed.revision } : {}),
      ...(editing ? { revision: editing.revision, remove_attachment_ids: confirmed?.removedAppealAttachmentIds ?? [] } : {}),
    };
    const upload = ordinary ? [] : files;
    finalAttempt.current = { payload, files: upload };
    return editing ? crm.update(editing.id, payload, upload) : crm.create(payload, upload);
  }, onSuccess: async appeal => { if (ordinary) await draft.clear(); setUncertain(false); finalAttempt.current = undefined; setDirty(false); onDirty(false); onSaved(appeal, editing ? false : duplicate); },
    onError: error => { if (ordinary && finalAttempt.current && (!error || typeof error !== "object" || !("status" in error) || error.status === 0 || (typeof error.status === "number" && error.status >= 500))) setUncertain(true); },
  });
  function update<K extends keyof CrmInput>(key: K, value: CrmInput[K]) {
    if (uncertain) return;
    if (ordinary) draft.change({ [key]: value }); else { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); }
    save.reset();
  }
  function attach(incoming: File[]) {
    if (uncertain) return;
    const all = [...files, ...incoming], persisted = [...existingFiles, ...savedFiles];
    if (all.length + persisted.length > 5 || all.some(f => f.size > 2 * 1024 * 1024) || all.reduce((sum, f) => sum + f.size, 0) + persisted.reduce((sum, f) => sum + f.size, 0) > 8 * 1024 * 1024) { setFileError("До 5 файлов, по 2 МБ каждый, не более 8 МБ суммарно."); return; }
    if (incoming.some(f => !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(f.type))) { setFileError("Выберите PNG, JPEG, WebP или PDF."); return; }
    if (ordinary) draft.addFiles(incoming); else { setFiles(all); setDirty(true); }
    setFileError(""); save.reset();
  }
  async function draftAction(action: () => Promise<unknown>) {
    setDraftActionError("");
    try { await action(); } catch (error) { setDraftActionError(error instanceof Error ? error.message : "Не удалось восстановить черновик. Повторите попытку."); }
  }
  const input = (key: "phone" | "license_number" | "driver_id", label: string, required: boolean) => <label className="crm-field" data-coach={key} data-match={fieldMatch(key, form[key], accounts)}><span>{label}{required && " *"}</span><input required={required} value={form[key]} maxLength={key === "phone" ? 40 : 80} type={key === "phone" ? "tel" : "text"} onChange={e => update(key, e.target.value)} placeholder={label} /></label>;
  const path = selectedCategories(catalog.categories, form.category_ids).map(node => node.label);
  const captureAttached = !!capture && [...existingFiles, ...savedFiles, ...files].some(f => f.name === capture.name);
  return <section className="crm-panel crm-form-panel" data-coach="appeal-form" data-rules={[...rules].sort().join(" ")} data-path={path.length ? ` ${path.join(" / ")} ` : ""} data-leaf={path.at(-1) ?? ""}><div className="crm-panel-heading"><h2>{editing ? `Исправить обращение #${editing.id}` : "＋ Создать обращение"}</h2><span>* Обязательные поля</span></div>
    {ordinary && <div className="crm-draft-status" data-status={draft.status} aria-live="polite">
      <p role="status">{draft.status === "loading" ? "Восстанавливаем черновик…" : draft.status === "saving" ? "Сохраняем черновик…" : draft.status === "saved" ? "Черновик сохранён на сервере" : draft.status === "idle" ? "Изменения будут сохраняться автоматически" : draft.status === "unsaved" ? "Есть несохранённые изменения…" : draft.status === "conflict" ? "Версия черновика изменилась" : "Черновик не сохранён"}</p>
      {(draft.error || draftActionError) && <p className="crm-error" role="alert">{draftActionError || draft.error}</p>}
      {draft.status === "error" && <button type="button" onClick={() => void draftAction(draft.retry)}>{draft.ready ? "Повторить сохранение" : "Повторить загрузку"}</button>}
      {draft.status === "conflict" && <div><button type="button" onClick={() => void draftAction(() => draft.resolveConflict("remote"))}>Загрузить серверную версию</button><button type="button" onClick={() => void draftAction(() => draft.resolveConflict("local"))}>Сохранить мои изменения поверх неё</button></div>}
    </div>}
    {courseHint}
    <form onSubmit={e => { e.preventDefault(); save.mutate(); }} onPaste={e => { const images = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (images.length) { e.preventDefault(); attach(images); } }}>
      <fieldset disabled={save.isPending || uncertain || (ordinary && (!draft.ready || draft.status === "conflict"))} className="crm-fields">
        <div data-tour="contact"><label className="crm-field" data-coach="channel"><span>Звонок/Чат</span><select value={form.channel} onChange={e => update("channel", e.target.value)}><option>Звонок</option><option>Чат</option></select></label>
        {input("phone", "Номер телефона", true)}{input("license_number", "Номер В/У", true)}{input("driver_id", "ID водителя", !!scenarioAttemptId || (!!trainingTask && !trainingTask.endsWith("_v2")))}
        <label className="crm-field"><span>Дата обращения *</span><input type="datetime-local" required value={form.contacted_at} onChange={e => update("contacted_at", e.target.value)} /></label>
        <label className="crm-field" data-coach="park" data-filled={!!form.park}><span>Таксопарк *</span><select required value={form.park} onChange={e => { update("park", e.target.value); update("city", ""); }}><option value="">Выберите таксопарк</option>{catalog.parks.map(park => <option key={park}>{park}</option>)}</select></label>
        {form.park && <label className="crm-field" data-coach="city" data-filled={!!form.city}><span>Город *</span><select required value={form.city} onChange={e => update("city", e.target.value)}><option value="">Выберите город</option>{catalog.cities.map(city => <option key={city}>{city}</option>)}</select></label>}</div>
        <CategorySelect nodes={catalog.categories} value={form.category_ids} onChange={value => { update("category_ids", value); update("details", {}); update("is_ticket", selectedCategories(catalog.categories, value).some(node => ["Запрос", "Сотрудничество", "Жалоба/Благодарность"].includes(node.label))); }} />
        {!!form.category_ids.length && <div className="crm-context-help" data-coach="context-help"><PulsarFace /><div><button className="crm-help-link" type="button" onClick={onRequestHelp}>✦ {instruction?.title ?? "Инструкция по обращению"} — открыть у {guide.name}</button><p>{!trainingTask?.endsWith("_v2") && instruction?.body && guide.text(instruction.body)}</p></div></div>}
        {fields.map(key => <label className="crm-field" key={key} data-coach="extra-field"><span>{CRM_FIELDS[key]}{key !== "error_description" && " *"}</span>{["service", "error_description"].includes(key) ? <textarea required={key !== "error_description"} maxLength={2000} value={form.details[key] ?? ""} onChange={e => update("details", { ...form.details, [key]: e.target.value })} /> : <input required maxLength={2000} value={form.details[key] ?? ""} onChange={e => update("details", { ...form.details, [key]: e.target.value })} placeholder={key === "conditions" ? "Например, комиссия 2%" : CRM_FIELDS[key]} />}</label>)}
        {scenarioAttemptId && <ScenarioCrmProof attemptId={scenarioAttemptId} details={form.details} onChange={details => update("details", details)} />}
        <div data-tour="evidence"><label className="crm-field" data-coach="comment" data-link={linkMatch(form.comment, accounts)}><span>Комментарий{commentRequired ? " *" : ""}</span><textarea required={commentRequired} minLength={legacyScenario ? 40 : undefined} maxLength={10000} rows={4} value={form.comment} onChange={e => update("comment", e.target.value)} placeholder={scenarioAttemptId && !legacyScenario ? "Комментарий к консультации (необязательно)" : scenarioAttemptId ? "Проверенные данные водителя и автомобиля…\nРезультат консультации и ограничения…\nСледующее действие водителя…" : rules.has("phone_change") ? "Новый номер: …\nСсылка на аккаунт: https://…\nПросьба водителя: …" : rules.has("account_link") ? "Ссылка на аккаунт водителя: https://…\nОписание ситуации…" : trainingTask === "crm_first" ? "Итог консультации: что вы рассказали водителю о тарифах" : "Опишите ситуацию"} /></label>
        {trainingTask?.endsWith("_v2") && <div className="crm-course-attach"><strong>Снимок диспетчерской и OKTEL</strong>{capture ? <><img src={capture.data_url} alt="Сохранённый снимок двух учебных окон" /><button type="button" className="crm-secondary" data-course={captureAttached ? undefined : "attach-capture"} disabled={captureAttached} onClick={() => { void fetch(capture.data_url).then(r => r.blob()).then(blob => attach([new File([blob], capture.name, { type: "image/png" })])).catch(() => setFileError("Не удалось прикрепить снимок. Повтори попытку.")); }}>{captureAttached ? "✓ Снимок прикреплён" : "Прикрепить снимок двух окон"}</button>{!captureAttached && <small>Снимок ещё не в обращении: нажми кнопку выше. Других изображений прикреплять не нужно.</small>}</> : <p>Вернись к учебному звонку и нажми «Сделать снимок».</p>}</div>}
        <div className="crm-field" data-coach="files"><span>Загрузить файлы{rules.has("image") && " *"}</span><div><input aria-label="Загрузить файлы" ref={fileInput} tabIndex={-1} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple onChange={e => { attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} /><button type="button" className="crm-paste-zone" onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); attach(Array.from(e.dataTransfer.files)); }}>Перетащите файл или вставьте скриншот Ctrl+V<br /><small>PNG, JPEG, WebP, PDF · до 2 МБ на файл</small></button>
        {existingFiles.map(file => <div className="crm-file-row" key={`appeal:${file.id}`}><span>▧ {file.name} <small>{Math.ceil(file.size / 1024)} КБ · в обращении</small></span><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => { draft.removeAppealAttachment(file.id); save.reset(); }}>×</button></div>)}
        {savedFiles.map(file => <div className="crm-file-row" key={`draft:${file.id}`}><span>▧ {file.name} <small>{Math.ceil(file.size / 1024)} КБ · сохранён</small></span><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => { draft.removeAttachment(file.id); save.reset(); }}>×</button></div>)}
        {files.map((file, i) => <div className="crm-file-row" key={ordinary ? draft.files[i].key : `${file.name}-${i}`}><span>▧ {file.name} <small>{Math.ceil(file.size / 1024)} КБ{ordinary && " · сохраняется"}</small></span><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => { if (ordinary) draft.removeFile(draft.files[i].key); else { setFiles(files.filter((_, index) => index !== i)); setDirty(true); } save.reset(); }}>×</button></div>)}{fileError && <p role="alert" className="crm-error">{fileError}</p>}</div></div></div>
        <div className="crm-form-options" data-tour="save"><label data-coach="ticket"><input type="checkbox" checked={form.is_ticket} onChange={e => update("is_ticket", e.target.checked)} /> Формировать тикет</label><small>Сохранить запрос для учебной обработки отделом</small>{!editing && !trainingTask && <><label><input type="checkbox" checked={duplicate} onChange={e => setDuplicate(e.target.checked)} /> Дублировать обращение</label><small>После сохранения открыть копию для следующего обращения</small></>}</div>
      </fieldset>
      <div className="crm-form-footer"><button className="crm-primary" data-coach="save" disabled={save.isPending || (ordinary && (!draft.ready || draft.status === "conflict"))}>{save.isPending ? "Сохранение…" : uncertain ? "Повторить подтверждение" : trainingTask?.endsWith("_v2") ? "Сохранить и отправить" : "↓ Сохранить"}</button><span>{uncertain ? "Сервер не подтвердил ответ. Повторите сохранение: поля и номер запроса останутся прежними." : "Обращение будет видно всем участникам"}</span>{save.isError && <p className="crm-error" role="alert">{save.error.message}</p>}</div>
    </form>
  </section>;
}
