import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { crm, type CrmAppeal } from "../api/crm";
import { CrmAppealForm } from "./crm/CrmAppealForm";
import { CrmAppealList } from "./crm/CrmAppealList";
import { CrmAppealDetail } from "./crm/CrmAppealDetail";
import { CrmCategories } from "./crm/CrmCategories";
import { GUIDE_STEPS, PulsarGuide } from "./crm/PulsarGuide";
import { CrmDrivers, type DriverScreen } from "./crm/drivers/CrmDrivers";
import { driverName, loadDrivers, saveDrivers, seedDrivers, type TrainingDriver } from "./crm/drivers/driverData";
import "./crm/drivers/drivers.css";
import "./crm/work-sites.css";
import "./crm/pulsar.css";

export function WorkSitesPage() {
  const { user } = useAuth(), navigate = useNavigate();
  const [params, setParams] = useSearchParams(), client = useQueryClient();
  const catalog = useQuery({ queryKey: ["crm-catalog"], queryFn: crm.catalog, refetchInterval: 30000 });
  const editor = ["trainer", "head", "admin"].includes(user?.role ?? "");
  const [dirty, setDirty] = useState(false), [copy, setCopy] = useState<CrmAppeal>(), [formKey, setFormKey] = useState(0), [notice, setNotice] = useState("");
  const [guide, setGuide] = useState<number | null>(() => { try { return localStorage.getItem(`crm-guide:${user?.id}`) ? null : 0; } catch { return 0; } });
  const [forward, setForward] = useState("");
  const [selection, setSelection] = useState<string[]>([]), [helpRequest, setHelpRequest] = useState(0);
  const instructionEditor = ["trainer", "supervisor", "head", "admin"].includes(user?.role ?? "");
  const updateSelection = useCallback((ids: string[]) => { setSelection(ids); if (ids.length) setGuide(null); }, []);
  const shell = useRef<HTMLDivElement>(null);
  const view = params.get("view") ?? "list", id = Number(params.get("appeal"));
  const driverId = Number(params.get("driver")) || undefined, driverScreen = (params.get("screen") ?? undefined) as DriverScreen | undefined;
  const [drivers, setDrivers] = useState<TrainingDriver[]>(() => loadDrivers(user?.id));
  const updateDriver = useCallback((driver: number, change: (d: TrainingDriver) => TrainingDriver) => setDrivers(previous => { const next = previous.map(d => d.id === driver ? change(d) : d); saveDrivers(user?.id, next); return next; }), [user?.id]);
  const currentDriver = drivers.find(d => d.id === driverId);
  const setFormDirty = useCallback((value: boolean) => setDirty(value), []);
  const pageTitle = view === "create" ? "Создать обращение" : view === "categories" ? "Категории" : view === "drivers" ? "Учётные записи водителей" : id ? `Обращение #${id}` : "Обращения";
  const driverScreenTitle: Record<DriverScreen, string> = { details: "Подробнее", smz: "Перевод в СМЗ", limit: "Лимит", car: "Автомобиль" };
  const pulsarScreen = view === "drivers" ? `drivers:${currentDriver ? driverScreen ?? "details" : "list"}` : undefined;
  const openDriver = (driver?: number, screen?: DriverScreen) => go(driver ? `view=drivers&driver=${driver}${screen && screen !== "details" ? `&screen=${screen}` : ""}` : "view=drivers");
  function go(query: string, force = false) {
    if (!force && dirty && !window.confirm("В обращении есть несохранённые изменения. Покинуть форму?")) return;
    setDirty(false); setParams(query); setNotice(""); if (!query.includes("view=create")) setSelection([]);
  }
  function create(initial?: CrmAppeal) { if (dirty && !window.confirm("Открыть новую форму? Несохранённые изменения будут потеряны.")) return; setCopy(initial); setFormKey(k => k + 1); setForward(""); go("view=create", true); }
  function hideGuide() { setGuide(null); try { localStorage.setItem(`crm-guide:${user?.id}`, "done"); } catch { /* Optional preference. */ } }
  useEffect(() => { if (guide === null || guide === 0) return; shell.current?.querySelector(`[data-tour="${GUIDE_STEPS[guide].target}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [guide]);
  const exit = () => { if (!dirty || window.confirm("В обращении есть несохранённые изменения. Вернуться в город?")) navigate("/training/city?district=crm"); };
  const guideTitle = guide === null ? "" : catalog.data?.instructions?.[`guide:${GUIDE_STEPS[guide].target}`]?.title;
  const guideLabel = guide === null ? undefined : { "--pulsar-label": JSON.stringify(`✦ Шаг ${guide + 1} из ${GUIDE_STEPS.length}${guideTitle ? ` · ${guideTitle}` : ""}`) } as CSSProperties;
  return <div className="work-sites" ref={shell} data-guide={guide === null || view === "drivers" ? "" : GUIDE_STEPS[guide].target} style={guideLabel}>
    <header className="work-sites-heading"><button onClick={exit}>← Мой город</button><h1>Рабочие сайты</h1><span className="work-sites-training">Учебная среда</span><button className="work-sites-guide-button" onClick={() => { setGuide(0); setHelpRequest(n => n + 1); }}>✦ Помощь Пульсара</button></header>
    <div className="work-browser"><nav className="work-browser-tabs" aria-label="Рабочие сайты"><button className="is-active" aria-current="page" onClick={() => {}}> <span className="crm-favicon">i</span> CRM-система <span className="work-tab-dot" /></button><button disabled title="Будет доступна позже">▧ Диспетчерская <small>Скоро</small></button><button disabled title="Новые рабочие сайты появятся позже">＋ Другие сайты</button></nav>
    <div className="work-browser-address"><button aria-label="Назад к обращениям" disabled={view === "list" && !id} onClick={() => { if (dirty && !window.confirm("Покинуть форму без сохранения?")) return; setForward(params.toString()); go("", true); }}>←</button><button aria-label="Вперёд" disabled={!forward || view !== "list" || !!id} onClick={() => { go(forward); setForward(""); }}>→</button><button aria-label="Обновить данные CRM" onClick={() => { client.invalidateQueries({ queryKey: ["crm-catalog"] }); client.invalidateQueries({ queryKey: ["crm-appeals"] }); client.invalidateQueries({ queryKey: ["crm-appeal"] }); setNotice("Данные обновляются. Введённые поля сохранены в форме."); }}>⟳</button><div className="work-address-text"><span aria-hidden="true">▣</span><span>{view === "drivers" ? `crm.training / водители / учётные записи${currentDriver ? ` / ${currentDriver.id}${driverScreen && driverScreen !== "details" ? ` / ${driverScreen}` : ""}` : ""}` : `crm.training / обращения${view === "create" ? " / создать" : view === "categories" ? " / категории" : id ? ` / ${id}` : ""}`}</span><small>Учебная копия</small></div><button aria-label="Развернуть окно" onClick={() => { const action = document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen(); action?.catch(() => setNotice("Полноэкранный режим недоступен в этом браузере.")); }}>⛶</button></div>
    <div className="crm-app"><header className="crm-header"><button className="crm-logo" onClick={() => go("")}>iTaxi</button><span>CRM-система</span><div className="crm-account"><span className="crm-avatar">{user?.full_name.split(" ").filter(Boolean).slice(0, 2).map(word => word[0]).join("")}</span><strong>{user?.full_name}</strong></div></header>
    <div className="crm-layout"><aside className="crm-sidebar" aria-label="Разделы CRM"><div className="crm-sidebar-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div><div className="crm-sidebar-group"><span>♙</span>Водители <small>⌄</small></div><button className={view === "drivers" ? "is-active" : ""} aria-current={view === "drivers" ? "page" : undefined} onClick={() => openDriver()}>Учётные записи водителей</button>{[["♧", "Акции"], ["▣", "Контент"]].map(([icon, label]) => <button disabled key={label} title="Раздел пока недоступен"><span>{icon}</span>{label}<small>‹</small></button>)}<div className="crm-sidebar-group"><span>☷</span>Тикетная система <small>⌄</small></div><button className={view !== "drivers" ? "is-active" : ""} aria-current={view !== "drivers" ? "page" : undefined} onClick={() => go("")}>Обращения</button>{["Тикеты", "Отчёты", "ЭДО"].map(label => <button disabled key={label} title="Раздел пока недоступен">{label}<small>‹</small></button>)}<div className="crm-sidebar-bottom"><span className="work-tab-dot" /> Учебная CRM<span>Данные сохраняются</span></div></aside>
    <main className="crm-main"><div className="crm-breadcrumb"><button onClick={() => go("")}>Главная</button><span>/</span>{view === "drivers" ? <><button onClick={() => openDriver()}>Учётные записи водителей</button>{currentDriver && <><span>/</span><button onClick={() => openDriver(currentDriver.id)}>{driverName(currentDriver)}</button>{driverScreen && driverScreen !== "details" && <><span>/</span><span>{driverScreenTitle[driverScreen]}</span></>}</>}</> : <><button onClick={() => go("")}>Обращения</button>{pageTitle !== "Обращения" && <><span>/</span><span>{pageTitle}</span></>}</>}{editor && view !== "drivers" && <button className="crm-manage-link" onClick={() => go("view=categories")}>Настроить категории</button>}</div>
    {notice && <div className="crm-notice" role="status">✓ {notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice("")}>×</button></div>}
    {catalog.isPending && <div className="crm-empty" role="status">Открываем CRM…</div>}{catalog.isError && <div className="crm-empty" role="alert"><p>{catalog.error.message}</p><button className="crm-secondary" onClick={() => catalog.refetch()}>Повторить</button></div>}
    {catalog.data && (view === "create" ? <CrmAppealForm key={formKey} catalog={catalog.data} initial={copy} onDirty={setFormDirty} onCategoryChange={updateSelection} onRequestHelp={() => { hideGuide(); setHelpRequest(n => n + 1); }} onSaved={(appeal, duplicate) => { client.invalidateQueries({ queryKey: ["crm-appeals"] }); client.setQueryData(["crm-appeal", appeal.id], appeal); setDirty(false); hideGuide(); if (duplicate) { setCopy(appeal); setFormKey(k => k + 1); } else go(`appeal=${appeal.id}`, true); setNotice(`Обращение #${appeal.id} сохранено и доступно всем участникам.${duplicate ? " Открыта копия; вложения нужно добавить заново." : ""}`); }} /> : view === "drivers" ? <CrmDrivers key={`${driverId ?? "list"}:${driverScreen ?? ""}`} drivers={drivers} update={updateDriver} open={openDriver} notify={setNotice} driverId={driverId} screen={driverScreen} onReset={() => { const fresh = seedDrivers(); setDrivers(fresh); saveDrivers(user?.id, fresh); setNotice("Учебные водители возвращены в исходное состояние."); }} /> : view === "categories" && editor ? <CrmCategories nodes={catalog.data.categories} /> : id > 0 ? <CrmAppealDetail id={id} editor={editor} onDuplicate={create} /> : <CrmAppealList catalog={catalog.data} onOpen={appeal => go(`appeal=${appeal}`)} onCreate={() => create()} />)}
    <footer className="crm-bottom-note">Учебная CRM · Практика работы с обращениями</footer></main></div></div></div>
    <PulsarGuide catalog={catalog.data} screen={pulsarScreen} categoryIds={selection} step={view === "drivers" ? null : guide} editor={instructionEditor} openRequest={helpRequest} onStart={() => { if (view === "drivers") go(""); setGuide(0); }} onClose={hideGuide} onPrevious={() => setGuide(s => Math.max(0, (s ?? 1) - 1))} onNext={() => { if (guide === null || guide === GUIDE_STEPS.length - 1) hideGuide(); else { if (guide === 0 && view !== "create") create(); setGuide(guide + 1); } }} />
  </div>;
}
