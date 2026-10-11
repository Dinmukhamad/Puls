import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../utils/format";
import { Avatar, Button } from "./ui";
import { ChevronRightIcon, LockIcon, LogoutIcon, TelegramIcon, UserIcon } from "./icons";
import "./account-menu.css";

/** A click/keyboard account menu, also usable when the sidebar is collapsed. */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => setOpen(false), [location.pathname, location.search, location.hash]);
  useLayoutEffect(() => {
    const node = panel.current;
    const button = trigger.current;
    if (!open || !node || !button) return;
    // Top layer prevents clipping by the glass sidebar; fixed positioning is a fallback.
    if (typeof node.showPopover === "function") {
      node.setAttribute("popover", "manual");
      node.showPopover();
    }
    function position() {
      if (!node || !button) return;
      if (!button.getClientRects().length) { setOpen(false); return; }
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      node.style.width = `${Math.min(320, width - 24)}px`;
      node.style.maxHeight = `${height - 24}px`;
      node.style.left = `${Math.max(left + 12, Math.min(rect.right + 12, left + width - node.offsetWidth - 12))}px`;
      node.style.top = `${Math.max(top + 12, Math.min(rect.bottom - node.offsetHeight, top + height - node.offsetHeight - 12))}px`;
    }
    position();
    node.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      if (typeof node.hidePopover === "function" && node.matches(":popover-open")) node.hidePopover();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (!user) return null;

  return <>
    <button type="button" ref={trigger} className="sidebar__user account-trigger" aria-label={`Меню аккаунта: ${user.full_name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <Avatar name={user.full_name} id={user.id} size={36} /><span className="sidebar__user-text"><span className="sidebar__user-name">{user.full_name}</span><span className="sidebar__user-role">{ROLE_LABELS[user.role]}{user.group ? ` · ${user.group.name}` : ""}</span></span><ChevronRightIcon size={14} className="account-trigger__chevron" />
    </button>
    {open && createPortal(<div ref={panel} id={id} className="account-menu" role="dialog" aria-label="Меню аккаунта">
      <header className="account-menu__identity"><Avatar name={user.full_name} id={user.id} size={38} /><div><strong>{user.full_name}</strong><span>{ROLE_LABELS[user.role]} · {user.login}</span></div></header>
      <nav aria-label="Настройки аккаунта">
        <Link to="/profile" onClick={() => setOpen(false)}><UserIcon size={18} /><span>Профиль и настройки</span><ChevronRightIcon size={14} /></Link>
        <Link to="/profile#login" onClick={() => setOpen(false)}><UserIcon size={18} /><span>Изменить логин</span></Link>
        <Link to="/profile#password" onClick={() => setOpen(false)}><LockIcon size={18} /><span>Изменить пароль</span></Link>
        <Link to="/profile#telegram" onClick={() => setOpen(false)}><TelegramIcon size={18} /><span>Telegram</span></Link>
      </nav>
      <footer><Button block size="s" variant="destructive" icon={<LogoutIcon size={16} />} disabled={leaving} onClick={() => { setLeaving(true); void logout(); }}>{leaving ? "Выходим…" : "Выйти из аккаунта"}</Button></footer>
    </div>, document.body)}
  </>;
}
