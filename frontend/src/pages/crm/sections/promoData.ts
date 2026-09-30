/**
 * Training copy of CRM «Акции»: connecting a driver, the participant registry, backdated
 * requests and the promotions that change working conditions. Every name, ID and amount is
 * fictional; the drivers are the training accounts of «Учётные записи водителей».
 */
import { driverName, driverSearchQuery, type TrainingDriver } from "../drivers/driverData";
import { hex32 } from "./fake";

export type PromoKind = "money" | "auto" | "condition" | "none";
export interface Promo {
  id: string; title: string; kind: PromoKind;
  /** What the driver has to do, as the registry shows it. */
  condition: string; days: number; target: number; amount: number;
  audience: "new" | "all" | "courier" | "experienced";
  /** Parks taking part; null — every park. */
  parks: string[] | null;
  /** Working conditions for the time of the promotion (condition promotions). */
  terms?: string;
}

const NOT_HONEST = ["iTaxi Алматы", "iTaxi Туркестан", "iTaxi (Доставка) Алматы", "QAZAQ Алматы", "Аманат Уральск", "Ноль Такси Алматы", "Jana Taxi Тараз", "Tenge Taxi Астана", "EKI DONGELEK Алматы", "Адал Шымкент", "Global Шымкент"];
export const PROMOS: Promo[] = [
  { id: "fast-start", title: "Быстрый старт", kind: "money", condition: "20 поездок / 3 дн. → 5 000 ₸", days: 3, target: 20, amount: 5000, audience: "new", parks: NOT_HONEST.filter(p => p !== "QAZAQ Алматы") },
  { id: "tenge-2000", title: "Тенге 2000 при регистрации", kind: "auto", condition: "1 поездка → 2 000 ₸", days: 14, target: 1, amount: 2000, audience: "new", parks: null },
  { id: "invite", title: "Приведи друга", kind: "money", condition: "30 поездок / 14 дн. → 10 000 ₸ пригласившему", days: 14, target: 30, amount: 10000, audience: "all", parks: ["iTaxi Алматы", "iTaxi Туркестан", "Ноль Такси Алматы", "Jana Taxi Тараз", "EKI DONGELEK Алматы"] },
  { id: "courier-week", title: "Курьерская неделя", kind: "money", condition: "50 доставок / 7 дн. → 7 000 ₸", days: 7, target: 50, amount: 7000, audience: "courier", parks: null },
  { id: "priority", title: "Приоритет новичка", kind: "none", condition: "+10 баллов приоритета на 14 дн.", days: 14, target: 0, amount: 0, audience: "new", parks: null },
  { id: "no-commission", title: "Неделя без комиссии", kind: "condition", condition: "7 дн. без комиссии парка", days: 7, target: 0, amount: 0, audience: "all", parks: NOT_HONEST, terms: "Акция парк 0%" },
  { id: "courier-month", title: "Месяц 1% для курьеров", kind: "condition", condition: "30 дн. комиссия парка 1%", days: 30, target: 0, amount: 0, audience: "courier", parks: null, terms: "Курьеры 1%" },
];
export const promoById = (id: string) => PROMOS.find(p => p.id === id);
export const promoLabel = (p: Promo) => p.kind === "condition" ? `${p.title} — ${p.days} дн.` : p.title;

export type Payout = "waiting" | "ready" | "review" | "paid" | "auto" | "error" | "none";
/** The legend above the registry: what each payout status means and whether «Пополнить» works. */
export const PAYOUT: Record<Payout, { label: string; hint: string; button: "off" | "on" | null }> = {
  waiting: { label: "Ожидает выполнения", hint: "условия ещё не выполнены — кнопка недоступна", button: "off" },
  ready: { label: "Готово к выплате", hint: "можно начислить — кнопка активна", button: "on" },
  review: { label: "Требует проверки", hint: "результат не подтверждён — сверяет фин. отдел / аналитик, не оператор", button: null },
  paid: { label: "Выплачено", hint: "завершено", button: null },
  auto: { label: "Автоматически", hint: "начисляется само, без кнопки", button: null },
  error: { label: "Ошибка начисления", hint: "деньги не дошли — кнопка снова активна, можно повторить", button: "on" },
  none: { label: "Без денег", hint: "у акции нет денежного результата — кнопки нет", button: null },
};
export type Participation = "Ожидает первой поездки" | "Выполняет условия" | "Условия выполнены" | "Не выполнено" | "Завершено";
export const PARTICIPATION: Participation[] = ["Ожидает первой поездки", "Выполняет условия", "Условия выполнены", "Не выполнено", "Завершено"];
export type Source = "CRM" | "Задним числом" | "Автоматически" | "Смена условий";
export const SOURCES: Source[] = ["CRM", "Задним числом", "Автоматически", "Смена условий"];

export interface TrainingEvent { at: string; text: string }
export interface Participant {
  id: number; account: string; name: string; park: string; inviter: string; promo: string;
  connectedAt: string; until: string; progress: number; status: Participation; payout: Payout;
  reason: string; amount: number; paidAt: string; before: string; now: string; after: string;
  employee: string; source: Source; history: TrainingEvent[];
}
export interface Backdated {
  id: number; account: string; name: string; park: string; promo: string; since: string; reason: string; files: string[];
  author: string; submittedAt: string;
  /** The head's answer, known at once but shown only after `decideAt`: in the training the head answers in two minutes. */
  decideAt: string; approved: boolean; answer: string; applied: boolean;
}
export interface ConditionAdd { id: number; account: string; name: string; promo: string; at: string; until: string; before: string; after: string }

export const DAY = 86_400_000;
export const DECISION_AFTER = 120_000;
const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY).toISOString();
export const profession = (d: Pick<TrainingDriver, "park">) => /Доставка/.test(d.park) ? "Курьер" : "Водитель";

/** The training driver behind an account ID, a numeric ID or a pasted link to the driver. */
export function findDriver(drivers: TrainingDriver[], raw: string) {
  const q = driverSearchQuery(raw);
  if (!q) return undefined;
  return drivers.find(d => d.account === q || String(d.id) === q);
}

/** Why the promotion does not fit the driver, or null when it does. */
export function promoProblem(p: Promo, d: TrainingDriver) {
  if (p.parks && !p.parks.includes(d.park)) return `Парк «${d.park}» не участвует в акции «${p.title}».`;
  if (p.audience === "new" && d.orders[3] > 0) return `Акция «${p.title}» — только для новых водителей без поездок.`;
  if (p.audience === "courier" && profession(d) !== "Курьер") return `Акция «${p.title}» — только для курьеров.`;
  if (p.audience === "experienced" && d.orders[3] < 100) return `Акция «${p.title}» — для водителей от 100 поездок.`;
  return null;
}
const running = (x: Participant, now: string) => x.until > now && !["Не выполнено", "Завершено"].includes(x.status);
export const activeIn = (participants: Participant[], account: string, promo: string, now: string) => participants.find(x => x.account === account && x.promo === promo && running(x, now));
/** Promotions the operator may connect the driver to on «Подключение к акции». */
export function availablePromos(d: TrainingDriver, participants: Participant[], now: string) {
  return PROMOS.filter(p => p.kind !== "condition" && !promoProblem(p, d) && !activeIn(participants, d.account, p.id, now));
}

function participant(id: number, d: TrainingDriver, p: Promo, employee: string, now: string, source: Source, since = now): Participant {
  const payout: Payout = p.kind === "auto" ? "auto" : p.kind === "money" ? "waiting" : "none";
  return {
    id, account: d.account, name: driverName(d), park: d.park, inviter: "", promo: p.id, connectedAt: since, until: addDays(since, p.days), progress: 0,
    status: p.kind === "condition" ? "Выполняет условия" : "Ожидает первой поездки", payout, reason: "", amount: 0, paidAt: "",
    before: p.kind === "condition" ? d.conditions : "", now: p.terms ?? "", after: p.kind === "condition" ? d.conditions : "",
    employee, source, history: [{ at: now, text: source === "Задним числом" ? `Добавлен по заявке задним числом с ${since.slice(0, 10)}` : `Подключён к акции «${p.title}»` }],
  };
}

export function connect(participants: Participant[], d: TrainingDriver, promoId: string, employee: string, now: string, id: number) {
  const p = promoById(promoId);
  if (!p || p.kind === "condition") throw new Error("Эта акция подключается в разделе «Смена условий работы».");
  const problem = promoProblem(p, d);
  if (problem) throw new Error(problem);
  if (activeIn(participants, d.account, p.id, now)) throw new Error(`Водитель уже участвует в акции «${p.title}».`);
  return participant(id, d, p, employee, now, "CRM");
}

/** «Пополнить»: only a confirmed result is paid; a failed payout can be sent again. */
export function payOut(x: Participant, now: string): Participant {
  if (PAYOUT[x.payout].button !== "on") throw new Error(`Выплата недоступна: «${PAYOUT[x.payout].label}».`);
  const p = promoById(x.promo);
  const retry = x.payout === "error";
  return { ...x, payout: "paid", status: "Завершено", amount: p?.amount ?? x.amount, paidAt: now, reason: "",
    history: [{ at: now, text: retry ? "Повторное начисление: деньги отправлены" : `Начислено ${(p?.amount ?? x.amount).toLocaleString("ru-RU")} ₸` }, ...x.history] };
}

/** «Смена условий работы»: the driver works on the promotion's terms until it ends. */
export function addToConditionPromo(participants: Participant[], d: TrainingDriver, promoId: string, employee: string, now: string, id: number) {
  const p = promoById(promoId);
  if (!p || p.kind !== "condition") throw new Error("Выберите акцию.");
  const problem = promoProblem(p, d);
  if (problem) throw new Error(problem);
  const active = activeIn(participants, d.account, p.id, now);
  if (active) throw new Error(`Водитель уже в акции «${p.title}» до ${active.until.slice(0, 10).split("-").reverse().join(".")}.`);
  const row = participant(id, d, p, employee, now, "Смена условий");
  const add: ConditionAdd = { id, account: d.account, name: driverName(d), promo: p.id, at: now, until: row.until, before: d.conditions, after: d.conditions };
  return { row, add, terms: p.terms! };
}

export interface BackdatedInput { promo: string; account: string; since: string; reason: string; files: string[] }
/** Mistakes the form catches before the request goes to the head. */
export function backdatedErrors(input: BackdatedInput, drivers: TrainingDriver[], participants: Participant[], now: string) {
  const errors: Partial<Record<keyof BackdatedInput, string>> = {};
  const p = promoById(input.promo), d = findDriver(drivers, input.account);
  if (!p) errors.promo = "Выберите акцию.";
  else if (p.kind !== "money" && p.kind !== "auto") errors.promo = "Задним числом добавляют только в денежные акции.";
  if (!d) errors.account = "Водитель с таким ID не найден. Возьмите account_id из карточки водителя.";
  if (!input.since) errors.since = "Укажите дату, с которой водитель должен участвовать.";
  else if (input.since > now.slice(0, 10)) errors.since = "Дата участия не может быть в будущем.";
  if (input.reason.trim().length < 15) errors.reason = "Опишите, почему водителя не добавили вовремя (от 15 символов).";
  if (!input.files.length) errors.files = "Приложите скриншот переписки или другое подтверждение.";
  if (p && d && !errors.promo) {
    const problem = promoProblem(p, d);
    if (problem) errors.promo = problem;
    else if (activeIn(participants, d.account, p.id, now)) errors.account = `Водитель уже участвует в акции «${p.title}».`;
  }
  return errors;
}
/** The head answers in two minutes: a request older than 14 days is declined, the rest are confirmed. */
export function submitBackdated(input: BackdatedInput, d: TrainingDriver, author: string, now: string, id: number): Backdated {
  const late = (new Date(now).getTime() - new Date(input.since).getTime()) / DAY > 14;
  return {
    id, account: d.account, name: driverName(d), park: d.park, promo: input.promo, since: input.since, reason: input.reason.trim(), files: input.files, author, submittedAt: now,
    decideAt: new Date(new Date(now).getTime() + DECISION_AFTER).toISOString(), applied: false, approved: !late,
    answer: late ? "Отклонено: задним числом добавляют не позднее 14 дней с даты участия." : "Подтверждено руководителем: водитель добавлен в реестр участников.",
  };
}
export const backdatedStatus = (b: Backdated, now: string) => b.decideAt > now ? "На рассмотрении" : b.approved ? "Одобрена" : "Отклонена";
/** Confirmed requests put the driver into the registry from the requested date. */
export function settleBackdated(requests: Backdated[], participants: Participant[], drivers: TrainingDriver[], now: string, nextId: () => number) {
  const added: Participant[] = [];
  const settled = requests.map(b => {
    if (b.applied || b.decideAt > now) return b;
    const d = drivers.find(x => x.account === b.account), p = promoById(b.promo);
    if (b.approved && d && p && !activeIn([...participants, ...added], d.account, p.id, now)) {
      const row = participant(nextId(), d, p, b.author, now, "Задним числом", new Date(b.since).toISOString());
      // The registry checks the conditions from that date: trips over the last 30 days count.
      const done = Math.min(d.orders[2], p.target);
      added.push({ ...row, progress: done, status: done >= p.target ? "Условия выполнены" : done ? "Выполняет условия" : "Ожидает первой поездки", payout: p.kind === "auto" ? "auto" : done >= p.target ? "ready" : "waiting" });
    }
    return { ...b, applied: true };
  });
  return { requests: settled, added };
}

/** Fictional participants of the registry; a few are the training drivers themselves. */
export function seedParticipants(drivers: TrainingDriver[]): Participant[] {
  const byAccount = new Map(drivers.map(d => [d.account, d]));
  const names = ["Алибеков Ерасыл", "Жаксылыков Нурбол", "Каримова Асель", "Сейткали Мирас", "Утепова Жансая", "Бекмуханов Олжас", "Тулеуов Дамир", "Ермекова Аружан", "Кенжебаев Асхат", "Мусина Дана", "Сарсенов Ильяс", "Абилов Темирлан", "Нуртаева Камила", "Оспанов Бекзат", "Жумагали Санжар", "Ахметжанов Руслан", "Искакова Мадина", "Турсынбаев Ален", "Байжанов Арсен", "Садыкова Айжан"];
  const parks = ["iTaxi Алматы", "Ноль Такси Алматы", "Jana Taxi Тараз", "Адал Шымкент", "Global Шымкент", "iTaxi (Доставка) Алматы", "Tenge Taxi Астана"];
  const plan: [string, Participation, Payout, number, string][] = [
    ["fast-start", "Ожидает первой поездки", "waiting", 0, ""], ["fast-start", "Ожидает первой поездки", "waiting", 0, ""], ["fast-start", "Выполняет условия", "waiting", 12, ""],
    ["fast-start", "Условия выполнены", "ready", 20, ""], ["fast-start", "Условия выполнены", "ready", 23, ""], ["fast-start", "Условия выполнены", "review", 20, "Часть поездок отменена пассажиром — сверяет фин. отдел"],
    ["fast-start", "Не выполнено", "waiting", 14, "За 3 дня выполнено 14 из 20 поездок"], ["tenge-2000", "Завершено", "auto", 1, ""], ["tenge-2000", "Ожидает первой поездки", "auto", 0, ""],
    ["invite", "Выполняет условия", "waiting", 18, ""], ["invite", "Условия выполнены", "ready", 30, ""], ["invite", "Условия выполнены", "error", 31, "Карта пригласившего заблокирована банком"],
    ["invite", "Завершено", "paid", 34, ""], ["courier-week", "Выполняет условия", "waiting", 27, ""], ["courier-week", "Условия выполнены", "ready", 52, ""],
    ["courier-week", "Условия выполнены", "error", 50, "Ошибка платёжного шлюза, повторите начисление"], ["priority", "Выполняет условия", "none", 0, ""], ["no-commission", "Завершено", "none", 0, ""],
    ["fast-start", "Завершено", "paid", 21, ""], ["courier-week", "Не выполнено", "waiting", 31, "За 7 дней выполнено 31 из 50 доставок"],
  ];
  const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 8, day, hour, 15)).toISOString();
  const rows = plan.map(([promo, status, payout, progress, reason], i): Participant => {
    const p = promoById(promo)!, connectedAt = at(10 + (i * 7) % 18), paid = payout === "paid" || (payout === "auto" && status === "Завершено");
    const choice = parks[i % parks.length];
    const park = p.audience === "courier" ? "iTaxi (Доставка) Алматы" : p.parks && !p.parks.includes(choice) ? p.parks[0] : choice;
    const account = hex32(`promo-participant-${i}`);
    return {
      id: 1000 + i, account, name: names[i % names.length], park, inviter: promo === "invite" ? names[(i + 7) % names.length] : "", promo, connectedAt, until: addDays(connectedAt, p.days), progress, status, payout, reason,
      amount: paid ? p.amount : 0, paidAt: paid ? addDays(connectedAt, p.days) : "", before: p.kind === "condition" ? "Для всех 2%" : "", now: p.terms ?? "", after: p.kind === "condition" ? "Для всех 2%" : "",
      employee: ["Оператор Учебный", "Смагулова Инкар", "Автоначисление"][payout === "auto" ? 2 : i % 2], source: payout === "auto" ? "Автоматически" : p.kind === "condition" ? "Смена условий" : "CRM",
      history: [{ at: connectedAt, text: `Подключён к акции «${p.title}»` }],
    };
  });
  // Training drivers with a history of their own, so «Акции водителя» is not always empty.
  const own: [string, string, Participation, Payout, number][] = [["83057228", "invite", "Завершено", "paid", 36], ["57673c36", "fast-start", "Не выполнено", "waiting", 9], ["ce6fef80", "no-commission", "Завершено", "none", 0], ["19550946", "tenge-2000", "Завершено", "auto", 1]];
  own.forEach(([prefix, promo, status, payout, progress], i) => {
    const d = [...byAccount.values()].find(x => x.account.startsWith(prefix));
    if (!d) return;
    const p = promoById(promo)!, connectedAt = at(1 + i * 3);
    rows.push({ ...participant(1100 + i, d, p, "Смагулова Инкар", connectedAt, p.kind === "condition" ? "Смена условий" : payout === "auto" ? "Автоматически" : "CRM"),
      progress, status, payout, amount: payout === "paid" || payout === "auto" ? p.amount : 0, paidAt: payout === "paid" || payout === "auto" ? addDays(connectedAt, p.days) : "",
      reason: status === "Не выполнено" ? `За ${p.days} дня выполнено ${progress} из ${p.target} поездок` : "", before: p.kind === "condition" ? d.conditions : "", after: p.kind === "condition" ? d.conditions : "" });
  });
  return rows;
}
