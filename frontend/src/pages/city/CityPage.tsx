import { cityWorld, type DepartmentId } from "../../api/cityWorld";
import { cityEstate, citySandbox } from "../../api/cityEstate";
import { citySeasons, SEASONS_QUERY, type PastSeason } from "../../api/citySeasons";
import { CityHistory } from "./CityHistory";
import { seasonDates, seasonWarning, shortLeft } from "./seasonText";
import { CityWorldPanel, CityJourney } from "./CityWorldPanel";
import { CityEstateDock, type BuildState, type EstateTarget } from "./CityEstateDock";
import { CitySandboxDock } from "./CitySandboxDock";
import { DEFAULT_SCREEN, type ScreenWays } from "./decorArrange";
import type { CityEstateView, EstatePick, JourneyPhase, PlotAddress } from "../../city3d/types";
import { NO_CHOICE, spacing } from "./cellChoice";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { city, MISSION_STATES, nextMission, type BuildingKey, type CityBuilt, type CityData, type CityQuest, type CityReward, type DistrictId } from "../../api/city";
import { attemptPath, learning, type LearningContent } from "../../api/learning";
import { CityTasks, speakerIcon } from "./CityTasks";
import { driverShift } from "../../api/driverShift";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState } from "../../components/ui";
import { Sheet } from "../../components/Sheet";
import { PulsarFace } from "../crm/PulsarGuide";
import { CityMap } from "./CityMap";
import { DISTRICT_LEVEL_NAMES, MAX_DISTRICT_LEVEL, completedDistrictMissions, districtLevel } from "./cityLevels";
import { DISTRICT_COLORS, districtLabels } from "./cityDistricts";
import type { CityLabelInfo } from "../../city3d/types";
import { districtLayout, isDistrictOf } from "../../city3d/world/estateGrid";
import "../crm/pulsar.css";
import "./city.css";
import { DriverEntry } from "../DriverEntry";
import { CityGuideSetup, GUIDE_AVATAR } from "./CityGuideSetup";
import { CityControlsSetup } from "./CityControlsSetup";
import { CityBuildEntry } from "./CityBuildEntry";
import { CityPeekPanel } from "./CityPeekPanel";
import { CityToolbar, CityToolbarButton, CityToolbarProvider, useCityToolbarState } from "./CityToolbar";
import "./cityPanelLayout.css";
import { districtPlotGrid, freeDistrictPlot } from "./freeDistrictPlot";
import type { CityControls } from "../../api/types";
import { DEFAULT_GUIDE, guideName, guideText } from "../../guide";
import { retainedCity } from "./retainedCity";

/** A startup timeout has an explicit retry button; do not silently repeat a stalled connection. */
const retryCityRead = (failures: number, error: Error) => {
  const problem = error as { status?: number; code?: string; name?: string };
  return problem.code !== "request_timeout" && problem.name !== "AbortError" && !(problem.status && problem.status >= 400 && problem.status < 500) && failures < 1;
};

/** «Позже» on a first visit's card holds for the browser session: the next visit asks again. */
type LaterCard = "guide" | "controls";
const laterKey = (card: LaterCard) => `puls.city.later.${card}`;
function postponed(card: LaterCard) { try { return sessionStorage.getItem(laterKey(card)) === "1"; } catch { return false; } }
function postpone(card: LaterCard) { try { sessionStorage.setItem(laterKey(card), "1"); } catch { /* the card comes back next time */ } }

/** Город во весь экран: 3D-карта под стеклянными панелями, как в игре. */
export function CityPage() {
  const { user } = useAuth(), client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const worldQuery = useQuery({ queryKey: ["city-world"], queryFn: ({ signal }) => cityWorld.get(signal), retry: retryCityRead, refetchOnWindowFocus: true });
  const department: DepartmentId = params.get("city") === "sales" ? "sales" : params.get("city") === "support" || params.has("operator") || params.has("district") ? "support" : worldQuery.data?.home_city ?? "support";
  const [worldSelected, setWorldSelected] = useState<string | null>(null);
  const [worldAction, setWorldAction] = useState<{ kind: "travel" | "skip" | "focus"; target: string; at: number }>();
  const [journey, setJourney] = useState<JourneyPhase>(null), [destination, setDestination] = useState<DepartmentId>("sales");
  // The toolbar's open popup. A district's missions open when it is chosen on the map or in the skills, and on the
  // way back from its tools (?district=).
  // ?open=quests comes from the chest of the day: its lock opens with today's tasks.
  const toolbar = useCityToolbarState(params.has("district") ? "skills" : params.get("open") === "quests" ? "quests" : null);
  function visit(id: DepartmentId) { const next = new URLSearchParams(params); next.set("city", id); setParams(next); setWorldSelected(null); toolbar.setActive(null); }
  function pickWorld(id: string) {
    // In the test city a district opens its own dock, not the real district's card.
    if (sandboxOn && isDistrictOf(department, id)) { setWorldSelected(null); openSandbox(id); return; }
    setWorldSelected(id); if (id !== "world") setWorldAction({ kind: "focus", target: id, at: Date.now() });
  }
  const operatorId = user?.role !== "operator" && /^\d+$/.test(params.get("operator") ?? "") ? Number(params.get("operator")) : null;
  const query = useQuery({ queryKey: ["city", operatorId ?? "self"], queryFn: ({ signal }) => operatorId ? city.operator(operatorId, signal) : city.own(signal), retry: retryCityRead, refetchInterval: query => query.state.data ? 15000 : false, refetchOnWindowFocus: true });
  const [reward, setReward] = useState<CityReward | null>(null);
  const [driverLaunch, setDriverLaunch] = useState(false);
  const [guideEditing, setGuideEditing] = useState(false);
  const [later, setLater] = useState(() => ({ guide: postponed("guide"), controls: postponed("controls") }));
  // Камера: выбор оператора из профиля; пока карточка выбора открыта — схема, которую он пробует.
  const [controlsEditing, setControlsEditing] = useState(false), [controlsPreview, setControlsPreview] = useState<CityControls | null>(null);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [mapAttempt, setMapAttempt] = useState(0);
  function retryMap() { retainedCity.clear(); setMapStatus("loading"); setMapAttempt(attempt => attempt + 1); }
  const [focusRequest, requestFocus] = useState(0);
  const [plotKey, setPlotKey] = useState<string | null>(null), [built, setBuilt] = useState<CityBuilt | null>(null);
  const [plotFocus, setPlotFocus] = useState<{ key: string; at: number }>();
  const [questSlot, setQuestSlot] = useState<number | null>(null), [questFocus, setQuestFocus] = useState<{ slot: number; at: number }>();
  const answer = useMutation({ mutationFn: ({ slot, choice }: { slot: number; choice: number }) => city.answer(slot, choice), onSuccess: async () => { await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  const build = useMutation({ mutationFn: ({ plot, item }: { plot: string; item: BuildingKey }) => city.build(plot, item), onSuccess: async result => { setPlotKey(null); setBuilt(result); setPlotFocus({ key: result.plot, at: Date.now() }); await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  // The account remembers the district stages its city showed, so another device does not celebrate them again.
  const seeLevels = (levels: Record<string, number>) => void city.levelsSeen(levels)
    .then(saved => client.setQueryData<CityData>(["city", "self"], current => current && { ...current, levels_seen: saved.levels_seen }))
    .catch(() => { /* This browser remembers them too; the next visit tells the server again. */ });
  const claim = useMutation({ mutationFn: (key: string) => city.claim(key, query.data!.revision), onSuccess: async result => { setReward(result); await client.invalidateQueries(); }, onError: () => { void query.refetch(); } });
  // Simulator scenarios a trainer assigned to the operator: only in the operator's own city.
  const navigate = useNavigate();
  const assignments = useQuery({ queryKey: ["learning"], queryFn: learning.catalog, enabled: user?.role === "operator" && operatorId === null, staleTime: 60000, refetchOnWindowFocus: true });
  const startAssignment = useMutation({ mutationFn: async (content: LearningContent) => {
    if (content.is_driver) {
      const state = await driverShift.start({ id: crypto.randomUUID(), mode: "assessment", content_id: content.id });
      client.setQueryData(["driver-profile"], state); navigate("/simulator");
    } else navigate(attemptPath(await learning.start(content.id)));
  } });
  // Team district land: the viewer's own estate, and the districts of the city on screen, refreshed about every
  // 12 seconds (with a little spread) only while this page is open and visible.
  const estateQuery = useQuery({ queryKey: ["city-estate"], queryFn: ({ signal }) => cityEstate.mine(signal), retry: retryCityRead, refetchInterval: query => query.state.data ? 15000 : false, refetchOnWindowFocus: true });
  const landPoll = (query: { state: { data: unknown } }) => query.state.data ? 10000 + Math.random() * 5000 : false;
  // Administrators may switch the map to their test city (?sandbox=1): the same land, apart from the real one.
  const sandboxOn = user?.role === "admin" && params.get("sandbox") === "1";
  // Seasons: the warning before the schedule resets the city, and past cities shown as they stood (?history=<id>).
  const seasonsQuery = useQuery({ queryKey: SEASONS_QUERY, queryFn: ({ signal }) => citySeasons.overview(signal), retry: retryCityRead, refetchInterval: 60000, refetchOnWindowFocus: true });
  const historyId = !sandboxOn && /^\d+$/.test(params.get("history") ?? "") ? Number(params.get("history")) : null, historyOn = historyId !== null;
  const historyLand = useQuery({ queryKey: ["city-history", historyId, department], queryFn: ({ signal }) => citySeasons.city(historyId!, department, signal), retry: retryCityRead, enabled: historyOn, staleTime: Infinity });
  const [historyOpen, setHistoryOpen] = useState(false);
  const supportLand = useQuery({ queryKey: ["city-estates", "support"], queryFn: ({ signal }) => cityEstate.city("support", signal), retry: retryCityRead, enabled: department === "support" && !sandboxOn && !historyOn, refetchInterval: landPoll, refetchOnWindowFocus: true });
  const salesLand = useQuery({ queryKey: ["city-estates", "sales"], queryFn: ({ signal }) => cityEstate.city("sales", signal), retry: retryCityRead, enabled: department === "sales" && !sandboxOn && !historyOn, refetchInterval: landPoll, refetchOnWindowFocus: true });
  const sandboxLand = useQuery({ queryKey: ["city-sandbox", department], queryFn: ({ signal }) => citySandbox.city(department, signal), retry: retryCityRead, enabled: sandboxOn, refetchInterval: landPoll, refetchOnWindowFocus: true });
  const estateViews = useMemo(() => {
    const views: Partial<Record<DepartmentId, CityEstateView>> = {};
    // A past city is only looked at: its land as it stood on the season's last day.
    if (historyOn) {
      if (historyLand.data?.city === department) views[department] = { state: historyLand.data };
      return views;
    }
    if (sandboxOn) {
      if (sandboxLand.data?.city === department) views[department] = { state: sandboxLand.data };
      return views;
    }
    if (supportLand.data) views.support = { state: supportLand.data };
    if (salesLand.data) views.sales = { state: salesLand.data };
    return views;
  }, [historyOn, historyLand.data, sandboxOn, department, sandboxLand.data, supportLand.data, salesLand.data]);
  const [building, setBuilding] = useState<BuildState | null>(null), [estateFocus, setEstateFocus] = useState<EstateTarget & { at: number }>();
  // Which way of the cells is up the screen now, for the arrows that move small things (decorArrange.ts).
  const [screen, setScreen] = useState<ScreenWays>(DEFAULT_SCREEN);
  const choice = building?.choice, every = choice ? spacing(choice) : 1;
  const buildView = useMemo(() => building && { district: building.district, area: building.area, placing: building.placing, selected: building.selected,
    choice: choice ? { cells: choice.cells, shape: choice.shape, family: choice.family, rotation: choice.rotation, every } : null },
    // The map's own report of where the building goes (`at`) changes nothing it shows.
    [building?.district, building?.area, building?.placing, building?.selected, choice?.cells, choice?.shape, choice?.family, choice?.rotation, every, !!choice]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusLand = (target: EstateTarget) => setEstateFocus({ ...target, at: Date.now() });
  const landOf = (district: string) => (district.startsWith("sales-") ? salesLand.data : supportLand.data)?.districts.find(d => d.id === district) ?? null;
  const homeEstate = estateQuery.data?.district;
  const ownLand = homeEstate ? landOf(homeEstate.id) : null;
  const suggestedPlot = useMemo(() => homeEstate && ownLand && estateQuery.data?.status === "ready"
    ? freeDistrictPlot(districtPlotGrid(homeEstate.city, districtLayout(homeEstate.id)), ownLand) : null,
    [homeEstate?.id, homeEstate?.city, ownLand, estateQuery.data?.status]);
  function chooseFreePlot() {
    if (!homeEstate || !suggestedPlot || building?.district !== homeEstate.id || estateQuery.data?.status !== "ready") return;
    // The middle cell of the free 3 × 3, with a house chosen: the map shows the house on all nine.
    const middle = { block: suggestedPlot.block, col: suggestedPlot.col + 1, row: suggestedPlot.row + 1 };
    setBuilding({ ...building, area: "plots", placing: null, selected: null, spot: null, project: false,
      choice: { ...(building.choice ?? NO_CHOICE), cells: [{ ...middle, band: suggestedPlot.band, state: "free" }], family: "house", at: null } });
    focusLand({ district: homeEstate.id, kind: "plot", plot: middle });
  }
  useEffect(() => {
    // A transfer may arrive through polling while an old plot or inventory placement is still open.
    if (!sandboxOn) setBuilding(current => current && !current.project && current.district !== homeEstate?.id ? null : current);
  }, [sandboxOn, homeEstate?.id]);
  function onEstate(pick: EstatePick) {
    if (pick.kind === "screen") { setScreen(s => s.up === pick.up && s.right === pick.right ? s : { up: pick.up, right: pick.right }); return; }
    if (historyOn) return;
    if (sandboxOn && (pick.kind === "project" || pick.kind === "public")) { setWorldSelected(null); openSandbox(pick.district, true); return; }
    if (pick.kind === "public") { setBuilding(null); setWorldSelected(pick.district); focusLand({ district: pick.district, kind: "public" }); return; }
    if (pick.kind === "place") setBuilding(b => b && { ...b, spot: { module: pick.module, u: pick.u, v: pick.v, rotation: pick.rotation, problem: pick.problem } });
    else if (pick.kind === "cells") setBuilding(b => {
      if (!b || b.district !== pick.district || b.area !== "plots") return b;
      // New cells keep what the shop chose, so the same thing can be tried place after place; the one same cell keeps
      // where its building goes.
      const before = b.choice ?? NO_CHOICE, one = (cells: readonly PlotAddress[]) => cells.length === 1 ? cells[0] : null;
      // What is on the cells now, after the land changed: only while they are still the ones chosen (not once laid on).
      if (pick.update && (pick.cells.length !== before.cells.length || pick.cells.some((c, i) => c.block !== before.cells[i].block || c.col !== before.cells[i].col || c.row !== before.cells[i].row))) return b;
      const was = one(before.cells), now = one(pick.cells), same = !!was && !!now && was.block === now.block && was.col === now.col && was.row === now.row;
      return { ...b, selected: null, choice: { ...before, cells: pick.cells, at: same ? before.at : null } };
    });
    else if (pick.kind === "footprint") setBuilding(b => {
      const choice = b?.choice, cell = choice?.cells.length === 1 ? choice.cells[0] : null;
      if (!b || !choice || !cell || b.district !== pick.district || choice.family !== pick.family || choice.rotation !== pick.rotation || cell.block !== pick.cell.block || cell.col !== pick.cell.col || cell.row !== pick.cell.row) return b;
      return { ...b, choice: { ...choice, at: { col: pick.col, row: pick.row, problem: pick.problem } } };
    });
    else if (pick.kind === "project") setWorldSelected(pick.district);
    else if (pick.kind === "object") {
      setBuilding(b => ({ district: pick.district, area: b?.district === pick.district ? b.area : "plots", placing: null, selected: pick.object, spot: null, project: b?.district === pick.district ? b.project : false,
        choice: b?.district === pick.district && b.choice ? { ...b.choice, cells: [], at: null } : null }));
      focusLand({ district: pick.district, kind: "object", object: pick.object });
    }
  }
  /** Opens building in the operator's own district, in whichever city it is. */
  function openBuild() {
    const home = estateQuery.data?.district;
    if (!home) return;
    // The old five-island preview has no personal land. Building uses the full district map.
    const next = new URLSearchParams(params);
    next.delete("world");
    next.set("city", home.city);
    setParams(next);
    setWorldSelected(null); toolbar.setActive(null);
    setBuilding({ district: home.id, area: "plots", placing: null, selected: null, choice: null, spot: null, project: false });
    focusLand({ district: home.id, kind: "district" });
    void estateQuery.refetch();
    void (home.city === "sales" ? salesLand : supportLand).refetch();
  }
  function viewHistory(season: PastSeason) {
    const next = new URLSearchParams(params);
    next.set("history", String(season.id)); next.delete("sandbox");
    setParams(next); setHistoryOpen(false); setBuilding(null); setWorldSelected(null); toolbar.setActive(null);
  }
  function leaveHistory() {
    const next = new URLSearchParams(params);
    next.delete("history"); setParams(next, { replace: true });
  }
  useEffect(() => { if (historyOn) setBuilding(null); }, [historyOn]);
  // The camera flies to what the past season built: the viewer's own district, or the first one built on.
  useEffect(() => {
    const land = historyLand.data;
    if (!land) return;
    const shown = land.districts.find(d => d.id === homeEstate?.id) ?? land.districts.find(d => d.objects.length || Object.keys(d.decor).length);
    if (shown) focusLand({ district: shown.id, kind: "district" });
  }, [historyLand.data]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The test city's dock on a district, on its plots or on its square with the shared projects. */
  function openSandbox(district: string, square = false) {
    setBuilding({ district, area: square ? "public" : "plots", placing: null, selected: null, choice: null, spot: null, project: square });
    focusLand({ district, kind: square ? "public" : "district" });
  }
  // The test city shows the next season's layout when one is planned: its first district, whatever its id.
  const sandboxFirst = (sandboxLand.data?.city === department ? sandboxLand.data.districts[0]?.id : undefined) ?? `${department}-team-1`;
  function toggleSandbox() {
    const next = new URLSearchParams(params);
    if (sandboxOn) next.delete("sandbox"); else next.set("sandbox", "1");
    setParams(next, { replace: true });
    setWorldSelected(null);
    if (sandboxOn) setBuilding(null); else openSandbox(sandboxFirst);
  }
  useEffect(() => {
    // After a trip to the other city, or when the test city comes in another layout, its dock follows to its first
    // district.
    const ids = sandboxLand.data?.city === department ? sandboxLand.data.districts.map(d => d.id) : null;
    if (sandboxOn) setBuilding(b => b && (!b.district.startsWith(`${department}-`) || (ids && !ids.includes(b.district))) ? { district: sandboxFirst, area: "plots", placing: null, selected: null, choice: null, spot: null, project: false } : b);
  }, [sandboxOn, department, sandboxFirst]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!building) return;
    // Escape leaves the preview first, then the dock; it never undoes what the server already did.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".sheet-overlay, [role=dialog][aria-modal=true]")) return;
      event.preventDefault();
      setBuilding(b => b && (b.placing ? { ...b, placing: null, spot: null, area: b.project ? "public" : "plots" }
        : b.choice?.cells.length ? { ...b, choice: { ...b.choice, cells: [], at: null } } : b.selected !== null ? { ...b, selected: null } : b.choice?.family ? { ...b, choice: null } : null));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [!!building]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!query.data) return <div className="city-immersive city-immersive--empty">
    {query.isError || query.fetchStatus === "paused" ? <div className="city-empty-card glass glass--prominent"><ErrorState error={query.error ?? new Error("Нет соединения. Подключись к сети и повтори загрузку города.")} onRetry={() => query.refetch()} /></div> : <div className="city-loading" role="status"><span>Загружаем данные города…</span></div>}
  </div>;
  const data = query.data;
  const selected = data.districts.find(d => d.id === params.get("district")) ?? data.districts.find(d => d.id === nextMission(data.missions)?.district) ?? data.districts[0];
  const missions = data.missions.filter(m => m.district === selected.id);
  const mission = missions.find(m => m.key === params.get("mission")) ?? nextMission(missions);
  const completed = data.missions.filter(m => m.state === "completed").length;
  const total = data.missions.filter(m => m.enabled || m.state === "completed").length;
  function selectDistrict(id: DistrictId) { const p = new URLSearchParams(params); p.set("district", id); p.delete("mission"); setParams(p, {replace:true}); requestFocus(value => value + 1); claim.reset(); toolbar.setActive("skills"); }
  function selectMission(key: string) { const p = new URLSearchParams(params); p.set("mission", key); setParams(p, {replace:true}); claim.reset(); }
  const parent = data.missions.find(m => m.key === mission?.prerequisite);
  const actionable = mission && !["locked", "unavailable"].includes(mission.state);
  // В чужом городе — фигура и помощник того оператора, в своём — свои.
  const mascot = data.inspecting ? { gender: data.gender ?? null, name: data.guide_name || DEFAULT_GUIDE } : { gender: user?.gender ?? null, name: guideName(user) };
  const labels = districtLabels(data.districts, data.missions);
  // Помощник и камера спрашиваются при первом входе; «Позже» откладывает вопрос до следующего визита.
  const needsGuide = !data.inspecting && !!user && (!user.gender || !user.guide_name);
  const askGuide = needsGuide && !later.guide;
  // Как двигать камеру, спрашиваем, когда карта уже работает и схему можно сразу попробовать. До выбора
  // работает вращение вокруг города. В чужом городе не спрашиваем.
  const needsControls = !data.inspecting && !!user && !user.city_controls;
  const controls: CityControls = controlsPreview ?? user?.city_controls ?? "orbit";
  const showControls = !askGuide && !guideEditing && ((needsControls && !later.controls && mapStatus === "ready") || controlsEditing);
  function putOff(card: LaterCard) { postpone(card); setLater(current => ({ ...current, [card]: true })); }
  function closeControls() {
    const fromTools = controlsEditing;
    setControlsEditing(false);
    // Фокус — туда, откуда пришли: на кнопку панели карты или на саму карту, чтобы сразу работали клавиши.
    window.setTimeout(() => {
      const button = document.querySelector<HTMLElement>(".city-controls-button");
      const target = fromTools ? button?.checkVisibility() ? button : document.querySelector<HTMLElement>(".city-map-peek > .city-peek__trigger") : document.querySelector<HTMLElement>(".city-scene");
      target?.focus({ preventScroll: true });
    }, 0);
  }
  const rank = data.level < 2 ? "Новый житель" : data.level < 4 ? "Исследователь" : "Мастер города";
  const level = districtLevel(completedDistrictMissions(selected, missions), selected.soon);
  const oktellDeferred = selected.id === "oktell" && missions.length === 0;
  const districtDone = missions.length > 0 && missions.every(m => m.state === "completed" || !m.enabled);
  // The mission's main button already leads to the district's tool: the second link to it is left out.
  const opensTool = !!mission && !selected.soon && selected.id !== "scenarios" && !!actionable && mission.key !== "welcome" && !data.inspecting && !(mission.state === "ready" && data.can_claim);
  // Today's situations and the trainer's scenarios: the toolbar counts what is still to do.
  const quests = data.quests?.items ?? [];
  const assigned = data.inspecting ? [] : (assignments.data ?? []).filter(item => item.assigned);
  const todo = quests.filter(q => !q.answered).length + assigned.filter(item => !item.completed).length;
  // Situations are never dealt twice: an empty day for the operator means every one is answered.
  const allPassed = !!data.quests && !data.inspecting && quests.length === 0;
  function openQuest(quest: CityQuest) { answer.reset(); setQuestSlot(quest.slot); if (!quest.answered && department === "support") setQuestFocus({ slot: quest.slot, at: Date.now() }); }
  // A new operator meets the first mission as soon as the first visit's cards are answered or put off.
  const welcomeAhead = department === "support" && !data.inspecting && !data.preview && !building && mapStatus !== "loading" && !askGuide && !showControls
    && data.missions.some(m => m.key === "welcome" && m.state !== "completed" && m.state !== "unavailable");
  const districtPlots = data.plots.filter(p => p.district === selected.id);
  const freePlot = districtPlots.find(p => p.unlocked && !p.item);
  function openPlot(key: string) { build.reset(); setPlotKey(key); }
  const mineEstate = estateQuery.data, canOpenBuild = !!mineEstate?.district && (mineEstate.status === "ready" || mineEstate.status === "closed");
  const buildingLandQuery = building?.district.startsWith("sales-") ? salesLand : supportLand;
  const buildingLand = building ? landOf(building.district) : null;
  function reloadBuildLand() {
    void estateQuery.refetch();
    void worldQuery.refetch();
    void buildingLandQuery.refetch();
  }
  const seasons = seasonsQuery.data, past = historyLand.data?.history;
  // A few days before the schedule resets the city, the toolbar counts down to it.
  const warning = !historyOn && seasons?.current.warning && seasons.current.ends_at ? seasons.current : null;
  return <CityToolbarProvider state={toolbar}><div className="city-immersive" data-department={department} data-building={building ? true : undefined} data-history={historyOn || undefined}>
    <CityToolbar />
    {/* With a schedule set, everyone can look up when the season ends; past seasons stay a click away. */}
    {seasons && (historyOn || warning || seasons.history.length > 0 || seasons.current.ends_at) && <CityToolbarButton slot="history"
      label={historyOn ? "Прошлый город: итоги сезонов и выход" : warning ? seasonWarning(warning) : seasons.history.length ? "История города: прошлые сезоны" : `Сезон ${seasons.current.number}: когда город начнёт новый`}
      compactLabel={warning ? shortLeft(warning.ends_at!) : "История"} icon={warning ? "⏳" : "🕰️"} tone={warning ? "warn" : undefined} onClick={() => setHistoryOpen(true)} />}
    {historyOn && <div className="city-history-banner glass glass--regular" role="status">
      <span>{past ? <>🕰️ <strong>Город сезона {past.number}</strong> · {seasonDates(past.started_at, past.ended_at)} · только просмотр</> : historyLand.isError ? historyLand.error.message : "Загружаем прошлый город…"}</span>
      {past && <button type="button" onClick={() => setHistoryOpen(true)}>Итоги</button>}
      <button type="button" onClick={leaveHistory}>Выйти</button>
    </div>}
    {historyOpen && seasons && <CityHistory seasons={seasons} department={department} viewing={historyId} onView={viewHistory} onLeave={() => { setHistoryOpen(false); leaveHistory(); }} onClose={() => setHistoryOpen(false)} />}
    <CityMap key={mapAttempt} department={department} departmentWorld={worldQuery.data} onWorldPick={pickWorld} onArrival={visit} onJourney={setJourney} worldAction={worldAction} estates={estateViews} build={buildView} onEstate={onEstate} estateFocus={estateFocus} sceneIdentity={`${data.user_id}:${data.inspecting ? "inspect" : "self"}`} forceWebGL={params.get("backend") === "webgl"} mascot={mascot} labels={labels} districts={data.districts} missions={data.missions} selected={selected.id} focusRequest={focusRequest} onSelect={selectDistrict} plots={data.plots} onPlot={data.can_build ? openPlot : undefined} plotFocus={plotFocus} quests={data.quests?.items ?? []} onQuest={data.inspecting ? undefined : slot => { answer.reset(); setQuestSlot(slot); }} questFocus={questFocus} controls={controls} onControls={user ? () => setControlsEditing(true) : undefined} controlsOpen={showControls} onStatus={setMapStatus} onRetry={retryMap} progressKey={!data.inspecting && !data.preview ? `city-levels:${data.user_id}` : undefined} levelsSeen={data.levels_seen ?? null} onLevelsSeen={seeLevels} />

    <CityPeekPanel className="city-hud-peek" toolbarSlot="level" label="Уровень, опыт и меню" compactLabel="Уровень" icon={data.level}>
    <header className="city-hud glass glass--regular">
      <div className="city-hud__level">
        <span className="city-hud__badge" title={`Уровень города ${data.level}`}>{data.level}</span>
        <div className="city-hud__xp">
          <span><b>{rank}</b><span className="city-hud__wide"> · уровень {data.level}</span> · {data.xp} XP</span>
          <div className="city-meter" role="progressbar" aria-label="Опыт до следующего уровня города" aria-valuemin={0} aria-valuemax={data.level_target} aria-valuenow={data.level_progress}><span style={{width:`${data.level_progress/data.level_target*100}%`}} /></div>
        </div>
      </div>
      <div className="city-hud__stat"><strong>{completed}<small> / {total}</small></strong><span className="city-hud__label">{department === "sales" ? "миссий в первом городе" : "миссий пройдено"}</span></div>
      {!data.preview && <div className="city-hud__coins"><span className="city-coin" aria-hidden="true">◈</span><span className="city-hud__stat"><strong>{data.balance.toLocaleString("ru-RU")}</strong><span className="city-hud__label">коинов в кошельке</span></span></div>}
      <nav className="city-hud__links" aria-label="Обучение">
        {user?.role === "admin" && <button type="button" className="city-group-button" data-open={sandboxOn || undefined} aria-pressed={sandboxOn} onClick={toggleSandbox} aria-label={sandboxOn ? "Выйти из тестового города" : "Тестовый город администраторов"} title="Тестовый город: только для администраторов"><span aria-hidden="true">🧪</span><span className="city-hud__wide">Тест</span></button>}
        {/* Operators build from the toolbar's «Строить»; staff with land of their own, from here. */}
        {canOpenBuild && !sandboxOn && !historyOn && user?.role !== "operator" && <button type="button" className="city-group-button" data-open={building ? true : undefined} aria-pressed={!!building} onClick={() => building ? setBuilding(null) : openBuild()} aria-label={mineEstate!.district!.city === department ? "Строить в своём районе" : "Мой район в другом городе"}><span aria-hidden="true">🏡</span><span className="city-hud__wide">{mineEstate!.district!.city === department ? "Строить" : "Мой район"}</span></button>}
        {user?.role !== "operator" && <Link to="/admin/learning/city" aria-label="Управление городом"><span aria-hidden="true">⚙︎</span><span className="city-hud__wide">Управление</span></Link>}
      </nav>
    </header>
    <div className="city-hud__notices">
      {data.inspecting && <p className="city-note glass glass--regular">Город оператора: <strong>{data.full_name}</strong><Link to="/admin/learning/city?tab=participants">← К участникам</Link></p>}
      {data.preview && !data.inspecting && !sandboxOn && <p className="city-note glass glass--regular">Предпросмотр для сотрудника · без наград</p>}
      {sandboxOn && <p className="city-note sandbox-note glass glass--regular" role="status"><span>🧪 <strong>Тестовый город</strong> · видят только администраторы, стройка бесплатная, настоящий город не меняется</span>{!building && <button type="button" onClick={() => openSandbox(sandboxFirst)}>Панель</button>}<button type="button" onClick={toggleSandbox}>Выйти</button></p>}
      {sandboxLand.isError && sandboxOn && <p className="city-note glass glass--regular" role="alert">Не удалось загрузить тестовый город.<button type="button" onClick={() => sandboxLand.refetch()}>Повторить</button></p>}
      {worldQuery.isError && <p className="city-note glass glass--regular" role="alert">Не удалось загрузить города и районы.<button type="button" onClick={() => worldQuery.refetch()}>Повторить</button></p>}
      {query.isError && <p className="city-note glass glass--regular" role="alert">Не удалось обновить город.<button type="button" onClick={() => query.refetch()}>Повторить</button></p>}
    </div>
    </CityPeekPanel>

    {user?.role === "operator" && !data.inspecting && !building && !sandboxOn && !historyOn && <CityPeekPanel className="city-build-peek" toolbarSlot="build" label="Застройка района" compactLabel="Строить" icon="🏡"><CityBuildEntry mine={mineEstate} loading={estateQuery.isPending} failed={estateQuery.isError} onRetry={() => { void estateQuery.refetch(); }} onBuild={openBuild} /></CityPeekPanel>}
    <div className="city-notes">
      {(askGuide || guideEditing) && <CityGuideSetup onClose={askGuide ? undefined : () => setGuideEditing(false)} onLater={askGuide ? () => putOff("guide") : undefined} />}
      {showControls && <CityControlsSetup value={controls} onPick={setControlsPreview} onClose={closeControls} cancellable={controlsEditing} onLater={controlsEditing ? undefined : () => { putOff("controls"); closeControls(); }} />}
    </div>
    <OpenOnce when={welcomeAhead} onOpen={() => toolbar.setActive("skills")} />

    {department === "support" && !building && <CityPeekPanel className="city-skills-peek" toolbarSlot="skills" label="Твои навыки · учебные центры и миссии" compactLabel="Навыки" icon="🎓" holdOpen={claim.isPending}>
    <CitySkills labels={labels} selected={selected.id} onSelect={selectDistrict} open={toolbar.active === "skills" || claim.isPending} />
    <aside className="city-mission glass glass--regular" data-expanded="true" aria-label={`Район «${selected.name}»`}>
      <div className="city-mission__body" id="city-mission-body" aria-live="polite">
        <div className="city-mission-top"><span className="city-eyebrow">{selected.name}</span><span className="city-state" data-state={mission?.state}>{selected.soon ? "СКОРО" : mission ? MISSION_STATES[mission.state] : "Нет заданий"}</span></div>
        <div className="city-building-level city-extra" aria-label={`Уровень здания ${level} из ${MAX_DISTRICT_LEVEL}`}><span>{"★".repeat(level)}<em>{"★".repeat(MAX_DISTRICT_LEVEL - level)}</em></span><strong>Здание: {DISTRICT_LEVEL_NAMES[level - 1]}</strong><small>{oktellDeferred ? "При первом входе в Oktell обучение проведёт по разделам, статусам и перезвону водителю." : selected.soon ? "Район строится и откроется позже" : level === MAX_DISTRICT_LEVEL ? "Максимальный уровень — район стал легендой" : districtDone ? "Все миссии района пройдены — здание достроено" : "Каждая пройденная миссия района улучшает здание"}</small></div>
        {districtPlots.length > 0 && <CityPlotsSummary plots={districtPlots} buildings={data.buildings} canBuild={data.can_build} moved={data.plots_moved} onShow={key => setPlotFocus({ key, at: Date.now() })} onBuild={freePlot && data.can_build ? () => { setPlotFocus({ key: freePlot.key, at: Date.now() }); openPlot(freePlot.key); } : undefined} />}
        {!data.inspecting && !opensTool && selected.id === "driver" && <button className="city-secondary city-extra" onClick={() => setDriverLaunch(true)}>Открыть автопарк →</button>}
        {!data.inspecting && !opensTool && selected.id === "crm" && <Link className="city-secondary city-extra" to="/training/work-sites">Открыть CRM · рабочие сайты →</Link>}
        {!data.inspecting && !opensTool && selected.id === "dispatch" && <Link className="city-secondary city-extra" to="/training/work-sites?site=dispatch">Открыть Диспетчерскую · рабочие сайты →</Link>}
        {!data.inspecting && !opensTool && selected.id === "oktell" && <Link className="city-secondary city-extra" to="/training/work-sites?site=oktell">Открыть Oktell · рабочие сайты →</Link>}

        {selected.id === "scenarios" && <p className="city-copy city-extra">Учебные разговоры с водителем и практика в CRM и Диспетчерской. Все действия выполняются в тренажёре. Коины — за первое успешное прохождение.</p>}
        {selected.soon ? <>
          <h2>Новый район. Новые возможности.</h2>
          <p className="city-copy city-extra">Здесь появятся новые учебные инструменты и миссии.</p>
          <div className="city-guide city-extra"><PulsarFace /><p>А пока продолжим развивать автопарк, CRM-центр и Диспетчерскую. Твой прогресс сохранится.</p></div>
        </> : mission && <>
          <nav className="city-mission-path city-extra" aria-label={`Миссии: ${selected.name}`}>{missions.map((m,i) => <button key={m.key} type="button" onClick={() => selectMission(m.key)} aria-label={`${i+1}. ${m.title}. ${MISSION_STATES[m.state]}`} aria-pressed={mission.key===m.key} data-state={m.state}>{m.state === "completed" ? "✓" : i+1}</button>)}</nav>
          <h2>{mission.title}</h2>
          <p className="city-copy city-extra">{mission.description}</p>
          <div className="city-objective city-extra"><span>{mission.objective}</span><strong>{mission.current} / {mission.target}</strong><div className="city-meter"><span style={{width:`${mission.current/mission.target*100}%`}} /></div></div>
          {mission.state === "locked" && <p className="city-prerequisite city-extra">Сначала завершите «{parent?.title}» и получите награду.</p>}
          <div className="city-rewards city-extra">{mission.xp > 0 && <span>✦ {mission.xp} XP</span>}{mission.coins > 0 && <span>◈ {mission.coins} коинов</span>}<span>{mission.state === "completed" ? "Получено" : "За прохождение"}</span></div>
          <div className="city-guide city-extra">
            {mascot.gender ? <span className="city-guide-avatar" aria-hidden="true">{GUIDE_AVATAR[mascot.gender]}</span> : <PulsarFace />}
            <p><b>{mascot.name}:</b> {guideText(mission.pulsar, mascot.name)}</p>
            {!data.inspecting && !askGuide && !guideEditing && !showControls && <button type="button" className="city-guide-edit" onClick={() => setGuideEditing(true)} aria-label="Изменить фигуру и имя помощника" title="Изменить помощника">✎</button>}
          </div>
        </>}
      </div>
      {/* Кнопка действия всегда на виду, описание над ней прокручивается. */}
      <div className="city-mission__footer">
        {selected.soon ? <button className="city-action" disabled>Район строится</button> : mission && <>
          {claim.isError && <p className="city-error" role="alert">{claim.error.message}</p>}
          {selected.id === "scenarios" ? actionable && !data.inspecting ? <Link className="city-action" to={mission.path}>{mission.state === "completed" ? "Повторить для практики →" : "Пройти сценарий →"}</Link> : <button className="city-action" disabled>{mission.state === "unavailable" ? "Сценарий на паузе" : "Просмотр прогресса"}</button> : mission.state === "ready" && data.can_claim ? <button className="city-action" disabled={claim.isPending} onClick={() => claim.mutate(mission.key)}>{claim.isPending ? "Проверяем результат…" : mission.key === "welcome" ? "Начать свой путь →" : "Завершить и получить награду →"}</button> : actionable && mission.key !== "welcome" && !data.inspecting ? selected.id === "driver" ? <button className="city-action" onClick={() => setDriverLaunch(true)}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</button> : <Link className="city-action" to={mission.path}>{mission.state === "completed" ? "Вернуться к практике →" : "Перейти к заданию →"}</Link> : <button className="city-action" disabled>{mission.state === "unavailable" ? "Миссия на паузе" : data.inspecting ? "Просмотр прогресса" : data.preview ? "Предпросмотр без наград" : mission.state === "completed" ? "Миссия пройдена" : "Завершите предыдущую миссию"}</button>}
          <p className="city-fine city-extra">{selected.id === "scenarios" ? "Коины начисляются автоматически после первого успешного прохождения. Повторная тренировка — без повторной награды." : ["crm", "dispatch", "oktell"].includes(selected.id) ? "Рабочие сайты открываются оператору через QR." : "Завершённые ранее действия тоже учитываются."}</p>
        </>}
      </div>
    </aside></CityPeekPanel>}
    {!building && (quests.length > 0 || allPassed || assigned.length > 0) && <CityPeekPanel className="city-tasks-peek" toolbarSlot="quests" label={todo ? `Задания: осталось ${todo}` : "Задания: всё выполнено"} compactLabel="Задания" icon={<>❗{todo > 0 && <b className="city-count">{todo}</b>}</>} holdOpen={startAssignment.isPending}>
      <CityTasks quests={quests} coins={data.quests?.coins ?? 0} allPassed={allPassed} assigned={assigned} onQuest={openQuest} onStart={item => startAssignment.mutate(item)} starting={startAssignment.isPending ? startAssignment.variables?.id ?? null : null} error={startAssignment.isError ? startAssignment.error.message : null} />
    </CityPeekPanel>}
    {worldQuery.data && <CityWorldPanel world={worldQuery.data} current={department} selected={worldSelected} onPick={pickWorld} onClose={() => setWorldSelected(null)} ready={mapStatus === "ready"} onVisit={visit} onTravel={id => { setDestination(id); setWorldAction({ kind: "travel", target: id, at: Date.now() }); }}
      estates={department === "sales" ? salesLand.data : supportLand.data} mine={mineEstate} onMyEstate={canOpenBuild && !historyOn ? openBuild : undefined}
      onOpenProject={district => { setBuilding({ district, area: "public", placing: null, selected: null, choice: null, spot: null, project: true }); focusLand({ district, kind: "public" }); }} />}
    {building && mineEstate && !sandboxOn && !historyOn && <CityEstateDock mine={mineEstate} land={buildingLand} build={building} setBuild={setBuilding} onClose={() => setBuilding(null)} onFocus={focusLand} onChooseFree={mapStatus === "ready" && !buildingLandQuery.isError && suggestedPlot && building.district === homeEstate?.id ? chooseFreePlot : undefined} mapStatus={mapStatus} loadingLand={!buildingLand && !buildingLandQuery.isError} landError={buildingLandQuery.isError ? buildingLandQuery.error : null} onRetryLand={reloadBuildLand} onRetryMap={retryMap} screen={screen} />}
    {building && sandboxOn && <CitySandboxDock city={department} state={sandboxLand.data?.city === department ? sandboxLand.data : undefined} mine={mineEstate} build={building} setBuild={setBuilding} onClose={() => setBuilding(null)} onFocus={focusLand} screen={screen} />}
    <CityJourney phase={journey} destination={worldQuery.data?.cities.find(c => c.id === destination)?.name ?? destination} onSkip={() => setWorldAction({ kind: "skip", target: destination, at: Date.now() })} />

    {reward && <Sheet title={reward.already_claimed ? "Эта награда уже получена" : "Миссия пройдена"} onClose={() => setReward(null)} size="s"><div className="city-celebration"><div className="city-medal" aria-hidden="true">✦</div><h2>{reward.title}</h2><p>{reward.already_claimed ? "Прогресс сохранён. Повторное начисление не требуется." : "Твой город стал немного больше. Следующая миссия уже ждёт."}</p><div className="city-rewards"><span>+{reward.xp} XP</span>{reward.coins>0&&<span>+{reward.coins} коинов</span>}</div><button className="city-action" onClick={()=>setReward(null)}>Вернуться в город →</button></div></Sheet>}
    {plotKey && <Sheet title={`Участок · ${data.districts.find(d => d.id === data.plots.find(p => p.key === plotKey)?.district)?.name ?? "район"}`} onClose={() => setPlotKey(null)}><CityCatalogue data={data} pending={build.isPending} error={build.isError ? build.error.message : null} onBuild={item => build.mutate({ plot: plotKey, item })} /></Sheet>}
    {built && <Sheet title="Построено!" onClose={() => setBuilt(null)} size="s"><div className="city-celebration"><div className="city-medal" aria-hidden="true">{data.buildings.find(b => b.key === built.item)?.icon ?? "🏗️"}</div><h2>{built.name}</h2><p>Постройка уже стоит в твоём районе. Каждый новый участок делает город твоим.</p><div className="city-rewards"><span>−{built.price} коинов</span><span>Осталось {built.balance.toLocaleString("ru-RU")}</span></div><button className="city-action" onClick={() => setBuilt(null)}>Смотреть город →</button></div></Sheet>}
    {questSlot !== null && data.quests?.items.find(q => q.slot === questSlot) && <Sheet title="Задание дня" onClose={() => setQuestSlot(null)} size="s"><CityQuestCard quest={data.quests.items.find(q => q.slot === questSlot)!} reward={data.quests.coins} readOnly={data.inspecting || data.preview} pending={answer.isPending} error={answer.isError ? answer.error.message : null} onAnswer={choice => answer.mutate({ slot: questSlot, choice })} onNext={(() => { const next = data.quests!.items.find(q => !q.answered && q.slot !== questSlot); return next ? () => { answer.reset(); setQuestSlot(next.slot); setQuestFocus({ slot: next.slot, at: Date.now() }); } : undefined; })()} /></Sheet>}
    {driverLaunch && <Sheet title="Автопарк · Driver Simulator" onClose={() => setDriverLaunch(false)}><DriverEntry /></Sheet>}
  </div></CityToolbarProvider>;
}

/** Skills stay mounted and scroll to the current district when the panel opens. */
function CitySkills({ labels, selected, onSelect, open }: { labels: CityLabelInfo[]; selected: DistrictId; onSelect: (id: DistrictId) => void; open: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) list.current?.querySelector("[aria-pressed=true]")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [selected, open]);
  return <nav className="city-skills glass glass--regular" aria-label="Районы города">
    <div className="city-skills__title"><h2>Твои навыки</h2><p>Опыт города показывает путь обучения. Коины попадают в общий кошелёк Puls.</p></div>
    <div className="city-skills__list" ref={list}>
      {labels.map(l => <button type="button" key={l.id} className="city-skill" style={{ "--district": DISTRICT_COLORS[l.id] } as CSSProperties} aria-pressed={selected === l.id} data-soon={l.soon || undefined} data-reward={l.reward || undefined} onClick={() => onSelect(l.id)}>
        <span className="city-skill__icon" aria-hidden="true">{l.icon}</span>
        <span className="city-skill__text"><strong>{l.name}</strong><small>{l.status}</small></span>
      </button>)}
    </div>
  </nav>;
}


/** The district's plots in the mission panel: how many are built, and the way to the next free one. */
function CityPlotsSummary({ plots, buildings, canBuild, moved, onShow, onBuild }: { plots: CityData["plots"]; buildings: CityData["buildings"]; canBuild: boolean; moved?: boolean; onShow: (key: string) => void; onBuild?: () => void }) {
  const built = plots.filter(p => p.item), open = plots.some(p => p.unlocked);
  return <div className="city-plots city-extra">
    <div className="city-plots__head"><strong>Участки района</strong><span>{built.length} из {plots.length} застроено</span></div>
    <div className="city-plots__list">{plots.map(p => {
      const b = buildings.find(item => item.key === p.item);
      return <button type="button" key={p.key} data-state={p.item ? "built" : p.unlocked ? "open" : "locked"} onClick={() => onShow(p.key)} aria-label={b ? `Участок: ${b.name}` : p.unlocked ? "Свободный участок" : "Участок закрыт"} title={b?.name ?? (p.unlocked ? "Свободный участок" : "Откроется после первой миссии района")}>{b ? b.icon : p.unlocked ? "＋" : "🔒"}</button>;
    })}</div>
    {moved ? <small>Новые постройки теперь появляются в районе твоей команды — кнопка «Строить». Прежние остаются здесь.</small> : !open ? <small>Участки откроются после первой пройденной миссии района.</small> : onBuild ? <button type="button" className="city-secondary" onClick={onBuild}>Построить на свободном участке →</button> : canBuild ? <small>Все участки района застроены.</small> : null}
  </div>;
}

/** What can be built on a plot, with the price in coins from the common wallet. */
function CityCatalogue({ data, pending, error, onBuild }: { data: CityData; pending: boolean; error: string | null; onBuild: (item: BuildingKey) => void }) {
  return <div className="city-catalogue">
    <p className="city-catalogue__balance">Можно потратить <strong>◈ {data.available.toLocaleString("ru-RU")}</strong> {data.available < data.balance ? "(часть коинов в резерве по заявкам магазина)" : "коинов"}. Постройка остаётся на участке навсегда.</p>
    {error && <p className="city-error" role="alert">{error}</p>}
    <ul>{data.buildings.map(b => {
      const missing = b.price - data.available;
      return <li key={b.key}>
        <span className="city-catalogue__icon" aria-hidden="true">{b.icon}</span>
        <span className="city-catalogue__text"><strong>{b.name}</strong><small>{b.description}</small></span>
        <button type="button" className="city-action" disabled={pending || missing > 0} onClick={() => onBuild(b.key)} aria-label={`Построить «${b.name}» за ${b.price} коинов`}>{missing > 0 ? `Не хватает ${missing}` : `◈ ${b.price}`}</button>
      </li>;
    })}</ul>
  </div>;
}

/** Calls `onOpen` the first time `when` holds while the page is open. */
function OpenOnce({ when, onOpen }: { when: boolean; onOpen: () => void }) {
  const done = useRef(false), open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => { if (when && !done.current) { done.current = true; open.current(); } }, [when]);
  return null;
}

/** One daily situation: who asks, what happened, the options; after the answer, the right one and why. */
function CityQuestCard({ quest, reward, readOnly, pending, error, onAnswer, onNext }: { quest: CityQuest; reward: number; readOnly: boolean; pending: boolean; error: string | null; onAnswer: (choice: number) => void; onNext?: () => void }) {
  return <div className="city-quest">
    <div className="city-quest__who"><span aria-hidden="true">{speakerIcon(quest)}</span><span><strong>{quest.speaker || "Ситуация"}</strong><small>{quest.title}</small></span></div>
    <p className="city-quest__text">{quest.text}</p>
    <div className="city-quest__options" role="group" aria-label="Варианты ответа">{quest.options.map((option, i) => {
      const state = !quest.answered ? undefined : i === quest.right ? "right" : i === quest.answer ? "wrong" : undefined;
      return <button type="button" key={i} data-state={state} disabled={quest.answered || pending || readOnly} onClick={() => onAnswer(i)}>{option}</button>;
    })}</div>
    {error && <p className="city-error" role="alert">{error}</p>}
    {quest.answered ? <div className="city-quest__result" data-correct={quest.correct || undefined} role="status">
      <strong>{quest.correct ? `Верно! +${quest.coins} коинов` : "Не совсем так"}</strong>
      {quest.explanation && <p>{quest.explanation}</p>}
      {onNext ? <button type="button" className="city-action" onClick={onNext}>Следующее задание →</button> : <small>На сегодня всё. Новые задания появятся завтра.</small>}
    </div> : <p className="city-fine">{readOnly ? "Просмотр: отвечать может только сам оператор." : `Один ответ. Верный ответ — +${reward} коинов.`}</p>}
  </div>;
}
