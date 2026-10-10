import { REQUEST_STATUS_LABELS, ROLE_LABELS, TX_LABELS, WEEK_STATUS_LABELS } from "../utils/format";

export const AUDIT_ACTIONS: Record<string, string> = {
  "auth.login": "Вход в систему", "auth.logout": "Выход из системы",
  "user.create": "Создан сотрудник", "user.update": "Изменён сотрудник",
  "user.login_reset": "Изменён логин сотрудника", "user.login_change": "Изменён логин",
  "user.password_reset": "Сброшен пароль", "user.password_change": "Изменён пароль",
  "group.create": "Создана команда", "group.update": "Изменена команда",
  "supervisor_team.assign": "Операторы назначены супервайзеру",
  "supervisor_team.remove": "Операторы сняты из команды",
  "supervisor_team.repair": "Исправлены назначения прежних команд",
  "week.create": "Открыта неделя", "week.metrics_upload": "Загружены показатели недели",
  "week.recalculate": "Подготовлен расчёт", "week.close": "Опубликованы итоги",
  "week.close_previous": "Закрыта прошлая неделя", "session.revoke": "Завершён сеанс",
  "session.revoke_others": "Завершены остальные сеансы",
  "day.metrics_upload": "Загружены показатели по дням", "day.reports_upload": "Загружены месячные отчёты",
  "access.update": "Изменён доступ к разделам", "work_sites.approve": "Открыт доступ к рабочим сайтам",
  "rules.update": "Изменены правила начисления", "coins.manual": "Выполнена операция с коинами",
  "metric.create": "Добавлен показатель", "metric.update": "Изменён показатель",
  "nomination.create": "Добавлена номинация", "nomination.update": "Изменена номинация",
  "badge.create": "Добавлено достижение", "badge.update": "Изменено достижение",
  "shop_item.create": "Добавлен бонус магазина", "shop_item.update": "Изменён бонус магазина",
  "shop_item.disable": "Бонус магазина убран из каталога",
  "progress.level_update": "Изменён уровень", "learning.save": "Сохранён учебный материал",
  "learning.assign": "Назначено обучение", "driver.scenario.save": "Изменён сценарий автопарка",
  "driver.parks.save": "Изменены учебные парки", "wheel.configure": "Изменены правила колеса",
  "raffle.save": "Сохранён розыгрыш", "raffle.draw": "Определён победитель розыгрыша",
  "telegram.connect": "Подключён Telegram", "telegram.disconnect": "Отключён Telegram",
  "city.configure": "Изменены задания города", "city.world": "Изменены города и районы",
  "city.economy": "Изменены правила застройки", "city.situations": "Изменены задания по ситуациям",
  "city.quest": "Пройдено задание по ситуации", "city.build": "Построено здание",
  "city.claim": "Получена награда за миссию", "city.estate.purchase": "Куплено здание в районе",
  "city.estate.upgrade": "Улучшено здание", "city.estate.merge": "Объединены постройки",
  "city.project.open": "Начат общий проект", "city.project.built": "Завершён общий проект",
  "city.project.cancel": "Отменён общий проект", "scenario.reward": "Начислена награда за сценарий",
};

const entities: Record<string, string> = {
  user: "Сотрудник", group: "Команда", supervisor_team: "Команда супервайзера", session: "Вход и сеансы",
  contest_week: "Отчётный период", operator_day_metrics: "Показатели сотрудников", access_policy: "Доступ к разделам",
  gamification_settings: "Правила начисления", metric: "Рабочий показатель", nomination: "Номинация",
  badge: "Достижение", shop_item: "Бонус магазина", progress_level: "Уровень", learning_content: "Учебный материал",
  driver_settings: "Учебный автопарк", wheel: "Колесо WOW", raffle: "Розыгрыш", city_world: "Города и районы",
  city_economy: "Правила застройки", city_settings: "Задания города", city_situations: "Учебные ситуации",
  city_quest: "Задание по ситуации", city_object: "Здание района", city_plot: "Участок района",
  city_project: "Общий проект", city_mission: "Миссия города", scenario_attempt: "Учебный сценарий",
};
function known<T>(values: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}
export const auditActionLabel = (action: string): string => known(AUDIT_ACTIONS, action) ?? "Действие зарегистрировано";
export const auditEntityLabel = (entity: string): string => known(entities, entity) ?? "Данные Puls";

const textFields: Record<string, string> = {
  full_name: "ФИО", name: "Название", title: "Название", description: "Описание", reason: "Причина",
  comment: "Комментарий", email: "Email", phone: "Телефон", login: "Логин", telegram_username: "Telegram",
  hired_on: "Дата приёма", from: "Было", to: "Стало", month: "Месяц", deadline: "Срок", prize: "Приз",
  guide_name: "Имя помощника", unit: "Единица измерения",
};
const numberFields: Record<string, string> = {
  created: "Создано значений", updated: "Обновлено значений", participants: "Участников", coins_awarded: "Начислено коинов",
  amount: "Количество", price: "Цена", coins: "Коины", coins_reward: "Награда в коинах", score: "Баллы",
  balance: "Баланс", balance_after: "Баланс после операции", available: "Доступно коинов", total: "Всего",
  xp: "Опыт", rank: "Место", target: "Цель", max_points: "Максимум баллов", weight: "Вес", min_coins: "Порог коинов",
  level: "Уровень", hq_level: "Уровень главного здания", cost: "Стоимость", refunded: "Возвращено коинов",
  changed_count: "Операторов переведено", updated_groups: "Команд обновлено", reconciled_operators: "Операторов проверено",
  operators: "Операторов", days: "Дней", minutes: "Продолжительность в минутах", pass_percent: "Порог прохождения, %",
  daily_spins: "Попыток в день", count: "Количество", points_per_coin: "Баллов за один коин",
  rank1_bonus: "Бонус за первое место", rank2_bonus: "Бонус за второе место", rank3_bonus: "Бонус за третье место",
  no_lateness_bonus: "Бонус без опозданий", no_forbidden_sites_bonus: "Бонус без посторонних сайтов",
  nomination_bonus_default: "Бонус за номинацию", driver_gratitude_bonus: "Бонус за благодарность водителя",
  manual_max_abs_amount: "Лимит операции с коинами", manual_reason_min_length: "Минимальная длина причины",
  nomination_min_participants: "Минимум участников для номинации",
  weeks: "Недель подряд", max_rank: "Место не ниже", gte: "Порог",
  stock_limit: "Общий лимит выдач", per_user_monthly_limit: "Лимит выдач на сотрудника в месяц",
  min_value: "Минимальное значение", sort_order: "Порядок отображения", employment_rate: "Ставка",
};
const booleanFields: Record<string, string> = {
  is_active: "Активен", enabled: "Доступно", replace: "Замена показателей", correct: "Ответ верный",
  requires_approval: "Требуется одобрение", discipline_requires_reported: "Бонусы только по загруженным показателям",
  rating_show_balance_to_operators: "Показывать баланс коллег в рейтинге",
};
const enumFields: Record<string, { label: string; values: Record<string, string> }> = {
  role: { label: "Роль", values: ROLE_LABELS },
  gender: { label: "Пол", values: { male: "Мужской", female: "Женский" } },
  status: { label: "Статус", values: { ...REQUEST_STATUS_LABELS, ...WEEK_STATUS_LABELS, draft: "Черновик", published: "Опубликован" } },
  tx_type: { label: "Операция", values: TX_LABELS },
  direction: { label: "Направление", values: { higher_is_better: "Больше — лучше", lower_is_better: "Меньше — лучше" } },
  kind: { label: "Тип", values: { positive: "Основной показатель", anti: "Нарушение", test: "Тест", simulator: "Симулятор", dialogue: "Диалог" } },
};
const containers: Record<string, string> = { before: "Было", after: "Стало", rule_params: "Условия" };
export interface AuditChange { label: string; value: string }

/** Audit storage remains complete; business screens show only understood, useful fields. */
export function auditBusinessChanges(changes: unknown): AuditChange[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.entries(changes).flatMap(([key, value]): AuditChange[] => {
    const container = known(containers, key);
    if (container) {
      const items = (Array.isArray(value) ? value : [value]).flatMap(auditBusinessChanges);
      return items.length ? [{ label: container, value: items.map(item => `${item.label}: ${item.value}`).join("; ") }] : [];
    }
    const text = known(textFields, key), number = known(numberFields, key), boolean = known(booleanFields, key), enumeration = known(enumFields, key);
    const label = text ?? number ?? boolean ?? enumeration?.label;
    if (!label) return [];
    if (value === null || value === undefined) return [{ label, value: "—" }];
    if (text && typeof value === "string") return [{ label, value }];
    if (number && typeof value === "number" && Number.isFinite(value)) return [{ label, value: value.toLocaleString("ru-RU") }];
    if (boolean && typeof value === "boolean") return [{ label, value: value ? "Да" : "Нет" }];
    const mapped = typeof value === "string" && enumeration ? known(enumeration.values, value) : undefined;
    return mapped ? [{ label, value: mapped }] : [];
  });
}
