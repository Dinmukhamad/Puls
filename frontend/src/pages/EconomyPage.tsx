import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { economy, type EconomyReport } from "../api/economy";
import { Badge, Card, ErrorState, KPI, RowsSkeleton } from "../components/ui";
import { coins } from "../utils/format";
import "./configuration.css";

const ISSUED: Record<keyof EconomyReport["issued"], string> = {
  results: "Показатели и дисциплина", contest: "Места и номинации месяца", gratitude: "Благодарности водителей",
  learning: "Обучение и достижения", games: "Лента удачи и розыгрыши", manual: "Ручные начисления",
};
const BURNED: Record<keyof EconomyReport["burned"], string> = {
  city: "Город: постройки и проекты", shop: "Магазин бонусов", games: "Платные попытки и билеты",
  fines: "Штрафы", manual: "Ручные списания",
};
const SIGNAL: Record<EconomyReport["signal"], { tone: "success" | "warning" | "danger" | "neutral"; title: string; hint: string }> = {
  balanced: { tone: "success", title: "Экономика в равновесии", hint: "Операторы тратят примерно столько, сколько зарабатывают." },
  inflation: { tone: "danger", title: "Коины копятся — инфляция", hint: "Медианный баланс больше 1,5 месяца дохода. Поднимите цены магазина и города или уменьшите коины за балл." },
  shortage: { tone: "warning", title: "Коинов не хватает", hint: "Медианный баланс меньше 0,3 месяца дохода. Снизьте цены или увеличьте награды." },
  no_data: { tone: "neutral", title: "Пока нет начислений", hint: "Данные появятся после первых начислений месяца." },
};

function months() {
  const now = new Date(), out: { year: number; month: number; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }) });
  }
  return out;
}

/** The month's coin economy for heads and supervisors (docs/COIN_ECONOMY.md): issued against burned. */
export function EconomyPage() {
  const options = months();
  const [picked, setPicked] = useState(options[0]);
  const query = useQuery({ queryKey: ["economy-report", picked.year, picked.month], queryFn: () => economy.report(picked.year, picked.month) });
  return <div className="stack configuration-page">
    <div className="page-head"><div><h1 className="page-title">Экономика коинов</h1><p className="page-subtitle">Сколько коинов выпущено и сколько сгорело за месяц</p></div>
      <label className="field"><span className="field__label">Месяц</span><select className="input" value={`${picked.year}-${picked.month}`} onChange={(e) => setPicked(options.find((o) => `${o.year}-${o.month}` === e.target.value) ?? options[0])}>{options.map((o) => <option key={o.label} value={`${o.year}-${o.month}`}>{o.label}</option>)}</select></label>
    </div>
    {query.isLoading && <RowsSkeleton />}
    {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
    {query.data && <Report data={query.data} />}
  </div>;
}

function Report({ data }: { data: EconomyReport }) {
  const signal = SIGNAL[data.signal];
  const budget = data.shop_budget_tenge;
  return <>
    <Card title={signal.title} action={<Badge tone={signal.tone}>{data.months_held === null ? "нет данных" : `баланс ≈ ${data.months_held.toLocaleString("ru-RU")} мес. дохода`}</Badge>}><p className="secondary">{signal.hint}</p></Card>
    <div className="kpi-grid">
      <KPI label="Выпущено" value={coins(data.total_issued)} unit="коинов" tone="coin" />
      <KPI label="Сгорело" value={coins(data.total_burned)} unit="коинов" />
      <KPI label="Осталось на руках" value={`${data.net >= 0 ? "+" : ""}${coins(data.net)}`} unit="коинов" hint="Выпуск минус сжигание за месяц" />
      <KPI label="Средний доход оператора" value={coins(data.average_income)} unit="коинов" hint={`Заработали в месяце: ${data.earners} из ${data.operators}`} />
      <KPI label="Медианный баланс" value={coins(data.median_balance)} unit="коинов" />
      <KPI label="Магазин, ₸" value={coins(data.shop_tenge)} unit={budget ? `из ${coins(budget)}` : "без бюджета"} hint={`Курс: 1 коин = ${data.coin_rate_tenge.toLocaleString("ru-RU")} ₸`} />
    </div>
    <div className="economy-split">
      <Card title="Откуда пришли коины" padded={false}><Lines entries={Object.entries(data.issued).map(([key, value]) => [ISSUED[key as keyof EconomyReport["issued"]], value])} total={data.total_issued} /></Card>
      <Card title="Куда ушли коины" padded={false}><Lines entries={Object.entries(data.burned).map(([key, value]) => [BURNED[key as keyof EconomyReport["burned"]], value])} total={data.total_burned} /></Card>
    </div>
    {data.fine_debt > 0 && <p className="secondary small">Штрафы, на которые не хватило коинов: {coins(data.fine_debt)}. Они спишутся при следующих закрытиях недель.</p>}
    <p className="secondary small">Цель: средний оператор зарабатывает около 1000 коинов в месяц; город сжигает около 70% (сезон длится месяц), магазин — около 15%, платные попытки и билеты — около 7%.</p>
  </>;
}

function Lines({ entries, total }: { entries: [string, number][]; total: number }) {
  return <table className="table"><tbody>{entries.map(([label, value]) => <tr key={label}>
    <td>{label}</td><td className="num">{coins(value)}</td><td className="num secondary">{total > 0 ? `${Math.round(value / total * 100)}%` : "—"}</td>
  </tr>)}</tbody></table>;
}
