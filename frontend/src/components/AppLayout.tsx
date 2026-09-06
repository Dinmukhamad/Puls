import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { GlassSurface } from "./GlassSurface";
import { ChevronLeftIcon, MenuIcon, PulsMark } from "./icons";
import { Sheet } from "./Sheet";
import { Avatar, IconButton } from "./ui";
import { ROLE_LABELS } from "../utils/format";
import { visibleNavigation } from "../navigation";

const COLLAPSE_KEY = "puls.sidebar.collapsed";
/** Ниже этой ширины сайдбар по умолчанию свёрнут, но развернуть его можно. */
const AUTO_COLLAPSE_WIDTH = 1024;

function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // The layout remains usable when storage is unavailable.
  }
  return window.innerWidth < AUTO_COLLAPSE_WIDTH;
}

export function AppLayout() {
  const { user, atLeast } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [compactTabBar, setCompactTabBar] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const lastScroll = useRef(0);

  const items = user ? visibleNavigation(user.role, atLeast) : [];
  const tabItems = items.filter((item) => item.mobilePrimary).slice(0, 4);
  const overflowItems = items.filter((item) => !tabItems.includes(item));
  const overflowActive = overflowItems.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  );

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Persisting the preference is optional.
    }
  }, [collapsed]);

  useEffect(closeMenu, [location.pathname, location.search, closeMenu]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) closeMenu();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [closeMenu]);

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

        <nav className="sidebar__nav" aria-label="Основная навигация">
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
          <NavLink to="/profile" className="sidebar__user" aria-label={`Профиль: ${user.full_name}`}>
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
            aria-label={item.label}
            className={({ isActive }) => (isActive ? "tab is-active" : "tab")}
          >
            <span className="tab__icon">
              <item.icon size={22} />
            </span>
            <span className="tab__label">{item.label}</span>
          </NavLink>
        ))}
        {overflowItems.length > 0 && (
          <button
            type="button"
            className={menuOpen || overflowActive ? "tab is-active" : "tab"}
            aria-label="Ещё разделы"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen(true)}
          >
            <span className="tab__icon"><MenuIcon size={22} /></span>
            <span className="tab__label">Ещё</span>
          </button>
        )}
      </GlassSurface>
      {menuOpen && (
        <Sheet id={menuId} title="Разделы Puls" onClose={closeMenu} size="s">
          <nav className="mobile-menu" aria-label="Все разделы">
            {sections.map((section) => (
              <section className="mobile-menu__section" key={section}>
                <h3 className="mobile-menu__heading">{section}</h3>
                {items.filter((item) => item.section === section).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => isActive ? "nav-item is-active" : "nav-item"}
                    onClick={closeMenu}
                  >
                    <span className="nav-item__icon"><item.icon size={20} /></span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </section>
            ))}
          </nav>
        </Sheet>
      )}
    </div>
  );
}
