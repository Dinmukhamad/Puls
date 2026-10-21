import { useState, type ReactNode } from "react";
import { useAccess } from "../auth/AccessContext";
import { Link } from "react-router-dom";
import { admin } from "../api/endpoints";
import { downloadFile } from "../api/client";
import { ChevronRightIcon, CoinIcon, DisplayIcon, DownloadIcon, MedalIcon, StoreIcon, TrophyIcon } from "../components/icons";
import { Button, Card, ErrorState } from "../components/ui";
import "./reports.css";

const reports: { title: string; text: string; to: string; icon: ReactNode }[] = [
  { title: "Рабочие показатели", text: "Сводка, сравнение групп и показатели сотрудников", to: "/analytics", icon: <TrophyIcon /> },
  { title: "Качество", text: "Покрытие оценками и недельная матрица", to: "/analytics?tab=metrics&category=quality&metric=quality", icon: <MedalIcon /> },
  { title: "Аналитика симулятора", text: "Прогресс, ошибки и активность операторов в Driver Simulator", to: "/admin/learning-analytics", icon: <DisplayIcon /> },
  { title: "История коинов", text: "Баланс операторов, начисления, списания и возвраты", to: "/admin/wallet", icon: <CoinIcon /> },
  { title: "Магазин", text: "Заявки, решения и выдача покупок", to: "/admin/requests", icon: <StoreIcon /> },
];

export function ReportsPage() {
  const { canPath } = useAccess();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const exportReport = async () => { setBusy(true); setError(null); try { await downloadFile(admin.exportPath(), "puls-operators.csv"); } catch (error) { setError(error); } finally { setBusy(false); } };
  const available = reports.filter((report) => canPath(report.to));
  return <div className="stack reports-page"><header className="page-head"><div><h1 className="page-title">Отчёты и экспорт</h1><p className="page-subtitle">Результаты работы, обучения и экономики в одном месте</p></div></header>
    <section aria-label="Отчёты" className="reports-grid">{available.map((report) => <Link key={report.to} className="reports-card" to={report.to}>
      <span className="reports-card__icon" aria-hidden="true">{report.icon}</span>
      <span className="reports-card__text"><strong>{report.title}</strong><span>{report.text}</span></span>
      <ChevronRightIcon className="reports-card__go" aria-hidden="true" />
    </Link>)}</section>
    <Card className="reports-export" title="Выгрузка показателей в CSV" subtitle="Таблица операторов за последнюю рассчитанную неделю: место, баллы, коины, баланс, опоздания и посторонние сайты. Файл с разделителем «;» сразу открывается в Excel."
      action={<Button variant="primary" icon={<DownloadIcon size={18} />} disabled={busy} onClick={exportReport}>{busy ? "Готовим файл…" : "Скачать CSV"}</Button>}>
      {canPath("/admin/operators") && <p className="reports-export__note">За другой период или по одному сотруднику — в <Link to="/admin/operators">«Команда → Показатели сотрудников»</Link>: там выгрузка учитывает выбранный период и поиск.</p>}
      {!!error && <ErrorState error={error} />}
    </Card>
  </div>;
}
