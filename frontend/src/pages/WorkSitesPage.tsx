import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { categoryRules, crm, type CrmAppeal } from "../api/crm";
import { CrmAppealForm } from "./crm/CrmAppealForm";
import { CrmAppealList } from "./crm/CrmAppealList";
import { CrmAppealDetail } from "./crm/CrmAppealDetail";
import { CrmCategories } from "./crm/CrmCategories";
import { PulsarGuide } from "./crm/PulsarGuide";
import { useGuide } from "../guide";
import { PulsarCoach } from "./crm/PulsarCoach";
import { appealTour, COACH_TOURS, type CoachStep, type CoachTourId } from "./crm/coachTours";
import { COPY_EVENT, copyKind, copyText, selectedText, type AccountData, type CopyKind } from "./crm/accountData";
import { fleet as fleetApi, type FleetDriver, type FleetPark, type FleetResponse, type FleetState } from "../api/dispatch";
import { DEFAULT_PARK, DispatchSite, FLEET_QUERY } from "./dispatch/DispatchSite";
import { CoachCourierCode, DispatchDock, type FleetFeedback } from "./dispatch/DispatchDock";
import { FLEET_TOUR, callTour, driverAccount } from "./dispatch/dispatchTours";
import { fleetLink, parseRoute, routePath } from "./dispatch/fleetNav";
import { rememberScenarioWorkspace, preserveScenarioContext, scenarioKeys, scenarios } from "../api/scenarios";
import { canCheckScenarioAppeal, scenarioInspection, ScenarioPracticePanel, type ScenarioInspection } from "./scenarios/ScenarioPracticePanel";
import { OKTELL_QUERY, oktell as oktellApi, type OktellScreen } from "../api/oktell";
import { OKTELL_TOUR } from "./oktell/oktellTour";
import "./crm/coach.css";
import { CrmDrivers, type DriverScreen } from "./crm/drivers/CrmDrivers";
import { driverName, fromFleet, parkLabel, type TrainingDriver } from "./crm/drivers/driverData";
import "./crm/drivers/drivers.css";
import { CrmSidebar, SECTION_TOURS, SECTION_VIEWS, SectionPage, useSections } from "./crm/sections/CrmSections";
import "./crm/work-sites.css";
import "./crm/pulsar.css";
import "./scenarios/scenario-workspace.css";

const OktellSite = lazy(() => import("./oktell/OktellSite").then(module => ({ default: module.OktellSite })));

export function WorkSitesPage() {
  const { user } = useAuth(), navigate = useNavigate();
  const [params, setParams] = useSearchParams(), client = useQueryClient();
  const currentParams = useRef(params);
  currentParams.current = params;
  const scenarioAttemptId = params.get("scenarioAttempt") ?? undefined;
  const scenario = useQuery({ queryKey: scenarioKeys.attempt(scenarioAttemptId ?? ""), queryFn: ({ signal }) => scenarios.attempt(scenarioAttemptId!, signal), enabled: !!scenarioAttemptId, retry: false, refetchOnWindowFocus: true });
  useEffect(() => {
    if (user?.id && scenarioAttemptId && scenario.data) rememberScenarioWorkspace(user.id, scenarioAttemptId, params);
  }, [user?.id, scenarioAttemptId, params, scenario.data]);
  const workspaceReady = !scenarioAttemptId || !!scenario.data && !scenario.isError;
  const catalog = useQuery({ queryKey: ["crm-catalog"], queryFn: crm.catalog, refetchInterval: 30000, enabled: workspaceReady });
  const inspect = useMutation({ mutationFn: ({ attemptId, input }: { attemptId: string; input: ScenarioInspection }) => scenarios.inspect(attemptId, input), onSuccess: value => client.setQueryData(scenarioKeys.attempt(value.id), value) });
  const verifyAppeal = useMutation({ mutationFn: ({ attemptId, appealId }: { attemptId: string; appealId: number }) => scenarios.crmCheck(attemptId, appealId), onSuccess: value => client.setQueryData(scenarioKeys.attempt(value.id), value) });
  const inspectedViews = useRef(new Set<string>());
  const editor = ["trainer", "head", "admin"].includes(user?.role ?? "");
  const [dirty, setDirty] = useState(false), [copy, setCopy] = useState<CrmAppeal>(), [formKey, setFormKey] = useState(0), [notice, setNotice] = useState("");
  const guide = useGuide();
  // The running tour: CRM tours by id, dispatch tours built from the cabinet's calls. A `cross` tour
  // walks between the tabs itself, so switching them keeps it.
  const [coach, setCoach] = useState<{ id: string; steps: CoachStep[]; cross?: boolean } | null>(null);
  const [forward, setForward] = useState("");
  const [selection, setSelection] = useState<string[]>([]), [helpRequest, setHelpRequest] = useState(0);
  const instructionEditor = ["trainer", "supervisor", "head", "admin"].includes(user?.role ?? "");
  const updateSelection = useCallback((ids: string[]) => { setSelection(ids); }, []);
  const shell = useRef<HTMLDivElement>(null);
  const view = params.get("view") ?? "list", id = Number(params.get("appeal"));
  const scenarioDriver = scenario.data?.driver;
  // Each work site keeps its own address and unfinished forms while another tab is open.
  const site = params.get("site") === "dispatch" || scenarioAttemptId && params.get("site") === "oktell" ? "dispatch" : !scenarioAttemptId && params.get("site") === "oktell" ? "oktell" : "crm";
  useEffect(() => {
    if (!scenarioAttemptId || params.get("site") !== "oktell") return;
    const next = new URLSearchParams(params); next.set("site", "dispatch"); next.delete("oscreen");
    setParams(next, { replace: true });
  }, [scenarioAttemptId, params, setParams]);
  useEffect(() => {
    const tabs = shell.current?.querySelector<HTMLElement>(".work-browser-tabs");
    const selected = tabs?.querySelector<HTMLElement>("[aria-current=page]");
    if (!tabs || !selected) return;
    const reveal = () => {
      const rail = tabs.getBoundingClientRect(), tab = selected.getBoundingClientRect();
      if (tab.left < rail.left || tab.right > rail.right) {
        tabs.scrollLeft += tab.left - rail.left - (tabs.clientWidth - tab.width) / 2;
      }
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [site]);
  const oktellScreen = (["cabinet", "phone", "messages", "journal"].includes(params.get("oscreen") ?? "") ? params.get("oscreen") : "cabinet") as OktellScreen;
  const [oktellVisited, setOktellOpened] = useState(site === "oktell");
  const oktellOpened = oktellVisited || site === "oktell";
  // The workspace's own query fetches; this one only learns that Oktell is on screen for Pulsar.
  const oktellLoaded = !!useQuery({ queryKey: [...OKTELL_QUERY, user?.id], queryFn: ({ signal }) => oktellApi.state(signal), enabled: false }).data;
  const fleetRoute = parseRoute(params.get("fleet")), fleetPark = params.get("fpark") ?? DEFAULT_PARK;
  const [fleetVisited, setFleetOpened] = useState(site === "dispatch");
  // Browser «Back» can return to the dispatch tab after a reload, so the address alone mounts it too.
  const fleetOpened = fleetVisited || site === "dispatch";
  // One fleet for both tabs: CRM «Учётные записи водителей» shows the accounts of «Диспетчерская».
  const fleetQuery = useQuery({ queryKey: FLEET_QUERY, queryFn: fleetApi.state, enabled: workspaceReady });
  const inspection = site === "dispatch" && workspaceReady && fleetRoute.page === "driver"
    && fleetQuery.data?.drivers.some(driver => driver.id === fleetRoute.id && driver.park === fleetPark)
    ? scenarioInspection(scenario.data, fleetRoute.id, fleetPark, fleetRoute.tab) : null;
  const inspectionKey = inspection && scenarioAttemptId ? `${scenarioAttemptId}:${scenario.data?.current_step}:${inspection.section}` : "";
  function visibleInspection() {
    if (!inspection) return false;
    const tab = inspection.section === "profile" ? "details" : "car";
    const visible = shell.current?.querySelector<HTMLElement>(`.fleet-app:not([hidden]) .fleet[data-page="driver"] [data-coach="tab-${tab}"][aria-current="page"]`);
    return !!visible?.getClientRects().length;
  }
  function retryInspection() {
    if (!scenarioAttemptId || !inspection || inspect.isPending || !visibleInspection()) return;
    inspect.mutate({ attemptId: scenarioAttemptId, input: inspection });
  }
  useEffect(() => {
    if (!scenarioAttemptId || !inspection || !inspectionKey || inspect.isPending || inspectedViews.current.has(inspectionKey)) return;
    const frame = requestAnimationFrame(() => {
      if (!visibleInspection()) return;
      inspectedViews.current.add(inspectionKey);
      inspect.mutate({ attemptId: scenarioAttemptId, input: inspection });
    });
    return () => cancelAnimationFrame(frame);
  }, [scenarioAttemptId, inspectionKey, inspect.isPending, fleetQuery.data]); // The committed driver tab must actually be visible.
  const [fleetFeedback, setFleetFeedback] = useState<FleetFeedback | null>(null);
  const [copied, setCopied] = useState(false);
  // The call a CRM request is made for: the appeal is about its driver until the call is solved.
  const [crmCall, setCrmCall] = useState<string | null>(null);
  // What the operator copied last, recognised against the appeal's account: Pulsar waits for the right piece.
  const [copiedKind, setCopiedKind] = useState<CopyKind | "">("");
  const appealAccountsRef = useRef<AccountData[]>([]);
  useEffect(() => {
    const seen = (text: string) => setCopiedKind(copyKind(text, appealAccountsRef.current));
    const keys = () => seen(selectedText()), button = (event: Event) => seen((event as CustomEvent<string>).detail);
    // A paste uses the copy up: going back for the same piece asks for a fresh copy.
    const pasted = () => setCopiedKind("");
    document.addEventListener("copy", keys); document.addEventListener("paste", pasted); window.addEventListener(COPY_EVENT, button);
    return () => { document.removeEventListener("copy", keys); document.removeEventListener("paste", pasted); window.removeEventListener(COPY_EVENT, button); };
  }, []);
  const [fleetHistory, setFleetHistory] = useState<{ back: string[]; forward: string[] }>({ back: [], forward: [] });
  const driverId = Number(params.get("driver")) || undefined, driverScreen = (params.get("screen") ?? undefined) as DriverScreen | undefined;
  const drivers = useMemo(() => fleetQuery.data ? fromFleet(fleetQuery.data) : [], [fleetQuery.data]);
  const fleetParks = useMemo(() => (fleetQuery.data?.parks ?? []).map(p => ({ id: p.id, label: parkLabel(p) })), [fleetQuery.data]);
  // Every CRM change of an account answers with the whole fleet: both tabs show it at once.
  const saveFleet = useCallback(async (run: () => Promise<FleetResponse>) => { const response = await run(); client.setQueryData(FLEET_QUERY, response.state); return response; }, [client]);
  // «Акции», «ЭДО» and «Регистрация водителей» keep each participant's own training copy.
  const sections = useSections(user?.id, drivers), sectionView = SECTION_VIEWS[view];
  const currentDriver = drivers.find(d => d.id === driverId);
  const setFormDirty = useCallback((value: boolean) => setDirty(value), []);
  const pageTitle = sectionView ? sectionView.title : view === "create" ? "Создать обращение" : view === "categories" ? "Категории" : view === "drivers" ? "Учётные записи водителей" : id ? `Обращение #${id}` : "Обращения";
  const driverScreenTitle: Record<DriverScreen, string> = { details: "Подробнее", smz: "Перевод в СМЗ", limit: "Лимит", car: "Автомобиль" };
  const pulsarScreen = sectionView ? sectionView.screen : view === "drivers" ? `drivers:${currentDriver ? driverScreen ?? "details" : "list"}` : undefined;
  /** «В Диспетчерской» in the CRM card: the same account in its park of the dispatch. */
  const openFleetDriver = (driver: TrainingDriver) => { setFleetOpened(true); setCoach(null); client.invalidateQueries({ queryKey: FLEET_QUERY }); goFleet(`driver/${driver.account}`, driver.parkId); };
  const openDriver = (driver?: number, screen?: DriverScreen) => go(driver ? `view=drivers&driver=${driver}${screen && screen !== "details" ? `&screen=${screen}` : ""}` : "view=drivers");
  function go(query: string, force = false) {
    if (!force && dirty && !window.confirm("В обращении есть несохранённые изменения. Покинуть форму?")) return;
    const next = preserveScenarioContext(new URLSearchParams(query), params);
    for (const key of ["fleet", "fpark", "oscreen"]) { const value = params.get(key); if (value) next.set(key, value); }
    setDirty(false); setParams(next); setNotice(""); if (!query.includes("view=create")) setSelection([]);
  }
  function goFleet(path: string, park = fleetPark, record = true) {
    const next = new URLSearchParams(params); next.set("site", "dispatch"); next.set("fleet", path); next.set("fpark", park);
    if (record) setFleetHistory(h => ({ back: [...h.back, `${routePath(fleetRoute)}|${fleetPark}`].slice(-40), forward: [] }));
    setParams(next);
  }
  function fleetStep(from: "back" | "forward") {
    const list = fleetHistory[from], target = list.at(-1);
    if (!target) return;
    const here = `${routePath(fleetRoute)}|${fleetPark}`, [path, park] = target.split("|");
    setFleetHistory(h => from === "back" ? { back: h.back.slice(0, -1), forward: [...h.forward, here] } : { forward: h.forward.slice(0, -1), back: [...h.back, here] });
    goFleet(path, park, false);
  }
  // Switching tabs keeps both pages mounted, so an unsaved CRM form survives a look into the dispatch.
  function openSite(target: "crm" | "dispatch" | "oktell") {
    if (target === site || scenarioAttemptId && target === "oktell") return;
    const next = new URLSearchParams(params);
    // Back in the dispatch, the cabinet reloads: a CRM request may have solved a call meanwhile.
    if (target === "dispatch") { next.set("site", "dispatch"); setFleetOpened(true); client.invalidateQueries({ queryKey: FLEET_QUERY }); }
    else if (target === "oktell") { next.set("site", "oktell"); setOktellOpened(true); client.invalidateQueries({ queryKey: OKTELL_QUERY }); }
    else next.delete("site");
    setCoach(current => current?.cross ? current : null); setParams(next);
  }
  function goOktell(screen: OktellScreen) {
    const next = new URLSearchParams(currentParams.current); next.set("oscreen", screen); setParams(next);
  }
  function create(initial?: CrmAppeal) { if (dirty && !window.confirm("Открыть новую форму? Несохранённые изменения будут потеряны.")) return; setCopy(initial); setFormKey(k => k + 1); setForward(""); go("view=create", true); }
  // Pulsar walks each participant through a section once; the help button replays the tour.
  const seenKey = (tour: string) => tour === "appeals" ? `crm-guide:${user?.id}` : tour === "drivers" ? `crm-guide-drivers:${user?.id}` : tour === "fleet" ? `dispatch-guide:${user?.id}` : tour === "oktell" ? `oktell-guide:${user?.id}` : Object.values(SECTION_TOURS).includes(tour as CoachTourId) ? `crm-guide-${tour}:${user?.id}` : "";
  // «Помощь Пульсара» replays the tour of the screen the operator is on.
  const helpTour: CoachTourId = SECTION_TOURS[view] ?? (view === "drivers" ? "drivers" : "appeals");
  function startCoach(tour: CoachTourId) {
    if (tour === "drivers" && (view !== "drivers" || driverId)) go("view=drivers");
    if (tour === "appeals" && view !== "create" && (view !== "list" || id)) go("");
    if (tour === "registration" && params.get("reg")) go("view=registration");
    setCoach(tourOf(tour));
  }
  /** «fleet» walks through the cabinet; «call:<id>» shows one call on its own park and driver. */
  function startFleetTour(tour: string, state: FleetState | undefined = fleetQuery.data) {
    if (tour === "fleet") { if (fleetRoute.page !== "contractors" || fleetRoute.id) goFleet("contractors"); setCoach({ id: tour, steps: FLEET_TOUR }); return; }
    const call = state?.calls.find(c => `call:${c.id}` === tour), driver = state?.drivers.find(d => d.id === call?.driver), park = state?.parks.find(p => p.id === call?.park);
    // A call waiting for its CRM request is shown there: the appeal about its driver.
    if (call?.state === "crm" && driver && park) { setCrmCall(call.id); if (view === "create") openSite("crm"); else create(); setCoach({ id: "appeals", steps: appealTour(driverAccount(driver, park)), cross: true }); return; }
    if (call && driver && park) setCoach({ id: tour, steps: callTour(call, driver, park) });
  }
  const endCoach = useCallback((finished: boolean) => { setCoach(current => { const key = current && seenKey(current.id); if (key) try { localStorage.setItem(key, finished ? "done" : "closed"); } catch { /* Optional preference. */ } return null; }); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionTour: CoachTourId | null = SECTION_TOURS[view] && !params.get("reg") ? SECTION_TOURS[view] : view === "drivers" && !driverId ? "drivers" : (view === "list" && !id) || view === "create" ? "appeals" : null;
  useEffect(() => {
    if (scenarioAttemptId || site !== "crm" || !catalog.data || !sectionTour || coach) return;
    let seen = true; try { seen = !!localStorage.getItem(seenKey(sectionTour)); } catch { /* Without storage the tour stays manual. */ }
    if (!seen) { const timer = window.setTimeout(() => setCoach(tourOf(sectionTour)), 600); return () => window.clearTimeout(timer); }
  }, [catalog.data, sectionTour, site, scenarioAttemptId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The first visit to the dispatch starts the tour of the cabinet once.
  useEffect(() => {
    if (scenarioAttemptId || site !== "dispatch" || !fleetQuery.data || coach) return;
    let seen = true; try { seen = !!localStorage.getItem(seenKey("fleet")); } catch { /* Without storage the tour stays manual. */ }
    if (!seen) { const timer = window.setTimeout(() => startFleetTour("fleet"), 700); return () => window.clearTimeout(timer); }
  }, [fleetQuery.data, site, scenarioAttemptId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The first visit to Oktell walks through it once; «Помощь Пульсара» replays the walk.
  useEffect(() => {
    if (scenarioAttemptId || site !== "oktell" || !oktellLoaded || coach) return;
    let seen = true; try { seen = !!localStorage.getItem(seenKey("oktell")); } catch { /* Without storage the tour stays manual. */ }
    if (!seen) { const timer = window.setTimeout(() => setCoach({ id: "oktell", steps: OKTELL_TOUR }), 700); return () => window.clearTimeout(timer); }
  }, [oktellLoaded, site, scenarioAttemptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const exit = () => { if (!dirty || window.confirm("В обращении есть несохранённые изменения. Покинуть форму?")) navigate(scenarioAttemptId ? `/training/scenarios/attempts/${encodeURIComponent(scenarioAttemptId)}` : `/training/city?district=${site}`); };
  // On a driver's page the address is the link operators copy into CRM: its ID finds the same account there.
  const fleetDriver = fleetRoute.page === "driver" ? fleetQuery.data?.drivers.find(d => d.id === fleetRoute.id) : undefined;
  const fleetDriverLink = fleetDriver && fleetLink(fleetDriver, fleetQuery.data?.parks.find(p => p.id === fleetDriver.park));
  // The appeal is about the driver of the call or the scenario. Without one Pulsar hands over his
  // test driver's data, and the account open in the Диспетчерская counts too.
  const targetId = fleetQuery.data?.calls.find(c => c.id === crmCall && c.state === "crm")?.driver ?? scenarioDriver?.id;
  const appealTarget = targetId ? fleetQuery.data?.drivers.find(d => d.id === targetId) : undefined;
  const appealPark = appealTarget && fleetQuery.data?.parks.find(p => p.id === appealTarget.park);
  const testDriver = fleetQuery.data?.drivers.find(d => d.id === fleetQuery.data?.test_driver);
  const testPark = testDriver && fleetQuery.data?.parks.find(p => p.id === testDriver.park);
  const appealAccounts: AccountData[] = (appealTarget ? [appealTarget] : [testDriver, fleetDriver])
    .filter((d): d is FleetDriver => !!d).map(d => ({ id: d.id, phone: d.phone, license: d.license }));
  appealAccountsRef.current = appealAccounts;
  const needsLink = view === "create" && !!catalog.data && categoryRules(catalog.data.categories, selection).has("account_link");
  /** The appeal tour walks to the driver's account in the Диспетчерская and back, so it lives on both tabs. */
  function tourOf(tour: CoachTourId) {
    return tour === "appeals" ? { id: tour, steps: appealTour(appealTarget && appealPark ? driverAccount(appealTarget, appealPark) : undefined), cross: true } : { id: tour, steps: COACH_TOURS[tour] };
  }
  const fleetAddress = fleetDriverLink ? fleetDriverLink.replace("https://", "") : `fleet.training / ${routePath(fleetRoute).replace(/\//g, " / ")} · ${fleetPark}`;
  return <div className={`work-sites${scenarioAttemptId ? " work-sites--scenario" : ""}${coach && !scenarioAttemptId ? " is-coaching" : ""}`} data-site={site} data-copied={copiedKind} data-link={needsLink ? "need" : ""} ref={shell}>
    <header className="work-sites-heading"><button onClick={exit}>{scenarioAttemptId ? "← К сценарию" : "← Мой город"}</button><h1>Рабочие сайты</h1><span className="work-sites-training">Учебная среда</span>{!scenarioAttemptId && <button className="work-sites-guide-button" onClick={() => site === "oktell" ? setCoach({ id: "oktell", steps: OKTELL_TOUR }) : site === "dispatch" ? startFleetTour("fleet") : startCoach(helpTour)}>✦ {guide.text("Помощь Пульсара")}</button>}</header>
    {scenarioAttemptId && <ScenarioPracticePanel attempt={scenario.data} loading={scenario.isPending} error={scenario.error} onReload={() => void scenario.refetch()}
      inspectionPending={inspect.isPending && inspect.variables?.attemptId === scenarioAttemptId}
      inspectionError={(inspection || scenario.data?.practice.required_section === "classifier") && inspect.variables?.attemptId === scenarioAttemptId ? inspect.error : undefined} onRetryInspection={inspection ? retryInspection : undefined}
      onCheckClassifier={scenarioAttemptId && scenario.data?.practice.required_section === "classifier" ? result => inspect.mutate({ attemptId: scenarioAttemptId, input: { driver_id: scenario.data!.driver.id, park_id: scenario.data!.driver.park_id, section: "classifier", classification_result: result } }) : undefined}
      appealId={id || undefined} crmPending={verifyAppeal.isPending && verifyAppeal.variables?.attemptId === scenarioAttemptId}
      crmError={verifyAppeal.variables?.attemptId === scenarioAttemptId ? verifyAppeal.error : undefined}
      onCheckAppeal={canCheckScenarioAppeal(scenario.data, id) ? () => verifyAppeal.mutate({ attemptId: scenarioAttemptId, appealId: id }) : undefined} />}
    {workspaceReady && <div className="work-browser"><nav className="work-browser-tabs" aria-label="Рабочие сайты"><button className={site === "crm" ? "is-active" : ""} aria-current={site === "crm" ? "page" : undefined} data-coach="site-crm" onClick={() => openSite("crm")}> <span className="crm-favicon">i</span> CRM-система {site === "crm" && <span className="work-tab-dot" />}</button><button className={site === "dispatch" ? "is-active" : ""} aria-current={site === "dispatch" ? "page" : undefined} data-coach="site-dispatch" onClick={() => openSite("dispatch")}><span className="fleet-favicon" aria-hidden="true">✕</span> Диспетчерская {site === "dispatch" && <span className="work-tab-dot" />}</button>{!scenarioAttemptId && <><button className={site === "oktell" ? "is-active" : ""} aria-current={site === "oktell" ? "page" : undefined} onClick={() => openSite("oktell")}><span className="oktell-favicon" aria-hidden="true">🎧</span> Oktell {site === "oktell" && <span className="work-tab-dot" />}</button><button disabled title="Новые рабочие сайты появятся позже">＋ Другие сайты</button></>}</nav>
    {site === "oktell" ? <div className="work-browser-address"><button aria-label="К кабинету Oktell" disabled={oktellScreen === "cabinet"} onClick={() => goOktell("cabinet")}>←</button><button aria-label="Обновить Oktell" onClick={() => { client.invalidateQueries({ queryKey: OKTELL_QUERY }); }}>⟳</button><div className="work-address-text"><span aria-hidden="true">▣</span><span>oktell.training / {({ cabinet: "кабинет", phone: "телефон", messages: "сообщения", journal: "журнал" })[oktellScreen]}</span><small>Учебная копия</small></div><button aria-label="Развернуть окно" onClick={() => { const action = document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen(); action?.catch(() => undefined); }}>⛶</button></div>
    : site === "dispatch" ? <div className="work-browser-address"><button aria-label="Назад" disabled={!fleetHistory.back.length} onClick={() => fleetStep("back")}>←</button><button aria-label="Вперёд" disabled={!fleetHistory.forward.length} onClick={() => fleetStep("forward")}>→</button><button aria-label="Обновить Диспетчерскую" onClick={() => { client.invalidateQueries({ queryKey: FLEET_QUERY }); }}>⟳</button><div className="work-address-text"><span aria-hidden="true">▣</span><span data-coach="fleet-address">{fleetDriver && fleetDriverLink ? <AddressWithId address={fleetAddress} id={fleetDriver.id} /> : fleetAddress}</span><small>Учебная копия</small></div>{fleetDriverLink && <button className={copied ? "is-done" : undefined} aria-label={copied ? "Ссылка скопирована" : "Скопировать ссылку на водителя"} title="Скопировать ссылку на водителя: по ID из неё водителя находят в CRM" data-coach="copy-link" onClick={() => { void copyText(fleetDriverLink).then(ok => { if (!ok) return; setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }}>{copied ? "✓" : "⧉"}</button>}<button aria-label="Развернуть окно" onClick={() => { const action = document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen(); action?.catch(() => undefined); }}>⛶</button></div>
    : <div className="work-browser-address"><button aria-label="Назад к обращениям" disabled={view === "list" && !id} onClick={() => { if (dirty && !window.confirm("Покинуть форму без сохранения?")) return; setForward(params.toString()); go("", true); }}>←</button><button aria-label="Вперёд" disabled={!forward || view !== "list" || !!id} onClick={() => { go(forward); setForward(""); }}>→</button><button aria-label="Обновить данные CRM" onClick={() => { client.invalidateQueries({ queryKey: ["crm-catalog"] }); client.invalidateQueries({ queryKey: ["crm-appeals"] }); client.invalidateQueries({ queryKey: ["crm-appeal"] }); client.invalidateQueries({ queryKey: FLEET_QUERY }); setNotice("Данные обновляются. Введённые поля сохранены в форме."); }}>⟳</button><div className="work-address-text"><span aria-hidden="true">▣</span><span>{sectionView ? `crm.training / ${sectionView.address}${params.get("reg") ? ` / ${params.get("reg")}` : ""}` : view === "drivers" ? `crm.training / водители / учётные записи${currentDriver ? ` / ${currentDriver.id}${driverScreen && driverScreen !== "details" ? ` / ${driverScreen}` : ""}` : ""}` : `crm.training / обращения${view === "create" ? " / создать" : view === "categories" ? " / категории" : id ? ` / ${id}` : ""}`}</span><small>Учебная копия</small></div><button aria-label="Развернуть окно" onClick={() => { const action = document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen(); action?.catch(() => setNotice("Полноэкранный режим недоступен в этом браузере.")); }}>⛶</button></div>}
    {fleetOpened && <div className="fleet-app" hidden={site !== "dispatch"}><DispatchSite route={fleetRoute} parkId={fleetPark} go={goFleet} onResult={setFleetFeedback} /></div>}
    {!scenarioAttemptId && oktellOpened && <div className="oktell-app" hidden={site !== "oktell"}><Suspense fallback={<div className="crm-empty" role="status">Открываем Oktell…</div>}><OktellSite screen={oktellScreen} go={goOktell} active={site === "oktell"} /></Suspense></div>}
    <div className="crm-app" hidden={site !== "crm"}><header className="crm-header"><button className="crm-logo" onClick={() => go("")}>iTaxi</button><span>CRM-система</span><div className="crm-account"><span className="crm-avatar">{user?.full_name.split(" ").filter(Boolean).slice(0, 2).map(word => word[0]).join("")}</span><strong>{user?.full_name}</strong></div></header>
    <div className="crm-layout"><CrmSidebar view={view} open={target => target === "drivers" ? openDriver() : target === "list" ? go("") : go(`view=${target}`)} />
    <main className="crm-main"><div className="crm-breadcrumb"><button onClick={() => go("")}>Главная</button><span>/</span>{sectionView ? <><span>{sectionView.group}</span><span>/</span>{view === "registration-new" || params.get("reg") ? <><button onClick={() => go("view=registration")}>Регистрация водителей</button><span>/</span><span>{view === "registration-new" ? "Новый водитель" : `№${params.get("reg")}`}</span></> : <span>{sectionView.title}</span>}</> : view === "drivers" ? <><button onClick={() => openDriver()}>Учётные записи водителей</button>{currentDriver && <><span>/</span><button onClick={() => openDriver(currentDriver.id)}>{driverName(currentDriver)}</button>{driverScreen && driverScreen !== "details" && <><span>/</span><span>{driverScreenTitle[driverScreen]}</span></>}</>}</> : <><button onClick={() => go("")}>Обращения</button>{pageTitle !== "Обращения" && <><span>/</span><span>{pageTitle}</span></>}</>}{editor && view !== "drivers" && !sectionView && <button className="crm-manage-link" onClick={() => go("view=categories")}>Настроить категории</button>}</div>
    {notice && <div className="crm-notice" role="status">✓ {notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice("")}>×</button></div>}
    {catalog.isPending && <div className="crm-empty" role="status">Открываем CRM…</div>}{catalog.isError && <div className="crm-empty" role="alert"><p>{catalog.error.message}</p><button className="crm-secondary" onClick={() => catalog.refetch()}>Повторить</button></div>}
    {sectionView ? sections.state ? <SectionPage view={view} params={params} state={sections.state} update={sections.update} drivers={drivers} save={saveFleet} parks={fleetParks} employee={user?.full_name ?? "Оператор"} notify={setNotice} openDriver={driver => openDriver(driver)} go={query => go(query)} /> : <FleetLoading query={fleetQuery} />
    : catalog.data && (view === "create" ? <CrmAppealForm key={`${formKey}:${scenarioAttemptId ?? ""}`} catalog={catalog.data} initial={copy} scenarioAttemptId={scenarioAttemptId} scenarioRevision={scenario.data?.revision} accounts={appealAccounts} onDirty={setFormDirty} onCategoryChange={updateSelection} onRequestHelp={() => setHelpRequest(n => n + 1)} onSaved={(appeal, duplicate) => { client.invalidateQueries({ queryKey: ["crm-appeals"] }); client.invalidateQueries({ queryKey: FLEET_QUERY }); client.setQueryData(["crm-appeal", appeal.id], appeal); setDirty(false); if (duplicate) { setCopy(appeal); setFormKey(k => k + 1); } else go(`appeal=${appeal.id}`, true); setNotice(`Обращение #${appeal.id} сохранено и доступно всем участникам.${duplicate ? " Открыта копия; вложения нужно добавить заново." : ""}`); if (scenarioAttemptId && canCheckScenarioAppeal(scenario.data, appeal.id)) verifyAppeal.mutate({ attemptId: scenarioAttemptId, appealId: appeal.id }); }} /> : view === "drivers" ? fleetQuery.data ? <CrmDrivers key={`${driverId ?? "list"}:${driverScreen ?? ""}`} drivers={drivers} save={saveFleet} rules={fleetQuery.data.rules.map(r => r.name)} tariffs={fleetQuery.data.catalog.tariffs} openFleet={openFleetDriver} open={openDriver} notify={setNotice} driverId={driverId} screen={driverScreen} onReset={async () => { try { await saveFleet(fleetApi.reset); setNotice("Учебные водители возвращены в исходное состояние — и в CRM, и в Диспетчерской."); } catch (e) { setNotice((e as Error).message); } }} /> : <FleetLoading query={fleetQuery} /> : view === "categories" && editor ? <CrmCategories nodes={catalog.data.categories} /> : id > 0 ? <CrmAppealDetail id={id} editor={editor} onDuplicate={create} /> : <CrmAppealList catalog={catalog.data} onOpen={appeal => go(`appeal=${appeal}`)} onCreate={() => create()} />)}
    <footer className="crm-bottom-note">Учебная CRM · Практика работы с обращениями</footer></main></div></div></div>}
    {site === "crm" ? !scenarioAttemptId && <PulsarGuide catalog={catalog.data} screen={pulsarScreen} categoryIds={selection} step={null} editor={instructionEditor} openRequest={helpRequest} onStart={() => startCoach(helpTour)} onClose={() => {}} onPrevious={() => {}} onNext={() => {}} />
      : site === "dispatch" && !scenarioAttemptId && <DispatchDock feedback={fleetFeedback} onFeedback={setFleetFeedback} onGo={(path, park) => goFleet(path, park)} onTour={tour => startFleetTour(tour)} onCrm={callId => { setCrmCall(callId); setCoach(null); if (view === "create") openSite("crm"); else create(); }} />}
    {coach && !scenarioAttemptId && <PulsarCoach key={coach.id} steps={coach.steps} onClose={endCoach} extra={step => step.slot === "courier-code" && coach.id.startsWith("call:") ? <CoachCourierCode callId={coach.id.slice(5)} feedback={fleetFeedback} onFeedback={setFleetFeedback} />
      : step.slot?.startsWith("test-") && testDriver ? <TestData key={step.slot} slot={step.slot} driver={testDriver} park={testPark} /> : null} />}
  </div>;
}

const TEST_DATA: Record<string, [string, (driver: FleetDriver, park?: FleetPark) => string]> = {
  "test-phone": ["Тестовый телефон", driver => driver.phone],
  "test-license": ["Тестовый номер В/У", driver => driver.license],
  "test-id": ["Тестовый ID водителя", driver => driver.id],
  "test-link": ["Ссылка на аккаунт тестового водителя", (driver, park) => fleetLink(driver, park)],
};

/** Pulsar hands over his test driver's data in the bubble: ⧉ puts it on the clipboard for CRM. */
function TestData({ slot, driver, park }: { slot: string; driver: FleetDriver; park?: FleetPark }) {
  const [done, setDone] = useState(false);
  const [label, read] = TEST_DATA[slot] ?? TEST_DATA["test-phone"], value = read(driver, park);
  return <div className="coach-test-data"><span><small>{label}</small><code>{value}</code></span>
    <button type="button" className={done ? "is-done" : undefined} aria-label={done ? "Скопировано" : `Скопировать: ${label}`} title="Скопировать"
      onClick={() => void copyText(value).then(ok => { if (!ok) return; setDone(true); window.setTimeout(() => setDone(false), 2000); })}>{done ? "✓" : "⧉"}</button></div>;
}

/** The account's address with its ID on its own: operators copy the ID from here into CRM. */
function AddressWithId({ address, id }: { address: string; id: string }) {
  const at = address.indexOf(id);
  if (at < 0) return <>{address}</>;
  return <>{address.slice(0, at)}<span data-coach="fleet-address-id">{id}</span>{address.slice(at + id.length)}</>;
}

/** CRM drivers and sections wait for the fleet: they are its accounts. */
function FleetLoading({ query }: { query: { isError: boolean; error: Error | null; refetch: () => unknown } }) {
  return query.isError ? <div className="crm-empty" role="alert"><p>{query.error?.message ?? "Не удалось загрузить водителей"}</p><button className="crm-secondary" onClick={() => query.refetch()}>Повторить</button></div>
    : <div className="crm-empty" role="status">Загружаем водителей из Диспетчерской…</div>;
}
