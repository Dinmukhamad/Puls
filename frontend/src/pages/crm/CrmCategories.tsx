import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crm, selectedCategories, type CrmCategory } from "../../api/crm";

export function CategorySelect({ nodes, value, onChange, optional = false }: { nodes: CrmCategory[]; value: string[]; onChange: (value: string[]) => void; optional?: boolean }) {
  const levels: CrmCategory[][] = [];
  let parent: string | null = null;
  for (let level = 0; level < 10; level++) {
    const options = nodes.filter(node => node.parent_id === parent);
    if (!options.length) break;
    levels.push(options);
    if (!value[level]) break;
    parent = value[level];
  }
  return <div className="crm-category-fields" data-tour="categories" data-coach="categories">{levels.map((options, index) => <label className="crm-field" key={index}><span>Категория {index + 1}{!optional && " *"}</span><select required={!optional} value={value[index] ?? ""} onChange={event => onChange([...value.slice(0, index), ...(event.target.value ? [event.target.value] : [])])}><option value="">{optional ? "На этом уровне" : "Выберите категорию"}</option>{options.map(node => <option key={node.id} value={node.id} disabled={node.disabled}>{node.label}{node.disabled ? " — недоступно" : ""}</option>)}</select></label>)}</div>;
}

export function CrmCategories({ nodes }: { nodes: CrmCategory[] }) {
  const [path, setPath] = useState<string[]>([]), [label, setLabel] = useState(""), [hint, setHint] = useState("");
  const client = useQueryClient();
  const save = useMutation({ mutationFn: () => crm.category({ parent_id: path.at(-1) ?? null, label, hint }), onSuccess: () => { setLabel(""); setHint(""); client.invalidateQueries({ queryKey: ["crm-catalog"] }); } });
  return <section className="crm-panel crm-form-panel"><div className="crm-panel-heading"><h2>Управление категориями</h2><span>Для тренера</span></div><div className="crm-section-note">Новая категория появится у всех участников. История обращений сохранит категории, выбранные при создании.</div><form onSubmit={e => { e.preventDefault(); save.mutate(); }}><div className="crm-fields"><CategorySelect nodes={nodes} value={path} onChange={value => { setPath(value); save.reset(); }} optional /><div className="crm-instructions">Добавить в: <strong>{selectedCategories(nodes, path).map(n => n.label).join(" → ") || "Корень категорий"}</strong></div><label className="crm-field"><span>Новая категория *</span><input required maxLength={160} value={label} onChange={e => { setLabel(e.target.value); save.reset(); }} placeholder="Например, Смена лимита по 500к" /></label><label className="crm-field"><span>Подсказка оператору</span><textarea maxLength={2000} value={hint} onChange={e => setHint(e.target.value)} /></label></div><div className="crm-form-footer"><button className="crm-primary" disabled={save.isPending || !label.trim()}>Добавить категорию</button>{save.isSuccess && <span role="status">Категория добавлена</span>}{save.isError && <p role="alert" className="crm-error">{save.error.message}</p>}</div></form></section>;
}
