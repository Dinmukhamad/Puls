import { useId, useState } from "react";

import { points } from "../utils/format";

export interface ChartSeries {
  id: string;
  name: string;
  values: (number | null)[];
}

/** Weekly observations with explicit gaps and an equivalent readable table. */
export function Chart({ title, labels, series, target, unit, compact = false }: {
  title: string;
  labels: string[];
  series: ChartSeries[];
  target?: number | null;
  unit?: string | null;
  compact?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [focused, setFocused] = useState<string | null>(null);
  const observed = series.flatMap((item) => item.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  const domain = target == null ? observed : [...observed, target];
  const low = domain.length ? Math.min(...domain) : 0;
  const high = domain.length ? Math.max(...domain) : 1;
  const span = Math.max(high - low, Math.abs(high) * 0.08, 1);
  const min = low - span * 0.16;
  const max = high + span * 0.16;
  const width = 760;
  const height = compact ? 220 : 290;
  const left = 62;
  const right = 22;
  const top = 24;
  const bottom = 40;
  const x = (index: number) => left + index * (width - left - right) / Math.max(labels.length - 1, 1);
  const y = (value: number) => top + (max - value) * (height - top - bottom) / (max - min);
  const readable = (value: number | null) => value === null ? "Нет данных" : `${points(value)}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="analytics-chart">
      {observed.length === 0 ? <div className="analytics-chart__empty">Нет наблюдений за выбранные недели</div> : (
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={titleId} aria-describedby={descriptionId}>
          <title id={titleId}>{title}</title>
          <desc id={descriptionId}>Недельные значения. Пропуски разрывают линию. Ниже доступна таблица данных.</desc>
          {[low, (low + high) / 2, high].filter((value, index, values) => values.indexOf(value) === index).map((value) => (
            <g key={value} className="analytics-chart__grid" aria-hidden="true">
              <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} />
              <text x={left - 10} y={y(value) + 4} textAnchor="end">{points(value)}</text>
            </g>
          ))}
          {target !== undefined && target !== null && (
            <g className="analytics-chart__target" aria-hidden="true">
              <line x1={left} x2={width - right} y1={y(target)} y2={y(target)} />
              <text x={width - right} y={y(target) - 8} textAnchor="end">Цель {points(target)}</text>
            </g>
          )}
          {labels.map((label, index) => <text key={`${label}-${index}`} className="analytics-chart__label" x={x(index)} y={height - 14} textAnchor="middle" aria-hidden="true">{label.replace(/^\d{4}-/, "")}</text>)}
          {series.map((item, seriesIndex) => {
            let path = "";
            let connected = false;
            item.values.forEach((value, index) => {
              if (value === null || !Number.isFinite(value)) { connected = false; return; }
              path += `${connected ? "L" : "M"}${x(index)},${y(value)} `;
              connected = true;
            });
            return (
              <g key={item.id} className={`analytics-chart__series analytics-chart__series--${seriesIndex % 5}`}>
                <path d={path} className="analytics-chart__line" aria-hidden="true" />
                {item.values.map((value, index) => {
                  if (value === null || !Number.isFinite(value)) return null;
                  const description = `${labels[index]} · ${item.name}: ${readable(value)}`;
                  return <circle key={index} cx={x(index)} cy={y(value)} r={5} tabIndex={0} role="img" aria-label={description} onFocus={() => setFocused(description)} onMouseEnter={() => setFocused(description)} onBlur={() => setFocused(null)}><title>{description}</title></circle>;
                })}
              </g>
            );
          })}
        </svg>
      )}
      <div className="analytics-chart__legend" aria-label="Ряды данных">
        {series.map((item, index) => <span key={item.id} className={`analytics-chart__legend-item analytics-chart__series--${index % 5}`}><i aria-hidden="true" />{item.name}</span>)}
        {target != null && <span>Пунктир — текущая цель</span>}
      </div>
      <p className="analytics-chart__detail" aria-live="polite">{focused ?? "Выберите точку для подробностей. Пропуски означают отсутствие данных."}</p>
      <details className="analytics-data-table">
        <summary>Таблица данных графика</summary>
        <div className="analytics-table-scroll" tabIndex={0} role="region" aria-label="Данные графика, прокрутка по горизонтали">
          <table className="table"><caption className="sr-only">{title}</caption><thead><tr><th scope="col">Неделя</th>{series.map((item) => <th key={item.id} scope="col">{item.name}</th>)}</tr></thead><tbody>
            {labels.map((label, index) => <tr key={`${label}-${index}`}><th scope="row">{label}</th>{series.map((item) => <td key={item.id}>{readable(item.values[index] ?? null)}</td>)}</tr>)}
          </tbody></table>
        </div>
      </details>
    </div>
  );
}
