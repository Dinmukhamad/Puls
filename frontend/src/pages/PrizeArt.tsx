import { useId } from "react";
import type { StickerKind } from "./wheelPrizes";

/**
 * Drawn prize stickers of the chest of the day, in the chest's own style: warm gold,
 * soft gradients, a glint that catches the light. Decorative only: the prize is
 * named by the text next to it.
 */
export function PrizeArt({ kind }: { kind: StickerKind }) {
  const id = useId().replace(/:/g, "");
  const g = (name: string) => `url(#${id}-${name})`;
  return <svg className="prize-art" data-kind={kind} viewBox="0 0 64 64" fill="none" focusable="false" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-face`} x1="18" y1="12" x2="46" y2="52" gradientUnits="userSpaceOnUse"><stop stopColor="#fff2b0"/><stop offset=".45" stopColor="#f8cd5c"/><stop offset="1" stopColor="#e09a2c"/></linearGradient>
      <linearGradient id={`${id}-rim`} x1="12" y1="10" x2="52" y2="54" gradientUnits="userSpaceOnUse"><stop stopColor="#f6c24f"/><stop offset="1" stopColor="#a8661a"/></linearGradient>
      <linearGradient id={`${id}-leather`} x1="16" y1="18" x2="50" y2="58" gradientUnits="userSpaceOnUse"><stop stopColor="#d79a5c"/><stop offset=".55" stopColor="#a8622f"/><stop offset="1" stopColor="#6e3a1d"/></linearGradient>
      <linearGradient id={`${id}-box`} x1="12" y1="26" x2="52" y2="56" gradientUnits="userSpaceOnUse"><stop stopColor="#ff9cc6"/><stop offset="1" stopColor="#d6457f"/></linearGradient>
      <linearGradient id={`${id}-lid`} x1="9" y1="18" x2="55" y2="32" gradientUnits="userSpaceOnUse"><stop stopColor="#ffb8d6"/><stop offset="1" stopColor="#e5639a"/></linearGradient>
      <linearGradient id={`${id}-crown`} x1="10" y1="12" x2="54" y2="54" gradientUnits="userSpaceOnUse"><stop stopColor="#fff0a8"/><stop offset=".5" stopColor="#f5c242"/><stop offset="1" stopColor="#c27f1f"/></linearGradient>
      <linearGradient id={`${id}-gem`} x1="14" y1="12" x2="48" y2="56" gradientUnits="userSpaceOnUse"><stop stopColor="#d9fbff"/><stop offset=".45" stopColor="#5fd8e8"/><stop offset="1" stopColor="#1b86a6"/></linearGradient>
      <linearGradient id={`${id}-leaf`} x1="16" y1="10" x2="48" y2="50" gradientUnits="userSpaceOnUse"><stop stopColor="#8be08f"/><stop offset=".6" stopColor="#3fa46a"/><stop offset="1" stopColor="#25774a"/></linearGradient>
    </defs>
    <ellipse cx="32" cy="58" rx="17" ry="3" fill="#2a1a10" fillOpacity=".16"/>
    {kind === "coin" && <g>
      <circle cx="32" cy="31" r="22" fill={g("rim")}/>
      <circle cx="32" cy="31" r="17.5" fill={g("face")}/>
      <circle cx="32" cy="31" r="17.5" stroke="#c98a22" strokeWidth="1.6" strokeDasharray="1.6 2.6"/>
      <path d="M19 32h5l3-7 4.5 13 4-15 3 9h6" stroke="#a5621a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path className="prize-art__glint" d="M18.5 21.5a16 16 0 0 1 9-7" stroke="#fffbe6" strokeWidth="3" strokeLinecap="round"/>
    </g>}
    {kind === "stack" && <g>
      {[46, 39, 32].map((y) => <g key={y}>
        <path d={`M8 ${y}v5c0 3.6 7.2 6.5 16 6.5S40 ${y + 8.6} 40 ${y + 5}v-5`} fill="#c27f1f" stroke="#9a5d17" strokeWidth="1.4"/>
        <ellipse cx="24" cy={y} rx="16" ry="6.4" fill={g("face")} stroke="#b7781f" strokeWidth="1.4"/>
        <ellipse cx="24" cy={y} rx="10.5" ry="3.8" stroke="#c98a22" strokeWidth="1.2" strokeOpacity=".8"/>
      </g>)}
      <circle cx="45" cy="27" r="14" fill={g("rim")}/>
      <circle cx="45" cy="27" r="10.8" fill={g("face")}/>
      <path d="M37.5 27.5h3l2-4.5 3 8.5 2.5-10 2 6h3.5" stroke="#a5621a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path className="prize-art__glint" d="M38 20a10 10 0 0 1 5.5-4.2" stroke="#fffbe6" strokeWidth="2.4" strokeLinecap="round"/>
    </g>}
    {kind === "pouch" && <g>
      <circle cx="41" cy="14" r="7.5" fill={g("face")} stroke="#b7781f" strokeWidth="1.4"/>
      <path d="M22.5 22C13 28 9 37 9 44.5 9 53 18 57 32 57s23-4 23-12.5C55 37 51 28 41.5 22Z" fill={g("leather")} stroke="#5c3418" strokeWidth="2"/>
      <path d="M23 13.5 27.5 22h9L41 13.5c-3 2.2-6 3.2-9 3.2s-6-1-9-3.2Z" fill={g("leather")} stroke="#5c3418" strokeWidth="2" strokeLinejoin="round"/>
      <rect x="20.5" y="19.5" width="23" height="5.5" rx="2.75" fill="#f0bf4f" stroke="#a5621a" strokeWidth="1.4"/>
      <circle cx="32" cy="42" r="8" fill={g("face")} stroke="#a5621a" strokeWidth="1.6"/>
      <path d="M26.5 42.5h2.5l1.6-3.6 2.4 7 2-8 1.6 4.6h2.5" stroke="#a5621a" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
      <path className="prize-art__glint" d="M16 37c1.4-4.4 3.8-8 7-10.6" stroke="#ffe2bd" strokeWidth="2.6" strokeLinecap="round" strokeOpacity=".8"/>
    </g>}
    {kind === "gift" && <g>
      <rect x="12" y="29" width="40" height="26" rx="4" fill={g("box")} stroke="#a8326a" strokeWidth="1.8"/>
      <rect x="9" y="20" width="46" height="11" rx="3.5" fill={g("lid")} stroke="#a8326a" strokeWidth="1.8"/>
      <rect x="28" y="20" width="8" height="35" fill="#f6c34e" stroke="#c98a22" strokeWidth="1.4"/>
      <path d="M32 20c-3-8.5-15-11.5-15.5-4.6-.3 4.5 8.6 5.6 15.5 4.6Zm0 0c3-8.5 15-11.5 15.5-4.6.3 4.5-8.6 5.6-15.5 4.6Z" fill="#f8cc58" stroke="#c98a22" strokeWidth="1.6" strokeLinejoin="round"/>
      <circle cx="32" cy="19.5" r="3.4" fill="#e9a93a" stroke="#c98a22" strokeWidth="1.2"/>
      <path className="prize-art__glint" d="M14 24.5h8" stroke="#fff4f9" strokeWidth="2.6" strokeLinecap="round"/>
    </g>}
    {kind === "crown" && <g>
      <path d="M12 47 8.5 20.5l12.5 10L32 13.5l11 17 12.5-10L52 47Z" fill={g("crown")} stroke="#a5621a" strokeWidth="2" strokeLinejoin="round"/>
      <rect x="11" y="45" width="42" height="9" rx="3.5" fill={g("crown")} stroke="#a5621a" strokeWidth="2"/>
      <circle cx="8.5" cy="19.5" r="3.8" fill="#ff5a7a" stroke="#b8324f" strokeWidth="1.2"/>
      <circle cx="32" cy="12.5" r="4.4" fill="#6f8ff5" stroke="#3a59c2" strokeWidth="1.2"/>
      <circle cx="55.5" cy="19.5" r="3.8" fill="#2fd4bf" stroke="#178b7c" strokeWidth="1.2"/>
      {[[21, "#ff5a7a"], [32, "#6f8ff5"], [43, "#2fd4bf"]].map(([x, fill]) => <circle key={x} cx={x} cy="49.5" r="2.6" fill={fill as string}/>)}
      <path className="prize-art__glint" d="M15 41c2-4 4-6.5 6.5-8" stroke="#fffbe6" strokeWidth="2.6" strokeLinecap="round"/>
    </g>}
    {kind === "gem" && <g>
      <path d="M19.5 13h25L56 27.5 32 56 8 27.5Z" fill={g("gem")} stroke="#13708c" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M8 27.5h48M19.5 13l6.5 14.5L32 13l6 14.5L44.5 13M26 27.5 32 56l6-28.5" stroke="#ffffff" strokeOpacity=".6" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M19.5 13 26 27.5H8Z" fill="#e6feff" fillOpacity=".55"/>
      <path className="prize-art__spark" d="m53 5 1.6 4.1L58.7 10.7l-4.1 1.6L53 16.4l-1.6-4.1-4.1-1.6 4.1-1.6Z" fill="#ffffff"/>
      <path className="prize-art__glint" d="M14 27.5 21 18" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round"/>
    </g>}
    {kind === "clover" && <g>
      <path d="M33 33c3 7 9 13 16 18" stroke="#2b7a4a" strokeWidth="3.2" strokeLinecap="round"/>
      {[0, 90, 180, 270].map((turn) => <path key={turn} transform={`rotate(${turn} 32 31)`} d="M32 31c-1.5-5-6.5-9.5-11.5-8.2-4.3 1.1-5 6.5-1.8 9.2-3.2 2.7-2.5 8.1 1.8 9.2C25.5 42.5 30.5 36 32 31Z" fill={g("leaf")} stroke="#25774a" strokeWidth="1.4" strokeLinejoin="round"/>)}
      <circle cx="32" cy="31" r="2.6" fill="#c9f2c2"/>
      <path className="prize-art__spark" d="m50 8 1.4 3.6 3.6 1.4-3.6 1.4L50 18l-1.4-3.6-3.6-1.4 3.6-1.4Z" fill="#fff6c9"/>
    </g>}
  </svg>;
}
