import { useSearchParams } from "react-router-dom";
import { XpHistory, XpProgress } from "../components/XpProgress";

export function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  return <div className="stack"><div className="page-head"><div><h1 className="page-title">Опыт и уровни</h1><p className="page-subtitle">Опыт растёт за работу и обучение. Покупки в магазине не расходуют XP.</p></div></div>
    <XpProgress showLevels />
    <XpHistory page={page} onPage={(p) => setParams({ page: String(p) })} />
  </div>;
}
