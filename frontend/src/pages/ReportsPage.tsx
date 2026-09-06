import { useState } from "react";
import { Link } from "react-router-dom";
import { admin } from "../api/endpoints";
import { downloadFile } from "../api/client";
import { Button, Card, ErrorState } from "../components/ui";

const reports = [
  { title: "Рабочие показатели", text: "Сводка, сравнение групп и показатели сотрудников", to: "/analytics" },
  { title: "Качество", text: "Покрытие оценками и недельная матрица", to: "/analytics?tab=quality&metric=quality" },
  { title: "Обучение", text: "Попытки, результаты и награды сотрудников", to: "/admin/learning?tab=results" },
  { title: "Driver Simulator", text: "Результаты прохождений симулятора", to: "/admin/learning?tab=results&kind=simulator" },
  { title: "Экономика коинов", text: "Баланс команды, начисления, списания и возвраты", to: "/admin/wallet" },
  { title: "Магазин", text: "Заявки, решения и выдача покупок", to: "/admin/requests" },
];

export function ReportsPage() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const exportReport = async () => { setBusy(true); setError(null); try { await downloadFile(admin.exportPath(), "puls-operators.csv"); } catch (error) { setError(error); } finally { setBusy(false); } };
  return <div className="stack"><header className="page-head"><div><h1 className="page-title">Отчёты</h1><p className="page-subtitle">Результаты работы, обучения и экономики</p></div><Button disabled={busy} onClick={exportReport}>{busy ? "Готовим CSV…" : "Экспорт показателей в CSV"}</Button></header>{!!error && <ErrorState error={error} />}
    <div className="grid grid--1-1">{reports.map((report) => <Card key={report.to} title={report.title}><p className="secondary">{report.text}</p><Link className="btn btn--secondary btn--m" to={report.to}>Открыть отчёт</Link></Card>)}</div>
  </div>;
}
