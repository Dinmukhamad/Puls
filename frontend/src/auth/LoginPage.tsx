import { useState, type FormEvent } from "react";

import { ApiError } from "../api/client";
import { AlertIcon, PulsMark } from "../components/icons";
import { Button } from "../components/ui";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Бесплатный тариф хостинга усыпляет сервис: первый вход может быть долгим. */
  const [slow, setSlow] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const slowTimer = window.setTimeout(() => setSlow(true), 4000);
    try {
      await login(loginName.trim(), password);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Не удалось войти, повторите попытку",
      );
    } finally {
      window.clearTimeout(slowTimer);
      setSlow(false);
      setPending(false);
    }
  }

  return (
    <div className="login">
      <aside className="login__visual">
        <div className="login__brand">
          <PulsMark size={26} />
          Puls
        </div>
        <p className="login__claim">Работа, которая видна</p>
        <div className="login__points">
          <span>Коины за результат недели</span>
          <span>Рейтинг команды и номинации</span>
          <span>Магазин бонусов</span>
        </div>
      </aside>

      <div className="login__form-side">
        <form className="login__card" onSubmit={submit}>
          <div className="login__mobile-brand">
            <span className="sidebar__mark">
              <PulsMark />
            </span>
            Puls
          </div>

          <h1 className="login__title">Вход в систему</h1>
          <p className="login__subtitle">Конкурсы, коины и магазин бонусов</p>

          <label className="field">
            <span className="field__label">Логин</span>
            <input
              className="input"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Пароль</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="notice notice--danger" role="alert">
              <span className="notice__icon">
                <AlertIcon size={16} />
              </span>
              <span>{error}</span>
            </div>
          )}

          {slow && (
            <p className="login__hint">
              Сервис просыпается после простоя, это занимает до 30 секунд.
            </p>
          )}

          <Button type="submit" variant="primary" size="l" block disabled={pending}>
            {pending ? "Входим…" : "Войти"}
          </Button>
        </form>
      </div>
    </div>
  );
}
