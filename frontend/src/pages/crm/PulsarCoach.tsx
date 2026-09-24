import { useEffect, useRef, useState } from "react";
import { PulsarFace } from "./PulsarGuide";
import { coachLayout, type CoachStep } from "./coachTours";

export function PulsarCoach({ steps, onClose }: { steps: CoachStep[]; onClose: (finished: boolean) => void }) {
  const [index, setIndex] = useState(0), [missing, setMissing] = useState(false), [flying, setFlying] = useState(true);
  const mascotRef = useRef<HTMLDivElement>(null), bubbleRef = useRef<HTMLDivElement>(null), handRef = useRef<HTMLDivElement>(null), spotRef = useRef<HTMLDivElement>(null);
  const step = steps[index], last = index === steps.length - 1;
  // Steps that do not apply are skipped in the direction the operator is moving, so «Назад» never bounces forward.
  const direction = useRef(1);
  // Branches skip steps, so the counter shows how many hints the operator has actually seen.
  const [visited, setVisited] = useState<number[]>([]);
  const move = (by: number) => { direction.current = by; setIndex(i => Math.max(0, Math.min(steps.length - 1, i + by))); };
  const next = () => {
    if (last) { onClose(true); return; }
    // An action step can do the click for the operator, then waits for the screen it opens.
    const target = step?.autoClick && step.advanceWhen && !document.querySelector(step.advanceWhen) ? document.querySelector<HTMLElement>(step.target) : null;
    if (target) { target.click(); return; }
    move(1);
  };
  const nextRef = useRef(next); nextRef.current = next;

  useEffect(() => {
    if (!step) return;
    let frame = 0, found: Element | null = null, started = performance.now(), scrolled = false;
    setMissing(false); setFlying(true);
    const landed = window.setTimeout(() => setFlying(false), 750);
    const small = window.innerWidth < 700, mascot = small ? 76 : 108;
    const tick = () => {
      if (step.skipWhen && document.querySelector(step.skipWhen) && index < steps.length - 1) { move(1); return; }
      if (step.when && !document.querySelector(step.when)) {
        if (direction.current < 0 && index === 0) direction.current = 1;
        if (direction.current > 0 && last) { onClose(true); return; }
        move(direction.current); return;
      }
      if (step.advanceWhen && document.querySelector(step.advanceWhen)) { nextRef.current(); return; }
      found = document.querySelector(step.target);
      if (!found) {
        // Give the page a moment to render the target; otherwise move on rather than get stuck.
        if (performance.now() - started > 2500) { setMissing(true); }
        frame = requestAnimationFrame(tick); return;
      }
      setMissing(false);
      if (!scrolled) setVisited(v => v.includes(index) ? v.slice(0, v.indexOf(index) + 1) : [...v, index]);
      if (!scrolled) { scrolled = true; found.scrollIntoView({ block: "center", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      const rect = found.getBoundingClientRect(), dock = document.querySelector(".pulsar-dock:not(.is-compact)")?.getBoundingClientRect();
      const right = dock && dock.left > window.innerWidth / 2 && dock.height > 300 ? dock.left - 8 : window.innerWidth;
      const bubble = bubbleRef.current, bubbleW = bubble?.offsetWidth ?? 300, bubbleH = bubble?.offsetHeight ?? 160;
      const layout = coachLayout(rect, { width: window.innerWidth, height: window.innerHeight, right }, { mascot, bubbleW, bubbleH });
      if (mascotRef.current) { mascotRef.current.style.transform = `translate(${layout.mascot.x}px,${layout.mascot.y}px)`; mascotRef.current.dataset.flip = String(layout.mascot.flip); mascotRef.current.style.width = mascotRef.current.style.height = `${mascot}px`; }
      if (bubble) bubble.style.transform = small ? "" : `translate(${layout.bubble.x}px,${layout.bubble.y}px)`;
      if (handRef.current) { handRef.current.style.transform = `translate(${layout.hand.x}px,${layout.hand.y}px) translate(-50%,-50%)`; handRef.current.dataset.side = layout.side; handRef.current.firstElementChild!.textContent = layout.hand.icon; }
      if (spotRef.current) { const pad = 8; Object.assign(spotRef.current.style, { transform: `translate(${rect.left - pad}px,${rect.top - pad}px)`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` }); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(landed); };
  }, [step, index, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(false); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  if (!step) return null;
  return <div className="coach" data-flying={flying} data-missing={missing}>
    <div ref={spotRef} className="coach-spot" aria-hidden="true" />
    <div ref={handRef} className="coach-hand" aria-hidden="true"><span>👈</span>{step.action && <small>{step.action}</small>}</div>
    <div ref={mascotRef} className="coach-mascot" aria-hidden="true"><PulsarFace mood={last ? "cheer" : index === 0 ? "wave" : "point"} /></div>
    <div ref={bubbleRef} className="coach-bubble" role="dialog" aria-live="polite" aria-label={`Пульсар: ${step.title}`}>
      <div className="coach-bubble-top"><span className="coach-count">Шаг {Math.max(1, visited.length)}</span><button className="coach-close" aria-label="Закрыть подсказки" onClick={() => onClose(false)}>✕</button></div>
      <strong>{step.title}</strong>
      <p>{missing ? "Этого элемента сейчас нет на экране. Нажми «Дальше», и я покажу следующее." : step.text}</p>
      <div className="coach-actions">
        <button className="coach-back" disabled={index === 0} onClick={() => move(-1)}>← Назад</button>
        <button className="coach-next" autoFocus onClick={next}>{last ? "Готово ✓" : step.autoClick && !missing ? "Открыть за меня →" : step.advanceWhen && !missing ? "Пропустить →" : "Дальше →"}</button>
      </div>
    </div>
  </div>;
}
