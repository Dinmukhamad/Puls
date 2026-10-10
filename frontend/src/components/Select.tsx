import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./icons";
import "./Select.css";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** A themed select: focus stays on the combobox, including inside a Sheet. */
export function Select({ value, onChange, options, id, name, disabled, required,
  className = "", placeholder = "Выберите значение", ...aria }: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? `select-${generatedId}`;
  const listId = `${controlId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const current = options.findIndex(option => String(option.value) === String(value));
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);

  function show(index = current) {
    if (disabled || enabled.length === 0) return;
    setActive(enabled.includes(index) ? index : enabled[0]);
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(String(option.value));
    setInvalid(false);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (open && enabled.length === 0) setOpen(false);
    else if (open && !enabled.includes(active)) setActive(enabled[0] ?? -1);
  }, [open, active, options]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", focus);
    };
  }, [open]);

  useLayoutEffect(() => {
    const panel = menu.current;
    const button = trigger.current;
    if (!open || !panel || !button) return;
    // The native top layer escapes glass/scroll clipping; the DOM stays inside
    // the active dialog so its focus trap and inert background remain correct.
    if (typeof panel.showPopover === "function") {
      panel.setAttribute("popover", "manual");
      panel.showPopover();
    }
    function position() {
      if (!panel || !button) return;
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const topEdge = viewport?.offsetTop ?? 0;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight);
      const below = bottomEdge - rect.bottom - 16;
      const above = rect.top - topEdge - 16;
      const down = below >= Math.min(240, panel.scrollHeight) || below >= above;
      const height = Math.max(44, Math.min(320, down ? below : above));
      const panelWidth = Math.min(width - 24, Math.max(rect.width, 240));
      panel.style.width = `${panelWidth}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, width - panelWidth - 12))}px`;
      panel.style.top = `${down ? rect.bottom + 8 : Math.max(topEdge + 12, rect.top - Math.min(panel.scrollHeight, height) - 8)}px`;
      panel.style.visibility = "visible";
    }
    position();
    const scroll = (event: Event) => { if (event.target instanceof Node && panel.contains(event.target)) return; position(); };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", position);
      if (typeof panel.hidePopover === "function" && panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const panel = menu.current;
    const option = panel?.children[active] as HTMLElement | undefined;
    if (!panel || !option) return;
    if (option.offsetTop < panel.scrollTop) panel.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > panel.scrollTop + panel.clientHeight) panel.scrollTop = option.offsetTop + option.offsetHeight - panel.clientHeight;
  }, [open, active]);

  function onKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) { show(event.key === "End" ? enabled.at(-1) : current); return; }
      const offset = enabled.indexOf(active);
      const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : enabled[(offset + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length];
      setActive(next ?? -1); return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active); else show();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const char = event.key.toLocaleLowerCase();
      const previous = now - search.current.at < 700 ? search.current.text : "";
      const text = previous === char ? char : previous + char;
      search.current = { text, at: now };
      const start = open ? active : current;
      const ordered = [...enabled.filter(index => index > start), ...enabled.filter(index => index <= start)];
      const match = ordered.find(index => options[index].label.toLocaleLowerCase().startsWith(text));
      if (match !== undefined) show(match);
    }
  }

  const portalTarget = trigger.current?.closest('[role="dialog"]') ?? (typeof document !== "undefined" ? document.body : null);
  return <span className="puls-select">
    <button ref={trigger} id={controlId} type="button" role="combobox" className={`input puls-select__trigger ${className}`} disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      aria-required={required || undefined} aria-invalid={invalid || undefined} {...aria}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={onKey}>
      <span className={current < 0 ? "puls-select__value is-placeholder" : "puls-select__value"}>{current < 0 ? placeholder : options[current].label}</span>
      <svg className={open ? "puls-select__chevron is-open" : "puls-select__chevron"} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <select className="puls-select__native" aria-hidden="true" tabIndex={-1} name={name} value={value} required={required} disabled={disabled}
      onChange={event => onChange(event.target.value)} onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>
      {!options.some(option => String(option.value) === "") && <option value="" />}
      {options.map(option => <option key={String(option.value)} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    {open && portalTarget && createPortal(<div ref={menu} id={listId} role="listbox" aria-label={aria["aria-label"] ?? "Варианты выбора"} className="puls-select__menu">
      {options.map((option, index) => <div id={`${listId}-${index}`} key={String(option.value)} role="option" aria-selected={index === current} aria-disabled={option.disabled || undefined}
        className={`puls-select__option${index === active ? " is-focused" : ""}${index === current ? " is-selected" : ""}`}
        onPointerMove={() => { if (!option.disabled) setActive(index); }} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{index === current && <CheckIcon size={16} />}
      </div>)}
    </div>, portalTarget)}
  </span>;
}
