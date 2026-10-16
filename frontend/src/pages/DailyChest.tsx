import { useId, type CSSProperties } from "react";
import { PrizeArt } from "./PrizeArt";
import type { PrizeSticker } from "./wheelPrizes";

export type ChestState = "locked" | "ready" | "opening" | "open" | "spent" | "paused";

/**
 * Decorative only: the real reward is announced in the neighbouring status.
 *
 * The chest is alive in every state, never a still picture: a ready chest floats, light
 * leaks through its lid and every few seconds it hops as if asking to be opened; a
 * locked one swings its padlock; an open one keeps its beams turning, sparks rising,
 * coins hopping out and the prize hovering over it. Reduced motion stops all of it.
 */
export function DailyChest({ state, reward, celebrate = false }: { state: ChestState; reward?: PrizeSticker; celebrate?: boolean }) {
  const id = useId().replace(/:/g, "");
  return <div className="chest-scene" data-state={state} data-celebrate={celebrate} aria-hidden="true">
    <div className="chest-scene__halo" />
    <div className="chest-scene__orbit" />
    <div className="chest-scene__rays" />
    <div className="chest-scene__stars">{Array.from({ length: 8 }, (_, i) => <span key={i} style={{ "--i": i, left: `${12 + i * 29 % 76}%`, top: `${10 + i * 23 % 64}%`, fontSize: `${10 + i % 3 * 4}px` } as CSSProperties}>✦</span>)}</div>
    <div className="chest" data-state={state}>
      <svg className="chest__art" viewBox="0 0 320 280" fill="none" focusable="false">
        <defs>
          <linearGradient id={`${id}-wood`} x1="90" y1="125" x2="230" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#be773c"/><stop offset=".5" stopColor="#96502d"/><stop offset="1" stopColor="#60301f"/></linearGradient>
          <linearGradient id={`${id}-lid`} x1="150" y1="76" x2="150" y2="155" gradientUnits="userSpaceOnUse"><stop stopColor="#e5a15c"/><stop offset=".5" stopColor="#ac6134"/><stop offset="1" stopColor="#7c3c25"/></linearGradient>
          <linearGradient id={`${id}-gold`} x1="100" y1="90" x2="220" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#fff1ae"/><stop offset=".28" stopColor="#f9ce65"/><stop offset=".58" stopColor="#d69b35"/><stop offset="1" stopColor="#b87524"/></linearGradient>
          <linearGradient id={`${id}-side`} x1="235" y1="145" x2="268" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#93512e"/><stop offset="1" stopColor="#49271e"/></linearGradient>
          <linearGradient id={`${id}-inside`} x1="160" y1="124" x2="160" y2="168" gradientUnits="userSpaceOnUse"><stop stopColor="#fff1ab"/><stop offset="1" stopColor="#bd7c30"/></linearGradient>
        </defs>
        <ellipse className="chest__shadow" cx="162" cy="248" rx="110" ry="13" fill="#241a28" fillOpacity=".18"/>
        <g className="chest__float">
          <path d="M54 145 88 124H267L237 151Z" fill="#3c241e" stroke="#693c24" strokeWidth="4" strokeLinejoin="round"/>
          <path className="chest__inside" d="m62 144 27-14h167l-23 14z" fill={`url(#${id}-inside)`}/>
          <g className="chest__lid">
            <path d="M55 144v-31c0-25 19-44 43-44h113c17 0 29 14 29 31v44Z" fill={`url(#${id}-lid)`} stroke="#623620" strokeWidth="4"/>
            <path d="m240 144 28-20V96c0-19-15-33-34-33h-25c18 5 31 19 31 37z" fill={`url(#${id}-side)`} stroke="#623620" strokeWidth="4" strokeLinejoin="round"/>
            <path d="M70 101h155M57 122h180" stroke="#65351f" strokeWidth="3" strokeOpacity=".45"/>
            <path d="M80 143v-32c0-18 13-34 28-39h19c-16 4-26 19-26 38v33Zm115 0v-39c0-17-7-28-17-35h22c12 9 18 21 18 37v37Z" fill={`url(#${id}-gold)`} stroke="#b7792e" strokeWidth="1.5"/>
            <path d="M55 135h184v13H55z" fill={`url(#${id}-gold)`} stroke="#ad722b" strokeWidth="2"/>
            <path d="m240 136 28-20v11l-28 21z" fill="#d6a043"/>
            <path d="M96 80c5-3 11-5 17-5M207 82l4 8" stroke="#fff1c0" strokeWidth="3" strokeLinecap="round"/>
          </g>
          <g className="chest__base">
            <path d="M55 149h185v80c0 8-6 14-14 14H69c-8 0-14-6-14-14Z" fill={`url(#${id}-wood)`} stroke="#623620" strokeWidth="4"/>
            <path d="m240 149 28-21v79c0 8-5 15-11 19l-24 15c5-3 7-7 7-13Z" fill={`url(#${id}-side)`} stroke="#623620" strokeWidth="4" strokeLinejoin="round"/>
            <path d="M59 177h178M59 209h178" stroke="#52291c" strokeWidth="3" strokeOpacity=".45"/>
            <path d="M81 151h21v90H81zm115 0h21v90h-21z" fill={`url(#${id}-gold)`} stroke="#b7792e" strokeWidth="1.5"/>
            <path d="M59 230h178v10H59z" fill={`url(#${id}-gold)`}/>
            <path d="M61 151h172" stroke="#ffe6a0" strokeWidth="3"/>
            {[88, 204].map(x => <g key={x} fill="#835321"><circle cx={x+3} cy="165" r="2.5"/><circle cx={x+3} cy="225" r="2.5"/></g>)}
            <path d="m249 163 9-6v18l-9 6z" fill="#c38a35"/>
            <rect x="128" y="148" width="39" height="46" rx="12" fill={`url(#${id}-gold)`} stroke="#a96925" strokeWidth="2"/>
            <rect x="133" y="153" width="29" height="35" rx="9" fill="#ffe9a0" fillOpacity=".55"/>
            <path className="chest__keyhole" d="M152 166a5 5 0 1 0-8 4l-2 9h12l-2-9a5 5 0 0 0 0-4" fill="#654029"/>
            <path d="M67 161v58" stroke="#f5bf7a" strokeWidth="3" strokeOpacity=".35" strokeLinecap="round"/>
            <path className="chest__glint" d="m160 151 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#fffbe6"/>
          </g>
          <path className="chest__seam" d="M60 147.5h176l27-19" stroke="#ffe9a6" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      </svg>
      <span className="chest__lock" data-visible={state === "locked"}>🔒</span>
    </div>
    {(state === "ready" || state === "open") && <div className="chest-scene__sparks">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i, "--x": `${(i * 37 % 100) - 50}px`, "--d": `${2.2 + i % 4 * .45}s`, "--delay": `${i * .37}s` } as CSSProperties}/>)}</div>}
    {state === "open" && <div className="chest-scene__coins">{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ "--x": `${(i % 2 ? 1 : -1) * (60 + i * 14)}px`, "--y": `${-70 - i % 3 * 26}px`, "--delay": `${.9 + i * .55}s` } as CSSProperties}/>)}</div>}
    {state === "open" && reward && <span className="chest-scene__reward" data-kind={reward.kind} style={{ "--sticker": reward.color } as CSSProperties}><PrizeArt kind={reward.kind} /></span>}
    {state === "open" && celebrate && <div className="chest-scene__burst">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ "--i": i, "--x": `${Math.cos(i * 2.4) * (110 + i % 4 * 25)}px`, "--y": `${-90 - (i % 5) * 31}px`, "--turn": `${i * 73}deg`, "--delay": `${i % 4 * 45}ms` } as CSSProperties}/>)}</div>}
    <div className="chest-scene__platform" />
  </div>;
}
