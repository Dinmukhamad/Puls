/** Pure helpers of the training «Диспетчерская»: routes inside the tab, search and formatting. */
import type { FleetDriver, FleetPark } from "../../api/dispatch";

export type FleetPage = "home" | "goals" | "profile" | "contractors" | "driver" | "map" | "rules" | "inventory" | "support" | "antifraud" | "order";
export type DriverTab = "details" | "car" | "income" | "transactions" | "orders" | "bonuses" | "balance" | "gps" | "photo" | "history";
export interface FleetRoute { page: FleetPage; id?: string; tab?: DriverTab }

export const DRIVER_TABS: [DriverTab, string][] = [
  ["details", "Детали"], ["car", "Автомобиль"], ["income", "Заработок"], ["transactions", "Ведомость"], ["orders", "Заказы"],
  ["bonuses", "Бонусы"], ["balance", "История баланса"], ["gps", "GPS"], ["photo", "Фотоконтроль"], ["history", "История изменений"],
];
const PAGES: FleetPage[] = ["home", "goals", "profile", "contractors", "driver", "map", "rules", "inventory", "support", "antifraud", "order"];
const TABS = DRIVER_TABS.map(([tab]) => tab);

/** The route lives in one query parameter, e.g. `driver/<id>/car` or `contractors/<id>` (preview card). */
export function parseRoute(raw: string | null): FleetRoute {
  const [page, id, tab] = (raw ?? "").split("/");
  if (!PAGES.includes(page as FleetPage)) return { page: "contractors" };
  if (page === "driver") return id ? { page, id, tab: TABS.includes(tab as DriverTab) ? tab as DriverTab : "details" } : { page: "contractors" };
  return id ? { page: page as FleetPage, id } : { page: page as FleetPage };
}
export function routePath(route: FleetRoute) {
  return [route.page, route.id, route.page === "driver" && route.tab !== "details" ? route.tab : undefined].filter(Boolean).join("/");
}

/** Sections of the left rail, grouped as in the cabinet; `null` marks one that is not in the training. */
export const RAIL: { id: string; title: string; icon: string; items: [string, FleetPage | null][] }[] = [
  { id: "park", title: "О парке", icon: "park", items: [["Главная", "home"], ["Цели", "goals"], ["Профиль партнёра", "profile"]] },
  { id: "people", title: "Исполнители", icon: "people", items: [["Исполнители", "contractors"], ["На карте", "map"], ["Условия сотрудничества", "rules"], ["Инвентарь", "inventory"], ["Рассылки", null]] },
  { id: "cars", title: "Автомобили", icon: "cars", items: [["Автомобили", null], ["Антифрод", "antifraud"]] },
  { id: "help", title: "Помощь", icon: "help", items: [["Новости", null], ["База знаний", null], ["Техподдержка", "support"], ["Правовые документы", null]] },
];
export const railFor = (page: FleetPage) => RAIL.find(group => group.items.some(([, target]) => target === page || (page === "driver" && target === "contractors") || (page === "order" && target === "antifraud")))?.id ?? "people";

export const fullName = (d: Pick<FleetDriver, "last_name" | "first_name" | "middle_name">) => [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(" ");
export const initials = (text: string) => { const words = text.split(/\s+/).filter(Boolean); return (words.length > 1 ? words.slice(0, 2).map(word => word[0]).join("") : (words[0] ?? "").slice(0, 2)).toUpperCase(); };
export const parkTitle = (park?: FleetPark) => park ? `${park.name}, ${park.city}` : "";

const digits = (text: string) => text.replace(/\D/g, "");
/** Name, licence, phone (dictated with 8 or +7) or plate; at least three letters or digits. */
export function matchesQuery(d: FleetDriver, raw: string) {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.replace(/[^\p{L}\p{N}]/gu, "").length < 3) return false;
  const compact = q.replace(/\s/g, ""), number = digits(q).replace(/^8(\d{10})$/, "7$1");
  const words = [fullName(d), `${d.first_name} ${d.last_name}`].join(" ").toLowerCase();
  return words.includes(q) || (!!d.license && d.license.toLowerCase().includes(compact)) || (!!d.car && d.car.plate.toLowerCase().includes(compact))
    || (number.length >= 4 && digits(d.phone).includes(number));
}

export const STATUS: Record<FleetDriver["status"], { label: string; tone: string }> = {
  free: { label: "Свободен", tone: "free" }, order: { label: "На заказе", tone: "order" }, busy: { label: "Занят", tone: "busy" }, offline: { label: "Офлайн", tone: "offline" },
};
export const SEGMENTS: [FleetDriver["segment"], string][] = [["new", "Новые"], ["active", "Активные"], ["churn", "Отток"], ["archive", "Архив"]];

const number = (value: number, fraction = 2) => value.toLocaleString("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
export const money = (value: number, fraction = 2) => `${number(value, fraction)} ₸`;
export const phone = (raw: string) => { const d = digits(raw); return d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : raw; };
const MONTHS = ["янв.", "февр.", "марта", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];
/** Local cabinet times come without a zone and are shown as they are. */
export function shortDate(iso: string, time = true) {
  const [date, clock = ""] = iso.split("T"), [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}${time && clock ? `, ${clock.slice(0, 5)}` : ""}`;
}
export const dayDate = (iso: string) => iso ? iso.slice(0, 10).split("-").reverse().join(".") : "";
export function duration(seconds: number) {
  if (seconds < 60) return `${seconds} с`;
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return h ? `${h} ч ${m} мин` : `${m} мин${s ? ` ${s} с` : ""}`;
}
export const clock = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
export const countdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The link operators paste into a CRM appeal; CRM search reads the id from it. */
export const fleetLink = (d: FleetDriver, park?: FleetPark) => `https://fleet.yandex.kz/contractors/${d.id}/details?park_id=${park?.park_id ?? ""}&lang=ru`;

/** Lines of «Ведомость» for one order, newest first, derived from the order itself. */
export function orderTransactions(order: { id: string; price: number; payment: "cash" | "card"; tips: number; to: string; finished_at: string }) {
  if (!order.price) return [];
  const service = -Math.round(order.price * 0.101 * 100) / 100, vat = -Math.round(order.price * 0.016 * 100) / 100;
  const partner = -Math.round(order.price * 0.042 * 100) / 100, social = -Math.round(order.price * 0.03 * 100) / 100;
  const rows: { category: string; amount: number; comment: string }[] = [
    { category: "Удержание в счёт уплаты соц. платежей", amount: social, comment: `Удержание в счёт уплаты соц. платежей по заказу ${order.to}` },
    { category: "Комиссия партнёра за заказ", amount: partner, comment: `Комиссия партнёра по заказу ${order.to}` },
    { category: "Комиссия сервиса, НДС", amount: vat, comment: "НДС" },
    { category: "Комиссия сервиса за заказ", amount: service, comment: `Комиссия сервиса по заказу ${order.to}` },
  ];
  if (order.payment === "card") rows.push({ category: "Оплата картой", amount: order.price, comment: `Оплата по заказу ${order.to}` });
  if (order.tips) rows.unshift({ category: "Чаевые", amount: order.tips, comment: "Чаевые от пассажира" });
  return rows;
}
