import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";
export function AccessPage({ missing = false }: { missing?: boolean }) {
  return <EmptyState title={missing ? "Страница не найдена" : "Нет доступа"} hint={missing ? "Проверьте адрес или вернитесь на главную" : "Этот раздел недоступен вашей роли. Обратитесь к администратору, если доступ необходим."} action={<Link className="btn btn--primary btn--m" to="/cabinet">На главную</Link>} />;
}
