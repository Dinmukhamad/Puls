import { useState } from "react";
import type { OrderStage } from "../api/driver";
import type { DriverPreferences } from "../api/driverShift";

type Point = [number, number];
const approach: Point[] = [[105, 590], [250, 590], [250, 470]];
const journey: Point[] = [[250, 470], [250, 350], [420, 350], [420, 190], [510, 190], [510, 100]];
const path = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.join(" ")}`).join(" ");

export function routePosition(points: Point[], progress: number) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let remaining = Math.max(0, Math.min(1, progress)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? remaining / lengths[i] : 0, a = points[i], b = points[i + 1];
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 90 };
    }
    remaining -= lengths[i];
  }
  return { x: points[0][0], y: points[0][1], angle: 0 };
}

export function DriverOrderMap({ stage, progress, origin, destination, preferences }: { stage: OrderStage; progress: number; origin: string; destination: string; preferences?: DriverPreferences }) {
  const [zoom, setZoom] = useState(1);
  const inJourney = ["trip", "payment", "complete"].includes(stage);
  const moving = stage === "pickup" || stage === "trip";
  const route = inJourney ? journey : approach;
  const car = routePosition(route, moving ? progress : stage === "waiting" || inJourney ? 1 : 0);
  const near = moving && progress >= .96;
  const meters = Math.round((inJourney ? 10300 : 3100) * (1 - progress) / 10) * 10;
  const distance = meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(".", ",")} км` : `${meters} м`;
  return <div className="driver-trip-map">
    <svg viewBox={`${320 - 320 / zoom} ${350 - 350 / zoom} ${640 / zoom} ${700 / zoom}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Учебная карта. А: ${origin}. Б: ${destination}.`}>
      <defs>
        <pattern id="driver-city" width="85" height="85" patternUnits="userSpaceOnUse"><rect width="85" height="85" fill="#272d47" /><rect x="10" y="10" width="64" height="63" rx="7" fill="#323a59" /><path d="M0 0H85M0 0V85" stroke="#505b80" strokeWidth="5" /><path d="M23 25h32v12H23zM23 45h17v13H23zM48 45h13v13H48z" fill="#3e4663" /></pattern>
        <filter id="driver-car-shadow"><feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity=".45" /></filter>
      </defs>
      <rect x="-640" y="-700" width="1920" height="2100" fill="url(#driver-city)" />
      <path d="M-50 210Q105 300 80 400T150 760" fill="none" stroke="#284957" strokeWidth="82" />
      <path d="M-50 210Q105 300 80 400T150 760" fill="none" stroke="#396a7d" strokeWidth="24" />
      <rect x="280" y="395" width="103" height="141" rx="18" fill="#284c4c" />
      <path d="M295 415L370 515M295 515L370 415" stroke="#3b6462" strokeWidth="5" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M-10 590H680M250 -20V720M-10 350H680M420 -20V720M-10 190H680M510 -20V720" stroke="#1c243b" strokeWidth="20" />
        <path d="M-10 590H680M250 -20V720M-10 350H680M420 -20V720M-10 190H680M510 -20V720" stroke="#687393" strokeWidth="11" />
        <path d={path(journey)} stroke="#94acbe" strokeWidth="8" opacity=".55" />
        <path d={path(inJourney ? journey : approach)} stroke="#192c26" strokeWidth="14" />
        <path d={path(inJourney ? journey : approach)} stroke="#acfa56" strokeWidth="7" />
      </g>
      <g fill="#a5b0c9" fontSize="12" textAnchor="middle"><text x="330" y="458">Городской</text><text x="330" y="476">парк</text><text x="340" y="574">Центральный проспект</text><text x="115" y="335">Учебный квартал</text><text x="455" y="58">Деловой центр</text></g>
      {([[250, 470, "А"], [510, 100, "Б"]] as const).filter(([, , label]) => label !== "Б" || preferences?.destination_marker !== false).map(([x, y, label]) => <g key={label} transform={`translate(${x} ${y})`}><circle r="8" fill="#151a2a" stroke="white" strokeWidth="4" /><rect x="-20" y="-62" width="40" height="42" rx="13" fill="white" stroke="#111827" strokeWidth="4" /><text y="-32" textAnchor="middle" fill="#111827" fontSize="25" fontWeight="750">{label}</text></g>)}
      <g transform={`translate(${car.x} ${car.y}) rotate(${car.angle})`} filter="url(#driver-car-shadow)"><circle r="34" fill="#ffe128" opacity=".12" /><path d="M0 -25L20 22L0 13L-20 22Z" fill="#ffe128" stroke="#101322" strokeWidth="4" strokeLinejoin="round" /></g>
    </svg>
    {preferences?.navigation !== "overview" && <div className="driver-trip-map__instruction"><span>{moving ? near ? "⚑" : progress > .35 && progress < .55 ? "↱" : "↑" : "●"}</span><div><strong>{moving ? progress >= 1 ? "Вы прибыли" : distance : stage === "waiting" ? "Точка подачи" : stage === "searching" ? "Ищем заказ" : inJourney ? "Точка назначения" : "Маршрут заказа"}</strong><small>{moving ? inJourney ? "К точке назначения" : "К месту подачи" : "Учебная карта"}</small></div></div>}{moving && <span className="ds-speed" aria-label="Учебное ограничение скорости 60">60</span>}
    <div className="driver-trip-map__tools"><button aria-label="Увеличить карту" disabled={zoom >= 1.6} onClick={() => setZoom(Math.min(1.6, zoom + .2))}>+</button><button aria-label="Уменьшить карту" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - .2))}>−</button><button aria-label="Показать весь маршрут" onClick={() => setZoom(1)}>⌖</button></div>
    <span className="driver-trip-map__caption">Виртуальный маршрут · время ×30</span>
  </div>;
}
