import type { ReactNode } from "react";

import type { Role } from "./api/types";
import {
  HomeIcon,
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

export const NAVIGATION: readonly NavItem[] = [
  { to: "/cabinet", label: "Главная", icon: HomeIcon, mobilePrimary: true, section: "Главное" },
  { to: "/rating", label: "Рейтинг", icon: TrophyIcon, mobilePrimary: true, section: "Главное" },
  { to: "/shop", label: "Магазин", icon: StoreIcon, mobilePrimary: true, section: "Главное" },
  { to: "/progress", label: "Опыт и уровни", icon: TrophyIcon, section: "Главное" },
  { to: "/training", label: "Обучение", icon: TrophyIcon, section: "Развитие" },
  { to: "/games", label: "Колесо и розыгрыши", icon: SparkIcon, section: "Игры" },
  { to: "/admin/games", label: "Управление играми", icon: InboxIcon, minRole: "supervisor", section: "Игры" },
  { to: "/admin/learning", label: "Студия обучения", icon: InboxIcon, minRole: "supervisor", section: "Развитие" },
  { to: "/notifications", label: "Уведомления", icon: InboxIcon, section: "Аккаунт" },
  { to: "/admin/summary", label: "Сводка", icon: HomeIcon, minRole: "supervisor", section: "Работа" },
  { to: "/analytics", label: "Аналитика", icon: TrophyIcon, minRole: "supervisor", section: "Работа" },
  { to: "/admin/xp", label: "Начисления XP", icon: TrophyIcon, minRole: "supervisor", section: "Работа" },
  { to: "/admin/levels", label: "Уровни XP", icon: TrophyIcon, minRole: "supervisor", section: "Система" },
  { to: "/admin/settings", label: "Настройки", icon: InboxIcon, minRole: "supervisor", section: "Система" },
  { to: "/admin/store", label: "Каталог магазина", icon: StoreIcon, minRole: "supervisor", section: "Работа" },
  { to: "/admin/users", label: "Пользователи", icon: UsersIcon, minRole: "supervisor", section: "Команда" },
  { to: "/admin/groups", label: "Группы", icon: UsersIcon, minRole: "supervisor", section: "Команда" },
  { to: "/admin/periods", label: "Расчёт периода", icon: InboxIcon, minRole: "supervisor", section: "Работа" },
  { to: "/admin/sessions", label: "Сессии", icon: UserIcon, minRole: "admin", section: "Система" },
  { to: "/admin/audit", label: "Аудит", icon: InboxIcon, minRole: "admin", section: "Система" },
  { to: "/sessions", label: "Мои устройства", icon: UserIcon, section: "Аккаунт" },
  {
    to: "/admin/operators",
    label: "Операторы",
    icon: UsersIcon,
    minRole: "supervisor",
    section: "Команда",
  },
  {
    to: "/admin/requests",
    label: "Заявки",
    icon: InboxIcon,
    minRole: "supervisor",
    section: "Команда",
  },
  { to: "/profile", label: "Профиль", icon: UserIcon, mobilePrimary: true, section: "Аккаунт" },
];

export function visibleNavigation(role: Role, atLeast: (minimum: Role) => boolean): NavItem[] {
  return NAVIGATION.filter(
    (item) => (!item.minRole || atLeast(item.minRole)) && (!item.roles || item.roles.includes(role)),
  );
}
