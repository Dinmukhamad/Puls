import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crm, CRM_FIELDS, CRM_STATUS, type CrmAppeal } from "../../api/crm";
import { crmDate } from "./CrmAppealList";

export function CrmAppealDetail({ id, editor, onDuplicate }: { id: number; editor: boolean; onDuplicate: (appeal: CrmAppeal) => void }) {
  const query = useQuery({ queryKey: ["crm-appeal", id], queryFn: () => crm.appeal(id) }), client = useQueryClient();
  const [fileError, setFileError] = useState("");
  const status = useMutation({ mutationFn: (value: string) => crm.status(id, value), onSuccess: appeal => { client.setQueryData(["crm-appeal", id], appeal); client.invalidateQueries({ queryKey: ["crm-appeals"] }); } });
  if (query.isPending) return <div className="crm-empty">Загружаем обращение…</div>;
  if (query.isError) return <div role="alert" className="crm-empty"><p>{query.error.message}</p><button onClick={() => query.refetch()}>Повторить</button></div>;
  const item = query.data;
  return <section className="crm-panel crm-detail"><div className="crm-panel-heading"><div><h2>Обращение #{String(item.id).padStart(5, "0")}</h2><p>Создано {crmDate(item.created_at)} · {item.author_name}</p></div><span className={`crm-status crm-status--${item.status}`}>{CRM_STATUS[item.status]}</span></div>
    <div className="crm-detail-body"><div className="crm-path">{item.category_labels.map((label, i) => <span key={i}>{label}</span>)}</div><dl className="crm-detail-grid">{[["Звонок/Чат", item.channel], ["Номер телефона", item.phone], ["Номер В/У", item.license_number], ["ID водителя", item.driver_id || "Не указан"], ["Дата обращения", crmDate(item.contacted_at)], ["Таксопарк", item.park], ["Город", item.city], ["Автор", item.author_name], ...Object.entries(item.details).filter(([, value]) => value).map(([key, value]) => [CRM_FIELDS[key] ?? key, value])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><h3>Комментарий</h3><div className="crm-comment">{item.comment || "Комментарий не добавлен"}</div><h3>Вложения <small>({item.attachments.length})</small></h3>{item.attachments.length ? <div className="crm-attachments">{item.attachments.map(file => <button key={file.id} className="crm-attachment" onClick={async () => { setFileError(""); try { await crm.download(file.id, file.name); } catch (error) { setFileError(error instanceof Error ? error.message : "Не удалось скачать файл"); } }}><span>▧</span><span>{file.name}<small>{Math.ceil(file.size / 1024)} КБ · Скачать</small></span><span>↓</span></button>)}</div> : <p className="crm-muted">Без вложений</p>}{fileError && <p role="alert" className="crm-error">{fileError}</p>}
    </div><div className="crm-form-footer"><button className="crm-secondary" onClick={() => onDuplicate(item)}>Создать на основе обращения</button>{editor && item.is_ticket && <label>Статус тикета <select aria-label="Статус тикета" disabled={status.isPending} value={item.status} onChange={e => status.mutate(e.target.value)}>{["new", "in_progress", "closed"].map(key => <option key={key} value={key}>{CRM_STATUS[key]}</option>)}</select></label>}{status.isError && <p role="alert" className="crm-error">{status.error.message}</p>}</div>
  </section>;
}
