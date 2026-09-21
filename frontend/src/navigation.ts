import type { ReactNode } from "react";
import type { Role } from "./api/types";
import type { AccessMap, SectionCode } from "./api/access";
import { HomeIcon, InboxIcon, SparkIcon, StoreIcon, TrophyIcon, UserIcon, UsersIcon, WheelIcon } from "./components/icons";

export interface SectionTab { to: string; label: string }
export interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: (props: { size?: number }) => ReactNode;
  paths: string[];
  tabs: SectionTab[];
}

const tab = (to: string, label: string): SectionTab => ({ to, label });
const section = (id: string, label: string, icon: NavItem["icon"], tabs: SectionTab[], paths?: string[]): NavItem => ({
  id, label, icon, to: tabs[0].to, tabs,
  paths: paths ?? Array.from(new Set(tabs.map((item) => item.to.split("?")[0]))),
});

export const ACCOUNT_SECTION = section("profile", "Профиль", UserIcon, [
  tab("/profile", "Мои данные и настройки"), tab("/notifications", "Уведомления"),
]);
const personal = [tab("/cabinet", "Мой кабинет"), tab("/progress", "Мой прогресс"), tab("/wallet", "Мои коины")];
const learningTabs = [tab("/training", "Всё обучение"), tab("/training?kind=test", "Тесты"), tab("/training?kind=mission", "Миссии"), tab("/training?kind=simulator", "Driver Simulator")];
const staffLearning = (admin: boolean) => section("training", "Обучение", SparkIcon, [
  tab("/admin/learning", "Все материалы"),
  tab("/admin/learning?kind=test", "Тесты"),
  tab("/admin/learning?kind=mission", admin ? "Mission Studio" : "Миссии"),
  tab("/admin/learning?kind=simulator", admin ? "Driver Simulator Studio" : "Driver Simulator"),
  tab("/admin/learning?tab=results", "Результаты команды"),
  tab("/admin/learning-analytics", "Аналитика обучения"),
]);
const team = (admin = false, supervisor = false) => section("team", admin ? "Пользователи и структура" : "Команда", UsersIcon, [
  tab("/admin/users", admin ? "Пользователи" : "Операторы"), tab("/admin/groups", supervisor ? "Моя группа" : "Группы"),
  tab("/admin/operators", "Показатели сотрудников"),
]);
const analytics = (supervisor = false) => section("analytics", "Аналитика", TrophyIcon, [
  tab("/analytics?tab=summary", "Сводка и сравнение"), tab("/analytics?tab=operators", "Операторы"), tab("/analytics?tab=quality", "Качество"),
  ...(supervisor ? [tab("/admin/periods", "Периоды"), tab("/admin/settings", "Правила и показатели")] : []),
]);
const performance = (admin = false) => section("performance", "Производительность", InboxIcon, [
  tab("/admin/periods", "Расчёт и история периодов"), tab("/admin/settings?tab=metrics", "Рабочие метрики"),
  tab("/admin/settings?tab=rules", "Правила расчёта"), tab("/admin/settings?tab=nominations", "Номинации"), tab("/rating", "Рейтинг"),
], ["/admin/periods", "/rating", ...(admin ? [] : ["/admin/settings"])]);
const motivation = (supervisor = false) => section("motivation", supervisor ? "Рейтинг и мотивация" : "Мотивация", StoreIcon, [
  ...(supervisor ? [tab("/rating", "Рейтинг")] : []), tab("/admin/wallet", "Коины"),
  tab("/admin/levels", "Уровни"), tab("/admin/settings?tab=badges", "Достижения"),
  tab("/admin/store", "Товары магазина"), tab("/admin/requests", "Заказы и выдача"),
  tab("/admin/games?tab=wheel", "Колесо WOW"), tab("/admin/games?tab=raffles", "Розыгрыши"),
], ["/admin/wallet", "/admin/levels", "/admin/store", "/admin/requests", "/admin/games", "/shop", "/games", ...(supervisor ? ["/rating"] : [])]);
const staffHome = section("home", "Главная", HomeIcon, [tab("/admin/summary", "Сводка"), ...personal]);

/** Only major destinations enter the sidebar. Future modules extend tabs inside these sections. */
export const ROLE_NAVIGATION: Record<Role, readonly NavItem[]> = {
  trainer: [
    section("home", "Главная", HomeIcon, [tab("/trainer", "Учебная сводка")]),
    section("team", "Пользователи", UsersIcon, [tab("/admin/users", "Операторы")]),
    section("training", "Обучение", SparkIcon, [tab("/admin/learning", "Материалы"), tab("/training", "Пройти обучение")]),
    section("tests", "Тесты", InboxIcon, [tab("/admin/learning?kind=test", "Тесты")]),
    section("missions", "Миссии", TrophyIcon, [tab("/admin/learning?kind=mission", "Миссии")]),
    section("driver", "Driver Simulator", SparkIcon, [tab("/admin/learning?kind=simulator", "Сценарии"), tab("/training?kind=simulator", "Тестовый запуск")]),
    section("learning_analytics", "Аналитика обучения", TrophyIcon, [tab("/admin/learning-analytics", "Результаты операторов"), tab("/admin/learning-analytics?view=driver", "Driver Simulator")]),
    {...ACCOUNT_SECTION, label: "Мой кабинет"},
  ],
  operator: [
    section("home", "Главная", HomeIcon, personal.filter((item) => item.to !== "/progress")),
    section("results", "Результаты", TrophyIcon, [tab("/rating?tab=board", "Рейтинг"), tab("/progress", "Мой прогресс")]),
    section("training", "Обучение", SparkIcon, learningTabs),
    // Колесо вынесено отдельным пунктом: это ежедневное действие на минуту,
    // и третьей вкладкой внутри «Наград» его каждый раз приходилось искать.
    // Право доступа прежнее — routeSection сопоставляет /games с разделом
    // rewards, так что отдельный пункт ничего не открывает сверх былого.
    section("wheel", "Колесо WOW", WheelIcon, [tab("/games?tab=wheel", "Колесо WOW")], ["/games"]),
    section("rewards", "Награды", StoreIcon, [tab("/shop", "Магазин"), tab("/games?tab=raffles", "Розыгрыши")]),
    ACCOUNT_SECTION,
  ],
  supervisor: [staffHome, team(false, true), analytics(true), staffLearning(false), motivation(true), ACCOUNT_SECTION],
  head: [staffHome, team(), analytics(), performance(), staffLearning(false), motivation(), section("reports", "Отчёты", InboxIcon, [tab("/reports", "Отчёты и экспорт")])],
  admin: [staffHome, team(true), performance(true), analytics(), staffLearning(true), motivation(),
    section("system", "Система", InboxIcon, [tab("/admin/access", "Доступ к разделам"), tab("/admin/sessions", "Сессии и устройства"), tab("/admin/audit", "Журнал аудита"), tab("/reports", "Отчёты и экспорт")])],
};

export function defaultAccess(role: Role): AccessMap {
  if (role === "trainer") return { team: true, training: true, learning_admin: true };
  const staff = role !== "operator";
  return { personal: !staff, results: true, training: !staff, rewards: !staff, overview: staff, team: staff, analytics: staff, performance: staff, learning_admin: staff, motivation: staff, reports: role === "head" || role === "admin", system: role === "admin" };
}

export function routeSection(pathname: string, search = "", role: Role = "operator"): SectionCode | "account" | "access" | "developer" | undefined {
  const matches = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  if (pathname === "/trainer" || pathname === "/admin/learning-analytics") return "learning_admin";
  if (matches("/progress")) return role === "operator" ? "results" : "personal";
  if (["/sessions", "/admin/sessions"].some(matches)) return "developer";
  if (["/profile", "/notifications"].some(matches)) return "account";
  if (matches("/admin/access")) return "access";
  if (matches("/admin/settings")) return new URLSearchParams(search).get("tab") === "badges" ? "motivation" : "performance";
  const routes: [SectionCode, string[]][] = [
    ["personal", ["/cabinet", "/wallet"]], ["results", ["/rating"]],
    ["training", ["/training", "/simulator"]], ["rewards", ["/shop", "/games"]],
    ["overview", ["/admin/summary"]], ["team", ["/admin/users", "/admin/groups", "/admin/operators"]],
    ["analytics", ["/analytics"]], ["performance", ["/admin/periods"]], ["learning_admin", ["/admin/learning"]],
    ["motivation", ["/admin/wallet", "/admin/levels", "/admin/store", "/admin/requests", "/admin/games"]],
    ["reports", ["/reports"]], ["system", ["/admin/audit"]],
  ];
  return routes.find(([, paths]) => paths.some(matches))?.[0];
}

export function canVisit(role: Role, to: string, allowed: AccessMap, isDeveloper = false): boolean {
  if (to === "/") return true;
  const [path, search = ""] = to.split("?");
  if (role === "trainer" && !["/profile", "/notifications", "/trainer", "/admin/learning-analytics", "/admin/learning", "/training", "/simulator", "/admin/users"].some(p => path === p || path.startsWith(p + "/"))) return false;
  if (role === "operator" && path.startsWith("/admin/users")) return false;
  const permission = routeSection(path, search, role);
  if (permission === "account") return true;
  if (permission === "developer") return role === "admin" && isDeveloper;
  if (permission === "access") return role === "admin";
  if (permission === "system" && role !== "admin") return false;
  return !!permission && allowed[permission] === true;
}

export function visibleNavigation(role: Role, allowed: AccessMap = defaultAccess(role), isDeveloper = false): readonly NavItem[] {
  if (role === "trainer") return ROLE_NAVIGATION.trainer.flatMap(item => {
    const tabs = item.tabs.filter(link => canVisit(role, link.to, allowed));
    return tabs.length ? [{ ...item, tabs, to: tabs[0].to }] : [];
  });
  const items = ROLE_NAVIGATION[role].map((item) => ({ ...item, tabs: [...item.tabs] }));
  // Extra grants also make sections discoverable to roles that did not originally have them.
  const additions = [
    section("home", "Главная", HomeIcon, [tab("/admin/summary", "Сводка"), ...personal]),
    team(), analytics(), performance(), staffLearning(role === "admin"), motivation(),
    section("personal_training", "Моё обучение", SparkIcon, learningTabs),
    section("results", "Результаты", TrophyIcon, [tab("/rating?tab=board", "Рейтинг")]),
    section("rewards", "Награды", StoreIcon, [tab("/shop", "Магазин"), tab("/games?tab=wheel", "Колесо WOW"), tab("/games?tab=raffles", "Розыгрыши")]),
    section("reports", "Отчёты", InboxIcon, [tab("/reports", "Отчёты и экспорт")]),
    section("system", "Система", InboxIcon, [tab("/admin/access", "Доступ к разделам"), tab("/admin/sessions", "Сессии и устройства"), tab("/admin/audit", "Журнал аудита")]),
  ];
  // Existing role placement wins, so shared features never occur twice in the sidebar.
  const placed = new Set(items.flatMap((item) => item.tabs.map((link) => routeSection(link.to.split("?")[0], link.to.split("?")[1], role))));
  for (const addition of additions) {
    const tabs = addition.tabs.filter((link) => !placed.has(routeSection(link.to.split("?")[0], link.to.split("?")[1], role)));
    if (!tabs.length) continue;
    const existing = items.find((item) => item.id === addition.id);
    if (existing) existing.tabs.push(...tabs); else items.push({ ...addition, tabs });
    tabs.forEach((link) => placed.add(routeSection(link.to.split("?")[0], link.to.split("?")[1], role)));
  }
  // Access management is always available to admins, even after denying every configurable module.
  if (role === "admin") {
    const system = items.find((item) => item.id === "system")!;
    system.tabs = [tab("/admin/access", "Доступ к разделам"), ...system.tabs.filter((link) => link.to !== "/admin/access" && link.to !== "/admin/settings")];
  }
  const visible = items.flatMap((item) => {
    const tabs = item.tabs.filter((link) => canVisit(role, link.to, allowed, isDeveloper));
    if (!tabs.length) return [];
    let { id, label } = item;
    if ((id === "performance" && !allowed.performance) || (id === "motivation" && !allowed.motivation)) { id = "results"; label = "Результаты"; }
    if (id === "analytics" && !allowed.analytics) { id = "performance"; label = "Производительность"; }
    if (id === "motivation" && !allowed.results) label = "Мотивация";
    return [{ ...item, id, label, tabs, to: tabs[0].to, paths: Array.from(new Set(tabs.map((link) => link.to.split("?")[0]))) }];
  });
  if (!visible.some((item) => item.id === "profile")) visible.push(ACCOUNT_SECTION);
  return visible;
}

export function currentSection(role: Role, pathname: string, search = "", allowed: AccessMap = defaultAccess(role), isDeveloper = false): NavItem | undefined {
  if (!canVisit(role, `${pathname}${search}`, allowed, isDeveloper)) return undefined;
  const sections = visibleNavigation(role, allowed, isDeveloper);
  if (role === "trainer" && ["/admin/learning", "/training", "/simulator"].some(p => pathname === p || pathname.startsWith(p + "/"))) {
    const kind = new URLSearchParams(search).get("kind");
    return sections.find(item => item.id === (kind === "test" ? "tests" : kind === "mission" ? "missions" : kind === "simulator" || pathname.startsWith("/simulator") ? "driver" : "training"));
  }
  // «Колесо» и «Розыгрыши» живут на одном пути /games и различаются только
  // вкладкой. Разделы сопоставляются по пути, поэтому без этой развилки
  // открытие розыгрышей подсвечивало бы в меню «Колесо WOW». У ролей, где
  // отдельного пункта колеса нет, ветка молча пропускается.
  if (pathname === "/games") {
    const wanted = new URLSearchParams(search).get("tab") === "raffles" ? "rewards" : "wheel";
    const found = sections.find((item) => item.id === wanted);
    if (found) return found;
  }
  // Settings pages are hosted by their business domain, even on direct legacy links.
  if (pathname === "/admin/settings") {
    const selected = new URLSearchParams(search).get("tab");
    if (selected === "badges") return sections.find((item) => item.id === "motivation");
    if (selected !== "badges") return sections.find((item) => item.id === "performance") ?? sections.find((item) => item.id === "analytics");
  }
  return [...sections, ACCOUNT_SECTION].find((item) => item.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)));
}

/** Query-specific tabs take precedence over generic destinations on the same route. */
export function currentTab(item: NavItem, pathname: string, search: string): SectionTab | undefined {
  const params = new URLSearchParams(search);
  const candidates = item.tabs.filter((link) => { const path = link.to.split("?")[0]; return pathname === path || pathname.startsWith(`${path}/`); });
  return candidates.map((link) => {
    const expected = new URLSearchParams(link.to.split("?")[1] ?? "");
    const entries = Array.from(expected.entries());
    return { link, score: entries.every(([key, value]) => params.get(key) === value) ? entries.length + (expected.has("tab") ? 1 : 0) : -1 };
  }).filter((candidate) => candidate.score >= 0).sort((a, b) => b.score - a.score)[0]?.link ?? candidates[0];
}

export function mobileNavigation(items: readonly NavItem[]) {
  return items.length <= 5 ? { primary: items, overflow: [] } : { primary: items.slice(0, 4), overflow: items.slice(4) };
}

export function subsectionDestination(link: SectionTab, pathname: string, search: string): string {
  const [targetPath, targetSearch] = link.to.split("?");
  if (targetPath !== pathname) return link.to;
  const source = new URLSearchParams(search); const destination = new URLSearchParams(targetSearch ?? "");
  const shared: Record<string, string[]> = {
    "/rating": ["week", "count", "search"],
    "/analytics": ["week_id", "group_id", "metric", "operators", "compare", "group_compare", "search", "status"],
    "/training": ["state"],
    "/admin/learning": destination.has("tab") ? ["kind"] : [],
  };
  for (const key of shared[pathname] ?? []) if (source.has(key) && !destination.has(key)) destination.set(key, source.get(key)!);
  const query = destination.toString(); return `${targetPath}${query ? `?${query}` : ""}`;
}
