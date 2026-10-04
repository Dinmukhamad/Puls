import { useState, type ReactNode } from "react";
import type { DepartmentCity, DepartmentId } from "../../api/cityWorld";
import "./cityTravel.css";

function cityLabel(city: DepartmentCity) {
  return city.id === "sales" && city.name.trim() === "ОП" ? "Отдел продаж (ОП)" : city.name;
}

function journeyLabel(city: DepartmentCity) {
  return city.id === "support" && city.name === "Техподдержка" ? "Техподдержку" : city.name;
}

/** Lightweight illustrations: city selection does not start another 3D scene. */
function CityMiniature({ city }: { city: DepartmentId }) {
  const sales = city === "sales";
  const towers = sales
    ? [{ x: 72, y: 18, w: 30, d: 24, h: 78 }, { x: 32, y: 48, w: 29, d: 23, h: 57 }, { x: 101, y: 52, w: 28, d: 22, h: 47 }]
    : [{ x: 72, y: 32, w: 30, d: 24, h: 64 }, { x: 32, y: 56, w: 29, d: 23, h: 49 }, { x: 101, y: 63, w: 28, d: 22, h: 36 }];
  return <svg className="city-travel-miniature" viewBox="0 0 180 164" aria-hidden="true" focusable="false">
    <ellipse cx="92" cy="144" rx="72" ry="12" fill="#000" opacity=".12" />
    <path d="M10 116 94 72 172 114 88 158Z" fill="#aeb0a7" />
    <path d="M10 110 94 66 172 108 88 152Z" fill="#d8d8c8" />
    <path d="M17 109 94 70 165 108 88 147Z" fill="#99ad79" />
    <path d="M23 116 36 109 104 143 90 150Z" fill="#6e797c" />
    <path d="M36 109 112 70 125 77 48 116Z" fill="#bec4bc" />
    {towers.map(({ x, y, w, d, h }, tower) => <g key={tower}>
      <path d={`M${x} ${y + h} ${x + w} ${y + w / 2 + h} ${x + w + d} ${y + (w - d) / 2 + h} ${x + d} ${y - d / 2 + h}Z`} fill="#6c776a" opacity=".3" transform="translate(6 3)" />
      <path d={`M${x} ${y} ${x + w} ${y + w / 2} ${x + w} ${y + w / 2 + h} ${x} ${y + h}Z`} fill={sales && tower === 0 ? "#8070bf" : "#a5b7c2"} />
      <path d={`M${x + w} ${y + w / 2} ${x + w + d} ${y + (w - d) / 2} ${x + w + d} ${y + (w - d) / 2 + h} ${x + w} ${y + w / 2 + h}Z`} fill={sales && tower === 0 ? "#544185" : "#6b8798"} />
      <path d={`M${x} ${y} ${x + d} ${y - d / 2} ${x + w + d} ${y + (w - d) / 2} ${x + w} ${y + w / 2}Z`} fill="#e0e5e5" />
      <path d={`M${x + 5} ${y} ${x + d} ${y - d / 2 + 4} ${x + w + d - 5} ${y + (w - d) / 2} ${x + w} ${y + w / 2 - 4}Z`} fill="#94bcc9" />
      {Array.from({ length: Math.floor((h - 12) / 12) }, (_, row) => [0, 1, 2].map(col => {
        const u = x + 4 + col * 8, v = y + 7 + (u - x) / 2 + row * 12;
        return <path key={`${row}-${col}`} d={`M${u} ${v} ${u + 5} ${v + 2.5} ${u + 5} ${v + 9} ${u} ${v + 6.5}Z`} fill={sales && tower === 0 ? "#c4a2ff" : "#417d98"} />;
      }))}
      {Array.from({ length: Math.floor((h - 12) / 12) }, (_, row) => [0, 1].map(col => {
        const u = x + w + 4 + col * 9, v = y + w / 2 + 7 - (u - x - w) / 2 + row * 12;
        return <path key={`side-${row}-${col}`} d={`M${u} ${v} ${u + 5} ${v - 2.5} ${u + 5} ${v + 4} ${u} ${v + 6.5}Z`} fill={sales && tower === 0 ? "#ad82f2" : "#b3d5dc"} />;
      }))}
    </g>)}
    {!sales && <g transform="translate(100 18)"><path d="M0 0V14M-5 14H5" stroke="#8599a9" strokeWidth="3" /><ellipse cx="0" cy="-3" rx="9" ry="5" fill="#edf2ef" transform="rotate(-40)" /><path d="M0-3 7-10" stroke="#8299aa" strokeWidth="2" /></g>}
    {[{ x: 26, y: 112 }, { x: 61, y: 134 }, { x: 140, y: 120 }, { x: 154, y: 105 }].map(({ x, y }) => <g key={x}>
      <ellipse cx={x + 3} cy={y + 5} rx="9" ry="4" fill="#506146" opacity=".25" />
      <path d={`M${x} ${y}V${y - 14}`} stroke="#8d7954" strokeWidth="3" />
      <ellipse cx={x} cy={y - 16} rx="7" ry="10" fill="#81b84f" /><ellipse cx={x - 2} cy={y - 18} rx="5" ry="7" fill="#a8d963" />
    </g>)}
  </svg>;
}

export function CityTravelCard({ cities, current, ready, onTravel, onVisit, children }: {
  cities: DepartmentCity[]; current: DepartmentId; ready: boolean;
  onTravel: (city: DepartmentId) => void; onVisit: (city: DepartmentId) => void;
  children?: ReactNode;
}) {
  const [destinationId, setDestinationId] = useState(() => cities.find(city => city.id !== current)?.id);
  const destination = cities.find(city => city.id === destinationId && city.id !== current) ?? cities.find(city => city.id !== current);
  const ordered = [...cities].sort((a, b) => Number(b.id === current) - Number(a.id === current));
  return <div className="city-travel">
    <div className="city-travel-cities" aria-label="Города для поездки">
      {ordered.map(city => {
        const isCurrent = city.id === current, isSelected = city.id === destination?.id;
        const content = <>
          <CityMiniature city={city.id} />
          <span className="city-travel-city__text">
            <strong>{cityLabel(city)}</strong>
            {isCurrent ? <span className="city-travel-here">Вы здесь</span> : <span className="city-travel-caption">{isSelected ? "Пункт назначения" : "Выбрать город"}</span>}
          </span>
          {!isCurrent && <span className="city-travel-check" aria-hidden="true">{isSelected && <svg viewBox="0 0 24 24" focusable="false"><path d="m5 12 4 4 10-10" /></svg>}</span>}
        </>;
        return isCurrent
          ? <article key={city.id} className="city-travel-city" aria-label={`Текущий город: ${cityLabel(city)}`}>{content}</article>
          : <button key={city.id} className="city-travel-city" type="button" aria-label={`Выбрать город ${cityLabel(city)} для поездки`} aria-pressed={isSelected} onClick={() => setDestinationId(city.id)}>{content}</button>;
      })}
    </div>
    <div className="city-travel-actions">
      <button className="city-travel-go" type="button" disabled={!ready || !destination} onClick={() => destination && onTravel(destination.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="2" width="14" height="16" rx="4" /><path d="M8 7h8M8 11h2m4 0h2M8 18l-3 4m11-4 3 4M7 21h10" /></svg>
        <span>{!destination ? "Нет другого города" : ready ? `Поехать в ${journeyLabel(destination)}` : "Готовим поезд…"}</span>
      </button>
      {destination && <button className="city-travel-visit" type="button" onClick={() => onVisit(destination.id)}>Открыть карту без поездки</button>}
    </div>
    {children}
  </div>;
}
