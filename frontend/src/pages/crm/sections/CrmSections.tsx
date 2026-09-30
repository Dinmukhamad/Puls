import { useCallback, useEffect, useState } from "react";
import type { TrainingDriver } from "../drivers/driverData";
import { loadSections, saveSections, type SectionsState } from "./sectionsStore";
import { settleBackdated } from "./promoData";
import { PromoBackdated, PromoConditions, PromoConnect, PromoRegistry } from "./CrmPromotions";
import { EdoDashboard, EdoDrivers, EdoProvider, EdoProviderDashboard } from "./CrmEdo";
import { RegistrationDetails, RegistrationForm, RegistrationList } from "./CrmRegistration";
import type { SectionProps } from "./SectionUi";
import type { CoachTourId } from "../coachTours";
import "./sections.css";

/** The CRM pages beyond «Обращения» and «Учётные записи водителей»: title, place in the menu, address, Pulsar's tip. */
export const SECTION_VIEWS: Record<string, { group: string; title: string; address: string; screen: string }> = {
  "promo-connect": { group: "Акции", title: "Подключение к акции", address: "акции / подключение", screen: "promo:connect" },
  "promo-registry": { group: "Акции", title: "Реестр участников", address: "акции / реестр участников", screen: "promo:registry" },
  "promo-backdated": { group: "Акции", title: "Заявки задним числом", address: "акции / заявки задним числом", screen: "promo:backdated" },
  "promo-conditions": { group: "Акции", title: "Смена условий работы", address: "акции / смена условий работы", screen: "promo:conditions" },
  registration: { group: "Водители", title: "Регистрация водителей", address: "водители / регистрация", screen: "registration:list" },
  "registration-new": { group: "Водители", title: "Новый водитель", address: "водители / регистрация / новый водитель", screen: "registration:new" },
  edo: { group: "ЭДО", title: "ЭДО водителей", address: "эдо / водители", screen: "edo:list" },
  "edo-provider": { group: "ЭДО", title: "Смена провайдера", address: "эдо / смена провайдера", screen: "edo:provider" },
  "edo-provider-dashboard": { group: "ЭДО", title: "Дашборд смены провайдера", address: "эдо / дашборд смены провайдера", screen: "edo:dashboard" },
  "edo-dashboard": { group: "ЭДО", title: "Дашборд ЭДО", address: "эдо / дашборд", screen: "edo:dashboard" },
};

/** Pulsar's tour for each section screen. */
export const SECTION_TOURS: Record<string, CoachTourId> = {
  "promo-connect": "promoConnect", "promo-registry": "promoRegistry", "promo-backdated": "promoBackdated", "promo-conditions": "promoConditions",
  registration: "registration", "registration-new": "registration", edo: "edo", "edo-provider": "edoProvider", "edo-dashboard": "edoDashboard", "edo-provider-dashboard": "providerDashboard",
};

/** The CRM menu as in the real system; items without a target are not part of the training yet. */
type Item = [label: string, view: string | null];
export const SIDEBAR: { group: string; icon: string; items: Item[] }[] = [
  { group: "Водители", icon: "♙", items: [["Водители", null], ["Учётные записи водителей", "drivers"], ["Моя команда", null], ["Регистрация водителей", "registration"], ["Разблокировка водителей ИП", null]] },
  { group: "Акции", icon: "🎁", items: [["Подключение к акции", "promo-connect"], ["Реестр участников", "promo-registry"], ["Заявки задним числом", "promo-backdated"], ["Смена условий работы", "promo-conditions"]] },
  { group: "Контент", icon: "▣", items: [] },
  { group: "Тикетная система", icon: "☷", items: [["Обращения", "list"], ["Тикеты", null], ["Отчёты", null]] },
  { group: "ЭДО", icon: "▤", items: [["ЭДО водителей", "edo"], ["Смена провайдера", "edo-provider"], ["Дашборд смены провайдера", "edo-provider-dashboard"], ["Дашборд ЭДО", "edo-dashboard"]] },
];
/** Which menu item a view belongs to: the appeal views all sit under «Обращения». */
export const menuView = (view: string) => view === "registration-new" ? "registration" : SECTION_VIEWS[view] || view === "drivers" ? view : "list";
export const menuGroup = (view: string) => SIDEBAR.find(g => g.items.some(([, target]) => target === menuView(view)))?.group ?? "Тикетная система";

export function CrmSidebar({ view, open }: { view: string; open: (view: string) => void }) {
  const current = menuView(view), [expanded, setExpanded] = useState<string[]>(() => [menuGroup(view)]);
  useEffect(() => { const group = menuGroup(view); setExpanded(list => list.includes(group) ? list : [...list, group]); }, [view]);
  return <aside className="crm-sidebar" aria-label="Разделы CRM"><div className="crm-sidebar-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
    {SIDEBAR.map(g => { const on = expanded.includes(g.group); return <div key={g.group} className="crm-sidebar-section">
      <button className="crm-sidebar-group" aria-expanded={g.items.length ? on : undefined} disabled={!g.items.length} title={g.items.length ? undefined : "Раздел пока недоступен"} onClick={() => setExpanded(list => on ? list.filter(x => x !== g.group) : [...list, g.group])}>
        <span aria-hidden="true">{g.icon}</span>{g.group}<small>{g.items.length ? (on ? "⌄" : "‹") : "‹"}</small></button>
      {g.items.map(([label, target]) => <button key={label} className={`${target === current ? "is-active" : ""}${on ? "" : " is-folded"}`} aria-current={target === current ? "page" : undefined} disabled={!target} title={target ? undefined : "Раздел пока недоступен"} data-coach={target ? `side-${target}` : undefined} onClick={() => target && open(target)}>{label}{!target && <small>‹</small>}</button>)}
    </div>; })}
    <div className="crm-sidebar-bottom"><span className="work-tab-dot" /> Учебная CRM<span>Данные сохраняются</span></div>
  </aside>;
}

/** Each participant's copy of the sections; answers of the head to backdated requests arrive by themselves. */
export function useSections(userId: number | undefined, drivers: TrainingDriver[]) {
  const [state, setState] = useState<SectionsState | null>(() => loadSections(userId, drivers));
  const update = useCallback((change: (s: SectionsState) => SectionsState) => setState(previous => {
    if (!previous) return previous;
    const next = change(previous);
    if (next !== previous) saveSections(userId, next);
    return next;
  }), [userId]);
  // A first visit seeds the sections once the fleet's drivers have loaded.
  useEffect(() => { if (!state && drivers.length) setState(loadSections(userId, drivers)); }, [state, drivers, userId]);
  useEffect(() => {
    const settle = () => update(s => {
      const now = new Date().toISOString();
      // The answer needs the driver: it waits until the fleet has loaded.
      if (!drivers.length || !s.backdated.some(b => !b.applied && b.decideAt <= now)) return s;
      let id = s.nextId;
      const { requests, added } = settleBackdated(s.backdated, s.participants, drivers, now, () => id++);
      return { ...s, nextId: id, backdated: requests, participants: [...added, ...s.participants] };
    });
    settle();
    const timer = window.setInterval(settle, 5000);
    return () => window.clearInterval(timer);
  }, [drivers, update]);
  return { state, update };
}

export function SectionPage({ view, params, ...props }: SectionProps & { view: string; params: URLSearchParams }) {
  const reg = Number(params.get("reg")) || 0, draft = Number(params.get("draft")) || undefined;
  switch (view) {
    case "promo-connect": return <PromoConnect {...props} />;
    case "promo-registry": return <PromoRegistry {...props} />;
    case "promo-backdated": return <PromoBackdated {...props} />;
    case "promo-conditions": return <PromoConditions {...props} />;
    case "registration": return reg ? <RegistrationDetails {...props} id={reg} /> : <RegistrationList {...props} />;
    case "registration-new": return <RegistrationForm key={draft ?? "new"} {...props} draft={draft} />;
    case "edo": return <EdoDrivers {...props} />;
    case "edo-provider": return <EdoProvider {...props} />;
    case "edo-provider-dashboard": return <EdoProviderDashboard {...props} />;
    case "edo-dashboard": return <EdoDashboard {...props} />;
    default: return null;
  }
}
