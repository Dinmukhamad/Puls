import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../utils/format";

interface NavItem {
  to: string;
  label: string;
  staffOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/cabinet", label: "Мой кабинет" },
  { to: "/rating", label: "Рейтинг" },
  { to: "/shop", label: "Магазин" },
  { to: "/admin/operators", label: "Операторы", staffOnly: true },
  { to: "/admin/requests", label: "Заявки", staffOnly: true },
];

export function AppLayout() {
  const { user, logout, atLeast } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = NAV.filter((item) => !item.staffOnly || atLeast("supervisor"));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <span className="topbar__mark" aria-hidden="true">
              ◆
            </span>
            Pulse
          </div>

          <button
            type="button"
            className="topbar__burger"
            aria-expanded={menuOpen}
            aria-label="Меню"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ☰
          </button>

          <nav className={menuOpen ? "nav nav--open" : "nav"}>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? "nav__link nav__link--active" : "nav__link")}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar__user">
            <div className="topbar__identity">
              <span className="topbar__name">{user?.full_name}</span>
              <span className="topbar__role">
                {user ? ROLE_LABELS[user.role] : ""}
                {user?.group ? ` · ${user.group.name}` : ""}
              </span>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
