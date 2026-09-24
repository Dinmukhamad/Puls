import { useEffect, useId, useRef, useState } from "react";
import { selectedCategories, type CrmCatalog, type CrmInstruction } from "../../api/crm";
import { CrmInstructionEditor } from "./CrmInstructionEditor";

export const GUIDE_STEPS = ["welcome", "contact", "categories", "evidence", "save"].map(target => ({ target }));

export type PulsarMood = "idle" | "wave" | "point" | "cheer";

export function PulsarFace({ mood = "idle" }: { mood?: PulsarMood }) {
  const id = useId().replace(/:/g, "");
  return <svg className="pulsar-face" data-mood={mood} viewBox="0 0 240 200" role="img" aria-label="Пульсар — космический помощник">
    <defs>
      <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset=".48" stopColor="#fff4f1"/><stop offset="1" stopColor="#efb5a8"/></linearGradient>
      <linearGradient id={`${id}-purple`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff9d87"/><stop offset="1" stopColor="#d86950"/></linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#354276"/><stop offset="1" stopColor="#172344"/></linearGradient>
      <radialGradient id={`${id}-halo`}><stop stopColor="#ffd6cd" stopOpacity=".65"/><stop offset="1" stopColor="#fff7f5" stopOpacity="0"/></radialGradient>
    </defs>
    <ellipse className="pulsar-halo" cx="120" cy="104" rx="103" ry="85" fill={`url(#${id}-halo)`}/>
    <g className="pulsar-stars" fill="#e6a394"><path d="m38 58 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z"/><path d="m197 105 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z"/><circle cx="181" cy="39" r="2.5"/><circle cx="60" cy="134" r="2"/></g>
    <ellipse className="pulsar-shadow" cx="120" cy="183" rx="40" ry="6" fill="#ebc5bd" opacity=".4"/>
    <g className="pulsar-floating">
      <path d="M120 48V32" stroke="#e99683" strokeWidth="5" strokeLinecap="round"/><path className="pulsar-antenna" d="m120 14 4 8 9 2-7 6 1 9-7-4-8 4 2-9-7-6 9-2Z" fill={`url(#${id}-purple)`}/>
      <path className="pulsar-arm-left" d="M71 95C51 84 49 111 64 121" fill="none" stroke={`url(#${id}-shell)`} strokeWidth="16" strokeLinecap="round"/>
      <path className="pulsar-arm-right" d="M168 93c21-18 32 1 18 19" fill="none" stroke={`url(#${id}-shell)`} strokeWidth="16" strokeLinecap="round"/>
      <path d="M91 126c-7 12-4 31 9 41l9-10h22l9 10c14-10 17-29 9-41" fill={`url(#${id}-shell)`} stroke="#f6d5cd" strokeWidth="1.5"/>
      <path d="M100 146q20 12 40 0v9q-20 13-40 0Z" fill={`url(#${id}-purple)`}/>
      <rect x="111" y="135" width="18" height="13" rx="5" fill="#ed8770"/><path d="m115 142 3-3 3 5 4-5" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
      <rect x="64" y="46" width="113" height="88" rx="39" fill={`url(#${id}-shell)`} stroke="#f2d5ce" strokeWidth="1.5"/>
      <path d="M81 62q17-12 35-8" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" opacity=".9"/>
      <rect x="77" y="64" width="87" height="55" rx="23" fill={`url(#${id}-glass)`}/>
      <path d="M90 72h49" stroke="#6675aa" strokeWidth="3" strokeLinecap="round" opacity=".4"/>
      <g className="pulsar-eyes" fill="#a5f3e9"><rect x="94" y="82" width="10" height="15" rx="5"/><rect x="138" y="82" width="10" height="15" rx="5"/></g>
      <g className="pulsar-eyes-happy" opacity="0" fill="none" stroke="#a5f3e9" strokeWidth="4" strokeLinecap="round"><path d="M93 92q6-9 12 0"/><path d="M137 92q6-9 12 0"/></g>
      <ellipse cx="89" cy="103" rx="6" ry="3" fill="#f6a998" opacity=".65"/><ellipse cx="153" cy="103" rx="6" ry="3" fill="#f6a998" opacity=".65"/>
      <path d="M113 102q8 8 16 0" stroke="#c5fff4" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      <path d="M65 129c-24 20 122 37 126-6" fill="none" stroke="#e9a99b" strokeWidth="2" opacity=".65"/><circle cx="185" cy="135" r="4" fill="#e49280"/>
    </g>
  </svg>;
}

const phrases: Record<string, string> = {
  welcome: "Привет! Давайте вместе оформим первое обращение.",
  contact: "Посмотрите на подсвеченный блок формы слева.",
  categories: "Теперь выберите причину обращения — слева подсвечено.",
  evidence: "Опишите ситуацию и приложите скриншот.",
  save: "Последний шаг — проверяем и сохраняем!",
};

export function PulsarGuide({ catalog, screen, categoryIds, step, editor, openRequest, onStart, onNext, onPrevious, onClose }: {
  catalog?: CrmCatalog; screen?: string; categoryIds: string[]; step: number | null; editor: boolean; openRequest: number;
  onStart: () => void; onNext: () => void; onPrevious: () => void; onClose: () => void;
}) {
  const [compact, setCompact] = useState(false), [mobileOpen, setMobileOpen] = useState(false);
  const [manualKey, setManualKey] = useState("");
  const [editing, setEditing] = useState<CrmInstruction | null>(null);
  const [checked, setChecked] = useState<number[]>([]);
  const [attention, setAttention] = useState(false), [unread, setUnread] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width:1099px)").matches);
  useEffect(() => { const query = window.matchMedia("(max-width:1099px)"), sync = () => setNarrow(query.matches); query.addEventListener("change", sync); return () => query.removeEventListener("change", sync); }, []);
  const folded = narrow ? !mobileOpen : compact, foldedRef = useRef(folded);
  foldedRef.current = folded;
  useEffect(() => { if (openRequest) { setCompact(false); setMobileOpen(true); setUnread(false); } }, [openRequest]);
  const pathKey = categoryIds.join("/");
  useEffect(() => { setManualKey(""); }, [pathKey, step, screen]);
  const tourStep = manualKey ? null : step, tour = tourStep !== null;
  const key = manualKey || (step !== null ? `guide:${GUIDE_STEPS[step].target}` : screen ?? (categoryIds.length ? `category:${categoryIds.at(-1)}` : "guide:welcome"));
  const current = catalog?.instructions?.[key];
  const context = selectedCategories(catalog?.categories ?? [], categoryIds);
  useEffect(() => { setChecked([]); }, [key, current?.revision]);
  // A new tip makes Pulsar jump and, when he is folded away, leaves a badge until he is opened.
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key; setAttention(true); if (foldedRef.current) setUnread(true);
    const timer = window.setTimeout(() => setAttention(false), 1800);
    return () => window.clearTimeout(timer);
  }, [key]);
  const total = current?.steps.length ?? 0, percent = total ? Math.round(checked.length / total * 100) : 0, finished = total > 0 && checked.length === total;
  const mood: PulsarMood = finished || (tourStep === GUIDE_STEPS.length - 1) ? "cheer" : tourStep === 0 ? "wave" : attention || tour ? "point" : "idle";
  const speech = finished ? "Отлично! Все шаги выполнены — можно сохранять." : tour ? phrases[GUIDE_STEPS[tourStep].target] : manualKey ? "Вы смотрите другую инструкцию." : screen ? "Подсказка для этого экрана:" : categoryIds.length ? "Для этой категории у меня есть инструкция:" : "Выберите категорию в форме — я подскажу, что делать.";
  const open = () => { setCompact(false); setMobileOpen(true); setUnread(false); };
  const categoryPath = (id: string) => { const labels: string[] = []; let node = catalog?.categories.find(n => n.id === id); while (node) { labels.unshift(node.label); const parent = node.parent_id; node = catalog?.categories.find(n => n.id === parent); } return labels.join(" › "); };
  return <aside className={`pulsar-dock${compact ? " is-compact" : ""}${mobileOpen ? " is-open" : ""}${attention ? " is-attention" : ""}`} aria-label="Пульсар — инструкции" data-instruction={key}>
    <header className="pulsar-hero">
      <div className="pulsar-hero-top"><span className="pulsar-name"><span className="pulsar-online"/>Пульсар<small>ваш наставник</small></span>{tour && <span className="pulsar-step-pill">Шаг {tourStep + 1} из {GUIDE_STEPS.length}</span>}
        <button className="pulsar-collapse" aria-label={compact ? "Развернуть Пульсара" : "Свернуть Пульсара"} onClick={() => compact ? open() : setCompact(true)}>{compact ? "↗" : "−"}</button>
        <button className="pulsar-mobile-toggle" aria-label={mobileOpen ? "Свернуть инструкцию" : "Открыть инструкцию Пульсара"} aria-expanded={mobileOpen} onClick={() => mobileOpen ? setMobileOpen(false) : open()}>{mobileOpen ? "⌄" : "⌃"}</button></div>
      <div className="pulsar-stage">
        <button className="pulsar-avatar" onClick={open} aria-label="Открыть подсказку Пульсара" tabIndex={folded ? 0 : -1}><PulsarFace mood={mood} />{unread && folded && <span className="pulsar-badge" aria-label="Новая подсказка">!</span>}</button>
        <div className="pulsar-bubble" aria-live="polite"><p className="pulsar-speech">{speech}</p><strong>{current?.title ?? "Открываю инструкции…"}</strong></div>
      </div>
      {tour && <ol className="pulsar-dots" aria-label="Прогресс знакомства">{GUIDE_STEPS.map((s, i) => <li key={s.target} className={i < tourStep ? "is-done" : i === tourStep ? "is-current" : ""}/>)}</ol>}
    </header>
    <div className="pulsar-dock-scroll">
      {editing ? <CrmInstructionEditor key={`${editing.key}:${editing.revision}`} instruction={editing} onClose={() => setEditing(null)} /> : <>
        <div className="pulsar-modes" role="tablist"><button role="tab" aria-selected={!tour && !manualKey} className={!tour && !manualKey ? "is-active" : ""} onClick={() => { setManualKey(""); onClose(); }}>📋 По обращению</button><button role="tab" aria-selected={tour} className={tour ? "is-active" : ""} onClick={() => { setManualKey(""); onStart(); }}>🚀 Первые шаги</button></div>
        {current ? <><div className="pulsar-instruction">{!tour && !manualKey && context.length > 0 && <p className="pulsar-context">{context.map(n => n.label).join(" › ")}</p>}<p className="pulsar-body">{current.body}</p></div>
          {total > 0 && <div className={`pulsar-checklist${finished ? " is-finished" : ""}`}><div className="pulsar-checklist-heading"><strong>Что сделать</strong><span>{checked.length} из {total}</span></div><div className="pulsar-progress" role="progressbar" aria-label="Отмеченные шаги памятки" aria-valuenow={checked.length} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${percent}%` }}/></div>{current.steps.map((text, index) => <label key={index} className={checked.includes(index) ? "is-done" : ""}><input type="checkbox" checked={checked.includes(index)} onChange={() => setChecked(previous => previous.includes(index) ? previous.filter(n => n !== index) : [...previous, index])}/><span>{checked.includes(index) ? "✓" : index + 1}</span><p>{text}</p></label>)}<small>Нажимайте на шаг, когда выполните его</small></div>}
          {editor && <div className="pulsar-edit-tools"><button className="pulsar-edit-button" onClick={() => { setEditing(current); open(); }}>✎ Изменить текст этой подсказки</button><label>Открыть другую инструкцию<select value={key} onChange={e => setManualKey(e.target.value)}><optgroup label="Знакомство с CRM">{GUIDE_STEPS.map(s => { const item = catalog?.instructions?.[`guide:${s.target}`]; return item && <option key={item.key} value={item.key}>{item.title}</option>; })}</optgroup><optgroup label="Учётные записи водителей">{Object.values(catalog?.instructions ?? {}).filter(item => item.key.startsWith("drivers:")).map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</optgroup><optgroup label="Категории обращений">{catalog?.categories.filter(n => !n.disabled).map(n => <option key={n.id} value={`category:${n.id}`}>{categoryPath(n.id)}</option>)}</optgroup></select></label></div>}
        </> : <p className="pulsar-muted">Загружаем инструкции. При ошибке используйте обновление данных CRM.</p>}
      </>}
    </div>
    {!editing && <footer className="pulsar-dock-footer">{step !== null ? <><button className="pulsar-text-button" disabled={step === 0} onClick={onPrevious}>← Назад</button><button className="pulsar-next" onClick={onNext}>{step === GUIDE_STEPS.length - 1 ? "Готово ✓" : step === 0 ? "Начать знакомство →" : "Дальше →"}</button></> : <button className="pulsar-text-button pulsar-restart" onClick={onStart}>🚀 Пройти знакомство с CRM заново</button>}</footer>}
  </aside>;
}
