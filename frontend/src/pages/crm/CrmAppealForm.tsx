import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { categoryRules, crm, CRM_FIELDS, extraFields, selectedCategories, type CrmAppeal, type CrmCatalog, type CrmInput } from "../../api/crm";
import { CategorySelect } from "./CrmCategories";
import { PulsarFace } from "./PulsarGuide";

const localDate = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export function CrmAppealForm({ catalog, initial, onSaved, onDirty, onCategoryChange, onRequestHelp }: { onCategoryChange: (ids: string[]) => void; onRequestHelp: () => void; catalog: CrmCatalog; initial?: CrmAppeal; onSaved: (appeal: CrmAppeal, duplicate: boolean) => void; onDirty: (dirty: boolean) => void }) {
  const [form, setForm] = useState<CrmInput>(() => ({ request_id: crypto.randomUUID(), channel: initial?.channel ?? "Звонок", phone: initial?.phone ?? "", license_number: initial?.license_number ?? "", driver_id: initial?.driver_id ?? "", contacted_at: localDate(), park: initial?.park ?? "", city: initial?.city ?? "", category_ids: initial?.category_ids ?? [], details: initial?.details ?? {}, comment: initial?.comment ?? "", is_ticket: initial?.is_ticket ?? false }));
  const [files, setFiles] = useState<File[]>([]), [fileError, setFileError] = useState(""), [duplicate, setDuplicate] = useState(false);
  const [dirty, setDirty] = useState(!!initial);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { if (!dirty) return; const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave); }, [dirty]);
  const rules = categoryRules(catalog.categories, form.category_ids), fields = extraFields(rules);
  useEffect(() => { onCategoryChange(form.category_ids); }, [form.category_ids, onCategoryChange]);
  const instruction = catalog.instructions?.[`category:${form.category_ids.at(-1)}`];
  const save = useMutation({ mutationFn: () => crm.create({ ...form, contacted_at: new Date(form.contacted_at).toISOString(), details: Object.fromEntries(fields.map(key => [key, form.details[key] ?? ""])) }, files), onSuccess: appeal => { setDirty(false); onDirty(false); onSaved(appeal, duplicate); } });
  function update<K extends keyof CrmInput>(key: K, value: CrmInput[K]) { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); save.reset(); }
  function attach(incoming: File[]) {
    const all = [...files, ...incoming];
    if (all.length > 5 || all.some(f => f.size > 2 * 1024 * 1024) || all.reduce((sum, f) => sum + f.size, 0) > 8 * 1024 * 1024) { setFileError("До 5 файлов, по 2 МБ каждый, не более 8 МБ суммарно."); return; }
    if (incoming.some(f => !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(f.type))) { setFileError("Выберите PNG, JPEG, WebP или PDF."); return; }
    setFiles(all); setFileError(""); setDirty(true);
  }
  const input = (key: "phone" | "license_number" | "driver_id", label: string, required: boolean) => <label className="crm-field" data-coach={key}><span>{label}{required && " *"}</span><input required={required} value={form[key]} maxLength={key === "phone" ? 40 : 80} type={key === "phone" ? "tel" : "text"} onChange={e => update(key, e.target.value)} placeholder={label} /></label>;
  return <section className="crm-panel crm-form-panel"><div className="crm-panel-heading"><h2>＋ Создать обращение</h2><span>* Обязательные поля</span></div>
    <form onSubmit={e => { e.preventDefault(); save.mutate(); }} onPaste={e => { const images = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/")); if (images.length) { e.preventDefault(); attach(images); } }}>
      <fieldset disabled={save.isPending} className="crm-fields">
        <div data-tour="contact"><label className="crm-field" data-coach="channel"><span>Звонок/Чат</span><select value={form.channel} onChange={e => update("channel", e.target.value)}><option>Звонок</option><option>Чат</option></select></label>
        {input("phone", "Номер телефона", true)}{input("license_number", "Номер В/У", true)}{input("driver_id", "ID водителя", false)}
        <label className="crm-field"><span>Дата обращения *</span><input type="datetime-local" required value={form.contacted_at} onChange={e => update("contacted_at", e.target.value)} /></label>
        <label className="crm-field" data-coach="park"><span>Таксопарк *</span><select required value={form.park} onChange={e => { update("park", e.target.value); update("city", ""); }}><option value="">Выберите таксопарк</option>{catalog.parks.map(park => <option key={park}>{park}</option>)}</select></label>
        {form.park && <label className="crm-field"><span>Город *</span><select required value={form.city} onChange={e => update("city", e.target.value)}><option value="">Выберите город</option>{catalog.cities.map(city => <option key={city}>{city}</option>)}</select></label>}</div>
        <CategorySelect nodes={catalog.categories} value={form.category_ids} onChange={value => { update("category_ids", value); update("details", {}); update("is_ticket", selectedCategories(catalog.categories, value).some(node => ["Запрос", "Сотрудничество", "Жалоба/Благодарность"].includes(node.label))); }} />
        {!!form.category_ids.length && <div className="crm-context-help" data-coach="context-help"><PulsarFace /><div><button className="crm-help-link" type="button" onClick={onRequestHelp}>✦ {instruction?.title ?? "Инструкция по обращению"} — открыть у Пульсара</button><p>{instruction?.body}</p></div></div>}
        {fields.map(key => <label className="crm-field" key={key}><span>{CRM_FIELDS[key]}{key !== "error_description" && " *"}</span>{["service", "error_description"].includes(key) ? <textarea required={key !== "error_description"} maxLength={2000} value={form.details[key] ?? ""} onChange={e => update("details", { ...form.details, [key]: e.target.value })} /> : <input required maxLength={2000} value={form.details[key] ?? ""} onChange={e => update("details", { ...form.details, [key]: e.target.value })} placeholder={key === "conditions" ? "Например, комиссия 2%" : CRM_FIELDS[key]} />}</label>)}
        <div data-tour="evidence"><label className="crm-field" data-coach="comment"><span>Комментарий{rules.has("account_link") || rules.has("description") ? " *" : ""}</span><textarea required={rules.has("account_link") || rules.has("description")} maxLength={10000} rows={4} value={form.comment} onChange={e => update("comment", e.target.value)} placeholder={rules.has("phone_change") ? "Старый номер: …\nНовый номер: …\nСсылка на аккаунт: https://…" : rules.has("account_link") ? "Ссылка на аккаунт водителя: https://…\nОписание ситуации…" : "Опишите ситуацию"} /></label>
        <div className="crm-field" data-coach="files"><span>Загрузить файлы{rules.has("image") && " *"}</span><div><input aria-label="Загрузить файлы" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple onChange={e => { attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} /><button type="button" className="crm-paste-zone" onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); attach(Array.from(e.dataTransfer.files)); }}>Перетащите файл или вставьте скриншот Ctrl+V<br /><small>PNG, JPEG, WebP, PDF · до 2 МБ на файл</small></button>
        {files.map((file, i) => <div className="crm-file-row" key={`${file.name}-${i}`}><span>▧ {file.name} <small>{Math.ceil(file.size / 1024)} КБ</small></span><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => { setFiles(files.filter((_, index) => index !== i)); setDirty(true); }}>×</button></div>)}{fileError && <p role="alert" className="crm-error">{fileError}</p>}</div></div></div>
        <div className="crm-form-options" data-tour="save"><label data-coach="ticket"><input type="checkbox" checked={form.is_ticket} onChange={e => update("is_ticket", e.target.checked)} /> Формировать тикет</label><small>Сохранить запрос для учебной обработки отделом</small><label><input type="checkbox" checked={duplicate} onChange={e => setDuplicate(e.target.checked)} /> Дублировать обращение</label><small>После сохранения открыть копию для следующего обращения</small></div>
      </fieldset>
      <div className="crm-form-footer"><button className="crm-primary" data-coach="save" disabled={save.isPending}>{save.isPending ? "Сохранение…" : "↓ Сохранить"}</button><span>Обращение будет видно всем участникам</span>{save.isError && <p className="crm-error" role="alert">{save.error.message}</p>}</div>
    </form>
  </section>;
}
