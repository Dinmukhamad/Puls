import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "./GlassSurface";
import {
  ChevronLeftIcon,
  HomeIcon,
  InboxIcon,
  PulsMark,
  StoreIcon,
  TrophyIcon,
  UserIcon,
  UsersIcon,
} from "./icons";
import { Avatar, IconButton } from "./ui";
import { ROLE_LABELS } from "../utils/format";

interface NavItem {
  to: string;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
  /** Пункт нижней навигации на телефоне. Их не больше пяти. */
  inTabBar?: boolean;
  staffOnly?: boolean;
  section?: string;
}

const NAV: NavItem[] = [
  { to: "/cabinet", label: "Главная", icon: HomeIcon, inTabBar: true, section: "Главное" },
  { to: "/rating", label: "Рейтинг", icon: TrophyIcon, inTabBar: true, section: "Главное" },
  { to: "/shop", label: "Магазин", icon: StoreIcon, inTabBar: true, section: "Главное" },
  {
    to: "/admin/operators",
    label: "Операторы",
    icon: UsersIcon,
    staffOnly: true,
    section: "Команда",
  },
  {
    to: "/admin/requests",
    label: "Заявки",
    icon: InboxIcon,
    staffOnly: true,
    section: "Команда",
  },
  { to: "/profile", label: "Профиль", icon: UserIcon, inTabBar: true, section: "Аккаунт" },
];

const COLLAPSE_KEY = "puls.sidebar.collapsed";
/** Ниже этой ширины сайдбар по умолчанию свёрнут, но развернуть его можно. */
const AUTO_COLLAPSE_WIDTH = 1024;

function initialCollapsed(): boolean {
  const saved = localStorage.getItem(COLLAPSE_KEY);
  if (saved !== null) return saved === "1";
  return window.innerWidth < AUTO_COLLAPSE_WIDTH;
}

export function AppLayout() {
  const { user, atLeast } = useAuth();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [compactTabBar, setCompactTabBar] = useState(false);
  const lastScroll = useRef(0);

  const items = NAV.filter((item) => !item.staffOnly || atLeast("supervisor"));
  const tabItems = items.filter((item) => item.inTabBar || item.staffOnly).slice(0, 5);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Прокрутка вниз ужимает нижнюю панель, вверх - возвращает.
  useEffect(() => {
    function onScroll() {
      const current = window.scrollY;
      if (Math.abs(current - lastScroll.current) < 8) return;
      setCompactTabBar(current > lastScroll.current && current > 60);
      lastScroll.current = current;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const sections = Array.from(new Set(items.map((item) => item.section)));

  return (
    <div className={collapsed ? "shell shell--collapsed" : "shell"}>
      <GlassSurface as="aside" variant="regular" className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__mark">
            <PulsMark />
          </span>
          <span className="sidebar__name">Puls</span>
          <IconButton
            label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            className="sidebar__toggle"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronLeftIcon size={18} />
          </IconButton>
        </div>

        <nav className="sidebar__nav">
          {sections.map((section) => (
            <div className="sidebar__section" key={section}>
              <span className="sidebar__section-title">{section}</span>
              {items
                .filter((item) => item.section === section)
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      isActive ? "nav-item is-active" : "nav-item"
                    }
                    // В свёрнутом виде остаётся только иконка, поэтому название
                    // уходит в подсказку и в доступное имя ссылки.
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? item.label : undefined}
                  >
                    <span className="nav-item__icon">
                      <item.icon size={20} />
                    </span>
                    <span className="nav-item__label">{item.label}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>

        {user && (
          <NavLink to="/profile" className="sidebar__user">
            <Avatar name={user.full_name} id={user.id} size={36} />
            <span className="sidebar__user-text">
              <span className="sidebar__user-name">{user.full_name}</span>
              <span className="sidebar__user-role">
                {ROLE_LABELS[user.role]}
                {user.group ? ` · ${user.group.name}` : ""}
              </span>
            </span>
          </NavLink>
        )}
      </GlassSurface>

      <main className="main">
        <div className="main__inner">
          <Outlet />
        </div>
      </main>

      <GlassSurface
        as="nav"
        variant="prominent"
        className={compactTabBar ? "tabbar tabbar--compact" : "tabbar"}
      >
        {tabItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "tab is-active" : "tab")}
          >
            <span className="tab__icon">
              <item.icon size={22} />
            </span>
            <span className="tab__label">{item.label}</span>
          </NavLink>
        ))}
      </GlassSurface>
    </div>
  );
}
