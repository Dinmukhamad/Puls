import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../api/client";
import { GlassSurface } from "../components/GlassSurface";
import { AlertIcon, EyeIcon, EyeOffIcon, PulsMark } from "../components/icons";
import { Button } from "../components/ui";
import { useAuth } from "./AuthContext";

/** Линия пульса за карточкой: тот же всплеск, что в знаке Puls, только во всю ширину экрана. */
const PULSE = "M0 250 H190 l40 -110 l64 180 l56 -220 l46 150 H1440";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const id = useId();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
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
      navigate("/", { replace: true });
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

  // Caps Lock чаще всего и есть причина «неверного пароля»: предупреждаем, пока человек печатает.
  const watchCaps = (event: KeyboardEvent<HTMLInputElement>) => setCaps(event.getModifierState("CapsLock"));

  return (
    <div className="login">
      <svg className="login__pulse" viewBox="0 0 1440 400" preserveAspectRatio="none" aria-hidden="true">
        <path className="login__pulse-line" d={PULSE} pathLength={1000} />
        <path className="login__pulse-beat" d={PULSE} pathLength={1000} />
      </svg>

      <GlassSurface as="section" variant="prominent" className="login__card" aria-labelledby={`${id}-title`}>
        <form onSubmit={submit}>
          <div className="login__brand">
            <span className="login__mark"><PulsMark size={22} /></span>
            Puls
          </div>

          <h1 className="login__title" id={`${id}-title`}>С возвращением</h1>
          <p className="login__subtitle">Войдите, чтобы увидеть свою неделю, коины и город</p>

          <label className="field">
            <span className="field__label">Логин</span>
            <input
              className="input"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
            />
          </label>

          <div className="field">
            <label className="field__label" htmlFor={`${id}-password`}>Пароль</label>
            <div className="login__password">
              <input
                id={`${id}-password`}
                className="input"
                type={shown ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={watchCaps}
                onKeyUp={watchCaps}
                onBlur={() => setCaps(false)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="login__reveal"
                aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={shown}
                onClick={() => setShown((value) => !value)}
              >
                {shown ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
            {caps && <span className="login__caps" role="status">Включён Caps Lock</span>}
          </div>

          {error && (
            <div className="notice notice--danger" role="alert">
              <span className="notice__icon">
                <AlertIcon size={16} />
              </span>
              <span>{error}</span>
            </div>
          )}

          {slow && (
            <p className="login__hint" role="status">
              Сервис просыпается после простоя, это занимает до 30 секунд.
            </p>
          )}

          <Button type="submit" variant="primary" size="l" block disabled={pending}>
            {pending ? "Входим…" : "Войти"}
          </Button>

          <p className="login__help">Нет доступа или забыли пароль? Напишите своему руководителю.</p>
        </form>
      </GlassSurface>
    </div>
  );
}
