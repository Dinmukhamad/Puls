import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ACCOUNT_SECTION, currentSection, currentTab, mobileNavigation, subsectionDestination, visibleNavigation } from "../navigation";
import { ROLE_LABELS } from "../utils/format";
import { GlassSurface } from "./GlassSurface";
import { ChevronLeftIcon, MenuIcon, PulsMark } from "./icons";
import { Sheet } from "./Sheet";
import { Avatar, IconButton } from "./ui";
import "./section-navigation.css";

const COLLAPSE_KEY = "puls.sidebar.collapsed";
function initialCollapsed(): boolean {
  try { const saved = localStorage.getItem(COLLAPSE_KEY); if (saved !== null) return saved === "1"; } catch { /* Optional preference. */ }
  return window.innerWidth < 1024;
}

export function AppLayout() {
  const { user } = useAuth(); const location = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [compactTabBar, setCompactTabBar] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId(); const lastScroll = useRef(0);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const items = user ? visibleNavigation(user.role) : [];
  const active = user ? currentSection(user.role, location.pathname, location.search) : undefined;
  const activeTab = active ? currentTab(active, location.pathname, location.search) : undefined;
  const { primary, overflow } = mobileNavigation(items);
  const separateProfile = !items.some((item) => item.id === "profile");
  const overflowActive = overflow.some((item) => item.id === active?.id) || (separateProfile && active?.id === "profile");

  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* Optional preference. */ } }, [collapsed]);
  useEffect(closeMenu, [location.pathname, location.search, closeMenu]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const change = (event: MediaQueryListEvent) => { if (event.matches) closeMenu(); };
    desktop.addEventListener("change", change); return () => desktop.removeEventListener("change", change);
  }, [closeMenu]);
  useEffect(() => {
    const onScroll = () => { const y = window.scrollY; if (Math.abs(y - lastScroll.current) < 8) return; setCompactTabBar(y > lastScroll.current && y > 60); lastScroll.current = y; };
    window.addEventListener("scroll", onScroll, { passive: true }); return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return <div className={collapsed ? "shell shell--collapsed" : "shell"}>
    <GlassSurface as="aside" variant="regular" className="sidebar">
      <div className="sidebar__brand"><span className="sidebar__mark"><PulsMark /></span><span className="sidebar__name">Puls</span><IconButton label={collapsed ? "Развернуть меню" : "Свернуть меню"} className="sidebar__toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><ChevronLeftIcon size={18} /></IconButton></div>
      <nav className="sidebar__nav" aria-label="Основные разделы">
        {items.map((item) => <Link key={item.id} to={item.to} className={active?.id === item.id ? "nav-item is-active" : "nav-item"} aria-current={active?.id === item.id ? "page" : undefined} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}><span className="nav-item__icon"><item.icon size={20} /></span><span className="nav-item__label">{item.label}</span></Link>)}
      </nav>
      {user && <Link to="/profile" className="sidebar__user" aria-label={`Профиль: ${user.full_name}`}><Avatar name={user.full_name} id={user.id} size={36} /><span className="sidebar__user-text"><span className="sidebar__user-name">{user.full_name}</span><span className="sidebar__user-role">{ROLE_LABELS[user.role]}{user.group ? ` · ${user.group.name}` : ""}</span></span></Link>}
    </GlassSurface>

    <main className="main"><div className="main__inner">
      {active && <div className="section-navigation"><p className="section-navigation__title">{active.label}</p>{active.tabs.length > 1 && <nav className="section-navigation__tabs" aria-label={`Подразделы: ${active.label}`}>{active.tabs.map((item) => <Link key={item.to} to={subsectionDestination(item, location.pathname, location.search)} className={activeTab?.to === item.to ? "section-navigation__tab is-active" : "section-navigation__tab"} aria-current={activeTab?.to === item.to ? "page" : undefined}>{item.label}</Link>)}</nav>}</div>}
      <Outlet />
    </div></main>

    <GlassSurface as="nav" variant="prominent" className={compactTabBar ? "tabbar tabbar--compact" : "tabbar"} aria-label="Основные разделы, мобильное меню">
      {primary.map((item) => <Link key={item.id} to={item.to} aria-label={item.label} aria-current={active?.id === item.id ? "page" : undefined} className={active?.id === item.id ? "tab is-active" : "tab"}><span className="tab__icon"><item.icon size={22} /></span><span className="tab__label">{item.label}</span></Link>)}
      {overflow.length > 0 && <button type="button" className={menuOpen || overflowActive ? "tab is-active" : "tab"} aria-label="Ещё разделы" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} onClick={() => setMenuOpen(true)}><span className="tab__icon"><MenuIcon size={22} /></span><span className="tab__label">Ещё</span></button>}
    </GlassSurface>
    {menuOpen && <Sheet id={menuId} title="Разделы Puls" onClose={closeMenu} size="s"><nav className="mobile-menu" aria-label="Все основные разделы">{items.map((item) => <Link key={item.id} to={item.to} className={active?.id === item.id ? "nav-item is-active" : "nav-item"} aria-current={active?.id === item.id ? "page" : undefined} onClick={closeMenu}><span className="nav-item__icon"><item.icon size={20} /></span><span>{item.label}</span></Link>)}</nav>{separateProfile && <Link to={ACCOUNT_SECTION.to} className="section-navigation__account" onClick={closeMenu}>{user && <Avatar name={user.full_name} id={user.id} size={32} />}<span>Мой профиль, настройки и устройства</span></Link>}</Sheet>}
  </div>;
}
