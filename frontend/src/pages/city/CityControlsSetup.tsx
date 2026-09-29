import { useEffect, useRef, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { auth as authApi } from "../../api/endpoints";
import type { CityControls } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { CONTROL_SCHEMES } from "./cityControls";

const ORDER: CityControls[] = ["orbit", "map"];

/** Мышь с подсвеченными кнопками: жёлтая — «двигать», синяя — «вращать». Кнопки мигают по очереди. */
function MouseArt({ scheme }: { scheme: CityControls }) {
  const move = scheme === "orbit" ? "right" : "left";
  return <svg className="city-controls-mouse" data-scheme={scheme} viewBox="0 0 64 88" aria-hidden="true">
    <path className="city-controls-mouse__body" d="M32 4C16 4 6 16 6 32v22c0 17 11 30 26 30s26-13 26-30V32C58 16 48 4 32 4z" />
    <path className="city-controls-mouse__button" data-side="left" data-role={move === "left" ? "move" : "turn"} d="M30 5.2C17 6.2 8 17 8 32v6h22z" />
    <path className="city-controls-mouse__button" data-side="right" data-role={move === "right" ? "move" : "turn"} d="M34 5.2C47 6.2 56 17 56 32v6H34z" />
    <rect className="city-controls-mouse__wheel" x="28.5" y="13" width="7" height="15" rx="3.5" />
    <path className="city-controls-mouse__split" d="M32 4v34M8 38h48" />
  </svg>;
}

/**
 * Оператор выбирает, как двигать камеру в городе. Карточка лежит поверх карты, и выбранная схема
 * сразу работает — её можно попробовать, не закрывая карточку. Выбор хранится в профиле: тот же
 * на любом компьютере. Карточка управляемая: `value` — схема, которая сейчас работает на карте,
 * `onPick` её меняет (null — вернуть сохранённую); `cancellable` — открыта кнопкой на панели
 * карты, тогда есть «Отмена» и Escape.
 */
export function CityControlsSetup({ value, onPick, onClose, cancellable = false }: { value: CityControls; onPick: (scheme: CityControls | null) => void; onClose: () => void; cancellable?: boolean }) {
  const { user, applyProfile } = useAuth();
  const group = useRef<HTMLDivElement>(null), done = useRef<HTMLButtonElement>(null);
  const save = useMutation({
    mutationFn: (scheme: CityControls) => authApi.guide({ city_controls: scheme }),
    onSuccess: profile => { applyProfile(profile); onPick(null); onClose(); },
  });
  const busy = save.isPending;
  // Фокус сразу на выбранном варианте: с клавиатуры можно выбирать стрелками, не ища карточку.
  useEffect(() => { group.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus({ preventScroll: true }); }, []);
  // Сохранение не удалось: кнопка снова доступна, и фокус возвращается на неё, а не теряется.
  useEffect(() => { if (save.isError) done.current?.focus({ preventScroll: true }); }, [save.isError]);
  if (!user) return null;
  // Пока идёт сохранение, выбор заблокирован: ответ сервера не должен перебить новое нажатие.
  function pick(scheme: CityControls) { if (busy) return; onPick(scheme); save.reset(); }
  function cancel() { if (busy) return; onPick(null); onClose(); }
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && cancellable) { event.preventDefault(); cancel(); return; }
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[event.key];
    if (!step || !(event.target instanceof HTMLElement) || !event.target.closest("[role=radiogroup]")) return;
    event.preventDefault();
    const next = ORDER[(ORDER.indexOf(value) + step + ORDER.length) % ORDER.length];
    pick(next);
    group.current?.querySelector<HTMLElement>(`[data-scheme="${next}"]`)?.focus();
  }
  return <section className="city-controls-setup glass glass--prominent" id="city-controls-setup" aria-labelledby="city-controls-title" onKeyDown={keys}>
    <div className="city-controls-setup__head">
      <h2 id="city-controls-title">Как тебе удобнее двигать камеру?</h2>
      <p>Попробуй прямо на карте — выбранная схема уже работает. Поменять можно в любой момент кнопкой с мышью на панели карты.</p>
    </div>
    <div className="city-controls-options" role="radiogroup" aria-label="Управление камерой" ref={group}>
      {ORDER.map(scheme => {
        const s = CONTROL_SCHEMES[scheme], checked = value === scheme;
        return <button key={scheme} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} data-scheme={scheme} disabled={busy} className="city-controls-option" onClick={() => pick(scheme)}>
          <MouseArt scheme={scheme} />
          <span className="city-controls-option__text">
            <strong>{s.title}{" "}<small>{s.note}</small></strong>
            <span className="city-controls-keys">
              <span><kbd data-role={scheme === "orbit" ? "turn" : "move"}>ЛКМ</kbd> тянуть — {s.left}</span>
              <span><kbd data-role={scheme === "orbit" ? "move" : "turn"}>ПКМ</kbd> тянуть — {s.right}</span>
              <span><kbd>Колесо</kbd> {s.wheel}</span>
            </span>
            <em>{s.touch}</em>
          </span>
        </button>;
      })}
    </div>
    {save.isError && <p className="city-guide-setup__error" role="alert">{save.error.message}</p>}
    <div className="city-guide-setup__actions">
      <button type="button" className="city-action" ref={done} disabled={busy} onClick={() => save.mutate(value)}>{busy ? "Сохраняем…" : "Готово"}</button>
      {cancellable && <button type="button" className="city-secondary" disabled={busy} onClick={cancel}>Отмена</button>}
    </div>
  </section>;
}
