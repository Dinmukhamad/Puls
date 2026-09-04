import { useState, type FormEvent } from "react";

import { ApiError } from "../api/client";
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
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <span className="login__mark" aria-hidden="true">
            ◆
          </span>
          <span className="login__name">Pulse</span>
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
          <div className="notice notice--critical" role="alert">
            <span className="notice__icon" aria-hidden="true">
              !
            </span>
            <span>{error}</span>
          </div>
        )}

        {slow && (
          <p className="login__hint">
            Сервис просыпается после простоя, это занимает до 30 секунд.
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
          {pending ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
