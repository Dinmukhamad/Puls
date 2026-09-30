/**
 * Training copy of CRM «ЭДО»: the self-employed drivers' documents in Sapar, the call campaign
 * that brings drivers to Sapar and both dashboards. The fleet's own self-employed drivers are in it
 * with the provider «Диспетчерская» has for them; everyone else is fictional.
 */
import { driverName, type TrainingDriver } from "../drivers/driverData";
import { hex32, iinFor, phoneFor, pick } from "./fake";
import type { TrainingEvent } from "./promoData";

export type DocStatus = "Подписано" | "Ожидает подписания" | "Не сформировано" | "Срок подписания истёк";
export type Ecp = "Есть ЭЦП" | "Нет ЭЦП" | "Срок действия истек";
export type Office = "—" | "Придёт" | "Не придёт" | "Пришёл";
export type Reach = "—" | "Дозвонились" | "Недозвон" | "Неверный номер";
export type CallStatus = "Новый" | "В работе" | "Обработан";
export const OFFICE: Office[] = ["—", "Придёт", "Не придёт", "Пришёл"];
export const REACH: Reach[] = ["Дозвонились", "Недозвон", "Неверный номер"];
export const CALL_STATUSES: CallStatus[] = ["Новый", "В работе", "Обработан"];
export const DOC_STATUSES: DocStatus[] = ["Подписано", "Ожидает подписания", "Не сформировано", "Срок подписания истёк"];
export const PERIODS = ["2026-08", "2026-07"];

export interface EdoRow {
  id: number; period: string; iin: string; account: string; name: string; phone: string; park: string; city: string;
  provider: "sapar" | ""; docs: "Да" | "Нет" | "—"; ecp: Ecp; works: boolean; office: Office;
  avrYandex: DocStatus; avrPark: DocStatus; contract: "Подписано" | "Ожидает"; commission: number; corporate: boolean;
  smz: boolean; priority: boolean; tripFrom: string; tripTo: string;
  calledAt: string; manager: string; callStatus: CallStatus; reach: Reach; comment: string; signedAt: string;
  /** The driver promised on the phone to sign in Sapar: the next status update finds the documents signed. */
  promised: boolean; history: TrainingEvent[];
}

export type Outcome = "—" | "Согласен сменить" | "Отказ" | "Перезвонить" | "Уже сменил";
export type RequestId = "—" | "Запрошен" | "Получен";
export type Changed = "—" | "Да" | "Нет";
export const OUTCOMES: Outcome[] = ["Согласен сменить", "Отказ", "Перезвонить", "Уже сменил"];
export const REQUEST_IDS: RequestId[] = ["—", "Запрошен", "Получен"];
export interface ProviderRow {
  id: number; period: string; iin: string; account: string; name: string; phone: string; park: string; provider: "sapar" | ""; ecp: Ecp;
  calledAt: string; manager: string; office: Office; callStatus: CallStatus; reach: "—" | "Дозвон" | "Недозвон"; outcome: Outcome; requestId: RequestId; changed: Changed;
  comment: string; history: TrainingEvent[];
}

const FIRST = ["Абай", "Ерлан", "Нурсултан", "Айдос", "Бауыржан", "Мадияр", "Айгерим", "Динара", "Жанболат", "Руслан", "Тимур", "Асель", "Серик", "Гаухар", "Данияр", "Айбек", "Карина", "Олжас"];
const LAST = ["Абдрахманов", "Ахметов", "Байтуров", "Ержанов", "Жаппаров", "Искаков", "Кулмаганбетов", "Мукашев", "Нургалиев", "Оразбаев", "Рахимов", "Сагинтаев", "Тажибаев", "Усенов", "Шаймерденов", "Есимов", "Калдыбаев", "Бекенов"];
const PLACES: [string, string][] = [["Ноль Такси Алматы", "Алматы"], ["Global Шымкент", "Шымкент"], ["Департамент Такси Кокшетау", "Кокшетау"], ["iTaxi Актобе", "Актобе"], ["Jana Taxi Алматы", "Алматы"], ["Адал Атырау", "Атырау"], ["iTaxi Шымкент", "Шымкент"], ["Аманат Кызылорда", "Кызылорда"], ["Tenge Taxi Астана", "Астана"]];
export const MANAGERS = ["Смагулова Инкар", "Бекова Алия", "Турсунов Ерик"];
const person = (i: number) => { const first = FIRST[pick(`edo-first-${i}`, FIRST.length)], last = LAST[pick(`edo-last-${i}`, LAST.length)]; const woman = ["Айгерим", "Динара", "Асель", "Гаухар", "Карина"].includes(first); return { name: `${woman ? last + "а" : last} ${first}`, woman }; };
const birth = (i: number) => `19${70 + pick(`edo-birth-${i}`, 30)}-${String(1 + pick(`edo-m-${i}`, 12)).padStart(2, "0")}-${String(1 + pick(`edo-d-${i}`, 28)).padStart(2, "0")}`;

/** Forty self-employed drivers of August and July with every document state the section shows. */
export function seedEdo(): EdoRow[] {
  return Array.from({ length: 40 }, (_, i): EdoRow => {
    const { name, woman } = person(i), [park, city] = PLACES[i % PLACES.length], period = i < 32 ? "2026-08" : "2026-07";
    const docs = i % 9 === 3 ? "Нет" : i % 13 === 7 ? "—" : "Да";
    const avr: DocStatus = docs !== "Да" ? "Не сформировано" : i % 5 === 4 ? "Срок подписания истёк" : i % 4 === 1 ? "Ожидает подписания" : "Подписано";
    const avrPark: DocStatus = docs !== "Да" ? "Не сформировано" : avr === "Подписано" && i % 3 === 0 ? "Ожидает подписания" : avr;
    const contract = avr === "Подписано" || i % 6 === 0 ? "Подписано" : "Ожидает";
    const signed = avr === "Подписано" && avrPark === "Подписано" && contract === "Подписано";
    return {
      id: 5000 + i, period, iin: iinFor(birth(i), `edo-${i}`, woman), account: hex32(`edo-${i}`), name, phone: phoneFor(`edo-${i}`), park, city,
      provider: i % 7 === 5 ? "" : "sapar", docs, ecp: i % 8 === 2 ? "Есть ЭЦП" : i % 11 === 6 ? "Срок действия истек" : "Нет ЭЦП", works: i % 10 !== 9, office: "—",
      avrYandex: avr, avrPark, contract, commission: i % 4 === 2 ? 500 : 110, corporate: i % 3 !== 1, smz: i % 12 !== 11, priority: i % 5 === 0,
      tripFrom: `${period}-0${1 + (i % 9)}`, tripTo: `${period}-2${i % 9}`, calledAt: "", manager: "", callStatus: "Новый", reach: "—", comment: "",
      signedAt: signed ? `2026-09-${String(1 + (i % 27)).padStart(2, "0")}` : "", promised: false, history: [{ at: `${period}-28T09:00:00.000Z`, text: "Документы выставлены в Sapar" }],
    };
  });
}

/** Drivers of the campaign «Смена провайдера ЭДО»: no ЭЦП or not on Sapar. */
export function seedProvider(): ProviderRow[] {
  return Array.from({ length: 24 }, (_, i): ProviderRow => {
    const { name, woman } = person(100 + i), [park] = PLACES[(i * 5) % PLACES.length];
    return {
      id: 8000 + i, period: "2026-08", iin: i % 4 === 0 ? "" : iinFor(birth(100 + i), `provider-${i}`, woman), account: hex32(`provider-${i}`), name, phone: i % 4 === 0 ? "" : phoneFor(`provider-${i}`), park,
      provider: i % 3 === 1 ? "sapar" : "", ecp: "Нет ЭЦП", calledAt: "", manager: "", office: "—", callStatus: "Новый", reach: "—", outcome: "—", requestId: "—", changed: "—", comment: "", history: [],
    };
  });
}

/** Rows of the fleet's drivers carry the driver's CRM number as their id; the fictional rows stay below it. */
export const FLEET_ROW = 1_000_000;
export const isFleetRow = (row: { id: number }) => row.id >= FLEET_ROW;
const onSapar = (d: Pick<TrainingDriver, "provider">) => d.provider === "Sapar";
/** A row keeps what the operator did; name, park, work status and the provider come from the account. */
function liveEdo(row: EdoRow, d: TrainingDriver): EdoRow {
  const sapar = onSapar(d), issued = sapar && row.docs === "Да";
  return {
    ...row, iin: d.iin, account: d.account, name: driverName(d), phone: d.phone, park: d.park, city: d.city, works: d.works, provider: sapar ? "sapar" : "",
    docs: sapar ? "Да" : "Нет", avrYandex: issued ? row.avrYandex : sapar ? "Ожидает подписания" : "Не сформировано", avrPark: issued ? row.avrPark : sapar ? "Ожидает подписания" : "Не сформировано",
  };
}
const fleetEdoRow = (d: TrainingDriver): EdoRow => ({
  id: d.id, period: PERIODS[0], iin: d.iin, account: d.account, name: driverName(d), phone: d.phone, park: d.park, city: d.city, provider: "", docs: "Нет", ecp: "Нет ЭЦП",
  works: d.works, office: "—", avrYandex: "Не сформировано", avrPark: "Не сформировано", contract: "Ожидает", commission: 110, corporate: false, smz: true, priority: false,
  tripFrom: `${PERIODS[0]}-01`, tripTo: `${PERIODS[0]}-28`, calledAt: "", manager: "", callStatus: "Новый", reach: "—", comment: "", signedAt: "", promised: false,
  history: [{ at: `${PERIODS[0]}-28T09:00:00.000Z`, text: onSapar(d) ? "Документы выставлены в Sapar" : "Провайдер ЭДО не Sapar: документы в Sapar не выставляются" }],
});
/** «ЭДО водителей» with the fleet: every self-employed account of «Учётные записи водителей» is a row. */
export function fleetEdo(rows: EdoRow[], drivers: TrainingDriver[]): EdoRow[] {
  const smz = drivers.filter(d => d.type === "СМЗ"), saved = new Map(rows.map(r => [r.id, r]));
  return [...smz.map(d => liveEdo(saved.get(d.id) ?? fleetEdoRow(d), d)), ...rows.filter(r => !isFleetRow(r))];
}
// The account's history has this line once the provider was changed in «Диспетчерская».
const PROVIDER_CHANGED = "Диспетчерская: провайдер ЭДО";
/** «Смена провайдера» with the fleet: self-employed accounts not on Sapar, those already called and those moved to Sapar. */
export function fleetProvider(rows: ProviderRow[], drivers: TrainingDriver[]): ProviderRow[] {
  const saved = new Map(rows.map(r => [r.id, r]));
  const inCampaign = (d: TrainingDriver) => !onSapar(d) || saved.has(d.id) || d.history.some(h => h.text.startsWith(PROVIDER_CHANGED));
  const live = drivers.filter(d => d.type === "СМЗ" && inCampaign(d)).map((d): ProviderRow => {
    const row = saved.get(d.id) ?? { id: d.id, period: PERIODS[0], iin: "", account: "", name: "", phone: "", park: "", provider: "", ecp: "Нет ЭЦП", calledAt: "", manager: "", office: "—", callStatus: "Новый", reach: "—", outcome: "—", requestId: "—", changed: "—", comment: "", history: [] };
    // «Провайдер сменили» is what the account says: the provider is changed in «Диспетчерская».
    const changed: Changed = onSapar(d) ? "Да" : row.changed === "Да" ? "—" : row.changed;
    return { ...row, iin: d.iin, account: d.account, name: driverName(d), phone: d.phone, park: d.park, provider: onSapar(d) ? "sapar" : "", changed };
  });
  return [...live, ...rows.filter(r => !isFleetRow(r))];
}
/** Saves a row the operator worked with; a fleet row is stored on the first call. */
export const upsert = <T extends { id: number }>(rows: T[], next: T) => rows.some(r => r.id === next.id) ? rows.map(r => r.id === next.id ? next : r) : [next, ...rows];

const stamp = <T extends { history: TrainingEvent[] }>(row: T, text: string, now: string): T => ({ ...row, history: [{ at: now, text }, ...row.history] });
export const allSigned = (r: Pick<EdoRow, "avrYandex" | "avrPark" | "contract">) => r.avrYandex === "Подписано" && r.avrPark === "Подписано" && r.contract === "Подписано";

export interface EdoCall { reach: Reach; office: Office; comment: string }
/** A call from «ЭДО водителей»; a driver reached and not refusing the office promises to sign. */
export function logEdoCall(row: EdoRow, call: EdoCall, manager: string, now: string): EdoRow {
  if (!call.reach || call.reach === "—") throw new Error("Выберите статус дозвона.");
  if (call.reach === "Дозвонились" && call.comment.trim().length < 5) throw new Error("Коротко запишите, о чём договорились с водителем.");
  const done = call.reach === "Дозвонились" || call.reach === "Неверный номер";
  return stamp({ ...row, reach: call.reach, office: call.office, comment: call.comment.trim(), calledAt: now, manager, callStatus: done ? "Обработан" : "В работе",
    promised: row.promised || (call.reach === "Дозвонились" && call.office !== "Не придёт") }, `Звонок: ${call.reach}${call.office !== "—" ? `, явка — ${call.office.toLowerCase()}` : ""}. ${call.comment.trim()}`.trim(), now);
}
/** «Обновить статус» asks Sapar again: signed documents appear only after the driver has signed. */
export function refreshEdo(row: EdoRow, now: string): { row: EdoRow; changed: boolean } {
  if (row.docs !== "Да") return { row: stamp(row, "Статус не изменился: документы ещё не выставлены", now), changed: false };
  if (allSigned(row)) return { row: stamp(row, "Статус актуален: все документы подписаны", now), changed: false };
  if (!row.promised) return { row: stamp(row, "Статус не изменился: водитель ещё не подписал документы в Sapar", now), changed: false };
  return { row: stamp({ ...row, avrYandex: "Подписано", avrPark: "Подписано", contract: "Подписано", signedAt: now.slice(0, 10), ecp: row.ecp === "Есть ЭЦП" ? row.ecp : "Есть ЭЦП", office: row.office === "Придёт" ? "Пришёл" : row.office }, "Статус обновлён из Sapar: АВР Яндекса, АВР парка и договор подписаны", now), changed: true };
}

export interface ProviderCall { reach: "Дозвон" | "Недозвон"; outcome: Outcome; requestId: RequestId; office: Office; comment: string }
/** A call of the provider campaign; «Провайдер сменили» follows from the outcome. */
export function logProviderCall(row: ProviderRow, call: ProviderCall, manager: string, now: string): ProviderRow {
  if (call.reach === "Дозвон" && call.outcome === "—") throw new Error("Выберите итог звонка.");
  if (call.outcome === "Согласен сменить" && call.requestId === "—") throw new Error("Водитель согласен: запросите ID в Sapar — отметьте «Запрос ID».");
  const outcome: Outcome = call.reach === "Недозвон" ? "—" : call.outcome;
  const changed: Changed = outcome === "Уже сменил" || (outcome === "Согласен сменить" && call.requestId === "Получен") ? "Да" : outcome === "Отказ" ? "Нет" : "—";
  return stamp({ ...row, reach: call.reach, outcome, requestId: call.reach === "Недозвон" ? row.requestId : call.requestId, office: call.office, comment: call.comment.trim(), changed,
    provider: changed === "Да" ? "sapar" : row.provider, calledAt: now, manager, callStatus: call.reach === "Недозвон" || outcome === "Перезвонить" ? "В работе" : "Обработан" },
    `Звонок: ${call.reach}${outcome !== "—" ? `, ${outcome.toLowerCase()}` : ""}${call.requestId !== "—" && call.reach === "Дозвон" ? `, запрос ID — ${call.requestId.toLowerCase()}` : ""}`, now);
}

/** Counts by a field, in the order the dashboard tables show them. */
export function countBy<T>(rows: T[], field: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(field(row), (counts.get(field(row)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
const share = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : 0;
export interface EdoFilters { corporate: boolean; priority: boolean; hideUnissued: boolean }
/** «Дашборд ЭЦП и подписаний» for a period. */
export function edoDashboard(rows: EdoRow[], period: string, f: EdoFilters) {
  const scope = rows.filter(r => r.period === period && r.smz && (!f.corporate || r.corporate) && (!f.priority || r.priority) && (!f.hideUnissued || r.docs === "Да"));
  const yandex = scope.filter(r => r.avrYandex === "Подписано").length, park = scope.filter(r => r.avrPark === "Подписано").length, contracts = scope.filter(r => r.contract === "Подписано").length, all = scope.filter(allSigned).length;
  const toCall = scope.filter(r => r.ecp !== "Есть ЭЦП" || r.provider !== "sapar"), called = toCall.filter(r => r.callStatus !== "Новый");
  return {
    total: scope.length, ecp: scope.filter(r => r.ecp === "Есть ЭЦП").length,
    yandex: { count: yandex, percent: share(yandex, scope.length) }, park: { count: park, percent: share(park, scope.length) }, contracts: { count: contracts, percent: share(contracts, scope.length) },
    all: { count: all, percent: share(all, scope.length) }, toCall: toCall.length, called: called.length, callPercent: share(called.length, toCall.length),
    byStatus: countBy(toCall, r => r.callStatus), byReach: countBy(called, r => r.reach),
  };
}
export function providerDashboard(rows: ProviderRow[], period: string) {
  const scope = rows.filter(r => r.period === period), done = scope.filter(r => r.callStatus !== "Новый");
  return { total: scope.length, done: done.length, percent: share(done.length, scope.length), byStatus: countBy(scope, r => r.callStatus), byReach: countBy(scope, r => r.reach), byOutcome: countBy(scope, r => r.outcome), byRequest: countBy(scope, r => r.requestId), byChanged: countBy(scope, r => r.changed) };
}
/** «Рейтинг менеджеров КЦ»: processed calls per manager over the seven days up to `today`. */
export function managerRating(rows: { calledAt: string; manager: string }[], today: string) {
  const days = Array.from({ length: 7 }, (_, i) => new Date(new Date(`${today}T00:00:00Z`).getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  const managers = [...new Set(rows.filter(r => r.calledAt && days.includes(r.calledAt.slice(0, 10))).map(r => r.manager))];
  return { days, rows: managers.map(manager => { const perDay = days.map(day => rows.filter(r => r.manager === manager && r.calledAt.slice(0, 10) === day).length); return { manager, perDay, total: perDay.reduce((a, b) => a + b, 0) }; }).sort((a, b) => b.total - a.total) };
}
