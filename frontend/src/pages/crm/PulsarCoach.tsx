import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGuide } from "../../guide";
import { PulsarFace } from "./PulsarGuide";
import { coachLayout, type CoachStep } from "./coachTours";
import { lockPage } from "./coachLock";

/** The first matching element that is on screen: a tab kept in the background never counts. */
function shown(selector: string) {
  for (const element of document.querySelectorAll(selector)) if (element.getClientRects().length) return element;
  return null;
}

/**
 * Pulsar's guided tour. The operator does every step on the page himself: a step that asks for
 * an action waits until it is done, and until the tour ends only the lit element answers.
 * `extra` renders what Pulsar hands over inside his bubble, e.g. the courier's code.
 */
export function PulsarCoach({ steps, onClose, extra }: { steps: CoachStep[]; onClose: (finished: boolean) => void; extra?: (step: CoachStep) => ReactNode }) {
  const guide = useGuide();
  const [index, setIndex] = useState(0), [missing, setMissing] = useState(false), [flying, setFlying] = useState(true);
  // «done»: the step's action is already done (the operator came back to it), so «Дальше» may move on.
  const [done, setDone] = useState(false), [nudge, setNudge] = useState(0), [top, setTop] = useState(false);
  const mascotRef = useRef<HTMLDivElement>(null), bubbleRef = useRef<HTMLDivElement>(null), handRef = useRef<HTMLDivElement>(null), spotRef = useRef<HTMLDivElement>(null), rootRef = useRef<HTMLDivElement>(null);
  const step = steps[index], last = index === steps.length - 1;
  // Steps that do not apply are skipped in the direction the operator is moving.
  const direction = useRef(1);
  // The steps the operator has actually seen: the counter shows them and «Назад» walks them back.
  const [visited, setVisited] = useState<number[]>([]);
  const visitedRef = useRef(visited); visitedRef.current = visited;
  const previous = (from: number) => { const list = visitedRef.current, at = list.indexOf(from); return at > 0 ? list[at - 1] : at < 0 ? list.at(-1) : undefined; };
  const back = (from = index) => { const to = previous(from); if (to === undefined) return false; direction.current = -1; setIndex(to); return true; };
  const forward = () => { direction.current = 1; if (last) onClose(true); else setIndex(index + 1); };
  // The page lock reads the current step through refs; it lives as long as the tour.
  const lit = useRef<Element | null>(null), stepRef = useRef(step), actions = useRef({ used: () => {}, escape: () => {} });
  stepRef.current = step;
  actions.current = { used: () => { if (step?.waitClick) forward(); }, escape: () => onClose(false) };
  const lock = useRef<ReturnType<typeof lockPage> | null>(null);
  useEffect(() => {
    const current = lockPage({
      coach: () => rootRef.current, target: () => stepRef.current?.action ? lit.current : null, allow: () => stepRef.current?.allow,
      onUsed: () => actions.current.used(), onBlocked: () => setNudge(n => n + 1), onEscape: () => actions.current.escape(),
    });
    lock.current = current;
    return () => { current.release(); lock.current = null; };
  }, []);

  useEffect(() => {
    if (!step) return;
    let frame = 0, found: Element | null = null, started = performance.now(), arrived = false;
    // Coming back to an action that is already done shows it with «Дальше»; going forward skips it.
    const returning = direction.current < 0;
    let armed = !returning, ready = returning && !!step.waitClick, raised = false;
    setMissing(false); setFlying(true); setNudge(0); setDone(ready); setTop(false); lit.current = null;
    const landed = window.setTimeout(() => setFlying(false), 350);
    const small = window.innerWidth < 700, mascot = small ? 76 : 108;
    const tick = () => {
      const absent = step.when && !shown(step.when), past = step.skipWhen && !last && shown(step.skipWhen);
      if (absent || past) {
        if (direction.current < 0 && back()) return;
        forward(); return;
      }
      if (step.advanceWhen) {
        const now = !!shown(step.advanceWhen);
        if (now && armed) { forward(); return; }
        if (!now) armed = true;
        if (now !== ready) { ready = now; setDone(now); }
      }
      found = lit.current = shown(step.target);
      // Back over a step that is done and whose element is gone: it has nothing left to show.
      if (!found && returning && ready) { if (back()) return; forward(); return; }
      if (!found) {
        // Give the page a moment to render the target; then offer to move on rather than get stuck.
        if (performance.now() - started > 2500) setMissing(true);
        frame = requestAnimationFrame(tick); return;
      }
      setMissing(false);
      if (!arrived) {
        arrived = true;
        setVisited(v => v.includes(index) ? v.slice(0, v.indexOf(index) + 1) : [...v, index]);
        lock.current?.settle();
        found.scrollIntoView({ block: "center", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      const rect = found.getBoundingClientRect(), dock = document.querySelector(".pulsar-dock:not(.is-compact)")?.getBoundingClientRect();
      const right = dock && dock.left > window.innerWidth / 2 && dock.height > 300 ? dock.left - 8 : window.innerWidth;
      const bubble = bubbleRef.current, bubbleW = bubble?.offsetWidth ?? 300, bubbleH = bubble?.offsetHeight ?? 160;
      // On a phone the bubble sits at the bottom; it goes up when it would hide the lit element.
      const up = small && rect.bottom > window.innerHeight - bubbleH - 20 && rect.top > bubbleH + 20;
      if (up !== raised) { raised = up; setTop(up); }
      const layout = coachLayout(rect, { width: window.innerWidth, height: window.innerHeight, right }, { mascot, bubbleW, bubbleH });
      if (mascotRef.current) { mascotRef.current.style.transform = `translate(${layout.mascot.x}px,${layout.mascot.y}px)`; mascotRef.current.dataset.flip = String(layout.mascot.flip); mascotRef.current.style.width = mascotRef.current.style.height = `${mascot}px`; }
      if (bubble) bubble.style.transform = small ? "" : `translate(${layout.bubble.x}px,${layout.bubble.y}px)`;
      if (handRef.current) { handRef.current.style.transform = `translate(${layout.hand.x}px,${layout.hand.y}px) translate(-50%,-50%)`; handRef.current.dataset.side = layout.side; handRef.current.firstElementChild!.textContent = layout.hand.icon; }
      if (spotRef.current) { const pad = 8; Object.assign(spotRef.current.style, { transform: `translate(${rect.left - pad}px,${rect.top - pad}px)`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` }); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(landed); lit.current = null; };
  }, [step, index, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!step) return null;
  // A step that asks to press or choose something waits for the operator: nobody does it for him.
  const waiting = !missing && !done && (!!step.advanceWhen || !!step.waitClick);
  return <div ref={rootRef} className="coach" data-flying={flying} data-missing={missing} data-nudge={nudge ? (nudge % 2 ? "a" : "b") : undefined}>
    <div ref={spotRef} className="coach-spot" aria-hidden="true" />
    <div ref={handRef} className="coach-hand" aria-hidden="true"><span>👈</span>{step.action && <small>{step.action}</small>}</div>
    <div ref={mascotRef} className="coach-mascot" aria-hidden="true"><PulsarFace mood={last ? "cheer" : index === 0 ? "wave" : "point"} /></div>
    <div ref={bubbleRef} className="coach-bubble" data-top={top} role="dialog" aria-live="polite" aria-label={`${guide.name}: ${guide.text(step.title)}`}>
      <div className="coach-bubble-top"><span className="coach-count">Шаг {Math.max(1, visited.length)}</span><button className="coach-close" aria-label="Закрыть подсказки" onClick={() => onClose(false)}>✕</button></div>
      <strong>{guide.text(step.title)}</strong>
      <p>{missing ? "Этого элемента сейчас нет на экране. Нажми «Дальше», и я покажу следующее." : guide.text(step.text)}</p>
      {!missing && extra?.(step)}
      {nudge > 0 && <p className="coach-lock">Пока идёт подсказка, работает только {step.action ? "выделенное место" : "моё окошко: прочитай и нажми «Дальше»"}. Выйти из подсказки{" "}— ✕.</p>}
      <div className="coach-actions">
        <button className="coach-back" disabled={previous(index) === undefined} onClick={() => back()}>← Назад</button>
        {waiting ? <span className="coach-wait" role="status">{step.action ?? "Сделай это"} — жду тебя</span>
          : <button className="coach-next" autoFocus onClick={forward}>{last ? "Готово ✓" : "Дальше →"}</button>}
      </div>
    </div>
  </div>;
}
