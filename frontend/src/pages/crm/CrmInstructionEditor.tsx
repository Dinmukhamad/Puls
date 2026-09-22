import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crm, type CrmCatalog, type CrmInstruction } from "../../api/crm";

export function CrmInstructionEditor({ instruction, onClose }: { instruction: CrmInstruction; onClose: () => void }) {
  const [draft, setDraft] = useState(instruction);
  const client = useQueryClient();
  const save = useMutation({ mutationFn: () => crm.instruction(draft), onSuccess: saved => {
    client.setQueryData<CrmCatalog>(["crm-catalog"], previous => previous && ({ ...previous, instructions: { ...previous.instructions, [saved.key]: saved } }));
    client.invalidateQueries({ queryKey: ["crm-catalog"] }); onClose();
  } });
  const cancel = () => { if (JSON.stringify(draft) === JSON.stringify(instruction) || window.confirm("Отменить изменения инструкции?")) onClose(); };
  return <form className="pulsar-editor" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <p className="pulsar-eyebrow">РЕДАКТОР ИНСТРУКЦИИ</p><h2>{instruction.title}</h2><p className="pulsar-muted">Название, текст и шаги будут обновлены для всех участников. Правила проверки обращения сохраняются.</p>
    <fieldset disabled={save.isPending}><label>Название инструкции<input required maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>Текст инструкции<textarea required rows={6} maxLength={6000} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
      <div className="pulsar-editor-steps"><strong>Шаги</strong>{draft.steps.map((step, index) => <div key={index}><label>Шаг {index + 1}<textarea required maxLength={600} rows={2} value={step} onChange={e => setDraft({ ...draft, steps: draft.steps.map((value, i) => i === index ? e.target.value : value) })} /></label><button type="button" aria-label={`Удалить шаг ${index + 1}`} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}>×</button></div>)}</div>
      <button type="button" className="pulsar-text-button" disabled={draft.steps.length >= 12} onClick={() => setDraft({ ...draft, steps: [...draft.steps, ""] })}>＋ Добавить шаг</button>
    </fieldset>
    {save.isError && <div className="crm-error" role="alert">{save.error.message}<p>Введённый текст остаётся в редакторе. Скопируйте его перед отменой, если хотите загрузить новую версию.</p><button type="button" onClick={() => client.invalidateQueries({ queryKey: ["crm-catalog"] })}>Обновить данные</button></div>}
    <div className="pulsar-editor-actions"><button className="crm-primary" disabled={save.isPending}>{save.isPending ? "Сохранение…" : "Сохранить инструкцию"}</button><button type="button" className="pulsar-text-button" disabled={save.isPending} onClick={cancel}>Отмена</button></div>
  </form>;
}
