import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigationType } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useAccess } from "../auth/AccessContext";
import { useSidebarPeek } from "../hooks/useSidebarPeek";
import { SectionGuard } from "./SectionGuard";
import { ACCOUNT_SECTION, currentSection, currentTab, mobileNavigation, subsectionDestination, visibleNavigation } from "../navigation";
import { AccountMenu } from "./AccountMenu";
import { GlassSurface } from "./GlassSurface";
import { ChevronLeftIcon, LogoutIcon, MenuIcon, PulsMark } from "./icons";
import { Sheet } from "./Sheet";
import { Avatar, Button, IconButton } from "./ui";
import { SiteTourProvider } from "../tour/SiteTour";
import "./section-navigation.css";

const COLLAPSE_KEY = "puls.sidebar.collapsed";
function initialCollapsed(): boolean {
  try { const saved = localStorage.getItem(COLLAPSE_KEY); if (saved !== null) return saved === "1"; } catch { /* Optional preference. */ }
  return window.innerWidth < 1024;
}

export function AppLayout() {
  const { user, logout } = useAuth(); const location = useLocation(); const navigationType = useNavigationType();
  // Новый раздел открывается с начала страницы, а не там, где прокрутили прошлый.
  // «Назад» (POP) возвращает к прежнему месту сам браузер.
  useLayoutEffect(() => { if (navigationType !== "POP") window.scrollTo(0, 0); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const { allowed, isDeveloper } = useAccess();
  // Keep the active subsection visible in the scrollable tab strip on phones.
  useEffect(() => { document.querySelector(".section-navigation__tab.is-active")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [location.pathname]);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const peek = useSidebarPeek(collapsed);
  const [compactTabBar, setCompactTabBar] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const menuId = useId(); const lastScroll = useRef(0);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const items = user ? visibleNavigation(user.role, allowed, isDeveloper, user.channel) : [];
  const active = user ? currentSection(user.role, location.pathname, location.search, allowed, isDeveloper, user.channel) : undefined;
  const activeTab = active ? currentTab(active, location.pathname, location.search) : undefined;
  // Вкладка браузера и история называют открытый раздел, а не одно «Puls» на всех страницах.
  const pageTitle = activeTab?.label ?? active?.label;
  useEffect(() => { document.title = pageTitle ? `${pageTitle} — Puls` : "Puls"; return () => { document.title = "Puls"; }; }, [pageTitle]);
  const { primary, overflow } = mobileNavigation(items);
  const separateProfile = !items.some((item) => item.id === "profile");
  // «Мой город» занимает весь экран: меню сжимается до плавающих карточек поверх карты. У стажёра это его учебный город.
  const immersive = location.pathname === "/training/city";
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

  const userLink = user && <AccountMenu />;

  // Pulsar's tour of the site (tour/siteTour.ts) finds the menu by its `data-tour` markers.
  return <SiteTourProvider><div className={`shell${collapsed ? " shell--collapsed" : ""}${peek.open ? " shell--peek" : ""}${immersive ? " shell--immersive" : ""}`} data-sections={items.map((item) => item.id).join(" ")}>
    <GlassSurface as="aside" variant="regular" className="sidebar" aria-label="Боковое меню" {...peek.handlers}>
      <div className="sidebar__brand"><span className="sidebar__mark"><PulsMark /></span><span className="sidebar__name">Puls</span><IconButton label={!collapsed ? "Свернуть меню" : peek.open ? "Закрепить меню" : "Развернуть меню"} className="sidebar__toggle" aria-expanded={!collapsed} onClick={() => { setCollapsed((value) => !value); peek.settle(); }}><ChevronLeftIcon size={18} /></IconButton></div>
      <nav className="sidebar__nav" aria-label="Основные разделы" data-tour="nav">
        {items.map((item) => <Link key={item.id} to={item.to} data-tour={`nav-${item.id}`} className={active?.id === item.id ? "nav-item is-active" : "nav-item"} aria-current={active?.id === item.id ? "page" : undefined} aria-label={collapsed ? item.label : undefined}><span className="nav-item__icon"><item.icon size={20} /></span><span className="nav-item__label">{item.label}</span></Link>)}
      </nav>
      {!immersive && userLink}
    </GlassSurface>
    {immersive && userLink && <GlassSurface variant="regular" className="sidebar-user-card" {...peek.handlers}>{userLink}</GlassSurface>}

    <main className="main"><div className={`main__inner${location.pathname === "/profile" ? " main__inner--profile" : ""}`}>
      {/* A section label alone above the page title only repeats it, so it comes with the tabs. */}
      {active && !immersive && active.tabs.length > 1 && <div className="section-navigation"><p className="section-navigation__title">{active.label}</p><nav className="section-navigation__tabs" aria-label={`Подразделы: ${active.label}`}>{active.tabs.map((item) => <Link key={item.to} to={subsectionDestination(item, location.pathname, location.search)} data-tour={`tab-${item.to.split(/[?#]/)[0].slice(1)}`} className={activeTab?.to === item.to ? "section-navigation__tab is-active" : "section-navigation__tab"} aria-current={activeTab?.to === item.to ? "page" : undefined}>{item.label}</Link>)}</nav></div>}
      <SectionGuard><Outlet /></SectionGuard>
    </div></main>

    <GlassSurface as="nav" variant="prominent" className={compactTabBar ? "tabbar tabbar--compact" : "tabbar"} aria-label="Основные разделы, мобильное меню" data-tour="nav">
      {primary.map((item) => <Link key={item.id} to={item.to} data-tour={`nav-${item.id}`} aria-label={item.label} aria-current={active?.id === item.id ? "page" : undefined} className={active?.id === item.id ? "tab is-active" : "tab"}><span className="tab__icon"><item.icon size={22} /></span><span className="tab__label">{item.label}</span></Link>)}
      {overflow.length > 0 && <button type="button" data-tour="nav-more" data-sections={[...overflow.map(item => item.id), "profile"].join(" ")} className={menuOpen || overflowActive ? "tab is-active" : "tab"} aria-label="Ещё разделы" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} onClick={() => setMenuOpen(true)}><span className="tab__icon"><MenuIcon size={22} /></span><span className="tab__label">Ещё</span></button>}
    </GlassSurface>
    {menuOpen && <Sheet id={menuId} title="Разделы Puls" onClose={closeMenu} size="s"><nav className="mobile-menu" aria-label="Все основные разделы">{items.filter(item => item.id !== "profile").map((item) => <Link key={item.id} to={item.to} data-tour={`nav-${item.id}`} className={active?.id === item.id ? "nav-item is-active" : "nav-item"} aria-current={active?.id === item.id ? "page" : undefined} onClick={closeMenu}><span className="nav-item__icon"><item.icon size={20} /></span><span>{item.label}</span></Link>)}</nav><div className="mobile-account"><Link to={ACCOUNT_SECTION.to} data-tour="nav-profile" className="mobile-account__profile" aria-current={location.pathname === "/profile" ? "page" : undefined} onClick={closeMenu}>{user && <Avatar name={user.full_name} id={user.id} size={36} />}<span><strong>{user?.full_name}</strong><small>Профиль и настройки</small></span></Link><Button block size="s" variant="destructive" icon={<LogoutIcon size={16} />} disabled={leaving} onClick={() => { setLeaving(true); void logout(); }}>{leaving ? "Выходим…" : "Выйти из аккаунта"}</Button></div></Sheet>}

  </div></SiteTourProvider>;
}
