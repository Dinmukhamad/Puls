import { useEffect, useId, useRef, useState } from "react";
import type { DriverCheck } from "../api/driverAnalytics";

export const STAGES: Record<string, string> = {
  searching: "Поиск заказа", offer: "Предложение заказа", pickup: "Подача машины",
  waiting: "Ожидание пассажира", trip: "Поездка", payment: "Оплата",
  photo: "Фотоконтроль", preparing: "Подготовка к работе", finished: "Смена завершена",
  not_started: "Не начинал", complete: "Заказ выполнен", cancelled: "Заказ отменён",
};
export const SKILL_LABELS: Record<string, string> = { orders: "Заказы", route: "Маршрут", park: "Парк", photo: "Фото", wallet: "Операции", support: "Поддержка", rating: "Рейтинг", priority: "Приоритет", documents: "Документы" };
export const ATTENTION: Record<string, string> = { errors: "Ошибки в последней смене", failed: "Зачёт не сдан", stale: "Нет действий более суток" };
export const checkState = (check?: DriverCheck) => !check ? "new" : !check.required ? "optional" : check.done ? "done" : "pending";
export const CHECK_LABELS: Record<string, string> = { new: "Нет данных об этапе", optional: "Не требуется сценарием", done: "Выполнен", pending: "Не выполнен" };
export const shortDate = (value: string) => new Date(value).toLocaleDateString("ru", { day: "numeric", month: "short", timeZone: "UTC" });

export function SkillDots({ checks }: { checks: DriverCheck[] }) {
  return <div className="da-skill-dots" aria-label="Этапы текущей или последней смены">{Object.keys(SKILL_LABELS).map(key => {
    const check = checks.find(c => c.key === key), state = checkState(check);
    return <span key={key} className={`da-cell da-cell--${state}`} title={`${SKILL_LABELS[key]} · ${CHECK_LABELS[state]}`} aria-label={`${SKILL_LABELS[key]} · ${CHECK_LABELS[state]}`}>{state === "done" ? "✓" : state === "optional" ? "—" : "·"}</span>;
  })}</div>;
}

export function TrendChart({ title, labels, series, ceiling }: {
  title: string; labels: string[]; series: { name: string; values: (number | null)[]; type?: "bar" | "line" }[]; ceiling?: number;
}) {
  const id = useId(), [selected, setSelected] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, Math.min(720, entries[0].contentRect.width))));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const values = series.flatMap(s => s.values).filter((v): v is number => v !== null);
  const max = ceiling ?? Math.max(1, ...values), height = 225, plotWidth = width - 70;
  const x = (i: number) => 42 + (i + .5) * plotWidth / Math.max(1, labels.length);
  const y = (v: number) => 183 - Math.min(max, v) / max * 155;
  const index = selected !== null && selected < labels.length ? selected : null;
  return <div className="da-chart" ref={container}>
    {labels.length ? <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={id}>
      <title id={id}>{title}</title>
      {[0, Math.round(max / 2), max].filter((v, i, all) => all.indexOf(v) === i).map(v => <g className="da-chart__grid" key={v}><line x1="42" x2={width - 19} y1={y(v)} y2={y(v)} /><text x="32" y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      {series.map((s, k) => {
        let path = "", connected = false;
        s.values.forEach((v, i) => { if (v === null) { connected = false; return; } path += `${connected ? "L" : "M"}${x(i)},${y(v)} `; connected = true; });
        return <g className={`da-chart__series da-chart__series--${k}`} key={s.name}>
          {s.type !== "bar" && <path d={path} fill="none" strokeWidth="2.5" />}
          {s.values.map((v, i) => v === null ? null : s.type === "bar" ? <rect key={i} x={x(i) - Math.min(13, plotWidth * .36 / labels.length)} y={y(v)} width={Math.min(26, plotWidth * .72 / labels.length)} height={183 - y(v)} rx="3" opacity={index === null || index === i ? .85 : .35} /> : <circle key={i} cx={x(i)} cy={y(v)} r={labels.length > 35 ? 2.5 : 4} />)}
        </g>;
      })}
      {labels.map((label, i) => <g key={i}>
        <rect className="da-chart__hit" x={x(i) - plotWidth / 2 / labels.length} y="15" width={plotWidth / labels.length} height="175" tabIndex={0} role="button" aria-label={`${label}: ${series.map(s => `${s.name} ${s.values[i] ?? "нет оценки"}`).join(", ")}`} onMouseEnter={() => setSelected(i)} onFocus={() => setSelected(i)} onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(i); } }}><title>{label}: {series.map(s => `${s.name} ${s.values[i] ?? "—"}`).join(" · ")}</title></rect>
        {(i % Math.ceil(labels.length / (width < 500 ? 3 : 6)) === 0 || i === labels.length - 1) && <text className="da-chart__label" x={x(i)} y="211" textAnchor="middle">{label}</text>}
      </g>)}
    </svg> : <div className="da-chart__empty">Пока нет смен для графика</div>}
    <div className="da-chart__legend">{series.map((s, k) => <span key={s.name}><i className={`da-chart__swatch da-chart__swatch--${k}`} />{s.name}</span>)}</div>
    <p className="da-chart__readout" aria-live="polite">{index === null ? "Наведите на график или выберите точку клавиатурой" : `${labels[index]} · ${series.map(s => `${s.name}: ${s.values[index] ?? "нет оценки"}`).join(" · ")}`}</p>
    <details className="da-chart__data"><summary>Данные графика</summary><div className="table-wrap"><table className="table"><thead><tr><th>Период / смена</th>{series.map(s => <th key={s.name}>{s.name}</th>)}</tr></thead><tbody>{labels.map((label, i) => <tr key={i}><th>{label}</th>{series.map(s => <td key={s.name}>{s.values[i] ?? "Нет оценки"}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
