import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";
export function AccessPage({ missing = false }: { missing?: boolean }) {
  return <EmptyState title={missing ? "Страница не найдена" : "Нет доступа"} hint={missing ? "Проверьте адрес или вернитесь на главную" : "Доступ к этому разделу закрыт. Администратор может изменить права вашего аккаунта."} action={<Link className="btn btn--primary btn--m" to="/">На главную</Link>} />;
}
