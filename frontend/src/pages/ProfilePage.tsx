import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { auth, cabinet } from "../api/endpoints";
import { useAccess } from "../auth/AccessContext";
import { useAuth } from "../auth/AuthContext";
import { DisplayIcon, LogoutIcon, MoonIcon, SunIcon } from "../components/icons";
import { Avatar, Badge, Button, Card, CoinAmount, Skeleton } from "../components/ui";
import { useTheme, type ThemePreference } from "../theme/ThemeContext";
import { Sheet } from "../components/Sheet";
import { XpProgress } from "../components/XpProgress";
import { useToast } from "../components/Toast";
import { PwaInstallCard } from "../pwa/PwaProvider";
import { ROLE_LABELS, coins, dateOnly } from "../utils/format";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: (props: { size?: number }) => JSX.Element;
}[] = [
  { value: "system", label: "Система", icon: DisplayIcon },
  { value: "light", label: "Светлая", icon: SunIcon },
  { value: "dark", label: "Тёмная", icon: MoonIcon },
];

export function ProfilePage() {
  const { user, logout } = useAuth();
  const { can } = useAccess();
  const { preference, setPreference } = useTheme();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => cabinet.dashboard(), enabled: can("personal") });
  const [securityOpen, setSecurityOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Профиль</h1>
      </div>

      <Card>
        <div className="profile-head">
          <Avatar name={user.full_name} id={user.id} size={64} />
          <div className="profile-head__text">
            <p className="profile-head__name">{user.full_name}</p>
            <p className="profile-head__meta">
              {ROLE_LABELS[user.role]}
              {user.group ? ` · ${user.group.name}` : ""}
            </p>
            <div className="row" style={{ marginTop: "var(--sp-2)" }}>
              <Badge tone={user.is_active ? "success" : "neutral"} dot>
                {user.is_active ? "Активен" : "Отключён"}
              </Badge>
              {dashboard.data && (
                <Badge tone="neutral">
                  Баланс {coins(dashboard.data.balance.balance)}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid--1-1">
        <Card title="Аккаунт">
          <div className="grouped">
            <div className="grouped__row">
              <span className="grouped__label">Логин</span>
              <span className="grouped__value">{user.login}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">Электронная почта</span>
              <span className="grouped__value">{user.email ?? "—"}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">Роль</span>
              <span className="grouped__value">{ROLE_LABELS[user.role]}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">Группа</span>
              <span className="grouped__value">{user.group?.name ?? "—"}</span>
            </div>
            <div className="grouped__row">
              <span className="grouped__label">В компании с</span>
              <span className="grouped__value">
                {user.hired_on ? dateOnly(user.hired_on) : "—"}
              </span>
            </div>
          </div>
        </Card>

        <div className="stack stack--tight">
          <Card title="Внешний вид" subtitle="По умолчанию тема следует за системой">
            <div className="theme-options" role="radiogroup" aria-label="Тема оформления">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preference === option.value}
                  tabIndex={preference === option.value ? 0 : -1}
                  className={
                    preference === option.value ? "theme-option is-active" : "theme-option"
                  }
                  onClick={() => setPreference(option.value)}
                  onKeyDown={(event) => {
                    const index = THEME_OPTIONS.indexOf(option);
                    let next = index;
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % THEME_OPTIONS.length;
                    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + THEME_OPTIONS.length - 1) % THEME_OPTIONS.length;
                    else if (event.key === "Home") next = 0;
                    else if (event.key === "End") next = THEME_OPTIONS.length - 1;
                    else return;
                    event.preventDefault();
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                    setPreference(THEME_OPTIONS[next].value);
                  }}
                >
                  <option.icon size={22} />
                  {option.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Безопасность" subtitle="Пароль и устройства, на которых открыт аккаунт">
            <div className="stack stack--tight">
              <Button block onClick={() => setSecurityOpen(true)}>Изменить пароль</Button>
              <Link className="btn btn--secondary btn--m btn--block" to="/sessions">Мои устройства</Link>
            </div>
          </Card>

          <PwaInstallCard />

          <Card title="Развитие и события">
            <div className="stack stack--tight">
              {can("personal") && <Link className="btn btn--secondary btn--m btn--block" to="/progress">Опыт и уровни</Link>}
              <Link className="btn btn--secondary btn--m btn--block" to="/notifications">Уведомления</Link>
            </div>
          </Card>

          {can("personal") && <><XpProgress />
          <Card title="Мои коины" action={<Link to="/wallet">Кошелёк →</Link>}>
            {dashboard.isLoading && <Skeleton height={64} radius="var(--radius-m)" />}
            {dashboard.data && (
              <div className="grouped">
                <div className="grouped__row">
                  <span className="grouped__label">Баланс</span>
                  <span className="grouped__value">
                    <CoinAmount value={dashboard.data.balance.balance} />
                  </span>
                </div>
                <div className="grouped__row">
                  <span className="grouped__label">В резерве</span>
                  <span className="grouped__value">
                    {coins(dashboard.data.balance.reserved)}
                  </span>
                </div>
                <div className="grouped__row">
                  <span className="grouped__label">Всего начислено</span>
                  <span className="grouped__value">
                    {coins(dashboard.data.balance.total_earned)}
                  </span>
                </div>
                <div className="grouped__row">
                  <span className="grouped__label">Всего потрачено</span>
                  <span className="grouped__value">
                    {coins(dashboard.data.balance.total_spent)}
                  </span>
                </div>
              </div>
            )}
          </Card>

          </>}
          <Card title="Система">
            <Button variant="destructive" block icon={<LogoutIcon size={18} />} onClick={logout}>
              Выйти из аккаунта
            </Button>
          </Card>
        </div>
      </div>
      {securityOpen && <PasswordSheet onClose={() => setSecurityOpen(false)} />}
    </div>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const errorId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => auth.changePassword(currentPassword, password),
    onSuccess: (result) => {
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast.success(result.detail);
      onClose();
    },
  });
  const error = validationError || (mutation.error instanceof Error ? mutation.error.message : null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setValidationError(null);
    if (password !== confirmation) {
      setValidationError("Новый пароль и подтверждение не совпадают.");
      return;
    }
    if (password === currentPassword) {
      setValidationError("Новый пароль должен отличаться от текущего.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Sheet title="Изменить пароль" subtitle="После смены пароля остальные сеансы будут завершены." size="s" onClose={() => { if (!mutation.isPending) onClose(); }} footer={<>
      <Button disabled={mutation.isPending} onClick={onClose}>Отмена</Button>
      <Button type="submit" form={formId} variant="primary" disabled={mutation.isPending}>{mutation.isPending ? "Сохраняем…" : "Сохранить пароль"}</Button>
    </>}>
      <form id={formId} onSubmit={submit} className="stack stack--tight" aria-describedby={error ? errorId : undefined}>
        <div className="field">
          <label className="field__label" htmlFor={currentId}>Текущий пароль</label>
          <input id={currentId} className="input" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={mutation.isPending} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={newId}>Новый пароль</label>
          <input id={newId} className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={mutation.isPending} />
          <span className="field__note">Не менее 8 символов.</span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={confirmId}>Повторите новый пароль</label>
          <input id={confirmId} className="input" type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={mutation.isPending} aria-invalid={validationError ? true : undefined} />
        </div>
        <Button size="s" aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Скрыть пароли" : "Показать пароли"}</Button>
        {error && <p className="field__error" id={errorId} role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}

