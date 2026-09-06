import type { ReactNode } from "react";

import type { Role } from "./api/types";
import {
  HomeIcon,
  CoinIcon,
  SparkIcon,
  InboxIcon,
  StoreIcon,
  TrophyIcon,
  UserIcon,
  UsersIcon,
} from "./components/icons";

/** Add a destination here only after its route and permission guard exist. */
export interface NavItem {
  to: string;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
  section: string;
  minRole?: Role;
  /** Optional exact-role restriction, in addition to the minimum role. */
  roles?: readonly Role[];
  /** Up to four primary destinations precede the mobile overflow menu. */
  mobilePrimary?: boolean;
}

/*
 * Четыре раздела вместо семи, сгруппированные по адресату, а не по теме:
 * что оператор делает для себя, что относится к его аккаунту, что руководитель
 * делает по команде и что настраивается один раз.
 *
 * Несколько страниц работают в двух режимах - личном и командном. Это разные
 * области данных, а не дубли, поэтому они разведены по разделам и названы так,
 * чтобы различие читалось из самого пункта: «Кошелёк» и «Коины команды»,
 * «Мои устройства» и «Сессии сотрудников».
 *
 * Порядок в массиве задаёт порядок разделов в меню.
 */
export const NAVIGATION: readonly NavItem[] = [
  // --- Главное: ежедневные действия оператора ---
  { to: "/cabinet", label: "Главная", icon: HomeIcon, mobilePrimary: true, section: "Главное" },
  { to: "/rating", label: "Рейтинг", icon: TrophyIcon, mobilePrimary: true, section: "Главное" },
  { to: "/training", label: "Обучение", icon: SparkIcon, section: "Главное" },
  { to: "/shop", label: "Магазин", icon: StoreIcon, mobilePrimary: true, section: "Главное" },
  { to: "/games", label: "Моменты WOW", icon: SparkIcon, section: "Главное" },

  // --- Мой профиль: всё про собственный аккаунт ---
  { to: "/wallet", label: "Мой кошелёк", icon: CoinIcon, section: "Мой профиль" },
  { to: "/progress", label: "Опыт и уровни", icon: TrophyIcon, section: "Мой профиль" },
  { to: "/notifications", label: "Уведомления", icon: InboxIcon, section: "Мой профиль" },
  { to: "/sessions", label: "Мои устройства", icon: UserIcon, section: "Мой профиль" },
  { to: "/profile", label: "Профиль", icon: UserIcon, mobilePrimary: true, section: "Мой профиль" },

  // --- Команда: ежедневная работа руководителя ---
  { to: "/admin/summary", label: "Сводка", icon: HomeIcon, minRole: "supervisor", section: "Команда" },
  { to: "/analytics", label: "Аналитика", icon: TrophyIcon, minRole: "supervisor", section: "Команда" },
  {
    to: "/admin/operators",
    label: "Показатели недели",
    icon: UsersIcon,
    minRole: "supervisor",
    section: "Команда",
  },
  {
    to: "/admin/requests",
    label: "Заявки из магазина",
    icon: InboxIcon,
    minRole: "supervisor",
    section: "Команда",
  },
  { to: "/admin/wallet", label: "Коины команды", icon: CoinIcon, minRole: "supervisor", section: "Команда" },
  { to: "/admin/xp", label: "Опыт сотрудников", icon: TrophyIcon, minRole: "supervisor", section: "Команда" },
  { to: "/admin/users", label: "Сотрудники", icon: UsersIcon, minRole: "supervisor", section: "Команда" },
  { to: "/admin/groups", label: "Группы", icon: UsersIcon, minRole: "supervisor", section: "Команда" },
  { to: "/admin/periods", label: "Расчёт периода", icon: InboxIcon, minRole: "supervisor", section: "Команда" },

  // --- Настройка: то, что задаётся один раз и редко меняется ---
  { to: "/admin/store", label: "Каталог магазина", icon: StoreIcon, minRole: "supervisor", section: "Настройка" },
  {
    to: "/admin/learning",
    label: "Студия обучения",
    icon: SparkIcon,
    minRole: "supervisor",
    section: "Настройка",
  },
  { to: "/admin/levels", label: "Уровни XP", icon: TrophyIcon, minRole: "supervisor", section: "Настройка" },
  { to: "/admin/settings", label: "Настройки", icon: InboxIcon, minRole: "supervisor", section: "Настройка" },
  {
    to: "/admin/sessions",
    label: "Сессии сотрудников",
    icon: UserIcon,
    minRole: "admin",
    section: "Настройка",
  },
  { to: "/admin/audit", label: "Аудит", icon: InboxIcon, minRole: "admin", section: "Настройка" },
];

export function visibleNavigation(role: Role, atLeast: (minimum: Role) => boolean): NavItem[] {
  return NAVIGATION.filter(
    (item) => (!item.minRole || atLeast(item.minRole)) && (!item.roles || item.roles.includes(role)),
  );
}
